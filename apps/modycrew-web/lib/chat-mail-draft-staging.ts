/**
 * 채팅·메일함에서 AI 가 쓴 메일 초안을 승인함 '보낼까요?' 카드로 올리는 얇은 도우미.
 *
 * - 보내지 않는다. 카드는 승인함의 마지막 확인(받는 사람·제목·본문 그대로 미리보기)을 지나야 나간다.
 * - 받는 사람 주소는 사용자가 이번 요청에 직접 적은 주소일 때만 넘긴다. 모델이 지어낸 주소는 버리고,
 *   비어 있으면 승인함의 마지막 확인에서 사람이 적는다. 답장이면 메시지 id 만 넘기고
 *   원래 메일의 주소는 데스크톱(main)이 찾아 카드에만 담는다.
 * - desktop-bridge 를 import 하지 않는다(구조적 타입만) — page.tsx·MailInbox·테스트가 같이 쓴다.
 */

export type MailDraftStagingBridge = {
  stageMailDraft?: (draft: {
    body: string;
    subject?: string;
    to?: string;
    replyToMessageId?: string;
    connectorId?: string;
    threadId?: string;
    taskId?: string;
    teammateId?: string;
    teammateName?: string;
  }) => Promise<{ status: string; workItemId?: string; userMessage?: string }>;
};

export type ChatMailDraft = {
  body: string;
  to?: string;
  subject?: string;
  replyToMessageId?: string;
};

export const mailDraftApprovalLinkLabel = "승인함에서 보기";
export const mailDraftApprovalNotice = "승인함에 올려 두었어요 — [승인함에서 보기]를 누르면 받는 사람과 내용을 보고 보낼지 정할 수 있어요.";

const stagedStatuses = new Set(["mail_draft_card_staged", "mail_draft_card_updated"]);

/** 승인함에서 이 카드를 맨 위에 보여 주는 주소(자동으로 보내기 단계를 열지는 않는다). */
export function mailDraftApprovalHref(workItemId?: string): string {
  const id = String(workItemId ?? "").trim();
  return id
    ? `/office/?preview=workbench&officeView=approval&focusFinalActionCard=${encodeURIComponent(id)}`
    : "/office/?preview=workbench&officeView=approval";
}

const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

/**
 * 사용자가 이번 요청에 직접 적은 주소만 받는 사람으로 인정한다. 글자 일부가 아니라 주소 전체가 같아야 한다
 * ('kim@company.co.kr' 을 적었을 때 'kim@company.co'·'im@company.co.kr' 는 받는 사람이 되지 않는다).
 */
export function userTypedRecipient(requestText: string, to: string | undefined): string {
  const [address = ""] = String(to ?? "").trim().match(emailAddressPattern) ?? [];
  if (!address) return "";
  const typed = new Set((String(requestText ?? "").match(emailAddressPattern) ?? []).map((value) => value.toLowerCase()));
  return typed.has(address.toLowerCase()) ? address : "";
}

/** 초안 하나를 승인함 카드로 올리고 카드 id 를 돌려준다. 못 올리면 빈 문자열(채팅은 그대로 이어진다). */
export async function stageMailDraftToApproval(
  bridge: MailDraftStagingBridge,
  draft: ChatMailDraft,
  context: { requestText?: string; threadId?: string; connectorId?: string; teammateId?: string; teammateName?: string } = {},
): Promise<string> {
  const body = String(draft?.body ?? "").trim();
  if (!body || typeof bridge?.stageMailDraft !== "function") return "";
  const to = userTypedRecipient(context.requestText ?? "", draft.to);
  try {
    const result = await bridge.stageMailDraft({
      body,
      ...(to ? { to } : {}),
      ...(draft.subject?.trim() ? { subject: draft.subject.trim() } : {}),
      ...(draft.replyToMessageId?.trim() ? { replyToMessageId: draft.replyToMessageId.trim() } : {}),
      ...(context.connectorId ? { connectorId: context.connectorId } : {}),
      ...(context.threadId ? { threadId: context.threadId } : {}),
      ...(context.teammateId ? { teammateId: context.teammateId } : {}),
      ...(context.teammateName ? { teammateName: context.teammateName } : {}),
    });
    return stagedStatuses.has(result?.status) && result.workItemId ? result.workItemId : "";
  } catch {
    return "";
  }
}

/** 답변을 이보다 오래 붙잡지 않는다. 데스크톱은 원래 메일 다시 읽기를 12초에서 끊으므로 보통은 그 전에 끝난다. */
export const stagedMailDraftWaitMs = 20_000;

/**
 * 대화 중 올린 카드들을 모아 중복 없이 돌려준다(실패한 것은 뺀다).
 * 늦게 끝나는 카드 때문에 답변이 멈추지 않도록 waitMs 가 지나면 그때까지 올라온 카드만 돌려준다.
 */
export async function collectStagedMailDraftIds(
  pending: Array<Promise<string>>,
  waitMs: number = stagedMailDraftWaitMs,
): Promise<string[]> {
  if (!pending.length) return [];
  // 올린 순서를 지킨다(첫 카드가 [승인함에서 보기] 링크가 된다).
  const done: string[] = pending.map(() => "");
  const tracked = pending.map((entry, index) =>
    Promise.resolve(entry).then(
      (value) => {
        if (value) done[index] = value;
      },
      () => undefined,
    ),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(tracked),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, waitMs));
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return [...new Set(done.filter(Boolean))];
}

/**
 * 답변 끝에 한 줄을 붙인다. 이미 붙어 있으면 그대로 둔다.
 * 빈 줄 대신 줄바꿈 하나로 붙인다 — 말풍선은 줄바꿈을 줄로 그리지만, 빈 줄로 나눈 문단은 한 줄에 붙어 보인다.
 */
export function appendMailDraftApprovalNotice(text: string, stagedIds: string[]): string {
  if (!stagedIds.length) return text;
  const trimmed = String(text ?? "").trimEnd();
  if (trimmed.includes("승인함에 올려 두었어요")) return trimmed;
  return trimmed ? `${trimmed}\n${mailDraftApprovalNotice}` : mailDraftApprovalNotice;
}
