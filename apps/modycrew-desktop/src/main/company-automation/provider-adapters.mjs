import { parseProviderJson } from './relay-worker.mjs';
import { clean } from './company-records.mjs';

export async function providerRequest(url, init = {}, options = {}) {
  try {
    const response = await (options.fetch || fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (response.status === 429) { const error = new Error('요청 한도에 도달했습니다. 잠시 후 자동으로 다시 확인합니다.'); error.retryAfter = Math.max(60, Math.min(3600, Number(response.headers.get('retry-after')) || 60)); throw error; }
    if (!response.ok) { const error = new Error(response.status === 401 || response.status === 403 ? '계정 인증이나 채널 접근 권한을 다시 확인해 주세요.' : '서비스에서 요청을 처리하지 못했습니다. 연결 상태를 확인해 주세요.'); error.status = response.status; throw error; }
    if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('서비스 응답이 너무 큽니다.');
    const reader = response.body?.getReader(); const chunks = []; let length = 0;
    if (reader) { try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2_000_000) { await reader.cancel(); throw new Error('서비스 응답이 너무 큽니다.'); } chunks.push(value); } } finally { reader.releaseLock(); } }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw = new TextDecoder().decode(bytes); return raw.trim() ? parseProviderJson(raw) : {};
  } catch (error) {
    if (error.retryAfter || error.status) throw error;
    // Never echo URLs, request headers, tokens, or provider-controlled error bodies.
    throw new Error(/^(계정 인증|서비스에서|서비스 응답)/u.test(error.message || '') ? error.message : '서비스 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}
export const telegramCall = (token, method, data = {}, options = {}) => {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/u.test(token)) throw new Error('Telegram 봇 토큰 형식을 확인해 주세요.');
  if (!['getMe', 'getWebhookInfo', 'getUpdates', 'getChat', 'getChatMember', 'getManagedBotToken'].includes(method)) throw new Error('지원하지 않는 Telegram 요청입니다.');
  return providerRequest(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }, options).then((r) => { if (!r.ok) throw new Error('Telegram 권한이나 봇 설정을 확인해 주세요.'); return r.result; });
};
const snowflake = (s) => /^\d{6,25}$/u.test(String(s));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const discordHeaders = (token) => ({ Authorization: `Bot ${token}` });
export async function verifyProvider(config, options = {}) {
  const token = clean(config.token, 8192); if (token.length < 8) throw new Error('인증 정보를 입력해 주세요.');
  if (config.provider === 'telegram') {
    const bot = await telegramCall(token, 'getMe', {}, options);
    const webhook = await telegramCall(token, 'getWebhookInfo', {}, options);
    if (webhook.url) throw new Error('이 봇은 다른 웹훅에 연결되어 있습니다. 전용 봇을 생성하거나 기존 수신 연결을 먼저 정리해 주세요.');
    return { accountId: String(bot.id), name: clean(bot.first_name), username: clean(bot.username), privacy: !bot.can_read_all_group_messages };
  }
  if (config.provider === 'discord') {
    const bot = await providerRequest('https://discord.com/api/v10/users/@me', { headers: discordHeaders(token) }, options);
    if (!bot.bot || !snowflake(bot.id)) throw new Error('개인 계정 토큰은 연결하지 않습니다. Discord 봇 토큰을 사용해 주세요.');
    return { accountId: bot.id, name: clean(bot.username) };
  }
  if (config.provider === 'slack') {
    const bot = await providerRequest('https://slack.com/api/auth.test', { headers: bearer(token) }, options);
    if (!bot.ok || !bot.bot_id) throw new Error('Slack 봇 토큰과 워크스페이스 설치를 확인해 주세요.');
    return { accountId: bot.user_id, name: clean(bot.team), teamId: bot.team_id };
  }
  if (config.provider === 'line') {
    const bot = await providerRequest('https://api.line.me/v2/bot/info', { headers: bearer(token) }, options);
    if (!bot.userId) throw new Error('LINE Messaging API 채널을 확인해 주세요.');
    let webhook; try { webhook = await providerRequest('https://api.line.me/v2/bot/channel/webhook/endpoint', { headers: bearer(token) }, options); } catch (error) { if (error.status !== 404) throw error; }
    if (webhook?.endpoint) throw new Error('이 LINE 채널은 기존 웹훅에 연결되어 있습니다. 전용 채널을 사용하거나 기존 수신 연결을 먼저 확인해 주세요.');
    return { accountId: bot.userId, name: clean(bot.displayName) };
  }
  if (config.provider === 'whatsapp') {
    if (!snowflake(config.accountId)) throw new Error('WhatsApp Business 전화번호 ID를 확인해 주세요.');
    if (!/^v\d{2}\.0$/u.test(config.apiVersion || '')) throw new Error('Meta 앱에 표시된 Graph API 버전(v숫자.0)을 입력해 주세요.');
    const bot = await providerRequest(`https://graph.facebook.com/${config.apiVersion}/${config.accountId}?fields=id,verified_name,display_phone_number`, { headers: bearer(token) }, options);
    if (bot.id !== config.accountId) throw new Error('WhatsApp Business 번호를 확인하지 못했습니다.');
    return { accountId: bot.id, name: clean(bot.verified_name || bot.display_phone_number) };
  }
  if (config.provider === 'zalo') {
    const bot = await providerRequest('https://openapi.zalo.me/v2.0/oa/getoa', { headers: { access_token: token } }, options);
    if (bot.error !== 0 || !bot.data?.oa_id) throw new Error('Zalo Official Account 권한 또는 토큰 만료를 확인해 주세요.');
    return { accountId: String(bot.data.oa_id), name: clean(bot.data.name) };
  }
  throw new Error('이 서비스는 공식 연결 화면에서 설정해 주세요.');
}
export async function readProviderMessages(connection, secrets, options = {}) {
  const token = secrets.token; const cursors = { ...connection.cursors }; const messages = []; const channels = [];
  const allowed = new Set(connection.channelIds || []);
  const add = (id, roomId, text, sender, timestamp, bot = false) => {
    if (!id || !roomId || !clean(text) || bot || !allowed.has(String(roomId))) return;
    messages.push({ id: String(id), roomId: String(roomId), text: clean(text, 12000), sender: clean(sender, 180), timestamp, provider: connection.provider, connectionId: connection.id });
  };
  if (connection.provider === 'telegram') {
    const updates = await telegramCall(token, 'getUpdates', { offset: Number(cursors.offset || 0), limit: 100, timeout: 0, allowed_updates: ['message', 'channel_post', 'my_chat_member', 'managed_bot'] }, options);
    for (const update of updates) {
      cursors.offset = Math.max(Number(cursors.offset || 0), update.update_id + 1);
      const message = update.message || update.channel_post; const chat = message?.chat || update.my_chat_member?.chat;
      if (chat) channels.push({ id: String(chat.id), name: clean(chat.title || chat.first_name || chat.username) });
      if (message) add(message.message_id, message.chat.id, message.text || message.caption, message.from?.first_name, new Date(message.date * 1000).toISOString(), message.from?.is_bot);
    }
  } else if (connection.provider === 'discord') {
    for (const channel of allowed) {
      if (!snowflake(channel)) throw new Error('Discord 채널 ID를 확인해 주세요.');
      const info = await providerRequest(`https://discord.com/api/v10/channels/${channel}`, { headers: discordHeaders(token) }, options);
      channels.push({ id: channel, name: clean(info.name) });
      const after = snowflake(cursors[channel]) ? `&after=${cursors[channel]}` : '';
      const rows = await providerRequest(`https://discord.com/api/v10/channels/${channel}/messages?limit=100${after}`, { headers: discordHeaders(token) }, options);
      if (!Array.isArray(rows)) throw new Error('Discord 채널의 메시지를 읽지 못했습니다.');
      for (const row of rows.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)) {
        if (!cursors[channel] || BigInt(row.id) > BigInt(cursors[channel])) cursors[channel] = row.id;
        if (row.content === '' && !row.author?.bot && !row.attachments?.length && !row.embeds?.length) throw new Error('Discord 본문이 비어 있습니다. Message Content Intent를 확인해 주세요.');
        add(row.id, channel, row.content, row.author?.username, row.timestamp, row.author?.bot);
      }
    }
  } else if (connection.provider === 'slack') {
    for (const channel of allowed) {
      if (!/^[CGD][A-Z0-9]{5,30}$/u.test(channel)) throw new Error('Slack 채널 ID를 확인해 주세요.');
      const query = new URLSearchParams({ channel, limit: '15', oldest: String(cursors[channel] || '0') });
      if (cursors[`page:${channel}`]) query.set('cursor', cursors[`page:${channel}`]);
      const rows = await providerRequest(`https://slack.com/api/conversations.history?${query}`, { headers: bearer(token) }, options);
      if (!rows.ok) throw new Error('Slack history 권한과 채널 초대를 확인해 주세요.');
      // Keep the old watermark until every page is drained. Poll at most once a minute.
      for (const row of [...rows.messages].reverse()) { add(row.ts, channel, row.text, row.user, new Date(Number(row.ts) * 1000).toISOString(), Boolean(row.bot_id)); if (Number(row.ts) > Number(cursors[`high:${channel}`] || cursors[channel] || 0)) cursors[`high:${channel}`] = row.ts; }
      if (rows.has_more) { if (!rows.response_metadata?.next_cursor) throw new Error('Slack의 다음 메시지 페이지를 확인하지 못했습니다.'); cursors[`page:${channel}`] = rows.response_metadata.next_cursor; }
      else { if (cursors[`high:${channel}`]) cursors[channel] = cursors[`high:${channel}`]; delete cursors[`page:${channel}`]; delete cursors[`high:${channel}`]; }
    }
  } else throw new Error('공개 HTTPS 수신 연결을 먼저 설정해 주세요.');
  return { messages, cursors, channels };
}

