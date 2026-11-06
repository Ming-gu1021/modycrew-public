/**
 * 업무 상태 정본 — 채팅·승인함·사무실·알림·크루 스킬 실행기가 같은 상태 이름과 같은 판정을 쓴다.
 *
 * Herdr(herdrdev/herdr-app v0.1.11·herdr-core v0.1.16, Apache-2.0)의 사용 경험을 참고해 모디크루 구조에 맞게
 * 새로 썼다. 코드는 옮기지 않았다(2026-11-02 원문 확인).
 *   - 실행기가 직접 남긴 상태만 쓴다. 응답이 늦다는 이유만으로 완료·실패를 추측하지 않는다.
 *   - 멈춘 일은 이유(답변·승인·로그인)를 함께 남겨 "내 확인 필요"에 모은다(herdr 의 blocked kind: question·permission·auth).
 *   - 결과가 불확실한 작업(사용자 폴더 변경·발송·결제)은 자동으로 다시 실행하지 않는다.
 *   - 회사·작업 공간 범위를 지정하면 범위가 다른 항목과 범위가 없는 항목을 모두 뺀다.
 */

                                                          
export const modyWorkStatuses = Object.freeze([
  "queued", "running", "needs_input", "needs_approval", "completed", "failed", "disconnected", "cancelled",
] as const);
export type ModyWorkStatus = (typeof modyWorkStatuses)[number];

export const modyWorkStatusLabels: Readonly<Record<ModyWorkStatus, string>> = Object.freeze({
  queued: "대기",
  running: "실행 중",
  needs_input: "사용자 답변 필요",
  needs_approval: "승인 대기",
  completed: "완료",
  failed: "실패",
  disconnected: "연결 끊김",
  cancelled: "취소",
});

/** 사용자가 움직여야 하는 이유. needs_input 은 answer·login·design_review 중 하나다. */
export type ModyAttentionReason =
  | "answer"          // 크루가 사용자 답을 기다림
  | "login"           // 로그인·연결이 필요해 멈춤
  | "design_review"   // 큰 변경이라 설계 확인 뒤에 구현
  | "approval"        // 실행 확인·승인 대기
  | "unknown_outcome" // 앱 종료·신호 끊김으로 결과를 확인해야 함
  | "failure"         // 실패 — 다시 할지 사용자가 정함
  | "save_retry";     // 결과는 받았지만 저장이 실패함

export type ModyWorkState = { status: ModyWorkStatus; reason?: ModyAttentionReason };

/** 작업이 바깥에 남기는 영향. 결과가 불확실할 때 다시 실행해도 되는지의 기준이다. */
export type ModyWorkEffect = "read_only" | "local_output" | "external_effect";

const terminalStatuses = new Set<ModyWorkStatus>(["completed", "failed", "cancelled"]);
const attentionStatuses = new Set<ModyWorkStatus>(["needs_input", "needs_approval", "disconnected", "failed"]);

export function isModyWorkStatus(value: unknown): value is ModyWorkStatus {
  return typeof value === "string" && (modyWorkStatuses as readonly string[]).includes(value);
}

export function isModyAttentionReason(value: unknown): value is ModyAttentionReason {
  return typeof value === "string" && ["answer", "login", "design_review", "approval", "unknown_outcome", "failure", "save_retry"].includes(value);
}

export function isTerminalWorkStatus(status: ModyWorkStatus): boolean {
  return terminalStatuses.has(status);
}

/** 화면 표시 이름. 같은 '사용자 답변 필요'라도 로그인·설계 확인은 그 이름으로 보여 준다. */
export function workStatusLabel(state: ModyWorkState): string {
  if (state.status === "needs_input" && state.reason === "login") return "로그인 필요";
  if (state.status === "needs_input" && state.reason === "design_review") return "설계 확인 필요";
  // 실행은 멈췄거나 끝났지만 실제로 무엇이 바뀌었는지 사람이 봐야 하는 경우(PC 작업 결과 불확실·변경이 남은 채 멈춘 크루 실행).
  if (state.status === "needs_input" && state.reason === "unknown_outcome") return "결과 확인 필요";
  return modyWorkStatusLabels[state.status];
}

/** "내 확인 필요"에 모을 상태. 실패와 연결 끊김도 사람이 다음 행동을 정해야 하므로 포함한다. */
export function needsUserAttention(status: ModyWorkStatus): boolean {
  return attentionStatuses.has(status);
}

