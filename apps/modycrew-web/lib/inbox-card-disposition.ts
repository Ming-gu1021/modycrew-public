import type { WorkItem } from "./types";
import type { MailLedgerRow } from "./desktop-bridge";

export const dispositionLabels = { acknowledged: "확인함 · 실행 안 함", ignored: "무시", deferred: "보류", restored: "되살림" } as const;
export type CardDispositionAction = keyof typeof dispositionLabels | "restore" | "restore_batch";
export const isHandledCard = (item: WorkItem) => Boolean(item.cardDisposition && item.cardDisposition.kind !== "restored");

/** Use evidence, not words in a generated title, to describe how a card arrived. */
export function cardOriginLabel(item: WorkItem): string {
  if (item.cardOrigin) return { mail_scan: "메일함 확인에서 생성", user_request: "직접 요청", ai_suggestion: "AI가 제안" }[item.cardOrigin];
  const provider = item.sourceEvidence?.providerId;
  if (provider === "mobile_share") return "직접 공유한 메일";
  if (item.id.startsWith("mail:")) return "메일함 확인에서 생성";
  if (item.source === "email") return "메일에서 생성";
  if (item.source === "manual_input") return "앱에서 만든 요청";
  if (provider === "mailops") return "자동 업무 점검";
  return "출처 확인 필요";
}

/** Match the persisted account-scoped card identity, including old cards without source message IDs. */
export async function excludeHandledMailRows(rows: MailLedgerRow[], handled: WorkItem[]): Promise<MailLedgerRow[]> {
  if (!handled.length) return rows;
  const hidden = new Set(handled.map(item => `${cardAccount(item)}\u0000${item.id}`));
  const keep: MailLedgerRow[] = [];
  for (const row of rows) {
    const connector = row.accountId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mail";
    const rfc = (row.rfcMessageId ?? "").replace(/[<>\s]/g, "");
    const message = row.messageId.replace(/^.*::/u, "").trim();
    const uid = /^imap(?:_.*)?[-_](\d+)$/u.exec(message);
    const key = rfc && rfc.includes("@") ? `rfc:${rfc.toLowerCase()}` : uid ? `imap-uid:${uid[1]}` : `id:${message || "unknown"}`;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const digest = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("").slice(0, 24);
    if (!hidden.has(`${row.accountId}\u0000mail:${connector}:m${digest}`)) keep.push(row);
  }
  return keep;
}
export const cardAccount = (item: WorkItem) => item.sourceEvidence?.connectorId || "계정 정보 없음";
const receivedDay = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
export function filterCleanupCards(items: WorkItem[], filters: { account: string; date: string; status: string; origin: string }) {
  return items.filter(item => (!filters.account || cardAccount(item) === filters.account)
    && (!filters.date || receivedDay(item.receivedAt) === filters.date)
    && (!filters.status || item.status === filters.status)
    && (!filters.origin || cardOriginLabel(item) === filters.origin));
}
