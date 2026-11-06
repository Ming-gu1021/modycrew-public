import { randomUUID } from "node:crypto";
import { createMailWorkCardId } from "./mail-header-utils.mjs";
import { isWorkCardNoise } from "./mail-category.mjs";

const hiddenKinds = new Set(["acknowledged", "ignored", "deferred"]);
export const isInboxCardHidden = (item) => hiddenKinds.has(item?.cardDisposition?.kind);

   
                                                                                         
                                                                             
                                                           
   
// 메일함 점검에서 생긴 카드의 출처. 휴대폰에서 직접 공유한 메일과 사용자가 요청한 카드는 제안하지 않는다.
const scannedMailSources = new Set(["email", "gmail", "outlook", "imap_smtp", "webmail", "company_mail", "public_agency_mail", "mailops"]);

export function looksLikeNoiseMailCard(item) {
  if (!item || !scannedMailSources.has(item.source) || item.cardOrigin === "user_request") return false;
  const subject = String(item.title ?? "").replace(/^\s*(?:일정 등록 확인:\s*)?(?:업무 메일 처리:\s*)?/u, "");
  return isWorkCardNoise({ subject, from: item.senderLabel ?? "" });
}

/** Keep dismissed mail out of background briefings as well as the visible inbox. */
export function excludeHandledInboxMailRows(rows, items) {
  const hidden = new Set(items.filter(isInboxCardHidden).map(item =>
    `${item.sourceEvidence?.connectorId ?? ""}\u0000${item.id}`));
  if (!hidden.size) return rows;
  return rows.filter(row => !row.accountId || !hidden.has(
    `${row.accountId}\u0000${createMailWorkCardId(row.accountId, row)}`));
}

/** Changes visibility only. IDs include their source account; never match titles or mail subjects. */
export function changeInboxCardDisposition(items, request, at = new Date().toISOString()) {
  const action = request?.action;
  if (!hiddenKinds.has(action) && action !== "restore" && action !== "restore_batch") throw new Error("카드 처리 방법을 확인해 주세요.");
  const ids = action === "restore_batch"
    ? items.filter(item => isInboxCardHidden(item) && item.cardDisposition.batchId === request.batchId).map(item => item.id)
    : request?.workItemIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new Error("처리할 카드를 다시 선택해 주세요.");
  if (action === "restore_batch" && (typeof request.batchId !== "string" || !request.batchId)) throw new Error("되살릴 묶음을 확인해 주세요.");
  const selected = new Set(ids);
  const targets = items.filter(item => selected.has(item.id));
  const restore = action === "restore" || action === "restore_batch";
  if (targets.length !== ids.length || targets.some(item => isInboxCardHidden(item) !== restore)) throw new Error("카드 목록이 바뀌었어요. 새로 불러온 뒤 다시 선택해 주세요.");
  const batchId = randomUUID();
  const next = items.map(item => {
    if (!selected.has(item.id)) return item;
    const prior = item.cardDisposition;
    return { ...item, cardDisposition: {
      kind: restore ? "restored" : action, at, batchId,
      ...(restore ? { restoredFromBatchId: prior.batchId } : {}),
      history: [...(prior?.history ?? []), { kind: restore ? "restored" : action, at, batchId }],
    } };
  });
  return { items: next, ids, batchId, count: ids.length };
}