const transitions: Readonly<Record<ModyWorkStatus, readonly ModyWorkStatus[]>> = Object.freeze({
  queued: ["running", "needs_approval", "needs_input", "cancelled", "failed"],
  needs_approval: ["running", "cancelled", "failed", "disconnected"],
  // 설계 확인(design_review)을 받아 구현 실행으로 넘긴 계획 기록은 그 자리에서 끝난다(구현 결과는 새 실행 기록이 가진다).
  needs_input: ["running", "needs_approval", "completed", "cancelled", "failed", "disconnected"],
  running: ["completed", "failed", "needs_input", "needs_approval", "disconnected", "cancelled"],
  // 연결 끊김 뒤에는 사용자가 결과를 확인하고 정한다. 저장된 결과가 있으면 completed 로만 옮길 수 있다.
  disconnected: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
});

/** 기록을 덮어쓸 때 쓰는 상태 전환 검사. 끝난 기록을 다시 '실행 중'으로 되돌리지 못하게 한다. */
export function canTransitionWorkStatus(from: ModyWorkStatus, to: ModyWorkStatus): boolean {
  return from === to || transitions[from].includes(to);
}

/**
 * 같은 작업을 다시 보내도 되는지. 바깥 영향이 있는 작업은 결과가 불확실하면 사용자 확인 없이 다시 실행하지 않는다.
 * 다시 실행은 언제나 새 실행 기록으로 남긴다(이전 기록을 덮어쓰지 않는다).
 */
export function workRetryDecision(input: { status: ModyWorkStatus; effect: ModyWorkEffect; userConfirmed?: boolean }): { allowed: boolean; reason: string } {
  if (input.status === "completed") return { allowed: false, reason: "이미 끝난 작업입니다. 새 요청으로 시작해 주세요." };
  if (input.status === "running" || input.status === "needs_approval" || input.status === "needs_input" || input.status === "queued") {
    return { allowed: false, reason: "진행 중이거나 답을 기다리는 작업입니다. 끝나거나 취소된 뒤에 다시 시도할 수 있어요." };
  }
  if (input.status === "disconnected" && input.effect !== "read_only" && !input.userConfirmed) {
    return { allowed: false, reason: "결과를 확인할 수 없는 작업입니다. 실제로 반영됐는지 먼저 확인한 뒤 다시 실행할지 정해 주세요." };
  }
  if (input.effect === "external_effect" && !input.userConfirmed) {
    return { allowed: false, reason: "바깥에 영향을 주는 작업이라 사용자가 다시 확인해야 합니다." };
  }
  return { allowed: true, reason: "다시 실행할 수 있습니다. 새 실행으로 기록합니다." };
}

export type ModyAttention = { reason: ModyAttentionReason; label: string; nextAction: string };

const attentionByReason: Readonly<Record<ModyAttentionReason, Omit<ModyAttention, "reason">>> = Object.freeze({
  approval: { label: "승인이 필요해요", nextAction: "확인 창이나 승인함에서 실행할지 정해 주세요." },
  answer: { label: "답변이 필요해요", nextAction: "해당 대화로 가서 크루의 질문에 답해 주세요." },
  login: { label: "로그인이 필요해요", nextAction: "AI 연결 화면에서 로그인을 마친 뒤 다시 실행해 주세요." },
  design_review: { label: "설계 확인이 필요해요", nextAction: "설계안을 확인하고 대화에서 '이대로 구현'이라고 답하면 구현을 이어 갑니다." },
  unknown_outcome: { label: "결과 확인이 필요해요", nextAction: "앱 종료·연결 끊김·확인하지 못한 실행 때문에 결과를 모릅니다. 화면이나 결과 폴더를 확인한 뒤 다시 실행할지 정해 주세요(자동으로 다시 실행하지 않음)." },
  failure: { label: "실패했어요", nextAction: "이유를 확인하고 요청을 고치거나 새로 실행해 주세요." },
  save_retry: { label: "저장을 다시 해야 해요", nextAction: "AI를 다시 부르지 않고 저장만 다시 시도할 수 있어요." },
});

/** 상태 → 확인 이유. 명시한 이유가 있으면 그것을 쓴다(예: 실패 중 저장 문제). */
export function attentionForWorkState(state: ModyWorkState): ModyAttention | null {
  if (!needsUserAttention(state.status)) return null;
  const fallback: ModyAttentionReason = state.status === "needs_approval" ? "approval"
    : state.status === "needs_input" ? "answer"
      : state.status === "disconnected" ? "unknown_outcome"
        : "failure";
  const reason = state.reason && isModyAttentionReason(state.reason) ? state.reason : fallback;
  return { reason, ...attentionByReason[reason] };
}

const loginPattern = /로그인|login|logged in|unauthori[sz]ed|authenticat|인증이 필요|연결이 필요/iu;

