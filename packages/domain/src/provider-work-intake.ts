import {
  ModyMailWorkflowPlanner,
  type ModyIncomingMail,
  type ModyMailDecisionHint,
  type ModyMailReplyDecision,
  type ModyMailWorkCategory,
  type ModyMailWorkPriority,
  type ModyMailWorkflowClassification,
  type ModyMailWorkflowPlan,
  type ModyUserWritingProfile,
} from "./mail-workflow.js";
import {
  createMailSecureIntakeDecision,
  summarizeMailSecureIntake,
  type ModyMailSecureIntakeDecision,
  type ModyMailSecureIntakeSummary,
} from "./mail-secure-intake.js";
import type {
  ModyProviderCalendarEventPreview,
  ModyProviderCalendarReadOutput,
  ModyProviderId,
  ModyProviderMailMessagePreview,
  ModyProviderMailReadOutput,
  ModyProviderReadOutput,
} from "./provider-read-adapter.js";
import type {
  ISODateTimeString,
  ModyChannelId,
  ModyOutboundMessage,
  ToolActionRequest,
} from "./types.js";

export type ModyProviderWorkIntakeStatus =
  | "ready_for_review"
  | "quiet"
  | "needs_reconnect";

export type ModyProviderWorkIntakeSourceKind =
  | "mail"
  | "calendar_context";

export type ModyProviderWorkCandidate = {
  id: string;
  sourceKind: ModyProviderWorkIntakeSourceKind;
  sourceProviderId: ModyProviderId;
  /** 이 메일을 실제로 받은 연결(계정)의 connectorId — 답장은 이 연결에서 보내야 한다. */
  sourceConnectorId?: string;
  sourceId: string;
  title: string;
  classification: ModyMailWorkflowClassification | "calendar_context";
  classificationReason?: string;
  workKindLabels?: string[];
  priorityLabel?: string;
  /** 승인함 정렬용 우선순위(급함/보통/낮음)와 한 줄 이유. 발송·알림을 정하지 않는다. */
  priority?: ModyMailWorkPriority;
  /** 담당 AI 직원 제안용 업무 종류(견적·정산·일정…). */
  workCategory?: ModyMailWorkCategory;
  shouldCreateWorkItem: boolean;
  shouldNotifyUserImmediately: boolean;
  summary: string;
  draftReply?: string;
  /** 답장 초안 형식/말투 라벨(내부 표기, 초안 본문에는 들어가지 않는다). */
  draftFormatLabel?: string;
  draftToneLabel?: string;
  replyDecision?: ModyMailReplyDecision;
  calendarDraft?: string;
  approvalQueue: ToolActionRequest[];
  reportText: string;
  secureIntakeDecision?: ModyMailSecureIntakeDecision;
};

export type ModyProviderCalendarBusyWindow = {
  eventId: string;
  title: string;
  startsAt: ISODateTimeString;
  endsAt: ISODateTimeString;
  calendarId: string;
  providerId: ModyProviderId;
};

export type ModyProviderWorkTriageSummary = {
  contract: "mail_intake_triage_distribution_v1";
  totalMailMessages: number;
  businessMailCount: number;
  ignoredNoiseCount: number;
  needsReviewCount: number;
  calendarContextCount: number;
  replyDraftCandidateCount: number;
  calendarDraftCandidateCount: number;
  attachmentSignalCandidateCount: number;
  immediateNotificationCount: number;
  approvalCandidateCount: number;
  bodyPreviewAllowedCount: number;
  skippedBeforeBodyCount: number;
  metadataOnlyReviewCount: number;
  distributionLabel: string;
  importantWorkLabel: string;
  ignoredCandidateLabels: string[];
  reviewCandidateLabels: string[];
  importantCandidateLabels: string[];
  bodyPreviewPolicy: "metadata_first_noise_skipped_before_body_business_preview_only";
  safetyBoundary: string;
};

