import { createToolActionRequest } from "./policy.js";
import type {
  ISODateTimeString,
  ModyChannelId,
  ModyOutboundMessage,
  ToolActionRequest,
} from "./types.js";

export type ModyIncomingMail = {
  id: string;
  from: string;
  subject: string;
  bodyPreview: string;
  receivedAt: ISODateTimeString;
  mailboxId?: string;
};

export type ModyUserWritingProfile = {
  toneLabel: string;
  formatLabel: string;
  signature?: string;
  calendarPreference?: string;
};

export type ModyMailPersonalizedWorkTemplate = {
  id: string;
  detectedWorkType: string;
  templateLabel: string;
  summary: string;
  personalContext: {
    toneLabel: string;
    formatLabel: string;
    signaturePolicy: string;
    calendarPreference: string;
  };
  optimizedSteps: string[];
  draftGuidance: string[];
  approvalChecklist: string[];
  learningSignals: string[];
  reusableProfileFields: string[];
  privacyBoundary: string;
};

export type ModyMailWorkflowClassification =
  | "ignored_noise"
  | "business_mail"
  | "needs_review";

/** Optional, validated semantic advice. Execution permissions never come from a model. */
export type ModyMailDecisionHint = {
  model: "jev-1.13.0";
  category: ModyMailWorkflowClassification;
  confidence: number;
  probability: number;
  needsReply: number;
  urgencyScore: number;
  urgencyConfidence: number;
  /** 업무 종류(담당 제안용). 발송·알림 결정에는 쓰지 않는다. */
  workType?: ModyMailWorkCategoryId;
  workTypeConfidence?: number;
  workTypeProbability?: number;
};

/** 메일 업무 종류 — 담당 AI 직원을 고르는 데만 쓴다. */
export type ModyMailWorkCategoryId =
  | "quote"
  | "order"
  | "billing"
  | "tax"
  | "contract"
  | "schedule"
  | "hiring"
  | "complaint"
  | "inquiry"
  | "other";

export type ModyMailWorkCategory = {
  id: ModyMailWorkCategoryId;
  /** 사용자에게 보이는 짧은 이름(예: 견적). */
  label: string;
  source: "jev" | "rule";
  /** 담당 배정(routeWorkRequest)에 넘길 업무 어휘. */
  routingKeywords: string[];
};

export type ModyMailWorkPriorityLevel = "urgent" | "normal" | "low";

/**
 * 승인함 정렬용 우선순위. 발송·알림·자동 실행을 정하지 않는다.
 * reason 은 한 줄 한국어(없으면 빈 문자열), source 는 Jev 판단을 함께 봤는지.
 */
export type ModyMailWorkPriority = {
  level: ModyMailWorkPriorityLevel;
  reason: string;
  source: "jev" | "rule";
  /** Jev 검토 긴급도(0~2, 소수 둘째 자리). */
  jevUrgencyScore?: number;
  /** Jev 회신 필요 확률(0~1, 소수 둘째 자리). */
  jevReplyChance?: number;
};

/**
 * 답장이 필요한 메일인지에 대한 판단.
 * - reply: 질문·요청이 있어 답장 초안을 만든다.
 * - no_reply: 보낸 분이 회신이 필요 없다고 했거나(공유·참고용) 자동 발신 메일이다.
 * - unknown: 신호가 없다(업무 메일이면 기존처럼 답장 초안을 만든다).
 */
export type ModyMailReplyDecision = "reply" | "no_reply" | "unknown";

export type ModyMailWorkflowPlan = {
  id: string;
  classification: ModyMailWorkflowClassification;
  classificationReason?: string;
  shouldCreateWorkItem: boolean;
  shouldNotifyUserImmediately: boolean;
  ignoredReason?: string;
  workItemTitle?: string;
  analysisSummary: string;
  /**
   * 답장 초안 본문. 받는 분에게 그대로 나갈 수 있는 글만 담는다 —
   * 내부 표기(형식/말투 라벨)는 formatLabel/toneLabel 필드로만 나른다.
   */
  draftReply?: string;
  /** 답장 초안에 적용한 형식 라벨(내부 표기, 본문에는 넣지 않는다). */
  formatLabel?: string;
  /** 답장 초안에 적용한 말투 라벨(내부 표기, 본문에는 넣지 않는다). */
  toneLabel?: string;
  replyDecision?: ModyMailReplyDecision;
  replyDecisionReason?: string;
  /** 승인함 정렬용 우선순위(광고·스팸 제외 메일에만). */
  priority?: ModyMailWorkPriority;
  /** 담당 제안용 업무 종류(광고·스팸 제외 메일에만). */
  workCategory?: ModyMailWorkCategory;
  calendarDraft?: string;
  personalizedWorkTemplate: ModyMailPersonalizedWorkTemplate;
  actionRequests: ToolActionRequest[];
  approvalQueue: ToolActionRequest[];
  channelReport: ModyOutboundMessage;
  auditMessages: string[];
};

export type ModyMailWorkflowInput = {
  mail: ModyIncomingMail;
  writingProfile: ModyUserWritingProfile;
  reportChannelId: ModyChannelId;
  appDeepLink?: string;
  decisionHint?: ModyMailDecisionHint | undefined;
};

type MailWorkflowPlannerOptions = {
  now?: () => Date;
};

export class ModyMailWorkflowPlanner {
  private readonly now: () => Date;

