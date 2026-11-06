/**
 * 알림을 눌렀을 때 "어느 카드로 옮길지" 정하는 규칙과, 창 안에서 그 요청을 전달하는 작은 우편함.
 *
 * 예전에는 알림을 누르면 main 이 창 전체를 `?workItem=&queue=` 주소로 다시 불러왔다.
 * 그러면 작성 중인 글과 만들고 있던 AI 답변이 사라진다. 이제 main 은 신호만 보내고,
 * 화면은 주소로 들어올 때와 같은 규칙(아래 predicate)으로 그 카드를 연다.
 */
export type WorkItemFocusRequest = {
  workItemId: string;
  queue: string;
  /** "task" = 업무판(TaskBoard)의 맡긴 업무. 비어 있으면 승인함·일정 카드. */
  kind: string;
  receivedAt: number;
};

export type WorkItemFocusTarget = "schedule_briefing" | "mail_calendar" | "office_approval" | "office_task" | "none";

const focusQueues = new Set(["approval", "deadline", "meeting", "today"]);
const focusKinds = new Set(["task"]);
const pendingTtlMs = 120_000;

/** 주소 `?workItem=&queue=` 로 들어왔을 때 일정 브리핑으로 보는 조건과 같다. */
export function isScheduleBriefingFocus(workItemId: string, queue: string | null | undefined): boolean {
  return queue === "meeting" || workItemId.includes("schedule-briefing");
}

/** 주소로 들어왔을 때 메일→일정 확인 카드로 보는 조건과 같다. */
export function isMailCalendarFocus(workItemId: string): boolean {
  return Boolean(workItemId) && workItemId.includes("mail-calendar");
}

export function normalizeWorkItemFocusRequest(raw: unknown, now: number = Date.now()): WorkItemFocusRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const workItemId = String(record.workItemId ?? "")
    .replace(/[^A-Za-z0-9:_./-]/g, "")
    .slice(0, 180);
  const queueText = String(record.queue ?? "");
  const queue = focusQueues.has(queueText) ? queueText : "";
  const kindText = String(record.kind ?? "");
  const kind = focusKinds.has(kindText) ? kindText : "";
  if (!workItemId && !queue && !kind) return null;
  return { workItemId, queue, kind, receivedAt: now };
}

export function classifyWorkItemFocusTarget(
  request: Pick<WorkItemFocusRequest, "workItemId" | "queue"> & { kind?: string },
): WorkItemFocusTarget {
  // 맡긴 업무는 답하기·다시 시도가 있는 업무판으로 간다(승인함 보기에는 그 카드가 없다).
  if (request.kind === "task") return "office_task";
  if (request.workItemId && isScheduleBriefingFocus(request.workItemId, request.queue)) return "schedule_briefing";
  if (isMailCalendarFocus(request.workItemId)) return "mail_calendar";
  if (request.queue === "approval" || request.workItemId) return "office_approval";
  return "none";
}

/**
 * 업무 오피스 창 안에서 승인함을 펼치고 그 카드를 맨 앞에 두는 주소.
 * OfficeBoard 가 읽는 값(officeView·focusFinalActionCard)과 승인 후보 위치(#final-action-candidates)를 쓴다.
 * 다른 주소 값(from=chat-window, preview 등)은 그대로 둔다.
 */
export function buildOfficeApprovalFocusPath(pathname: string, search: string, workItemId: string): string {
  const params = new URLSearchParams(search);
  params.set("officeView", "approval");
  if (workItemId) params.set("focusFinalActionCard", workItemId);
  else params.delete("focusFinalActionCard");
  return `${pathname || "/office"}?${params.toString()}#final-action-candidates`;
}

/**
 * 주소에 `?workItem=&queue=` 를 싣는다. 대화 화면은 새로 그릴 때(refreshWorkspace 등) 이 주소 값을
 * 다시 읽으므로, 신호로 연 일정 브리핑이 다음 새로 그리기에서 사라지지 않게 주소에도 남겨 둔다.
 * 다른 주소 값은 그대로 둔다.
 */
