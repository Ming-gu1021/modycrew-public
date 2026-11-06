/** Decisions of the main-PC loop, kept pure so they can be tested without Firebase. */

// A queued request the main PC keeps failing to claim blocks its requester's only slot.
export const COMPANY_STUCK_REQUEST_MS = 10 * 60_000;
export const COMPANY_STUCK_MESSAGE = "메인 PC가 이 요청을 처리하지 못했어요. 메인 PC의 AI 연결을 확인한 뒤 다시 요청해 주세요.";
// Answering a question from days ago with today's conversation would mislead.
export const COMPANY_STALE_REQUEST_MS = 24 * 60 * 60_000;
export const COMPANY_STALE_MESSAGE = "요청한 지 하루가 넘어 처리하지 않았어요. 필요하면 다시 요청해 주세요.";

/**
 * Owners and admins keep watching the main-PC setting (they may become the main PC from the
 * company screen). A plain member is checked once per membership change instead of every
 * employee PC listening to the 30-second heartbeat; a member can only be the main PC after an
 * admin who hosted was demoted, which arrives as a membership change.
 */
export function companyHostWatchMode(membership) {
  return membership?.role === "owner" || membership?.role === "admin" ? "watch" : "check";
}

export function isThisCompanyHost(host, uid, deviceId) {
  return Boolean(host?.enabled && host.uid === uid && host.deviceId === deviceId);
}

/** Before claiming: a queued request older than a day is closed instead of answered. */
export function staleCompanyRequestMessage(request, serverNow) {
  const age = serverNow - Number(request?.createdAtEpochMs || serverNow);
  return request?.status === "queued" && age > COMPANY_STALE_REQUEST_MS ? COMPANY_STALE_MESSAGE : "";
}

/** After claim failures: close a waiting request only when it has failed repeatedly for a while and is old enough. */
export function stuckCompanyRequestMessage(request, failure, serverNow, localNow) {
  if (request?.status !== "queued" || !failure) return "";
  const age = serverNow - Number(request.createdAtEpochMs || serverNow);
  return failure.count >= 3 && localNow - failure.first >= 60_000 && age >= COMPANY_STUCK_REQUEST_MS ? COMPANY_STUCK_MESSAGE : "";
}