/** 실패 사유 문장에서 로그인 문제를 가려낸다. 로그인 문제는 실패가 아니라 '로그인 필요'로 보여 준다. */
export function workStateFromFailureMessage(message: string | undefined): ModyWorkState {
  return loginPattern.test(String(message ?? "")) ? { status: "needs_input", reason: "login" } : { status: "failed", reason: "failure" };
}

// ── 기존 상태값 읽기 ──────────────────────────────────────────────────────────

/** 크루 스킬 실행 기록 → 공통 상태. 새 기록은 workStatus·workReason 을 직접 남긴다. */
export function workStateFromCrewSkillRun(run: { status?: string; workStatus?: string; workReason?: string; userMessage?: string } | null | undefined): ModyWorkState {
  if (run && isModyWorkStatus(run.workStatus)) {
    return { status: run.workStatus, ...(isModyAttentionReason(run.workReason) ? { reason: run.workReason } : {}) };
  }
  const status = String(run?.status ?? "");
  if (status === "queued") return { status: "queued" };
  if (status === "confirming" || status === "checking") return { status: "needs_approval", reason: "approval" };
  if (status === "running") return { status: "running" };
  if (status === "completed") return { status: "completed" };
  if (status === "cancelled" || status === "declined") return { status: "cancelled" };
  if (status === "interrupted" || status === "disconnected") return { status: "disconnected", reason: "unknown_outcome" };
  if (status === "save_failed" || status === "result_ready") return { status: "failed", reason: "save_retry" };
  if (status === "failed") return workStateFromFailureMessage(run?.userMessage);
  return { status: "disconnected", reason: "unknown_outcome" };
}

/** 업무 이벤트(selected-work-action-events) → 공통 상태. metrics.workStatus 가 있으면 그것이 정본이다. */
export function workStateFromWorkEvent(event: { status?: string; statusProjection?: string; metrics?: Record<string, unknown> } | null | undefined): ModyWorkState {
  const declared = event?.metrics?.workStatus;
  const declaredReason = event?.metrics?.workReason;
  if (isModyWorkStatus(declared)) {
    // 실행 중이라고 적혀 있어도 신호가 오래 끊긴 기록은 실행 중으로 보지 않는다.
    if (declared === "running" && event?.statusProjection === "stale_running") return { status: "disconnected", reason: "unknown_outcome" };
    return { status: declared, ...(isModyAttentionReason(declaredReason) ? { reason: declaredReason } : {}) };
  }
  const office = event?.metrics?.virtualOfficeStatus;
  switch (event?.status) {
    case "running": return office === "approval_pending" ? { status: "needs_approval", reason: "approval" } : office === "connection_required" ? { status: "needs_input", reason: "login" } : { status: "running" };
    case "done": return office === "approval_pending" ? { status: "needs_approval", reason: "approval" } : { status: "completed" };
    case "error": return office === "connection_required" ? { status: "needs_input", reason: "login" } : { status: "failed", reason: "failure" };
    case "needs_desktop": return { status: "needs_input", reason: "login" };
    default: return { status: "disconnected", reason: "unknown_outcome" };
  }
}

/** 사무실 캐릭터 상태(virtual-office-events) → 공통 상태. */
export function workStatusFromOfficeStatus(status: string | null | undefined): ModyWorkStatus {
  switch (status) {
    case "idle": return "queued";
    case "approval_pending": return "needs_approval";
    case "connection_required": return "needs_input";
    case "failed": return "failed";
    case "completed": return "completed";
    case "reading": case "analyzing": case "drafting": case "problem_solving": return "running";
    default: return "disconnected";
  }
}

export type ModyOfficeActivity = "reading" | "analyzing" | "drafting" | "problem_solving";
export type ModyLegacyWorkEventStatus = "running" | "done" | "needs_desktop" | "error" | "unknown";

/**
 * 공통 상태 → 기존 업무 이벤트 저장 형식. 사무실은 metrics.virtualOfficeStatus 를, 새 화면은 metrics.workStatus 를 읽는다.
 * 기존 형식에 '취소'·'연결 끊김'이 없어 가장 가까운 값을 쓰고, 정본 상태는 workStatus 로 함께 남긴다.
 * 사람을 기다리는 상태(승인 대기·답변·설계 확인)는 'done + approval_pending' 이다. 사무실 화면과 이벤트 저장소는
 * 'running' 이벤트를 2분 뒤 '확인 불가'·실패로 바꾸므로, 오래 기다리는 승인을 running 으로 두면 멈춘 일로 잘못 보인다
 * (사무실 화면은 done+approval_pending 을 '준비가 끝난 승인 후보'로 계속 보여 준다).
 */