export function withWorkItemFocusParams(
  pathname: string,
  search: string,
  request: Pick<WorkItemFocusRequest, "workItemId" | "queue">,
): string {
  const params = new URLSearchParams(search);
  if (request.workItemId) params.set("workItem", request.workItemId);
  else params.delete("workItem");
  if (request.queue) params.set("queue", request.queue);
  else params.delete("queue");
  const query = params.toString();
  return `${pathname || "/"}${query ? `?${query}` : ""}`;
}

/**
 * 대화 화면이 아닌 곳(문서·회사 운영 등)에 있을 때 대화 화면으로 돌아가는 주소.
 * 미리보기 표시(preview)만 이어 가고, 그 화면의 다른 주소 값은 가져가지 않는다.
 */
export function buildHomeReturnPath(search: string): string {
  const preview = new URLSearchParams(search).get("preview");
  return preview ? `/?preview=${encodeURIComponent(preview)}` : "/";
}

export type WorkItemFocusRoute = "home" | "office" | "other";

export function classifyWorkItemFocusRoute(pathname: string | null | undefined): WorkItemFocusRoute {
  const path = pathname || "/";
  if (path === "/" || path === "") return "home";
  if (path === "/office" || path.startsWith("/office/")) return "office";
  return "other";
}

export type WorkItemFocusRouteAction = "focus_office_approval" | "navigate_home" | "leave";

/**
 * 대화 화면(/)이 아닌 곳에서 신호를 받았을 때 할 일. (대화 화면에서는 TodayPage 가 직접 처리한다.)
 * - 업무 오피스의 승인함 카드: 그 자리에서 승인함을 펼친다.
 * - 맡긴 업무: 같은 화면의 업무판(TaskBoard)이 받도록 남겨 둔다.
 * - 일정 브리핑·메일→일정 카드 등 대화 화면에 있는 것: 대화 화면으로 새로고침 없이 옮겨 간다.
 *   요청은 우편함에 남아 TodayPage 가 받는다. 예전에는 아무도 받지 않아 창만 앞으로 오고 끝났다.
 * - 따로 띄운 업무 오피스 창은 대화 화면으로 바꾸지 않는다.
 */
export function decideWorkItemFocusRouteAction(
  route: WorkItemFocusRoute,
  target: WorkItemFocusTarget,
  options: { detachedOfficeWindow?: boolean } = {},
): WorkItemFocusRouteAction {
  if (route === "home" || target === "none" || target === "office_task") return "leave";
  if (route === "office" && target === "office_approval") return "focus_office_approval";
  if (route === "office" && options.detachedOfficeWindow === true) return "leave";
  return "navigate_home";
}

type WorkItemFocusHandler = (request: WorkItemFocusRequest) => boolean;

const handlers = new Set<WorkItemFocusHandler>();
let pendingRequest: WorkItemFocusRequest | null = null;

function deliverPendingWorkItemFocus(now: number = Date.now()) {
  const request = pendingRequest;
  if (!request) return;
  if (now - request.receivedAt > pendingTtlMs) {
    pendingRequest = null;
    return;
  }
  for (const handler of Array.from(handlers)) {
    let handled = false;
    try {
      handled = handler(request) === true;
    } catch {
      handled = false;
    }
    if (handled) {
      if (pendingRequest === request) pendingRequest = null;
      return;
    }
  }
}

/**
 * 요청을 우편함에 넣는다. 지금 받을 화면이 있으면 바로 넘기고, 아직 없으면(첫 화면을 그리는 중)
 * 2분 동안 들고 있다가 받을 화면이 생기면 넘긴다.
 */
export function publishWorkItemFocus(request: WorkItemFocusRequest) {
  pendingRequest = request;
  deliverPendingWorkItemFocus();
}

/** 처리했으면 true 를 돌려준다. 처리하지 않은 요청은 다음 구독자를 기다린다. */
export function subscribeWorkItemFocus(handler: WorkItemFocusHandler): () => void {
  handlers.add(handler);
  deliverPendingWorkItemFocus();
  return () => {
    handlers.delete(handler);
  };
}

export function resetWorkItemFocusMailboxForTest() {
  handlers.clear();
  pendingRequest = null;
}