export type ModyProviderWorkIntakeReport = {
  id: string;
  status: ModyProviderWorkIntakeStatus;
  createdAt: ISODateTimeString;
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  connectorIds: string[];
  credentialReferenceIds: string[];
  sourceProviders: ModyProviderId[];
  totalReadItems: number;
  createdWorkItemsCount: number;
  ignoredItemsCount: number;
  reviewItemsCount: number;
  secureIntakeSummary: ModyMailSecureIntakeSummary;
  triageSummary?: ModyProviderWorkTriageSummary;
  approvalQueue: ToolActionRequest[];
  candidates: ModyProviderWorkCandidate[];
  calendarBusyWindows: ModyProviderCalendarBusyWindow[];
  outboundReports: ModyOutboundMessage[];
  providerAuditMessages: string[];
  auditMessages: string[];
  summary: string;
  safetyBoundary: string;
};

export type ModyProviderWorkIntakeInput = {
  reads: ModyProviderReadOutput[];
  writingProfile: ModyUserWritingProfile;
  reportChannelId: ModyChannelId;
  appDeepLinkBase?: string;
  mailDecisionHints?: Array<{
    connectorId: string;
    providerId: ModyProviderId;
    messageId: string;
    hint: ModyMailDecisionHint;
  }>;
};

type ModyProviderWorkIntakePlannerOptions = {
  now?: () => Date;
};

export class ModyProviderWorkIntakePlanner {
  private readonly now: () => Date;
  private readonly mailWorkflowPlanner: ModyMailWorkflowPlanner;

  constructor(options: ModyProviderWorkIntakePlannerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.mailWorkflowPlanner = new ModyMailWorkflowPlanner({ now: this.now });
  }

  createReport(input: ModyProviderWorkIntakeInput): ModyProviderWorkIntakeReport {
    const createdAt = this.now().toISOString();
    assertSafeReadOutputs(input.reads);

    const mailReads = input.reads.filter(isMailReadOutput);
    const calendarReads = input.reads.filter(isCalendarReadOutput);
    const mailPlans = mailReads.flatMap((read) =>
      read.messages.map((message) => {
        const secureIntakeDecision = createMailSecureIntakeDecision(message);
        return this.createMailPlan(read, message, input, createdAt, secureIntakeDecision);
      }),
    );
    const secureIntakeSummary = summarizeMailSecureIntake(
      mailPlans.map(({ secureIntakeDecision }) => secureIntakeDecision),
    );
    const calendarBusyWindows = calendarReads.flatMap((read) =>
      read.events.map((event) => createBusyWindow(read, event)),
    );
    const calendarCandidates = calendarReads.map((read) =>
      createCalendarContextCandidate(read),
    );
    const mailCandidates = mailPlans.map(({ read, message, plan, secureIntakeDecision }) =>
      createMailCandidate(read, message, plan, secureIntakeDecision),
    );
    const approvalQueue = mailPlans.flatMap(({ plan }) => plan.approvalQueue);
    const candidates = [...mailCandidates, ...calendarCandidates];
    const ignoredItemsCount = mailPlans.filter(({ plan }) => plan.classification === "ignored_noise").length;
    const reviewItemsCount = mailPlans.filter(({ plan }) => plan.classification === "needs_review").length;
    const createdWorkItemsCount = candidates.filter((candidate) => candidate.shouldCreateWorkItem).length;
    const outboundReports = mailPlans
      .filter(({ plan }) => plan.shouldNotifyUserImmediately || plan.classification === "needs_review")
      .map(({ plan }) => plan.channelReport);
    const totalReadItems =
      mailReads.reduce((sum, read) => sum + read.messages.length, 0) +
      calendarReads.reduce((sum, read) => sum + read.events.length, 0);
    const triageSummary = createTriageSummary({
      mailCandidates,
      calendarCandidates,
      secureIntakeSummary,
      approvalQueueLength: approvalQueue.length,
    });

    return {
      id: `provider_work_intake_${createdAt}`,
      status: statusFor(createdWorkItemsCount, approvalQueue.length, totalReadItems),
      createdAt,
      readOnly: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      connectorIds: unique(input.reads.map((read) => read.connectorId)),
      credentialReferenceIds: unique(input.reads.map((read) => read.credentialReferenceId)),
      sourceProviders: unique(input.reads.map((read) => read.providerId)),
      totalReadItems,
      createdWorkItemsCount,
      ignoredItemsCount,
      reviewItemsCount,
      secureIntakeSummary,
      triageSummary,
      approvalQueue,
      candidates,
      calendarBusyWindows,
      outboundReports,
      providerAuditMessages: input.reads.map((read) => read.auditMessage),
      auditMessages: auditMessagesFor({
        totalReadItems,
        createdWorkItemsCount,
        ignoredItemsCount,
        reviewItemsCount,
        approvalQueueLength: approvalQueue.length,
        calendarBusyWindowCount: calendarBusyWindows.length,
        secureIntakeSummary,
        triageSummary,
      }),
      summary: summaryFor({
        totalReadItems,
        createdWorkItemsCount,
        ignoredItemsCount,
        reviewItemsCount,
        approvalQueueLength: approvalQueue.length,
        calendarBusyWindowCount: calendarBusyWindows.length,
      }),
      safetyBoundary:
        "provider intake는 읽기 전용 snapshot을 메타데이터 우선 필터, 업무 후보, 승인 대기 카드로만 변환합니다. AI는 credentialReferenceId만 받고 비밀번호/token 원문을 읽지 못하며, 실제 메일 발송, 캘린더 등록, 파일 공유를 실행하지 않습니다.",
    };
  }