  constructor(options: MailWorkflowPlannerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createPlan(input: ModyMailWorkflowInput): ModyMailWorkflowPlan {
    const plan = this.createClassifiedPlan(input);
    if (plan.classification === "ignored_noise") return plan;
    // 보안 알림은 모델 조언 없이 규칙으로만 본다(분류와 같은 원칙).
    const securityAlert = /계정 또는 인증 보안 알림/u.test(plan.classificationReason ?? "");
    const hint = securityAlert ? undefined : input.decisionHint;
    // 직접 확인이 필요한 메일(보안 알림·업무 여부가 애매한 메일)은 '긴급·즉시' 같은 재촉 표현으로 올리지 않는다.
    const reviewFirst = securityAlert ? "security_alert" : plan.classification === "needs_review" ? "needs_review" : undefined;
    return {
      ...plan,
      priority: deriveMailWorkPriority({ mail: input.mail, hint, replyDecision: plan.replyDecision, reviewFirst }),
      workCategory: classifyMailWorkCategory(input.mail, hint),
    };
  }

  private createClassifiedPlan(input: ModyMailWorkflowInput): ModyMailWorkflowPlan {
    const createdAt = this.now().toISOString();
    const baseline = classifyMail(input.mail);
    const classification = resolveMailDecisionHint(baseline, input.decisionHint);
    const reply = resolveMailReplyDecision(baseline, input.decisionHint);
    const readAction = createReadMailAction(input.mail, createdAt);
    const analyzeAction = createAnalyzeMailAction(input.mail, classification, createdAt);
    const needsSchedule = classification.kind === "business_mail" && looksLikeScheduleMail(input.mail);
    const personalizedWorkTemplate = createPersonalizedWorkTemplate(
      input.mail,
      input.writingProfile,
      classification.kind,
      needsSchedule,
    );

    if (classification.kind === "ignored_noise") {
      return this.createIgnoredPlan(input, classification.reason, [readAction, analyzeAction], createdAt, personalizedWorkTemplate);
    }

    if (classification.kind === "needs_review") {
      return this.createReviewPlan(input, classification.reason, [readAction, analyzeAction], createdAt, personalizedWorkTemplate);
    }

    if (reply.decision === "no_reply") {
      return this.createNoReplyBusinessPlan(
        input,
        classification.reason,
        reply,
        needsSchedule,
        [readAction, analyzeAction],
        createdAt,
        personalizedWorkTemplate,
      );
    }

    const draftReplyAction = createDraftReplyAction(input.mail, input.writingProfile, createdAt);
    const actionRequests = [readAction, analyzeAction, draftReplyAction];
    const approvalQueue: ToolActionRequest[] = [];
    const draftReply = createDraftReply(input.mail, input.writingProfile, needsSchedule, personalizedWorkTemplate);
    const calendarDraft = needsSchedule
      ? createCalendarDraft(input.mail, input.writingProfile)
      : undefined;

    if (needsSchedule) {
      actionRequests.push(createDraftCalendarAction(input.mail, input.writingProfile, createdAt));
    }

    const sendEmailAction = createSendEmailAction(input.mail, createdAt);
    const stageSendAction = createApprovalStageAction(input.mail, sendEmailAction, createdAt);
    actionRequests.push(stageSendAction, sendEmailAction);
    approvalQueue.push(sendEmailAction);

    if (needsSchedule) {
      const createCalendarAction = createCalendarEventAction(input.mail, createdAt);
      const stageCalendarAction = createApprovalStageAction(input.mail, createCalendarAction, createdAt);
      actionRequests.push(stageCalendarAction, createCalendarAction);
      approvalQueue.push(createCalendarAction);
    }

    return {
      id: `mail_workflow_${input.mail.id}`,
      classification: "business_mail",
      classificationReason: classification.reason,
      shouldCreateWorkItem: true,
      shouldNotifyUserImmediately: true,
      workItemTitle: `업무 메일 처리: ${input.mail.subject}`,
      analysisSummary: needsSchedule
        ? "업무 메일로 분류했고 답장 초안과 일정 후보를 만들었습니다. 메일 발송과 캘린더 등록은 승인 후 실행됩니다."
        : "업무 메일로 분류했고 사용자 말투와 지정 포맷에 맞춘 답장 초안을 만들었습니다. 메일 발송은 승인 후 실행됩니다.",
      draftReply,
      formatLabel: input.writingProfile.formatLabel,
      toneLabel: input.writingProfile.toneLabel,
      replyDecision: reply.decision,
      replyDecisionReason: reply.reason,
      ...(calendarDraft ? { calendarDraft } : {}),
      personalizedWorkTemplate,
      actionRequests,
      approvalQueue,
      channelReport: this.createBusinessReport(input, needsSchedule, createdAt),
      auditMessages: [
        "메일함에서 새 메일을 읽고 광고/스팸 후보를 먼저 걸렀습니다.",
        "업무 메일로 판단되어 사용자 지정 말투와 포맷으로 답장 초안을 만들었습니다.",
        `${personalizedWorkTemplate.templateLabel}: ${personalizedWorkTemplate.summary}`,
        needsSchedule
          ? "일정 요청이 감지되어 캘린더 등록 후보를 만들고 승인 대기 상태로 분리했습니다."
          : "외부 메일 발송은 승인 대기 상태로 분리했습니다.",
        "메신저 보고는 요약과 앱 열기 링크 중심이며 외부 실행은 앱 승인 후에만 진행됩니다.",
      ],
    };
  }

  private createIgnoredPlan(
    input: ModyMailWorkflowInput,
    ignoredReason: string,
    actionRequests: ToolActionRequest[],
    createdAt: ISODateTimeString,
    personalizedWorkTemplate: ModyMailPersonalizedWorkTemplate,
  ): ModyMailWorkflowPlan {
    return {
      id: `mail_workflow_${input.mail.id}`,
      classification: "ignored_noise",
      classificationReason: ignoredReason,
      shouldCreateWorkItem: false,
      shouldNotifyUserImmediately: false,
      ignoredReason,
      analysisSummary: "광고/스팸/뉴스레터 후보로 분류해 업무 인박스와 즉시 메신저 보고에서 제외합니다.",
      personalizedWorkTemplate,
      actionRequests,
      approvalQueue: [],
      channelReport: {
        id: `outbound_mail_workflow_${input.mail.id}`,
        channelId: input.reportChannelId,
        text: "광고/스팸 후보 메일은 업무 인박스에 올리지 않고 일일 요약에서만 확인합니다.",
        actionLabels: ["무시 유지", "업무로 전환"],
        createdAt,
      },
      auditMessages: [
        "메일함에서 새 메일을 읽었습니다.",
        `광고/스팸 후보로 무시했습니다: ${ignoredReason}`,
        `${personalizedWorkTemplate.templateLabel}: ${personalizedWorkTemplate.optimizedSteps[0]}`,
        "사용자에게 즉시 알림을 보내지 않고 일일 요약 후보로만 남겼습니다.",
      ],
    };
  }

  private createReviewPlan(
    input: ModyMailWorkflowInput,
    reviewReason: string,
    actionRequests: ToolActionRequest[],
    createdAt: ISODateTimeString,
    personalizedWorkTemplate: ModyMailPersonalizedWorkTemplate,
  ): ModyMailWorkflowPlan {
    return {
      id: `mail_workflow_${input.mail.id}`,
      classification: "needs_review",
      classificationReason: reviewReason,
      shouldCreateWorkItem: true,
      shouldNotifyUserImmediately: false,
      workItemTitle: `확인 필요 메일: ${input.mail.subject}`,
      analysisSummary:
        "업무 메일인지 자동 확정하기 애매해 업무 인박스의 확인 필요 항목으로 올립니다. 답장 발송과 일정 등록 후보는 만들지 않습니다.",
      personalizedWorkTemplate,
      actionRequests,
      approvalQueue: [],
      channelReport: {
        id: `outbound_mail_workflow_${input.mail.id}`,
        channelId: input.reportChannelId,
        text: "업무 여부 확인이 필요한 메일을 발견했습니다. 앱에서 업무로 전환하거나 무시할 수 있습니다.",
        actionLabels: ["업무로 전환", "무시", "보류"],
        createdAt,
        ...(input.appDeepLink ? { appDeepLink: input.appDeepLink } : {}),
      },
      auditMessages: [
        "메일함에서 새 메일을 읽고 광고/스팸 후보를 먼저 걸렀습니다.",
        `업무 여부가 애매해 확인 필요로 분류했습니다: ${reviewReason}`,
        `${personalizedWorkTemplate.templateLabel}: ${personalizedWorkTemplate.optimizedSteps[0]}`,
        "외부 메일 발송과 캘린더 등록 후보는 만들지 않았습니다.",
      ],
    };
  }

  /**
   * 업무 메일이지만 회신이 필요 없는 경우(공유·참고용, "회신 불필요", 자동 발신).
   * 업무 카드는 남기되 답장 초안과 발송 후보는 만들지 않는다. 일정이 보이면 일정 후보만 둔다.
   */
  private createNoReplyBusinessPlan(
    input: ModyMailWorkflowInput,
    classificationReason: string,
    reply: { decision: ModyMailReplyDecision; reason: string },
    needsSchedule: boolean,
    actionRequests: ToolActionRequest[],
    createdAt: ISODateTimeString,
    personalizedWorkTemplate: ModyMailPersonalizedWorkTemplate,
  ): ModyMailWorkflowPlan {
    const approvalQueue: ToolActionRequest[] = [];
    const calendarDraft = needsSchedule ? createCalendarDraft(input.mail, input.writingProfile) : undefined;
    const nextActions = [...actionRequests];
    if (needsSchedule) {
      nextActions.push(createDraftCalendarAction(input.mail, input.writingProfile, createdAt));
      const createCalendarAction = createCalendarEventAction(input.mail, createdAt);
      const stageCalendarAction = createApprovalStageAction(input.mail, createCalendarAction, createdAt);
      nextActions.push(stageCalendarAction, createCalendarAction);
      approvalQueue.push(createCalendarAction);
    }

    return {
      id: `mail_workflow_${input.mail.id}`,
      classification: "business_mail",
      classificationReason,
      shouldCreateWorkItem: true,
      shouldNotifyUserImmediately: needsSchedule,
      workItemTitle: `업무 메일 처리: ${input.mail.subject}`,
      analysisSummary: needsSchedule
        ? "회신이 필요 없는 업무 메일이라 답장 초안은 만들지 않았고, 일정 후보만 승인 대기로 두었습니다."
        : "회신이 필요 없는 업무 메일이라 답장 초안은 만들지 않았습니다. 내용만 확인해 두면 됩니다.",
      ...(calendarDraft ? { calendarDraft } : {}),
      replyDecision: reply.decision,
      replyDecisionReason: reply.reason,
      personalizedWorkTemplate,
      actionRequests: nextActions,
      approvalQueue,
      channelReport: {
        id: `outbound_mail_workflow_${input.mail.id}`,
        channelId: input.reportChannelId,
        text: needsSchedule
          ? "회신이 필요 없는 업무 메일에서 일정 후보를 찾았습니다. 앱에서 확인하면 캘린더에 등록할 수 있습니다."
          : "회신이 필요 없는 업무 메일을 확인했습니다. 답장 초안은 만들지 않았습니다.",
        actionLabels: needsSchedule ? ["앱에서 승인", "보류"] : ["확인", "업무로 전환"],
        createdAt,
        ...(input.appDeepLink ? { appDeepLink: input.appDeepLink } : {}),
      },
      auditMessages: [
        "메일함에서 새 메일을 읽고 광고/스팸 후보를 먼저 걸렀습니다.",
        `업무 메일이지만 답장이 필요 없다고 판단했습니다: ${reply.reason}`,
        `${personalizedWorkTemplate.templateLabel}: ${personalizedWorkTemplate.summary}`,
        needsSchedule
          ? "일정 요청이 감지되어 캘린더 등록 후보만 승인 대기 상태로 분리했습니다."
          : "답장 발송 후보는 만들지 않았습니다.",
      ],
    };
  }

  private createBusinessReport(
    input: ModyMailWorkflowInput,
    needsSchedule: boolean,
    createdAt: ISODateTimeString,
  ): ModyOutboundMessage {
    const report: ModyOutboundMessage = {
      id: `outbound_mail_workflow_${input.mail.id}`,
      channelId: input.reportChannelId,
      text: needsSchedule
        ? "업무 메일을 분석해 답장 초안과 일정 후보를 만들었습니다. 앱에서 승인하면 메일 발송과 캘린더 등록을 진행합니다."
        : "업무 메일을 분석해 사용자 말투의 답장 초안을 만들었습니다. 앱에서 승인하면 메일 발송을 진행합니다.",
      actionLabels: ["앱에서 승인", "수정 요청", "보류"],
      createdAt,
    };

    if (input.appDeepLink) {
      report.appDeepLink = input.appDeepLink;
    }

    return report;
  }
}

type MailBaselineDecision = {
  kind: ModyMailWorkflowClassification;
  reason: string;
  reply?: MailKeywordReplyDecision;
};

type MailKeywordReplyDecision = {
  decision: ModyMailReplyDecision;
  /** hard: 보낸 분이 회신이 필요 없다고 직접 적었거나 자동 발신 주소 — Jev도 뒤집지 않는다. */
  strength: "hard" | "soft" | "none";
  reason: string;
};

function isUsableMailDecisionHint(
  baseline: { kind: ModyMailWorkflowClassification; reason: string },
  hint?: ModyMailDecisionHint,
): hint is ModyMailDecisionHint {
  return Boolean(hint) && hint!.model === "jev-1.13.0" &&
    ["business_mail", "ignored_noise", "needs_review"].includes(hint!.category) &&
    [hint!.confidence, hint!.probability, hint!.needsReply, hint!.urgencyConfidence].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) && Number.isFinite(hint!.urgencyScore) && hint!.urgencyScore >= 0 && hint!.urgencyScore <= 2 &&
    hint!.confidence >= 0.9 && hint!.probability >= 0.9 &&
    !/계정 또는 인증 보안 알림/u.test(baseline.reason);
}

