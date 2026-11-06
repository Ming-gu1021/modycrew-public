import { ModyAiDraftAdapterFactory } from "./ai-draft-adapter.js";
import { ModyConsultationBookingWorkflow } from "./consultation-booking-workflow.js";
import type {
  ModyAiDraftInput,
  ModyAiDraftOutput,
} from "./ai-draft-adapter.js";
import type {
  ModyConsultationBusinessProfile,
  ModyConsultationBusyWindow,
  ModyConsultationDecisionResult,
  ModyConsultationInquiry,
  ModyConsultationProposalReport,
  ModyConsultationSearchRange,
} from "./consultation-booking-workflow.js";
import type { ModyDocumentLearningPlan } from "./local-document-learning.js";
import type {
  ISODateTimeString,
  ModyChannelId,
  ModyOutboundMessage,
  ToolActionRequest,
} from "./types.js";

export type ModyOfficePilotStageId =
  | "intake"
  | "document_context"
  | "calendar"
  | "draft"
  | "messenger"
  | "approval"
  | "final_execution_gate";

export type ModyOfficePilotStageStatus = "done" | "warning" | "blocked";

export type ModyOfficePilotStage = {
  id: ModyOfficePilotStageId;
  label: string;
  status: ModyOfficePilotStageStatus;
  summary: string;
  evidence: string[];
};

export type ModyOfficePilotKnowledgeContext = {
  title: string;
  citationLabel: string;
  text: string;
};

export type ModyOfficePilotDecisionInput = {
  decision: "approve" | "request_change" | "hold";
  decidedByChannelId: ModyChannelId;
  decidedByUserId: string;
  requestedSlotStartsAt?: ISODateTimeString;
};

export type ModyOfficePilotInput = {
  profile: ModyConsultationBusinessProfile;
  inquiry: ModyConsultationInquiry;
  busyWindows: ModyConsultationBusyWindow[];
  searchRange: ModyConsultationSearchRange;
  reportChannelId: ModyChannelId;
  appDeepLink?: string;
  documentPlan?: ModyDocumentLearningPlan;
  knowledgeContext?: ModyOfficePilotKnowledgeContext[];
  userDecision?: ModyOfficePilotDecisionInput;
  modelPreference?: ModyAiDraftInput["modelPreference"];
};

export type ModyOfficePilotStatus =
  | "ready_for_user_review"
  | "ready_for_app_final_confirmation"
  | "needs_manual_review"
  | "held";

export type ModyOfficePilotReport = {
  id: string;
  createdAt: ISODateTimeString;
  status: ModyOfficePilotStatus;
  externalMutation: false;
  rawSecretMaterialStored: false;
  databaseUsed: false;
  appFinalConfirmationRequired: true;
  stages: ModyOfficePilotStage[];
  consultationProposal: ModyConsultationProposalReport;
  aiDraft: ModyAiDraftOutput;
  decisionResult?: ModyConsultationDecisionResult;
  approvalQueue: ToolActionRequest[];
  finalActions: ModyConsultationDecisionResult["finalActions"];
  messengerReport: ModyOutboundMessage;
  userVisibleSummary: string;
  safetyBoundary: string;
  nextUserActions: string[];
};

type ModyOfficePilotWorkflowOptions = {
  now?: () => Date;
  consultationWorkflow?: ModyConsultationBookingWorkflow;
  aiDraftFactory?: ModyAiDraftAdapterFactory;
};

export class ModyOfficePilotWorkflow {
  private readonly now: () => Date;
  private readonly consultationWorkflow: ModyConsultationBookingWorkflow;
  private readonly aiDraftFactory: ModyAiDraftAdapterFactory;

  constructor(options: ModyOfficePilotWorkflowOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.consultationWorkflow = options.consultationWorkflow ?? new ModyConsultationBookingWorkflow({ now: this.now });
    this.aiDraftFactory = options.aiDraftFactory ?? new ModyAiDraftAdapterFactory({ now: this.now });
  }

