"use client";

import type { AITeammate } from "./ai-teammates";
import type { ApprovalEngineWorkKind } from "./approval-engine";

export type WorkAutomationIntent = "mail_or_inquiry" | "schedule" | "repeat" | "document_draft" | "folder_tidy";

export type WorkAutomationPipelineStepId =
  | "mail_or_inquiry_check"
  | "reply_draft"
  | "schedule_candidate"
  | "approval_queue"
  | "execution_log"
  | "repeat_rule_saved_off"
  | "repeat_user_enable_gate"
  | "repeat_check_queue"
  | "document_source_check"
  | "document_draft_candidate"
  | "folder_scope_check"
  | "folder_tidy_candidate";

export type WorkAutomationPipelineStep = {
  id: WorkAutomationPipelineStepId;
  label: string;
  detail: string;
  state: "ready" | "blocked" | "approval" | "locked";
  requiresConnectionIds?: Array<"mail" | "calendar">;
  blockedUntilLabel?: string;
  evidenceKey?: WorkAutomationRuntimeEvidenceKey;
  proofLabel?: string;
};

export type WorkAutomationRuntimeEvidenceKey =
  | "mail_message_count"
  | "reply_draft_count"
  | "schedule_candidate_count"
  | "approval_queue_count"
  | "execution_log_pending";

export type WorkAutomationRuntimeEvidence = {
  basis: "mail_work_intake_result";
  evidenceContract: "conversation_intent_to_work_automation_approval_to_mail_work_intake_result";
  routingContract: "conversation_intent_to_work_automation_approval";
  approvalGateContract: "dry_run_receipt_connector_readiness_final_presence";
  liveReadinessContract: "mail_calendar_read_only_live_report_contract";
  mailMessageCount: number;
  replyDraftCount: number;
  scheduleCandidateCount: number;
  approvalQueueCount: number;
  executionLogReady: boolean;
  proofLabel: string;
};

export type WorkAutomationMailOpsWorkQueueEvidence = {
  basis: "mailops_work_queue_review_records";
  evidenceContract: "work_queue_review_to_work_automation_engine_handoff";
  enginePathContract: "mail_intake_to_work_queue_review_to_approval_engine_to_final_confirmation_to_execution_log";
  approvalGateContract: "dry_run_receipt_connector_readiness_final_presence";
  total: number;
  approvedCount: number;
  reviewCount: number;
  excludedCount: number;
  finalReadyCount: number;
  composedCount: number;
  nextFinalTitle: string;
  externalMutation: false;
  proofLabel: string;
};

export type WorkAutomationEnginePlan = {
  intent: WorkAutomationIntent;
  label: string;
  summary: string;
  corePipelineLabel: string;
  requestedScheduleCandidate: boolean;
  pipeline: WorkAutomationPipelineStep[];
  connectionRequiredIds: Array<"mail" | "calendar">;
  connectionGateLabel: string;
  candidateCreationBlockedUntilConnections: boolean;
  blockedCandidateStepIds: WorkAutomationPipelineStepId[];
  approvalBoundary: string;
  executionLogLabel: string;
  repeatWorkDefaultOff: boolean;
  fakeReadBlocked: true;
  fakeExecutionBlocked: true;
  externalMutation: false;
  finalUserConfirmationRequired: true;
};

export type RoleWorkAutomationAssignment = {
  contract: "role_assignment_to_work_automation_engine_v1";
  teammateId: string;
  teammateName: string;
  roleTitle: string;
  channelName: string;
  workKind: ApprovalEngineWorkKind | "general";
  workIntent: WorkAutomationIntent | "general";
  oneLineLabel: string;
  candidateLabel: string;
  pipelineLabel: string;
  connectionGateLabel: string;
  approvalGateLabel: string;
  executionBoundary: string;
  evidencePath: string;
  externalMutation: false;
  finalUserConfirmationRequired: true;
};

export type WorkAutomationRuntimeReceiptContext = {
  workAutomationContract?: string;
  requestedWorkSummary?: string;
  plannedToolSequenceLabel?: string;
  approvalQueueCount?: number;
  workAutomationApprovalGateLabel?: string;
  workAutomationConnectionRequiredIds?: string;
  workAutomationCandidateBlockedUntilConnections?: boolean;
  externalMutationAllowed?: boolean;
};

export type WorkAutomationRuntimeReceiptHandoff = {
  contract: "ai_runtime_receipt_to_work_automation_engine_handoff_v1";
  receiptContract: "aiRuntimeReceipt.runtimeContext";
  enginePathContract: "ai_runtime_receipt_to_conversation_engine_to_work_automation_engine_to_approval_engine";
  virtualOfficeEventPath: "ai_runtime_receipt_to_selected_work_event_to_virtual_office_event_bus";
  workAutomationContract: string;
  requestedWorkSummary: string;
  plannedToolSequenceLabel: string;
  approvalQueueCount: number;
  approvalGateContract: string;
  readyForWorkCandidate: boolean;
  externalMutation: false;
  proofLabel: string;
};

export const WORK_AUTOMATION_CORE_PIPELINE_LABEL =
  "메일/문의 확인 -> 답장 초안 -> 일정 후보 -> 승인함 -> 실행 로그";