export function officeSignalForWorkState(state: ModyWorkState, activity: ModyOfficeActivity = "drafting"): { eventStatus: ModyLegacyWorkEventStatus; officeStatus: string } {
  switch (state.status) {
    case "queued": return { eventStatus: "unknown", officeStatus: "idle" };
    case "running": return { eventStatus: "running", officeStatus: activity };
    case "needs_approval": return { eventStatus: "done", officeStatus: "approval_pending" };
    case "needs_input": return state.reason === "login" ? { eventStatus: "needs_desktop", officeStatus: "connection_required" } : { eventStatus: "done", officeStatus: "approval_pending" };
    case "completed": return { eventStatus: "done", officeStatus: "completed" };
    case "failed": return { eventStatus: "error", officeStatus: "failed" };
    case "cancelled": return { eventStatus: "done", officeStatus: "idle" };
    case "disconnected": return { eventStatus: "unknown", officeStatus: "unknown" };
  }
}

// ── 내 확인 필요 ─────────────────────────────────────────────────────────────

export type ModyAttentionSource = "crew_skill" | "work_event" | "approval" | "chat";
export type ModyWorkItem = ModyWorkState & {
  id: string;
  source: ModyAttentionSource;
  title: string;
  detail?: string;
  /** 바로 이동할 대화·승인 항목·실행 기록. */
  threadId?: string;
  approvalId?: string;
  runId?: string;
  teammateId?: string;
  teammateName?: string;
  /** 회사·작업 공간 구분. 범위를 지정한 조회에는 같은 범위의 항목만 남는다. */
  scopeKey?: string;
  updatedAt: string;
};
export type ModyAttentionItem = ModyWorkItem & ModyAttention & { priority: number; statusLabel: string };

const attentionPriority: Readonly<Record<ModyAttentionReason, number>> = Object.freeze({
  approval: 0, login: 1, answer: 2, design_review: 2, save_retry: 3, unknown_outcome: 4, failure: 5,
});

/**
 * 여러 출처의 업무에서 사용자가 해야 할 일만 모은다.
 * scopeKey 를 주면 그 범위의 항목만 남긴다 — 범위가 없는 항목도 다른 회사 자료일 수 있어 뺀다.
 * 같은 id 는 가장 최근 것 하나만 남긴다(채팅·사무실이 같은 실행을 각각 보고해도 한 줄로 보인다).
 */
export function buildAttentionItems(items: readonly ModyWorkItem[], options: { scopeKey?: string; limit?: number } = {}): ModyAttentionItem[] {
  const latest = new Map<string, ModyWorkItem>();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !isModyWorkStatus(item.status)) continue;
    if (options.scopeKey !== undefined && item.scopeKey !== options.scopeKey) continue;
    const current = latest.get(item.id);
    const time = Date.parse(item.updatedAt);
    if (!current || (Number.isFinite(time) && time >= Date.parse(current.updatedAt))) latest.set(item.id, item);
  }
  const result: ModyAttentionItem[] = [];
  for (const item of latest.values()) {
    const attention = attentionForWorkState(item);
    if (!attention) continue;
    result.push({ ...item, ...attention, priority: attentionPriority[attention.reason], statusLabel: workStatusLabel(item) });
  }
  result.sort((a, b) => a.priority - b.priority || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 30)));
  return result.slice(0, limit);
}

/**
 * 실행이 어디까지 이어지는지. 코드로 보장하는 것과 측정하지 않은 것을 나눠 화면에 그대로 보여 준다.
 * guaranteed=false 인 항목은 '이어질 수 있음'으로만 말하고 계속 실행된다고 표시하지 않는다.
 */
export const modyWorkPersistence: Readonly<Record<"window_closed" | "app_quit" | "sleep" | "reboot" | "pc_off", { label: string; note: string; guaranteed: boolean }>> = Object.freeze({
  window_closed: { label: "창 닫기", note: "창을 닫아도 모디크루는 백그라운드에서 실행 중이라 진행 중인 크루 작업이 이어집니다.", guaranteed: true },
  app_quit: { label: "앱 완전 종료", note: "앱을 완전히 종료하면 진행 중인 크루 작업을 멈추고 '연결 끊김'으로 남깁니다. 다시 열어도 자동으로 다시 실행하지 않습니다.", guaranteed: true },
  sleep: { label: "PC 절전", note: "절전 중에는 작업도 함께 멈춥니다. 깨어난 뒤 이어질지, 시간 초과로 끝날지는 아직 측정하지 않았습니다.", guaranteed: false },
  reboot: { label: "PC 재시작", note: "PC를 다시 시작하면 진행 중인 작업은 끝나고, 앱을 다시 열면 '연결 끊김'으로 보입니다.", guaranteed: true },
  pc_off: { label: "PC 꺼짐", note: "PC가 꺼져 있는 동안에는 이 PC의 크루 작업이 실행되지 않습니다.", guaranteed: true },
});

