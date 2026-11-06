import type { SelectedWorkActionEvent } from "./selected-work-action-events";

export type OfficeWorkMotion = "general" | "reading" | "analyzing" | "drafting";

/** Only fresh, explicitly owned running events can animate work.
 * Free text and finished records are never evidence of an active phase. */
export function officeWorkMotionForEvent(
  event: SelectedWorkActionEvent | undefined, teammateId: string, now: number,
): OfficeWorkMotion | undefined {
  if (!event || event.status !== "running" || event.metrics?.teammateId !== teammateId) return undefined;
  const updatedAt = Date.parse(event.updatedAt ?? event.createdAt);
  const age = now - updatedAt;
  if (!Number.isFinite(age) || age < 0 || age >= 120_000) return undefined;
  const phase = event.metrics?.virtualOfficeStatus;
  if (phase === "approval_pending" || phase === "failed" || phase === "completed" || phase === "idle" || phase === "connection_required") return undefined;
  return phase === "reading" || phase === "analyzing" || phase === "drafting" ? phase : "general";
}

export function officeWorkMotionExpiry(event: SelectedWorkActionEvent | undefined): number | undefined {
  if (!event) return undefined;
  const time = Date.parse(event.updatedAt ?? event.createdAt);
  return Number.isFinite(time) ? time + 120_000 : undefined;
}