export const WORK_AUTOMATION_CONVERSATION_ROUTING_CONTRACT =
  "conversation_intent_to_work_automation_approval";

export const WORK_AUTOMATION_RUNTIME_EVIDENCE_CONTRACT =
  "conversation_intent_to_work_automation_approval_to_mail_work_intake_result";

export const WORK_AUTOMATION_APPROVAL_GATE_CONTRACT =
  "dry_run_receipt_connector_readiness_final_presence";

export const WORK_AUTOMATION_LIVE_READINESS_CONTRACT =
  "mail_calendar_read_only_live_report_contract";

export const WORK_AUTOMATION_WORK_QUEUE_HANDOFF_CONTRACT =
  "work_queue_review_to_work_automation_engine_handoff";

export const WORK_AUTOMATION_MAILOPS_ENGINE_PATH =
  "mail_intake_to_work_queue_review_to_approval_engine_to_final_confirmation_to_execution_log";

export const WORK_AUTOMATION_MAILOPS_WORK_QUEUE_PROOF_LABEL =
  "작업함 결정 기록 기준으로 승인 후보만 마지막 확인과 실행 로그에 연결";

export const WORK_AUTOMATION_APPROVAL_BOUNDARY =
  "외부 발송, 일정 등록, 파일 변경, 공유, 삭제는 최종 승인 전까지 실행하지 않습니다.";

export const WORK_AUTOMATION_REPEAT_DEFAULT_OFF =
  "반복 업무는 저장만으로 실행하지 않고 사용자가 켠 뒤에만 점검합니다.";

export const ROLE_WORK_AUTOMATION_ASSIGNMENT_CONTRACT =
  "role_assignment_to_work_automation_engine_v1";

export const WORK_AUTOMATION_RUNTIME_RECEIPT_HANDOFF_CONTRACT =
  "ai_runtime_receipt_to_work_automation_engine_handoff_v1";

export const WORK_AUTOMATION_RUNTIME_RECEIPT_ENGINE_PATH =
  "ai_runtime_receipt_to_conversation_engine_to_work_automation_engine_to_approval_engine";

export const WORK_AUTOMATION_RUNTIME_RECEIPT_VIRTUAL_OFFICE_PATH =
  "ai_runtime_receipt_to_selected_work_event_to_virtual_office_event_bus";

export function createWorkAutomationRuntimeReceiptHandoff(input: {
  runtimeContext?: WorkAutomationRuntimeReceiptContext | null;
}): WorkAutomationRuntimeReceiptHandoff {
  const runtimeContext = input.runtimeContext;
  const workAutomationContract = runtimeContext?.workAutomationContract ?? "";
  const requestedWorkSummary = runtimeContext?.requestedWorkSummary ?? "";
  const plannedToolSequenceLabel = runtimeContext?.plannedToolSequenceLabel ?? "";
  const approvalQueueCount = Number.isFinite(runtimeContext?.approvalQueueCount)
    ? Math.max(0, Math.floor(Number(runtimeContext?.approvalQueueCount)))
    : 0;
  const approvalGateContract =
    runtimeContext?.workAutomationApprovalGateLabel || WORK_AUTOMATION_APPROVAL_GATE_CONTRACT;
  const connectionRequiredIds = String(runtimeContext?.workAutomationConnectionRequiredIds ?? "").trim();
  const candidateBlockedUntilConnections = runtimeContext?.workAutomationCandidateBlockedUntilConnections === true;
  const readyForWorkCandidate =
    workAutomationContract === ROLE_WORK_AUTOMATION_ASSIGNMENT_CONTRACT &&
    approvalGateContract === WORK_AUTOMATION_APPROVAL_GATE_CONTRACT &&
    !connectionRequiredIds &&
    !candidateBlockedUntilConnections &&
    runtimeContext?.externalMutationAllowed === false;

  return {
    contract: WORK_AUTOMATION_RUNTIME_RECEIPT_HANDOFF_CONTRACT,
    receiptContract: "aiRuntimeReceipt.runtimeContext",
    enginePathContract: WORK_AUTOMATION_RUNTIME_RECEIPT_ENGINE_PATH,
    virtualOfficeEventPath: WORK_AUTOMATION_RUNTIME_RECEIPT_VIRTUAL_OFFICE_PATH,
    workAutomationContract,
    requestedWorkSummary,
    plannedToolSequenceLabel,
    approvalQueueCount,
    approvalGateContract,
    readyForWorkCandidate,
    externalMutation: false,
    proofLabel: readyForWorkCandidate
      ? "AI 답변 receipt가 역할 기반 업무 후보와 승인 잠금으로 연결됨"
      : candidateBlockedUntilConnections || connectionRequiredIds
        ? "AI 답변 receipt는 연결 부족으로 업무 후보 전 단계에서 멈춤"
      : "AI 답변 receipt는 외부 실행 없이 대화 증거로만 기록됨",
  };
}