  async createPilot(input: ModyOfficePilotInput): Promise<ModyOfficePilotReport> {
    assertNoRawSecretMaterial(input);
    const createdAt = this.now().toISOString();
    const consultationProposal = this.consultationWorkflow.createProposal({
      profile: input.profile,
      inquiry: input.inquiry,
      busyWindows: input.busyWindows,
      searchRange: input.searchRange,
      reportChannelId: input.reportChannelId,
      ...(input.appDeepLink ? { appDeepLink: input.appDeepLink } : {}),
    });
    const aiDraft = await this.aiDraftFactory.generate(createDraftInput(input, consultationProposal));
    const decisionResult = input.userDecision
      ? this.consultationWorkflow.applyDecision({
          proposal: consultationProposal,
          decision: input.userDecision.decision,
          decidedByChannelId: input.userDecision.decidedByChannelId,
          decidedByUserId: input.userDecision.decidedByUserId,
          ...(input.userDecision.requestedSlotStartsAt
            ? { requestedSlotStartsAt: input.userDecision.requestedSlotStartsAt }
            : {}),
        })
      : undefined;
    const status = statusFor(consultationProposal, decisionResult);
    const approvalQueue = (decisionResult?.updatedProposal ?? consultationProposal).approvalQueue;
    const finalActions = decisionResult?.finalActions ?? [];
    const stages = createStages({
      input,
      consultationProposal,
      aiDraft,
      ...(decisionResult ? { decisionResult } : {}),
    });
    const messengerReport = createMessengerReport({
      input,
      createdAt,
      status,
      stages,
      consultationProposal,
      aiDraft,
      ...(decisionResult ? { decisionResult } : {}),
    });

    return {
      id: `office_pilot_${input.inquiry.id}_${compactDate(createdAt)}`,
      createdAt,
      status,
      externalMutation: false,
      rawSecretMaterialStored: false,
      databaseUsed: false,
      appFinalConfirmationRequired: true,
      stages,
      consultationProposal,
      aiDraft,
      ...(decisionResult ? { decisionResult } : {}),
      approvalQueue,
      finalActions,
      messengerReport,
      userVisibleSummary: createUserVisibleSummary(status, consultationProposal, finalActions.length),
      safetyBoundary:
        "ModyOfficePilotWorkflow는 메일/문의/자료/캘린더 snapshot을 읽고 AI 초안, 메신저 보고, 승인 대기, 최종 실행 후보만 만듭니다. send_email과 create_calendar_event는 앱 최종 확인 전 실행하지 않습니다.",
      nextUserActions: nextUserActionsFor(status, decisionResult),
    };
  }
}

function createDraftInput(
  input: ModyOfficePilotInput,
  consultationProposal: ModyConsultationProposalReport,
): ModyAiDraftInput {
  const selectedSlotLabel = consultationProposal.selectedSlot?.label ?? "자동 후보 없음";
  const documentSummary = summarizeDocumentContext(input);

  return {
    sourceId: input.inquiry.id,
    sourceKind: "booking_request",
    subject: input.inquiry.subject,
    originalText: [
      input.inquiry.body,
      `상담 후보: ${selectedSlotLabel}`,
      `자료 맥락: ${documentSummary}`,
      `기존 답장 초안: ${consultationProposal.replyDraft}`,
    ].join("\n\n"),
    requestedOutcome:
      `${selectedSlotLabel} 기준으로 문의자에게 보낼 상담 일정 안내 답장 초안을 만들고, 발송 전 사용자 승인을 받습니다.`,
    writingProfile: {
      toneLabel: input.profile.replyToneLabel,
      formatLabel: input.profile.replyFormatLabel,
      ...(input.profile.replySignature ? { signature: input.profile.replySignature } : {}),
      bannedPhrases: ["확정했습니다", "자동 발송했습니다"],
    },
    reportChannelId: input.reportChannelId,
    ...(input.modelPreference ? { modelPreference: input.modelPreference } : {}),
  };
}

