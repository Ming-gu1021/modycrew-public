import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { killProcessTree } from './subscription-cli-runtime.mjs';
import { normalizeCodexAccountCredit } from './provider-account-credit.mjs';

// Official metadata only. No user prompt, model turn, token-file parsing or settings writes.
// https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt
// https://code.claude.com/docs/en/agent-sdk/typescript#sdkusagereport
const number = value => typeof value === 'number' && Number.isFinite(value);
const percent = value => number(value) && value >= 0 && value <= 100;
function windowRow(id, label, used, resetsAt, active = false) {
  if (!percent(used)) return null;
  const reset = typeof resetsAt === 'string' ? Date.parse(resetsAt) : number(resetsAt) ? resetsAt * 1000 : null;
  if (number(reset) && reset <= Date.now()) return null;
  return { id, label, usedPercent: used, remainingPercent: 100 - used, resetsAt: number(reset) ? reset : null, active };
}
export function normalizeCodexLimits(result) {
  // Never substitute a model-specific bucket for the account-wide Codex bucket.
  const bucket = result?.rateLimitsByLimitId?.codex ?? (result?.rateLimits?.limitId == null || result.rateLimits.limitId === 'codex' ? result?.rateLimits : null);
  return ['primary', 'secondary'].flatMap(id => {
    const entry = bucket?.[id];
    const mins = entry?.windowDurationMins;
    const label = mins === 10080 ? '주간' : mins === 300 ? '5시간' : number(mins) && mins > 0 ? (mins % 60 === 0 ? `${mins / 60}시간` : `${mins}분`) : id === 'primary' ? '현재 한도' : '추가 한도';
    const row = windowRow(id, label, entry?.usedPercent, entry?.resetsAt);
    return row ? [{ ...row, accountWide: true }] : [];
  });
}
export function normalizeClaudeLimits(report) {
  const limits = report?.rate_limits?.limits;
  if (!Array.isArray(limits)) return [];
  return limits.flatMap((entry, index) => {
    const label = entry.kind === 'session' ? '현재 세션' : entry.kind === 'weekly_all' ? '주간' : entry.kind === 'weekly_scoped' ? `주간 · ${String(entry.scope?.model?.display_name || entry.scope?.surface?.display_name || '개별 한도').slice(0, 60)}` : String(entry.group || '사용 한도').slice(0, 60);
    const row = windowRow(String(index), label, entry.percent, entry.resets_at, entry.is_active === true);
    return row ? [{ ...row, accountWide: entry.kind === 'session' || entry.kind === 'weekly_all' }] : [];
  });
}
function result(provider, windows, source, extra = {}) {
  return { provider, connected: true, status: windows.length ? 'ready' : 'unavailable', windows, source, checkedAt: Date.now(), ...extra };
}
function failure(provider, error, source) {
  const status = error?.code === 'TIMEOUT' ? 'timeout' : error?.code === 'LOGIN' ? 'login_required' : error?.code === 'UNSUPPORTED' ? 'unsupported' : 'unavailable';
  return result(provider, [], source, { status });
}
function start(executable, args, { spawnFn = spawn, cwd, timeoutMs = 10000 } = {}) {
  if (!executable) throw Object.assign(new Error('CLI unavailable'), { code: 'UNSUPPORTED' });
  // A shell never receives credentials. Batch wrappers use only fixed, internal arguments.
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  const child = spawnFn(batch ? process.env.ComSpec || 'cmd.exe' : executable, batch ? ['/d', '/s', '/c', executable, ...args] : args,
    { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  const pending = new Map(), decoder = new StringDecoder('utf8'); let buffer = '', bytes = 0, listener = () => {}, failed = false;
  const abort = error => { failed = true; for (const value of pending.values()) value.reject(error); pending.clear(); listener(null, error); };
  const timer = setTimeout(() => { abort(Object.assign(new Error('Usage timeout'), { code: 'TIMEOUT' })); void killProcessTree(child); }, timeoutMs);
  child.on('error', () => abort(new Error('CLI unavailable')));
  child.stdin.on('error', () => abort(new Error('CLI input unavailable')));
  child.on('close', () => abort(new Error('CLI closed')));
  child.stderr.on('data', () => {}); // Never expose CLI diagnostics, account details or credentials.
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) { abort(new Error('Usage response too large')); void killProcessTree(child); return; }
    buffer += decoder.write(chunk); let pos;
    while ((pos = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
      try {
        const message = JSON.parse(line);
        const request = pending.get(message.id);
        if (request) { pending.delete(message.id); message.error ? request.reject(new Error('Usage request failed')) : request.resolve(message.result); }
        else listener(message);
      } catch { /* Ignore non-protocol lines. */ }
    }
  });
  let sequence = 0;
  return {
    send: message => child.stdin.write(JSON.stringify(message) + '\n'),
    endInput: () => child.stdin.end(),
    request(method, params) {
      if (failed) return Promise.reject(new Error('CLI unavailable'));
      const id = ++sequence;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
    },
    listen: callback => { listener = callback; },
    async close() { clearTimeout(timer); listener = () => {}; abort(new Error('Closed')); await killProcessTree(child); },
  };
}
export async function readCodexUsageLimits({ executable, credential, ...options } = {}) {
  const provider = 'codex_oauth', source = 'Codex 공식 계정 조회'; let client, connected = Boolean(credential);
  try {
    // External auth is kept in memory by the official app-server. Never log in/out
    // of the user's managed CLI session or persist the app's token to its files.
    const args = ['app-server', '--listen', 'stdio://', ...(credential ? ['-c', 'cli_auth_credentials_store="ephemeral"'] : [])];
    client = start(executable, args, options);
    await client.request('initialize', { clientInfo: { name: 'modycrew_usage', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    client.send({ method: 'initialized' });
    if (credential) await client.request('account/login/start', { type: 'chatgptAuthTokens', accessToken: credential.access, chatgptAccountId: credential.accountId });
    else {
      const auth = await client.request('account/read', { refreshToken: false });
      if (auth?.account?.type !== 'chatgpt') return result(provider, [], source, { connected: false, status: 'login_required' });
      connected = true;
    }
    const metadata = await client.request('account/rateLimits/read', {});
    const windows = normalizeCodexLimits(metadata);
    const credits = normalizeCodexAccountCredit(metadata);
    return result(provider, windows, source, {
      ...(credits ? { credits } : {}),
      status: windows.length || credits ? 'ready' : 'unavailable',
    });
  } catch (error) { return { ...failure(provider, error, source), connected }; }
  finally { await client?.close(); }
}
export async function readClaudeUsageLimits({ executable, ...options } = {}) {
  const provider = 'claude_subscription', source = 'Claude 공식 사용량 조회'; let client;
  try {
    // /usage is a built-in metadata command. max-turns=0 prevents generation even
    // on an older CLI. Safe mode keeps OAuth but disables project customizations.
    client = start(executable, ['-p', '/usage', '--verbose', '--output-format', 'stream-json', '--safe-mode', '--tools', '', '--max-turns', '0', '--no-session-persistence'], options);
    const report = await new Promise((resolve, reject) => {
      client.listen((message, error) => {
        if (error) return reject(error);
        if (message?.usage_report) resolve(message.usage_report);
        else if (message?.type === 'result') reject(Object.assign(new Error('Structured usage unsupported'), { code: 'UNSUPPORTED' }));
      });
      client.endInput();
    });
    return result(provider, normalizeClaudeLimits(report), source);
  } catch (error) { return failure(provider, error, source); }
  finally { await client?.close(); }
}
