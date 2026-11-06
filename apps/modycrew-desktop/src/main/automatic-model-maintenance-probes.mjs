// Synthetic provider protocol checks. No document, mail, file or shell tools are exposed.
const toolName = 'modycrew_probe_echo';
const schema = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false };
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const echo = ({ value }) => value;

export async function probeModelProtocol(context, { model, nonce, mode, signal, fetchFn = globalThis.fetch, timeoutMs = 45_000 }) {
  const { provider, secret, accountId } = context;
  const empty = { provider, model, completed: false, deltaCount: 0 };
  if (!/^MODY_CHECK_[a-f0-9]{20}$/.test(nonce ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,119}$/.test(model ?? '') || !['stream', 'tool_call'].includes(mode)) return empty;
  const tool = mode === 'tool_call';
  const prompt = tool ? `Call ${toolName} exactly once with value "${nonce}". No other action.` : `Return exactly this token and nothing else: ${nonce}`;
  let url, headers, body;
  if (['openai', 'codex_oauth'].includes(provider)) {
    url = provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://chatgpt.com/backend-api/codex/responses';
    headers = { Authorization: `Bearer ${secret}`, ...(provider === 'codex_oauth' ? { originator: 'openclaw', 'User-Agent': 'ModyCrew/desktop', ...(accountId ? { 'ChatGPT-Account-ID': accountId } : {}) } : {}) };
    body = { model, instructions: 'Perform only the requested synthetic connection check.', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], stream: true, store: false,
      ...(provider === 'openai' ? { max_output_tokens: 512 } : {}),
      ...(tool ? { tools: [{ type: 'function', name: toolName, description: 'Echo the supplied synthetic marker without side effects.', parameters: schema, strict: true }], tool_choice: { type: 'function', name: toolName }, parallel_tool_calls: false } : {}) };
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'; headers = { 'x-api-key': secret, 'anthropic-version': '2023-06-01' };
    body = { model, max_tokens: 512, stream: true, messages: [{ role: 'user', content: prompt }],
      ...(tool ? { tools: [{ name: toolName, description: 'Echo the supplied synthetic marker without side effects.', input_schema: schema }], tool_choice: { type: 'auto' } } : {}) };
  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`; headers = { 'x-goog-api-key': secret };
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 512 }, store: false,
      ...(tool ? { tools: [{ functionDeclarations: [{ name: toolName, description: 'Echo a synthetic marker without side effects.', parameters: { type: 'OBJECT', properties: { value: { type: 'STRING' } }, required: ['value'] } }] }], toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolName] } } } : {}) };
  } else return empty;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  let reader;
  try {
    const response = await fetchFn(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
    // Validate the actual wire frames. Some authenticated transports omit or
    // normalize media-type headers; a header alone neither proves nor disproves SSE.
    if (!response.ok || !response.body?.getReader) return { ...empty, httpStatus: response.status, reason: !response.ok ? 'http_rejected' : 'not_sse' };
    reader = response.body.getReader();
    const decoder = new TextDecoder(); const calls = new Map(); const blocks = new Map();
    let buffer = '', wire = '', sawSse = false, text = '', bytes = 0, completed = false, failed = false, deltaCount = 0, reason = 'stream_incomplete', reportedModel;
    const addCall = (id, name, args) => calls.set(id ?? String(calls.size), { name, args: parse(args) });
    const event = data => {
      if (data === '[DONE]') return;
      const item = parse(data); if (!item) { failed = true; return; }
      const returnedModel = item.response?.model ?? item.message?.model ?? item.modelVersion;
      if (returnedModel && returnedModel !== model) { failed = true; reason = 'model_mismatch'; if (/^(gpt-|claude-|gemini-)[a-zA-Z0-9._:-]{1,100}$/.test(returnedModel)) reportedModel = returnedModel; }
      if (item.error || ['error', 'response.failed', 'response.incomplete'].includes(item.type)) { failed = true; reason = 'provider_stream_failed'; }
      if (item.type === 'response.output_text.delta') { text += item.delta ?? ''; deltaCount++; }
      if (item.type === 'response.output_item.done' && item.item?.type === 'function_call') addCall(item.item.call_id ?? item.item.id, item.item.name, item.item.arguments);
      if (item.type === 'response.completed') {
        completed = true;
        for (const part of item.response?.output ?? []) if (part.type === 'function_call') addCall(part.call_id ?? part.id, part.name, part.arguments);
      }
      if (item.type === 'content_block_start') blocks.set(item.index, { ...item.content_block, json: '' });
      if (item.type === 'content_block_delta') {
        if (item.delta?.type === 'text_delta') { text += item.delta.text ?? ''; deltaCount++; }
        if (item.delta?.type === 'input_json_delta' && blocks.has(item.index)) blocks.get(item.index).json += item.delta.partial_json ?? '';
      }
      if (item.type === 'content_block_stop') {
        const block = blocks.get(item.index); if (block?.type === 'tool_use') addCall(block.id, block.name, block.json || block.input);
      }
      if (item.type === 'message_stop') completed = true;
      for (const candidate of item.candidates ?? []) {
        if (candidate.finishReason === 'STOP') completed = true;
        else if (candidate.finishReason) failed = true;
        for (const part of candidate.content?.parts ?? []) {
          if (typeof part.text === 'string' && !part.thought) { text += part.text; deltaCount++; }
          if (part.functionCall) addCall(part.functionCall.id ?? JSON.stringify(part.functionCall), part.functionCall.name, part.functionCall.args);
        }
      }
    };
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > 65_536) throw new Error('probe_response_limit');
      const decoded = decoder.decode(chunk.value, { stream: true }); buffer += decoded; wire += decoded;
      let split;
      while ((split = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, split).trim(); buffer = buffer.slice(split + 1); if (line.startsWith('data:') && line.slice(5).trim()) { sawSse = true; event(line.slice(5).trim()); } }
    }
    const tail = decoder.decode(); buffer += tail; wire += tail;
    if (buffer.trim().startsWith('data:') && buffer.trim().slice(5).trim()) { sawSse = true; event(buffer.trim().slice(5).trim()); }
    if (!sawSse && !tool) return { ...empty, reason: 'not_sse' };
    if (!sawSse && tool && ['openai', 'codex_oauth'].includes(provider)) {
      // A complete function call can be verified in JSON. It never proves streaming.
      const json = parse(wire);
      if (json?.status !== 'completed' || json.error) return { ...empty, reason: 'unexpected_tool' };
      event(JSON.stringify({ type: 'response.completed', response: json }));
    }
    if (!completed || failed || controller.signal.aborted) return { ...empty, reason, ...(reportedModel ? { reportedModel } : {}) };
    if (!tool) return { ...empty, completed: text.trim() === nonce && deltaCount > 0, transport: 'sse', deltaCount, ...(text.trim() === nonce ? { text: nonce } : { reason: 'nonce_mismatch' }) };
    const [call] = [...calls.values()];
    if (calls.size !== 1 || call?.name !== toolName || !call.args || Object.keys(call.args).length !== 1 || call.args.value !== nonce) return { ...empty, reason: 'unexpected_tool' };
    return { provider, model, completed: true, toolName, echo: echo(call.args) };
  } catch { return { ...empty, reason: controller.signal.aborted ? 'timeout' : 'request_failed' }; }
  finally { controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', abort); await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
}