export function resolveMailDecisionHint(
  baseline: { kind: ModyMailWorkflowClassification; reason: string },
  hint?: ModyMailDecisionHint,
): { kind: ModyMailWorkflowClassification; reason: string } {
  if (!isUsableMailDecisionHint(baseline, hint)) return baseline;

  // An experimental model may surface a missed message, but may never hide one.
  if (hint.category !== baseline.kind) {
    return {
      kind: "needs_review",
      reason: "기존 분류와 Jev의 판단이 달라 직접 확인이 필요합니다. 원문은 그대로 보관합니다.",
    };
  }
  return { kind: baseline.kind, reason: `${baseline.reason} Jev도 같은 분류를 제안했습니다.` };
}

/**
 * 답장이 필요한지 정한다. 키워드 판단이 기본이고, 쓸 수 있는 Jev 힌트가 있으면
 * needsReply(0.5 이상이면 답장)로 초안을 더하거나 뺀다. 단, 보낸 분이 직접
 * "회신 불필요"라고 적었거나 자동 발신 주소면 Jev도 뒤집지 않는다.
 * Jev는 메일을 숨기지 못한다 — 초안만 빼고 업무 카드는 그대로 남는다.
 */
export function resolveMailReplyDecision(
  baseline: MailBaselineDecision,
  hint?: ModyMailDecisionHint,
): { decision: ModyMailReplyDecision; reason: string } {
  const keyword = baseline.reply ?? { decision: "unknown", strength: "none", reason: "답장 필요 여부 신호가 없습니다." };
  if (keyword.strength === "hard" || !isUsableMailDecisionHint(baseline, hint)) {
    return { decision: keyword.decision, reason: keyword.reason };
  }
  return hint.needsReply >= 0.5
    ? { decision: "reply", reason: "Jev가 답장이 필요한 메일로 판단했습니다." }
    : { decision: "no_reply", reason: "Jev가 답장이 필요 없는 메일로 판단했습니다." };
}