  private createMailPlan(
    read: ModyProviderMailReadOutput,
    message: ModyProviderMailMessagePreview,
    input: ModyProviderWorkIntakeInput,
    createdAt: ISODateTimeString,
    secureIntakeDecision: ModyMailSecureIntakeDecision,
  ): {
    read: ModyProviderMailReadOutput;
    message: ModyProviderMailMessagePreview;
    plan: ModyMailWorkflowPlan;
    secureIntakeDecision: ModyMailSecureIntakeDecision;
  } {
    const appDeepLink = input.appDeepLinkBase
      ? `${input.appDeepLinkBase.replace(/\/$/, "")}/mail/${encodeURIComponent(message.messageId)}`
      : undefined;

    return {
      read,
      message,
      secureIntakeDecision,
      plan: this.mailWorkflowPlanner.createPlan({
        mail: toIncomingMail(message, createdAt, secureIntakeDecision),
        writingProfile: input.writingProfile,
        reportChannelId: input.reportChannelId,
        ...(appDeepLink ? { appDeepLink } : {}),
        // Security notifications remain metadata-only and must not be reclassified.
        ...(secureIntakeDecision.matchedRules.includes("계정/인증 보안 알림") ? {} : {
          decisionHint: input.mailDecisionHints?.find((entry) =>
            entry.connectorId === read.connectorId && entry.providerId === read.providerId &&
            entry.messageId === message.messageId,
          )?.hint,
        }),
      }),
    };
  }
}

function assertSafeReadOutputs(reads: ModyProviderReadOutput[]): void {
  for (const read of reads) {
    if (read.externalMutation !== false) {
      throw new Error(`provider intake는 외부 변경성 read output을 받을 수 없습니다: ${read.providerId}`);
    }

    if (read.rawSecretMaterialStored !== false) {
      throw new Error(`provider intake는 token 원문이 포함된 read output을 받을 수 없습니다: ${read.providerId}`);
    }
  }
}

function isMailReadOutput(read: ModyProviderReadOutput): read is ModyProviderMailReadOutput {
  return read.action === "list_mail_messages";
}

function isCalendarReadOutput(read: ModyProviderReadOutput): read is ModyProviderCalendarReadOutput {
  return read.action === "list_calendar_events";
}

