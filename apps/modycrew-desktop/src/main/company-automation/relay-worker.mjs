// Bundled HTTPS receiver. No account data, provider token, or default secret ships in this file.
// Preserve provider identifiers that exceed JavaScript's integer precision.
export const parseProviderJson = (raw) => JSON.parse(raw, (_key, value, context) => {
  if (typeof value !== 'number' || Number.isSafeInteger(value) || !Number.isInteger(value)) return value;
  if (!/^-?\d+$/u.test(context?.source || '')) throw new Error('Unsupported numeric identifier');
  return context.source;
});
const encoder = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const equal = (a, b) => { if (typeof a !== 'string' || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };
async function hmac(secret, raw) { const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return crypto.subtle.sign('HMAC', key, encoder.encode(raw)); }
export async function verifyRelayWebhook(provider, raw, headers, config) {
  if (!config.PROVIDER_SECRET || config.PROVIDER_SECRET.length < 8) return false;
  if (provider === 'line') { const signature = btoa(String.fromCharCode(...new Uint8Array(await hmac(config.PROVIDER_SECRET, raw)))); return equal(headers.get('x-line-signature'), signature); }
  if (provider === 'whatsapp') return equal(headers.get('x-hub-signature-256'), `sha256=${hex(await hmac(config.PROVIDER_SECRET, raw))}`);
  if (provider === 'zalo') {
    const body = parseProviderJson(raw);
    if (String(body.app_id) !== config.PROVIDER_APP_ID || String(body.recipient?.id) !== config.PROVIDER_ACCOUNT_ID || !Number.isFinite(Number(body.timestamp)) || Math.abs(Date.now() - Number(body.timestamp)) > 48 * 3600000) return false;
    const signature = hex(await crypto.subtle.digest('SHA-256', encoder.encode(`${config.PROVIDER_APP_ID}${raw}${body.timestamp}${config.PROVIDER_SECRET}`)));
    return equal((headers.get('x-zevent-signature') || '').trim().replace(/^mac\s*=\s*/u, ''), signature);
  }
  return false;
}
async function boundedBody(request) {
  if (Number(request.headers.get('content-length')) > 256000) throw new Error('large');
  const reader = request.body?.getReader(); if (!reader) return '';
  const chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 256000) { await reader.cancel(); throw new Error('large'); } chunks.push(value); } } finally { reader.releaseLock(); }
  const joined = new Uint8Array(size); let offset = 0; for (const c of chunks) { joined.set(c, offset); offset += c.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}
const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
export class CompanyRelay {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const url = new URL(request.url); const env = this.env;
    const authenticated = equal(request.headers.get('authorization'), `Bearer ${env.PULL_TOKEN}`);
    try {
      if (url.pathname === '/health' && request.method === 'GET') return authenticated ? json({ ready: true, provider: env.PROVIDER, accountId: env.PROVIDER_ACCOUNT_ID }) : json({}, 401);
      if (url.pathname === '/webhook' && request.method === 'GET' && env.PROVIDER === 'whatsapp') return equal(url.searchParams.get('hub.verify_token'), env.VERIFY_TOKEN) && url.searchParams.get('hub.mode') === 'subscribe' ? new Response(url.searchParams.get('hub.challenge') || '', { headers: { 'cache-control': 'no-store' } }) : json({}, 403);
      if (url.pathname === '/pull' && request.method === 'GET') {
        if (!authenticated) return json({}, 401);
        const events = [...(await this.ctx.storage.list({ prefix: 'event:' })).values()].filter((e) => !e.acknowledged).sort((a, b) => a.receivedAt - b.receivedAt).slice(0, 50);
        return json({ events: events.map(({ id, body }) => ({ id, body })) });
      }
      if (url.pathname === '/ack' && request.method === 'POST') {
        if (!authenticated) return json({}, 401);
        const { ids } = JSON.parse(await boundedBody(request));
        if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => !/^[a-f0-9]{64}$/u.test(id))) return json({}, 400);
        await this.ctx.storage.transaction(async (store) => { for (const id of ids) { const key = `event:${id}`; const event = await store.get(key); if (event) await store.put(key, { id, receivedAt: event.receivedAt, acknowledged: true }); } });
        return json({ ok: true });
      }
      if (url.pathname !== '/webhook' || request.method !== 'POST') return json({}, 404);
      const raw = await boundedBody(request);
      if (!(await verifyRelayWebhook(env.PROVIDER, raw, request.headers, env))) return json({}, 403);
      const body = parseProviderJson(raw);
      const id = hex(await crypto.subtle.digest('SHA-256', encoder.encode(raw)));
      const accepted = await this.ctx.storage.transaction(async (store) => {
        if (await store.get(`event:${id}`)) return true;
        if ((await store.list({ prefix: 'event:', limit: 2000 })).size >= 2000) return false;
        await store.put(`event:${id}`, { id, body, receivedAt: Date.now(), acknowledged: false }); return true;
      });
      if (!accepted) return json({ retry: true }, 503);
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 86400000);
      return json({ ok: true });
    } catch { return json({}, 400); }
  }
  async alarm() {
    const events = await this.ctx.storage.list({ prefix: 'event:' }); let retained = false;
    for (const [key, event] of events) { if (Date.now() - event.receivedAt > (event.acknowledged ? 86400000 : 7 * 86400000)) await this.ctx.storage.delete(key); else retained = true; }
    if (retained) await this.ctx.storage.setAlarm(Date.now() + 86400000);
  }
}
export default { fetch(request, env) { return env.RELAY.get(env.RELAY.idFromName('company-inbox')).fetch(request); } };
