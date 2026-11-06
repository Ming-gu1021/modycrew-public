export type MobileMailShareHandoffRecord = {
  id: string;
  subject: string;
  body: string;
  from?: string;
  url?: string;
  source: "mobile_share_sheet" | "pwa_paste" | "manual_phone_forward";
  receivedAt: string;
  contract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation";
  decisionContract: "phone_shared_mail_reply_edit_hold_approve_to_workbench";
  externalMutation: false;
};

export const mobileMailShareHandoffStorageKey = "modycrew-mobile-mail-share-handoff-v1";
export const mobileMailShareHandoffQueueStorageKey = "modycrew-mobile-mail-share-handoff-queue-v1";
const mobileMailShareHandoffQueueLimit = 12;

export function sanitizeMobileMailShareText(value: unknown, maxLength = 4000) {
  return String(value ?? "")
    .replace(/\u0000/gu, "")
    .replace(/\s+\n/gu, "\n")
    .trim()
    .slice(0, maxLength);
}

export function createMobileMailShareHandoff(input: {
  title?: unknown;
  text?: unknown;
  url?: unknown;
  from?: unknown;
  source?: MobileMailShareHandoffRecord["source"];
}): MobileMailShareHandoffRecord {
  const subject = sanitizeMobileMailShareText(input.title, 180) || "휴대폰에서 선택한 메일";
  const text = sanitizeMobileMailShareText(input.text, 3600);
  const url = sanitizeMobileMailShareText(input.url, 800);
  const body = [text, url && !text.includes(url) ? url : ""].filter(Boolean).join("\n");
  return {
    id: `mobile-mail-share-${Date.now()}`,
    subject,
    body,
    from: sanitizeMobileMailShareText(input.from, 180),
    url,
    source: input.source ?? "mobile_share_sheet",
    receivedAt: new Date().toISOString(),
    contract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation",
    decisionContract: "phone_shared_mail_reply_edit_hold_approve_to_workbench",
    externalMutation: false,
  };
}

export function writePendingMobileMailShareHandoff(record: MobileMailShareHandoffRecord) {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(mobileMailShareHandoffStorageKey, JSON.stringify(record));
    const queue = readPendingMobileMailShareHandoffQueue();
    const nextQueue = [record, ...queue.filter((item) => item.id !== record.id)].slice(0, mobileMailShareHandoffQueueLimit);
    window.sessionStorage.setItem(mobileMailShareHandoffQueueStorageKey, JSON.stringify(nextQueue));
    return true;
  } catch {
    return false;
  }
}

export function readPendingMobileMailShareHandoff(): MobileMailShareHandoffRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(mobileMailShareHandoffStorageKey) || "null");
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.contract !== "selected_phone_mail_to_workbench_draft_approval_final_confirmation" ||
      parsed.externalMutation !== false
    ) {
      return null;
    }
    return {
      id: sanitizeMobileMailShareText(parsed.id, 120) || `mobile-mail-share-${Date.now()}`,
      subject: sanitizeMobileMailShareText(parsed.subject, 180) || "휴대폰에서 선택한 메일",
      body: sanitizeMobileMailShareText(parsed.body, 3600),
      from: sanitizeMobileMailShareText(parsed.from, 180),
      url: sanitizeMobileMailShareText(parsed.url, 800),
      source:
        parsed.source === "pwa_paste" || parsed.source === "manual_phone_forward" || parsed.source === "mobile_share_sheet"
          ? parsed.source
          : "mobile_share_sheet",
      receivedAt: sanitizeMobileMailShareText(parsed.receivedAt, 80) || new Date().toISOString(),
      contract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation",
      decisionContract: "phone_shared_mail_reply_edit_hold_approve_to_workbench",
      externalMutation: false,
    };
  } catch {
    return null;
  }
}

export function readPendingMobileMailShareHandoffQueue(): MobileMailShareHandoffRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(mobileMailShareHandoffQueueStorageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeMobileMailShareHandoffRecord)
      .filter((record): record is MobileMailShareHandoffRecord => Boolean(record))
      .slice(0, mobileMailShareHandoffQueueLimit);
  } catch {
    return [];
  }
}

export function clearPendingMobileMailShareHandoff() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(mobileMailShareHandoffStorageKey);
    window.sessionStorage.removeItem(mobileMailShareHandoffQueueStorageKey);
  } catch {
    // Restricted browser contexts may deny storage access.
  }
}

function normalizeMobileMailShareHandoffRecord(parsed: unknown): MobileMailShareHandoffRecord | null {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as MobileMailShareHandoffRecord).contract !== "selected_phone_mail_to_workbench_draft_approval_final_confirmation" ||
    (parsed as MobileMailShareHandoffRecord).externalMutation !== false
  ) {
    return null;
  }
  const record = parsed as Partial<MobileMailShareHandoffRecord>;
  return {
    id: sanitizeMobileMailShareText(record.id, 120) || `mobile-mail-share-${Date.now()}`,
    subject: sanitizeMobileMailShareText(record.subject, 180) || "휴대폰에서 선택한 메일",
    body: sanitizeMobileMailShareText(record.body, 3600),
    from: sanitizeMobileMailShareText(record.from, 180),
    url: sanitizeMobileMailShareText(record.url, 800),
    source:
      record.source === "pwa_paste" || record.source === "manual_phone_forward" || record.source === "mobile_share_sheet"
        ? record.source
        : "mobile_share_sheet",
    receivedAt: sanitizeMobileMailShareText(record.receivedAt, 80) || new Date().toISOString(),
    contract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation",
    decisionContract: "phone_shared_mail_reply_edit_hold_approve_to_workbench",
    externalMutation: false,
  };
}