function toIncomingMail(
  message: ModyProviderMailMessagePreview,
  fallbackReceivedAt: ISODateTimeString,
  secureIntakeDecision: ModyMailSecureIntakeDecision,
): ModyIncomingMail {
  return {
    id: message.messageId,
    from: message.from,
    subject: message.subject,
    bodyPreview: secureIntakeDecision.bodyPreviewForAi,
    receivedAt: message.receivedAt || fallbackReceivedAt,
    mailboxId: message.mailboxId,
  };
}

function createMailCandidate(
  read: ModyProviderMailReadOutput,
  message: ModyProviderMailMessagePreview,
  plan: ModyMailWorkflowPlan,
  secureIntakeDecision: ModyMailSecureIntakeDecision,
): ModyProviderWorkCandidate {
  return {
    id: `provider_candidate_${message.messageId}`,
    sourceKind: "mail",
    sourceProviderId: read.providerId,
    sourceConnectorId: read.connectorId,
    sourceId: message.messageId,
    title: plan.workItemTitle ?? message.subject,
    classification: plan.classification,
    classificationReason: plan.classificationReason ?? plan.ignoredReason ?? plan.analysisSummary,
    workKindLabels: workKindLabelsFor(message, plan),
    priorityLabel: priorityLabelFor(plan),
    ...(plan.priority ? { priority: plan.priority } : {}),
    ...(plan.workCategory ? { workCategory: plan.workCategory } : {}),
    shouldCreateWorkItem: plan.shouldCreateWorkItem,
    shouldNotifyUserImmediately: plan.shouldNotifyUserImmediately,
    summary: plan.analysisSummary,
    ...(plan.draftReply ? { draftReply: plan.draftReply } : {}),
    ...(plan.draftReply && plan.formatLabel ? { draftFormatLabel: plan.formatLabel } : {}),
    ...(plan.draftReply && plan.toneLabel ? { draftToneLabel: plan.toneLabel } : {}),
    ...(plan.replyDecision ? { replyDecision: plan.replyDecision } : {}),
    ...(plan.calendarDraft ? { calendarDraft: plan.calendarDraft } : {}),
    approvalQueue: plan.approvalQueue,
    reportText: plan.channelReport.text,
    secureIntakeDecision,
  };
}

function createCalendarContextCandidate(
  read: ModyProviderCalendarReadOutput,
): ModyProviderWorkCandidate {
  return {
    id: `provider_calendar_context_${read.connectorId}`,
    sourceKind: "calendar_context",
    sourceProviderId: read.providerId,
    sourceId: read.connectorId,
    title: `${labelForProvider(read.providerId)} 일정 충돌 참고`,
    classification: "calendar_context",
    classificationReason: "캘린더 일정은 새 업무 후보가 아니라 일정 후보 충돌 확인 context입니다.",
    workKindLabels: ["캘린더 충돌 참고"],
    priorityLabel: "읽기 전용 참고",
    shouldCreateWorkItem: false,
    shouldNotifyUserImmediately: false,
    summary: `${read.events.length}개 일정을 읽기 전용으로 확인했습니다. 예약 후보를 만들 때 충돌 시간으로만 사용합니다.`,
    approvalQueue: [],
    reportText: "캘린더 원문은 읽기 전용 context이며 일정 생성은 승인 대기에서만 진행됩니다.",
  };
}

function createBusyWindow(
  read: ModyProviderCalendarReadOutput,
  event: ModyProviderCalendarEventPreview,
): ModyProviderCalendarBusyWindow {
  return {
    eventId: event.eventId,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    calendarId: event.calendarId,
    providerId: read.providerId,
  };
}

