// Main-process evidence for the always-on work UI. Never infer activity from an animation.
const services = { tasks: "예약·맡긴 업무", mail: "메일·일정 점검", company: "회사 자동화" };
const validDate = (value) => Number.isFinite(Date.parse(value)) ? value : "";

export function summarizeBackgroundWork({ tasks = [], rules = [], company = {}, approvalCount = 0 } = {}, now = Date.now()) {
  const open = tasks.filter((task) => task.status !== "done");
  const executions = open.map((task) => task.execution).filter(Boolean);
  const dates = [
    ...executions.filter((run) => run.state === "queued").map((run) => run.retryAt || run.dueAt),
    ...(company.rules ?? []).filter((rule) => rule.enabled && rule.trigger === "schedule").map((rule) => rule.nextRetryAt || rule.nextRunAt),
  ].filter(validDate).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    running: executions.filter((run) => run.state === "running").length,
    queued: executions.filter((run) => run.state === "queued").length,
    retrying: executions.filter((run) => run.state === "queued" && run.retryAt).length,
    waiting: open.filter((task) => ["waiting_input", "waiting_approval", "failed"].includes(task.execution?.state)).length,
    approvals: Math.max(0, Number(approvalCount) || 0),
    paused: executions.filter((run) => run.state === "paused").length,
    completedToday: tasks.filter((task) => {
      const completed = task.execution?.lastCompletedAt;
      return validDate(completed) && new Date(completed).toDateString() === new Date(now).toDateString();
    }).length,
    enabledRules: rules.filter((rule) => rule.enabled).length + (company.rules ?? []).filter((rule) => rule.enabled).length,
    connections: (company.connections ?? []).filter((connection) => connection.enabled).length,
    connectionErrors: (company.connections ?? []).filter((connection) => connection.enabled && (connection.error || connection.status === "attention")).length,
    nextRunAt: dates[0] || "",
  };
}

export function createBackgroundService(options = {}) {
  const clock = options.now ?? Date.now;
  const startedAt = new Date(clock()).toISOString();
  const health = new Map();
  let suspended = false;
  let lastResumedAt = "";
  let stopped = false;
  let blockerId = null;
  let waking;
  let statusRead;

  function record(id, state) {
    if (!services[id] || stopped) return;
    const previous = health.get(id);
    health.set(id, { id, label: services[id], state, checkedAt: new Date(clock()).toISOString(),
      lastSuccessAt: state === "ready" ? new Date(clock()).toISOString() : previous?.lastSuccessAt || "" });
  }
  function snapshot() {
    const workers = Object.entries(services).map(([id, label]) => {
      const row = health.get(id) ?? { id, label, state: "starting", checkedAt: "", lastSuccessAt: "" };
      // A busy job has a larger allowance than the idle polling interval.
      const allowance = row.state === "checking" ? 10 * 60_000 : 150_000;
      return { ...row, state: row.checkedAt && clock() - Date.parse(row.checkedAt) > allowance ? "stale" : row.state };
    });
    return { startedAt, checkedAt: new Date(clock()).toISOString(), lastResumedAt,
      state: stopped ? "stopped" : suspended ? "sleeping" : workers.some((row) => ["error", "stale"].includes(row.state)) ? "attention"
        : workers.some((row) => row.state === "starting") ? "starting" : "ready",
      workers, keepAwakeActive: blockerId !== null && options.powerSaveBlocker?.isStarted(blockerId) === true };
  }
  function setKeepAwake(enabled) {
    if (enabled && !stopped && !snapshot().keepAwakeActive) {
      if (!options.powerSaveBlocker) throw new Error("이 환경에서는 절전 방지를 설정할 수 없습니다.");
      blockerId = options.powerSaveBlocker.start("prevent-app-suspension");
    } else if (!enabled && blockerId !== null) {
      options.powerSaveBlocker?.stop(blockerId);
      blockerId = null;
    }
  }
  function resume() {
    if (stopped) return Promise.resolve();
    suspended = false;
    lastResumedAt = new Date(clock()).toISOString();
    // OS resume/unlock can arrive together. The runners also hold their own locks.
    waking ??= Promise.allSettled(Object.entries(options.wake ?? {}).map(async ([id, wake]) => {
      record(id, "checking");
      try { await wake(); if (health.get(id)?.state !== "error") record(id, "ready"); } catch { record(id, "error"); }
    })).finally(() => { waking = undefined; });
    return waking;
  }
  async function status() {
    statusRead ??= (async () => {
      let timeout;
      try {
        const overview = await Promise.race([
          Promise.resolve().then(() => options.readOverview?.() ?? {}),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("status timeout")), 5000); }),
        ]);
        return { status: "background_service_ready", ...snapshot(), summary: summarizeBackgroundWork(overview, clock()),
          preferences: options.preferences?.() ?? {}, canOpenAtLogin: options.canOpenAtLogin?.() === true };
      } catch {
        return { status: "background_service_unavailable", ...snapshot(), state: "attention",
          userMessage: "업무 상태를 읽지 못했습니다. 잠시 후 다시 확인해 주세요." };
      } finally { clearTimeout(timeout); }
    })().finally(() => { statusRead = undefined; });
    return statusRead;
  }
  return { record, snapshot, status, setKeepAwake, resume,
    suspend() { suspended = true; },
    stop() { stopped = true; setKeepAwake(false); },
  };
}
