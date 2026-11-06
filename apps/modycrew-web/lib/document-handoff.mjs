/**
 * 다른 화면에서 문서 작업실(/documents)로 글 한 덩어리를 넘기는 좁은 통로.
 *
 * 보고서처럼 긴 글은 주소(URL)에 싣지 않는다. 같은 창의 sessionStorage 에 한 건만 두고,
 * 문서에 저장한 뒤 같은 전달 건만 확인하고 지운다. 오래된 글은 자동으로 적용하지 않는다.
 */

export const DOCUMENT_HANDOFF_KEY = "modycrew-document-handoff-v1";
export const DOCUMENT_HANDOFF_TTL_MS = 30 * 60 * 1000;
const TITLE_MAX = 180;
const TEXT_MAX = 60000;

function tidy(value, max) {
  return String(value ?? "").replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim().slice(0, max);
}

/**
 * @param {Pick<Storage, "setItem"> | null | undefined} storage
 * @param {{ title?: string; text?: string; sourceLabel?: string; workThreadId?:string; workRoot?:string }} input
 * @returns {boolean} 넘길 준비가 됐으면 true
 */
export function stageDocumentHandoff(storage, input = {}, now = Date.now()) {
  const title = tidy(input.title, TITLE_MAX).replace(/\s+/gu, " ");
  const text = tidy(input.text, Infinity);
  if (!storage || !text || text.length > TEXT_MAX) return false;
  try {
    if (storage.getItem?.(DOCUMENT_HANDOFF_KEY)) return false;
    storage.setItem(DOCUMENT_HANDOFF_KEY, JSON.stringify({ title, text, sourceLabel: tidy(input.sourceLabel, 120), stagedAt: now, handoffId: globalThis.crypto.randomUUID(),
      ...(input.workThreadId&&input.workRoot?{workThreadId:tidy(input.workThreadId,200),workRoot:tidy(input.workRoot,2000)}:{}) }));
    return true;
  } catch {
    return false;
  }
}

/** Read without deleting. Expired deliveries remain available for explicit review. */
export function peekDocumentHandoff(storage, now = Date.now()) {
  const receipt = storage?.getItem(DOCUMENT_HANDOFF_KEY);
  if (!receipt) return null;
  const value = JSON.parse(receipt), stagedAt = Number(value?.stagedAt);
  const text = tidy(value?.text, Infinity);
  if (!Number.isFinite(stagedAt) || !text || text.length > TEXT_MAX) throw new Error('전달받은 글을 읽지 못했습니다. 전달 원본은 보존했습니다.');
  return {
    title: tidy(value.title, TITLE_MAX).replace(/\s+/gu, ' '), text, sourceLabel: tidy(value.sourceLabel, 120),
    ...(typeof value.workThreadId === 'string' && typeof value.workRoot === 'string' && value.workThreadId && value.workRoot ? { workThreadId: tidy(value.workThreadId, 200), workRoot: tidy(value.workRoot, 2000) } : {}),
    receipt, id: typeof value.handoffId === 'string' && value.handoffId ? value.handoffId : receipt,
    expired: now - stagedAt > DOCUMENT_HANDOFF_TTL_MS || stagedAt - now > 60_000,
  };
}

export function acknowledgeDocumentHandoff(storage, receipt) {
  try {
    if (!receipt || storage?.getItem(DOCUMENT_HANDOFF_KEY) !== receipt) return false;
    storage.removeItem(DOCUMENT_HANDOFF_KEY);
    return true;
  } catch { return false; }
}

/**
 * 넘겨받은 글을 꺼내고 지운다. 없거나 오래됐거나 모양이 틀리면 null.
 * @param {Pick<Storage, "getItem" | "removeItem"> | null | undefined} storage
 */
export function takeDocumentHandoff(storage, now = Date.now()) {
  if (!storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(DOCUMENT_HANDOFF_KEY);
    storage.removeItem(DOCUMENT_HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const stagedAt = Number(value?.stagedAt);
    if (!Number.isFinite(stagedAt) || now - stagedAt > DOCUMENT_HANDOFF_TTL_MS || stagedAt - now > 60_000) return null;
    const text = tidy(value?.text, TEXT_MAX);
    if (!text) return null;
    return { title: tidy(value?.title, TITLE_MAX).replace(/\s+/gu, " "), text, sourceLabel: tidy(value?.sourceLabel, 120),
      ...(typeof value.workThreadId==='string'&&typeof value.workRoot==='string'&&value.workThreadId&&value.workRoot?{workThreadId:tidy(value.workThreadId,200),workRoot:tidy(value.workRoot,2000)}:{}) };
  } catch {
    return null;
  }
}
