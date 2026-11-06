import {
  ModyAiDraftAdapterFactory,
  type ModyAiDraftProviderId,
} from "./ai-draft-adapter.js";
import {
  createEvent,
  type DateArray,
  type DurationObject,
  type EventAttributes,
} from "ics";
import {
  ModyProviderWorkIntakePlanner,
  type ModyProviderWorkCandidate,
  type ModyProviderWorkIntakeReport,
} from "./provider-work-intake.js";
import type { ModyProviderReadOutput } from "./provider-read-adapter.js";
import type {
  ISODateTimeString,
  ModyChannelId,
  ToolActionRequest,
  ToolOperationKind,
} from "./types.js";
import type { ModyUserWritingProfile } from "./mail-workflow.js";

export type ModyLocalLiveWorkflowStatus =
  | "ready_for_user_test"
  | "quiet"
  | "needs_user_review";

export type ModyLocalLiveCalendarSlot = {
  startsAt: ISODateTimeString;
  endsAt: ISODateTimeString;
  label?: string;
};

export type ModyLocalLiveWorkflowInput = {
  inputMode?: "user_input" | "provider_snapshot" | "local_fixture";
  reads: ModyProviderReadOutput[];
  writingProfile: ModyUserWritingProfile;
  reportChannelId: ModyChannelId;
  appDeepLinkBase?: string;
  preferredCalendarSlots?: ModyLocalLiveCalendarSlot[];
  draftProvider?: {
    providerId: ModyAiDraftProviderId;
    modelLabel: string;
    credentialReferenceId?: string;
  };
};

export type ModyLocalLiveWorkItem = {
  id: string;
  sourceId: string;
  title: string;
  status: "draft_ready" | "approval_pending" | "needs_review";
  sourceLabel: string;
  summary: string;
  draftReply: string;
  calendarCandidate?: {
    startsAt: ISODateTimeString;
    endsAt: ISODateTimeString;
    label: string;
  };
  approvalRequiredBeforeExternalMutation: true;
  approvalOperations: ToolOperationKind[];
  approvalQueue: ToolActionRequest[];
  auditMessages: string[];
};

export type ModyLocalLiveCalendarArtifact = {
  id: string;
  sourceWorkItemId: string;
  fileName: string;
  mimeType: "text/calendar";
  icsText: string;
  safeToImportOnlyAfterUserReview: true;
};

export type ModyLocalLiveWorkflowReport = {
  id: string;
  status: ModyLocalLiveWorkflowStatus;
  createdAt: ISODateTimeString;
  inputMode: "user_input" | "provider_snapshot" | "local_fixture";
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  totalReadItems: number;
  createdWorkItemsCount: number;
  ignoredItemsCount: number;
  reviewItemsCount: number;
  approvalQueueCount: number;
  generatedDraftCount: number;
  calendarArtifactCount: number;
  intakeReport: ModyProviderWorkIntakeReport;
  workItems: ModyLocalLiveWorkItem[];
  calendarArtifacts: ModyLocalLiveCalendarArtifact[];
  auditMessages: string[];
  userTestSteps: string[];
  summary: string;
  safetyBoundary: string;
};

type ModyLocalLiveWorkflowRunnerOptions = {
  now?: () => Date;
};

export class ModyLocalLiveWorkflowRunner {
  private readonly now: () => Date;
  private readonly intakePlanner: ModyProviderWorkIntakePlanner;

  constructor(options: ModyLocalLiveWorkflowRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.intakePlanner = new ModyProviderWorkIntakePlanner({ now: this.now });
  }