function createStages(input: {
  input: ModyOfficePilotInput;
  consultationProposal: ModyConsultationProposalReport;
  aiDraft: ModyAiDraftOutput;
  decisionResult?: ModyConsultationDecisionResult;
}): ModyOfficePilotStage[] {
  const documentPlan = input.input.documentPlan;
  const documentReady = documentPlan
    ? documentPlan.summary.readyToIndex > 0 || (input.input.knowledgeContext?.length ?? 0) > 0
    : false;

  return [
    {
      id: "intake",
      label: "문의 수신",
      status: "done",
      summary: `${input.input.inquiry.sourceKind} 문의 1건을 상담 요청으로 처리했습니다.`,
      evidence: [
        input.input.inquiry.subject,
        `받은 사람: ${input.input.inquiry.from}`,
      ],
    },
    {
      id: "document_context",
      label: "자료 참고",
      status: documentReady ? "done" : "warning",
      summary: documentReady
        ? "로컬 자료 학습 결과와 업무 스타일을 초안 맥락에 반영했습니다."
        : "연결된 로컬 자료가 없어 문의 원문과 상담 규칙만 사용했습니다.",
      evidence: documentPlan
        ? [
            `${documentPlan.summary.readyToIndex}개 파일 ready_to_index`,
            `${documentPlan.groups.length}개 로컬 분류 그룹`,
            documentPlan.styleProfile.name,
          ]
        : ["자료 학습 세션 없음"],
    },
    {
      id: "calendar",
      label: "일정 후보",
      status: input.consultationProposal.selectedSlot ? "done" : "warning",
      summary: input.consultationProposal.selectedSlot
        ? `${input.consultationProposal.selectedSlot.label} 후보를 기본 제안으로 골랐습니다.`
        : "사용자 규칙 안에서 자동 제안 가능한 시간이 없습니다.",
      evidence: [
        `주말/휴무 제외: ${input.input.profile.closedWeekdays.join(",")}`,
        `캘린더 바쁨 ${input.input.busyWindows.length}건 제외`,
        `후보 ${input.consultationProposal.proposedSlots.length}개`,
      ],
    },
    {
      id: "draft",
      label: "AI 초안",
      status: "done",
      summary: "사용자 말투와 답장 포맷 기준으로 발송 전 초안을 만들었습니다.",
      evidence: [
        input.aiDraft.providerId,
        input.aiDraft.modelLabel,
        `approvalRequiredBeforeSend=${input.aiDraft.approvalRequiredBeforeSend}`,
      ],
    },
    {
      id: "messenger",
      label: "메신저 보고",
      status: "done",
      summary: `${input.input.reportChannelId} 채널로 요약과 진행/수정/보류 버튼을 보냅니다.`,
      evidence: input.consultationProposal.messengerReport.actionLabels,
    },
    {
      id: "approval",
      label: "승인 대기",
      status: input.consultationProposal.approvalQueue.length > 0 ? "done" : "warning",
      summary: `send_email, create_calendar_event 후보를 승인함에 올립니다.`,
      evidence: input.consultationProposal.approvalQueue.map((request) => request.operationKind),
    },
    {
      id: "final_execution_gate",
      label: "최종 실행",
      status: input.decisionResult?.status === "ready_for_app_final_confirmation" ? "done" : "warning",
      summary: input.decisionResult?.status === "ready_for_app_final_confirmation"
        ? "사용자 승인 의사는 기록됐고 앱 최종 확인 후 실행 후보로 넘어갑니다."
        : "아직 앱 최종 확인 전이므로 외부 발송과 캘린더 등록은 실행하지 않습니다.",
      evidence: [
        "externalMutation=false",
        "appFinalConfirmationRequired=true",
        `finalActions=${input.decisionResult?.finalActions.length ?? 0}`,
      ],
    },
  ];
}

function createMessengerReport(input: {
  input: ModyOfficePilotInput;
  createdAt: ISODateTimeString;
  status: ModyOfficePilotStatus;
  stages: ModyOfficePilotStage[];
  consultationProposal: ModyConsultationProposalReport;
  aiDraft: ModyAiDraftOutput;
  decisionResult?: ModyConsultationDecisionResult;
}): ModyOutboundMessage {
  const selectedSlot = input.decisionResult?.selectedSlot ?? input.consultationProposal.selectedSlot;
  const decisionLine = input.decisionResult
    ? `결정 상태: ${input.decisionResult.status}`
    : "결정 상태: 사용자가 진행/수정/보류를 고르기 전";

  return {
    id: `office_pilot_report_${input.input.inquiry.id}`,
    channelId: input.input.reportChannelId,
    text: [
      `${input.input.profile.businessName} 상담 문의를 정리했습니다.`,
      `추천 시간: ${selectedSlot?.label ?? "수동 확인 필요"}`,
      `AI 초안: ${input.aiDraft.confidenceLabel}, 발송 전 승인 필요`,
      decisionLine,
      "답장 발송과 캘린더 등록은 앱에서 마지막으로 확인해야 진행됩니다.",
    ].join("\n"),
    actionLabels: actionLabelsFor(input.status),
    createdAt: input.createdAt,
    ...(input.input.appDeepLink ? { appDeepLink: input.input.appDeepLink } : {}),
  };
}