export function createRoleWorkAutomationAssignment(input: {
  teammate: AITeammate;
  mailReady?: boolean;
  calendarReady?: boolean;
}): RoleWorkAutomationAssignment {
  const teammate = input.teammate;
  const roleText = `${teammate.templateId} ${teammate.teamLabel} ${teammate.roleTitle} ${teammate.channelName} ${teammate.brief} ${teammate.skillIds.join(" ")}`.toLowerCase();
  const usesMail =
    teammate.templateId === "mail" ||
    teammate.templateId === "operations" ||
    /mail|메일|문의|답장|calendar|일정|캘린더|예약|mail_calendar_operator/u.test(roleText);
  const usesFolder =
    teammate.templateId === "desktop" ||
    /folder|desktop|파일|폴더|바탕화면|다운로드|정리|computer_use_operator/u.test(roleText);
  const usesDocument =
    teammate.templateId === "marketing" ||
    teammate.templateId === "development" ||
    teammate.templateId === "finance" ||
    teammate.templateId === "legal" ||
    /document|문서|자료|보고서|계약|정산|정책|콘텐츠|발표|제안/u.test(roleText);

  if (usesMail) {
    const plan = createWorkAutomationEnginePlan({
      intent: "mail_or_inquiry",
      mailReady: input.mailReady === true,
      calendarReady: input.calendarReady === true,
      needsScheduleCandidate: true,
    });
    return buildRoleAssignment({
      teammate,
      workKind: "mailops",
      workIntent: "mail_or_inquiry",
      candidateLabel: "메일/문의 확인 -> 답장 초안 -> 일정 후보",
      pipelineLabel: plan.corePipelineLabel,
      connectionGateLabel:
        typeof input.mailReady === "boolean" || typeof input.calendarReady === "boolean"
          ? plan.connectionGateLabel
          : "메일/캘린더 연결 상태는 후보 생성 직전 다시 확인",
      evidencePath: "runMailWorkIntake -> mailops work queue -> approval engine -> execution log",
    });
  }

  if (usesFolder) {
    return buildRoleAssignment({
      teammate,
      workKind: "folder_tidy",
      workIntent: "folder_tidy",
      candidateLabel: "선택 폴더 읽기 -> 정리 계획 -> 승인함",
      pipelineLabel: "선택 범위 확인 -> 정리 후보 -> 승인함 -> 실행 로그",
      connectionGateLabel: "사용자가 선택한 폴더 범위만 읽고 이동/삭제/이름 변경은 승인 전 잠금",
      evidencePath: "folder candidate -> dry run -> office approval -> rollback log",
    });
  }

  if (usesDocument) {
    return buildRoleAssignment({
      teammate,
      workKind: "document_draft",
      workIntent: "document_draft",
      candidateLabel: "자료 읽기 -> 문서/보고서 초안 -> 승인함",
      pipelineLabel: "자료 범위 확인 -> 초안 후보 -> 승인함 -> 실행 로그",
      connectionGateLabel: "사용자가 고른 자료만 읽고 저장/공유/제출은 승인 전 잠금",
      evidencePath: "document learning -> draft candidate -> office approval -> execution log",
    });
  }

  return buildRoleAssignment({
    teammate,
    workKind: "general",
    workIntent: "general",
    candidateLabel: "대화 의도 판단 -> 필요한 담당자/업무 후보 선택",
    pipelineLabel: "요청 분류 -> 역할 배정 -> 후보 생성 -> 승인함",
    connectionGateLabel: "필요한 연결과 자료 범위를 확인한 뒤 후보만 생성",
    evidencePath: "conversation engine -> role router -> work automation engine",
  });
}

export function formatRoleWorkAutomationAssignmentLines(assignment: RoleWorkAutomationAssignment) {
  return [
    `역할 자동화 계약: ${assignment.contract}`,
    `담당자: ${assignment.teammateName} · ${assignment.roleTitle}`,
    `업무 후보: ${assignment.candidateLabel}`,
    `파이프라인: ${assignment.pipelineLabel}`,
    assignment.connectionGateLabel,
    assignment.approvalGateLabel,
    assignment.executionBoundary,
    `증거 경로: ${assignment.evidencePath}`,
  ];
}

export function createWorkAutomationEnginePlan(input: {
  intent: WorkAutomationIntent;
  mailReady: boolean;
  calendarReady: boolean;
  needsScheduleCandidate?: boolean;
  repeatEnabled?: boolean;
}): WorkAutomationEnginePlan {
  if (input.intent === "repeat") return createRepeatAutomationPlan(input);
  if (input.intent === "schedule") return createScheduleAutomationPlan(input);
  if (input.intent === "document_draft") return createDocumentDraftAutomationPlan();
  if (input.intent === "folder_tidy") return createFolderTidyAutomationPlan();
  return createMailOrInquiryAutomationPlan(input);
}

