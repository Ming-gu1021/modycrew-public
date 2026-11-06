import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  ModyConnectedWorkDataSensitivity,
  ModyConnectedWorkSignal,
} from "./connected-work-trigger.js";
import type { ISODateTimeString } from "./types.js";

const adapterPolicy = {
  mody_direct: "personal_safe",
  generic_form: "personal_safe",
  chat_message: "personal_safe",
  channel_talk: "provider_verification_needed",
  naver_talktalk: "provider_verification_needed",
  booking_update: "provider_verification_needed",
  commerce_order: "provider_verification_needed",
} as const;

const connectorByAdapter = {
  mody_direct: "generic-inquiry-site",
  generic_form: "generic-inquiry-site",
  chat_message: "personal-chat-inbox",
  channel_talk: "channel-talk",
  naver_talktalk: "naver-talktalk",
  booking_update: "naver-booking",
  commerce_order: "commerce-order",
} as const;

const defaultAllowedAdapters = ["mody_direct", "generic_form", "chat_message"] as const;
const maxClockSkewMs = 5 * 60 * 1000;

export type ModyPublicTriggerRelayAdapterId = keyof typeof adapterPolicy;

export type ModyPublicTriggerRelayAdapterAvailability =
  (typeof adapterPolicy)[ModyPublicTriggerRelayAdapterId];

