/**
 * Server-clock estimate for the company workspace.
 *
 * Firestore rules compare client epoch fields with the server time (±60s, and AI
 * leases within +185s). A PC whose Windows clock drifts a few seconds therefore
 * gets silently rejected. This estimator only uses server timestamps the app
 * already receives, so it adds no reads:
 *  - own writes: we remember the local time we stamped, and when the server copy
 *    of that same write comes back we know `server - local` (plus a little
 *    network latency, which only ever makes the sample larger).
 *  - arrivals: a live update of someone else's write (the main PC heartbeat)
 *    gives `local receive time - server write time` (skew plus delivery delay).
 * Own-write samples are precise and are the only ones used to correct writes.
 * Arrival samples are only used to explain a rejection ("your clock is off").
 * A server copy that comes back long after the write was stamped (sent while offline,
 * a slow or retried commit) would overstate the offset and push AI leases past the
 * rules' bound, so only copies that return within `settleMs` become samples.
 */
export function createCompanyClock({
  now = () => Date.now(),
  maxSamples = 5,
  sampleTtlMs = 10 * 60_000,
  pendingTtlMs = 2 * 60_000,
  maxPending = 200,
  settleMs = 5_000,
} = {}) {
  const pending = new Map();
  let own = [];
  let arrivals = [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  function prune(at = now()) {
    own = own.filter((sample) => at - sample.at <= sampleTtlMs).slice(-maxSamples);
    arrivals = arrivals.filter((sample) => at - sample.at <= sampleTtlMs).slice(-maxSamples);
    for (const [key, entry] of pending) if (at - entry.at > pendingTtlMs) pending.delete(key);
    while (pending.size > maxPending) pending.delete(pending.keys().next().value);
  }
  function offsetMs() {
    prune();
    if (!own.length) return 0;
    // Latency only inflates `server - local`, so the smallest recent sample is the best one.
    return Math.min(...own.map((sample) => sample.offset));
  }
  return {
    /** Remember the raw local time used for a write we are about to send. */
    expectOwnWrite(key, localMs) {
      if (!key || !finite(localMs)) return;
      pending.set(String(key), { localMs, at: now() });
      prune();
    },
    /** The server copy of our own write arrived; returns true when it produced a sample. */
    observeOwnWrite(key, serverMs) {
      const entry = pending.get(String(key));
      if (!entry || !finite(serverMs)) return false;
      pending.delete(String(key));
      if (now() - entry.at > settleMs) return false;
      own.push({ offset: serverMs - entry.localMs, at: now() });
      prune();
      return true;
    },
    /** A live update of another writer's server timestamp arrived now. */
    observeArrival(serverMs, receivedLocalMs = now()) {
      if (!finite(serverMs) || !finite(receivedLocalMs)) return;
      arrivals.push({ skew: receivedLocalMs - serverMs, at: now() });
      prune();
    },
    /** server - local, from precise own-write samples only (0 when unknown). */
    offsetMs,
    /** Local time corrected to the server clock. */
    serverNow() { return now() + offsetMs(); },
    /** Convert a raw local time to the server clock. */
    toServer(localMs) { return localMs + offsetMs(); },
    /** local - server estimate in ms, or null when there is no evidence yet. */
    skewMs() {
      prune();
      if (own.length) return -Math.min(...own.map((sample) => sample.offset));
      if (arrivals.length) return Math.min(...arrivals.map((sample) => sample.skew));
      return null;
    },
    hasPreciseSample() { prune(); return own.length > 0; },
    reset() { pending.clear(); own = []; arrivals = []; },
  };
}

/** Shared by company-client (writes), the main-PC loop and the company screen. */
export const companyClock = createCompanyClock();

export const COMPANY_CLOCK_SKEW_NOTICE_MS = 50_000;

function durationLabel(ms) {
  const seconds = Math.round(Math.abs(ms) / 1000);
  if (seconds < 120) return `${seconds}초`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes}분`;
  return `${Math.round(minutes / 60)}시간`;
}

/** Korean clock-sync instruction when |skew| is large enough to break server checks, else ''. */
export function clockSkewNotice(skewMs, threshold = COMPANY_CLOCK_SKEW_NOTICE_MS) {
  if (typeof skewMs !== "number" || !Number.isFinite(skewMs) || Math.abs(skewMs) <= threshold) return "";
  const direction = skewMs > 0 ? "빠르게" : "느리게";
  return `이 PC의 시계가 실제 시각보다 약 ${durationLabel(skewMs)} ${direction} 맞춰져 있어 회사 서버가 요청을 받지 않았어요. Windows 설정 > 시간 및 언어 > 날짜 및 시간에서 [지금 동기화]를 누른 뒤 다시 시도해 주세요.`;
}