export function inferRoleCommandWorkIntent(
  command: string,
  fallbackIntent: RoleWorkAutomationAssignment["workIntent"] = "general",
): RoleWorkAutomationAssignment["workIntent"] {
  const normalized = command.replace(/\s+/gu, " ").trim();
  if (!normalized) return fallbackIntent;

  const isMetaOrNegated =
    /(?:단어|키워드|매크로|예시|가정|설명|왜|어떻게|가능(?:한가|해|할까|할까요|합니까|한지|여부)|할\s*수)|(?:하지\s*마|하지\s*말|안\s*(?:해|할)|말고|빼고|제외|패스|보류|나중)/u.test(normalized);
  if (isMetaOrNegated) return fallbackIntent;

  const hasExecution =
    /읽|확인|점검|분류|검색|찾|요약|정리|답장|회신|초안|작성|만들|보내|발송|등록|추가|변경|이동|삭제|처리|자동화|반복|조율|추천|맡|잡|해\s*줘|해주세요/u.test(normalized);
  if (!hasExecution) return fallbackIntent;

  if (/(메일|이메일|문의|답장|회신|받은\s*편지|수신함|고객|상담|견적|제안)/iu.test(normalized)) return "mail_or_inquiry";
  if (/(일정|캘린더|미팅|회의|예약|방문|시간|날짜|스케줄)/iu.test(normalized)) return "schedule";
  if (/(반복|매일|매주|매월|정기|자동|규칙|리마인드|마감)/iu.test(normalized)) return "repeat";
  if (/(문서|보고서|자료|제안서|계약서|엑셀|시트|pdf|피디에프|양식)/iu.test(normalized)) return "document_draft";
  if (/(파일|폴더|정리|이동|삭제|중복|이름|드라이브|다운로드|바탕\s*화면)/iu.test(normalized)) return "folder_tidy";
  return fallbackIntent;
}
export function workAutomationIntentFromRoleIntent(
  intent: RoleWorkAutomationAssignment["workIntent"] | undefined,
): WorkAutomationIntent | null {
  if (
    intent === "mail_or_inquiry" ||
    intent === "schedule" ||
    intent === "repeat" ||
    intent === "document_draft" ||
    intent === "folder_tidy"
  ) {
    return intent;
  }
  return null;
}

export function createRoleCommandWorkAutomationPlan(input: {
  command: string;
  fallbackIntent?: RoleWorkAutomationAssignment["workIntent"];
  mailReady: boolean;
  calendarReady: boolean;
}) {
  const inferredIntent = inferRoleCommandWorkIntent(input.command, input.fallbackIntent ?? "general");
  const automationIntent = workAutomationIntentFromRoleIntent(inferredIntent);
  if (!automationIntent) return null;
  return createWorkAutomationEnginePlan({
    intent: automationIntent,
    mailReady: input.mailReady,
    calendarReady: input.calendarReady,
    needsScheduleCandidate: automationIntent !== "repeat",
    repeatEnabled: false,
  });
}

function buildRoleAssignment(input: {
  teammate: AITeammate;
  workKind: RoleWorkAutomationAssignment["workKind"];
  workIntent: RoleWorkAutomationAssignment["workIntent"];
  candidateLabel: string;
  pipelineLabel: string;
  connectionGateLabel: string;
  evidencePath: string;
}): RoleWorkAutomationAssignment {
  return {
    contract: ROLE_WORK_AUTOMATION_ASSIGNMENT_CONTRACT,
    teammateId: input.teammate.id,
    teammateName: input.teammate.name,
    roleTitle: input.teammate.roleTitle,
    channelName: input.teammate.channelName,
    workKind: input.workKind,
    workIntent: input.workIntent,
    oneLineLabel: `${input.teammate.name} -> ${input.candidateLabel} -> 오피스 승인함`,
    candidateLabel: input.candidateLabel,
    pipelineLabel: input.pipelineLabel,
    connectionGateLabel: input.connectionGateLabel,
    approvalGateLabel: WORK_AUTOMATION_APPROVAL_GATE_CONTRACT,
    executionBoundary: WORK_AUTOMATION_APPROVAL_BOUNDARY,
    evidencePath: input.evidencePath,
    externalMutation: false,
    finalUserConfirmationRequired: true,
  };
}