  async createReport(input: ModyLocalLiveWorkflowInput): Promise<ModyLocalLiveWorkflowReport> {
    const createdAt = this.now().toISOString();
    const intakeReport = this.intakePlanner.createReport({
      reads: input.reads,
      writingProfile: input.writingProfile,
      reportChannelId: input.reportChannelId,
      ...(input.appDeepLinkBase ? { appDeepLinkBase: input.appDeepLinkBase } : {}),
    });
    const draftFactory = new ModyAiDraftAdapterFactory({
      now: this.now,
    });
    const preferredSlots = input.preferredCalendarSlots ?? defaultCalendarSlots(createdAt);
    const workItems: ModyLocalLiveWorkItem[] = [];
    const calendarArtifacts: ModyLocalLiveCalendarArtifact[] = [];

    for (const candidate of intakeReport.candidates.filter((item) => item.shouldCreateWorkItem)) {
      const draftOutput = await draftFactory.generate({
        sourceId: candidate.id,
        sourceKind: candidate.sourceKind === "mail" ? "mail" : "manual_note",
        subject: candidate.title,
        originalText: candidate.summary,
        requestedOutcome: requestedOutcomeFor(candidate),
        writingProfile: {
          toneLabel: input.writingProfile.toneLabel,
          formatLabel: input.writingProfile.formatLabel,
          ...(input.writingProfile.signature ? { signature: input.writingProfile.signature } : {}),
        },
        reportChannelId: input.reportChannelId,
        modelPreference: {
          providerId: input.draftProvider?.providerId ?? "mock_local",
          modelLabel: input.draftProvider?.modelLabel ?? "mody-local-draft-mock-v1",
          ...(input.draftProvider?.credentialReferenceId
            ? { credentialReferenceId: input.draftProvider.credentialReferenceId }
            : {}),
          maxInputChars: 2_000,
          maxOutputChars: 1_200,
        },
      });
      const calendarSlot = candidateNeedsCalendar(candidate)
        ? pickAvailableSlot(preferredSlots, intakeReport.calendarBusyWindows)
        : undefined;
      const workItem = createWorkItem(candidate, draftOutput.draftText, calendarSlot);
      workItems.push(workItem);

      if (calendarSlot) {
        calendarArtifacts.push(createCalendarArtifact(workItem, calendarSlot, createdAt));
      }
    }

    const status = statusFor(workItems.length, intakeReport.reviewItemsCount);
    return {
      id: `local_live_workflow_${createdAt}`,
      status,
      createdAt,
      inputMode: input.inputMode ?? "user_input",
      readOnly: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      totalReadItems: intakeReport.totalReadItems,
      createdWorkItemsCount: workItems.length,
      ignoredItemsCount: intakeReport.ignoredItemsCount,
      reviewItemsCount: intakeReport.reviewItemsCount,
      approvalQueueCount: intakeReport.approvalQueue.length,
      generatedDraftCount: workItems.length,
      calendarArtifactCount: calendarArtifacts.length,
      intakeReport,
      workItems,
      calendarArtifacts,
      auditMessages: [
        auditInputModeMessage(input.inputMode),
        `업무 카드 ${workItems.length}건, 광고/스팸 무시 ${intakeReport.ignoredItemsCount}건, 확인 필요 ${intakeReport.reviewItemsCount}건을 만들었습니다.`,
        `AI 답장 초안 ${workItems.length}건과 오픈소스 ics 라이브러리 기반 캘린더 파일 후보 ${calendarArtifacts.length}건을 생성했습니다.`,
        "외부 메일 발송, 실제 캘린더 등록, provider token 저장은 실행하지 않았습니다.",
      ],
      userTestSteps: [
        "설치 앱 첫 화면에 실제 받은 메일/문의/예약 내용을 붙여넣고 처리 버튼을 누릅니다.",
        "업무 카드, 답장 초안, 승인 대기가 생성되는지 확인합니다.",
        "결과 폴더에서 .ics 일정 후보 파일과 답장 초안 파일을 확인합니다.",
        "CLI에서는 npm run run:local-workflow -- --text \"받은 문의 내용\"으로 같은 흐름을 실행합니다.",
      ],
      summary: [
        `${summaryInputModeLabel(input.inputMode)} ${intakeReport.totalReadItems}건을 처리했습니다.`,
        `업무 카드 ${workItems.length}건, 승인 대기 ${intakeReport.approvalQueue.length}건, 캘린더 파일 ${calendarArtifacts.length}건입니다.`,
        "캘린더 파일은 검증된 ics 오픈소스 라이브러리로 생성합니다.",
      ].join(" "),
      safetyBoundary:
        "local workflow는 사용자 입력 또는 읽기 전용 provider snapshot을 처리합니다. 생성된 .ics는 검증된 오픈소스 라이브러리로 만든 사용자 검토용 후보 파일이며, 앱이 외부 캘린더나 메일함을 직접 변경하지 않습니다.",
    };
  }
}

function auditInputModeMessage(inputMode: ModyLocalLiveWorkflowInput["inputMode"]): string {
  if (inputMode === "local_fixture") {
    return "검증 fixture 입력을 읽기 전용 provider snapshot처럼 처리했습니다.";
  }
  if (inputMode === "provider_snapshot") {
    return "연결된 provider의 읽기 전용 snapshot을 업무 후보로 처리했습니다.";
  }
  return "사용자가 입력한 실제 업무 내용을 읽기 전용 업무 후보로 처리했습니다.";
}

function summaryInputModeLabel(inputMode: ModyLocalLiveWorkflowInput["inputMode"]): string {
  if (inputMode === "local_fixture") return "검증 fixture";
  if (inputMode === "provider_snapshot") return "provider 읽기 결과";
  return "사용자 입력";
}

