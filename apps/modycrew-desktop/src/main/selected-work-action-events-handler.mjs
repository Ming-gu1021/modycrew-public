import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mutateJsonStore, readJsonStore } from "./json-store.mjs";

const stateFileName = "selected-work-action-events.v1.json";
const auditFolderName = "selected-work-action-event-audits";
const maxEvents = 200;
const staleRunningAfterMs = 2 * 60 * 1000;
const validStatuses = new Set(["running", "done", "needs_desktop", "error", "unknown"]);
const validKinds = new Set([
  "selected_action",
  "work_sync",
  "mail_intake",
  "schedule_briefing",
  "document_learning",
  "approval_notification",
  "messenger_decision",
  "notification_permission",
  "memory_personalization",
  "automation",
  "desktop_control",
  "release_readiness",
]);

export async function handleSelectedWorkActionEventsMessage(_event, payload = {}, options = {}) {
  const kind = sanitizeKind(payload.kind);
  if (kind === "read") {
    return createResult("selected_work_action_events_loaded", await readEvents(options), options);
  }

  if (kind === "record") {
    const event = normalizeEvent(payload.event);
    const events = await mutateEvents(options, (current) =>
      [event, ...current.filter((candidate) => candidate.id !== event.id)],
    );
    const audit = await appendAuditRecord(options, "record", event);
    return createResult("selected_work_action_event_recorded", events, options, audit);
  }

  if (kind === "record_release_readiness") {
    const imported = await readReleaseReadinessVirtualOfficeEvent(options);
    const current = await readEvents(options);
    if (!imported?.event) {
      return createResult(
        "release_readiness_virtual_office_event_missing",
        current,
        options,
        null,
        {
          userMessage:
            "릴리즈 readiness 가상오피스 이벤트 파일이 없습니다. 먼저 release readiness 검증을 실행해 주세요.",
          releaseReadinessVirtualOfficeEventPath: imported?.path ?? resolveReleaseReadinessEventPath(options),
        },
      );
    }

    const event = normalizeEvent(imported.event);
    const events = await mutateEvents(options, (latest) =>
      [event, ...latest.filter((candidate) => candidate.id !== event.id)],
    );
    const audit = await appendAuditRecord(options, "record_release_readiness", event);
    return createResult("release_readiness_virtual_office_event_recorded", events, options, audit, {
      releaseReadinessVirtualOfficeEventPath: imported.path,
    });
  }

  if (kind === "update") {
    const eventId = sanitizeText(payload.eventId, 120);
    const patch = normalizePatch(payload.patch);
    const events = await mutateEvents(options, (current) =>
      current.map((event) => (event.id === eventId ? normalizeEvent({ ...event, ...patch }) : event)),
    );
    const updated = events.find((event) => event.id === eventId) ?? { id: eventId, ...patch };
    const audit = await appendAuditRecord(options, "update", updated);
    return createResult("selected_work_action_event_updated", events, options, audit);
  }

  throw new Error(`unsupported selected work action event kind: ${String(payload.kind)}`);
}

export async function readSelectedWorkActionEventState(options = {}) {
  return readEvents(options);
}

function parseEventsState(parsed) {
  const list = Array.isArray(parsed?.events) ? parsed.events : Array.isArray(parsed) ? parsed : [];
  const normalized = list.map(normalizeEvent);
  return { events: normalized.slice(0, maxEvents) };
}

const eventsStoreOptions = {
  parse: parseEventsState,
  empty: () => ({ events: [], staleChanged: false }),
  serialize: (state) =>
    `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), events: state.events }, null, 2)}\n`,
  // 깨진 기록 파일은 사본으로 남기고(.unreadable-*) 새로 시작한다.
  onUnreadable: "reset",
};

/**
 * 기록 파일의 대기열 안에서 최신 목록을 읽고 mutator 로 바꾼 뒤 원자적으로 저장한다.
 * 예전엔 두 기록이 겹치면 늦게 쓴 쪽이 목록 전체를 1건으로 덮어썼다(102건 → 1건 실측).
 */
async function mutateEvents(options, mutator) {
  const next = await mutateJsonStore(statePath(options), eventsStoreOptions, async (state) => ({
    events: (await mutator(state.events)).slice(0, maxEvents),
    staleChanged: false,
  }));
  return next.events.map(normalizeStaleRunningEvent);
}

async function readEvents(options) {
  try {
    const loaded = await readJsonStore(statePath(options), { parse: parseEventsState });
    if (loaded.status !== "ok" && loaded.status !== "recovered") return [];
    return loaded.value.events.map(normalizeStaleRunningEvent);
  } catch {
    return [];
  }
}