function createMailOrInquiryAutomationPlan(input: {
  mailReady: boolean;
  calendarReady: boolean;
  needsScheduleCandidate?: boolean;
}): WorkAutomationEnginePlan {
  const requestedScheduleCandidate = input.needsScheduleCandidate !== false;
  const connectionRequiredIds = [
    ...(input.mailReady ? [] : ["mail" as const]),
    ...(requestedScheduleCandidate && !input.calendarReady ? ["calendar" as const] : []),
  ];
  const candidateBlockedUntilConnections = connectionRequiredIds.length > 0;
  const blockedCandidateStepIds: WorkAutomationPipelineStepId[] = [
    ...(input.mailReady ? [] : ["mail_or_inquiry_check" as const, "reply_draft" as const]),
    ...(requestedScheduleCandidate && !input.calendarReady ? ["schedule_candidate" as const] : []),
  ];
  return {
    intent: "mail_or_inquiry",
    label: "메일/문의 자동화",
    summary: candidateBlockedUntilConnections
      ? "필요 연결 전에는 메일/문의 원문을 읽거나 답장/일정 후보를 만든 것처럼 표시하지 않고 연결 복구에서 멈춥니다."
      : requestedScheduleCandidate
        ? "메일과 문의를 먼저 읽기 전용으로 확인하고 답장 초안, 일정 후보, 승인함, 실행 로그 순서로 보류합니다."
        : "메일과 문의를 먼저 읽기 전용으로 확인하고 답장 초안, 승인함, 실행 로그 순서로 보류합니다.",
    corePipelineLabel: WORK_AUTOMATION_CORE_PIPELINE_LABEL,
    requestedScheduleCandidate,
    pipeline: [
      {
        id: "mail_or_inquiry_check",
        label: "메일/문의 확인",
        detail: input.mailReady ? "연결된 메일함을 읽기 전용으로 확인" : "메일 연결 전에는 원문을 읽지 않음",
        state: input.mailReady ? "ready" : "blocked",
        evidenceKey: "mail_message_count",
        proofLabel: "runMailWorkIntake.messageCount",
        ...(input.mailReady ? {} : {
          requiresConnectionIds: ["mail" as const],
          blockedUntilLabel: "메일 연결 후 읽기 전용 확인",
        }),
      },
      {
        id: "reply_draft",
        label: "답장 초안",
        detail: input.mailReady
          ? "발송 전 사용자가 고칠 수 있는 초안만 생성"
          : "메일 원문이나 사용자가 붙여넣은 문의 내용 없이 초안을 만든 척하지 않음",
        state: input.mailReady ? "ready" : "blocked",
        evidenceKey: "reply_draft_count",
        proofLabel: "runMailWorkIntake.approvalPreviews.reply_draft 또는 workAnalysis.stats.replyCandidates",
        ...(input.mailReady ? {} : {
          requiresConnectionIds: ["mail" as const],
          blockedUntilLabel: "메일 연결 또는 사용자가 붙여넣은 문의 원문 확인",
        }),
      },
      {
        id: "schedule_candidate",
        label: "일정 후보",
        detail: requestedScheduleCandidate
          ? input.calendarReady
            ? "캘린더 가능 시간 후보 확인"
            : "캘린더 연결 전에는 등록 후보만 보류"
          : "이번 요청에 일정 조율 신호가 없어서 일정 후보는 만들지 않음",
        state: requestedScheduleCandidate ? (input.calendarReady ? "ready" : "blocked") : "locked",
        evidenceKey: "schedule_candidate_count",
        proofLabel: "runMailWorkIntake.approvalPreviews.calendar_candidate 또는 workAnalysis.stats.calendarCandidates",
        ...(!requestedScheduleCandidate || input.calendarReady ? {} : {
          requiresConnectionIds: ["calendar" as const],
          blockedUntilLabel: "캘린더 연결 후 가능 시간 후보 확인",
        }),
      },
      {
        id: "approval_queue",
        label: "승인함",
        detail: "발송, 등록, 공유는 승인함 최종 확인 전까지 잠금",
        state: "approval",
        evidenceKey: "approval_queue_count",
        proofLabel: "runMailWorkIntake.approvalQueueCount",
      },
      {
        id: "execution_log",
        label: "실행 로그",
        detail: "읽기, 초안, 승인, 실행 결과를 추적",
        state: "locked",
        evidenceKey: "execution_log_pending",
        proofLabel: "승인 전 실행 로그는 대기 상태로만 표시",
      },
    ],
    connectionRequiredIds,
    connectionGateLabel: connectionGateLabel(connectionRequiredIds),
    candidateCreationBlockedUntilConnections: candidateBlockedUntilConnections,
    blockedCandidateStepIds,
    approvalBoundary: WORK_AUTOMATION_APPROVAL_BOUNDARY,
    executionLogLabel: "실행 로그와 승인 기록에 남김",
    repeatWorkDefaultOff: true,
    fakeReadBlocked: true,
    fakeExecutionBlocked: true,
    externalMutation: false,
    finalUserConfirmationRequired: true,
  };
}

function createScheduleAutomationPlan(input: {
  mailReady: boolean;
  calendarReady: boolean;
}): WorkAutomationEnginePlan {
  const connectionRequiredIds = input.calendarReady ? [] : ["calendar" as const];
  const blockedCandidateStepIds: WorkAutomationPipelineStepId[] = input.calendarReady ? [] : ["schedule_candidate"];
  return {
    intent: "schedule",
    label: "일정 자동화",
    summary: input.calendarReady
      ? "일정 요청은 캘린더 가능 시간과 필요한 메일 맥락을 후보로 만들고 승인함에서 등록을 멈춥니다."
      : "캘린더 연결 전에는 가능 시간을 읽거나 등록 후보를 만든 것처럼 표시하지 않고 연결 복구에서 멈춥니다.",
    corePipelineLabel: WORK_AUTOMATION_CORE_PIPELINE_LABEL,
    requestedScheduleCandidate: true,
    pipeline: [
      {
        id: "mail_or_inquiry_check",
        label: "관련 메일/문의 맥락",
        detail: input.mailReady ? "연결된 메일 맥락을 읽기 전용으로 참고 가능" : "메일 맥락은 선택 연결, 없으면 사용자가 준 문장만 사용",
        state: input.mailReady ? "ready" : "locked",
        ...(input.mailReady ? {} : {
          blockedUntilLabel: "메일 연결 시 관련 문의 맥락 추가 확인",
        }),
      },
      {
        id: "reply_draft",
        label: "초대/안내 문구 초안",
        detail: input.calendarReady ? "외부 발송 전 확인할 안내 문구만 생성" : "캘린더 가능 시간 확인 전에는 안내 문구만 보류",
        state: input.calendarReady ? "ready" : "blocked",
        ...(input.calendarReady ? {} : {
          requiresConnectionIds: ["calendar" as const],
          blockedUntilLabel: "캘린더 연결 후 가능 시간 확인",
        }),
      },
      {
        id: "schedule_candidate",
        label: "일정 후보",
        detail: input.calendarReady ? "캘린더 가능 시간 후보 확인" : "캘린더 연결 전에는 가능 시간을 읽은 척하지 않음",
        state: input.calendarReady ? "ready" : "blocked",
        ...(input.calendarReady ? {} : {
          requiresConnectionIds: ["calendar" as const],
          blockedUntilLabel: "캘린더 연결 후 가능 시간 후보 확인",
        }),
      },
      {
        id: "approval_queue",
        label: "승인함",
        detail: "등록, 초대, 공유는 승인함 최종 확인 전까지 잠금",
        state: "approval",
      },
      {
        id: "execution_log",
        label: "실행 로그",
        detail: "가능 시간 확인, 후보, 승인, 실행 결과를 추적",
        state: "locked",
      },
    ],
    connectionRequiredIds,
    connectionGateLabel: connectionGateLabel(connectionRequiredIds),
    candidateCreationBlockedUntilConnections: connectionRequiredIds.length > 0,
    blockedCandidateStepIds,
    approvalBoundary: WORK_AUTOMATION_APPROVAL_BOUNDARY,
    executionLogLabel: "실행 로그와 일정 승인 기록에 남김",
    repeatWorkDefaultOff: true,
    fakeReadBlocked: true,
    fakeExecutionBlocked: true,
    externalMutation: false,
    finalUserConfirmationRequired: true,
  };
}

