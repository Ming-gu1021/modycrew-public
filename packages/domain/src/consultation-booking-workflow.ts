import { createToolActionRequest } from "./policy.js";
import type {
  ISODateTimeString,
  ModyChannelId,
  ModyOutboundMessage,
  ToolActionRequest,
  ToolOperationKind,
} from "./types.js";

export type ModyConsultationBusinessType =
  | "academy"
  | "clinic"
  | "service"
  | "custom";

export type ModyConsultationBusinessProfile = {
  businessName: string;
  businessType: ModyConsultationBusinessType;
  timezone: string;
  timezoneOffsetMinutes?: number;
  closedWeekdays: number[];
  consultationWindows: ModyConsultationWindow[];
  slotMinutes: number;
  bufferMinutes?: number;
  maxProposalCount: number;
  replyToneLabel: string;
  replyFormatLabel: string;
  replySignature?: string;
};

export type ModyConsultationWindow = {
  weekday: number;
  startTime: string;
  endTime: string;
};

export type ModyConsultationInquiry = {
  id: string;
  sourceKind: "email" | "site_inquiry" | "naver_inquiry" | "kakao_inquiry";
  from: string;
  subject: string;
  body: string;
  receivedAt: ISODateTimeString;
};

export type ModyConsultationBusyWindow = {
  startsAt: ISODateTimeString;
  endsAt: ISODateTimeString;
  title?: string;
};

export type ModyConsultationSearchRange = {
  startsAt: ISODateTimeString;
  endsAt: ISODateTimeString;
};

export type ModyConsultationSlot = {
  id: string;
  startsAt: ISODateTimeString;
  endsAt: ISODateTimeString;
  label: string;
  reason: string;
};

export type ModyConsultationProposalStatus =
  | "proposal_ready"
  | "needs_manual_review";

export type ModyConsultationProposalInput = {
  profile: ModyConsultationBusinessProfile;
  inquiry: ModyConsultationInquiry;
  busyWindows: ModyConsultationBusyWindow[];
  searchRange: ModyConsultationSearchRange;
  reportChannelId: ModyChannelId;
  appDeepLink?: string;
};

export type ModyConsultationProposalReport = {
  id: string;
  status: ModyConsultationProposalStatus;
  createdAt: ISODateTimeString;
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  appFinalConfirmationRequired: true;
  profile: ModyConsultationBusinessProfile;
  inquiry: ModyConsultationInquiry;
  busyWindows: ModyConsultationBusyWindow[];
  searchRange: ModyConsultationSearchRange;
  reportChannelId: ModyChannelId;
  proposedSlots: ModyConsultationSlot[];
  selectedSlot: ModyConsultationSlot | null;
  replyDraft: string;
  actionRequests: ToolActionRequest[];
  approvalQueue: ToolActionRequest[];
  messengerReport: ModyOutboundMessage;
  auditMessages: string[];
  summary: string;
  safetyBoundary: string;
};

export type ModyConsultationDecisionInput = {
  proposal: ModyConsultationProposalReport;
  decision: "approve" | "request_change" | "hold";
  decidedByChannelId: ModyChannelId;
  decidedByUserId: string;
  requestedSlotStartsAt?: ISODateTimeString;
};

export type ModyConsultationExternalActionCandidate = {
  id: string;
  operationKind: Extract<ToolOperationKind, "send_email" | "create_calendar_event">;
  requestId: string;
  status: "awaiting_app_final_confirmation";
  payloadSummary: string;
};

export type ModyConsultationDecisionStatus =
  | "ready_for_app_final_confirmation"
  | "change_proposal_ready"
  | "held"
  | "needs_manual_review";

export type ModyConsultationDecisionResult = {
  id: string;
  status: ModyConsultationDecisionStatus;
  createdAt: ISODateTimeString;
  externalMutation: false;
  appFinalConfirmationRequired: true;
  selectedSlot: ModyConsultationSlot | null;
  finalActions: ModyConsultationExternalActionCandidate[];
  messengerReport: ModyOutboundMessage;
  auditMessages: string[];
  updatedProposal?: ModyConsultationProposalReport;
};

type ConsultationBookingWorkflowOptions = {
  now?: () => Date;
};

type SlotValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export class ModyConsultationBookingWorkflow {
  private readonly now: () => Date;

  constructor(options: ConsultationBookingWorkflowOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createProposal(input: ModyConsultationProposalInput): ModyConsultationProposalReport {
    const createdAt = this.now().toISOString();
    const proposedSlots = generateAvailableSlots(input);
    const selectedSlot = proposedSlots[0] ?? null;
    return createProposalReport({
      input,
      createdAt,
      proposedSlots,
      selectedSlot,
      reason: selectedSlot
        ? "사용자 업무 규칙과 캘린더 충돌을 제외한 첫 번째 후보입니다."
        : "사용자 업무 규칙 안에서 자동 제안 가능한 빈 시간이 없습니다.",
    });
  }

  applyDecision(input: ModyConsultationDecisionInput): ModyConsultationDecisionResult {
    const createdAt = this.now().toISOString();

    if (input.decision === "hold") {
      return {
        id: `consultation_decision_${input.proposal.inquiry.id}_${createdAt}`,
        status: "held",
        createdAt,
        externalMutation: false,
        appFinalConfirmationRequired: true,
        selectedSlot: input.proposal.selectedSlot,
        finalActions: [],
        messengerReport: createDecisionOutboundMessage({
          proposal: input.proposal,
          createdAt,
          text: "상담 일정 제안을 보류했습니다. 외부 답장 발송과 캘린더 등록은 진행하지 않습니다.",
          actionLabels: ["다시 제안", "앱에서 확인"],
          channelId: input.decidedByChannelId,
        }),
        auditMessages: [
          `${input.decidedByUserId} 사용자가 ${input.decidedByChannelId}에서 보류를 기록했습니다.`,
          "외부 메일 발송과 캘린더 등록은 실행하지 않았습니다.",
        ],
      };
    }

    if (input.decision === "approve") {
      if (!input.proposal.selectedSlot) {
        return createManualReviewDecision(input, createdAt, "승인할 상담 시간 후보가 없습니다.");
      }

      const finalActions = createExternalActionCandidates(input.proposal);
      return {
        id: `consultation_decision_${input.proposal.inquiry.id}_${createdAt}`,
        status: "ready_for_app_final_confirmation",
        createdAt,
        externalMutation: false,
        appFinalConfirmationRequired: true,
        selectedSlot: input.proposal.selectedSlot,
        finalActions,
        messengerReport: createDecisionOutboundMessage({
          proposal: input.proposal,
          createdAt,
          text: `승인 의사를 기록했습니다. ${input.proposal.selectedSlot.label} 상담 답장과 캘린더 등록은 앱에서 마지막으로 확인하면 실행 후보로 넘어갑니다.`,
          actionLabels: ["앱에서 최종 실행", "다시 수정", "보류"],
          channelId: input.decidedByChannelId,
        }),
        auditMessages: [
          `${input.decidedByUserId} 사용자가 ${input.decidedByChannelId}에서 승인 의사를 기록했습니다.`,
          `최종 실행 후보 ${finalActions.length}건을 만들었습니다.`,
          "메신저 승인만으로 외부 답장 발송이나 캘린더 등록을 실행하지 않았습니다.",
        ],
      };
    }

    if (!input.requestedSlotStartsAt) {
      return createManualReviewDecision(input, createdAt, "수정 요청에 새 시간이 포함되지 않았습니다.");
    }

    const requestedSlot = createSlotFromRequestedStart(input.proposal, input.requestedSlotStartsAt);
    const validation = validateSlot(input.proposal, requestedSlot);
    if (!validation.valid) {
      return createManualReviewDecision(input, createdAt, validation.reason);
    }

    const updatedProposal = createProposalReport({
      input: proposalToInput(input.proposal),
      createdAt,
      proposedSlots: [
        requestedSlot,
        ...input.proposal.proposedSlots.filter((slot) => slot.startsAt !== requestedSlot.startsAt),
      ].slice(0, input.proposal.profile.maxProposalCount),
      selectedSlot: requestedSlot,
      reason: "메신저 수정 요청을 반영한 새 상담 후보입니다.",
    });

    return {
      id: `consultation_decision_${input.proposal.inquiry.id}_${createdAt}`,
      status: "change_proposal_ready",
      createdAt,
      externalMutation: false,
      appFinalConfirmationRequired: true,
      selectedSlot: requestedSlot,
      finalActions: [],
      messengerReport: createDecisionOutboundMessage({
        proposal: updatedProposal,
        createdAt,
        text: `변경 후보를 다시 만들었습니다. ${requestedSlot.label}로 답장 초안과 캘린더 등록 후보를 갱신했습니다. 진행하려면 한 번 더 승인해 주세요.`,
        actionLabels: ["진행", "다시 변경", "보류"],
        channelId: input.decidedByChannelId,
      }),
      auditMessages: [
        `${input.decidedByUserId} 사용자가 ${input.decidedByChannelId}에서 시간 변경을 요청했습니다.`,
        "새 후보를 만들었지만 외부 답장 발송과 캘린더 등록은 실행하지 않았습니다.",
        "변경된 내용은 최종 승인 후 앱에서 다시 확인해야 합니다.",
      ],
      updatedProposal,
    };
  }
}

function createProposalReport(input: {
  input: ModyConsultationProposalInput;
  createdAt: ISODateTimeString;
  proposedSlots: ModyConsultationSlot[];
  selectedSlot: ModyConsultationSlot | null;
  reason: string;
}): ModyConsultationProposalReport {
  const status: ModyConsultationProposalStatus = input.selectedSlot ? "proposal_ready" : "needs_manual_review";
  const actionRequests = createActionRequests(input.input, input.selectedSlot, input.createdAt);
  const approvalQueue = actionRequests.filter((request) =>
    request.operationKind === "send_email" || request.operationKind === "create_calendar_event",
  );
  const replyDraft = createReplyDraft(input.input, input.selectedSlot);
  const messengerReport = createProposalOutboundMessage({
    input: input.input,
    createdAt: input.createdAt,
    proposedSlots: input.proposedSlots,
    selectedSlot: input.selectedSlot,
    status,
  });

  return {
    id: `consultation_booking_${input.input.inquiry.id}_${input.createdAt}`,
    status,
    createdAt: input.createdAt,
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    appFinalConfirmationRequired: true,
    profile: input.input.profile,
    inquiry: input.input.inquiry,
    busyWindows: input.input.busyWindows,
    searchRange: input.input.searchRange,
    reportChannelId: input.input.reportChannelId,
    proposedSlots: input.proposedSlots,
    selectedSlot: input.selectedSlot,
    replyDraft,
    actionRequests,
    approvalQueue,
    messengerReport,
    auditMessages: [
      `${input.input.inquiry.sourceKind} 문의글을 읽고 상담 예약 요청으로 분류했습니다.`,
      `${input.input.profile.businessName} 규칙: 주말/휴무 제외, 상담 시간 ${windowSummary(input.input.profile)} 기준으로 후보를 계산했습니다.`,
      `캘린더 바쁨 ${input.input.busyWindows.length}건과 buffer ${input.input.profile.bufferMinutes ?? 0}분을 제외했습니다.`,
      input.selectedSlot
        ? `추천 후보: ${input.selectedSlot.label}. ${input.reason}`
        : "자동 제안 가능한 시간이 없어 수동 확인으로 보냈습니다.",
      "외부 답장 발송과 캘린더 등록은 승인 전 실행하지 않았습니다.",
    ],
    summary: status === "proposal_ready"
      ? `상담 문의 1건에서 가능 시간 ${input.proposedSlots.length}개를 찾고, ${input.selectedSlot?.label ?? "후보 없음"}을 기본 제안으로 선택했습니다.`
      : "상담 문의 1건은 감지했지만 사용자의 상담 규칙 안에서 자동 후보를 찾지 못했습니다.",
    safetyBoundary:
      "이 workflow는 메일/문의글과 캘린더 snapshot을 읽고 메신저 보고, 답장 초안, 캘린더 등록 후보만 만듭니다. 실제 문의자 답장 발송과 캘린더 등록은 사용자 승인 및 앱 최종 확인 후 별도 실행해야 합니다.",
  };
}

function createActionRequests(
  input: ModyConsultationProposalInput,
  selectedSlot: ModyConsultationSlot | null,
  createdAt: ISODateTimeString,
): ToolActionRequest[] {
  const readInquiry = createToolActionRequest({
    id: `${input.inquiry.id}:read-inquiry`,
    toolName: "mody.inquiry.read",
    permissionLevel: "read",
    operationKind: "read_data",
    inputSummary: `${input.inquiry.sourceKind} / ${input.inquiry.subject}`,
    expectedImpact: "문의글 원문과 메타데이터를 읽고 상담 요청 여부를 확인합니다.",
    userVisibleDescription: "메일/문의글을 읽습니다.",
    createdAt,
  });
  const readCalendar = createToolActionRequest({
    id: `${input.inquiry.id}:calendar-freebusy`,
    toolName: "mody.calendar.freebusy",
    permissionLevel: "read",
    operationKind: "read_data",
    inputSummary: `${input.searchRange.startsAt} - ${input.searchRange.endsAt}`,
    expectedImpact: "캘린더의 바쁜 시간만 읽어 상담 가능 시간을 계산합니다.",
    userVisibleDescription: "캘린더 빈 시간 확인을 위해 바쁨 정보를 읽습니다.",
    createdAt,
    metadata: {
      officialApiShape: "Google Calendar Freebusy: query",
      externalMutation: false,
    },
  });
  const draftReply = createToolActionRequest({
    id: `${input.inquiry.id}:draft-consultation-reply`,
    toolName: "mody.reply.draft",
    permissionLevel: "draft",
    operationKind: "draft_reply",
    inputSummary: `${input.profile.replyFormatLabel} / ${input.profile.replyToneLabel}`,
    expectedImpact: "외부로 발송되지 않는 상담 안내 답장 초안을 작성합니다.",
    userVisibleDescription: "상담 일정 안내 답장 초안을 작성합니다.",
    createdAt,
  });

  if (!selectedSlot) {
    return [readInquiry, readCalendar, draftReply];
  }

  const stageSend = createToolActionRequest({
    id: `${input.inquiry.id}:stage-send-email`,
    toolName: "mody.approval.stage",
    permissionLevel: "stage",
    operationKind: "stage_approval",
    inputSummary: `답장 발송 승인 대기: ${selectedSlot.label}`,
    expectedImpact: "답장 발송 요청을 승인함에 올리고 외부 시스템은 변경하지 않습니다.",
    userVisibleDescription: "문의자 답장 발송 승인 대기 카드를 만듭니다.",
    createdAt,
    approvalTargetActionId: `${input.inquiry.id}:send-email`,
    externalMutation: false,
    requiresApproval: false,
  });
  const sendEmail = createToolActionRequest({
    id: `${input.inquiry.id}:send-email`,
    toolName: "mody.email.send",
    permissionLevel: "execute",
    operationKind: "send_email",
    inputSummary: `문의자 ${input.inquiry.from}에게 ${selectedSlot.label} 상담 안내 발송`,
    expectedImpact: "외부 문의자에게 답장 메일 또는 문의 답변이 전송됩니다.",
    userVisibleDescription: "문의자에게 상담 가능 시간 답장을 발송합니다.",
    createdAt,
    externalMutation: true,
    requiresApproval: true,
    metadata: {
      to: input.inquiry.from,
      selectedSlotStartsAt: selectedSlot.startsAt,
      selectedSlotEndsAt: selectedSlot.endsAt,
    },
  });
  const stageCalendar = createToolActionRequest({
    id: `${input.inquiry.id}:stage-calendar-event`,
    toolName: "mody.approval.stage",
    permissionLevel: "stage",
    operationKind: "stage_approval",
    inputSummary: `캘린더 등록 승인 대기: ${selectedSlot.label}`,
    expectedImpact: "캘린더 등록 요청을 승인함에 올리고 외부 시스템은 변경하지 않습니다.",
    userVisibleDescription: "상담 일정 등록 승인 대기 카드를 만듭니다.",
    createdAt,
    approvalTargetActionId: `${input.inquiry.id}:create-calendar`,
    externalMutation: false,
    requiresApproval: false,
  });
  const createCalendar = createToolActionRequest({
    id: `${input.inquiry.id}:create-calendar`,
    toolName: "mody.calendar.create",
    permissionLevel: "execute",
    operationKind: "create_calendar_event",
    inputSummary: `${input.profile.businessName} 상담 일정 등록: ${selectedSlot.label}`,
    expectedImpact: "사용자 캘린더에 상담 일정이 생성됩니다.",
    userVisibleDescription: "캘린더에 상담 일정을 등록합니다.",
    createdAt,
    externalMutation: true,
    requiresApproval: true,
    metadata: {
      startsAt: selectedSlot.startsAt,
      endsAt: selectedSlot.endsAt,
      title: `${input.profile.businessName} 상담 - ${input.inquiry.from}`,
    },
  });

  return [readInquiry, readCalendar, draftReply, stageSend, sendEmail, stageCalendar, createCalendar];
}

function generateAvailableSlots(input: ModyConsultationProposalInput): ModyConsultationSlot[] {
  const offsetMinutes = timezoneOffsetMinutesFor(input.profile);
  const startKey = localDateKey(input.searchRange.startsAt, offsetMinutes);
  const endKey = localDateKey(input.searchRange.endsAt, offsetMinutes);
  const slots: ModyConsultationSlot[] = [];

  for (let currentKey = startKey; currentKey <= endKey; currentKey = nextLocalDateKey(currentKey)) {
    const weekday = weekdayForLocalDateKey(currentKey);
    if (input.profile.closedWeekdays.includes(weekday)) continue;

    const windows = input.profile.consultationWindows.filter((window) => window.weekday === weekday);
    for (const window of windows) {
      const startMinute = timeToMinutes(window.startTime);
      const endMinute = timeToMinutes(window.endTime);
      for (
        let minute = startMinute;
        minute + input.profile.slotMinutes <= endMinute;
        minute += input.profile.slotMinutes
      ) {
        const candidate = createSlotFromLocalMinute({
          dateKey: currentKey,
          startMinute: minute,
          slotMinutes: input.profile.slotMinutes,
          offsetMinutes,
          reason: "휴무일, 상담 시간, 기존 캘린더 충돌을 제외했습니다.",
        });
        if (validateSlotRange(input.searchRange, candidate) && validateSlot(input, candidate).valid) {
          slots.push(candidate);
          if (slots.length >= input.profile.maxProposalCount) return slots;
        }
      }
    }
  }

  return slots;
}

function createSlotFromRequestedStart(
  proposal: ModyConsultationProposalReport,
  requestedSlotStartsAt: ISODateTimeString,
): ModyConsultationSlot {
  const offsetMinutes = timezoneOffsetMinutesFor(proposal.profile);
  const startMs = new Date(requestedSlotStartsAt).getTime();
  const endsAt = new Date(startMs + proposal.profile.slotMinutes * 60_000).toISOString();
  return {
    id: `requested_${requestedSlotStartsAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
    startsAt: requestedSlotStartsAt,
    endsAt,
    label: formatSlotLabel(requestedSlotStartsAt, endsAt, offsetMinutes),
    reason: "사용자가 메신저에서 직접 지정한 변경 후보입니다.",
  };
}

function createSlotFromLocalMinute(input: {
  dateKey: string;
  startMinute: number;
  slotMinutes: number;
  offsetMinutes: number;
  reason: string;
}): ModyConsultationSlot {
  const startTime = minutesToTime(input.startMinute);
  const endTime = minutesToTime(input.startMinute + input.slotMinutes);
  const startsAt = localDateTimeToUtcIso(input.dateKey, startTime, input.offsetMinutes);
  const endsAt = localDateTimeToUtcIso(input.dateKey, endTime, input.offsetMinutes);
  return {
    id: `slot_${input.dateKey.replaceAll("-", "")}_${startTime.replace(":", "")}`,
    startsAt,
    endsAt,
    label: formatSlotLabel(startsAt, endsAt, input.offsetMinutes),
    reason: input.reason,
  };
}

function validateSlot(
  input: ModyConsultationProposalInput | ModyConsultationProposalReport,
  slot: ModyConsultationSlot,
): SlotValidationResult {
  const profile = input.profile;
  const offsetMinutes = timezoneOffsetMinutesFor(profile);
  const startLocalKey = localDateKey(slot.startsAt, offsetMinutes);
  const weekday = weekdayForLocalDateKey(startLocalKey);

  if (!validateSlotRange(input.searchRange, slot)) {
    return { valid: false, reason: "요청한 시간이 검색 범위 밖입니다." };
  }

  if (profile.closedWeekdays.includes(weekday)) {
    return { valid: false, reason: "요청한 시간이 휴무일입니다." };
  }

  const startMinute = localMinutes(slot.startsAt, offsetMinutes);
  const endMinute = localMinutes(slot.endsAt, offsetMinutes);
  const isInsideWindow = profile.consultationWindows
    .filter((window) => window.weekday === weekday)
    .some((window) => startMinute >= timeToMinutes(window.startTime) && endMinute <= timeToMinutes(window.endTime));
  if (!isInsideWindow) {
    return { valid: false, reason: "요청한 시간이 상담 가능 시간 밖입니다." };
  }

  const bufferMinutes = profile.bufferMinutes ?? 0;
  const overlapsBusy = input.busyWindows.some((busy) =>
    overlapsWithBuffer(slot.startsAt, slot.endsAt, busy.startsAt, busy.endsAt, bufferMinutes),
  );
  if (overlapsBusy) {
    return { valid: false, reason: "요청한 시간이 기존 캘린더 일정과 충돌합니다." };
  }

  return { valid: true };
}

function validateSlotRange(range: ModyConsultationSearchRange, slot: ModyConsultationSlot): boolean {
  return new Date(range.startsAt).getTime() <= new Date(slot.startsAt).getTime() &&
    new Date(slot.endsAt).getTime() <= new Date(range.endsAt).getTime();
}

function overlapsWithBuffer(
  leftStart: ISODateTimeString,
  leftEnd: ISODateTimeString,
  rightStart: ISODateTimeString,
  rightEnd: ISODateTimeString,
  bufferMinutes: number,
): boolean {
  const bufferMs = bufferMinutes * 60_000;
  return new Date(leftStart).getTime() < new Date(rightEnd).getTime() + bufferMs &&
    new Date(rightStart).getTime() - bufferMs < new Date(leftEnd).getTime();
}

function createProposalOutboundMessage(input: {
  input: ModyConsultationProposalInput;
  createdAt: ISODateTimeString;
  proposedSlots: ModyConsultationSlot[];
  selectedSlot: ModyConsultationSlot | null;
  status: ModyConsultationProposalStatus;
}): ModyOutboundMessage {
  const slotLines = input.proposedSlots
    .map((slot, index) => `${index + 1}) ${slot.label}`)
    .join("\n");
  const text = input.status === "proposal_ready"
    ? [
        `상담 문의 1건 확인했습니다. ${input.input.profile.businessName} 규칙 기준으로 주말/휴무 제외, 상담 가능 시간 ${windowSummary(input.input.profile)}, 기존 일정 충돌 제외 후 후보를 찾았습니다.`,
        slotLines,
        `추천: ${input.selectedSlot?.label ?? "후보 없음"}`,
        "진행하려면 '진행', 바꾸려면 '5월 18일 16시로 변경'처럼 답해 주세요. 실제 발송과 캘린더 등록은 앱에서 최종 확인 후 진행됩니다.",
      ].join("\n")
    : "상담 문의는 확인했지만 규칙 안에서 자동 제안 가능한 시간이 없습니다. 앱에서 수동 확인이 필요합니다.";

  return {
    id: `consultation_report_${input.input.inquiry.id}`,
    channelId: input.input.reportChannelId,
    text,
    actionLabels: input.status === "proposal_ready"
      ? ["진행", "시간 변경", "보류", "앱에서 보기"]
      : ["앱에서 수동 확인", "보류"],
    createdAt: input.createdAt,
    ...(input.input.appDeepLink ? { appDeepLink: input.input.appDeepLink } : {}),
  };
}

function createDecisionOutboundMessage(input: {
  proposal: ModyConsultationProposalReport;
  createdAt: ISODateTimeString;
  text: string;
  actionLabels: string[];
  channelId: ModyChannelId;
}): ModyOutboundMessage {
  return {
    id: `consultation_decision_report_${input.proposal.inquiry.id}`,
    channelId: input.channelId,
    text: input.text,
    actionLabels: input.actionLabels,
    createdAt: input.createdAt,
    ...(input.proposal.messengerReport.appDeepLink
      ? { appDeepLink: input.proposal.messengerReport.appDeepLink }
      : {}),
  };
}

function createReplyDraft(
  input: ModyConsultationProposalInput,
  selectedSlot: ModyConsultationSlot | null,
): string {
  const lines = [
    `[${input.profile.replyFormatLabel} · ${input.profile.replyToneLabel}]`,
    "안녕하세요.",
    selectedSlot
      ? `문의 주신 상담은 ${selectedSlot.label}에 진행 가능할 것 같습니다. 해당 시간으로 괜찮으시면 회신 부탁드립니다.`
      : "문의 주신 상담 가능 시간을 확인 중입니다. 가능한 시간을 정리해 다시 안내드리겠습니다.",
    "감사합니다.",
  ];
  if (input.profile.replySignature) {
    lines.push(input.profile.replySignature);
  }
  return lines.join("\n");
}

function createExternalActionCandidates(
  proposal: ModyConsultationProposalReport,
): ModyConsultationExternalActionCandidate[] {
  if (!proposal.selectedSlot) return [];
  return proposal.approvalQueue.map((request) => {
    const operationKind = request.operationKind as Extract<ToolOperationKind, "send_email" | "create_calendar_event">;
    return {
      id: `final_${request.id}`,
      operationKind,
      requestId: request.id,
      status: "awaiting_app_final_confirmation",
      payloadSummary: operationKind === "send_email"
        ? `문의자 ${proposal.inquiry.from}에게 ${proposal.selectedSlot?.label ?? "후보"} 상담 안내 답장 발송`
        : `${proposal.profile.businessName} 캘린더에 ${proposal.selectedSlot?.label ?? "후보"} 상담 일정 등록`,
    };
  });
}

function createManualReviewDecision(
  input: ModyConsultationDecisionInput,
  createdAt: ISODateTimeString,
  reason: string,
): ModyConsultationDecisionResult {
  return {
    id: `consultation_decision_${input.proposal.inquiry.id}_${createdAt}`,
    status: "needs_manual_review",
    createdAt,
    externalMutation: false,
    appFinalConfirmationRequired: true,
    selectedSlot: input.proposal.selectedSlot,
    finalActions: [],
    messengerReport: createDecisionOutboundMessage({
      proposal: input.proposal,
      createdAt,
      text: `${reason} 앱에서 수동으로 시간과 답장을 확인해야 합니다. 외부 발송과 캘린더 등록은 진행하지 않았습니다.`,
      actionLabels: ["앱에서 확인", "다시 제안", "보류"],
      channelId: input.decidedByChannelId,
    }),
    auditMessages: [
      `${input.decidedByUserId} 사용자의 메신저 결정이 수동 확인으로 전환되었습니다.`,
      reason,
      "외부 메일 발송과 캘린더 등록은 실행하지 않았습니다.",
    ],
  };
}

function proposalToInput(proposal: ModyConsultationProposalReport): ModyConsultationProposalInput {
  return {
    profile: proposal.profile,
    inquiry: proposal.inquiry,
    busyWindows: proposal.busyWindows,
    searchRange: proposal.searchRange,
    reportChannelId: proposal.reportChannelId,
    ...(proposal.messengerReport.appDeepLink ? { appDeepLink: proposal.messengerReport.appDeepLink } : {}),
  };
}

function timezoneOffsetMinutesFor(profile: ModyConsultationBusinessProfile): number {
  if (typeof profile.timezoneOffsetMinutes === "number") return profile.timezoneOffsetMinutes;
  if (profile.timezone === "Asia/Seoul") return 540;
  return 0;
}

function localDateKey(value: ISODateTimeString, offsetMinutes: number): string {
  const local = new Date(new Date(value).getTime() + offsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextLocalDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid local date key: ${dateKey}`);
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function weekdayForLocalDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid local date key: ${dateKey}`);
  }
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function localDateTimeToUtcIso(dateKey: string, time: string, offsetMinutes: number): ISODateTimeString {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || !month || !day || hour === undefined || minute === undefined) {
    throw new Error(`Invalid local date time: ${dateKey} ${time}`);
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000).toISOString();
}

function localMinutes(value: ISODateTimeString, offsetMinutes: number): number {
  const local = new Date(new Date(value).getTime() + offsetMinutes * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid time: ${value}`);
  }
  return hour * 60 + minute;
}

function minutesToTime(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatSlotLabel(startsAt: ISODateTimeString, endsAt: ISODateTimeString, offsetMinutes: number): string {
  const startLocal = new Date(new Date(startsAt).getTime() + offsetMinutes * 60_000);
  const endLocal = new Date(new Date(endsAt).getTime() + offsetMinutes * 60_000);
  const month = startLocal.getUTCMonth() + 1;
  const day = startLocal.getUTCDate();
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][startLocal.getUTCDay()] ?? "";
  return `${month}월 ${day}일(${weekday}) ${formatLocalTime(startLocal)}-${formatLocalTime(endLocal)}`;
}

function formatLocalTime(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function windowSummary(profile: ModyConsultationBusinessProfile): string {
  const uniqueWindows = new Map<string, ModyConsultationWindow>();
  for (const window of profile.consultationWindows) {
    uniqueWindows.set(`${window.startTime}-${window.endTime}`, window);
  }
  return [...uniqueWindows.values()]
    .map((window) => `${window.startTime}-${window.endTime}`)
    .join(", ");
}
