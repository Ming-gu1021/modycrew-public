/**
 * 오피스 승인함의 메일 카드 정렬과 '급함'·담당 표시.
 *
 * - 결정을 기다리는 카드만 급함 → 보통 → 낮음 순으로 올리고, 같은 등급은 최근 것부터 둔다.
 *   이미 끝난 카드와 우선순위가 없는 카드는 '보통'과 같은 자리에서 시간순이다 —
 *   우선순위 값이 하나도 없으면 예전 순서(최근 것부터)와 똑같다.
 * - 어떤 카드가 목록에 들어갈지는 예전처럼 최근 것부터 고른다(selectApprovalCardsForDisplay).
 *   우선순위는 고른 카드 안에서 순서만 바꾼다 — '낮음' 카드가 끝난 카드에 밀려 목록에서 빠지지 않게.
 * - 순서와 표시만 바꾼다. 어떤 카드도 숨기거나 보내지 않는다.
 * 순수 함수만 둔다(React·브리지 의존 없음) — tests/web/mail-card-triage.test.mjs 가 직접 부른다.
 */

export type MailCardPriorityLevel = "urgent" | "normal" | "low";

export type MailCardTriageItem = {
  id: string;
  status?: string;
  receivedAt?: string;
  priority?: MailCardPriorityLevel;
  priorityReason?: string;
  prioritySource?: "jev" | "rule";
  mailCategory?: string;
  assigneeTeammateId?: string;
  assigneeName?: string;
  assigneeRoleTitle?: string;
  assigneeSource?: "jev" | "rule" | "default" | "user";
  assigneeReason?: string;
  finalAction?: { readiness?: string; sentAt?: string } | null;
};

export type MailCardAssigneeOption = {
  id: string;
  name: string;
  roleTitle?: string;
};

export type MailCardTriageView = {
  priority: MailCardPriorityLevel;
  isUrgent: boolean;
  /** '급함' 배지 문구(급할 때만). */
  badgeLabel: string;
  /** 한 줄 이유(없으면 빈 문자열). */
  reasonLine: string;
  /** "담당: 영업 담당" (담당이 없으면 빈 문자열). */
  assigneeLabel: string;
  assigneeReason: string;
  /** 판단 근거: Jev를 함께 봤는지, 규칙만인지, 사용자가 직접 골랐는지. */
  basisLabel: string;
};

const pendingStatuses = new Set(["draft_ready", "needs_review", "approval_pending"]);
const priorityRanks: Record<MailCardPriorityLevel, number> = { urgent: 0, normal: 1, low: 2 };

export function isMailCardAwaitingDecision(item: MailCardTriageItem): boolean {
  if (!pendingStatuses.has(String(item.status ?? ""))) return false;
  const finalAction = item.finalAction;
  if (finalAction && (finalAction.readiness === "sent" || Boolean(finalAction.sentAt))) return false;
  return true;
}

export function mailCardPriorityRank(item: MailCardTriageItem): number {
  if (!isMailCardAwaitingDecision(item)) return priorityRanks.normal;
  return priorityRanks[item.priority as MailCardPriorityLevel] ?? priorityRanks.normal;
}

function receivedTime(item: MailCardTriageItem): number {
  const time = Date.parse(String(item.receivedAt ?? ""));
  return Number.isFinite(time) ? time : 0;
}

/** 결정 대기 카드는 급함 → 보통 → 낮음, 같은 등급은 최근 것부터(안정 정렬). */
export function sortApprovalCardsByPriority<T extends MailCardTriageItem>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        mailCardPriorityRank(left.item) - mailCardPriorityRank(right.item) ||
        receivedTime(right.item) - receivedTime(left.item) ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

/** 오피스 승인함에 한 번에 싣는 실행 전 확인 카드 수(예전과 같은 12장). */
export const APPROVAL_CARD_LIST_LIMIT = 12;

/**
 * 오피스 승인함 목록. 목록에 들어갈 카드는 예전처럼 최근 것부터 limit 장을 고르고,
 * 그 안에서만 급함 → 보통 → 낮음으로 줄 세운다. 우선순위가 카드를 목록 밖으로 밀어내지 않는다.
 */
export function selectApprovalCardsForDisplay<T extends MailCardTriageItem>(
  items: readonly T[],
  limit: number = APPROVAL_CARD_LIST_LIMIT,
): T[] {
  const recent = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => receivedTime(right.item) - receivedTime(left.item) || left.index - right.index)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(({ item }) => item);
  return sortApprovalCardsByPriority(recent);
}