function createRepeatAutomationPlan(input: {
  mailReady: boolean;
  calendarReady: boolean;
  repeatEnabled?: boolean;
}): WorkAutomationEnginePlan {
  const connectionRequiredIds = [
    ...(input.mailReady ? [] : ["mail" as const]),
    ...(input.calendarReady ? [] : ["calendar" as const]),
  ];
  const blockedCandidateStepIds: WorkAutomationPipelineStepId[] = input.repeatEnabled ? [] : ["repeat_check_queue"];
  return {
    intent: "repeat",
    label: "반복 업무 자동화",
    summary: "반복 업무는 저장만으로 실행하지 않고 기본 꺼짐으로 보관한 뒤 사용자가 켠 경우에만 점검합니다.",
    corePipelineLabel: WORK_AUTOMATION_CORE_PIPELINE_LABEL,
    requestedScheduleCandidate: false,
    pipeline: [
      {
        id: "repeat_rule_saved_off",
        label: "반복 후보 저장",
        detail: "규칙은 기본 꺼짐 상태로 저장",
        state: "locked",
      },
      {
        id: "repeat_user_enable_gate",
        label: "사용자 켜기",
        detail: input.repeatEnabled ? "사용자가 켠 반복 업무만 점검" : "사용자가 켜기 전까지 점검하지 않음",
        state: input.repeatEnabled ? "ready" : "locked",
      },
      {
        id: "repeat_check_queue",
        label: "반복 점검",
        detail: "필요 연결과 후보 결과만 확인",
        state: input.repeatEnabled ? "ready" : "locked",
        ...(input.repeatEnabled ? {} : {
          blockedUntilLabel: "사용자가 반복 업무를 켠 뒤 점검",
        }),
      },
      {
        id: "approval_queue",
        label: "승인함",
        detail: "외부 실행은 승인함 최종 확인 전까지 잠금",
        state: "approval",
      },
      {
        id: "execution_log",
        label: "실행 로그",
        detail: "점검, 승인, 실행 결과를 추적",
        state: "locked",
      },
    ],
    connectionRequiredIds,
    connectionGateLabel: connectionGateLabel(connectionRequiredIds),
    candidateCreationBlockedUntilConnections: false,
    blockedCandidateStepIds,
    approvalBoundary: WORK_AUTOMATION_APPROVAL_BOUNDARY,
    executionLogLabel: "실행 로그와 반복 점검 기록에 남김",
    repeatWorkDefaultOff: true,
    fakeReadBlocked: true,
    fakeExecutionBlocked: true,
    externalMutation: false,
    finalUserConfirmationRequired: true,
  };
}

function createDocumentDraftAutomationPlan(): WorkAutomationEnginePlan {
  return {
    intent: "document_draft",
    label: "문서 초안 자동화",
    summary: "문서 요청은 사용자가 고른 자료와 양식 범위에서만 초안 후보를 만들고 저장, 공유, 제출은 승인 전까지 잠급니다.",
    corePipelineLabel: "자료 범위 확인 -> 문서/보고서 초안 -> 승인함 -> 실행 로그",
    requestedScheduleCandidate: false,
    pipeline: [
      {
        id: "document_source_check",
        label: "자료 범위 확인",
        detail: "사용자가 고른 파일, 붙여넣은 텍스트, 기존 양식만 읽기 전용으로 확인",
        state: "ready",
        proofLabel: "selected_documents_or_user_pasted_text_only",
      },
      {
        id: "document_draft_candidate",
        label: "문서/보고서 초안",
        detail: "저장이나 공유 없이 초안 후보만 생성",
        state: "ready",
        proofLabel: "draft_candidate_before_file_mutation",
      },
      {
        id: "approval_queue",
        label: "승인함",
        detail: "파일 저장, 외부 공유, 제출은 승인함 최종 확인 전까지 잠금",
        state: "approval",
      },
      {
        id: "execution_log",
        label: "실행 로그",
        detail: "자료 범위, 초안 후보, 승인 결정을 추적",
        state: "locked",
      },
    ],
    connectionRequiredIds: [],
    connectionGateLabel: "자료 범위 확인됨: 사용자가 고른 자료와 양식만 읽고 저장/공유/제출은 승인 전 잠금",
    candidateCreationBlockedUntilConnections: false,
    blockedCandidateStepIds: [],
    approvalBoundary: WORK_AUTOMATION_APPROVAL_BOUNDARY,
    executionLogLabel: "자료 범위, 초안 후보, 저장/공유 승인 여부를 실행 로그에 남김",
    repeatWorkDefaultOff: true,
    fakeReadBlocked: true,
    fakeExecutionBlocked: true,
    externalMutation: false,
    finalUserConfirmationRequired: true,
  };
}