/* ------------------------------------------------------------------ */
/* 승인함 정렬용 우선순위 · 담당 제안용 업무 종류                        */
/* ------------------------------------------------------------------ */

/** 오늘 안에 처리해 달라는 표현. "오늘"만으로는 급하다고 보지 않는다(오늘 날씨 등). */
const todayDeadlinePattern =
  /오늘\s*(?:중(?!요)|까지|안에|안으로|내로|오전|오후|마감)|금일|\bby\s+(?:today|eod)\b|\beod\b|end\s+of\s+(?:the\s+)?day/iu;
const tomorrowDeadlinePattern = /내일\s*(?:까지|중(?!요)|안에|내로|오전|오후|마감)|명일|\bby\s+tomorrow\b/iu;
const urgentWordPattern =
  /급함|급합니다|급히|급하게|긴급|시급|\basap\b|\burgent(?:ly)?\b|즉시|빠른\s*(?:회신|답변|답장|확인|처리)|최대한\s*빨리|서둘러/iu;
const deadlineWordPattern = /마감(?!재)|기한|까지\s*(?:회신|답변|답장|제출|보내|전달)|deadline|due\s+(?:date|by)/iu;

/**
 * 답장 메일 아래에 딸려 온 예전 메일(인용)의 시작. 예전 메일의 '오늘까지'가 새 메일을 급하게 만들지 않게
 * 우선순위를 볼 때만 이 앞부분까지 본다(분류·답장 판단은 그대로 전체를 본다).
 */
const quotedReplyHistoryPattern =
  /-{2,}\s*(?:original\s+message|원본\s*(?:메시지|메일))\s*-{2,}|\bOn\s[^\n]{4,160}?\swrote:|님이\s*작성(?:함|했습니다)?\s*:|_{8,}\s*(?:보낸\s*사람|from)\s*:|(?:^|\n)\s*>/iu;

function withoutQuotedReplyHistory(text: string): string {
  const match = quotedReplyHistoryPattern.exec(text);
  return match ? text.slice(0, match.index) : text;
}

const JEV_PRIORITY_MIN_URGENCY_CONFIDENCE = 0.6;
const JEV_URGENT_SCORE = 1.5;
const JEV_ROUTINE_SCORE = 0.4;
const JEV_REPLY_LIKELY = 0.7;
const JEV_REPLY_UNLIKELY = 0.3;

