import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import {
  normalizeTriggerWebhookPayload,
  sanitizeWebhookText,
  triggerWebhookAdapterCatalog,
} from "./trigger-webhook-adapters.mjs";
import { handleTriggerRunnerMessage } from "./trigger-runner-handler.mjs";

const stateFileName = "trigger-webhook-state.json";
const host = "127.0.0.1";
const endpointPrefix = "/mody/trigger/";
const maxBodyBytes = 64 * 1024;

let activeServer = null;
let activeServerMeta = null;

export async function handleTriggerWebhookMessage(_event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");

  if (kind === "status") {
    return getTriggerWebhookStatus(options);
  }

  if (kind === "start") {
    return startTriggerWebhookServer(options, payload);
  }

  if (kind === "stop") {
    return stopTriggerWebhookServer(options);
  }

  if (kind === "reset_endpoint") {
    return resetTriggerWebhookEndpoint(options, payload);
  }

  throw new Error(`unsupported trigger-webhook kind: ${kind}`);
}

export async function stopActiveTriggerWebhookServer() {
  if (!activeServer) return;
  const server = activeServer;
  activeServer = null;
  activeServerMeta = null;
  await closeServer(server);
}

async function getTriggerWebhookStatus(options) {
  const state = await readState(options);
  const running = Boolean(activeServer && activeServerMeta);
  return shapeStatusResponse(state, {
    running,
    port: running ? activeServerMeta.port : state.port,
    userMessage: running
      ? "이 PC에서 로컬 webhook 수신이 켜져 있습니다."
      : "로컬 webhook 수신은 꺼져 있습니다.",
  });
}