/** 같은 메일에서 나온 확인 카드(일정 등록·첨부 저장)의 id 꼬리 — 데스크톱 inbox-handler 와 같은 목록. */
const mailSubCardSuffixes = [":calendar", ":attachment-download-review"] as const;

/** 일정·첨부 확인 카드면 원래 메일 카드 id를, 아니면 자기 id를 돌려준다(한 메일의 카드를 한 묶음으로 본다). */
export function mailCardGroupId(id: string): string {
  const value = String(id ?? "");
  for (const suffix of mailSubCardSuffixes) {
    if (value.length > suffix.length && value.endsWith(suffix)) return value.slice(0, -suffix.length);
  }
  return value;
}

function isInMailCardGroup(itemId: string, groupId: string): boolean {
  return itemId === groupId || itemId.startsWith(`${groupId}:`);
}

/**
 * 결정을 기다리는 급한 메일 수. 한 메일에서 나온 답장·일정·첨부 카드는 한 통으로 센다
 * ('승인 · 급함 N'이 카드 수만큼 부풀지 않게).
 */
export function countUrgentMailDecisions(items: readonly MailCardTriageItem[]): number {
  const groups = new Set<string>();
  for (const item of items) {
    if (buildMailCardTriageView(item).isUrgent) groups.add(mailCardGroupId(item.id));
  }
  return groups.size;
}

export function buildMailCardTriageView(item: MailCardTriageItem): MailCardTriageView {
  const awaiting = isMailCardAwaitingDecision(item);
  const priority: MailCardPriorityLevel =
    item.priority === "urgent" || item.priority === "low" ? item.priority : "normal";
  const isUrgent = awaiting && priority === "urgent";
  const reasonLine = String(item.priorityReason ?? "").replace(/\s+/gu, " ").trim().slice(0, 160);
  const name = String(item.assigneeName ?? "").replace(/\s+/gu, " ").trim().slice(0, 60);
  const basisLabel =
    item.assigneeSource === "user"
      ? "직접 고름"
      : item.prioritySource === "jev" || item.assigneeSource === "jev"
        ? "Jev 참고"
        : item.priority || item.assigneeTeammateId
          ? "규칙 판단"
          : "";
  return {
    priority,
    isUrgent,
    badgeLabel: isUrgent ? "급함" : "",
    reasonLine: awaiting ? reasonLine : "",
    assigneeLabel: item.assigneeTeammateId && name ? `담당: ${name}` : "",
    assigneeReason: String(item.assigneeReason ?? "").replace(/\s+/gu, " ").trim().slice(0, 200),
    basisLabel,
  };
}

/**
 * 담당 선택지. 직원 목록 순서를 따르고, 지금 담당이 목록에 없으면(지운 직원 등) 맨 앞에 남겨 둔다.
 */
export function buildMailCardAssigneeOptions(
  teammates: readonly { id?: string; name?: string; roleTitle?: string }[],
  current?: MailCardTriageItem | null,
): MailCardAssigneeOption[] {
  const options: MailCardAssigneeOption[] = [];
  const seen = new Set<string>();
  for (const teammate of teammates) {
    const id = String(teammate?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = String(teammate?.name ?? "").trim() || String(teammate?.roleTitle ?? "").trim() || "AI 직원";
    const roleTitle = String(teammate?.roleTitle ?? "").trim();
    options.push({ id, name, ...(roleTitle ? { roleTitle } : {}) });
  }
  const currentId = String(current?.assigneeTeammateId ?? "").trim();
  if (currentId && !seen.has(currentId)) {
    options.unshift({
      id: currentId,
      name: String(current?.assigneeName ?? "").trim() || "업무 비서",
      ...(current?.assigneeRoleTitle ? { roleTitle: current.assigneeRoleTitle } : {}),
    });
  }
  return options;
}

/**
 * 담당을 바꾼 카드를 화면에서 고친다. 같은 메일에서 나온 카드(원래 메일·일정·첨부 확인)는
 * 어느 카드에서 바꿔도 함께 바뀐다 — 데스크톱 set_card_assignee 와 같은 규칙.
 */
export function applyMailCardAssigneeLocally<T extends MailCardTriageItem>(
  items: readonly T[],
  workItemId: string,
  option: MailCardAssigneeOption,
): T[] {
  const groupId = mailCardGroupId(workItemId);
  return items.map((item) =>
    isInMailCardGroup(item.id, groupId)
      ? {
          ...item,
          assigneeTeammateId: option.id,
          assigneeName: option.name,
          assigneeRoleTitle: option.roleTitle,
          assigneeSource: "user" as const,
          assigneeReason: "직접 고른 담당이에요.",
        }
      : item,
  );
}