function isUsablePriorityHint(hint?: ModyMailDecisionHint): hint is ModyMailDecisionHint {
  return Boolean(hint) && hint!.model === "jev-1.13.0" &&
    [hint!.needsReply, hint!.urgencyConfidence].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    Number.isFinite(hint!.urgencyScore) && hint!.urgencyScore >= 0 && hint!.urgencyScore <= 2;
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 승인함에서 먼저 볼 메일을 고른다. 보수적으로:
 * - 급함: 오늘·내일 마감, '급함/ASAP' 같은 표현, 또는 Jev 긴급도 1.5 이상(긴급도 확신 0.6 이상)
 * - 낮음: 회신이 필요 없다고 본 메일(마감 표현 없음), 또는 Jev가 긴급도·회신 확률 모두 낮다고 본 메일
 *   (규칙이 답장이 필요하다고 본 메일은 Jev만으로 낮추지 않는다)
 * - 그 밖에는 보통.
 * - reviewFirst: 직접 확인이 먼저인 메일은 급함으로 올리지 않는다. 피싱·사칭 메일은 '긴급·즉시'로
 *   재촉하기 마련이라, 그런 표현이 승인함 맨 위 빨간 '급함'이 되면 안 된다. 계정 보안 알림은 늘 보통.
 * 순서만 바꿀 뿐 어떤 메일도 숨기거나 보내지 않는다. Jev 판단이 없으면 규칙만 쓴다.
 */
export function deriveMailWorkPriority(input: {
  mail: Pick<ModyIncomingMail, "subject" | "bodyPreview">;
  hint?: ModyMailDecisionHint | undefined;
  replyDecision?: ModyMailReplyDecision | undefined;
  reviewFirst?: "security_alert" | "needs_review" | undefined;
}): ModyMailWorkPriority {
  const text = `${input.mail.subject ?? ""} ${withoutQuotedReplyHistory(String(input.mail.bodyPreview ?? ""))}`;
  const today = todayDeadlinePattern.test(text);
  const tomorrow = !today && tomorrowDeadlinePattern.test(text);
  const urgentWord = urgentWordPattern.test(text);
  const deadlineWord = deadlineWordPattern.test(text);
  const ruleUrgent = today || tomorrow || urgentWord;

  const jev = isUsablePriorityHint(input.hint) ? input.hint : undefined;
  const scoreTrusted = Boolean(jev) && jev!.urgencyConfidence >= JEV_PRIORITY_MIN_URGENCY_CONFIDENCE;
  const jevUrgent = scoreTrusted && jev!.urgencyScore >= JEV_URGENT_SCORE;
  const jevRoutine = scoreTrusted && jev!.urgencyScore <= JEV_ROUTINE_SCORE;
  const jevReplyLikely = Boolean(jev) && jev!.needsReply >= JEV_REPLY_LIKELY;
  const jevReplyUnlikely = Boolean(jev) && jev!.needsReply <= JEV_REPLY_UNLIKELY;

  const ruleLow = input.replyDecision === "no_reply" && !deadlineWord;
  const jevLow = jevRoutine && jevReplyUnlikely && input.replyDecision !== "reply" && !deadlineWord;
  const source = jev ? "jev" : "rule";
  const jevNumbers = jev ? { jevUrgencyScore: roundTo2(jev.urgencyScore), jevReplyChance: roundTo2(jev.needsReply) } : {};

  if (input.reviewFirst === "security_alert") {
    return { level: "normal", reason: "계정 보안 알림 · 진짜 메일인지 직접 확인", source, ...jevNumbers };
  }
  const pressed = ruleUrgent || jevUrgent;
  if (input.reviewFirst === "needs_review") {
    const level: ModyMailWorkPriorityLevel = !pressed && (ruleLow || jevLow) ? "low" : "normal";
    const parts = ["직접 확인이 필요한 메일"];
    if (pressed) parts.push("급하다는 표현은 순서에 반영하지 않음");
    else if (level === "low") parts.push(ruleLow ? "회신이 필요 없는 메일" : "Jev: 회신 필요 가능성 낮음");
    else if (deadlineWord) parts.push("마감 언급");
    return { level, reason: parts.join(" · "), source, ...jevNumbers };
  }

  const level: ModyMailWorkPriorityLevel = pressed ? "urgent" : ruleLow || jevLow ? "low" : "normal";

  const parts: string[] = [];
  if (jevUrgent) parts.push("Jev: 빨리 볼 메일");
  if (jevReplyLikely) parts.push("Jev: 회신 필요 가능성 높음");
  if (level === "low" && jevLow && !ruleLow) parts.push("Jev: 회신 필요 가능성 낮음");
  if (today) parts.push("오늘 마감 언급");
  if (tomorrow) parts.push("내일 마감 언급");
  // '급함'·ASAP·즉시·빠른 회신·서둘러 등 — 어떤 낱말이었든 맞게 읽히는 말로 적는다.
  if (urgentWord) parts.push("서둘러 달라는 표현");
  if (!today && !tomorrow && deadlineWord) parts.push("마감 언급");
  if (level === "low" && ruleLow) parts.push("회신이 필요 없는 메일");

  return {
    level,
    reason: parts.slice(0, 3).join(" · "),
    source,
    ...jevNumbers,
  };
}

type MailWorkCategoryRule = {
  id: Exclude<ModyMailWorkCategoryId, "other">;
  label: string;
  /** 흔한 낱말(일정·문의)은 가볍게 센다 — '견적 문의'가 문의로 가지 않게. */
  weight: number;
  pattern: RegExp;
  routingKeywords: string[];
};

// 동점이면 위에 있는 종류를 고른다(구체적인 것 → 일반적인 것).
const mailWorkCategoryRules: readonly MailWorkCategoryRule[] = [
  { id: "hiring", label: "채용", weight: 1, pattern: /채용|이력서|지원서|입사\s*지원|면접|구인|resume|interview|job\s+application/giu, routingKeywords: ["채용", "인사", "면접", "지원자"] },
  { id: "tax", label: "세금", weight: 1, pattern: /세금계산서|부가세|부가가치세|세무|원천징수|종합소득세|법인세|연말정산|tax\s+invoice|\bvat\b/giu, routingKeywords: ["세금", "세금계산서", "부가세", "세무"] },
  { id: "billing", label: "정산·청구", weight: 1, pattern: /정산|청구|대금|입금|송금|결제\s*(?:요청|부탁|확인|기한)|미수금|invoice|payment|billing/giu, routingKeywords: ["정산", "청구", "비용", "회계"] },
  { id: "quote", label: "견적", weight: 1, pattern: /견적|단가|가격\s*(?:문의|협의|제안)|quotation|\bquote\b|\brfq\b/giu, routingKeywords: ["견적", "영업", "거래처", "문의"] },
  { id: "contract", label: "계약", weight: 1, pattern: /계약|약관|합의서|\bnda\b|비밀유지|날인|법무|contract|agreement/giu, routingKeywords: ["계약", "법무", "약관"] },
  { id: "order", label: "발주·주문", weight: 1, pattern: /발주|주문|구매\s*요청|납품|입고|출고|재고|purchase\s*order/giu, routingKeywords: ["발주", "주문", "재고", "납품"] },
  { id: "complaint", label: "불만·교환", weight: 1, pattern: /불만|클레임|환불|교환|반품|하자|불량|고장|a\/s|complaint|refund/giu, routingKeywords: ["고객", "불만", "교환", "문의"] },
  { id: "schedule", label: "일정", weight: 0.75, pattern: /일정|미팅|회의(?!록)|방문|예약|약속|캘린더|meeting|schedule|appointment/giu, routingKeywords: ["일정", "회의", "미팅", "예약"] },
  { id: "inquiry", label: "문의", weight: 0.5, pattern: /문의|질문|궁금|inquiry|question/giu, routingKeywords: ["문의", "답장", "고객"] },
];

const genericMailWorkCategoryIds = new Set<ModyMailWorkCategoryId>(["other", "inquiry", "schedule"]);
const JEV_WORK_TYPE_MIN = 0.8;

function mailWorkCategoryFromRule(rule: MailWorkCategoryRule | undefined, source: "jev" | "rule"): ModyMailWorkCategory {
  if (!rule) return { id: "other", label: "일반", source, routingKeywords: [] };
  return { id: rule.id, label: rule.label, source, routingKeywords: [...rule.routingKeywords] };
}

/**
 * 메일이 어떤 업무인지(견적·정산·세금·계약·일정·채용…) 고른다 — 담당 AI 직원 제안에만 쓴다.
 * 제목·본문의 분명한 업무 낱말이 먼저이고, 낱말이 없거나 일반적(문의·일정)일 때만
 * Jev의 업무 종류 판단(확신 0.8 이상)을 쓴다. 아무것도 없으면 'other'(메인 비서가 맡음).
 */
export function classifyMailWorkCategory(
  mail: Pick<ModyIncomingMail, "subject" | "bodyPreview">,
  hint?: ModyMailDecisionHint,
): ModyMailWorkCategory {
  const text = `${mail.subject ?? ""} ${mail.bodyPreview ?? ""}`;
  let best: MailWorkCategoryRule | undefined;
  let bestScore = 0;
  for (const rule of mailWorkCategoryRules) {
    const score = (text.match(rule.pattern)?.length ?? 0) * rule.weight;
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  const ruleCategory = mailWorkCategoryFromRule(best, "rule");

  const jevType = hint && hint.model === "jev-1.13.0" &&
    typeof hint.workType === "string" && hint.workType !== "other" &&
    Number.isFinite(hint.workTypeConfidence) && Number(hint.workTypeConfidence) >= JEV_WORK_TYPE_MIN &&
    Number.isFinite(hint.workTypeProbability) && Number(hint.workTypeProbability) >= JEV_WORK_TYPE_MIN
    ? mailWorkCategoryRules.find((rule) => rule.id === hint.workType)
    : undefined;
  if (!jevType) return ruleCategory;
  if (jevType.id === ruleCategory.id || genericMailWorkCategoryIds.has(ruleCategory.id)) {
    return mailWorkCategoryFromRule(jevType, "jev");
  }
  return ruleCategory;
}

const businessSignalPattern =
  /문의|예약|상담|미팅|회의|견적|계약|일정|납품|정산|청구|발주|invoice|meeting|schedule|quote|purchase\s*order/i;

/** 질문·요청처럼 답장이 필요해 보이는 표현. */
const replyIntentPattern =
  /질문|문의|요청|부탁|회신|답변|답장|확인\s*(?:부탁|요청|해\s*주|해주)|가능할까요|가능하실까요|가능한지|주실\s*수|주시겠|주시면|알려\s*주|\?|？|could\s+you|can\s+you|would\s+you|please\s+(?:let|reply|confirm|send)/iu;

/** 보낸 분이 직접 회신이 필요 없다고 적은 표현. */
const hardNoReplyPattern =
  /(?:회신|답장|답변)\s*(?:은|는|이|을|를)?\s*(?:불필요|필요\s*(?:없|하지\s*않)|안\s*(?:주셔도|하셔도)|않으셔도|하지\s*않으셔도)|(?:회신|답장|답변)하지\s*않으셔도|no\s*(?:reply|response)\s*(?:is\s*)?(?:needed|required|necessary)|no\s*need\s*to\s*(?:reply|respond)/iu;

/** 공유·참고용 표현. 질문이 함께 있으면 답장 대상으로 본다. */
const softNoReplyPattern =
  /참고용|참고\s*(?:차|로|하시기|해\s*주)|공유\s*(?:드립니다|드려요|합니다|해\s*드립니다)|공유드립니다|\bfyi\b|for\s+your\s+information/iu;

/** 공유 메일이라도 답장을 기다리는 신호(질문·요청). */
const questionLikePattern =
  /\?|？|가능할까요|가능하실까요|주실\s*수|주시겠|부탁|요청|알려\s*주|문의|질문|회신\s*(?:부탁|요청|주시|바랍)|답변\s*(?:부탁|요청|주시|바랍)/iu;

/** 답장해도 받을 사람이 없는 자동 발신 주소. */
const automatedSenderPattern = /no-?reply|do-?not-?reply|mailer-daemon|postmaster|자동\s*발신/iu;

function decideMailReplyByKeywords(mail: ModyIncomingMail): MailKeywordReplyDecision {
  const text = `${mail.subject} ${mail.bodyPreview}`;
  if (hardNoReplyPattern.test(text)) {
    return { decision: "no_reply", strength: "hard", reason: "보낸 분이 회신이 필요 없다고 적었습니다." };
  }
  if (automatedSenderPattern.test(mail.from)) {
    return { decision: "no_reply", strength: "hard", reason: "자동 발신 주소라 답장을 받을 사람이 없습니다." };
  }
  if (softNoReplyPattern.test(text) && !questionLikePattern.test(text)) {
    return { decision: "no_reply", strength: "soft", reason: "공유·참고용 메일이고 질문이나 요청이 없습니다." };
  }
  if (replyIntentPattern.test(text)) {
    return { decision: "reply", strength: "soft", reason: "질문이나 요청이 담겨 있어 답장이 필요해 보입니다." };
  }
  return { decision: "unknown", strength: "none", reason: "답장 필요 여부 신호가 없습니다." };
}

function classifyMail(mail: ModyIncomingMail): MailBaselineDecision {
  const reply = decideMailReplyByKeywords(mail);
  return { ...classifyMailKind(mail, reply), reply };
}

function classifyMailKind(
  mail: ModyIncomingMail,
  reply: MailKeywordReplyDecision,
): { kind: ModyMailWorkflowClassification; reason: string } {
  const text = `${mail.from} ${mail.subject} ${mail.bodyPreview}`.toLocaleLowerCase("ko-KR");

  if (/비밀번호\s*(?:재설정|변경|초기화)|계정\s*(?:잠금|보안)|새(?:로운)?\s*로그인|의심스러운\s*(?:로그인|활동)|인증\s*(?:코드|번호)|password\s*reset|security\s*alert|new\s*sign[ -]?in|suspicious\s*(?:login|activity)|one[- ]time\s*(?:passcode|code)|otp/i.test(text)) {
    return { kind: "needs_review", reason: "계정 또는 인증 보안 알림이 감지되어 직접 확인이 필요합니다." };
  }

  // 광고 판정은 발신 주소를 빼고 제목·본문만 봅니다.
  // sales@ · marketing@ 처럼 정상 업무 담당자 주소가 광고로 오인돼
  // 견적/문의 메일이 조용히 버려지던 문제를 막습니다.
  const subjectAndBody = `${mail.subject} ${mail.bodyPreview}`.toLocaleLowerCase("ko-KR");
  const hasBusinessSignal = businessSignalPattern.test(text);

  // 업무 신호가 있으면 광고 단어가 섞여 있어도 버리지 않습니다(조용한 유실 방지).
  // 라틴 단어는 단어 경계를 요구해 wholesale·salesperson 같은 부분일치를 막습니다.
  if (
    !hasBusinessSignal &&
    /광고|프로모션|할인|쿠폰|뉴스레터|\bunsubscribe\b|\bsale\b|\bsales\b|\bmarketing\b|event\s*promotion/i.test(
      subjectAndBody,
    )
  ) {
    return { kind: "ignored_noise", reason: "광고, 프로모션, 뉴스레터 표현이 감지되었습니다." };
  }

  if (/스팸|피싱|urgent wire|crypto|lottery/i.test(text)) {
    return { kind: "ignored_noise", reason: "스팸이나 피싱으로 볼 수 있는 표현이 감지되었습니다." };
  }

  if (hasBusinessSignal) {
    return { kind: "business_mail", reason: "업무 요청 표현이 감지되었습니다." };
  }

  // 업무 단어가 없어도 질문·요청("~해 주실 수 있을까요?")은 답장이 필요한 메일이다.
  if (reply.decision === "reply") {
    return { kind: "business_mail", reason: "질문이나 요청이 담겨 있어 답장이 필요한 메일로 분류했습니다." };
  }

  return { kind: "needs_review", reason: "업무 여부가 애매해 사용자의 확인이 필요합니다." };
}

function looksLikeScheduleMail(mail: ModyIncomingMail): boolean {
  // "회의록"은 지난 회의 기록이지 새 일정이 아니다.
  return /일정|예약|상담|미팅|회의|방문|시간|날짜|캘린더|meeting|schedule|appointment/i.test(
    `${mail.subject} ${mail.bodyPreview}`.replace(/회의록/gu, " "),
  );
}

function createReadMailAction(mail: ModyIncomingMail, createdAt: ISODateTimeString): ToolActionRequest {
  return createToolActionRequest({
    id: `${mail.id}:read-mail`,
    toolName: "mody.mail.read",
    permissionLevel: "read",
    operationKind: "read_data",
    inputSummary: `${mail.from} / ${mail.subject}`,
    expectedImpact: "메일 원문과 메타데이터를 읽고 업무 여부를 확인합니다.",
    userVisibleDescription: "메일함의 새 메일을 읽습니다.",
    createdAt,
  });
}

function createAnalyzeMailAction(
  mail: ModyIncomingMail,
  classification: { kind: ModyMailWorkflowClassification; reason: string },
  createdAt: ISODateTimeString,
): ToolActionRequest {
  return createToolActionRequest({
    id: `${mail.id}:analyze-mail`,
    toolName: "mody.mail.analyze",
    permissionLevel: "analyze",
    operationKind: "analyze_data",
    inputSummary: `${classification.kind}: ${classification.reason}`,
    expectedImpact: "광고/스팸/업무 메일 여부와 필요한 후속 작업을 분류합니다.",
    userVisibleDescription: "메일을 광고, 스팸, 업무 요청으로 분류합니다.",
    createdAt,
  });
}

function createDraftReplyAction(
  mail: ModyIncomingMail,
  writingProfile: ModyUserWritingProfile,
  createdAt: ISODateTimeString,
): ToolActionRequest {
  return createToolActionRequest({
    id: `${mail.id}:draft-reply`,
    toolName: "mody.reply.draft",
    permissionLevel: "draft",
    operationKind: "draft_reply",
    inputSummary: `${writingProfile.formatLabel} / ${writingProfile.toneLabel} / ${mail.subject}`,
    expectedImpact: "외부로 발송되지 않는 답장 초안을 작성합니다.",
    userVisibleDescription: "사용자 말투와 지정 포맷에 맞춰 답장 초안을 작성합니다.",
    createdAt,
  });
}

function createDraftCalendarAction(
  mail: ModyIncomingMail,
  writingProfile: ModyUserWritingProfile,
  createdAt: ISODateTimeString,
): ToolActionRequest {
  return createToolActionRequest({
    id: `${mail.id}:draft-calendar`,
    toolName: "mody.calendar.draft",
    permissionLevel: "draft",
    operationKind: "draft_calendar_event",
    inputSummary: `${writingProfile.calendarPreference ?? "기본 캘린더 규칙"} / ${mail.subject}`,
    expectedImpact: "캘린더 등록 전 확인할 일정 후보를 만듭니다.",
    userVisibleDescription: "메일 내용에서 일정 후보를 만듭니다.",
    createdAt,
  });
}

function createSendEmailAction(mail: ModyIncomingMail, createdAt: ISODateTimeString): ToolActionRequest {
  return createToolActionRequest({
    id: `${mail.id}:send-email`,
    toolName: "mody.email.send",
    permissionLevel: "execute",
    operationKind: "send_email",
    inputSummary: `답장 발송 후보: ${mail.from} / ${mail.subject}`,
    expectedImpact: "외부 상대에게 답장 메일이 발송됩니다.",
    userVisibleDescription: "답장 메일 발송은 사용자 승인 후에만 실행합니다.",
    createdAt,
    externalMutation: true,
    requiresApproval: true,
  });
}

function createCalendarEventAction(mail: ModyIncomingMail, createdAt: ISODateTimeString): ToolActionRequest {
  return createToolActionRequest({
    id: `${mail.id}:create-calendar`,
    toolName: "mody.calendar.create",
    permissionLevel: "execute",
    operationKind: "create_calendar_event",
    inputSummary: `캘린더 등록 후보: ${mail.subject}`,
    expectedImpact: "사용자 캘린더에 일정이 생성됩니다.",
    userVisibleDescription: "캘린더 일정 등록은 사용자 승인 후에만 실행합니다.",
    createdAt,
    externalMutation: true,
    requiresApproval: true,
  });
}

function createApprovalStageAction(
  mail: ModyIncomingMail,
  targetAction: ToolActionRequest,
  createdAt: ISODateTimeString,
): ToolActionRequest {
  return createToolActionRequest({
    id: `${targetAction.id}:stage-approval`,
    toolName: "mody.approval.stage",
    permissionLevel: "stage",
    operationKind: "stage_approval",
    inputSummary: `${mail.subject}: ${targetAction.userVisibleDescription}`,
    expectedImpact: `${targetAction.toolName} 실행 요청을 승인함에 등록하고 외부 시스템은 변경하지 않습니다.`,
    userVisibleDescription: approvalStageDescriptionFor(targetAction),
    createdAt,
    sourceAdapterId: targetAction.toolName,
    approvalTargetActionId: targetAction.id,
    requiresApproval: false,
    externalMutation: false,
    riskLabel: "medium",
  });
}

function approvalStageDescriptionFor(action: ToolActionRequest): string {
  if (action.operationKind === "send_email") {
    return "답장 발송 승인 대기 카드를 만듭니다.";
  }

  if (action.operationKind === "create_calendar_event") {
    return "캘린더 등록 승인 대기 카드를 만듭니다.";
  }

  return "외부 실행 승인 대기 카드를 만듭니다.";
}

/**
 * 규칙 기반 답장 초안. 받는 분에게 그대로 나갈 수 있는 문장만 쓴다 —
 * 내부 분류 이름("정산/청구 업무" 같은 말)이나 형식/말투 라벨은 넣지 않는다.
 * 서명은 사용자가 정한 것만 붙이고, 없으면 비워 둔다.
 */
function createDraftReply(
  mail: ModyIncomingMail,
  writingProfile: ModyUserWritingProfile,
  needsSchedule: boolean,
  personalizedWorkTemplate: ModyMailPersonalizedWorkTemplate,
): string {
  const lines = [
    "안녕하세요.",
    "보내주신 메일 잘 받았습니다.",
    needsSchedule
      ? "말씀하신 일정은 확인해 보고, 가능한 시간을 정리해 다시 안내드리겠습니다."
      : draftFollowUpSentenceFor(personalizedWorkTemplate.detectedWorkType),
    "감사합니다.",
  ];

  const signature = cleanDraftSignature(writingProfile.signature);
  if (signature) {
    lines.push(signature);
  }

  return lines.join("\n");
}

function draftFollowUpSentenceFor(workType: string): string {
  if (workType === "정산/청구") return "보내주신 정산 내용은 금액과 발행 정보를 확인한 뒤 회신드리겠습니다.";
  if (workType === "견적/제안") return "요청하신 견적은 내용을 검토해 정리한 뒤 보내드리겠습니다.";
  if (workType === "계약/법무") return "보내주신 계약 관련 내용은 검토한 뒤 다시 연락드리겠습니다.";
  if (workType === "공공/세무") return "보내주신 내용은 필요한 사항을 확인한 뒤 회신드리겠습니다.";
  if (workType === "클레임/긴급") return "말씀하신 내용은 바로 확인해 보고 다시 연락드리겠습니다.";
  if (workType === "자료/보고서 제출") return "말씀하신 자료 건은 확인한 뒤 다시 연락드리겠습니다.";
  if (workType === "구매/발주/거래처") return "말씀하신 발주 건은 확인한 뒤 다시 연락드리겠습니다.";
  if (workType === "예약/주문") return "말씀하신 예약·주문 건은 확인한 뒤 다시 안내드리겠습니다.";
  if (workType === "고객/상담 문의") return "문의하신 내용은 확인한 뒤 답변드리겠습니다.";
  return "보내주신 내용은 확인한 뒤 다시 연락드리겠습니다.";
}

function cleanDraftSignature(value: string | undefined): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
}

function createCalendarDraft(mail: ModyIncomingMail, writingProfile: ModyUserWritingProfile): string {
  return [
    `일정 후보: ${mail.subject}`,
    `캘린더 규칙: ${writingProfile.calendarPreference ?? "업무 시간 우선, 충돌 확인 후 등록"}`,
    "등록 상태: 사용자 승인 전 대기",
  ].join("\n");
}

function createPersonalizedWorkTemplate(
  mail: ModyIncomingMail,
  writingProfile: ModyUserWritingProfile,
  classification: ModyMailWorkflowClassification,
  needsSchedule: boolean,
): ModyMailPersonalizedWorkTemplate {
  const workType = detectPersonalizedWorkType(mail, classification, needsSchedule);
  const id = `personal_mail_template_${safeTemplateId(workType)}`;
  const highRisk = isHighRiskWorkType(workType);
  const personalContext = {
    toneLabel: writingProfile.toneLabel,
    formatLabel: writingProfile.formatLabel,
    signaturePolicy: writingProfile.signature ? "기본 서명은 초안 끝에 붙이고 최종 발송 전 확인합니다." : "서명은 사용자가 승인 화면에서 확인합니다.",
    calendarPreference: writingProfile.calendarPreference ?? "일정은 가능한 시간 후보만 만들고 등록은 승인 후 진행합니다.",
  };

  const optimizedSteps = [
    classification === "ignored_noise"
      ? "광고/공지/잡음 후보는 업무 인박스에 바로 올리지 않고 일일 요약 후보로만 분리합니다."
      : classification === "needs_review"
        ? "업무 여부가 애매한 메일은 개인 규칙을 단정 적용하지 않고 확인 필요 카드로 올립니다."
        : `${workType}에 맞춰 핵심 요청, 부족 정보, 다음 행동을 먼저 분리합니다.`,
    `답장 초안은 '${writingProfile.formatLabel}' 형식과 '${writingProfile.toneLabel}' 톤으로 맞춥니다.`,
    needsSchedule
      ? `일정 후보는 '${personalContext.calendarPreference}' 기준으로 좁히고 등록은 승인함에 둡니다.`
      : "메일 발송, 파일 공유, 일정 등록 같은 외부 변경은 승인함 전까지 실행하지 않습니다.",
    "이번 처리 결과는 원문 주소나 비밀값 없이 업무 방식 요약으로만 다음 메일에 재사용합니다.",
  ];

  return {
    id,
    detectedWorkType: workType,
    templateLabel: `개인 맞춤 ${workType} 템플릿`,
    summary: `${workType} 메일을 ${writingProfile.formatLabel} / ${writingProfile.toneLabel} 기준으로 처리하도록 최적화했습니다.`,
    personalContext,
    optimizedSteps,
    draftGuidance: [
      `첫 문장은 ${workType}로 접수했다는 확인으로 시작합니다.`,
      "확정 약속, 금액, 책임 인정, 제출 완료 표현은 승인 전까지 단정하지 않습니다.",
      writingProfile.signature ? "서명은 포함하되 사용자가 승인 화면에서 수정할 수 있게 둡니다." : "서명이 없으면 빈 서명으로 두고 사용자가 필요할 때 추가합니다.",
    ],
    approvalChecklist: [
      "답장 대상과 참조/숨은참조가 맞는지 확인",
      needsSchedule ? "가능 시간, 참석자, 캘린더 충돌 여부 확인" : "",
      highRisk ? "금액, 계약, 세무, 공공기관, 보상/환불 표현을 별도 확인" : "",
      "외부 발송, 일정 등록, 파일 공유는 최종 승인 전 실행 금지",
    ].filter(Boolean),
    learningSignals: [
      `업무 유형: ${workType}`,
      `선호 답장 형식: ${writingProfile.formatLabel}`,
      `선호 답장 톤: ${writingProfile.toneLabel}`,
      needsSchedule ? `일정 기준: ${personalContext.calendarPreference}` : "",
      "수정/승인 결과를 다음 메일 기본 처리 기준으로 저장 후보화",
    ].filter(Boolean),
    reusableProfileFields: [
      "답장 톤",
      "답장 형식",
      "서명 사용 여부",
      needsSchedule ? "일정 선호 기준" : "",
      highRisk ? "고위험 확인 항목" : "일반 승인 항목",
    ].filter(Boolean),
    privacyBoundary:
      "개인 맞춤 템플릿은 업무 유형, 톤, 형식, 확인 규칙만 저장하며 원문 이메일 주소, 비밀번호, 인증코드, token, 민감 원문은 저장하지 않습니다.",
  };
}

function detectPersonalizedWorkType(
  mail: ModyIncomingMail,
  classification: ModyMailWorkflowClassification,
  needsSchedule: boolean,
): string {
  const text = `${mail.from} ${mail.subject} ${mail.bodyPreview}`.toLocaleLowerCase("ko-KR");
  if (classification === "ignored_noise") return "잡음 제외";
  if (/보안|로그인|비밀번호|2차\s*인증|인증코드|권한|token|otp|password|security/i.test(text)) return "보안/계정 알림";
  if (/공공기관|관공서|정부|국세청|홈택스|세무|신고|지원사업|보조금|hometax|tax/i.test(text)) return "공공/세무";
  if (/계약|계약서|약관|nda|비밀유지|서명|날인|법무|contract|legal/i.test(text)) return "계약/법무";
  if (/세금계산서|계산서|정산|입금|결제|청구|영수증|송금|환불|invoice|payment|billing/i.test(text)) return "정산/청구";
  if (/견적|견적서|단가|제안서|제안|납기|proposal|quote|estimate/i.test(text)) return "견적/제안";
  if (/클레임|불만|항의|장애|오류|긴급|환불|취소|complaint|urgent/i.test(text)) return "클레임/긴급";
  if (/대량|단체|전체\s*발송|공지\s*발송|뉴스레터|명단|bcc|숨은\s*참조|bulk|broadcast/i.test(text)) return "대량 메일";
  if (/수신자|받는\s*사람|참조|cc|bcc|reply-to/i.test(text)) return "수신자 판단";
  if (/자료|보고서|제출|증빙|첨부|공유|파일|서류|document|report|submit|attachment/i.test(text)) return "자료/보고서 제출";
  if (/구매|발주|납품|재고|거래처|공급|품목|수량|purchase|supplier|vendor/i.test(text)) return "구매/발주/거래처";
  if (needsSchedule) return "일정 조율";
  if (/예약|주문|배송|출고|픽업|booking|reservation|order|delivery/i.test(text)) return "예약/주문";
  if (/문의|상담|질문|고객|답변\s*요청|inquiry|question|support/i.test(text)) return "고객/상담 문의";
  if (classification === "needs_review") return "확인 필요";
  return "일반 답장";
}

function isHighRiskWorkType(workType: string): boolean {
  return /공공|세무|계약|법무|정산|청구|클레임|긴급|보안|계정/i.test(workType);
}

function safeTemplateId(value: string): string {
  return value
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]+/giu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "general";
}
