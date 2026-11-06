import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';

const HOUR = 60 * 60 * 1000;
const capabilities = ['response', 'stream', 'tool_call'];
const automatic = value => ['latest', 'fast'].includes(value);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value);
const keyOf = c => createHash('sha256').update(JSON.stringify([c.provider, c.connectionKey])).digest('hex');
const authorized = c => validId(c.provider) && typeof c.connectionKey === 'string' && c.connectionKey.length > 0 && c.authorized === true;
const requirements = c => [...new Set(['response', ...(c.requiredCapabilities ?? [])])];
const clone = value => structuredClone(value);
function validChecks(result, c, model) {
  return result?.model === model && result?.provider === c.provider && requirements(c).every(cap => capabilities.includes(cap) && result?.checks?.[cap] === true);
}
function officialPolicy(provider, candidate, now) {
  const allowed = provider === 'codex_oauth' || provider === 'openai' ? ['developers.openai.com', 'platform.openai.com', 'openai.com']
    : provider === 'anthropic' ? ['platform.claude.com', 'docs.anthropic.com', 'anthropic.com']
    : provider === 'gemini' ? ['ai.google.dev', 'cloud.google.com'] : [];
  try {
    const url = new URL(candidate.officialSource);
    const reviewed = Date.parse(candidate.reviewedAt);
    return url.protocol === 'https:' && allowed.includes(url.hostname) && !url.username && !url.password
      && reviewed <= now && now - reviewed <= 7 * 24 * HOUR && candidate.roleCompatible === true && candidate.costCompatible === true && candidate.permissionCompatible === true;
  } catch { return false; }
}

/**
 * Adapter probes use the app's existing authenticated route, with synthetic inputs only.
 * No vault/model preference is written here. The app resolves latest/fast through
 * resolveModel(); explicit user model IDs are returned unchanged.
 * One instance per Electron main process; app.requestSingleInstanceLock owns cross-process exclusion.
 */