function createFolderTidyAutomationPlan(): WorkAutomationEnginePlan {
  return {
    intent: "folder_tidy",
    label: "폴더 정리 자동화",
    summary: "파일/폴더 요청은 사용자가 선택한 범위에서 정리 후보와 변경 전 미리보기만 만들고 이동, 삭제, 이름 변경은 승인 전까지 잠급니다.",
    corePipelineLabel: "선택 범위 확인 -> 정리 후보 -> 변경 전 미리보기 -> 승인함 -> 실행 로그",
    requestedScheduleCandidate: false,
    pipeline: [
      {
        id: "folder_scope_check",
        label: "폴더 범위 확인",
        detail: "사용자가 선택한 폴더 범위만 읽기 전용으로 확인",
        state: "ready",
        proofLabel: "selected_folder_scope_read_only",
      },
      {
        id: "folder_tidy_candidate",
        label: "정리 후보",
        detail: "이동, 삭제, 이름 변경 없이 정리 계획과 제외 항목만 생성",
        state: "ready",
        proofLabel: "dry_run_tidy_candidate_before_mutation",
      },
      {
        id: "approval_queue",
        label: "승인함",
        detail: "파일 이동, 삭제, 이름 변경은 승인함 최종 확인 전까지 잠금",
        state: "approval",
      },
      {
        id: "execution_log",
        label: "실행 로그",
        detail: "정리 계획, 제외 항목, 승인 결정을 추적",
        state: "locked",
      },
    ],
    connectionRequiredIds: [],
    connectionGateLabel: "폴더 범위 확인됨: 사용자가 고른 폴더만 읽고 이동/삭제/이름 변경은 승인 전 잠금",
    candidateCreationBlockedUntilConnections: false,
    blockedCandidateStepIds: [],
    approvalBoundary: WORK_AUTOMATION_APPROVAL_BOUNDARY,
    executionLogLabel: "정리 계획, 제외 항목, 적용/되돌리기 결정을 실행 로그에 남김",
    repeatWorkDefaultOff: true,
    fakeReadBlocked: true,
    fakeExecutionBlocked: true,
    externalMutation: false,
    finalUserConfirmationRequired: true,
  };
}

export function formatWorkAutomationPlanLines(plan: WorkAutomationEnginePlan) {
  return [
    `자동화 파이프라인: ${plan.corePipelineLabel}`,
    plan.summary,
    plan.connectionGateLabel,
    plan.candidateCreationBlockedUntilConnections
      ? `연결 전 차단 단계: ${plan.blockedCandidateStepIds.join(", ")}`
      : "",
    plan.intent === "repeat" && plan.repeatWorkDefaultOff ? WORK_AUTOMATION_REPEAT_DEFAULT_OFF : "",
    plan.approvalBoundary,
    plan.executionLogLabel,
  ].filter(Boolean);
}

export function createMailInquiryRuntimeEvidence(input: {
  messageCount?: number;
  approvalQueueCount?: number;
  replyDraftCount?: number;
  scheduleCandidateCount?: number;
  calendarBusyWindowCount?: number;
  approvalPreviews?: Array<{
    type?: string;
    kind?: string;
    status?: string;
  }>;
  stats?: {
    replyCandidates?: number;
    calendarCandidates?: number;
    approvalCandidates?: number;
  };
}): WorkAutomationRuntimeEvidence {
  const approvalPreviews = input.approvalPreviews ?? [];
  const countByPreviewKind = (patterns: RegExp[]) =>
    approvalPreviews.filter((preview) => {
      const value = `${preview.type ?? ""} ${preview.kind ?? ""}`.toLowerCase();
      return patterns.some((pattern) => pattern.test(value));
    }).length;
  const previewReplyDraftCount = countByPreviewKind([/reply/u, /draft/u]);
  const previewScheduleCandidateCount = countByPreviewKind([/calendar/u, /schedule/u]);
  const replyDraftCount =
    normalizeEvidenceCount(input.replyDraftCount) ??
    (previewReplyDraftCount > 0 ? previewReplyDraftCount : normalizeEvidenceCount(input.stats?.replyCandidates) ?? 0);
  const scheduleCandidateCount =
    normalizeEvidenceCount(input.scheduleCandidateCount) ??
    (previewScheduleCandidateCount > 0
      ? previewScheduleCandidateCount
      : normalizeEvidenceCount(input.stats?.calendarCandidates) ?? normalizeEvidenceCount(input.calendarBusyWindowCount) ?? 0);
  const approvalQueueCount =
    normalizeEvidenceCount(input.approvalQueueCount) ??
    normalizeEvidenceCount(input.stats?.approvalCandidates) ??
    approvalPreviews.length;
  const mailMessageCount = normalizeEvidenceCount(input.messageCount) ?? 0;
  return {
    basis: "mail_work_intake_result",
    evidenceContract: WORK_AUTOMATION_RUNTIME_EVIDENCE_CONTRACT,
    routingContract: WORK_AUTOMATION_CONVERSATION_ROUTING_CONTRACT,
    approvalGateContract: WORK_AUTOMATION_APPROVAL_GATE_CONTRACT,
    liveReadinessContract: WORK_AUTOMATION_LIVE_READINESS_CONTRACT,
    mailMessageCount,
    replyDraftCount,
    scheduleCandidateCount,
    approvalQueueCount,
    executionLogReady: approvalQueueCount > 0 || mailMessageCount > 0 || replyDraftCount > 0 || scheduleCandidateCount > 0,
    proofLabel: "실제 runMailWorkIntake 결과와 approvalPreviews 기준",
  };
}

