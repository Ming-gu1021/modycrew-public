import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { providerRequest } from './provider-adapters.mjs';

const api = 'https://api.cloudflare.com/client/v4';
async function callCloudflare(endpoint, token, init, options) {
  const response = await providerRequest(`${api}${endpoint}`, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }, options);
  if (!response.success) throw new Error('Cloudflare 계정의 Workers 생성 권한과 사용 한도를 확인해 주세요.');
  return response.result;
}
async function workerBody(connection, credentials, initial = true) {
  const source = await readFile(new URL('./relay-worker.mjs', import.meta.url), 'utf8');
  const bindings = [{ type: 'durable_object_namespace', name: 'RELAY', class_name: 'CompanyRelay' }, ...Object.entries({ PULL_TOKEN: credentials.relayToken, VERIFY_TOKEN: credentials.verifyToken, PROVIDER_SECRET: credentials.appSecret, PROVIDER: connection.provider, PROVIDER_APP_ID: credentials.appId || '', PROVIDER_ACCOUNT_ID: connection.accountId }).map(([name, text]) => ({ type: 'secret_text', name, text }))];
  const body = new FormData(); body.set('metadata', JSON.stringify({ main_module: 'relay.mjs', compatibility_date: '2026-09-01', bindings, ...(initial ? { migrations: { new_tag: 'v1', new_sqlite_classes: ['CompanyRelay'] } } : {}), observability: { enabled: false } })); body.set('relay.mjs', new Blob([source], { type: 'application/javascript+module' }), 'relay.mjs'); return body;
}
export async function provisionCompanyRelay(connection, credentials, input, options = {}) {
  if (input.approved !== true) throw new Error('공개 수신 주소 생성과 해당 클라우드 계정 사용을 승인해 주세요.');
  if (!['line', 'whatsapp', 'zalo'].includes(connection.provider) || !/^[a-f0-9-]{36}$/u.test(connection.id)) throw new Error('웹훅으로 수신하는 계정을 선택해 주세요.');
  if (!/^[a-f0-9]{32}$/u.test(input.cloudAccountId || '') || (input.cloudToken || '').length < 20) throw new Error('Cloudflare 계정 ID와 Workers 권한 토큰을 확인해 주세요.');
  if ((credentials.appSecret || '').length < 8 || connection.provider === 'zalo' && !/^\d+$/u.test(credentials.appId || '')) throw new Error('서비스의 웹훅 검증 키를 먼저 등록해 주세요.');
  if (connection.relayUrl) throw new Error('이미 수신 주소가 있습니다. 기존 연결 상태를 확인해 주세요.');
  const account = input.cloudAccountId; const token = input.cloudToken;
  const prefix = `/accounts/${account}/workers`; const scriptName = `mody-company-${connection.id.replaceAll('-', '')}`;
  const domain = await callCloudflare(`${prefix}/subdomain`, token, {}, options);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(domain.subdomain || '')) throw new Error('Cloudflare Workers 첫 설정에서 workers.dev 주소를 활성화한 다음 다시 시도해 주세요.');
  const relayToken = randomBytes(32).toString('hex'); const verifyToken = randomBytes(24).toString('hex');
  const body = await workerBody(connection, { ...credentials, relayToken, verifyToken });
  const relayUrl = `https://${scriptName}.${domain.subdomain}.workers.dev`;
  // Persist the deployment receipt before network health checks so recovery can reuse it.
  const provisioned = { relayUrl, relayToken, verifyToken, cloudAccountId: account, cloudToken: token, scriptName };
  await options.onProvisioned?.(provisioned);
  await callCloudflare(`${prefix}/scripts/${scriptName}`, token, { method: 'PUT', body }, options);
  await callCloudflare(`${prefix}/scripts/${scriptName}/subdomain`, token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }) }, options);
  return provisioned;
}
export async function checkCompanyRelay(connection, credentials, options = {}) {
  if (!/^https:\/\/mody-company-[a-f0-9]{32}\.[a-z0-9-]+\.workers\.dev$/u.test(connection.relayUrl || '')) throw new Error('앱에서 만든 공개 수신 주소가 아닙니다.');
  if (credentials.cloudToken && /^[a-f0-9]{32}$/u.test(credentials.cloudAccountId || '') && credentials.scriptName === `mody-company-${connection.id.replaceAll('-', '')}`) {
    const scriptPath = `/accounts/${credentials.cloudAccountId}/workers/scripts/${credentials.scriptName}`;
    try { await callCloudflare(`${scriptPath}/settings`, credentials.cloudToken, {}, options); }
    catch (error) { if (error.status !== 404) throw error; await callCloudflare(scriptPath, credentials.cloudToken, { method: 'PUT', body: await workerBody(connection, credentials) }, options); }
    await callCloudflare(`${scriptPath}/subdomain`, credentials.cloudToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }) }, options);
  }
  const health = await providerRequest(`${connection.relayUrl}/health`, { headers: { Authorization: `Bearer ${credentials.relayToken}` } }, options);
  if (!health.ready || health.provider !== connection.provider || health.accountId !== connection.accountId) throw new Error('공개 수신 주소의 계정을 확인하지 못했습니다.');
  if (connection.provider === 'line') {
    await providerRequest('https://api.line.me/v2/bot/channel/webhook/endpoint', { method: 'PUT', headers: { Authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: `${connection.relayUrl}/webhook` }) }, options);
  }
  return true;
}
export async function removeCompanyRelay(connection, credentials, options = {}) {
  if (!credentials.cloudToken || credentials.scriptName !== `mody-company-${connection.id.replaceAll('-', '')}` || !/^[a-f0-9]{32}$/u.test(credentials.cloudAccountId || '')) throw new Error('생성한 수신 주소의 삭제 권한을 확인하지 못했습니다. 연결을 보존했습니다.');
  try { await callCloudflare(`/accounts/${credentials.cloudAccountId}/workers/scripts/${credentials.scriptName}`, credentials.cloudToken, { method: 'DELETE' }, options); } catch (error) { if (error.status !== 404) throw error; }
}
