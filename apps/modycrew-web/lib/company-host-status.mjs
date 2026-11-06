import { clockSkewNotice } from "./company-clock.mjs";

/**
 * What the main PC's company-AI loop last ran into, kept only in this window's memory.
 * Coworkers see a generic failure; the owner of the main PC sees the real cause here.
 * Each step (heartbeat, claim, process, ...) is tracked on its own so that a working
 * heartbeat does not hide a claim that keeps failing.
 */
const statuses = new Map();
const listeners = new Set();

function errorCode(error) {
  return typeof error === "object" && error && "code" in error ? String(error.code || "") : "";
}
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}
function emit(companyId) {
  const snapshot = readCompanyHostStatus(companyId);
  for (const listener of [...listeners]) {
    try { listener(companyId, snapshot); } catch { /* A broken listener must not stop the host loop. */ }
  }
}
function entry(companyId) {
  const value = statuses.get(companyId) || { errors: {}, oks: {} };
  statuses.set(companyId, value);
  return value;
}

export function reportCompanyHostIssue(companyId, kind, error, at = Date.now()) {
  if (!companyId) return;
  entry(companyId).errors[String(kind || "host")] = {
    code: errorCode(error).slice(0, 80),
    message: errorMessage(error).replace(/\s+/g, " ").trim().slice(0, 400),
    at,
  };
  emit(companyId);
}

export function reportCompanyHostOk(companyId, kind = "host", at = Date.now()) {
  if (!companyId) return;
  const value = entry(companyId);
  const key = String(kind || "host");
  const hadError = Boolean(value.errors[key]);
  value.oks[key] = at;
  if (hadError) emit(companyId);
}

/** The newest problem that has not been followed by a success of the same step, or null. */
export function readCompanyHostStatus(companyId) {
  const value = statuses.get(companyId);
  if (!value) return null;
  const open = Object.entries(value.errors)
    .filter(([kind, error]) => !(value.oks[kind] >= error.at))
    .sort((a, b) => b[1].at - a[1].at)[0];
  return open ? { kind: open[0], code: open[1].code, message: open[1].message, at: open[1].at } : null;
}

export function subscribeCompanyHostStatus(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearCompanyHostStatus() { statuses.clear(); }

/** A short Korean explanation of the latest unresolved main-PC problem, or ''. */
export function describeCompanyHostIssue(status, skewMs = null) {
  if (!status?.at) return "";
  const clock = clockSkewNotice(skewMs);
  const code = `${status.code || ""} ${status.message || ""}`;
  if (/permission-denied|insufficient permissions|permission denied/i.test(code)) {
    return clock || "회사 서버가 이 PC의 AI 처리 기록을 받지 않았어요. 이 PC가 아직 회사 메인 PC로 지정돼 있는지 확인해 주세요.";
  }
  if (/unavailable|network|failed to fetch|offline|deadline-exceeded/i.test(code)) {
    return "인터넷 연결이 불안정해 회사 요청을 가져오지 못했어요. 연결되면 자동으로 다시 시도해요.";
  }
  return status.message || "메인 PC에서 회사 AI 요청을 처리하지 못했어요.";
}