function actionLabelsFor(status: ModyOfficePilotStatus): string[] {
  if (status === "ready_for_app_final_confirmation") {
    return ["앱에서 최종 실행", "다시 수정", "보류"];
  }
  if (status === "needs_manual_review") {
    return ["앱에서 수동 확인", "다시 제안", "보류"];
  }
  if (status === "held") {
    return ["다시 제안", "앱에서 보기"];
  }
  return ["진행", "시간 변경", "보류", "앱에서 보기"];
}

function statusFor(
  proposal: ModyConsultationProposalReport,
  decisionResult?: ModyConsultationDecisionResult,
): ModyOfficePilotStatus {
  if (decisionResult?.status === "ready_for_app_final_confirmation") return "ready_for_app_final_confirmation";
  if (decisionResult?.status === "held") return "held";
  if (decisionResult?.status === "needs_manual_review") return "needs_manual_review";
  if (proposal.status === "needs_manual_review") return "needs_manual_review";
  return "ready_for_user_review";
}

function createUserVisibleSummary(
  status: ModyOfficePilotStatus,
  proposal: ModyConsultationProposalReport,
  finalActionCount: number,
): string {
  if (status === "ready_for_app_final_confirmation") {
    return `상담 문의 1건은 ${proposal.selectedSlot?.label ?? "선택된 후보"} 기준으로 승인 의사가 기록됐고, 앱 최종 확인 대기 ${finalActionCount}건이 준비됐습니다.`;
  }
  if (status === "needs_manual_review") {
    return "자동 처리하기 어려운 상담 문의입니다. 앱에서 시간을 직접 확인해야 합니다.";
  }
  if (status === "held") {
    return "사용자가 보류했습니다. 답장 발송과 캘린더 등록은 진행하지 않습니다.";
  }
  return `상담 문의 1건에서 가능 시간 ${proposal.proposedSlots.length}개와 AI 답장 초안을 만들었습니다.`;
}

function nextUserActionsFor(
  status: ModyOfficePilotStatus,
  decisionResult?: ModyConsultationDecisionResult,
): string[] {
  if (status === "ready_for_app_final_confirmation") {
    return [
      "앱 승인함에서 답장 내용을 최종 확인합니다.",
      "캘린더 등록 시간을 최종 확인합니다.",
      "최종 실행 버튼을 누른 뒤에만 실제 send_email, create_calendar_event adapter를 호출합니다.",
    ];
  }
  if (status === "needs_manual_review") {
    return ["앱에서 수동으로 상담 시간을 고릅니다.", "답장 초안을 다시 생성하거나 직접 수정합니다."];
  }
  if (status === "held") {
    return ["보류 사유를 기록합니다.", "나중에 다시 제안할 수 있게 업무 인박스에 남깁니다."];
  }
  if (decisionResult?.status === "change_proposal_ready") {
    return ["변경된 시간을 메신저로 다시 보고합니다.", "사용자가 한 번 더 승인하면 앱 최종 확인으로 넘깁니다."];
  }
  return ["메신저에서 진행, 시간 변경, 보류 중 하나를 선택합니다.", "앱에서 초안과 캘린더 후보를 확인합니다."];
}

function summarizeDocumentContext(input: ModyOfficePilotInput): string {
  const parts: string[] = [];
  if (input.documentPlan) {
    parts.push(
      `${input.documentPlan.summary.readyToIndex}개 파일 학습 가능`,
      `${input.documentPlan.groups.length}개 그룹`,
      input.documentPlan.styleProfile.outputGuidance.join(" / "),
    );
  }
  for (const context of input.knowledgeContext ?? []) {
    parts.push(`${context.title}(${context.citationLabel}): ${context.text}`);
  }
  return parts.length > 0 ? parts.join("\n") : "연결된 로컬 자료 없음";
}

function assertNoRawSecretMaterial(input: ModyOfficePilotInput): void {
  const serialized = JSON.stringify(input);
  if (/(access_token|refresh_token|apiKey|clientSecret|password|rawSecret)/i.test(serialized)) {
    throw new Error("ModyOfficePilotWorkflow 입력에는 원문 secret material을 넣을 수 없습니다.");
  }
}

function compactDate(value: string): string {
  return value.replaceAll(/[^0-9]/g, "").slice(0, 14) || "now";
}
