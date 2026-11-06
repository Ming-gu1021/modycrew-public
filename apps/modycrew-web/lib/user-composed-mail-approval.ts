import type { WorkItem } from "@/lib/types";
import { retainAuthoritativeMailCard } from "./mail-dispatch-ui.mjs";

export const USER_COMPOSED_MAIL_APPROVAL_PROOF = "user_composed_mail_check_result_to_approval_preview";
export const userComposedMailApprovalStorageKey = "modycrew-user-composed-mail-approval-items-v1";

export type UserComposedMailApprovalInput = {
  to?: string;
  subject?: string;
  body?: string;
  attachments?: string;
  checkFocus?: string;
  receivedAt?: string;
};

type UserComposedMailReviewItem = {
  id: "recipient" | "subject" | "body" | "attachment" | "risk";
  label: string;
  state: "ok" | "needs_review" | "missing";
  detail: string;
};

type UserComposedMailSendReviewItem = {
  id: "recipient" | "cc_bcc" | "subject" | "body" | "attachment" | "risk" | "calendar_side_effect" | "approval";
  label: string;
  title: string;
  state: "ok" | "needs_review" | "missing" | "locked";
  detail: string;
};

function cleanField(value: string | undefined, fallback: string, maxLength = 520) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function createUserComposedMailReview(input: UserComposedMailApprovalInput) {
  const to = cleanField(input.to, "", 160);
  const subject = cleanField(input.subject, "", 160);
  const body = cleanField(input.body, "", 1200);
  const attachments = cleanField(input.attachments, "", 180);
  const attachmentMentioned = /첨부|견적서|파일|계약서|제안서|링크|url|URL/u.test(body);
  const riskyTone = /급히|당장|무조건|확정|문제\s*없|책임|보장|반드시/u.test(body);
  const calendarMentioned = /일정|미팅|회의|방문|상담|예약|초대|캘린더|calendar/u.test(`${subject} ${body}`);
  const reviewItems: UserComposedMailReviewItem[] = [
    {
      id: "recipient",
      label: "수신자",
      state: to ? "ok" : "missing",
      detail: to ? `${to}로 발송 후보를 제한합니다.` : "받는 사람을 입력해야 승인 후보로 넘길 수 있습니다.",
    },
    {
      id: "subject",
      label: "제목",
      state: subject ? (subject.length >= 6 ? "ok" : "needs_review") : "missing",
      detail: subject
        ? subject.length >= 6
          ? "메일 목적이 제목에 드러납니다."
          : "제목이 짧습니다. 업무 목적이나 요청 내용을 보강하세요."
        : "제목을 입력해야 발송 전 검토가 쉬워집니다.",
    },
    {
      id: "body",
      label: "본문",
      state: body ? (body.length >= 24 ? "ok" : "needs_review") : "missing",
      detail: body
        ? body.length >= 24
          ? "인사, 핵심 내용, 다음 행동을 점검할 수 있습니다."
          : "본문이 짧습니다. 요청 내용과 다음 행동을 한 문장 더 넣으세요."
        : "본문을 입력하면 톤과 누락 정보를 점검합니다.",
    },
    {
      id: "attachment",
      label: "첨부/링크",
      state: attachments ? "ok" : attachmentMentioned ? "needs_review" : "ok",
      detail: attachments
        ? attachments
        : attachmentMentioned
          ? "본문에 첨부/링크 표현이 있습니다. 실제 파일이나 링크 확인 메모가 필요합니다."
          : "본문에서 첨부가 강하게 요구되지는 않습니다.",
    },
    {
      id: "risk",
      label: "위험 표현",
      state: riskyTone ? "needs_review" : body ? "ok" : "missing",
      detail: riskyTone
        ? "강한 확정/책임 표현이 보입니다. 부드러운 확인 요청 문장으로 고치세요."
        : body
          ? "과한 확정 표현은 보이지 않습니다. 최종 발송 전 한 번 더 확인합니다."
          : "본문 입력 후 금지 표현과 과한 톤을 점검합니다.",
    },
  ];
  const needsReviewLabels = reviewItems.filter((item) => item.state !== "ok").map((item) => item.label);
  const readyCount = reviewItems.length - needsReviewLabels.length;
  const oneLineSummary = needsReviewLabels.length
    ? `수정 필요 ${needsReviewLabels.length}개 · 통과 ${readyCount}개 · 승인 전 발송 잠금`
    : `점검 통과 ${readyCount}개 · 마지막 확인 전 발송 잠금`;
  const revisedDraftPreview = body
    ? body.slice(0, 360)
    : "본문을 입력하면 수정본 점검 결과가 승인 후보에 연결됩니다.";
  const sendReviewItems: UserComposedMailSendReviewItem[] = [
    {
      id: "recipient",
      label: "수신자",
      title: to || "입력 필요",
      state: to ? "ok" : "missing",
      detail: to ? "받는 사람과 참조를 마지막 확인에서 다시 대조합니다." : "수신자 없이는 승인 후보로 넘기지 않습니다.",
    },
    {
      id: "cc_bcc",
      label: "참조/숨은참조",
      title: "최종 확인에서 재확인",
      state: "needs_review",
      detail: "전체 회신, 참조, 숨은참조가 의도한 대상인지 발송 직전에 다시 확인합니다.",
    },
    {
      id: "subject",
      label: "제목",
      title: subject || "입력 필요",
      state: subject ? (subject.length >= 6 ? "ok" : "needs_review") : "missing",
      detail: "업무 목적과 요청 내용이 제목에서 보이는지 확인합니다.",
    },
    {
      id: "body",
      label: "본문",
      title: body ? body.slice(0, 72) : "입력 필요",
      state: body ? (body.length >= 24 ? "ok" : "needs_review") : "missing",
      detail: "인사, 핵심 내용, 다음 행동, 누락 정보를 발송 전에 확인합니다.",
    },
    {
      id: "attachment",
      label: "첨부",
      title: attachments || (attachmentMentioned ? "첨부 확인 필요" : "첨부 없음"),
      state: attachments ? "ok" : attachmentMentioned ? "needs_review" : "ok",
      detail: "본문에 언급된 파일, 링크, 견적서가 실제로 준비됐는지 봅니다.",
    },
    {
      id: "risk",
      label: "위험 표현",
      title: riskyTone ? "강한 표현 확인" : body ? "위험 표현 낮음" : "본문 입력 필요",
      state: riskyTone ? "needs_review" : body ? "ok" : "missing",
      detail: "확정, 책임, 보장처럼 되돌리기 어려운 표현을 발송 전 점검합니다.",
    },
    {
      id: "calendar_side_effect",
      label: "일정 등록",
      title: calendarMentioned ? "일정 언급 확인" : "일정 등록 없음",
      state: calendarMentioned ? "needs_review" : "ok",
      detail: calendarMentioned
        ? "메일 본문에 일정 표현이 있어도 캘린더 등록이나 초대 발송은 별도 마지막 확인 없이는 하지 않습니다."
        : "메일 점검만으로 캘린더 등록이나 초대 발송을 만들지 않습니다.",
    },
    {
      id: "approval",
      label: "승인 경계",
      title: "최종 확인 전 발송 없음",
      state: "locked",
      detail: "점검 결과는 승인 후보까지만 만들고 실제 발송과 일정 등록은 마지막 확인 뒤에만 요청합니다.",
    },
  ];
  return {
    reviewItems,
    sendReviewItems,
    oneLineSummary,
    readinessLabel: needsReviewLabels.length ? `${needsReviewLabels.join(", ")} 확인 필요` : "승인 전 점검 가능",
    revisedDraftPreview,
    finalRouteLabel: "작성 메일 점검 -> 승인 후보 -> 앱 마지막 확인 -> 발송 요청",
    decisionOptions: ["승인", "수정", "보류"],
    mobileReceiveFilterIds: ["approval_waiting", "urgent_risk"],
    mobileReceiveFilterLabels: ["승인 대기", "긴급/위험"],
    revisionSuggestion: needsReviewLabels.length
      ? `수정 제안: ${needsReviewLabels.join(", ")} 확인 후 승인 후보로 넘기기`
      : "수정 제안: 필수 항목이 채워졌습니다. 최종 확인 전 수신자, 참조, 첨부, 일정 등록 여부만 다시 확인",
  };
}