function createWorkItem(
  candidate: ModyProviderWorkCandidate,
  draftReply: string,
  calendarSlot: ModyLocalLiveCalendarSlot | undefined,
): ModyLocalLiveWorkItem {
  const approvalOperations = candidate.approvalQueue.map((request) => request.operationKind);
  const needsReview = candidate.classification === "needs_review";
  return {
    id: `local_live_${candidate.id}`,
    sourceId: candidate.sourceId,
    title: candidate.title,
    status: needsReview
      ? "needs_review"
      : approvalOperations.length > 0
        ? "approval_pending"
        : "draft_ready",
    sourceLabel: candidate.sourceProviderId,
    summary: candidate.summary,
    draftReply,
    ...(calendarSlot
      ? {
          calendarCandidate: {
            startsAt: calendarSlot.startsAt,
            endsAt: calendarSlot.endsAt,
            label: calendarSlot.label ?? "추천 가능 시간",
          },
        }
      : {}),
    approvalRequiredBeforeExternalMutation: true,
    approvalOperations,
    approvalQueue: candidate.approvalQueue,
    auditMessages: [
      `${candidate.sourceProviderId} ${candidate.sourceId}를 업무 카드로 변환했습니다.`,
      "답장 초안은 생성했지만 외부 발송은 승인 대기 상태로 남겼습니다.",
      calendarSlot
        ? "캘린더 후보 파일을 만들었지만 실제 캘린더 등록은 하지 않았습니다."
        : "캘린더 후보가 없는 업무로 분류했습니다.",
    ],
  };
}

function candidateNeedsCalendar(candidate: ModyProviderWorkCandidate): boolean {
  return candidate.approvalQueue.some((request) => request.operationKind === "create_calendar_event");
}

function requestedOutcomeFor(candidate: ModyProviderWorkCandidate): string {
  if (candidateNeedsCalendar(candidate)) {
    return "상담 가능 시간 안내, 일정 후보 제안, 발송 전 승인 대기";
  }

  if (candidate.classification === "needs_review") {
    return "업무 여부 확인 요청과 담당자 검토 안내";
  }

  return "문의 확인 답장 초안 작성, 발송 전 승인 대기";
}

function pickAvailableSlot(
  preferredSlots: ModyLocalLiveCalendarSlot[],
  busyWindows: { startsAt: ISODateTimeString; endsAt: ISODateTimeString }[],
): ModyLocalLiveCalendarSlot | undefined {
  return preferredSlots.find((slot) =>
    busyWindows.every((busy) => !overlaps(slot.startsAt, slot.endsAt, busy.startsAt, busy.endsAt)),
  );
}

function overlaps(
  leftStart: ISODateTimeString,
  leftEnd: ISODateTimeString,
  rightStart: ISODateTimeString,
  rightEnd: ISODateTimeString,
): boolean {
  return new Date(leftStart).getTime() < new Date(rightEnd).getTime() &&
    new Date(rightStart).getTime() < new Date(leftEnd).getTime();
}

function createCalendarArtifact(
  workItem: ModyLocalLiveWorkItem,
  slot: ModyLocalLiveCalendarSlot,
  createdAt: ISODateTimeString,
): ModyLocalLiveCalendarArtifact {
  const id = `calendar_artifact_${workItem.id}`;
  return {
    id,
    sourceWorkItemId: workItem.id,
    fileName: `${safeFileName(workItem.id)}.ics`,
    mimeType: "text/calendar",
    icsText: renderIcs({
      uid: `${id}@modycrew.local`,
      createdAt,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      title: workItem.title,
      description: `${workItem.summary}\n\n발송/등록 전 승인 필요. ModyCrew local live workflow에서 생성.`,
    }),
    safeToImportOnlyAfterUserReview: true,
  };
}

function renderIcs(input: {
  uid: string;
  createdAt: ISODateTimeString;
  startsAt: ISODateTimeString;
  endsAt: ISODateTimeString;
  title: string;
  description: string;
}): string {
  const event: EventAttributes = {
    uid: input.uid,
    title: input.title,
    description: input.description,
    start: toUtcDateArray(input.startsAt),
    startInputType: "utc",
    startOutputType: "utc",
    duration: durationBetween(input.startsAt, input.endsAt),
    status: "TENTATIVE",
    busyStatus: "TENTATIVE",
    productId: "ModyCrew//Local Live Workflow//KO",
    method: "PUBLISH",
    created: toUtcDateArray(input.createdAt),
  };
  const { error, value } = createEvent(event);
  if (error || !value) {
    throw new Error(`ICS calendar candidate generation failed: ${error?.message ?? "empty output"}`);
  }
  return value.endsWith("\n") ? value : `${value}\n`;
}

function toUtcDateArray(value: ISODateTimeString): DateArray {
  const date = new Date(value);
  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  ];
}

function durationBetween(
  startsAt: ISODateTimeString,
  endsAt: ISODateTimeString,
): DurationObject {
  const minutes = Math.max(
    1,
    Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000),
  );
  return {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  };
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

function defaultCalendarSlots(createdAt: ISODateTimeString): ModyLocalLiveCalendarSlot[] {
  const base = new Date(createdAt);
  base.setUTCDate(base.getUTCDate() + 1);
  base.setUTCHours(5, 0, 0, 0);
  return [0, 2, 4].map((offset, index) => {
    const startsAt = new Date(base.getTime() + offset * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 45 * 60 * 1000);
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      label: `후보 ${index + 1}`,
    };
  });
}

function statusFor(
  workItemCount: number,
  reviewItemsCount: number,
): ModyLocalLiveWorkflowStatus {
  if (workItemCount === 0 && reviewItemsCount === 0) return "quiet";
  if (reviewItemsCount > 0) return "needs_user_review";
  return "ready_for_user_test";
}