export type ModyPublicTriggerRelayRoute = {
  version: 1;
  routeId: string;
  accountId: string;
  workspaceLabel: string;
  personalMode: boolean;
  endpointPath: string;
  deliveryMode: "desktop_pull";
  allowedAdapters: ModyPublicTriggerRelayAdapterId[];
  deferredAdapters: ModyPublicTriggerRelayDeferredAdapter[];
  secretFingerprint: string;
  desktopPullTokenFingerprint: string;
  createdAt: ISODateTimeString;
  expiresAt?: ISODateTimeString;
  setupSummary: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ModyPublicTriggerRelayDeferredAdapter = {
  adapterId: ModyPublicTriggerRelayAdapterId;
  availability: "provider_verification_needed";
  reason: string;
};

export type ModyPublicTriggerRelayRouteInput = {
  accountId: string;
  workspaceLabel?: string;
  routeId?: string;
  personalMode?: boolean;
  allowedAdapters?: ModyPublicTriggerRelayAdapterId[];
  signingSecret: string;
  desktopPullToken: string;
  createdAt?: ISODateTimeString;
  expiresAt?: ISODateTimeString;
};

export type ModyPublicTriggerRelayWebhookInput = {
  route: ModyPublicTriggerRelayRoute;
  rawBody: string;
  headers?: Record<string, string | string[] | undefined>;
  adapterHint?: string;
  sourceHint?: string;
  eventIdHint?: string;
  receivedAt?: ISODateTimeString;
  signingSecret: string;
};

export type ModyPublicTriggerRelayEvent = {
  ruleId: string;
  connectorId: string;
  title: string;
  summary: string;
  cursor: string;
  occurredAt: ISODateTimeString;
  changedFieldLabels: string[];
  externalMutation: false;
  rawSecretMaterialStored: false;
};

export type ModyPublicTriggerRelayQueuedEvent = {
  id: string;
  routeId: string;
  adapterId: ModyPublicTriggerRelayAdapterId;
  availability: "personal_safe";
  receivedAt: ISODateTimeString;
  queuedUntil: ISODateTimeString;
  event: ModyPublicTriggerRelayEvent;
  sourceFingerprint: string;
  deliveryMode: "desktop_pull";
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ModyPublicTriggerRelayAcceptResult =
  | {
      status: "public_relay_event_queued";
      accepted: true;
      queuedEvent: ModyPublicTriggerRelayQueuedEvent;
      userMessage: string;
      externalMutation: false;
      rawSecretMaterialStored: false;
      rawSecretMaterialReturned: false;
    }
  | {
      status: "public_relay_rejected";
      accepted: false;
      reason: string;
      userMessage: string;
      externalMutation: false;
      rawSecretMaterialStored: false;
      rawSecretMaterialReturned: false;
    };

export type ModyPublicTriggerRelayPullInput = {
  route: ModyPublicTriggerRelayRoute;
  queuedEvents: ModyPublicTriggerRelayQueuedEvent[];
  desktopPullToken: string;
  pulledAt?: ISODateTimeString;
  limit?: number;
};

export type ModyPublicTriggerRelayPullResult =
  | {
      status: "public_relay_events_ready";
      accepted: true;
      events: ModyPublicTriggerRelayQueuedEvent[];
      userMessage: string;
      externalMutation: false;
      rawSecretMaterialStored: false;
      rawSecretMaterialReturned: false;
    }
  | {
      status: "public_relay_pull_rejected";
      accepted: false;
      reason: string;
      events: [];
      userMessage: string;
      externalMutation: false;
      rawSecretMaterialStored: false;
      rawSecretMaterialReturned: false;
    };

export type ModyPublicRelaySignatureInput = {
  rawBody: string;
  signingSecret: string;
  timestamp: string | number;
};

type RuntimeOptions = {
  now?: () => Date;
};

export class ModyPublicTriggerRelayRuntime {
  private readonly now: () => Date;

  constructor(options: RuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createRoute(input: ModyPublicTriggerRelayRouteInput): ModyPublicTriggerRelayRoute {
    assertSecret("signingSecret", input.signingSecret);
    assertSecret("desktopPullToken", input.desktopPullToken);

    const createdAt = input.createdAt ?? this.now().toISOString();
    const personalMode = input.personalMode !== false;
    const requestedAdapters = normalizeAdapters(input.allowedAdapters, defaultAllowedAdapters);
    const allowedAdapters = requestedAdapters.filter((adapterId) =>
      personalMode ? adapterPolicy[adapterId] === "personal_safe" : true,
    );
    const deferredAdapters = requestedAdapters
      .filter((adapterId) => personalMode && adapterPolicy[adapterId] !== "personal_safe")
      .map((adapterId) => ({
        adapterId,
        availability: "provider_verification_needed" as const,
        reason:
          "사업자 또는 provider 정책 확인이 필요한 채널일 수 있어 개인 파일럿 모드에서는 자동 수신 성공으로 처리하지 않습니다.",
      }));
    const routeId = normalizeRouteId(input.routeId) || `personal-${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    return {
      version: 1,
      routeId,
      accountId: sanitizeToken(input.accountId, "local-account"),
      workspaceLabel: sanitizeRelayText(input.workspaceLabel ?? "개인 파일럿 업무함", 80),
      personalMode,
      endpointPath: `/api/mody/public-trigger/${routeId}`,
      deliveryMode: "desktop_pull",
      allowedAdapters,
      deferredAdapters,
      secretFingerprint: fingerprintSecret(input.signingSecret),
      desktopPullTokenFingerprint: fingerprintSecret(input.desktopPullToken),
      createdAt,
      ...(input.expiresAt ? { expiresAt: sanitizeIso(input.expiresAt, createdAt) } : {}),
      setupSummary: personalMode
        ? "사업자 없이 시작하는 개인 파일럿 모드입니다. 일반 문의 폼, 개인 채팅, 직접 POST 이벤트만 공개 릴레이로 받습니다."
        : "provider별 정책 검토가 끝난 adapter를 운영 릴레이에 연결할 수 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  acceptWebhook(input: ModyPublicTriggerRelayWebhookInput): ModyPublicTriggerRelayAcceptResult {
    const receivedAt = input.receivedAt ?? this.now().toISOString();
    const adapterId = normalizeAdapterId(
      input.adapterHint ??
        firstHeader(input.headers?.["x-mody-adapter"]) ??
        readJsonField(input.rawBody, "adapter"),
    );
    if (!adapterId) {
      return reject("unsupported_adapter", "지원하지 않는 공개 릴레이 adapter입니다.");
    }

    if (!input.route.allowedAdapters.includes(adapterId)) {
      const policy = adapterPolicy[adapterId];
      const reason = policy === "provider_verification_needed"
        ? "provider_verification_needed"
        : "adapter_not_enabled";
      return reject(
        reason,
        policy === "provider_verification_needed"
          ? "이 adapter는 provider 정책 확인 전이라 개인 파일럿 릴레이에서 받지 않습니다."
          : "이 공개 릴레이 주소에서 허용한 adapter가 아닙니다.",
      );
    }

    const signatureResult = verifyRelaySignature({
      rawBody: input.rawBody,
      signingSecret: input.signingSecret,
      route: input.route,
      headers: input.headers ?? {},
      receivedAt,
    });
    if (!signatureResult.ok) {
      return reject(signatureResult.reason, signatureResult.userMessage);
    }

    const body = parseJsonObject(input.rawBody);
    if (!body) {
      return reject("invalid_json", "공개 릴레이 이벤트 JSON을 읽지 못했습니다.");
    }

    const sourceHint = input.sourceHint ?? firstHeader(input.headers?.["x-mody-source"]);
    const eventIdHint = input.eventIdHint ?? firstHeader(input.headers?.["x-mody-event-id"]);
    const event = normalizeRelayEvent({
      adapterId,
      body,
      receivedAt,
      ...(sourceHint ? { sourceHint } : {}),
      ...(eventIdHint ? { eventIdHint } : {}),
    });
    const queuedEvent: ModyPublicTriggerRelayQueuedEvent = {
      id: `relay_${compactDate(receivedAt)}_${hashText(`${input.route.routeId}:${event.cursor}`).slice(0, 12)}`,
      routeId: input.route.routeId,
      adapterId,
      availability: "personal_safe",
      receivedAt,
      queuedUntil: new Date(new Date(receivedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      event,
      sourceFingerprint: hashText(`${adapterId}:${event.cursor}:${event.title}`).slice(0, 16),
      deliveryMode: "desktop_pull",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };

    return {
      status: "public_relay_event_queued",
      accepted: true,
      queuedEvent,
      userMessage: "공개 릴레이가 이벤트를 받았고 데스크톱 앱 pull 대기열에 넣었습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  pullForDesktop(input: ModyPublicTriggerRelayPullInput): ModyPublicTriggerRelayPullResult {
    if (fingerprintSecret(input.desktopPullToken) !== input.route.desktopPullTokenFingerprint) {
      return {
        status: "public_relay_pull_rejected",
        accepted: false,
        reason: "invalid_desktop_pull_token",
        events: [],
        userMessage: "데스크톱 pull token이 일치하지 않아 공개 릴레이 이벤트를 반환하지 않았습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }

    const pulledAt = input.pulledAt ?? this.now().toISOString();
    const limit = Math.max(Math.min(Number(input.limit ?? 20) || 20, 100), 1);
    const events = input.queuedEvents
      .filter((event) => event.routeId === input.route.routeId)
      .filter((event) => new Date(event.queuedUntil).getTime() >= new Date(pulledAt).getTime())
      .slice(0, limit)
      .map((event) => sanitizeQueuedEvent(event));

    return {
      status: "public_relay_events_ready",
      accepted: true,
      events,
      userMessage: events.length > 0
        ? `공개 릴레이 이벤트 ${events.length}건을 데스크톱 앱으로 전달할 준비가 됐습니다.`
        : "데스크톱 앱으로 전달할 공개 릴레이 이벤트가 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  toConnectedWorkSignal(
    queuedEvent: ModyPublicTriggerRelayQueuedEvent,
    triggerId = queuedEvent.event.ruleId,
  ): ModyConnectedWorkSignal {
    return {
      id: `relay_signal_${sanitizeToken(queuedEvent.id, "event")}`,
      triggerId,
      occurredAt: queuedEvent.event.occurredAt,
      title: queuedEvent.event.title,
      summary: queuedEvent.event.summary,
      cursor: queuedEvent.event.cursor,
      externalMutation: false,
      rawSecretMaterialStored: false,
      dataSensitivity: sensitivityForAdapter(queuedEvent.adapterId),
      changedFieldLabels: queuedEvent.event.changedFieldLabels,
    };
  }

  renderSetupMarkdown(route: ModyPublicTriggerRelayRoute): string {
    const lines = [
      "# Mody 공개 트리거 릴레이 설정",
      "",
      `- endpoint: ${route.endpointPath}`,
      `- deliveryMode: ${route.deliveryMode}`,
      `- personalMode: ${route.personalMode}`,
      `- allowedAdapters: ${route.allowedAdapters.join(", ") || "none"}`,
      `- deferredAdapters: ${route.deferredAdapters.map((adapter) => adapter.adapterId).join(", ") || "none"}`,
      "- externalMutation: false",
      "- rawSecretMaterialStored: false",
      "",
      "## 개인 파일럿 기준",
      "",
      route.setupSummary,
      "사업자 인증이 불확실한 공식 예약, 정산, 커머스 callback은 provider 정책 확인 전까지 성공 처리하지 않습니다.",
      "",
      "## 요청 서명",
      "",
      "POST 본문은 `x-mody-signature: t=<timestamp>,v1=<hmac_sha256>` 헤더로 검증합니다.",
      "서명과 desktop pull token 원문은 route 설정에 저장하지 않고 fingerprint만 남깁니다.",
      "",
    ];
    return `${lines.join("\n")}\n`;
  }
}

export function createModyPublicRelaySignature(input: ModyPublicRelaySignatureInput): string {
  assertSecret("signingSecret", input.signingSecret);
  const timestamp = String(input.timestamp);
  const digest = createHmac("sha256", input.signingSecret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

export function sanitizePublicRelayText(value: unknown): string {
  return sanitizeRelayText(value);
}

function normalizeRelayEvent(input: {
  adapterId: ModyPublicTriggerRelayAdapterId;
  body: Record<string, unknown>;
  receivedAt: ISODateTimeString;
  sourceHint?: string;
  eventIdHint?: string;
}): ModyPublicTriggerRelayEvent {
  const body = input.body;
  const nestedMessage = readRecord(body, "message") ?? readRecord(body, "entity");
  const nestedCustomer = readRecord(body, "customer") ?? readRecord(body, "person") ?? readRecord(body, "contact");
  const sourceId = sanitizeToken(
    input.sourceHint ??
      readString(body, "formId") ??
      readString(body, "channelId") ??
      readString(nestedMessage, "channelId") ??
      readNestedString(nestedMessage, ["channel", "id"]) ??
      input.adapterId,
    input.adapterId,
  );
  const eventId = sanitizeToken(
    input.eventIdHint ??
      readString(body, "eventId") ??
      readString(body, "submissionId") ??
      readString(body, "messageId") ??
      readString(body, "id") ??
      readString(nestedMessage, "id") ??
      hashText(JSON.stringify(body)).slice(0, 16),
    hashText(JSON.stringify(body)).slice(0, 16),
  );
  const occurredAt = sanitizeIso(
    readString(body, "occurredAt") ??
      readString(body, "submittedAt") ??
      readString(body, "createdAt") ??
      readString(body, "updatedAt") ??
      readString(nestedMessage, "createdAt"),
    input.receivedAt,
  );
  const subject = readString(body, "title") ??
    readString(body, "subject") ??
    readString(body, "serviceName") ??
    readString(nestedMessage, "title") ??
    readString(nestedMessage, "plainText") ??
    readString(nestedMessage, "text") ??
    readString(body, "text") ??
    "새 문의/메시지";
  const sender = readString(body, "name") ??
    readString(nestedCustomer, "name") ??
    readString(nestedMessage, "senderName") ??
    "고객";
  const message = readString(body, "summary") ??
    readString(body, "message") ??
    readString(body, "body") ??
    readString(body, "text") ??
    readString(nestedMessage, "plainText") ??
    readString(nestedMessage, "text") ??
    "";
  const contact = [
    readString(body, "email") ?? readString(nestedCustomer, "email"),
    readString(body, "phone") ?? readString(nestedCustomer, "phone"),
  ].filter(Boolean).join(" ");
  const status = readString(body, "status") ?? readString(body, "state") ?? "";
  const title = sanitizeRelayText(`${adapterLabel(input.adapterId)}: ${subject}`, 120);
  const summaryParts = [
    `${sender}에서 새 신호가 들어왔습니다.`,
    contact ? `연락처: ${contact}` : "",
    message,
    status ? `상태: ${status}` : "",
  ].filter(Boolean);

  return {
    ruleId: sanitizeToken(readString(body, "ruleId"), "instant-inquiry-message"),
    connectorId: connectorByAdapter[input.adapterId],
    title,
    summary: sanitizeRelayText(summaryParts.join(" "), 700),
    cursor: sanitizeToken(`${input.adapterId}-${sourceId}-${eventId}`, `${input.adapterId}-${hashText(JSON.stringify(body)).slice(0, 16)}`),
    occurredAt,
    changedFieldLabels: changedFieldLabelsFor(input.adapterId),
    externalMutation: false,
    rawSecretMaterialStored: false,
  };
}

function verifyRelaySignature(input: {
  rawBody: string;
  signingSecret: string;
  route: ModyPublicTriggerRelayRoute;
  headers: Record<string, string | string[] | undefined>;
  receivedAt: ISODateTimeString;
}): { ok: true } | { ok: false; reason: string; userMessage: string } {
  if (fingerprintSecret(input.signingSecret) !== input.route.secretFingerprint) {
    return {
      ok: false,
      reason: "route_secret_mismatch",
      userMessage: "릴레이 route와 signing secret fingerprint가 일치하지 않습니다.",
    };
  }

  const signatureHeader = firstHeader(input.headers["x-mody-signature"]);
  if (!signatureHeader) {
    return {
      ok: false,
      reason: "missing_signature",
      userMessage: "공개 릴레이 요청에 서명이 없어 이벤트를 받지 않았습니다.",
    };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return {
      ok: false,
      reason: "invalid_signature_format",
      userMessage: "공개 릴레이 요청 서명 형식이 올바르지 않습니다.",
    };
  }

  const timestampMs = timestampToMs(parsed.timestamp);
  const receivedMs = new Date(input.receivedAt).getTime();
  if (!Number.isFinite(timestampMs) || Math.abs(receivedMs - timestampMs) > maxClockSkewMs) {
    return {
      ok: false,
      reason: "signature_timestamp_out_of_range",
      userMessage: "공개 릴레이 요청 시간이 허용 범위를 벗어나 이벤트를 받지 않았습니다.",
    };
  }

  const expected = createModyPublicRelaySignature({
    rawBody: input.rawBody,
    signingSecret: input.signingSecret,
    timestamp: parsed.timestamp,
  });
  const expectedDigest = parseSignatureHeader(expected)?.digest ?? "";
  if (!safeEqualHex(parsed.digest, expectedDigest)) {
    return {
      ok: false,
      reason: "signature_mismatch",
      userMessage: "공개 릴레이 요청 서명이 일치하지 않아 이벤트를 받지 않았습니다.",
    };
  }

  return { ok: true };
}

function parseSignatureHeader(value: string): { timestamp: string; digest: string } | null {
  const parts = new Map(
    value.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")] as const;
    }),
  );
  const timestamp = parts.get("t") ?? "";
  const digest = parts.get("v1") ?? "";
  if (!timestamp || !/^[a-f0-9]{64}$/iu.test(digest)) return null;
  return { timestamp, digest: digest.toLowerCase() };
}

function timestampToMs(value: string): number {
  if (/^\d{13}$/u.test(value)) return Number(value);
  if (/^\d{10}$/u.test(value)) return Number(value) * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function reject(reason: string, userMessage: string): ModyPublicTriggerRelayAcceptResult {
  return {
    status: "public_relay_rejected",
    accepted: false,
    reason,
    userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function normalizeAdapters(
  value: readonly ModyPublicTriggerRelayAdapterId[] | undefined,
  fallback: readonly ModyPublicTriggerRelayAdapterId[],
): ModyPublicTriggerRelayAdapterId[] {
  const adapters = (value && value.length > 0 ? value : fallback)
    .map((adapter) => normalizeAdapterId(adapter))
    .filter((adapter): adapter is ModyPublicTriggerRelayAdapterId => Boolean(adapter));
  return [...new Set(adapters)];
}

function normalizeAdapterId(value: unknown): ModyPublicTriggerRelayAdapterId | null {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/gu, "_");
  if (text === "form" || text === "contact_form") return "generic_form";
  if (text === "chat") return "chat_message";
  if (text === "channeltalk") return "channel_talk";
  if (text === "naver_talk" || text === "naver_talk_talk") return "naver_talktalk";
  if (text === "booking" || text === "reservation") return "booking_update";
  if (text === "order" || text === "commerce") return "commerce_order";
  return text in adapterPolicy ? (text as ModyPublicTriggerRelayAdapterId) : null;
}

function sanitizeQueuedEvent(event: ModyPublicTriggerRelayQueuedEvent): ModyPublicTriggerRelayQueuedEvent {
  return {
    id: sanitizeToken(event.id, "relay-event"),
    routeId: sanitizeToken(event.routeId, "route"),
    adapterId: event.adapterId,
    availability: "personal_safe",
    receivedAt: sanitizeIso(event.receivedAt, new Date().toISOString()),
    queuedUntil: sanitizeIso(event.queuedUntil, new Date().toISOString()),
    event: {
      ruleId: sanitizeToken(event.event.ruleId, "instant-inquiry-message"),
      connectorId: sanitizeToken(event.event.connectorId, "generic-inquiry-site"),
      title: sanitizeRelayText(event.event.title, 120),
      summary: sanitizeRelayText(event.event.summary, 700),
      cursor: sanitizeToken(event.event.cursor, "relay-cursor"),
      occurredAt: sanitizeIso(event.event.occurredAt, event.receivedAt),
      changedFieldLabels: event.event.changedFieldLabels.map((label) => sanitizeRelayText(label, 40)).slice(0, 8),
      externalMutation: false,
      rawSecretMaterialStored: false,
    },
    sourceFingerprint: sanitizeToken(event.sourceFingerprint, "source"),
    deliveryMode: "desktop_pull",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function parseJsonObject(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readJsonField(rawBody: string, field: string): string {
  const body = parseJsonObject(rawBody);
  return body ? readString(body, field) ?? "" : "";
}

function readRecord(value: Record<string, unknown> | undefined, field: string): Record<string, unknown> | undefined {
  const child = value?.[field];
  return child && typeof child === "object" && !Array.isArray(child)
    ? child as Record<string, unknown>
    : undefined;
}

function readNestedString(value: Record<string, unknown> | undefined, fields: string[]): string | undefined {
  let current: Record<string, unknown> | undefined = value;
  for (const field of fields.slice(0, -1)) {
    current = readRecord(current, field);
  }
  return readString(current, fields.at(-1) ?? "");
}

function readString(value: Record<string, unknown> | undefined, field: string): string | undefined {
  const raw = value?.[field];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined;
  return value ? String(value) : undefined;
}

function sanitizeRelayText(value: unknown, maxLength = 500): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\b(?:010|011|016|017|018|019)[-\s]?\d{3,4}[-\s]?\d{4}\b/gu, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/gu, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk|ak)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/gu, "[redacted-key]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[A-Za-z0-9_.:/+=-]{8,}\b/giu, "$1=[redacted-secret]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeToken(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣._:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 100);
  return text || fallback;
}

function normalizeRouteId(value: unknown): string {
  return sanitizeToken(value, "").replace(/[:.]+/gu, "-").slice(0, 80);
}

function sanitizeIso(value: unknown, fallback: ISODateTimeString): ISODateTimeString {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function compactDate(value: string): string {
  return value.replace(/[^0-9]/gu, "").slice(0, 14);
}

function fingerprintSecret(secret: string): string {
  return `sha256:${hashText(secret).slice(0, 16)}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/iu.test(left) || !/^[a-f0-9]+$/iu.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertSecret(label: string, value: string): void {
  if (String(value ?? "").length < 16) {
    throw new Error(`${label}은 16자 이상이어야 합니다.`);
  }
}

function adapterLabel(adapterId: ModyPublicTriggerRelayAdapterId): string {
  if (adapterId === "generic_form") return "문의 폼";
  if (adapterId === "chat_message") return "채팅 메시지";
  if (adapterId === "channel_talk") return "채널톡";
  if (adapterId === "naver_talktalk") return "네이버 톡톡";
  if (adapterId === "booking_update") return "예약 변경";
  if (adapterId === "commerce_order") return "주문 변경";
  return "직접 이벤트";
}

function changedFieldLabelsFor(adapterId: ModyPublicTriggerRelayAdapterId): string[] {
  if (adapterId === "booking_update") return ["예약번호", "예약 상태", "고객", "시간"];
  if (adapterId === "commerce_order") return ["주문번호", "주문 상태", "상품", "금액"];
  if (adapterId === "chat_message" || adapterId === "channel_talk" || adapterId === "naver_talktalk") {
    return ["메시지", "고객", "채널"];
  }
  return ["문의 제목", "문의 본문", "고객"];
}

function sensitivityForAdapter(adapterId: ModyPublicTriggerRelayAdapterId): ModyConnectedWorkDataSensitivity {
  if (adapterId === "commerce_order") return "business_financial";
  if (adapterId === "generic_form" || adapterId === "chat_message" || adapterId === "channel_talk" || adapterId === "naver_talktalk") {
    return "customer_contact";
  }
  return "normal";
}
