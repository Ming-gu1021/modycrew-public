import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createAutomaticModelMaintenance } from './automatic-model-maintenance.mjs';

const providers = ['codex_oauth', 'openai', 'anthropic', 'gemini'];
const auto = preference => ['latest', 'fast'].includes(preference);
let senderId = -700_000;

export function modelMaintenanceConnectionKey(record) {
  const identity = record.provider === 'codex_oauth' ? record.accountId : record.keyFingerprint;
  return identity ? JSON.stringify([record.provider, identity, record.keyFingerprint ?? '']) : '';
}

/** Bind to the existing provider handler; never read or decrypt account secrets here. */
export async function createAIProviderModelMaintenance({ app, handleAIProviderMessage, providerOptions = {},
  getRequiredCapabilities, probeToolCall, probeStreaming, isPaused, now, operationTimeoutMs, policyPath,
  processStartedAt }) {
  if (typeof getRequiredCapabilities !== 'function') throw new Error('provider_capabilities_required');
  if (processStartedAt === undefined) {
    await app.whenReady?.();
    processStartedAt = null;
    try {
      // Node uptime begins after native startup. On a busy Windows login that
      // delay exceeds the watchdog's identity tolerance. Use the OS timestamp
      // for this exact process; never invent proof when metrics are unavailable.
      const metric = app.getAppMetrics?.().find(row => row.pid === process.pid);
      if (Number.isFinite(metric?.creationTime) && metric.creationTime > 0 && metric.creationTime <= Date.now()) {
        processStartedAt = new Date(metric.creationTime).toISOString();
      }
    } catch { /* Provider checks still run; missing identity cannot prove uptime. */ }
  }
  const options = { ...providerOptions, app };
  const filePath = path.join(app.getPath('userData'), 'automatic-model-maintenance.json');
  const reviewPath = policyPath ?? path.join(app.getPath('userData'), 'automatic-model-policy.json');
  let service;
  async function readConnections({ signal } = {}) {
    const status = await handleAIProviderMessage(null, { kind: 'status' }, { ...options, abortSignal: signal });
    if (status?.status !== 'ready' || !Array.isArray(status.providers)) throw new Error('connection_status_unavailable');
    return status.providers.filter(p => providers.includes(p.provider)).map(record => {
      const preference = record.modelPreference ?? record.model;
      const identity = record.provider === 'codex_oauth' ? record.accountId : record.keyFingerprint;
      const connection = { provider: record.provider, connectionKey: modelMaintenanceConnectionKey(record),
        preference, currentModel: record.model,
        authorized: Boolean(identity) && record.hasLocalKey === true && (record.provider === 'codex_oauth' || record.chatContentAllowed === true),
        unavailableReason: record.provider !== 'codex_oauth' && record.chatContentAllowed !== true ? 'chat_content_consent_required'
          : !record.hasLocalKey && /^[a-z_]{1,64}$/.test(record.status ?? '') ? record.status : !identity ? 'connection_identity_missing' : 'connection_not_ready',
        active: record.isActive === true || status.activeProvider === record.provider,
        requiredCapabilities: getRequiredCapabilities(record.provider) };
      const verified = auto(preference) ? service?.resolveModel(connection) : preference;
      if (verified) connection.currentModel = verified;
      // Before the first verified auto default, a catalog-derived name is not the active-model proof.
      if (auto(preference) && !verified) connection.active = false;
      return connection;
    });
  }
  async function discoverModels(connection, { signal }) {
    const result = await handleAIProviderMessage(null, { kind: 'list_models', provider: connection.provider, forceRefresh: true }, { ...options, abortSignal: signal });
    let candidates = [];
    try {
      const policy = JSON.parse(await readFile(reviewPath, 'utf8'));
      if (policy.version === 1 && Array.isArray(policy.models)) candidates = policy.models.filter(m => m.provider === connection.provider);
    } catch { /* Missing/unreadable policy allows health checks, never a model upgrade. */ }
    return { ...result?.modelAvailability, candidates };
  }
  async function probe(connection, model, { signal, requiredCapabilities }) {
    const checks = { response: false, stream: false, tool_call: false };
    const diagnostics = {};
    const diagnostic = result => ({ reason: result?.reason ?? (result?.completed ? 'passed' : 'not_completed'),
      ...(Number.isInteger(result?.httpStatus) ? { httpStatus: result.httpStatus } : {}), ...(result?.reportedModel ? { reportedModel: result.reportedModel } : {}) });
    const nonce = `MODY_CHECK_${randomBytes(10).toString('hex')}`;
    const prompt = `Return exactly this one token and nothing else: ${nonce}`;
    const payload = { provider: connection.provider, model, prompt };
    const runOptions = { ...options, abortSignal: signal };
    const plain = await handleAIProviderMessage(null, { kind: 'generate_text', ...payload }, runOptions);
    checks.response = plain?.model === model && plain?.status === 'generate_content_loaded' && plain?.outputText?.trim() === nonce;
    if (!checks.response || signal.aborted) return { provider: connection.provider, model, checks };
    if (requiredCapabilities.includes('stream') && typeof probeStreaming === 'function') {
      const result = await probeStreaming({ provider: connection.provider, model, nonce, signal });
      checks.stream = result?.provider === connection.provider && result?.model === model && result?.transport === 'sse'
        && result?.completed === true && result?.text === nonce && result?.deltaCount > 0;
      diagnostics.stream = diagnostic(result);
    } else if (requiredCapabilities.includes('stream') && connection.provider === 'codex_oauth') {
      // This native route consumes provider SSE. Other UI handlers can synthesize one
      // delta after a non-streaming response; those need an explicit transport probe.
      const sender = new EventEmitter();
      sender.id = senderId--; sender.isDestroyed = () => signal.aborted;
      const chunks = []; const streamId = nonce;
      sender.send = (_channel, data) => { if (data?.streamId === streamId && typeof data.delta === 'string') chunks.push(data.delta); };
      const abort = () => sender.emit('destroyed');
      signal.addEventListener('abort', abort, { once: true });
      try {
        const streamed = await handleAIProviderMessage({ sender }, { kind: 'generate_text_stream', streamId, ...payload }, runOptions);
        checks.stream = !signal.aborted && streamed?.model === model && streamed?.status === 'generate_content_loaded'
          && streamed?.outputText?.trim() === nonce && chunks.length > 0 && chunks.join('').trim() === nonce;
      } finally { signal.removeEventListener('abort', abort); sender.removeAllListeners(); }
    }
    if (!signal.aborted && requiredCapabilities.includes('tool_call') && typeof probeToolCall === 'function') {
      const result = await probeToolCall({ provider: connection.provider, model, nonce, signal, toolName: 'modycrew_probe_echo' });
      checks.tool_call = result?.provider === connection.provider && result?.model === model && result?.toolName === 'modycrew_probe_echo' && result?.echo === nonce;
      diagnostics.tool_call = diagnostic(result);
    }
    return { provider: connection.provider, model, checks, diagnostics };
  }
  service = await createAutomaticModelMaintenance({ filePath, readConnections, discoverModels, probe, isPaused, now, operationTimeoutMs,
    runtime: { source: app.isPackaged === true ? 'installed-app' : 'development', appVersion: app.getVersion(), processStartedAt } });
  return { ...service, readConnections };
}