async function startTriggerWebhookServer(options, payload = {}) {
  const state = await ensureState(options);
  if (activeServer && activeServerMeta) {
    return shapeStatusResponse(state, {
      running: true,
      port: activeServerMeta.port,
      userMessage: "이미 이 PC에서 로컬 webhook 수신 중입니다.",
    });
  }

  const requestedPort = normalizePort(payload.port ?? state.port ?? 0);
  const listenResult = await listenOnAvailablePort(requestedPort, state.endpointId, options);
  activeServer = listenResult.server;
  activeServerMeta = {
    port: listenResult.port,
    endpointId: state.endpointId,
  };

  const now = nowIso(options);
  const nextState = {
    ...state,
    enabled: true,
    host,
    port: listenResult.port,
    lastStartedAt: now,
    updatedAt: now,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  await writeState(options, nextState);

  return shapeStatusResponse(nextState, {
    running: true,
    port: listenResult.port,
    userMessage: "로컬 webhook 수신을 시작했습니다. 외부 공개 서버가 아니라 이 PC에서만 받습니다.",
  });
}

async function stopTriggerWebhookServer(options) {
  await stopActiveTriggerWebhookServer();
  const state = await readState(options);
  const nextState = {
    ...state,
    enabled: false,
    updatedAt: nowIso(options),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  await writeState(options, nextState);
  return shapeStatusResponse(nextState, {
    running: false,
    port: nextState.port,
    userMessage: "로컬 webhook 수신을 껐습니다.",
  });
}

async function resetTriggerWebhookEndpoint(options, payload = {}) {
  await stopActiveTriggerWebhookServer();
  const previous = await readState(options);
  const now = nowIso(options);
  const nextState = {
    ...createDefaultState(now),
    port: normalizePort(payload.port ?? previous.port ?? 0),
    endpointId: createEndpointId(),
    acceptedEventCount: Number(previous.acceptedEventCount ?? 0),
    rejectedRequestCount: Number(previous.rejectedRequestCount ?? 0),
    updatedAt: now,
  };
  await writeState(options, nextState);

  if (payload.start === false) {
    return shapeStatusResponse(nextState, {
      running: false,
      port: nextState.port,
      userMessage: "로컬 webhook 주소를 새로 만들었습니다. 수신은 아직 꺼져 있습니다.",
    });
  }

  return startTriggerWebhookServer(options, { port: nextState.port });
}

async function listenOnAvailablePort(requestedPort, endpointId, options) {
  try {
    return await listen(createServer(endpointId, options), requestedPort);
  } catch (error) {
    if (requestedPort !== 0 && error?.code === "EADDRINUSE") {
      return listen(createServer(endpointId, options), 0);
    }
    throw error;
  }
}

function createServer(endpointId, options) {
  const expectedPath = `${endpointPrefix}${endpointId}`;
  return http.createServer((request, response) => {
    void handleHttpRequest(request, response, {
      ...options,
      expectedPath,
      endpointId,
    }).catch((error) => {
      respondJson(response, 500, {
        status: "trigger_webhook_error",
        userMessage: "로컬 webhook 이벤트를 처리하지 못했습니다.",
        errorMessage: sanitizeText(error?.message ?? error),
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      });
    });
  });
}

async function handleHttpRequest(request, response, options) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    await incrementRejectedRequest(options, "non_loopback_request");
    respondJson(response, 403, safeHttpResponse("trigger_webhook_forbidden", "이 PC 내부 요청만 받을 수 있습니다."));
    return;
  }

  const requestUrl = new URL(request.url ?? "/", `http://${host}`);
  if (requestUrl.pathname !== options.expectedPath) {
    await incrementRejectedRequest(options, "wrong_endpoint");
    respondJson(response, 404, safeHttpResponse("trigger_webhook_not_found", "등록된 로컬 webhook 주소가 아닙니다."));
    return;
  }

  if (request.method === "GET") {
    const state = await readState(options);
    respondJson(response, 200, {
      status: "trigger_webhook_ready",
      running: true,
      endpointPath: options.expectedPath,
      supportedAdapters: triggerWebhookAdapterCatalog,
      acceptedEventCount: Number(state.acceptedEventCount ?? 0),
      rejectedRequestCount: Number(state.rejectedRequestCount ?? 0),
      userMessage: "로컬 webhook 수신 준비가 되어 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
    return;
  }

  if (request.method !== "POST") {
    await incrementRejectedRequest(options, "unsupported_method");
    respondJson(response, 405, safeHttpResponse("trigger_webhook_method_not_allowed", "POST 이벤트만 받을 수 있습니다."));
    return;
  }

  const now = nowIso(options);
  const adapterHint = firstHeader(request.headers["x-mody-adapter"]) ?? requestUrl.searchParams.get("adapter");
  const bodyResult = await readRequestBody(request);
  const body = bodyResult.body;
  const slackSignature = verifySlackRequestIfNeeded({
    adapterHint,
    body,
    rawBody: bodyResult.rawBody,
    headers: request.headers,
    now,
    options,
  });
  if (!slackSignature.accepted) {
    await incrementRejectedRequest(options, slackSignature.status);
    respondJson(response, slackSignature.statusCode, safeHttpResponse(slackSignature.status, slackSignature.userMessage));
    return;
  }
  const normalized = normalizeTriggerWebhookPayload(body, {
    now,
    adapterHint,
    sourceHint: firstHeader(request.headers["x-mody-source"]) ?? requestUrl.searchParams.get("source"),
    eventIdHint: firstHeader(request.headers["x-mody-event-id"]) ?? requestUrl.searchParams.get("eventId"),
  });
  const event = normalized.event;
  const dispatchResult = await handleTriggerRunnerMessage(
    null,
    { kind: "dispatch_event", event },
    options,
  );
  const state = await readState(options);
  const nextState = {
    ...state,
    enabled: true,
    host,
    port: activeServerMeta?.port ?? state.port,
    acceptedEventCount: Number(state.acceptedEventCount ?? 0) + 1,
    lastEventAt: now,
    lastAdapterId: sanitizeText(normalized.adapter.id),
    lastConnectorId: sanitizeText(event.connectorId),
    lastDispatchStatus: sanitizeText(dispatchResult.status),
    lastDispatchUserMessage: sanitizeText(dispatchResult.userMessage),
    lastSignatureStatus: sanitizeText(slackSignature.status),
    updatedAt: now,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  await writeState(options, nextState);

  respondJson(response, 202, {
    status: "trigger_webhook_event_accepted",
    adapterId: normalized.adapter.id,
    connectorId: event.connectorId,
    dispatchStatus: dispatchResult.status,
    queuedWorkItemsCount: Number(dispatchResult.report?.queuedWorkItemsCount ?? 0),
    signatureStatus: slackSignature.status,
    userMessage: dispatchResult.userMessage ?? "로컬 webhook 이벤트를 자동 작동으로 넘겼습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  });
}

async function incrementRejectedRequest(options, reason) {
  const state = await readState(options);
  await writeState(options, {
    ...state,
    rejectedRequestCount: Number(state.rejectedRequestCount ?? 0) + 1,
    lastRejectedReason: sanitizeText(reason),
    updatedAt: nowIso(options),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  });
}

async function readRequestBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new Error("로컬 webhook 이벤트 본문이 너무 큽니다.");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return { body: {}, rawBody: "", contentType: firstHeader(request.headers["content-type"]) ?? "" };
  const contentType = firstHeader(request.headers["content-type"]) ?? "";
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    return { body: Object.fromEntries(new URLSearchParams(raw)), rawBody: raw, contentType };
  }
  try {
    return { body: JSON.parse(raw), rawBody: raw, contentType };
  } catch {
    throw new Error("로컬 webhook 이벤트 JSON을 읽지 못했습니다.");
  }
}

function verifySlackRequestIfNeeded(input) {
  if (!looksLikeSlackRequest(input.adapterHint, input.body)) {
    return {
      accepted: true,
      status: "signature_not_required",
      statusCode: 202,
      userMessage: "서명 검증이 필요 없는 로컬 webhook 요청입니다.",
    };
  }

  const signingSecret = slackSigningSecretFor(input.options);
  if (!signingSecret) {
    return {
      accepted: false,
      status: "slack_signature_secret_required",
      statusCode: 428,
      userMessage: "Slack slash command를 받으려면 Slack signing secret을 먼저 저장해야 합니다.",
    };
  }

  const timestamp = firstHeader(input.headers["x-slack-request-timestamp"]);
  const signature = firstHeader(input.headers["x-slack-signature"]);
  if (!timestamp || !signature) {
    return {
      accepted: false,
      status: "slack_signature_missing",
      statusCode: 401,
      userMessage: "Slack 요청 서명이 없어 이벤트를 거절했습니다.",
    };
  }

  const ageSeconds = Math.abs((new Date(input.now).getTime() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) {
    return {
      accepted: false,
      status: "slack_signature_timestamp_stale",
      statusCode: 401,
      userMessage: "Slack 요청 시간이 너무 오래되어 이벤트를 거절했습니다.",
    };
  }

  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${input.rawBody}`)
    .digest("hex")}`;
  const accepted = timingSafeStringEqual(signature, expected);
  return {
    accepted,
    status: accepted ? "slack_signature_verified" : "slack_signature_invalid",
    statusCode: accepted ? 202 : 401,
    userMessage: accepted
      ? "Slack 요청 서명을 확인했습니다."
      : "Slack 요청 서명이 맞지 않아 이벤트를 거절했습니다.",
  };
}

function looksLikeSlackRequest(adapterHint, body = {}) {
  const adapter = String(adapterHint ?? "").toLowerCase();
  if (adapter.includes("slack")) return true;
  // detectAdapterId 와 동일한 기준: trigger_id / team_id 는 Slack 고유 신호이며,
  // command 만 있는 일반 웹훅을 Slack 으로 오인해 서명 검증으로 거절하지 않도록
  // command 는 Slack 고유 필드와 함께 있을 때만 Slack 으로 판단합니다.
  return Boolean(
    body.trigger_id ||
      body.team_id ||
      (body.command && (body.response_url || body.api_app_id || body.token)),
  );
}

function slackSigningSecretFor(options = {}) {
  const secret = String(options.slackSigningSecret ?? process.env.MODYCREW_SLACK_SIGNING_SECRET ?? "").trim();
  return secret.length >= 8 ? secret : "";
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function ensureState(options) {
  const state = await readState(options);
  if (state.endpointId) return state;
  const now = nowIso(options);
  const nextState = {
    ...createDefaultState(now),
    ...state,
    endpointId: createEndpointId(),
    updatedAt: now,
  };
  await writeState(options, nextState);
  return nextState;
}

async function readState(options) {
  const filePath = statePath(options);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return sanitizeState(parsed);
    }
  } catch {
    // Missing or invalid state starts clean. No credential material is stored here.
  }
  return createDefaultState(nowIso(options));
}

async function writeState(options, state) {
  const filePath = statePath(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(sanitizeState(state), null, 2)}\n`, "utf8");
}

function sanitizeState(value) {
  const now = sanitizeText(value.updatedAt ?? "");
  return {
    version: 1,
    enabled: Boolean(value.enabled),
    host,
    port: normalizePort(value.port ?? 0),
    endpointId: sanitizeEndpointId(value.endpointId),
    acceptedEventCount: Math.max(Number(value.acceptedEventCount ?? 0) || 0, 0),
    rejectedRequestCount: Math.max(Number(value.rejectedRequestCount ?? 0) || 0, 0),
    lastStartedAt: sanitizeText(value.lastStartedAt ?? ""),
    lastEventAt: sanitizeText(value.lastEventAt ?? ""),
    lastAdapterId: sanitizeText(value.lastAdapterId ?? ""),
    lastConnectorId: sanitizeText(value.lastConnectorId ?? ""),
    lastDispatchStatus: sanitizeText(value.lastDispatchStatus ?? ""),
    lastDispatchUserMessage: sanitizeText(value.lastDispatchUserMessage ?? ""),
    lastSignatureStatus: sanitizeText(value.lastSignatureStatus ?? ""),
    lastRejectedReason: sanitizeText(value.lastRejectedReason ?? ""),
    updatedAt: now,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createDefaultState(now) {
  return {
    version: 1,
    enabled: false,
    host,
    port: 0,
    endpointId: "",
    acceptedEventCount: 0,
    rejectedRequestCount: 0,
    lastStartedAt: "",
    lastEventAt: "",
    lastAdapterId: "",
    lastConnectorId: "",
    lastDispatchStatus: "",
    lastDispatchUserMessage: "",
    lastSignatureStatus: "",
    lastRejectedReason: "",
    updatedAt: now,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function shapeStatusResponse(state, overrides = {}) {
  const running = Boolean(overrides.running);
  const port = normalizePort(overrides.port ?? state.port ?? 0);
  const endpointPath = state.endpointId ? `${endpointPrefix}${state.endpointId}` : "";
  return {
    status: running ? "trigger_webhook_running" : "trigger_webhook_stopped",
    running,
    host,
    port,
    endpointPath,
    localUrl: running && port > 0 && endpointPath ? `http://${host}:${port}${endpointPath}` : "",
    acceptedEventCount: Number(state.acceptedEventCount ?? 0),
    rejectedRequestCount: Number(state.rejectedRequestCount ?? 0),
    lastEventAt: sanitizeText(state.lastEventAt ?? ""),
    lastAdapterId: sanitizeText(state.lastAdapterId ?? ""),
    lastConnectorId: sanitizeText(state.lastConnectorId ?? ""),
    lastDispatchStatus: sanitizeText(state.lastDispatchStatus ?? ""),
    lastSignatureStatus: sanitizeText(state.lastSignatureStatus ?? ""),
    supportedAdapters: triggerWebhookAdapterCatalog,
    userMessage: overrides.userMessage ?? state.lastDispatchUserMessage ?? "",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function safeHttpResponse(status, userMessage) {
  return {
    status,
    userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        server,
        port: typeof address === "object" && address ? Number(address.port) : port,
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function respondJson(response, statusCode, body) {
  if (response.headersSent) return;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function statePath(options) {
  if (!options.app?.getPath) throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  return path.join(options.app.getPath("userData"), stateFileName);
}

function createEndpointId() {
  return `local-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function sanitizeEndpointId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 48);
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isFinite(port) || port < 0 || port > 65535) return 0;
  return Math.trunc(port);
}

function isLoopbackAddress(value) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(value ?? ""));
}

function nowIso(options) {
  const value = typeof options.now === "function" ? options.now() : new Date();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : null;
  return value ? String(value) : null;
}

function sanitizeText(value) {
  return sanitizeWebhookText(value);
}