function createTriageSummary(input: {
  mailCandidates: ModyProviderWorkCandidate[];
  calendarCandidates: ModyProviderWorkCandidate[];
  secureIntakeSummary: ModyMailSecureIntakeSummary;
  approvalQueueLength: number;
}): ModyProviderWorkTriageSummary {
  const businessMailCandidates = input.mailCandidates.filter((candidate) => candidate.classification === "business_mail");
  const ignoredNoiseCandidates = input.mailCandidates.filter((candidate) => candidate.classification === "ignored_noise");
  const needsReviewCandidates = input.mailCandidates.filter((candidate) => candidate.classification === "needs_review");
  const replyDraftCandidateCount = businessMailCandidates.filter((candidate) => Boolean(candidate.draftReply)).length;
  const calendarDraftCandidateCount = businessMailCandidates.filter((candidate) => Boolean(candidate.calendarDraft)).length;
  const attachmentSignalCandidateCount = input.mailCandidates.filter((candidate) =>
    candidate.classification !== "ignored_noise" &&
    (candidate.workKindLabels ?? []).some((label) => /첨부|파일|문서|명단|스프레드시트/u.test(label)),
  ).length;
  const immediateNotificationCount = input.mailCandidates.filter((candidate) => candidate.shouldNotifyUserImmediately).length;

  return {
    contract: "mail_intake_triage_distribution_v1",
    totalMailMessages: input.mailCandidates.length,
    businessMailCount: businessMailCandidates.length,
    ignoredNoiseCount: ignoredNoiseCandidates.length,
    needsReviewCount: needsReviewCandidates.length,
    calendarContextCount: input.calendarCandidates.length,
    replyDraftCandidateCount,
    calendarDraftCandidateCount,
    attachmentSignalCandidateCount,
    immediateNotificationCount,
    approvalCandidateCount: input.approvalQueueLength,
    bodyPreviewAllowedCount: input.secureIntakeSummary.bodyPreviewAllowedCount,
    skippedBeforeBodyCount: input.secureIntakeSummary.skippedBeforeBodyCount,
    metadataOnlyReviewCount: input.secureIntakeSummary.reviewMetadataOnlyCount,
    distributionLabel: [
      `업무 ${businessMailCandidates.length}`,
      `확인 ${needsReviewCandidates.length}`,
      `제외 ${ignoredNoiseCandidates.length}`,
      `캘린더 참고 ${input.calendarCandidates.length}`,
    ].join(" · "),
    importantWorkLabel: [
      `답장 ${replyDraftCandidateCount}`,
      `일정 ${calendarDraftCandidateCount}`,
      `첨부 ${attachmentSignalCandidateCount}`,
      `승인 ${input.approvalQueueLength}`,
    ].join(" · "),
    ignoredCandidateLabels: ignoredNoiseCandidates.map((candidate) => triageCandidateLabel(candidate)).slice(0, 5),
    reviewCandidateLabels: needsReviewCandidates.map((candidate) => triageCandidateLabel(candidate)).slice(0, 5),
    importantCandidateLabels: businessMailCandidates.map((candidate) => triageCandidateLabel(candidate)).slice(0, 5),
    bodyPreviewPolicy: "metadata_first_noise_skipped_before_body_business_preview_only",
    safetyBoundary:
      "광고/뉴스레터/스팸성 메일은 본문 preview 전에 제외하고, 업무 후보만 제한 preview와 승인 대기 작업으로 넘깁니다.",
  };
}

function statusFor(
  createdWorkItemsCount: number,
  approvalQueueLength: number,
  totalReadItems: number,
): ModyProviderWorkIntakeStatus {
  if (totalReadItems === 0) return "quiet";
  if (createdWorkItemsCount > 0 || approvalQueueLength > 0) return "ready_for_review";
  return "quiet";
}

function summaryFor(input: {
  totalReadItems: number;
  createdWorkItemsCount: number;
  ignoredItemsCount: number;
  reviewItemsCount: number;
  approvalQueueLength: number;
  calendarBusyWindowCount: number;
}): string {
  return [
    `provider 읽기 결과 ${input.totalReadItems}건을 확인했습니다.`,
    `업무 후보 ${input.createdWorkItemsCount}건, 무시 ${input.ignoredItemsCount}건, 확인 필요 ${input.reviewItemsCount}건입니다.`,
    `승인 대기 실행 후보는 ${input.approvalQueueLength}건이고 캘린더 충돌 참고 시간은 ${input.calendarBusyWindowCount}건입니다.`,
  ].join(" ");
}