async function appendAuditRecord(options, action, event) {
  const folder = auditFolderPath(options);
  await mkdir(folder, { recursive: true });
  const auditFile = path.join(folder, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const auditRecord = {
    version: 1,
    action,
    recordedAt: new Date().toISOString(),
    event: normalizeEvent(event),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  await writeFile(auditFile, `${JSON.stringify(auditRecord)}\n`, { encoding: "utf8", flag: "a" });
  return { auditFile, auditRecord };
}

async function readReleaseReadinessVirtualOfficeEvent(options = {}) {
  const eventPath = resolveReleaseReadinessEventPath(options);
  try {
    const parsed = JSON.parse(await readFile(eventPath, "utf8"));
    if (parsed?.status !== "release_readiness_virtual_office_event_prepared") {
      return { path: eventPath, event: null };
    }
    if (!parsed?.event || typeof parsed.event !== "object") {
      return { path: eventPath, event: null };
    }
    return { path: eventPath, event: parsed.event };
  } catch {
    return { path: eventPath, event: null };
  }
}

function resolveReleaseReadinessEventPath(options = {}) {
  const root = options.repoRoot ? path.resolve(String(options.repoRoot)) : process.cwd();
  return path.join(root, "tmp", "release-readiness-virtual-office-event.json");
}

function createResult(status, events, _options, audit = null, extra = {}) {
  return {
    status,
    events,
    ...(audit?.auditFile ? { auditFile: audit.auditFile } : {}),
    userMessage: extra.userMessage ?? "선택한 업무 실행 기록을 이 PC의 로컬 감사 기록에 저장했습니다.",
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "userMessage")),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function statePath(options) {
  return path.join(resolveBasePath(options), stateFileName);
}

function auditFolderPath(options) {
  return path.join(resolveBasePath(options), auditFolderName);
}

function resolveBasePath(options = {}) {
  if (options.storageRoot) return path.resolve(String(options.storageRoot));
  if (options.app?.getPath) return options.app.getPath("userData");
  throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
}

function normalizeEvent(value = {}) {
  const now = new Date().toISOString();
  // 새 이벤트의 status 가 없거나 잘못된 경우, 진행 중을 뜻하는 "running"을 기본값으로
  // 둡니다. 예전처럼 "error"로 두면 정상 기록도 실패로 잘못 표시됩니다.
  const requestedStatus = value.status === "unknown" && value.statusProjection === "stale_running"
    ? "running" : validStatuses.has(value.status) ? value.status : "running";
  const validCreatedAt = !value.createdAt || Number.isFinite(Date.parse(value.createdAt));
  const validUpdatedAt = !value.updatedAt || Number.isFinite(Date.parse(value.updatedAt));
  const status = requestedStatus === "running" && (!validCreatedAt || !validUpdatedAt) ? "unknown" : requestedStatus;
  return {
    id: sanitizeText(value.id || `work-action-${Date.now()}`, 120),
    workItemId: sanitizeText(value.workItemId, 160),
    label: sanitizeText(value.label || "업무 실행", 80),
    detail: sanitizeText(value.detail || "실행 기록을 저장했습니다.", 240),
    status,
    createdAt: sanitizeIsoDate(value.createdAt || now),
    ...(value.updatedAt ? { updatedAt: sanitizeIsoDate(value.updatedAt) } : {}),
    ...(value.evidence ? { evidence: sanitizeText(value.evidence, 260) } : {}),
    ...(validKinds.has(value.kind) ? { kind: value.kind } : {}),
    ...(value.sourceLabel ? { sourceLabel: sanitizeText(value.sourceLabel, 100) } : {}),
    ...(value.metrics && typeof value.metrics === "object" ? { metrics: sanitizeMetrics(value.metrics) } : {}),
    ...(Array.isArray(value.auditTrail) ? { auditTrail: sanitizeAuditTrail(value.auditTrail) } : {}),
  };
}

function normalizePatch(value = {}) {
  return {
    // status 는 유효한 값이 들어올 때만 패치에 포함합니다. 부분 업데이트(detail/evidence만
    // 변경 등)에서 status 를 강제로 "error"로 덮어쓰면, 성공 중이던 이벤트가 실패로
    // 바뀝니다. status 를 생략하면 호출부의 {...event, ...patch} 병합으로 기존 값이 유지됩니다.
    ...(validStatuses.has(value.status) ? { status: value.status } : {}),
    detail: sanitizeText(value.detail || "상태가 업데이트되었습니다.", 240),
    updatedAt: new Date().toISOString(),
    ...(value.evidence ? { evidence: sanitizeText(value.evidence, 260) } : {}),
    ...(validKinds.has(value.kind) ? { kind: value.kind } : {}),
    ...(value.sourceLabel ? { sourceLabel: sanitizeText(value.sourceLabel, 100) } : {}),
    ...(value.metrics && typeof value.metrics === "object" ? { metrics: sanitizeMetrics(value.metrics) } : {}),
    ...(Array.isArray(value.auditTrail) ? { auditTrail: sanitizeAuditTrail(value.auditTrail) } : {}),
  };
}

function normalizeStaleRunningEvent(event) {
  if (event.status !== "running") return event;
  const lastUpdate = Date.parse(event.updatedAt ?? event.createdAt);
  const age = Date.now() - lastUpdate;
  if (Number.isFinite(age) && age >= 0 && age < staleRunningAfterMs) return event;
  return { ...event, status: "unknown", statusProjection: "stale_running" };
}

function sanitizeKind(value) {
  return String(value ?? "").replace(/[^a-z_]/g, "").slice(0, 40);
}

function sanitizeText(value, maxLength) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeMetrics(value = {}) {
  const entries = Object.entries(value).slice(0, 12).flatMap(([key, metric]) => {
    const sanitizedKey = sanitizeText(key, 48).replace(/[^A-Za-z0-9_.:-]/g, "_");
    if (!sanitizedKey) return [];
    if (typeof metric === "number") return [[sanitizedKey, Number.isFinite(metric) ? metric : 0]];
    if (typeof metric === "boolean") return [[sanitizedKey, metric]];
    return [[sanitizedKey, sanitizeText(metric, 120)]];
  });
  return Object.fromEntries(entries);
}

function sanitizeAuditTrail(value = []) {
  return value.map((item) => sanitizeText(item, 160)).filter(Boolean).slice(0, 8);
}

function sanitizeIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