export async function discoverProviderChannels(connection, secrets, options = {}) {
  if (connection.provider === 'telegram') return (await readProviderMessages({ ...connection, channelIds: [] }, secrets, options)).channels;
  if (connection.provider === 'discord') {
    const guilds = await providerRequest('https://discord.com/api/v10/users/@me/guilds', { headers: discordHeaders(secrets.token) }, options); const channels = [];
    for (const guild of guilds.slice(0, 10)) { if (!snowflake(guild.id)) continue; const rooms = await providerRequest(`https://discord.com/api/v10/guilds/${guild.id}/channels`, { headers: discordHeaders(secrets.token) }, options); for (const room of rooms) if ([0, 5, 11, 12].includes(room.type)) channels.push({ id: room.id, name: clean(`${guild.name} / ${room.name}`, 180) }); }
    return channels.slice(0, 100);
  }
  if (connection.provider === 'slack') {
    const rooms = await providerRequest('https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=100', { headers: bearer(secrets.token) }, options);
    if (!rooms.ok) throw new Error('Slack 채널 목록 읽기 권한을 확인해 주세요. 직접 채널 ID를 입력할 수도 있습니다.');
    return rooms.channels.filter((r) => r.is_member).map((r) => ({ id: r.id, name: clean(r.name, 180) }));
  }
  if (connection.relayUrl) { const delivery = await providerRequest(`${connection.relayUrl}/pull`, { headers: bearer(secrets.relayToken) }, options); return [...new Set((delivery.events || []).flatMap((event) => normalizeWebhook(connection.provider, event.body, connection)).map((m) => m.roomId))].map((id) => ({ id, name: `메시지를 보낸 대화 ${id}` })); }
  throw new Error('수신 주소를 준비한 후 업무방에서 새 메시지를 보내 주세요.');
}