export function formatMailInquiryRuntimeEvidenceLines(evidence: WorkAutomationRuntimeEvidence) {
  return [
    `실제 인테이크 증거 계약: ${evidence.evidenceContract}`,
    `대화 라우팅 증거: ${evidence.routingContract} -> ${evidence.basis}`,
    `승인 게이트 증거: ${evidence.approvalGateContract}`,
    `live readiness 증거: ${evidence.liveReadinessContract}`,
    `실제 인테이크 증거: 메일 ${evidence.mailMessageCount}건 · 답장 초안 ${evidence.replyDraftCount}건 · 일정 후보 ${evidence.scheduleCandidateCount}건 · 승인함 ${evidence.approvalQueueCount}건`,
    evidence.executionLogReady
      ? "실행 로그 증거: 승인 전 대기 로그만 표시하고 외부 실행은 하지 않음"
      : "실행 로그 증거: 실제 인테이크 결과가 없어서 대기 상태만 표시",
  ];
}

export function createMailOpsWorkQueueAutomationEvidence(input: {
  records: Array<{
    title?: string;
    category?: string;
    decision?: "approve" | "revise" | "hold" | "exclude";
    previewId?: string;
    finalConfirmationRoute?: "included" | "held" | "excluded";
    externalMutation?: boolean;
  }>;
}): WorkAutomationMailOpsWorkQueueEvidence {
  const records = input.records.filter((record) => record && record.externalMutation === false);
  const approvedRecords = records.filter((record) => record.decision === "approve");
  const reviewCount = records.filter((record) => record.decision === "revise" || record.decision === "hold").length;
  const excludedCount = records.filter((record) => record.decision === "exclude").length;
  const finalReadyRecords = approvedRecords.filter(
    (record) => Boolean(record.previewId) || record.finalConfirmationRoute === "included",
  );
  const composedCount = records.filter((record) => record.category === "composed").length;

  return {
    basis: "mailops_work_queue_review_records",
    evidenceContract: WORK_AUTOMATION_WORK_QUEUE_HANDOFF_CONTRACT,
    enginePathContract: WORK_AUTOMATION_MAILOPS_ENGINE_PATH,
    approvalGateContract: WORK_AUTOMATION_APPROVAL_GATE_CONTRACT,
    total: records.length,
    approvedCount: approvedRecords.length,
    reviewCount,
    excludedCount,
    finalReadyCount: finalReadyRecords.length,
    composedCount,
    nextFinalTitle: finalReadyRecords[0]?.title ?? "missing",
    externalMutation: false,
    proofLabel: WORK_AUTOMATION_MAILOPS_WORK_QUEUE_PROOF_LABEL,
  };
}

export function formatMailOpsWorkQueueAutomationEvidenceLines(evidence: WorkAutomationMailOpsWorkQueueEvidence) {
  return [
    `업무대장 자동화 증거 계약: ${evidence.evidenceContract}`,
    `자동화 엔진 경로: ${evidence.enginePathContract}`,
    `승인 게이트 증거: ${evidence.approvalGateContract}`,
    `업무대장 증거: 전체 ${evidence.total}건 · 승인 ${evidence.approvedCount}건 · 수정/확인 ${evidence.reviewCount}건 · 제외 ${evidence.excludedCount}건 · 마지막 확인 ${evidence.finalReadyCount}건 · 작성 메일 점검 ${evidence.composedCount}건`,
    `다음 마지막 확인: ${evidence.nextFinalTitle === "missing" ? "대기 없음" : evidence.nextFinalTitle}`,
    `외부 실행 증거: ${evidence.externalMutation}`,
    evidence.proofLabel,
  ];
}

function normalizeEvidenceCount(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function connectionGateLabel(connectionRequiredIds: Array<"mail" | "calendar">) {
  if (!connectionRequiredIds.length) return "필요 연결 확인됨: 읽기 전용 확인과 후보 생성 가능";
  return `필요 연결 전 멈춤: ${connectionRequiredIds.map((id) => (id === "mail" ? "메일" : "캘린더")).join(", ")} 연결 후 같은 요청 이어가기`;
}