export async function createAutomaticModelMaintenance({ filePath, readConnections, discoverModels, probe, now = Date.now,
  runtime = {}, intervalMs = HOUR, operationTimeoutMs = 120_000, isPaused = () => false, onStatus = () => {} }) {
  if (!(intervalMs >= HOUR)) throw new Error('maintenance_interval_too_short');
  let state = { version: 1, providers: {}, healthProbes: [], lastCheckedAt: null, nextCheckAt: null };
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (parsed.version !== 1 || !parsed.providers || !Array.isArray(parsed.healthProbes)) throw new Error('invalid_maintenance_state');
    state = parsed;
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('maintenance_state_unreadable'); }
  let pending, timer, stopped = false;
  async function bounded(fn) {
    const controller = new AbortController();
    let timeout;
    try {
      return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), new Promise((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('maintenance_operation_timeout')); }, operationTimeoutMs);
      })]);
    } finally { clearTimeout(timeout); }
  }
  async function persist(next) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try { await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 }); await rename(tmp, filePath); }
    finally { await unlink(tmp).catch(() => {}); }
    state = next;
  }
  function resolveModel(connection, preference = connection.preference) {
    if (!automatic(preference)) return preference;
    if (!authorized(connection)) return null;
    const saved = state.providers[keyOf(connection)];
    return saved?.preference === preference && validId(saved.verifiedModel) ? saved.verifiedModel : null;
  }
  async function checkCurrent(connection) {
    const current = (await bounded(signal => readConnections({ signal }))).find(c => c.provider === connection.provider && c.connectionKey === connection.connectionKey);
    return current && authorized(current) && current.preference === connection.preference && current.currentModel === connection.currentModel
      && JSON.stringify(requirements(current)) === JSON.stringify(requirements(connection)) && !await isPaused() && !stopped;
  }
  async function runOnce({ force = false } = {}) {
    const time = now();
    if (stopped || await isPaused()) return { status: 'paused' };
    const due = Date.parse(state.nextCheckAt);
    if (!force && Number.isFinite(due) && due > time && due - time <= intervalMs) return { status: 'not_due' };
    const next = clone(state);
    const checkedAt = new Date(time).toISOString();
    next.lastCheckedAt = checkedAt;
    next.nextCheckAt = new Date(time + intervalMs).toISOString();
    let connections;
    try { connections = await bounded(signal => readConnections({ signal })); }
    catch { next.lastStatus = 'connection_check_failed'; await persist(next); return { status: next.lastStatus }; }
    for (const connection of connections.filter(c => validId(c.provider) && !authorized(c))) {
      next.providers[keyOf(connection)] = { provider: connection.provider, preference: connection.preference, checkedAt,
        status: 'connection_not_ready', reason: /^[a-z_]{1,64}$/.test(connection.unavailableReason ?? '') ? connection.unavailableReason : 'connection_or_consent_required' };
    }
    // Update enabled connections only; never create accounts, consent, subscriptions or credentials.
    for (const connection of clone(connections).filter(authorized)) {
      if (stopped || await isPaused()) break;
      const key = keyOf(connection);
      const previous = next.providers[key] ?? {};
      const row = { ...previous, provider: connection.provider, preference: connection.preference, checkedAt, status: 'checking' };
      // A newly changed alias cannot reuse proof from a different tier.
      if (previous.preference !== connection.preference) { delete row.verifiedModel; delete row.verifiedAt; }
      next.providers[key] = row;
      let catalog;
      try { catalog = await bounded(signal => discoverModels(clone(connection), { signal })); }
      catch { row.status = 'catalog_check_failed'; continue; }
      const models = Array.isArray(catalog?.models) ? catalog.models.filter(m => validId(m.id) && m.availability === 'available') : [];
      row.availableModels = [...new Set(models.map(m => m.id))].slice(0, 2000);
      if (catalog?.state !== 'available') { row.status = 'catalog_unavailable'; continue; }
      let target = connection.currentModel;
      let purpose = 'health';
      if (automatic(connection.preference)) {
        const candidate = (catalog.candidates ?? []).find(c => validId(c.id) && c.preference === connection.preference
          && row.availableModels.includes(c.id) && officialPolicy(connection.provider, c, time));
        if (candidate) { target = candidate.id; purpose = 'candidate'; }
        else { purpose = 'baseline'; row.status = 'official_compatible_candidate_required'; }
      } else { row.status = 'manual_model_preserved'; }
      if (!validId(target) || !row.availableModels.includes(target)) { row.status = 'selected_model_unavailable'; continue; }
      // Probe only the user's active connection, or an automatic candidate that actually needs validation.
      const shouldProbe = purpose === 'candidate' || purpose === 'baseline' || connection.active === true;
      if (!shouldProbe) continue;
      let result;
      try { result = await bounded(signal => probe(clone(connection), target, { requiredCapabilities: requirements(connection), purpose, signal })); }
      catch { result = null; }
      const succeeded = validChecks(result, connection, target);
      let unchanged = false;
      try { unchanged = await checkCurrent(connection); } catch {}
      if (!unchanged) { row.status = 'connection_changed'; continue; }
      const proof = { checkedAt: new Date(now()).toISOString(), provider: connection.provider, connectionHash: key, model: target, success: succeeded,
        purpose, source: runtime.source === 'installed-app' ? 'installed-app' : 'development', appVersion: String(runtime.appVersion ?? '').slice(0, 40),
        processStartedAt: runtime.processStartedAt ?? null, requiredCapabilities: requirements(connection),
        checks: Object.fromEntries(capabilities.map(cap => [cap, result?.checks?.[cap] === true])) };
      proof.diagnostics = Object.fromEntries(['stream', 'tool_call'].flatMap(cap => {
        const detail = result?.diagnostics?.[cap];
        if (!detail || !['passed','not_completed','http_rejected','not_sse','stream_incomplete','model_mismatch','provider_stream_failed','nonce_mismatch','unexpected_tool','timeout','request_failed'].includes(detail.reason)) return [];
        return [[cap, { reason: detail.reason, ...(Number.isInteger(detail.httpStatus) && detail.httpStatus >= 100 && detail.httpStatus <= 599 ? { httpStatus: detail.httpStatus } : {}),
          ...(/^(gpt-|claude-|gemini-)[a-zA-Z0-9._:-]{1,100}$/.test(detail.reportedModel ?? '') ? { reportedModel: detail.reportedModel } : {}) }]];
      }));
      row.lastProbe = proof;
      // Only periodic probes of the active selected model count toward ongoing workload evidence.
      if (connection.active === true && target === connection.currentModel) next.healthProbes.push({ ...proof, purpose: 'health' });
      if (!succeeded) { row.status = 'probe_failed_previous_preserved'; continue; }
      if (purpose === 'candidate' || purpose === 'baseline') {
        row.previousVerifiedModel = previous.verifiedModel ?? null;
        row.verifiedModel = target;
        row.verifiedAt = proof.checkedAt;
        row.verificationKind = purpose;
        row.status = purpose === 'baseline' ? 'automatic_baseline_verified_candidate_pending'
          : previous.verifiedModel === target ? 'automatic_model_verified' : 'automatic_model_updated';
      }
      else row.status = 'manual_model_healthy';
    }
    next.healthProbes = next.healthProbes.slice(-600);
    next.lastStatus = 'checked';
    // Persist before activating in memory. Disk errors leave the prior resolved defaults intact.
    await persist(next);
    try { onStatus(clone(next)); } catch { /* Reporting cannot invalidate a durable result. */ }
    return { status: 'checked', updated: Object.values(next.providers).filter(r => r.checkedAt === checkedAt && r.status === 'automatic_model_updated').length };
  }
  function check(options) {
    if (!pending) pending = runOnce(options).finally(() => { pending = undefined; });
    return pending;
  }
  function start() {
    stopped = false;
    if (!timer) { timer = setInterval(() => { void check().catch(() => {}); }, 60_000); timer.unref?.(); }
    return check();
  }
  function stop() { stopped = true; clearInterval(timer); timer = undefined; }
  return { check, start, stop, resolveModel, getStatus: () => clone(state) };
}
