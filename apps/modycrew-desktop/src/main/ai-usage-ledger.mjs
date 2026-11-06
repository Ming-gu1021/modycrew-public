import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const warnings = new Set();
const tokenFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningTokens'];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
const namespace = root => path.join(path.resolve(root), 'ai-usage', 'personal-v1');
export const aiUsageConnectionId = (provider, identity) => identity ? createHash('sha256').update(`${provider}\0${identity}`).digest('hex') : null;

function writeOnce(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const fd = openSync(file, 'wx');
  try { writeFileSync(fd, JSON.stringify(data), 'utf8'); fsyncSync(fd); }
  finally { closeSync(fd); }
}

function cleanUsage(raw) {
  const result = Object.fromEntries(tokenFields.map(key => [key, count(raw?.[key])]));
  return { source: ['provider_response', 'local_response'].includes(raw?.source) ? raw.source : 'unavailable', ...result };
}

/** Immutable start/end files avoid replacing another process's counters. */
export function beginAIUsage({ root, connectionId, provider, model, now = Date.now() }) {
  if (!root || !/^[a-f0-9]{64}$/.test(connectionId || '')) return { finish: () => ({ status: 'identity_unavailable' }) };
  const id = randomUUID();
  const directory = path.join(namespace(root), connectionId, new Date(now).toISOString().slice(0, 10));
  const started = { version: 1, id, provider: label(provider), model: label(model), startedAt: now };
  let startSaved = false;
  try { writeOnce(path.join(directory, `${id}.start.json`), started); startSaved = true; }
  catch { warnings.add(namespace(root)); }
  let finished = false;
  return {
    finish(result = {}) {
      if (finished) return { status: 'already_recorded', requestId: id };
      if (!startSaved) return { status: 'save_failed', requestId: id };
      const status = result.cancelled ? 'cancelled' : result.status === 'generate_content_loaded' && result.outputText ? 'succeeded' : 'failed';
      const completed = { version: 1, id, finishedAt: Date.now(), status, usage: cleanUsage(result.tokenUsage) };
      try {
        writeOnce(path.join(directory, `${id}.finish.json`), completed);
        finished = true;
        return { status: 'saved', requestId: id };
      } catch { warnings.add(namespace(root)); return { status: 'save_failed', requestId: id }; }
    },
  };
}

export function readAIUsage({ root, connections = [], days = 30, now = Date.now() }) {
  const period = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const from = now - period * 86_400_000;
  const groups = new Map();
  let unreadableRecords = 0, limited = false, scanned = 0;
  for (const connection of connections) {
    if (!/^[a-f0-9]{64}$/.test(connection.id || '')) continue;
    const directory = path.join(namespace(root), connection.id);
    if (!existsSync(directory)) continue;
    let dates;
    try { dates = readdirSync(directory).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Date.parse(`${date}T00:00:00Z`) + 86_400_000 > from).sort().reverse(); }
    catch { unreadableRecords++; continue; }
    for (const date of dates) {
      let files;
      try { files = readdirSync(path.join(directory, date)).filter(file => /^[a-f0-9-]{36}\.start\.json$/.test(file)); }
      catch { unreadableRecords++; continue; }
      for (const file of files) {
        if (++scanned > 20_000) { limited = true; break; }
        let start;
        try { start = JSON.parse(readFileSync(path.join(directory, date, file), 'utf8')); }
        catch { unreadableRecords++; continue; }
        if (!start || start.version !== 1 || !Number.isFinite(start.startedAt)) { unreadableRecords++; continue; }
        if (start.startedAt < from || start.startedAt > now) continue;
        if (file !== `${start.id}.start.json` || start.provider !== connection.provider) { unreadableRecords++; continue; }
        const key = JSON.stringify([connection.id, start.model]);
        if (!groups.has(key)) groups.set(key, { provider: label(start.provider), model: label(start.model), requests: 0, succeeded: 0, failed: 0, cancelled: 0, unconfirmed: 0, usageReported: 0, ...Object.fromEntries(tokenFields.flatMap(field => [[field, null], [`${field}Requests`, 0]])), lastRecordedAt: 0 });
        const group = groups.get(key); group.requests++; group.lastRecordedAt = Math.max(group.lastRecordedAt, start.startedAt);
        let end;
        try { end = JSON.parse(readFileSync(path.join(directory, date, `${start.id}.finish.json`), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') unreadableRecords++; }
        if (!end || end.version !== 1 || end.id !== start.id || !['succeeded', 'failed', 'cancelled'].includes(end.status)) { group.unconfirmed++; continue; }
        group[end.status]++;
        const usage = cleanUsage(end.usage);
        if (usage.source === 'unavailable') continue;
        group.usageReported++;
        for (const field of tokenFields) if (usage[field] !== null) {
          const total = (group[field] ?? 0) + usage[field];
          if (Number.isSafeInteger(total)) { group[field] = total; group[`${field}Requests`]++; }
          else { limited = true; }
        }
      }
      if (limited) break;
    }
    if (limited) break;
  }
  return {
    status: 'ai_usage_loaded', days: period, from, checkedAt: now,
    scope: 'personal_current_connections_on_this_device', groups: [...groups.values()].sort((a, b) => b.lastRecordedAt - a.lastRecordedAt),
    unsupportedProviders: connections.filter(item => !item.id).map(item => label(item.provider)),
    recordingWarning: warnings.has(namespace(root)), unreadableRecords, limited,
    remaining: null, providerBillingTotal: null, estimatedCost: null,
  };
}
