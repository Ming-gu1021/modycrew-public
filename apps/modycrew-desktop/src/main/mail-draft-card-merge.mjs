import {
  getAutomationInboxSnapshot,
  getInboxPersistenceStatus,
  upsertAutomationInboxItem,
  userRequestedMailDraftToneLabels,
} from "./inbox-handler.mjs";

/**
 * 이미 승인 카드가 있는 메일에 AI 답장 초안이 새로 준비되면 그 카드의 초안을 바꾼다.
 *
 * 인박스 추가(appendAutomationInboxItems)는 같은 id 를 건너뛰기 때문에, 예전에는 규칙 초안
 * 카드가 먼저 생긴 메일에 AI 초안을 만들어도 조용히 버려졌다(모델 호출만 쓰고 "준비했다"고 말함).
 *
 * 사용자가 이미 손댄 카드는 건드리지 않는다: 승인/보류/완료된 카드, 메신저로 결정이 온 카드,
 * 사용자가 초안을 고친 카드, 이미 AI 초안인 카드, 사용자가 직접 청한 초안(채팅·메일함·수정 지시) 카드.
 */

export const aiReplyDraftToneLabel = "AI 답장 초안";

const replaceableStatuses = new Set(["draft_ready", "needs_review"]);
const contractEvidenceKeys = [
  "connectorId",
  "originalSubject",
  "replyToAddress",
  "rfcMessageId",
  "inReplyTo",
  "draftPreview",
];

export function isAiDraftedInboxItem(item) {
  const draft = item?.draft;
  if (!draft || typeof draft !== "object") return false;
  return draft.draftSource === "ai_draft_guarded" || draft.toneLabel === aiReplyDraftToneLabel;
}

function canReceiveAiReplyDraft(existing) {
  if (!existing || typeof existing !== "object") return false;
  if (!replaceableStatuses.has(String(existing.status ?? ""))) return false;
  if (existing.channelDecision) return false;
  if (isAiDraftedInboxItem(existing)) return false;
  // 사용자가 채팅·메일함에서 청했거나 지시로 다시 쓰게 한 초안도 사용자가 손댄 것으로 본다.
  if (userRequestedMailDraftToneLabels.includes(String(existing.draft?.toneLabel ?? ""))) return false;
  const gate = existing.finalAction?.mailSendApprovalGate;
  if (gate && String(gate.revisedDraft ?? "").trim()) return false;
  return true;
}

function pickContractEvidence(value) {
  if (!value || typeof value !== "object") return {};
  const picked = {};
  for (const key of contractEvidenceKeys) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) picked[key] = field;
  }
  return picked;
}

/**
 * @param {Array<object>} items 이번에 인박스로 보낸 카드들(추가 전 원본)
 * @param {{ existingIds?: Set<string>, createdAt?: string }} options
 *   existingIds: 추가 전 인박스에 이미 있던 카드 id. 여기에 없던 AI 초안 카드는 방금 새로 들어간 것이다.
 * @returns {{ storedIds: string[], updatedIds: string[], skippedIds: string[] }}
 */
export function mergeAiReplyDraftsIntoExistingCards(items = [], options = {}) {
  const existingIds = options.existingIds instanceof Set ? options.existingIds : new Set();
  const aiItems = (Array.isArray(items) ? items : []).filter(
    (item) => item?.id && isAiDraftedInboxItem(item) && item.draft?.operationKind === "send_email",
  );
  const result = { storedIds: [], updatedIds: [], skippedIds: [] };
  if (aiItems.length === 0) return result;

  const snapshot = new Map(getAutomationInboxSnapshot().map((item) => [item.id, item]));
  for (const incoming of aiItems) {
    const existing = snapshot.get(incoming.id);
    if (!existing) {
      result.skippedIds.push(incoming.id);
      continue;
    }
    if (!existingIds.has(incoming.id)) {
      // 방금 새 카드로 들어갔다 — AI 초안이 이미 실려 있다.
      if (getInboxPersistenceStatus().pending) result.skippedIds.push(incoming.id);
      else result.storedIds.push(incoming.id);
      continue;
    }
    if (!canReceiveAiReplyDraft(existing)) {
      result.skippedIds.push(incoming.id);
      continue;
    }
    const merged = {
      ...existing,
      status: "draft_ready",
      draft: { ...(existing.draft ?? {}), ...incoming.draft },
      ...(existing.finalAction ? {} : incoming.finalAction ? { finalAction: incoming.finalAction } : {}),
      ...(existing.sourceEvidence || incoming.sourceEvidence
        ? { sourceEvidence: { ...(existing.sourceEvidence ?? incoming.sourceEvidence), ...pickContractEvidence(incoming.sourceEvidence) } }
        : {}),
    };
    const upserted = upsertAutomationInboxItem(merged, { createdAt: options.createdAt });
    if (upserted?.status === "automation_inbox_item_updated") {
      result.storedIds.push(incoming.id);
      result.updatedIds.push(incoming.id);
    } else {
      result.skippedIds.push(incoming.id);
    }
  }
  return result;
}
