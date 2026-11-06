/**
 * Team-chat unread tracking shared by the app-wide watcher, the company screen and the rail.
 * "Seen" is stored per account as the newest message time the user has had on screen,
 * so it compares message times with message times and never with this PC's clock.
 */
export const COMPANY_UNREAD_EVENT = "modycrew:company-unread";
export const COMPANY_SEEN_EVENT = "modycrew:company-seen";
const STORAGE_PREFIX = "modycrew.company.lastSeen.v1:";
const MAX_KEYS = 500;

export const companyTeamKey = (companyId, teamId) => `${companyId}:${teamId}`;

export function readLastSeen(storage, uid) {
  if (!storage || !uid) return {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_PREFIX + uid) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => typeof key === "string" && Number.isFinite(value)));
  } catch { return {}; }
}

function writeLastSeen(storage, uid, map) {
  try {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, MAX_KEYS);
    storage.setItem(STORAGE_PREFIX + uid, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch { return false; }
}

/** Moves the seen mark forward only. Returns true when it changed. */
export function markCompanyTeamSeen(storage, uid, companyId, teamId, epochMs) {
  if (!storage || !uid || !companyId || !teamId || !Number.isFinite(epochMs) || epochMs <= 0) return false;
  const map = readLastSeen(storage, uid);
  const key = companyTeamKey(companyId, teamId);
  if ((map[key] ?? 0) >= epochMs) return false;
  map[key] = epochMs;
  return writeLastSeen(storage, uid, map);
}

/** A team is unread when its newest message came from someone else after the seen mark. */
export function isCompanyTeamUnread(latest, lastSeenMs, myUid) {
  if (!latest || !Number.isFinite(latest.createdAtEpochMs) || !Number.isFinite(lastSeenMs)) return false;
  return latest.authorUid !== myUid && latest.createdAtEpochMs > lastSeenMs;
}

export function countUnreadCompanyTeams(latestByKey, lastSeen, myUid) {
  let count = 0;
  for (const [key, latest] of Object.entries(latestByKey || {})) if (isCompanyTeamUnread(latest, lastSeen?.[key], myUid)) count += 1;
  return count;
}

/** OS notification only for a genuinely new message from a coworker while the user is elsewhere. */
export function shouldNotifyCompanyMessage({ message, previousId, lastSeenMs, myUid, startedAt, documentHidden, pathname }) {
  if (!message || !message.id || message.id === previousId || message.authorUid === myUid) return false;
  if (!Number.isFinite(message.createdAtEpochMs) || message.createdAtEpochMs < startedAt - 60_000) return false;
  if (Number.isFinite(lastSeenMs) && message.createdAtEpochMs <= lastSeenMs) return false;
  return Boolean(documentHidden) || !String(pathname || "").startsWith("/company");
}

export function companyNotificationContent({ companyName, teamName, message }) {
  const author = message.kind === "company_ai" ? "회사 AI" : message.kind === "personal_ai" ? `${message.authorName || "구성원"}(개인 AI)` : message.authorName || "구성원";
  const text = String(message.text || "").replace(/\s+/g, " ").trim();
  return {
    title: `${companyName || "우리 회사"} · ${teamName || "전체"}`,
    body: `${author}: ${text.length > 120 ? `${text.slice(0, 119)}…` : text}`,
  };
}

let unreadCount = 0;
export function readCompanyUnreadCount() { return unreadCount; }
export function publishCompanyUnreadCount(count) {
  const next = Math.max(0, Number(count) || 0);
  if (next === unreadCount) return;
  unreadCount = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(COMPANY_UNREAD_EVENT, { detail: { count: next } }));
}
