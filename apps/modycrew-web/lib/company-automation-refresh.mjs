/**
 * How often the '회사 운영' screen asks the desktop app for a fresh status.
 *
 * A status call re-reads the whole company ledger, so the screen does not poll forever.
 * It still has to follow anything that can change without the user touching this screen:
 *  - work that is moving (queued/running/being merged): every 15 seconds;
 *  - work that is not finished yet (needs an answer, failed, paused, waiting for approval):
 *    every minute, because the desktop runtime, the approval inbox or the task board can
 *    move it on;
 *  - enabled mail/messenger connections or rules: every minute (they can start new work);
 *  - for a couple of minutes after the user acted on this screen: every 15 seconds, because
 *    some actions (answering a department's question, retry/resume through the task board)
 *    return no new state and only show up on the next runtime tick.
 */
export const COMPANY_REFRESH_FAST_MS = 15_000;
export const COMPANY_REFRESH_SLOW_MS = 60_000;
export const COMPANY_REFRESH_KICK_MS = 2 * 60_000;

const MOVING = new Set(["queued", "running", "ready_to_merge"]);
const FINISHED = new Set(["completed", "cancelled"]);
// Actions that only read or preview; they cannot move a work, so they do not speed up polling.
const READ_ONLY_ACTS = new Set(["status", "read_record", "review_accounting", "export_accounting", "open_setup", "propose_setup", "discover_channels", "check_relay"]);

function isMoving(work) {
  return MOVING.has(work?.status) || MOVING.has(work?.masterStatus || "")
    || (Array.isArray(work?.tasks) && work.tasks.some((task) => task?.status === "queued" || task?.status === "running"));
}

/** Milliseconds between background refreshes, or 0 when nothing can change without the user acting. */
export function companyRefreshInterval(state, { now = Date.now(), kickUntil = 0 } = {}) {
  if (now < kickUntil) return COMPANY_REFRESH_FAST_MS;
  if (!state) return 0;
  const works = Array.isArray(state.works) ? state.works : [];
  if (works.some(isMoving)) return COMPANY_REFRESH_FAST_MS;
  if (works.some((work) => !FINISHED.has(work?.status))) return COMPANY_REFRESH_SLOW_MS;
  const listening = (state.connections || []).some((connection) => connection?.enabled) || (state.rules || []).some((rule) => rule?.enabled);
  return listening ? COMPANY_REFRESH_SLOW_MS : 0;
}

/** Whether an action on the screen should follow up with faster refreshes for a while. */
export function companyActKicksRefresh(kind) {
  return !READ_ONLY_ACTS.has(String(kind || ""));
}
