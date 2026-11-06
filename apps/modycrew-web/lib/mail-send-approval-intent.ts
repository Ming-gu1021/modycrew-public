// 오피스에서 사용자가 답장 카드를 직접 눌렀을 때, 그 클릭을 '이 카드 발송 승인'으로 볼지 정하는 규칙.
// 업무대장(메일 작업대)이나 카드에 남은 '보류·답장 안 보냄·수정 요청' 결정은 클릭 한 번으로 지우지 않는다.
// 화면 코드(app/office/page.tsx, components/OfficeBoard.tsx)가 같은 규칙을 쓰도록 여기 한 곳에 둔다.

export type MailWorkQueueRecordRef = {
  itemId: string;
  title: string;
  decision: string;
  previewId?: string;
  approvalPreviewId?: string;
  approvalWorkItemId?: string;
};

export type MailSendCardRef = {
  id: string;
  title?: string;
  summary?: string;
  finalAction?: {
    kind?: string;
    label?: string;
    mailSendApprovalGate?: { decision?: string; finalRoute?: string };
  };
  sourceEvidence?: { messageSubject?: string; originalSubject?: string };
};

export type MailSendHoldVeto<T extends MailWorkQueueRecordRef = MailWorkQueueRecordRef> = {
  source: "work_queue" | "card";
  decision: "hold" | "revise" | "exclude";
  /** 업무대장 기록으로 막힌 경우 그 기록(본문 재료로는 쓰지 않고 '보류' 결정만 넘긴다). */
  record: T | null;
  userMessage: string;
};

const heldDecisions = new Set(["hold", "revise", "exclude"]);
const heldFinalRoutes = new Set(["held", "excluded"]);

/**
 * 업무대장 기록을 카드에 붙이는 유일한 방법: 기록의 ID 칸 중 하나가 카드 ID와 정확히 같을 때.
 * (itemId 도 본다 — 직접 쓴 메일 점검 기록은 itemId 만 카드 ID이고, 보류 중에는 previewId 가 비어 있다.)
 */
export function findExactMailWorkQueueRecord<T extends MailWorkQueueRecordRef>(
  records: readonly T[],
  workItemId: string | undefined,
): T | null {
  if (!workItemId || !records.length) return null;
  return (
    records.find((record) => record.approvalWorkItemId === workItemId) ??
    records.find((record) => record.approvalPreviewId === workItemId) ??
    records.find((record) => record.previewId === workItemId) ??
    records.find((record) => record.itemId === workItemId) ??
    null
  );
}

function normalizeLabel(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function recordIds(record: MailWorkQueueRecordRef): string[] {
  return [record.approvalWorkItemId, record.approvalPreviewId, record.previewId, record.itemId].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

/**
 * 예전 방식(제목 일치)으로만 찾을 수 있는 '보류·제외·수정 요청' 기록. 거부권으로만 쓴다.
 * 다른 살아 있는 카드를 ID로 가리키는 기록은 그 카드의 결정이므로 여기서 쓰지 않는다
 * (같은 제목의 다른 거래처 메일이 엉뚱하게 막히지 않게).
 */
export function findLegacyMailWorkQueueHoldRecord<T extends MailWorkQueueRecordRef>(
  records: readonly T[],
  card: MailSendCardRef,
  otherCardIds: Iterable<string> = [],
): T | null {
  const others = new Set(otherCardIds);
  others.delete(card.id);
  const labels = [
    card.title,
    card.summary,
    card.finalAction?.label,
    card.sourceEvidence?.messageSubject,
    card.sourceEvidence?.originalSubject,
  ]
    .map(normalizeLabel)
    .filter((label) => label.length >= 2);
  if (!labels.length) return null;
  return (
    records.find((record) => {
      if (!heldDecisions.has(record.decision)) return false;
      if (recordIds(record).some((id) => others.has(id))) return false;
      const title = normalizeLabel(record.title);
      if (title.length < 2) return false;
      return labels.some(
        (label) =>
          label === title ||
          (title.length >= 6 && label.includes(title)) ||
          (label.length >= 6 && title.includes(label)),
      );
    }) ?? null
  );
}

function heldDecisionOf(decision: string | undefined, finalRoute: string | undefined): MailSendHoldVeto["decision"] | null {
  if (decision === "exclude" || finalRoute === "excluded") return "exclude";
  if (decision === "revise") return "revise";
  if (decision === "hold" || (finalRoute && heldFinalRoutes.has(finalRoute))) return "hold";
  return null;
}

function holdVetoMessage(source: MailSendHoldVeto["source"], decision: MailSendHoldVeto["decision"]): string {
  if (decision === "exclude") {
    return source === "work_queue"
      ? "이 메일은 메일 작업대에서 '답장 안 보냄'으로 정해 둔 메일이라 보내지 않았어요. 보내려면 작업대에서 '답장 보냄'으로 바꿔 주세요."
      : "이 메일은 '답장 안 보냄'으로 정해 둔 카드라 보내지 않았어요. 보내려면 메일 작업대에서 '답장 보냄'으로 바꿔 주세요.";
  }
  return source === "work_queue"
    ? "이 메일은 메일 작업대에서 '수정/확인'으로 보류해 둔 메일이라 아직 보내지 않았어요. 작업대에서 '답장 보냄'으로 바꾼 뒤 다시 눌러 주세요."
    : "이 답장은 메일 작업대에서 확인을 기다리는 중이라 아직 보내지 않았어요. 작업대에서 내용을 확인하고 '답장 보냄'으로 바꾼 뒤 다시 눌러 주세요.";
}

/**
 * 사용자가 카드에서 직접 '마지막 확인 준비'·'승인'을 눌렀을 때, 그 클릭을 발송 승인으로 보면 안 되는 이유.
 * 없으면 null(= 클릭을 이 카드의 승인으로 본다). 정확한 ID 기록이 있으면 그 기록의 결정이 우선이므로
 * 이 함수는 그 기록이 '보내기'가 아닐 때도 거부권을 돌려준다.
 */
export function findMailSendHoldVeto<T extends MailWorkQueueRecordRef>(input: {
  card: MailSendCardRef;
  records: readonly T[];
  otherCardIds?: Iterable<string>;
}): MailSendHoldVeto<T> | null {
  const { card, records } = input;
  const exact = findExactMailWorkQueueRecord(records, card.id);
  if (exact) {
    const decision = heldDecisionOf(exact.decision, undefined);
    return decision ? { source: "work_queue", decision, record: exact, userMessage: holdVetoMessage("work_queue", decision) } : null;
  }
  const legacy = findLegacyMailWorkQueueHoldRecord(records, card, input.otherCardIds);
  if (legacy) {
    const decision = heldDecisionOf(legacy.decision, undefined) ?? "hold";
    return { source: "work_queue", decision, record: legacy, userMessage: holdVetoMessage("work_queue", decision) };
  }
  const gate = card.finalAction?.mailSendApprovalGate;
  const cardDecision = heldDecisionOf(gate?.decision, gate?.finalRoute);
  if (cardDecision) {
    return { source: "card", decision: cardDecision, record: null, userMessage: holdVetoMessage("card", cardDecision) };
  }
  return null;
}