export function createUserComposedMailApprovalWorkItem(input: UserComposedMailApprovalInput): WorkItem {
  const receivedAt = input.receivedAt || new Date().toISOString();
  const to = cleanField(input.to, "수신자 확인 필요", 160);
  const subject = cleanField(input.subject, "제목 확인 필요", 160);
  const body = cleanField(input.body, "본문을 입력하면 문장 점검과 수정 제안을 이어갑니다.", 1200);
  const attachments = cleanField(input.attachments, "첨부 없음 또는 확인 필요", 180);
  const checkFocus = cleanField(input.checkFocus, "수신자, 제목, 본문 톤, 금지 표현, 첨부 누락", 220);
  const review = createUserComposedMailReview(input);

  return {
    id: "user-composed-mail-check",
    title: "작성 메일 점검 결과",
    source: "manual_input",
    sourceLabel: "작성 메일 점검",
    senderLabel: "내가 작성한 메일",
    body,
    summary: `수신자, 참조, 제목, 본문, 첨부, 일정 등록 여부를 점검하고 수정 후 승인 후보로 보류합니다. 점검 기준: ${checkFocus}`,
    status: "approval_pending",
    riskLabel: "high",
    riskSignals: [
      {
        id: "user-composed-mail-send-risk",
        label: "외부 메일 발송",
        riskLabel: "high",
        reason: "직접 작성한 메일도 수신자와 첨부를 잘못 보내면 되돌리기 어렵기 때문에 승인 전까지 발송하지 않습니다.",
      },
      {
        id: "user-composed-mail-content-risk",
        label: "본문/첨부 점검 필요",
        riskLabel: "medium",
        reason: "금지 표현, 누락 정보, 첨부 누락, 과한 톤을 발송 전에 확인해야 합니다.",
      },
    ],
    receivedAt,
    sourceEvidence: {
      connectorId: "user-composed-mail",
      providerId: USER_COMPOSED_MAIL_APPROVAL_PROOF,
      mailboxLabel: "직접 작성",
      messageSubject: subject,
      senderPreview: "사용자 작성",
      replyToLabel: to,
      draftPreview: body,
      detectedIntentLabels: ["user_composed_mail_check", "mail_send_review", "approval_required"],
      approvalCandidateLabels: ["작성 메일 점검", "수정 후 승인 후보", "최종 확인 전 발송 차단"],
      mobileReceiveFilterIds: ["approval_waiting", "urgent_risk"],
      mobileReceiveFilterLabels: ["승인 대기", "긴급/위험"],
      userComposedMailReview: {
        proof: USER_COMPOSED_MAIL_APPROVAL_PROOF,
        oneLineSummary: review.oneLineSummary,
        readinessLabel: review.readinessLabel,
        revisionSuggestion: review.revisionSuggestion,
        revisedDraftPreview: review.revisedDraftPreview,
        finalRouteLabel: review.finalRouteLabel,
        decisionOptions: review.decisionOptions,
        mobileReceiveFilterIds: review.mobileReceiveFilterIds,
        mobileReceiveFilterLabels: review.mobileReceiveFilterLabels,
        approvalGate: "수신자, 참조, 제목, 본문, 첨부, 위험 표현, 일정 등록 여부를 확인하고 사용자가 승인하기 전까지 발송하지 않습니다.",
        reviewItems: review.reviewItems,
        sendReviewItems: review.sendReviewItems,
      },
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    },
    draft: {
      id: "user-composed-mail-draft",
      toneLabel: "문장 점검 후 수정",
      body,
      operationKind: "send_email",
      requiresApprovalBeforeSend: true,
    },
    finalAction: {
      kind: "send_email",
      label: "작성 메일 발송 최종 확인",
      requiresFinalUserPresence: true,
      readiness: "adapter_not_connected",
      blockedReason: "작성 점검 결과와 메일 연결, 최종 확인 전까지 실제 발송하지 않습니다.",
      checklist: [
        `수신자 확인: ${to}`,
        `제목 확인: ${subject}`,
        `첨부 확인: ${attachments}`,
        "참조/숨은참조와 일정 등록 여부 확인",
        "본문 톤과 금지 표현 확인",
        "사용자 최종 확인 전 외부 발송 없음",
      ],
      mailSendApprovalGate: {
        policy: "user_composed_check_approve_only",
        requiredDecision: "approve",
        decision: "approve",
        requiredFinalRoute: "included",
        finalRoute: "included",
        sourceContract: USER_COMPOSED_MAIL_APPROVAL_PROOF,
        externalMutationBeforeGate: false,
      },
    },
  };
}