export function normalizeWebhook(provider, body, connection) {
  const timestamp = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ''; };
  const output = []; const add = (id, roomId, text, sender, timestamp) => { if (id && roomId && typeof text === 'string' && text.trim() && timestamp) output.push({ id: String(id), roomId: String(roomId), text: clean(text, 12000), sender: clean(String(sender || ''), 180), timestamp, provider, connectionId: connection.id }); };
  if (provider === 'line' && body.destination === connection.accountId) for (const event of body.events || []) if (event.type === 'message' && event.message?.type === 'text') add(event.webhookEventId || event.message.id, event.source?.groupId || event.source?.roomId || event.source?.userId, event.message.text, event.source?.userId, timestamp(event.timestamp));
  if (provider === 'whatsapp') for (const entry of body.entry || []) for (const change of entry.changes || []) if (change.value?.metadata?.phone_number_id === connection.accountId) for (const message of change.value.messages || []) if (message.type === 'text') add(message.id, message.from, message.text?.body, message.from, timestamp(Number(message.timestamp) * 1000));
  if (provider === 'zalo' && body.event_name === 'user_send_text' && String(body.recipient?.id) === connection.accountId) add(body.message?.msg_id, body.group_id || body.sender?.id, body.message?.text, body.sender?.id, timestamp(Number(body.timestamp)));
  return output;
}
