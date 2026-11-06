"use client";

const STORAGE_KEY = "modycrew.selectedWorkActionEvents.v1";
const MAX_EVENTS = 60;
const STALE_RUNNING_AFTER_MS = 2 * 60 * 1000;

export type SelectedWorkActionEventStatus = "running" | "done" | "needs_desktop" | "error" | "unknown";
export type SelectedWorkActionEventKind =
  | "selected_action"
  | "work_sync"
  | "mail_intake"
  | "schedule_briefing"
  | "document_learning"
  | "approval_notification"
  | "messenger_decision"
  | "notification_permission"
  | "memory_personalization"
  | "automation"
  | "desktop_control"
  | "release_readiness";

export type SelectedWorkActionEventMetrics = Record<string, number | string | boolean>;

export type SelectedWorkActionEvent = {
  id: string;
  workItemId: string;
  label: string;
  detail: string;
  status: SelectedWorkActionEventStatus;
  statusProjection?: "stale_running";
  createdAt: string;
  updatedAt?: string;
  evidence?: string;
  kind?: SelectedWorkActionEventKind;
  sourceLabel?: string;
  metrics?: SelectedWorkActionEventMetrics;
  auditTrail?: string[];
};

function readStoredEvents(): SelectedWorkActionEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSelectedWorkActionEvent)
      .slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

export function readSelectedWorkActionEvents(): SelectedWorkActionEvent[] {
  return readStoredEvents().map(normalizeStaleRunningEvent);
}

export function recordSelectedWorkActionEvent(
  event: SelectedWorkActionEvent,
): SelectedWorkActionEvent[] {
  const current = readStoredEvents();
  const next = [
    sanitizeSelectedWorkActionEvent(event),
    ...current.filter((candidate) => candidate.id !== event.id),
  ].slice(0, MAX_EVENTS);
  writeSelectedWorkActionEvents(next);
  return next.map(normalizeStaleRunningEvent);
}

export function updateSelectedWorkActionEvent(
  eventId: string,
  patch: Pick<SelectedWorkActionEvent, "status" | "detail"> &
    Partial<Pick<SelectedWorkActionEvent, "evidence" | "kind" | "sourceLabel" | "metrics" | "auditTrail">>,
): SelectedWorkActionEvent[] {
  const now = new Date().toISOString();
  const next = readStoredEvents().map((event) =>
    event.id === eventId
      ? sanitizeSelectedWorkActionEvent({
          ...event,
          ...patch,
          updatedAt: now,
        })
      : event,
  );
  writeSelectedWorkActionEvents(next);
  return next.map(normalizeStaleRunningEvent);
}

export function replaceSelectedWorkActionEvents(
  events: SelectedWorkActionEvent[],
): SelectedWorkActionEvent[] {
  const next = events
    .filter(isSelectedWorkActionEvent)
    .map(sanitizeSelectedWorkActionEvent)
    .slice(0, MAX_EVENTS);
  writeSelectedWorkActionEvents(next);
  return next.map(normalizeStaleRunningEvent);
}

function writeSelectedWorkActionEvents(events: SelectedWorkActionEvent[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(events.filter(isSelectedWorkActionEvent).slice(0, MAX_EVENTS)),
  );
}

function normalizeStaleRunningEvent(event: SelectedWorkActionEvent): SelectedWorkActionEvent {
  if (event.status !== "running") return event;
  const lastUpdate = Date.parse(event.updatedAt ?? event.createdAt);
  const age = Date.now() - lastUpdate;
  if (Number.isFinite(age) && age >= 0 && age < STALE_RUNNING_AFTER_MS) return event;
  // Time alone cannot prove failure or cancellation. Keep the stored record intact.
  return { ...event, status: "unknown", statusProjection: "stale_running" };
}

function sanitizeSelectedWorkActionEvent(event: SelectedWorkActionEvent): SelectedWorkActionEvent {
  const requestedStatus = event.status === "unknown" && event.statusProjection === "stale_running" ? "running" : event.status;
  const validCreatedAt = Number.isFinite(Date.parse(event.createdAt));
  const validUpdatedAt = !event.updatedAt || Number.isFinite(Date.parse(event.updatedAt));
  const status = requestedStatus === "running" && (!validCreatedAt || !validUpdatedAt) ? "unknown" : requestedStatus;
  return {
    id: sanitizeText(event.id, 120),
    workItemId: sanitizeText(event.workItemId, 160),
    label: sanitizeText(event.label, 80),
    detail: sanitizeText(event.detail, 240),
    status,
    createdAt: sanitizeIsoDate(event.createdAt),
    ...(event.updatedAt ? { updatedAt: sanitizeIsoDate(event.updatedAt) } : {}),
    ...(event.evidence ? { evidence: sanitizeText(event.evidence, 260) } : {}),
    ...(isSelectedWorkActionEventKind(event.kind) ? { kind: event.kind } : {}),
    ...(event.sourceLabel ? { sourceLabel: sanitizeText(event.sourceLabel, 100) } : {}),
    ...(event.metrics ? { metrics: sanitizeMetrics(event.metrics) } : {}),
    ...(Array.isArray(event.auditTrail) ? { auditTrail: sanitizeAuditTrail(event.auditTrail) } : {}),
  };
}

function sanitizeText(value: string, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeIsoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function isSelectedWorkActionEventKind(value: unknown): value is SelectedWorkActionEventKind {
  return (
    value === "selected_action" ||
    value === "work_sync" ||
    value === "mail_intake" ||
    value === "schedule_briefing" ||
    value === "document_learning" ||
    value === "approval_notification" ||
    value === "messenger_decision" ||
    value === "notification_permission" ||
    value === "memory_personalization" ||
    value === "automation" ||
    value === "desktop_control" ||
    value === "release_readiness"
  );
}

function sanitizeMetrics(value: SelectedWorkActionEventMetrics): SelectedWorkActionEventMetrics {
  const entries: Array<[string, SelectedWorkActionEventMetrics[string]]> = [];
  for (const [key, metric] of Object.entries(value).slice(0, 80)) {
    const sanitizedKey = sanitizeText(key, 48).replace(/[^A-Za-z0-9_.:-]/g, "_");
    if (!sanitizedKey) continue;
    if (typeof metric === "number") {
      entries.push([sanitizedKey, Number.isFinite(metric) ? metric : 0]);
      continue;
    }
    if (typeof metric === "boolean") {
      entries.push([sanitizedKey, metric]);
      continue;
    }
    entries.push([sanitizedKey, sanitizeText(metric, 120)]);
  }
  return Object.fromEntries(entries);
}

function sanitizeAuditTrail(value: string[]): string[] {
  return value.map((item) => sanitizeText(item, 160)).filter(Boolean).slice(0, 24);
}

function isSelectedWorkActionEvent(value: unknown): value is SelectedWorkActionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<SelectedWorkActionEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.workItemId === "string" &&
    typeof event.label === "string" &&
    typeof event.detail === "string" &&
    typeof event.createdAt === "string" &&
    (event.status === "running" ||
      event.status === "done" ||
      event.status === "needs_desktop" ||
      event.status === "error" ||
      event.status === "unknown")
  );
}
