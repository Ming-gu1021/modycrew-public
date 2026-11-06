import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { JSON_STORE_SKIP_WRITE, mutateJsonStore, readJsonStore, withJsonFileLock } from "./json-store.mjs";
import { handleTriggerRunnerMessage } from "./trigger-runner-handler.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..", "..", "..");
const stateFileName = "public-trigger-relay-state.json";

const packagedDomainEntryPath = process.resourcesPath
  ? path.join(process.resourcesPath, "domain", "index.js")
  : null;
const domainEntryPath =
  packagedDomainEntryPath && existsSync(packagedDomainEntryPath)
    ? packagedDomainEntryPath
    : path.join(repoRoot, "packages", "domain", "dist", "index.js");

let domainModulePromise;

class DomainRuntimeUnavailableError extends Error {
  constructor() {
    super(`ModyCrew domain runtime was not found: ${domainEntryPath}`);
    this.name = "DomainRuntimeUnavailableError";
  }
}

async function loadDomainRuntime() {
  if (!existsSync(domainEntryPath)) {
    throw new DomainRuntimeUnavailableError();
  }
  domainModulePromise ??= import(pathToFileURL(domainEntryPath).href);
  return domainModulePromise;
}

export async function handlePublicTriggerRelayMessage(_event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");

  if (kind === "status") {
    return getPublicRelayStatus(options);
  }

  if (kind === "accept_webhook") {
    return acceptPublicRelayWebhook(payload, options);
  }

  if (kind === "pull") {
    return pullPublicRelayEvents(payload, options);
  }

  throw new Error(`unsupported public-trigger-relay kind: ${kind}`);
}

