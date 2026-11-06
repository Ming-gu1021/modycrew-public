import type { ConnectorStatusRecord, MailLedgerRow } from "./desktop-bridge";

/** A legacy connector alias is safe only when it resolves to exactly one configured account. */
export function canonicalMailAccount(accountId: string, connections: ConnectorStatusRecord[]) {
  if (connections.some(connection => connection.accountId === accountId)) return accountId;
  const matches = [...new Set(connections.filter(connection => connection.connectorId === accountId && connection.accountId).map(connection => connection.accountId!))];
  return matches.length === 1 ? matches[0] : accountId;
}
export function deduplicateMailMessages(messages: MailLedgerRow[], connections: ConnectorStatusRecord[]) {
  const unique = new Map<string, MailLedgerRow>();
  for (const row of messages) {
    const accountId = canonicalMailAccount(row.accountId, connections);
    const key = JSON.stringify([accountId, row.rfcMessageId || row.messageId]);
    const previous = unique.get(key);
    if (!previous || (row.accountId === accountId && previous.accountId !== accountId)) unique.set(key, row);
  }
  return [...unique.values()];
}

export type MailViewPreferences = {
  density: "compact" | "comfortable";
  listWidth: number;
};

export const DEFAULT_MAIL_VIEW: MailViewPreferences = {
  density: "compact",
  listWidth: 340,
};

export const MAIL_VIEW_STORAGE_KEY = "modycrew-mail-view-v1";

export type MailCategory = NonNullable<MailLedgerRow["category"]>;
/** 기본함: 광고·소셜·알림·스팸이 아닌 메일. 결제·영수증은 따로 모은다. */
export type MailFocus = "primary" | "unread" | "reply" | "schedule" | "receipt" | "other" | "all";
export const DEFAULT_MAIL_FOCUS: MailFocus = "primary";

export function mailCategoryOf(row: Pick<MailLedgerRow, "category">): MailCategory {
  return row.category ?? "primary";
}
export function isMailNoise(row: Pick<MailLedgerRow, "category">) {
  const category = mailCategoryOf(row);
  return category === "promotion" || category === "social" || category === "notification" || category === "spam";
}
export const MAIL_CATEGORY_LABELS: Record<MailCategory, string> = {
  primary: "", receipt: "결제·영수증", notification: "알림", promotion: "광고", social: "소셜", spam: "스팸 의심",
};
export const MAIL_FOCUS_LABELS: Record<MailFocus, string> = {
  primary: "받은 메일", unread: "안 읽음", reply: "답장 후보", schedule: "일정 후보", receipt: "결제·영수증", other: "광고·알림", all: "전체",
};

export function matchesMailFocus(row: MailLedgerRow, focus: MailFocus) {
  const category = mailCategoryOf(row);
  switch (focus) {
    case "primary": return category === "primary";
    case "unread": return row.isRead === false && !isMailNoise(row);
    case "reply": return row.replyCandidate === true && category === "primary";
    case "schedule": return row.scheduleCandidate === true && category === "primary";
    case "receipt": return category === "receipt" || row.receiptCandidate === true;
    case "other": return isMailNoise(row);
    default: return true;
  }
}

export function summarizeMailMessages(messages: MailLedgerRow[]) {
  return {
    all: messages.length,
    primary: messages.filter(row => matchesMailFocus(row, "primary")).length,
    unread: messages.filter(row => matchesMailFocus(row, "unread")).length,
    reply: messages.filter(row => matchesMailFocus(row, "reply")).length,
    schedule: messages.filter(row => matchesMailFocus(row, "schedule")).length,
    receipt: messages.filter(row => matchesMailFocus(row, "receipt")).length,
    other: messages.filter(row => matchesMailFocus(row, "other")).length,
    unknownRead: messages.filter(row => typeof row.isRead !== "boolean").length,
  };
}

export function normalizeMailViewPreferences(value: unknown): MailViewPreferences {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<MailViewPreferences>
    : {};
  const width = candidate.listWidth;
  return {
    density: candidate.density === "comfortable" || candidate.density === "compact"
      ? candidate.density
      : DEFAULT_MAIL_VIEW.density,
    listWidth: typeof width === "number" && Number.isFinite(width)
      ? Math.min(440, Math.max(280, Math.round(width / 20) * 20))
      : DEFAULT_MAIL_VIEW.listWidth,
  };
}

export function mailMessageKey(row: Pick<MailLedgerRow, "accountId" | "messageId">): string {
  return JSON.stringify([row.accountId, row.messageId]);
}

export function filterMailMessages(
  messages: MailLedgerRow[],
  options: { query: string; hasAttachmentsOnly: boolean; periodDays: 0 | 7 | 30; now?: number; focus?: MailFocus },
  accountLabel: (id: string) => string,
): MailLedgerRow[] {
  const tokens = options.query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const now = options.now ?? Date.now();
  const earliest = now - options.periodDays * 24 * 60 * 60 * 1000;

  return messages
    .map((message, index) => ({ message, index, timestamp: Date.parse(message.receivedAt) }))
    .filter(({ message, timestamp }) => {
      if (!matchesMailFocus(message, options.focus ?? DEFAULT_MAIL_FOCUS)) return false;
      if (options.hasAttachmentsOnly && message.hasAttachments !== true) return false;
      if (options.periodDays !== 0 && !(timestamp >= earliest && timestamp <= now)) return false;
      if (tokens.length === 0) return true;
      const searchable = [message.subject, message.from, message.preview, accountLabel(message.accountId)]
        .join(" ")
        .toLowerCase();
      return tokens.every(token => searchable.includes(token));
    })
    .sort((left, right) => {
      const leftValid = Number.isFinite(left.timestamp);
      const rightValid = Number.isFinite(right.timestamp);
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      return (leftValid ? right.timestamp - left.timestamp : 0) || left.index - right.index;
    })
    .map(({ message }) => message);
}