function auditMessagesFor(input: {
  totalReadItems: number;
  createdWorkItemsCount: number;
  ignoredItemsCount: number;
  reviewItemsCount: number;
  approvalQueueLength: number;
  calendarBusyWindowCount: number;
  secureIntakeSummary: ModyMailSecureIntakeSummary;
  triageSummary: ModyProviderWorkTriageSummary;
}): string[] {
  return [
    `provider read-only snapshot ${input.totalReadItems}건을 업무 intake로 변환했습니다.`,
    `메일 보안 선필터: 본문 preview 허용 ${input.secureIntakeSummary.bodyPreviewAllowedCount}건, 본문 없이 제외 ${input.secureIntakeSummary.skippedBeforeBodyCount}건, 확인 필요 메타데이터 ${input.secureIntakeSummary.reviewMetadataOnlyCount}건입니다.`,
    `메일 분류 요약: ${input.triageSummary.distributionLabel} / ${input.triageSummary.importantWorkLabel}.`,
    "AI는 비밀번호/token 원문을 받지 않고 credentialReferenceId만 받습니다.",
    `업무 후보 ${input.createdWorkItemsCount}건, 확인 필요 ${input.reviewItemsCount}건, 광고/스팸 무시 ${input.ignoredItemsCount}건으로 분류했습니다.`,
    `외부 실행 후보 ${input.approvalQueueLength}건은 approvalQueue에만 올렸습니다.`,
    `캘린더 ${input.calendarBusyWindowCount}건은 예약 가능 시간 계산용 context로만 사용했습니다.`,
  ];
}

function labelForProvider(providerId: ModyProviderId): string {
  if (providerId === "gmail") return "Gmail";
  if (providerId === "outlook") return "Outlook Mail";
  if (providerId === "imap_smtp") return "IMAP/SMTP";
  if (providerId === "google_calendar") return "Google Calendar";
  return "Outlook Calendar";
}

function workKindLabelsFor(
  message: ModyProviderMailMessagePreview,
  plan: ModyMailWorkflowPlan,
): string[] {
  const text = [message.subject, message.snippet, ...(message.labels ?? []), plan.analysisSummary].join(" ");
  return unique([
    plan.draftReply ? "답장 초안" : "",
    plan.calendarDraft ? "일정 후보" : "",
    message.hasAttachments || /첨부|파일|자료|문서|계약서|견적서|제안서|세금계산서|invoice|receipt|xlsx|pdf|csv/iu.test(text)
      ? "첨부/파일 후보"
      : "",
    /대량|단체|명단|bulk|recipient|spreadsheet|csv|xlsx/iu.test(text) ? "대량/명단 검토" : "",
    plan.classification === "ignored_noise" ? "광고/스팸 제외" : "",
    plan.classification === "needs_review" ? "확인 필요" : "",
  ].filter(Boolean)).slice(0, 6);
}

function priorityLabelFor(plan: ModyMailWorkflowPlan): string {
  if (plan.classification === "ignored_noise") return "제외";
  if (plan.classification === "needs_review") return "확인 필요";
  if (plan.approvalQueue.some((request) => request.operationKind === "create_calendar_event")) return "중요 일정";
  if (plan.approvalQueue.some((request) => request.operationKind === "send_email")) return "중요 답장";
  return "업무 후보";
}

function triageCandidateLabel(candidate: ModyProviderWorkCandidate): string {
  const title = candidate.title.replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email]");
  const priority = candidate.priorityLabel ? `${candidate.priorityLabel}: ` : "";
  const reason = candidate.classificationReason ? ` · ${candidate.classificationReason}` : "";
  return `${priority}${title}${reason}`.slice(0, 180);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