export function isUserComposedMailApprovalWorkItem(item: WorkItem | null | undefined): boolean {
  return item?.sourceEvidence?.providerId === USER_COMPOSED_MAIL_APPROVAL_PROOF;
}

export function readUserComposedMailApprovalWorkItems(): WorkItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(userComposedMailApprovalStorageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WorkItem =>
      Boolean(item && typeof item.id === "string" && isUserComposedMailApprovalWorkItem(item as WorkItem)),
    );
  } catch {
    return [];
  }
}

export function upsertUserComposedMailApprovalWorkItem(input: UserComposedMailApprovalInput): WorkItem {
  const nextItem = createUserComposedMailApprovalWorkItem(input);
  if (typeof window === "undefined") return nextItem;
  const current = readUserComposedMailApprovalWorkItems().filter((item) => item.id !== nextItem.id);
  window.localStorage.setItem(userComposedMailApprovalStorageKey, JSON.stringify([nextItem, ...current].slice(0, 6)));
  return nextItem;
}

export function mergeUserComposedMailApprovalWorkItems(items: WorkItem[], userComposedItems: WorkItem[]): WorkItem[] {
  const merged = [...items];
  for (const item of userComposedItems) {
    const index = merged.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) { if (!retainAuthoritativeMailCard(merged[index]!)) merged[index] = item; }
    else merged.unshift(item);
  }
  return merged;
}