async function getPublicRelayStatus(options) {
  const runtime = await createRuntimeOrNull(options);
  if (!runtime) {
    return createRuntimeUnavailableStatus();
  }
  const state = await ensureState(options, runtime);
  return {
    status: "public_trigger_relay_ready",
    route: sanitizeRouteForRenderer(state.route),
    queuedEventCount: state.queuedEvents.length,
    latestPull: sanitizeLatestPull(state.latestPull),
    userMessage:
      "개인용 공개 릴레이는 일반 문의 폼, 개인 채팅, 직접 POST 이벤트만 받고 데스크톱 pull 후 업무 카드로 넘깁니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function acceptPublicRelayWebhook(payload, options) {
  const runtime = await createRuntime(options);
  await ensureState(options, runtime);
  const rawBody = typeof payload.rawBody === "string"
    ? payload.rawBody
    : JSON.stringify(payload.body ?? {});
  const signingSecret = signingSecretFor(options, payload.signingSecret);
  let accepted;
  // 큐에 넣는 일은 상태 파일 대기열 안에서 최신 큐에 붙인다.
  // 예전엔 가져오기(pull)와 겹치면 방금 받은 이벤트가 큐에서 사라질 수 있었다.
  await mutateRelayState(options, (state) => {
    accepted = runtime.acceptWebhook({
      route: state.route,
      rawBody,
      headers: sanitizeHeaders(payload.headers),
      adapterHint: payload.adapterHint,
      sourceHint: payload.sourceHint,
      eventIdHint: payload.eventIdHint,
      receivedAt: payload.receivedAt,
      signingSecret,
    });

    const now = nowIso(options);
    if (accepted.accepted) {
      state.queuedEvents = dedupeQueuedEvents([accepted.queuedEvent, ...state.queuedEvents]).slice(0, 200);
      state.latestAccept = {
        status: accepted.status,
        adapterId: accepted.queuedEvent.adapterId,
        eventId: accepted.queuedEvent.id,
        receivedAt: now,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    } else {
      state.latestAccept = {
        status: accepted.status,
        reason: sanitizeText(accepted.reason),
        receivedAt: now,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }
    state.updatedAt = now;
  });

  return {
    ...accepted,
    queuedEvent: accepted.accepted ? sanitizeQueuedEventForRenderer(accepted.queuedEvent) : undefined,
  };
}

async function pullPublicRelayEvents(payload, options) {
  const runtime = await createRuntimeOrNull(options);
  if (!runtime) {
    return {
      status: "public_trigger_relay_runtime_required",
      accepted: false,
      eventsPulled: 0,
      eventsDispatched: 0,
      userMessage:
        "공개 릴레이 실행 런타임을 준비한 뒤 이벤트를 가져올 수 있습니다. 연결 가이드와 승인형 업무 설정은 계속 사용할 수 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  // 가져오기는 한 번에 하나만 돈다. 두 가져오기가 겹치면 같은 이벤트를 두 번 넘길 수 있다.
  const { pulled, processedCount } = await withJsonFileLock(`${statePath(options)}#pull`, async () => {
    const state = await ensureState(options, runtime);
    const desktopPullToken = desktopPullTokenFor(options, payload.desktopPullToken);
    const pulledNow = runtime.pullForDesktop({
      route: state.route,
      queuedEvents: state.queuedEvents,
      desktopPullToken,
      pulledAt: payload.pulledAt,
      limit: payload.limit,
    });

    let processed = 0;
    const dispatchedIds = new Set();
    if (pulledNow.accepted) {
      for (const queuedEvent of pulledNow.events) {
        try {
          const dispatchResult = await handleTriggerRunnerMessage(
            null,
            { kind: "dispatch_event", event: queuedEvent.event },
            options,
          );
          // 디스패치가 완료된 이벤트는 매칭 여부와 무관하게 큐에서 소비합니다.
          // 매칭 규칙이 없는("not_matched") 이벤트를 큐에 남기면 매 pull마다
          // 재처리되어 큐가 무한히 쌓이고 신규 이벤트가 유실됩니다.
          dispatchedIds.add(queuedEvent.id);
          if (dispatchResult.status === "trigger_event_processed") {
            processed += 1;
          }
        } catch (error) {
          // 일시적 오류는 큐에 남겨 다음 pull에서 재시도합니다.
          console.error("[public-relay] 이벤트 디스패치 실패:", error);
        }
      }
    }

    // 넘긴 이벤트만 최신 큐에서 뺀다. 디스패치하는 동안 새로 들어온 이벤트는 그대로 남는다.
    await mutateRelayState(options, (latest) => {
      const now = nowIso(options);
      if (pulledNow.accepted) {
        latest.queuedEvents = latest.queuedEvents.filter((event) => !dispatchedIds.has(event.id));
      }
      latest.latestPull = {
        status: pulledNow.status,
        pulledAt: now,
        eventsReturned: pulledNow.events.length,
        eventsDispatched: processed,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
      latest.updatedAt = now;
    });
    return { pulled: pulledNow, processedCount: processed };
  });

  return {
    status: pulled.accepted ? "public_relay_pull_dispatched" : pulled.status,
    accepted: pulled.accepted,
    eventsPulled: pulled.events.length,
    eventsDispatched: processedCount,
    userMessage: pulled.accepted
      ? `공개 릴레이 이벤트 ${processedCount}건을 데스크톱 자동 트리거로 넘겼습니다.`
      : pulled.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function createRuntime(options) {
  const domain = await loadDomainRuntime();
  return new domain.ModyPublicTriggerRelayRuntime({
    now: () => nowDate(options),
  });
}

async function createRuntimeOrNull(options) {
  try {
    return await createRuntime(options);
  } catch (error) {
    if (error instanceof DomainRuntimeUnavailableError) {
      return null;
    }
    throw error;
  }
}

function createRuntimeUnavailableStatus() {
  return {
    status: "public_trigger_relay_runtime_required",
    queuedEventCount: 0,
    latestPull: null,
    userMessage:
      "공개 릴레이 실행 런타임을 준비 중입니다. 연결 가이드와 승인형 업무 설정은 계속 사용할 수 있습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function ensureState(options, runtime) {
  const current = await readState(options);
  if (current.route) return current;
  // 경로 만들기도 대기열 안에서 한다. 동시에 두 번 만들면 뒤의 것이 앞의 경로를 덮었다.
  return mutateRelayState(options, (latest) => {
    if (latest.route) return JSON_STORE_SKIP_WRITE;
    const now = nowIso(options);
    const route = runtime.createRoute({
      accountId: "local-personal-pilot",
      workspaceLabel: "사업자 없는 개인 파일럿",
      personalMode: true,
      allowedAdapters: [
        "mody_direct",
        "generic_form",
        "chat_message",
        "channel_talk",
        "naver_talktalk",
        "booking_update",
        "commerce_order",
      ],
      signingSecret: signingSecretFor(options),
      desktopPullToken: desktopPullTokenFor(options),
      createdAt: now,
    });
    return {
      version: 1,
      route,
      queuedEvents: [],
      latestAccept: null,
      latestPull: null,
      updatedAt: now,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  });
}

function createEmptyRelayState() {
  return {
    version: 1,
    route: null,
    queuedEvents: [],
    latestAccept: null,
    latestPull: null,
    updatedAt: "",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function parseRelayStateFile(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("invalid_public_relay_state_shape");
  return {
    version: 1,
    route: parsed.route ?? null,
    queuedEvents: Array.isArray(parsed.queuedEvents)
      ? parsed.queuedEvents.map(sanitizeQueuedEventState).filter(Boolean)
      : [],
    latestAccept: sanitizeLatestAccept(parsed.latestAccept),
    latestPull: sanitizeLatestPull(parsed.latestPull),
    updatedAt: sanitizeText(parsed.updatedAt),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function readState(options) {
  try {
    // 본 파일이 깨졌으면 직전 정상본(.previous)으로 읽는다.
    const loaded = await readJsonStore(statePath(options), { parse: parseRelayStateFile });
    if (loaded.status === "ok" || loaded.status === "recovered") return loaded.value;
  } catch {
    // Missing state starts clean. Secret and token originals are not stored here.
  }
  return createEmptyRelayState();
}

/** 상태 파일 대기열 안에서 최신 상태를 읽고 mutator 로 고친 뒤 원자적으로 저장한다. */
async function mutateRelayState(options, mutator) {
  return mutateJsonStore(
    statePath(options),
    {
      parse: parseRelayStateFile,
      empty: createEmptyRelayState,
      serialize: (state) => `${JSON.stringify(sanitizeStateForDisk(state), null, 2)}\n`,
      onUnreadable: "reset",
    },
    mutator,
  );
}

function sanitizeStateForDisk(state) {
  return {
    version: 1,
    route: state.route,
    queuedEvents: state.queuedEvents.map(sanitizeQueuedEventState).filter(Boolean),
    latestAccept: sanitizeLatestAccept(state.latestAccept),
    latestPull: sanitizeLatestPull(state.latestPull),
    updatedAt: sanitizeText(state.updatedAt),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeQueuedEventState(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    event: {
      ...value.event,
      title: sanitizeText(value.event?.title),
      summary: sanitizeText(value.event?.summary),
      cursor: sanitizeText(value.event?.cursor),
      externalMutation: false,
      rawSecretMaterialStored: false,
    },
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeRouteForRenderer(route) {
  return {
    version: route.version,
    routeId: route.routeId,
    workspaceLabel: route.workspaceLabel,
    personalMode: route.personalMode,
    endpointPath: route.endpointPath,
    deliveryMode: route.deliveryMode,
    allowedAdapters: route.allowedAdapters,
    deferredAdapters: route.deferredAdapters,
    secretFingerprint: route.secretFingerprint,
    desktopPullTokenFingerprint: route.desktopPullTokenFingerprint,
    createdAt: route.createdAt,
    setupSummary: route.setupSummary,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeQueuedEventForRenderer(event) {
  return {
    id: event.id,
    routeId: event.routeId,
    adapterId: event.adapterId,
    availability: event.availability,
    receivedAt: event.receivedAt,
    event: {
      title: event.event.title,
      summary: event.event.summary,
      connectorId: event.event.connectorId,
      occurredAt: event.event.occurredAt,
      externalMutation: false,
      rawSecretMaterialStored: false,
    },
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeLatestAccept(value) {
  if (!value || typeof value !== "object") return null;
  return {
    status: sanitizeText(value.status),
    reason: value.reason ? sanitizeText(value.reason) : undefined,
    adapterId: value.adapterId ? sanitizeText(value.adapterId) : undefined,
    eventId: value.eventId ? sanitizeText(value.eventId) : undefined,
    receivedAt: sanitizeText(value.receivedAt),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeLatestPull(value) {
  if (!value || typeof value !== "object") return null;
  return {
    status: sanitizeText(value.status),
    pulledAt: sanitizeText(value.pulledAt),
    eventsReturned: Number(value.eventsReturned ?? 0),
    eventsDispatched: Number(value.eventsDispatched ?? 0),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const safe = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("authorization") || lowerKey.includes("token")) continue;
    safe[lowerKey] = Array.isArray(value) ? value.map(sanitizeText) : sanitizeText(value);
  }
  return safe;
}

function dedupeQueuedEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function statePath(options) {
  if (!options.app?.getPath) throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  return path.join(options.app.getPath("userData"), stateFileName);
}

function signingSecretFor(options, override) {
  const value = String(override ?? options.publicRelaySigningSecret ?? process.env.MODY_PUBLIC_RELAY_SIGNING_SECRET ?? "").trim();
  if (!value) throw new Error("공개 릴레이를 사용하려면 MODY_PUBLIC_RELAY_SIGNING_SECRET을 설정하세요.");
  return value;
}

function desktopPullTokenFor(options, override) {
  const value = String(override ?? options.publicRelayDesktopPullToken ?? process.env.MODY_PUBLIC_RELAY_PULL_TOKEN ?? "").trim();
  if (!value) throw new Error("공개 릴레이를 사용하려면 MODY_PUBLIC_RELAY_PULL_TOKEN을 설정하세요.");
  return value;
}

function nowDate(options) {
  const value = typeof options.now === "function" ? options.now() : new Date();
  return value instanceof Date ? value : new Date(value);
}

function nowIso(options) {
  return nowDate(options).toISOString();
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}
