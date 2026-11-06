/** Pure display rules for the company workspace (kept out of the component so they can be tested). */

const RECENT_REQUEST_MS = 10 * 60_000;
const RESERVED_NAMES = new Set(["회사ai", "회사 ai", "개인ai", "개인 ai", "modycrew", "모디크루"]);
const normalizeName = (value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Only requests that still need attention stay between the conversation and the composer:
 * waiting/running ones, failures from the last few minutes, and a completed answer whose
 * chat message is not loaded (so its text is not lost).
 */
export function visibleCompanyRequests(requests, messages, now = Date.now(), recentMs = RECENT_REQUEST_MS) {
  const answered = new Set((messages || []).map((message) => message?.requestId).filter(Boolean));
  return (requests || []).filter((request) => {
    if (request.status === "queued" || request.status === "running") return true;
    const changedAt = Number(request.updatedAtEpochMs) || Number(request.createdAtEpochMs) || 0;
    const recent = Math.abs(now - changedAt) < recentMs;
    if (request.status === "failed") return recent;
    if (request.status === "completed") return recent && Boolean(request.outputText) && !answered.has(request.id);
    return false;
  });
}

/**
 * Extra identity shown next to an author name. Anyone can pick any display name, so the
 * role comes from the member record and duplicate or look-alike names get the email id.
 */
export function companyAuthorBadge(message, members) {
  if (!message || message.kind === "company_ai") return "";
  const list = Array.isArray(members) ? members : [];
  // Nothing is known before the member list arrives (a company always has at least one member).
  if (!list.length) return "";
  const member = list.find((item) => item.uid === message.authorUid);
  if (!member || member.status !== "active") return "이전 구성원";
  const parts = [];
  if (member.role === "owner") parts.push("소유자");
  else if (member.role === "admin") parts.push("관리자");
  const name = normalizeName(message.authorName || member.displayName);
  const sameName = list.filter((item) => item.status === "active" && normalizeName(item.displayName) === name).length;
  const handle = String(member.email || "").split("@")[0];
  if (handle && (sameName > 1 || RESERVED_NAMES.has(name) || RESERVED_NAMES.has(name.replace(/\s+/g, "")))) parts.push(handle);
  return parts.join(" · ");
}

export const PERSONAL_AI_NOTE = "본인 PC의 AI 답변 · 회사 AI 확인 전";

/** Merge live and older message pages by id, oldest first. */
export function mergeCompanyMessages(older, live) {
  const byId = new Map();
  for (const message of [...(older || []), ...(live || [])]) if (message?.id) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => (a.createdAtEpochMs || 0) - (b.createdAtEpochMs || 0));
}
