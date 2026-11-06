import type { AITeammate } from "./ai-teammates";
import { getDefaultCrewCharacterIdForRole } from "./crew-character-catalog";
import type { SelectedWorkActionEvent } from "./selected-work-action-events";
import { createMailOpsWorkQueueAutomationEvidence } from "./work-automation-engine";

export type VirtualOfficeWorkerStatus =
  | "idle"
  | "unknown"
  | "connection_required"
  | "reading"
  | "analyzing"
  | "drafting"
  | "problem_solving"
  | "approval_pending"
  | "completed"
  | "failed";

export type VirtualOfficeRunSignal = {
  phase: "idle" | "checking" | "connecting" | "toolchain" | "generating" | "syncing";
  detail: string;
};

export type VirtualOfficeWorkKind =
  | "mail"
  | "calendar"
  | "document"
  | "repeat"
  | "approval"
  | "desktop"
  | "ai_runtime"
  | "memory"
  | "release"
  | "general";

export type VirtualOfficeEvidenceKind =
  | "selected_work_event"
  | "live_run_signal"
  | "runtime_gate"
  | "idle_no_event";

export type VirtualOfficeWorkerEvent = {
  id: string;
  teammateId: string;
  workerName: string;
  channelName: string;
  teamLabel: string;
  status: VirtualOfficeWorkerStatus;
  statusLabel: string;
  statusSourceLabel: string;
  evidenceLabel: string;
  detail: string;
  workLabel: string;
  workKind: VirtualOfficeWorkKind;
  stageLabel: string;
  queueLabel: string;
  metricEvidenceLabel: string;
  workPipelineLabel: string;
  nextUserActionLabel: string;
  blockerLabel: string;
  safetyBoundaryLabel: string;
  primaryAction: "open_office" | "external_accounts" | "connect_ai" | "automation_log" | "none";
  primaryActionLabel: string;
  source: "live_run" | "work_event" | "last_done" | "runtime_gate" | "idle";
  eventEvidenceKind: VirtualOfficeEvidenceKind;
  activeMotionAllowed: boolean;
  stateIntegrityLabel: string;
  eventId?: string;
  updatedAt?: string;
  releaseProgression?: {
    activeGateId: string;
    activeCommand: string;
    activeProofNeeded: string;
    activeMatchesNextStep: boolean;
    completedGateCount: number;
    waitingGateCount: number;
    fakePassBlocked: boolean;
    autoAdvanceRequiresActualReportStatus: boolean;
    blockedByActualEvidenceOnly: boolean;
  };
  releaseUnblockStatusRows?: Array<{
    id: string;
    label: string;
    defaultPathLabel: string;
    status: string;
    command: string;
    reportPath: string;
    recoveryChoicesLabel?: string;
    recoveryResumeLabel?: string;
    recoveryDoneLabel?: string;
    runtimeTrackStatus?: string;
  }>;
  mailOpsWorkQueueReviewSummary?: {
    total: number;
    approve: number;
    finalReady: number;
    finalRemaining: number;
    review: number;
    exclude: number;
    replyRequiredCount: number;
    calendarCandidateCount: number;
    followUpCandidateCount: number;
    mobileHandoffCount: number;
    oneLineStatusLabel: string;
    triageDistributionLabel: string;
    context: string;
    proofChain: string;
    titlesLabel: string;
    nextFinalTitle: string;
    decisionReasonLabel: string;
    sendCheckLabel: string;
    finalRouteLabel: string;
    workbenchStageLabel: string;
    workbenchActionLabel: string;
    workerStateEvidenceLabel: string;
    editedDraftCount: number;
    composedCount: number;
    workAutomationEvidenceContract: string;
    enginePathContract: string;
    approvalGateContract: string;
    automationProofLabel: string;
    workerStatePath: string;
    mobileApprovalCandidateCount: number;
    mobileApprovalNextTitle: string;
    mobileApprovalDigestLabel: string;
    mobileApprovalBoundaryLabel: string;
    mobileApprovalEventPath: string;
    mobileApprovalChannelContract: string;
    mobileApprovalChannelReadinessLabel: string;
    mobileApprovalOutboundDraftCount: number;
    mobileApprovalOutboundDraftContract: string;
    mobileApprovalOutboundDispatchBoundary: string;
    mobileDecisionRailLabel: string;
    mobileDecisionReplyContract: string;
    mobileDecisionTargetLabel: string;
    mobileDecisionOptionsLabel: string;
    mobileDecisionReturnPathLabel: string;
    mobileDecisionEventPath: string;
    externalMutation: false;
  };
  mobileMailShareSummary?: {
    messageCount: number;
    batchCount: number;
    representativeTitle: string;
    digestLabel: string;
    eventPath: string;
    finalBoundary: string;
    externalMutation: false;
  };
  approvalDecisionReceiptSummary?: {
    label: string;
    path: string;
    proofChain: string;
    auditId: string;
    previewTitle: string;
    finalActionWorkItemId: string;
    finalConfirmationState: string;
    finalConfirmationTitle: string;
    finalConfirmationNextAction: string;
    mailOpsReviewDecision: string;
    externalMutation: false;
  };
};

const MAIL_OPS_WORK_QUEUE_PROOF_CHAIN =
  "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log";
const MAIL_OPS_WORK_QUEUE_AUTOMATION_HANDOFF_CONTRACT =
  "work_queue_review_to_work_automation_engine_handoff";
const MAIL_OPS_WORK_QUEUE_AUTOMATION_ENGINE_PATH =
  "mail_intake_to_work_queue_review_to_approval_engine_to_final_confirmation_to_execution_log";
const MAIL_OPS_WORK_QUEUE_APPROVAL_GATE_CONTRACT =
  "dry_run_receipt_connector_readiness_final_presence";
const MAIL_OPS_WORKER_STATE_PATH =
  "reading_to_analyzing_to_drafting_to_approval_pending_to_execution_log";
const MAIL_OPS_MOBILE_APPROVAL_EVENT_PATH =
  "mailops_work_queue_to_mobile_digest_to_app_final_confirmation";
const MAIL_OPS_MOBILE_APPROVAL_BOUNDARY =
  "휴대폰 알림은 한 줄 요약만, 실제 메일 전송/일정 등록/파일 공유는 앱 최종 확인";
const MAIL_OPS_MOBILE_APPROVAL_CHANNEL_CONTRACT =
  "app_inbox_ready_external_push_requires_messenger_channel";
const MAIL_OPS_MOBILE_APPROVAL_CHANNEL_READINESS =
  "앱 내부 승인함 준비 · 외부 휴대폰 알림은 메신저 채널 연결 필요";
const MAIL_OPS_MOBILE_APPROVAL_OUTBOUND_DRAFT_CONTRACT =
  "approval_digest_to_outbound_notification_draft_queue";
const MAIL_OPS_MOBILE_APPROVAL_OUTBOUND_DISPATCH_BOUNDARY =
  "외부 알림 발송은 연결된 채널과 사용자 버튼이 필요하며 실제 메일 실행은 앱 최종 확인";
const MAIL_OPS_MOBILE_DECISION_REPLY_CONTRACT =
  "phone_reply_code_to_same_notification_target_then_app_final_confirmation";
const MAIL_OPS_MOBILE_DECISION_EVENT_PATH =
  "mobile_notification_reply_to_channel_decision_to_virtual_office_event_to_final_confirmation";
const MAIL_OPS_MOBILE_DECISION_OPTIONS_LABEL =
  "승인 A1 / 수정 A1 내용 / 보류 A1 / 거절 A1";

export type VirtualOfficeLastDoneRecord = {
  detail: string;
  eventId: string;
  updatedAt?: string;
};

export type VirtualOfficeEventBusSnapshot = {
  id: string;
  generatedAt: string;
  workers: VirtualOfficeWorkerEvent[];
  activeCount: number;
  blockedCount: number;
  approvalCount: number;
  idleCount: number;
  eventBackedWorkerCount: number;
  sourceContract: "selectedWorkActionEvents_workerRuns_runtimeGate_only";
  motionContract: "active_motion_requires_work_event_or_live_run";
  integrityContract: "idle_runtime_gate_last_done_never_active_motion";
};

export type ReleaseReadinessVirtualOfficeInput = {
  id?: string;
  teammateId?: string;
  createdAt?: string;
  finalStatus?: string;
  reportPath?: string;
  aiRuntimeLiveUnblockStatus?: string;
  releaseLiveSmokeUnblockStatus?: string;
  releaseLiveSmokeRecoveryChoicesLabel?: string;
  releaseLiveSmokeRecoveryResumeLabel?: string;
  releaseLiveSmokeRecoveryDoneLabel?: string;
  releaseLiveSmokeRuntimeTrackStatus?: string;
  firstUserObservationUnblockStatus?: string;
  firstUserObservationRecoveryChoicesLabel?: string;
  firstUserObservationRecoveryResumeLabel?: string;
  firstUserObservationRecoveryDoneLabel?: string;
  firstUserObservationRuntimeTrackStatus?: string;
  aiRuntimeLiveRecoveryChoicesLabel?: string;
  aiRuntimeLiveRecoveryResumeLabel?: string;
  aiRuntimeLiveRecoveryDoneLabel?: string;
  aiRuntimeLiveRuntimeTrackStatus?: string;
  blockers?: string[];
  commandResults?: Array<{
    id?: string;
    label?: string;
    actualStatus?: string;
    requiredStatus?: string;
    passed?: boolean;
    reportPath?: string;
  }>;
  progressionProofChain?: {
    activeGateId?: string;
    activeCommand?: string;
    activeProofNeeded?: string;
    activeMatchesNextStep?: boolean;
    completedGateIds?: string[];
    waitingGateIds?: string[];
    fakePassBlocked?: boolean;
    autoAdvanceRequiresActualReportStatus?: boolean;
    blockedByActualEvidenceOnly?: boolean;
  };
};

export type MailOpsWorkQueueReviewVirtualOfficeInput = {
  teammateId: string;
  teammateName?: string;
  createdAt?: string;
  records: Array<{
    itemId: string;
    title: string;
    category: string;
    decision: "approve" | "revise" | "hold" | "exclude";
    note?: string;
    previewId?: string;
    decisionReasonSummary?: string;
    sendCheckSummary?: string;
    finalConfirmationRoute?: "included" | "held" | "excluded";
    draftBodySource?: "user_revised_draft" | "review_note" | "approval_preview" | "classification";
    revisedDraft?: string;
    updatedAt?: string;
    approvalContext: string;
    externalMutation: false;
  }>;
};

export function createReleaseReadinessVirtualOfficeEvent(
  input: ReleaseReadinessVirtualOfficeInput,
): SelectedWorkActionEvent {
  const blockers = Array.isArray(input.blockers) ? input.blockers.filter(Boolean) : [];
  const commandResults = Array.isArray(input.commandResults) ? input.commandResults : [];
  const blockedChecks = commandResults.filter((result) => result?.passed === false);
  const blocked = blockers.length > 0 || blockedChecks.length > 0 || input.finalStatus !== "release_final_ready";
  const createdAt = sanitizeVirtualOfficeIso(input.createdAt);
  const blockerCount = blockers.length || blockedChecks.length;
  const label = blocked ? "릴리즈 언락 막힘" : "릴리즈 언락 준비 완료";
  const detail = blocked
    ? "실계정 live smoke, AI live 답변, 첫 사용자 관찰 중 아직 풀리지 않은 blocker가 있습니다."
    : "실계정 live smoke, AI live 답변, 첫 사용자 관찰과 연결 복구 증거가 준비됐습니다.";
  const statusDetail = commandResults
    .map((result) => `${result.id ?? result.label ?? "check"}:${result.actualStatus ?? "missing"}`)
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const progressionProofChain = input.progressionProofChain;
  const activeGateId = stringOrDefault(progressionProofChain?.activeGateId, blockedChecks[0]?.id ?? "release_final_readiness");
  const activeCommand = stringOrDefault(progressionProofChain?.activeCommand, blockedChecks[0]?.reportPath ?? input.reportPath ?? "tmp/release-final-readiness-report.json");
  const activeProofNeeded = stringOrDefault(progressionProofChain?.activeProofNeeded, blocked ? "actual_required_status_report" : "release_final_ready");
  const completedGateCount = Array.isArray(progressionProofChain?.completedGateIds) ? progressionProofChain.completedGateIds.length : 0;
  const waitingGateCount = Array.isArray(progressionProofChain?.waitingGateIds) ? progressionProofChain.waitingGateIds.length : 0;
  const activeMatchesNextStep = progressionProofChain?.activeMatchesNextStep === true;
  const blockedByActualEvidenceOnly = progressionProofChain?.blockedByActualEvidenceOnly === true;
  const progressionFakePassBlocked = progressionProofChain?.fakePassBlocked === true;
  const autoAdvanceRequiresActualReportStatus = progressionProofChain?.autoAdvanceRequiresActualReportStatus === true;
  const progressionEvidenceLabel = `active gate ${activeGateId} · actual evidence only ${blockedByActualEvidenceOnly ? "true" : "false"}`;

  return {
    id: input.id ?? `release-readiness-${createdAt.replaceAll(/[^0-9]/g, "").slice(0, 14)}`,
    workItemId: `ai-teammate:${input.teammateId ?? "teammate-personal-operator"}`,
    label,
    detail,
    status: blocked ? "error" : "done",
    createdAt,
    updatedAt: createdAt,
    evidence: input.reportPath ?? "tmp/release-final-readiness-report.json",
    kind: "release_readiness",
    sourceLabel: "릴리즈 게이트",
    metrics: {
      teammateId: input.teammateId ?? "teammate-personal-operator",
      virtualOfficeStatus: blocked ? "failed" : "completed",
      virtualOfficeWorkKind: "release",
      virtualOfficeStageLabel: blocked ? "출시 blocker" : "출시 준비",
      virtualOfficeQueueLabel: blocked ? `남은 blocker ${blockerCount}개` : "최종 게이트 통과",
      virtualOfficeMetricEvidenceLabel: blocked
        ? `릴리즈 blocker ${blockerCount}개 · fake pass 차단 · ${progressionEvidenceLabel}`
        : `live 증거 확인 · 사람 관찰 확인 · ${progressionEvidenceLabel}`,
      virtualOfficeNextUserActionLabel: blocked ? "현장 가이드 순서대로 live 키/계정/관찰 기록 진행" : "최종 패키지 생성 전 재검증",
      virtualOfficeSafetyBoundaryLabel: "secret 저장 없음, fake pass 없음, 외부 실행 없음",
      releaseProgressionActiveGateId: activeGateId,
      releaseProgressionActiveCommand: activeCommand,
      releaseProgressionActiveProofNeeded: activeProofNeeded,
      releaseProgressionActiveMatchesNextStep: activeMatchesNextStep,
      releaseProgressionCompletedGateCount: completedGateCount,
      releaseProgressionWaitingGateCount: waitingGateCount,
      releaseProgressionBlockedByActualEvidenceOnly: blockedByActualEvidenceOnly,
      releaseProgressionFakePassBlocked: progressionFakePassBlocked,
      releaseProgressionAutoAdvanceRequiresActualReportStatus: autoAdvanceRequiresActualReportStatus,
      releaseBlockerCount: blockerCount,
      releaseFinalGate: input.finalStatus ?? "missing",
      aiRuntimeLiveUnblockStatus: input.aiRuntimeLiveUnblockStatus ?? "missing",
      aiRuntimeLiveRecoveryChoicesLabel: input.aiRuntimeLiveRecoveryChoicesLabel ?? "",
      aiRuntimeLiveRecoveryResumeLabel: input.aiRuntimeLiveRecoveryResumeLabel ?? "",
      aiRuntimeLiveRecoveryDoneLabel: input.aiRuntimeLiveRecoveryDoneLabel ?? "",
      aiRuntimeLiveRuntimeTrackStatus: input.aiRuntimeLiveRuntimeTrackStatus ?? "",
      releaseLiveSmokeUnblockStatus: input.releaseLiveSmokeUnblockStatus ?? "missing",
      releaseLiveSmokeRecoveryChoicesLabel: input.releaseLiveSmokeRecoveryChoicesLabel ?? "",
      releaseLiveSmokeRecoveryResumeLabel: input.releaseLiveSmokeRecoveryResumeLabel ?? "",
      releaseLiveSmokeRecoveryDoneLabel: input.releaseLiveSmokeRecoveryDoneLabel ?? "",
      releaseLiveSmokeRuntimeTrackStatus: input.releaseLiveSmokeRuntimeTrackStatus ?? "",
      firstUserObservationUnblockStatus: input.firstUserObservationUnblockStatus ?? "missing",
      firstUserObservationRecoveryChoicesLabel: input.firstUserObservationRecoveryChoicesLabel ?? "",
      firstUserObservationRecoveryResumeLabel: input.firstUserObservationRecoveryResumeLabel ?? "",
      firstUserObservationRecoveryDoneLabel: input.firstUserObservationRecoveryDoneLabel ?? "",
      firstUserObservationRuntimeTrackStatus: input.firstUserObservationRuntimeTrackStatus ?? "",
      externalMutation: false,
      fakePassBlocked: blocked,
    },
    auditTrail: [
      input.reportPath ? `report:${input.reportPath}` : "report:tmp/release-final-readiness-report.json",
      statusDetail ? `checks:${statusDetail}` : "checks:missing",
      blocked ? "result:blocked" : "result:ready",
    ],
  };
}

export function createMailOpsWorkQueueReviewVirtualOfficeEvent(
  input: MailOpsWorkQueueReviewVirtualOfficeInput,
): SelectedWorkActionEvent {
  const records = input.records.filter((record) => record && record.externalMutation === false).slice(0, 40);
  const approveCount = records.filter((record) => record.decision === "approve").length;
  const reviseCount = records.filter((record) => record.decision === "revise").length;
  const holdCount = records.filter((record) => record.decision === "hold").length;
  const excludeCount = records.filter((record) => record.decision === "exclude").length;
  const reviewCount = reviseCount + holdCount;
  const finalReadyRecords = records.filter((record) => record.decision === "approve" && record.previewId);
  const finalReadyCount = finalReadyRecords.length;
  const nextFinalTitle = finalReadyRecords[0]?.title ?? "";
  const mobileApprovalCandidateCount = Math.min(finalReadyRecords.length, 3);
  const mobileApprovalNextTitle = finalReadyRecords[0]?.title ?? "";
  const mobileApprovalDigestLabel = mobileApprovalCandidateCount
    ? `휴대폰 한 줄 요약 ${mobileApprovalCandidateCount}건 · 다음 ${mobileApprovalNextTitle}`
    : "휴대폰으로 보낼 승인 후보 없음";
  const mobileDecisionRailLabel = mobileApprovalCandidateCount
    ? `휴대폰 결정 대기 ${mobileApprovalCandidateCount}건 · A번호로 같은 후보에 반영`
    : "휴대폰 결정 대기 없음";
  const mobileDecisionTargetLabel = mobileApprovalCandidateCount
    ? `A1-${mobileApprovalCandidateCount} · ${mobileApprovalNextTitle || "승인 후보"}`
    : "대상 없음";
  const mobileDecisionReturnPathLabel = mobileApprovalCandidateCount
    ? "휴대폰 답장 -> 메신저 결정 기록 -> 앱 승인함 -> 마지막 확인"
    : "메일 작업대 승인 후보 생성 후 휴대폰 결정 가능";
  const finalRemainingCount = Math.max(finalReadyCount - 1, 0);
  const composedCount = records.filter((record) => record.category === "composed").length;
  const calendarCount = records.filter((record) => isMailOpsCalendarRecord(record)).length;
  const followUpCount = records.filter((record) => isMailOpsFollowUpRecord(record)).length;
  const mobileHandoffCount = records.filter((record) => isMailOpsMobileHandoffRecord(record)).length;
  const replyRequiredCount = records.filter((record) => isMailOpsReplyRequiredRecord(record)).length;
  const triageDistributionLabel = [
    `답장 ${replyRequiredCount}건`,
    `수정/확인 ${reviewCount}건`,
    `제외 ${excludeCount}건`,
    `일정 ${calendarCount}건`,
    `후속 ${followUpCount}건`,
    `휴대폰 ${mobileHandoffCount}건`,
    `작성 ${composedCount}건`,
  ].join(" · ");
  const oneLineStatusLabel = [
    `메일 ${records.length}건 선별`,
    `답장 ${replyRequiredCount}건`,
    `수정/확인 ${reviewCount}건`,
    `제외 ${excludeCount}건`,
    `최종 확인 ${finalReadyCount}건`,
    "전송 잠금",
  ].join(" · ");
  const editedDraftCount = records.filter(
    (record) => record.draftBodySource === "user_revised_draft" || Boolean(record.revisedDraft?.trim()),
  ).length;
  const automationEvidence = createMailOpsWorkQueueAutomationEvidence({ records });
  const latestUpdatedAt =
    records
      .map((record) => record.updatedAt ?? "")
      .filter(Boolean)
      .sort()
      .at(-1) ?? input.createdAt;
  const createdAt = sanitizeVirtualOfficeIso(latestUpdatedAt);
  const status = approveCount > 0 ? "approval_pending" : records.length ? "completed" : "idle";
  const reviewContext = records.find((record) => record.approvalContext)?.approvalContext ?? "missing";
  const titles = records.map((record) => record.title).filter(Boolean).slice(0, 4).join(" | ");
  const decisionReasonLabel =
    records.find((record) => record.decisionReasonSummary)?.decisionReasonSummary?.slice(0, 180) ?? "missing";
  const sendCheckLabel =
    records.find((record) => record.sendCheckSummary)?.sendCheckSummary?.slice(0, 180) ?? "missing";
  const finalRouteLabel = [
    `included:${records.filter((record) => record.finalConfirmationRoute === "included").length || finalReadyCount}`,
    `held:${records.filter((record) => record.finalConfirmationRoute === "held").length || reviewCount}`,
    `excluded:${records.filter((record) => record.finalConfirmationRoute === "excluded").length || excludeCount}`,
  ].join(" ");
  const workbenchStageLabel = approveCount
    ? editedDraftCount
      ? "선별 -> 수정본 반영 -> 승인 대기 -> 마지막 확인"
      : "선별 -> 초안 점검 -> 승인 대기 -> 마지막 확인"
    : records.length
      ? "선별 -> 수정/확인 -> 보류/제외"
      : "대기";
  const workbenchActionLabel = approveCount
    ? "메일 업무대장에서 마지막 확인 준비"
    : records.length
      ? "메일 작업대에서 수정본 저장 후 승인"
      : "메일 연결 후 메일 직원 작업함 생성";
  const workerStateEvidenceLabel =
    `업무대장 ${records.length}건 · 승인 ${approveCount}건 · 마지막 확인 가능 ${finalReadyCount}건 · 수정/확인 ${reviewCount}건 · 제외 ${excludeCount}건 · 수정본 ${editedDraftCount}건 · 작성 메일 점검 ${composedCount}건`;

  return {
    id: `mailops-work-queue-review-${input.teammateId}`,
    workItemId: `ai-teammate:${input.teammateId}`,
    label: "메일 직원 작업함 검토 반영",
    detail: approveCount
      ? `답장/일정 후보 ${approveCount}건만 승인 대기로 올리고 수정/확인 ${reviewCount}건, 제외 ${excludeCount}건은 발송에서 뺐습니다.`
      : records.length
        ? `메일 직원 작업함 검토 ${records.length}건을 반영했고 승인 없이 보류/제외 상태로 유지했습니다.`
        : "메일 직원 작업함 검토 기록이 아직 없습니다.",
    status: records.length ? "done" : "running",
    createdAt,
    updatedAt: createdAt,
    evidence: "mailOpsWorkQueueReviewRecords:local_review_to_approval_candidate_context",
    kind: "mail_intake",
    sourceLabel: "메일 직원 작업함",
    metrics: {
      teammateId: input.teammateId,
      teammateName: input.teammateName ?? "",
      virtualOfficeStatus: status,
      virtualOfficeWorkKind: "mail",
      virtualOfficeStageLabel: approveCount ? "작업함 승인 대기" : "작업함 검토",
      virtualOfficeQueueLabel: approveCount
        ? `승인 ${approveCount}건 · 수정본 ${editedDraftCount}건`
        : `검토 ${records.length}건 · 수정본 ${editedDraftCount}건`,
      virtualOfficeNextUserActionLabel: workbenchActionLabel,
      virtualOfficeSafetyBoundaryLabel: "메일 발송과 일정 등록은 최종 확인 전까지 잠김",
      virtualOfficeMetricEvidenceLabel: [
        `업무대장 ${records.length}건`,
        `승인 ${approveCount}건`,
        `마지막 확인 가능 ${finalReadyCount}건`,
        `수정/확인 ${reviewCount}건`,
        `제외 ${excludeCount}건`,
        `수정본 ${editedDraftCount}건`,
        `작성 메일 점검 ${composedCount}건`,
        decisionReasonLabel !== "missing" ? `판단 근거 ${decisionReasonLabel}` : "",
        sendCheckLabel !== "missing" ? `발송 점검 ${sendCheckLabel}` : "",
        "외부 변경 없음",
      ].filter(Boolean).join(" · "),
      workPipeline: "메일/문의 확인 -> 답장 초안 -> 작업함 검토 -> 승인함 -> 마지막 확인 -> 실행 로그",
      mailOpsWorkQueueProofChain: MAIL_OPS_WORK_QUEUE_PROOF_CHAIN,
      workAutomationEvidenceContract: automationEvidence.evidenceContract,
      workAutomationEnginePathContract: automationEvidence.enginePathContract,
      approvalEngineGateContract: automationEvidence.approvalGateContract,
      workAutomationEngineProofLabel: automationEvidence.proofLabel,
      mailOpsWorkerStatePath: MAIL_OPS_WORKER_STATE_PATH,
      approvalQueueCount: approveCount,
      messageCount: records.length,
      mailOpsWorkQueueComposedCount: composedCount,
      mailOpsWorkQueueEngineHandoffComposed: automationEvidence.composedCount,
      externalMutation: false,
      mailOpsWorkQueueTotal: records.length,
      mailOpsWorkQueueApproveCount: approveCount,
      mailOpsWorkQueueFinalReadyCount: finalReadyCount,
      mailOpsWorkQueueFinalRemainingCount: finalRemainingCount,
      mailOpsWorkQueueNextFinalTitle: nextFinalTitle,
      mailOpsWorkQueueReplyRequiredCount: replyRequiredCount,
      mailOpsWorkQueueCalendarCandidateCount: calendarCount,
      mailOpsWorkQueueFollowUpCandidateCount: followUpCount,
      mailOpsWorkQueueMobileHandoffCount: mobileHandoffCount,
      mailOpsWorkQueueOneLineStatusLabel: oneLineStatusLabel,
      mailOpsWorkQueueTriageDistributionLabel: triageDistributionLabel,
      mailOpsMobileApprovalCandidateCount: mobileApprovalCandidateCount,
      mailOpsMobileApprovalNextTitle: mobileApprovalNextTitle,
      mailOpsMobileApprovalDigestLabel: mobileApprovalDigestLabel,
      mailOpsMobileApprovalBoundaryLabel: MAIL_OPS_MOBILE_APPROVAL_BOUNDARY,
      mailOpsMobileApprovalEventPath: MAIL_OPS_MOBILE_APPROVAL_EVENT_PATH,
      mailOpsMobileApprovalChannelContract: MAIL_OPS_MOBILE_APPROVAL_CHANNEL_CONTRACT,
      mailOpsMobileApprovalChannelReadinessLabel: MAIL_OPS_MOBILE_APPROVAL_CHANNEL_READINESS,
      mailOpsMobileApprovalOutboundDraftCount: mobileApprovalCandidateCount,
      mailOpsMobileApprovalOutboundDraftContract: MAIL_OPS_MOBILE_APPROVAL_OUTBOUND_DRAFT_CONTRACT,
      mailOpsMobileApprovalOutboundDispatchBoundary: MAIL_OPS_MOBILE_APPROVAL_OUTBOUND_DISPATCH_BOUNDARY,
      mailOpsMobileDecisionRailLabel: mobileDecisionRailLabel,
      mailOpsMobileDecisionReplyContract: MAIL_OPS_MOBILE_DECISION_REPLY_CONTRACT,
      mailOpsMobileDecisionTargetLabel: mobileDecisionTargetLabel,
      mailOpsMobileDecisionOptionsLabel: MAIL_OPS_MOBILE_DECISION_OPTIONS_LABEL,
      mailOpsMobileDecisionReturnPathLabel: mobileDecisionReturnPathLabel,
      mailOpsMobileDecisionEventPath: MAIL_OPS_MOBILE_DECISION_EVENT_PATH,
      mailOpsWorkQueueDecisionReasonLabel: decisionReasonLabel,
      mailOpsWorkQueueSendCheckLabel: sendCheckLabel,
      mailOpsWorkQueueFinalRouteLabel: finalRouteLabel,
      mailOpsWorkQueueWorkbenchStageLabel: workbenchStageLabel,
      mailOpsWorkQueueWorkbenchActionLabel: workbenchActionLabel,
      mailOpsWorkQueueWorkerStateEvidenceLabel: workerStateEvidenceLabel,
      mailOpsWorkQueueEditedDraftCount: editedDraftCount,
      mailOpsWorkQueueReviseCount: reviseCount,
      mailOpsWorkQueueHoldCount: holdCount,
      mailOpsWorkQueueExcludeCount: excludeCount,
      mailOpsWorkQueueReviewCount: reviewCount,
      mailOpsWorkQueueEngineHandoffTotal: automationEvidence.total,
      mailOpsWorkQueueEngineHandoffApproved: automationEvidence.approvedCount,
      mailOpsWorkQueueEngineHandoffReview: automationEvidence.reviewCount,
      mailOpsWorkQueueEngineHandoffExcluded: automationEvidence.excludedCount,
      mailOpsWorkQueueEngineHandoffFinalReady: automationEvidence.finalReadyCount,
      mailOpsWorkQueueEngineNextFinalTitle: automationEvidence.nextFinalTitle,
      calendarCandidateCount: calendarCount,
      mailOpsQueueReviewContext: reviewContext,
      mailOpsQueueReviewTitles: titles,
      readOnly: true,
    },
    auditTrail: [
      "MailOps work queue review saved from user decisions",
      `approve:${approveCount} revise:${reviseCount} hold:${holdCount} exclude:${excludeCount}`,
      `triage:${triageDistributionLabel}`,
      `edited_draft:${editedDraftCount} composed_check:${composedCount}`,
      `final_ready:${finalReadyCount} next:${nextFinalTitle || "none"} remaining:${finalRemainingCount}`,
      `mobile_approval_digest:${mobileApprovalCandidateCount} next:${mobileApprovalNextTitle || "none"}`,
      `mobile_approval_channel:${MAIL_OPS_MOBILE_APPROVAL_CHANNEL_CONTRACT}`,
      `mobile_outbound_draft:${mobileApprovalCandidateCount} contract:${MAIL_OPS_MOBILE_APPROVAL_OUTBOUND_DRAFT_CONTRACT}`,
      `mobile_decision_reply:${MAIL_OPS_MOBILE_DECISION_REPLY_CONTRACT}`,
      `mobile_decision_path:${MAIL_OPS_MOBILE_DECISION_EVENT_PATH}`,
      `automation_handoff:${automationEvidence.evidenceContract}`,
      `engine_path:${automationEvidence.enginePathContract}`,
      `automation_proof:${automationEvidence.proofLabel}`,
      "External send/calendar mutation remains locked until final confirmation",
    ],
  };
}

export function createVirtualOfficeEventBusSnapshot(input: {
  teammates: AITeammate[];
  workerRuns: Record<string, VirtualOfficeRunSignal | undefined>;
  teammateLastDone: Record<string, VirtualOfficeLastDoneRecord | undefined>;
  selectedWorkActionEvents: SelectedWorkActionEvent[];
  aiConnected: boolean;
  desktopReady: boolean;
}): VirtualOfficeEventBusSnapshot {
  const workers = createVirtualOfficeWorkerEvents(input);
  return {
    id: `virtual-office-event-bus-${workers.map((worker) => `${worker.teammateId}:${worker.status}`).join("|")}`,
    generatedAt: new Date().toISOString(),
    workers,
    activeCount: workers.filter((worker) => worker.activeMotionAllowed).length,
    blockedCount: workers.filter((worker) => worker.status === "connection_required" || worker.status === "failed").length,
    approvalCount: workers.filter((worker) => worker.status === "approval_pending").length,
    idleCount: workers.filter((worker) => worker.status === "idle").length,
    eventBackedWorkerCount: workers.filter((worker) => worker.eventEvidenceKind === "selected_work_event" || worker.eventEvidenceKind === "live_run_signal").length,
    sourceContract: "selectedWorkActionEvents_workerRuns_runtimeGate_only",
    motionContract: "active_motion_requires_work_event_or_live_run",
    integrityContract: "idle_runtime_gate_last_done_never_active_motion",
  };
}

function isMailOpsCalendarRecord(record: MailOpsWorkQueueReviewVirtualOfficeInput["records"][number]) {
  return record.category === "calendar" || /일정|캘린더|calendar|schedule|미팅|회의/u.test(mailOpsRecordSearchText(record));
}

function isMailOpsFollowUpRecord(record: MailOpsWorkQueueReviewVirtualOfficeInput["records"][number]) {
  return /후속|리마인드|회신 대기|재안내|마감|follow[-_\s]?up|remind/u.test(mailOpsRecordSearchText(record));
}

function isMailOpsMobileHandoffRecord(record: MailOpsWorkQueueReviewVirtualOfficeInput["records"][number]) {
  return /휴대폰|모바일|폰|mobile|pwa|share/u.test(mailOpsRecordSearchText(record));
}

function isMailOpsReplyRequiredRecord(record: MailOpsWorkQueueReviewVirtualOfficeInput["records"][number]) {
  if (record.decision !== "approve") return false;
  if (record.category === "composed" || isMailOpsCalendarRecord(record) || isMailOpsMobileHandoffRecord(record)) return false;
  return record.category === "reply" || record.category === "approval" || !record.category;
}

function mailOpsRecordSearchText(record: MailOpsWorkQueueReviewVirtualOfficeInput["records"][number]) {
  return [
    record.itemId,
    record.title,
    record.category,
    record.note,
    record.decisionReasonSummary,
    record.sendCheckSummary,
    record.finalConfirmationRoute,
  ].filter(Boolean).join(" ");
}

export function createVirtualOfficeWorkerEvents(input: {
  teammates: AITeammate[];
  workerRuns: Record<string, VirtualOfficeRunSignal | undefined>;
  teammateLastDone: Record<string, VirtualOfficeLastDoneRecord | undefined>;
  selectedWorkActionEvents?: SelectedWorkActionEvent[];
  aiConnected: boolean;
  desktopReady: boolean;
}): VirtualOfficeWorkerEvent[] {
  const eventsByTeammate = groupLatestTeammateEvents(input.selectedWorkActionEvents ?? []);
  const visibleTeammates = [
    ...input.teammates,
    ...createEventOnlyTeammates({
      eventsByTeammate,
      teammates: input.teammates,
    }),
  ];
  return visibleTeammates.map((teammate) => {
    const run = input.workerRuns[teammate.id];
    const event = eventsByTeammate.get(teammate.id);
    const lastDone = input.teammateLastDone[teammate.id];
    const source = sourceForVirtualOfficeWorker({ run, event, lastDone, aiConnected: input.aiConnected, desktopReady: input.desktopReady });
    const status = inferVirtualOfficeStatus({
      run,
      event,
      lastDone,
      aiConnected: input.aiConnected,
      desktopReady: input.desktopReady,
    });
    const mailOpsWorkQueueReviewSummary = virtualOfficeMailOpsWorkQueueReviewSummary(event);
    const mobileMailShareSummary = virtualOfficeMobileMailShareSummary(event);
    const approvalDecisionReceiptSummary = virtualOfficeApprovalDecisionReceiptSummary(event);
    return {
      id: `virtual-office-${teammate.id}-${status}`,
      teammateId: teammate.id,
      workerName: teammate.name,
      channelName: teammate.channelName,
      teamLabel: teammate.teamLabel,
      status,
      statusLabel: virtualOfficeStatusLabel(status),
      statusSourceLabel: virtualOfficeSourceLabel(sourceForVirtualOfficeWorker({ run, event, lastDone, aiConnected: input.aiConnected, desktopReady: input.desktopReady })),
      evidenceLabel: virtualOfficeEvidenceLabel({ run, event, lastDone, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      detail: virtualOfficeDetail({ status, run, event, lastDone, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      workLabel: virtualOfficeWorkLabel({ status, run, event, lastDone, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      workKind: virtualOfficeWorkKind({ status, run, event, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      stageLabel: virtualOfficeStageLabel({ status, run, event }),
      queueLabel: virtualOfficeQueueLabel({ status, event, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      metricEvidenceLabel: virtualOfficeMetricEvidenceLabel(event),
      workPipelineLabel: virtualOfficeWorkPipelineLabel({ status, event }),
      nextUserActionLabel: virtualOfficeNextUserActionLabel({ status, event, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      blockerLabel: virtualOfficeBlockerLabel({ status, run, event, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      safetyBoundaryLabel: virtualOfficeSafetyBoundaryLabel({ status, event }),
      primaryAction: virtualOfficePrimaryAction({ status, event, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      primaryActionLabel: virtualOfficePrimaryActionLabel({ status, event, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      source,
      eventEvidenceKind: virtualOfficeEvidenceKind({ source, run, event, lastDone, aiConnected: input.aiConnected, desktopReady: input.desktopReady }),
      activeMotionAllowed: virtualOfficeActiveMotionAllowed({ source, status, run, event }),
      stateIntegrityLabel: virtualOfficeStateIntegrityLabel({ source, status, run, event, lastDone }),
      ...(mailOpsWorkQueueReviewSummary ? { mailOpsWorkQueueReviewSummary } : {}),
      ...(mobileMailShareSummary ? { mobileMailShareSummary } : {}),
      ...(approvalDecisionReceiptSummary ? { approvalDecisionReceiptSummary } : {}),
      ...(event?.kind === "release_readiness" ? { releaseUnblockStatusRows: virtualOfficeReleaseUnblockStatusRows(event) } : {}),
      ...(event?.kind === "release_readiness" ? { releaseProgression: virtualOfficeReleaseProgression(event) } : {}),
      ...(event
        ? { eventId: event.id, updatedAt: event.updatedAt ?? event.createdAt }
        : lastDone
          ? { eventId: lastDone.eventId, updatedAt: lastDone.updatedAt }
          : {}),
    };
  });
}

function createEventOnlyTeammates(input: {
  eventsByTeammate: Map<string, SelectedWorkActionEvent>;
  teammates: AITeammate[];
}): AITeammate[] {
  const existingIds = new Set(input.teammates.map((teammate) => teammate.id));
  const now = Date.now();
  const eventOnlyTeammates: AITeammate[] = [];
  for (const [teammateId, event] of input.eventsByTeammate) {
    if (!teammateId || existingIds.has(teammateId)) continue;
    const templateId = inferEventOnlyTeammateTemplateId(event);
    const roleTitle = stringMetric(event.metrics, "virtualOfficeStageLabel") || defaultEventOnlyRoleTitle(templateId);
    eventOnlyTeammates.push({
      id: teammateId,
      templateId,
      avatarId: getDefaultCrewCharacterIdForRole(`${templateId} ${roleTitle}`),
      name: stringMetric(event.metrics, "aiRuntimeRoleTeammateName") || defaultEventOnlyWorkerName(templateId),
      teamLabel: defaultEventOnlyTeamLabel(templateId),
      roleTitle,
      channelName: defaultEventOnlyChannelName(templateId),
      brief: "실제 업무 이벤트가 먼저 도착해 가상오피스에 표시된 담당자입니다.",
      skillIds: [],
      instructions: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  return eventOnlyTeammates;
}

function inferEventOnlyTeammateTemplateId(event: SelectedWorkActionEvent): AITeammate["templateId"] {
  const workKind = stringMetric(event.metrics, "virtualOfficeWorkKind");
  if (workKind === "mail") return "mail";
  if (workKind === "calendar") return "operations";
  if (workKind === "document") return "operations";
  if (workKind === "desktop") return "desktop";
  if (workKind === "release") return "operations";
  if (workKind === "ai_runtime") return "personal";
  return "custom";
}

function defaultEventOnlyWorkerName(templateId: AITeammate["templateId"]) {
  if (templateId === "mail") return "메일 업무 담당자";
  if (templateId === "desktop") return "내 PC 작업 담당자";
  if (templateId === "personal") return "업무 비서";
  return "업무 담당자";
}

function defaultEventOnlyTeamLabel(templateId: AITeammate["templateId"]) {
  if (templateId === "mail") return "MailOps";
  if (templateId === "desktop") return "Desktop";
  if (templateId === "personal") return "Control";
  return "Work";
}

function defaultEventOnlyRoleTitle(templateId: AITeammate["templateId"]) {
  if (templateId === "mail") return "메일 직원 작업함 연결";
  if (templateId === "desktop") return "내 PC 작업";
  if (templateId === "personal") return "AI 답변";
  return "업무 이벤트";
}

function defaultEventOnlyChannelName(templateId: AITeammate["templateId"]) {
  if (templateId === "mail") return "메일 업무실";
  if (templateId === "desktop") return "내 PC 작업실";
  if (templateId === "personal") return "개인 작업장";
  return "업무실";
}

function virtualOfficeMobileMailShareSummary(event: SelectedWorkActionEvent | undefined): VirtualOfficeWorkerEvent["mobileMailShareSummary"] | null {
  if (!event?.metrics) return null;
  const isMobileShare = event.metrics.mobileShare === "true" || event.metrics.mobileShare === true || numericMetric(event, "mobileMailShareBatchCount") > 0;
  if (!isMobileShare) return null;
  const messageCount = numericMetric(event, "messageCount");
  const batchCount = numericMetric(event, "mobileMailShareBatchCount") || messageCount;
  return {
    messageCount,
    batchCount,
    representativeTitle: stringMetric(event.metrics, "mobileMailShareRepresentativeTitle"),
    digestLabel: stringMetric(event.metrics, "mobileMailShareDigestLabel"),
    eventPath: stringOrDefault(event.metrics.mobileMailShareEventPath, "phone_selected_mail_to_workbench_to_virtual_office_to_final_confirmation"),
    finalBoundary: stringOrDefault(event.metrics.mobileMailShareFinalBoundary, "app_final_confirmation_before_external_send"),
    externalMutation: false,
  };
}

function virtualOfficeReleaseProgression(event: SelectedWorkActionEvent | undefined) {
  const metrics = event?.metrics ?? {};
  return {
    activeGateId: stringMetric(metrics, "releaseProgressionActiveGateId"),
    activeCommand: stringMetric(metrics, "releaseProgressionActiveCommand"),
    activeProofNeeded: stringMetric(metrics, "releaseProgressionActiveProofNeeded"),
    activeMatchesNextStep: metrics?.releaseProgressionActiveMatchesNextStep === true,
    completedGateCount: numericMetric(event, "releaseProgressionCompletedGateCount"),
    waitingGateCount: numericMetric(event, "releaseProgressionWaitingGateCount"),
    fakePassBlocked: metrics?.releaseProgressionFakePassBlocked === true,
    autoAdvanceRequiresActualReportStatus: metrics?.releaseProgressionAutoAdvanceRequiresActualReportStatus === true,
    blockedByActualEvidenceOnly: metrics?.releaseProgressionBlockedByActualEvidenceOnly === true,
  };
}

function virtualOfficeReleaseUnblockStatusRows(event: SelectedWorkActionEvent | undefined) {
  const metrics = event?.metrics ?? {};
  return [
    {
      id: "ai_runtime_live_unblock",
      label: "AI 답변 연결",
      defaultPathLabel: "AI live 기본 경로",
      status: stringMetric(metrics, "aiRuntimeLiveUnblockStatus"),
      command: "run:ai-runtime-live-unblock",
      reportPath: "tmp/ai-runtime-live-unblock-run-report.md",
      recoveryChoicesLabel: stringMetric(metrics, "aiRuntimeLiveRecoveryChoicesLabel"),
      recoveryResumeLabel: stringMetric(metrics, "aiRuntimeLiveRecoveryResumeLabel"),
      recoveryDoneLabel: stringMetric(metrics, "aiRuntimeLiveRecoveryDoneLabel"),
      runtimeTrackStatus: stringMetric(metrics, "aiRuntimeLiveRuntimeTrackStatus"),
    },
    {
      id: "release_live_smoke_unblock",
      label: "메일/캘린더 실기",
      defaultPathLabel: "메일/캘린더 live 기본 경로",
      status: stringMetric(metrics, "releaseLiveSmokeUnblockStatus"),
      command: "run:release-live-smoke-unblock",
      reportPath: "tmp/release-live-smoke-unblock-run-report.md",
      recoveryChoicesLabel: stringMetric(metrics, "releaseLiveSmokeRecoveryChoicesLabel"),
      recoveryResumeLabel: stringMetric(metrics, "releaseLiveSmokeRecoveryResumeLabel"),
      recoveryDoneLabel: stringMetric(metrics, "releaseLiveSmokeRecoveryDoneLabel"),
      runtimeTrackStatus: stringMetric(metrics, "releaseLiveSmokeRuntimeTrackStatus"),
    },
    {
      id: "first_user_observation_unblock",
      label: "첫 사용자 관찰",
      defaultPathLabel: "첫 사용자 관찰 기본 경로",
      status: stringMetric(metrics, "firstUserObservationUnblockStatus"),
      command: "run:first-user-observation-unblock",
      reportPath: "tmp/first-user-observation-unblock-run-report.md",
      recoveryChoicesLabel: stringMetric(metrics, "firstUserObservationRecoveryChoicesLabel"),
      recoveryResumeLabel: stringMetric(metrics, "firstUserObservationRecoveryResumeLabel"),
      recoveryDoneLabel: stringMetric(metrics, "firstUserObservationRecoveryDoneLabel"),
      runtimeTrackStatus: stringMetric(metrics, "firstUserObservationRuntimeTrackStatus"),
    },
  ];
}

function virtualOfficeMailOpsWorkQueueReviewSummary(event: SelectedWorkActionEvent | undefined): VirtualOfficeWorkerEvent["mailOpsWorkQueueReviewSummary"] | null {
  if (!event?.metrics) return null;
  const total = numericMetric(event, "mailOpsWorkQueueTotal");
  if (total <= 0) return null;
  return {
    total,
    approve: numericMetric(event, "mailOpsWorkQueueApproveCount"),
    finalReady: numericMetric(event, "mailOpsWorkQueueFinalReadyCount"),
    finalRemaining: numericMetric(event, "mailOpsWorkQueueFinalRemainingCount"),
    review: numericMetric(event, "mailOpsWorkQueueReviewCount"),
    exclude: numericMetric(event, "mailOpsWorkQueueExcludeCount"),
    replyRequiredCount: numericMetric(event, "mailOpsWorkQueueReplyRequiredCount"),
    calendarCandidateCount: numericMetric(event, "mailOpsWorkQueueCalendarCandidateCount"),
    followUpCandidateCount: numericMetric(event, "mailOpsWorkQueueFollowUpCandidateCount"),
    mobileHandoffCount: numericMetric(event, "mailOpsWorkQueueMobileHandoffCount"),
    oneLineStatusLabel: stringMetric(event.metrics, "mailOpsWorkQueueOneLineStatusLabel"),
    triageDistributionLabel: stringMetric(event.metrics, "mailOpsWorkQueueTriageDistributionLabel"),
    context: stringMetric(event.metrics, "mailOpsQueueReviewContext"),
    proofChain: stringOrDefault(event.metrics.mailOpsWorkQueueProofChain, MAIL_OPS_WORK_QUEUE_PROOF_CHAIN),
    titlesLabel: stringMetric(event.metrics, "mailOpsQueueReviewTitles"),
    nextFinalTitle: stringMetric(event.metrics, "mailOpsWorkQueueNextFinalTitle"),
    decisionReasonLabel: stringMetric(event.metrics, "mailOpsWorkQueueDecisionReasonLabel"),
    sendCheckLabel: stringMetric(event.metrics, "mailOpsWorkQueueSendCheckLabel"),
    finalRouteLabel: stringMetric(event.metrics, "mailOpsWorkQueueFinalRouteLabel"),
    workbenchStageLabel: stringMetric(event.metrics, "mailOpsWorkQueueWorkbenchStageLabel"),
    workbenchActionLabel: stringMetric(event.metrics, "mailOpsWorkQueueWorkbenchActionLabel"),
    workerStateEvidenceLabel: stringMetric(event.metrics, "mailOpsWorkQueueWorkerStateEvidenceLabel"),
    editedDraftCount: numericMetric(event, "mailOpsWorkQueueEditedDraftCount"),
    composedCount: numericMetric(event, "mailOpsWorkQueueComposedCount"),
    workAutomationEvidenceContract: stringOrDefault(
      event.metrics.workAutomationEvidenceContract,
      MAIL_OPS_WORK_QUEUE_AUTOMATION_HANDOFF_CONTRACT,
    ),
    enginePathContract: stringOrDefault(
      event.metrics.workAutomationEnginePathContract,
      MAIL_OPS_WORK_QUEUE_AUTOMATION_ENGINE_PATH,
    ),
    approvalGateContract: stringOrDefault(event.metrics.approvalEngineGateContract, MAIL_OPS_WORK_QUEUE_APPROVAL_GATE_CONTRACT),
    automationProofLabel: stringMetric(event.metrics, "workAutomationEngineProofLabel"),
    workerStatePath: stringOrDefault(event.metrics.mailOpsWorkerStatePath, MAIL_OPS_WORKER_STATE_PATH),
    mobileApprovalCandidateCount: numericMetric(event, "mailOpsMobileApprovalCandidateCount"),
    mobileApprovalNextTitle: stringMetric(event.metrics, "mailOpsMobileApprovalNextTitle"),
    mobileApprovalDigestLabel: stringMetric(event.metrics, "mailOpsMobileApprovalDigestLabel"),
    mobileApprovalBoundaryLabel: stringOrDefault(event.metrics.mailOpsMobileApprovalBoundaryLabel, MAIL_OPS_MOBILE_APPROVAL_BOUNDARY),
    mobileApprovalEventPath: stringOrDefault(event.metrics.mailOpsMobileApprovalEventPath, MAIL_OPS_MOBILE_APPROVAL_EVENT_PATH),
    mobileApprovalChannelContract: stringOrDefault(event.metrics.mailOpsMobileApprovalChannelContract, MAIL_OPS_MOBILE_APPROVAL_CHANNEL_CONTRACT),
    mobileApprovalChannelReadinessLabel: stringOrDefault(event.metrics.mailOpsMobileApprovalChannelReadinessLabel, MAIL_OPS_MOBILE_APPROVAL_CHANNEL_READINESS),
    mobileApprovalOutboundDraftCount: numericMetric(event, "mailOpsMobileApprovalOutboundDraftCount"),
    mobileApprovalOutboundDraftContract: stringOrDefault(event.metrics.mailOpsMobileApprovalOutboundDraftContract, MAIL_OPS_MOBILE_APPROVAL_OUTBOUND_DRAFT_CONTRACT),
    mobileApprovalOutboundDispatchBoundary: stringOrDefault(event.metrics.mailOpsMobileApprovalOutboundDispatchBoundary, MAIL_OPS_MOBILE_APPROVAL_OUTBOUND_DISPATCH_BOUNDARY),
    mobileDecisionRailLabel: stringMetric(event.metrics, "mailOpsMobileDecisionRailLabel"),
    mobileDecisionReplyContract: stringOrDefault(event.metrics.mailOpsMobileDecisionReplyContract, MAIL_OPS_MOBILE_DECISION_REPLY_CONTRACT),
    mobileDecisionTargetLabel: stringMetric(event.metrics, "mailOpsMobileDecisionTargetLabel"),
    mobileDecisionOptionsLabel: stringOrDefault(event.metrics.mailOpsMobileDecisionOptionsLabel, MAIL_OPS_MOBILE_DECISION_OPTIONS_LABEL),
    mobileDecisionReturnPathLabel: stringMetric(event.metrics, "mailOpsMobileDecisionReturnPathLabel"),
    mobileDecisionEventPath: stringOrDefault(event.metrics.mailOpsMobileDecisionEventPath, MAIL_OPS_MOBILE_DECISION_EVENT_PATH),
    externalMutation: false,
  };
}

function virtualOfficeApprovalDecisionReceiptSummary(event: SelectedWorkActionEvent | undefined): VirtualOfficeWorkerEvent["approvalDecisionReceiptSummary"] | null {
  if (!event?.metrics) return null;
  const proofChain = stringMetric(event.metrics, "decisionToExecutionLogProofChain");
  if (proofChain === "missing") return null;
  return {
    label: stringMetric(event.metrics, "approvalDecisionLabel"),
    path: stringMetric(event.metrics, "approvalDecisionPath"),
    proofChain,
    auditId: stringMetric(event.metrics, "decisionReceiptAuditId"),
    previewTitle: stringMetric(event.metrics, "approvalPreviewTitle"),
    finalActionWorkItemId: stringMetric(event.metrics, "finalActionWorkItemId"),
    finalConfirmationState: stringMetric(event.metrics, "finalConfirmationState"),
    finalConfirmationTitle: stringMetric(event.metrics, "finalConfirmationTitle"),
    finalConfirmationNextAction: stringMetric(event.metrics, "finalConfirmationNextAction"),
    mailOpsReviewDecision: stringMetric(event.metrics, "mailOpsQueueReviewDecision"),
    externalMutation: false,
  };
}

function stringMetric(metrics: SelectedWorkActionEvent["metrics"], key: string) {
  const value = metrics?.[key];
  return typeof value === "string" && value.trim() ? value : "missing";
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function inferVirtualOfficeStatus(input: {
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  lastDone?: VirtualOfficeLastDoneRecord;
  aiConnected: boolean;
  desktopReady: boolean;
}): VirtualOfficeWorkerStatus {
  if (input.run) {
    if (/승인|approval/u.test(input.run.detail)) return "approval_pending";
    if (/실패|오류|막힘|failed|error/u.test(input.run.detail)) return "failed";
    if (input.run.phase === "generating") return "drafting";
    if (input.run.phase === "syncing") return /메일|파일|자료|창|읽/u.test(input.run.detail) ? "reading" : "analyzing";
    if (input.run.phase === "connecting" || input.run.phase === "toolchain") return "problem_solving";
    if (input.run.phase === "checking") return "analyzing";
  }
  if (input.event) return virtualOfficeStatusFromWorkEvent(input.event);
  if (!input.desktopReady || !input.aiConnected) return "connection_required";
  if (input.lastDone) return "completed";
  return "idle";
}

function virtualOfficeStatusLabel(status: VirtualOfficeWorkerStatus) {
  if (status === "unknown") return "상태 확인 필요";
  if (status === "connection_required") return "연결 필요";
  if (status === "reading") return "읽는 중";
  if (status === "analyzing") return "분석 중";
  if (status === "drafting") return "초안 작성 중";
  if (status === "problem_solving") return "문제 해결 중";
  if (status === "approval_pending") return "승인 대기";
  if (status === "completed") return "완료";
  if (status === "failed") return "실패/복구 필요";
  return "대기";
}

function virtualOfficeDetail(input: {
  status: VirtualOfficeWorkerStatus;
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  lastDone?: VirtualOfficeLastDoneRecord;
  aiConnected: boolean;
  desktopReady: boolean;
}) {
  if (input.status === "unknown") return `현재 실행 상태 확인 필요${input.event?.detail ? ` · ${input.event.detail}` : ""}`;
  if (input.run?.detail) return input.run.detail;
  if (input.event?.detail) return input.event.detail;
  if (!input.desktopReady) return "설치 앱 연결이 확인되면 실제 업무 이벤트를 표시합니다.";
  if (!input.aiConnected) return "AI 답변 연결 후 업무를 맡길 수 있습니다.";
  if (input.lastDone) return input.lastDone.detail;
  return "맡긴 업무가 생기면 실제 이벤트만 표시합니다.";
}

function virtualOfficeWorkLabel(input: {
  status: VirtualOfficeWorkerStatus;
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  lastDone?: VirtualOfficeLastDoneRecord;
  aiConnected: boolean;
  desktopReady: boolean;
}) {
  if (input.event?.label) return input.event.label;
  if (input.run?.detail) return input.run.detail;
  if (!input.desktopReady) return "설치 앱 연결";
  if (!input.aiConnected) return "AI 답변 연결";
  if (input.lastDone) return "최근 완료 기록";
  if (input.status === "idle") return "대기 중";
  return "업무 상태 확인";
}

function virtualOfficeWorkKind(input: {
  status: VirtualOfficeWorkerStatus;
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  aiConnected: boolean;
  desktopReady: boolean;
}): VirtualOfficeWorkKind {
  const explicitWorkKind = typeof input.event?.metrics?.virtualOfficeWorkKind === "string" ? input.event.metrics.virtualOfficeWorkKind : "";
  if (explicitWorkKind === "ai_runtime") return "ai_runtime";
  if (explicitWorkKind === "mail") return "mail";
  if (explicitWorkKind === "calendar") return "calendar";
  if (explicitWorkKind === "document") return "document";
  if (explicitWorkKind === "repeat") return "repeat";
  if (explicitWorkKind === "approval") return "approval";
  if (explicitWorkKind === "desktop") return "desktop";
  if (explicitWorkKind === "memory") return "memory";
  if (explicitWorkKind === "release") return "release";
  if (input.event?.kind === "memory_personalization") return "memory";
  if (input.event?.kind === "mail_intake") return "mail";
  if (input.event?.kind === "schedule_briefing") return "calendar";
  if (input.event?.kind === "automation") return "repeat";
  if (input.event?.kind === "approval_notification") return "approval";
  if (input.event?.kind === "desktop_control") return "desktop";
  if (input.event?.kind === "release_readiness") return "release";
  if (isAIRuntimeRelatedEvent(input.event)) return "ai_runtime";
  const text = `${input.event?.label ?? ""} ${input.event?.detail ?? ""} ${input.run?.detail ?? ""}`.toLowerCase();
  if (/메일|문의|답장|mail|inbox/u.test(text)) return "mail";
  if (/일정|캘린더|calendar|회의|미팅|예약/u.test(text)) return "calendar";
  if (/반복|automation|repeat|매주|매일|매월/u.test(text)) return "repeat";
  if (input.event?.kind === "document_learning") return "document";
  if (/문서|자료|파일|보고서|document|file/u.test(text)) return "document";
  if (/승인|approval/u.test(text)) return "approval";
  if (/창|브라우저|데스크톱|desktop|browser/u.test(text)) return "desktop";
  if (!input.aiConnected) return "ai_runtime";
  return "general";
}

function virtualOfficeStageLabel(input: {
  status: VirtualOfficeWorkerStatus;
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
}) {
  if (input.status === "unknown") return "상태 확인";
  const explicitStageLabel = typeof input.event?.metrics?.virtualOfficeStageLabel === "string" ? input.event.metrics.virtualOfficeStageLabel : "";
  if (explicitStageLabel) return explicitStageLabel;
  const pipeline = typeof input.event?.metrics?.workPipeline === "string" ? input.event.metrics.workPipeline : "";
  if (pipeline) {
    if (input.status === "approval_pending") return "승인함";
    if (input.status === "reading") return pipeline.split(" -> ")[0] ?? "읽기";
    if (input.status === "drafting") return "초안 작성";
  }
  if (input.status === "connection_required") return "연결 확인";
  if (input.status === "reading") return "읽기";
  if (input.status === "analyzing") return "분석";
  if (input.status === "drafting") return "초안 작성";
  if (input.status === "problem_solving") return "문제 해결";
  if (input.status === "approval_pending") return "승인함";
  if (input.status === "completed") return "실행 로그";
  if (input.status === "failed") return "복구";
  if (input.run?.phase === "checking") return "점검";
  return "대기";
}

function virtualOfficeQueueLabel(input: {
  status: VirtualOfficeWorkerStatus;
  event?: SelectedWorkActionEvent;
  aiConnected: boolean;
  desktopReady: boolean;
}) {
  if (input.status === "unknown") return "상태 확인 필요";
  const approvalCount = numericMetric(input.event, "approvalQueueCount");
  const explicitQueueLabel = typeof input.event?.metrics?.virtualOfficeQueueLabel === "string" ? input.event.metrics.virtualOfficeQueueLabel : "";
  if (explicitQueueLabel) return explicitQueueLabel;
  if (approvalCount > 0) return `승인 ${approvalCount}건`;
  const createdWorkItems = numericMetric(input.event, "createdWorkItemsCount") || numericMetric(input.event, "queuedWorkItemsCount");
  if (createdWorkItems > 0) return `후보 ${createdWorkItems}건`;
  const messageCount = numericMetric(input.event, "messageCount");
  if (messageCount > 0) return `읽은 메일 ${messageCount}건`;
  const calendarCount = numericMetric(input.event, "calendarCandidateCount");
  if (calendarCount > 0) return `일정 후보 ${calendarCount}건`;
  const enabledRepeats = numericMetric(input.event, "repeatEnabledRuleCount");
  if (enabledRepeats > 0) return `켜진 반복 ${enabledRepeats}개`;
  const skippedRepeats = numericMetric(input.event, "repeatSkippedDisabledRuleCount");
  if (skippedRepeats > 0) return `꺼진 후보 ${skippedRepeats}개`;
  if (input.status === "approval_pending") return "승인함 확인";
  if (input.status === "connection_required") return "연결 필요";
  if (input.status === "failed") return "복구 필요";
  if (input.status === "completed") return "로그 확인";
  if (input.status === "idle") return "대기";
  return "진행 중";
}

function virtualOfficeMetricEvidenceLabel(event: SelectedWorkActionEvent | undefined) {
  if (!event?.metrics) return event?.evidence || "지표 없음";
  const metrics = event.metrics;
  const explicitMetricEvidence = typeof metrics.virtualOfficeMetricEvidenceLabel === "string" ? metrics.virtualOfficeMetricEvidenceLabel : "";
  if (explicitMetricEvidence) return explicitMetricEvidence;
  const parts = [
    metrics.aiRuntimeBlocked === true ? "AI 런타임 차단" : "",
    metrics.pendingRequestStored === true ? "요청 보관" : "",
    metrics.fakeCandidateBlocked === true ? "가짜 후보 차단" : "",
    metrics.fakePassBlocked === true ? "fake pass 차단" : "",
    metrics.memoryPersonalizationSuggested === true ? "기억 제안" : "",
    metrics.memoryPersonalizationPolicy === "manual_apply_or_save_only" ? "수동 적용/저장" : "",
    metricPart(metrics, "messageCount", "메일"),
    metricPart(metrics, "createdWorkItemsCount", "후보"),
    metricPart(metrics, "queuedWorkItemsCount", "큐"),
    metricPart(metrics, "approvalQueueCount", "승인"),
    metricPart(metrics, "calendarCandidateCount", "일정"),
    metricPart(metrics, "repeatEnabledRuleCount", "켜진 반복"),
    metricPart(metrics, "repeatSkippedDisabledRuleCount", "꺼진 반복"),
    metricPart(metrics, "memoryConflictCandidateCount", "충돌 후보"),
    metricPart(metrics, "releaseBlockerCount", "막힘"),
  ].filter(Boolean);
  const finalExecutionGateAuditId = typeof metrics.finalExecutionGateAuditId === "string" ? metrics.finalExecutionGateAuditId : "";
  const finalExecutionProofChain = typeof metrics.finalExecutionProofChain === "string" ? metrics.finalExecutionProofChain : "";
  const recoveryActionLabel = typeof metrics.recoveryActionLabel === "string" ? metrics.recoveryActionLabel : "";
  const recoveryProofChain = typeof metrics.recoveryProofChain === "string" ? metrics.recoveryProofChain : "";
  const aiRuntimeFallbackAttemptFailures = typeof metrics.aiRuntimeFallbackAttemptFailures === "string" ? metrics.aiRuntimeFallbackAttemptFailures : "";
  const aiRuntimeRecoveryChoices = typeof metrics.aiRuntimeRecoveryChoices === "string" ? metrics.aiRuntimeRecoveryChoices : "";
  if (finalExecutionGateAuditId) parts.push(`실행 차단 감사 로그 ${finalExecutionGateAuditId}`);
  if (finalExecutionProofChain) parts.push(`실행 proof ${finalExecutionProofChain}`);
  if (recoveryActionLabel) parts.push(`복구 ${recoveryActionLabel}`);
  if (recoveryProofChain) parts.push(`복구 proof ${recoveryProofChain}`);
  if (aiRuntimeFallbackAttemptFailures) parts.push(`AI 실패 경로 ${aiRuntimeFallbackAttemptFailures}`);
  if (aiRuntimeRecoveryChoices) parts.push(`AI 복구 선택 ${aiRuntimeRecoveryChoices}`);
  const pipeline = typeof metrics.workPipeline === "string" ? metrics.workPipeline : "";
  if (pipeline) parts.push(`파이프라인 ${pipeline}`);
  if (typeof metrics.readOnly === "boolean") parts.push(metrics.readOnly ? "읽기 전용" : "쓰기 가능");
  if (typeof metrics.externalMutation === "boolean") parts.push(metrics.externalMutation ? "외부 변경 있음" : "외부 변경 없음");
  if (parts.length) return parts.slice(0, 5).join(" · ");
  return event.evidence || `이벤트 ${event.id}`;
}

function virtualOfficeWorkPipelineLabel(input: {
  status: VirtualOfficeWorkerStatus;
  event?: SelectedWorkActionEvent;
}) {
  const explicitPipeline = typeof input.event?.metrics?.workPipeline === "string" ? input.event.metrics.workPipeline : "";
  if (explicitPipeline) return explicitPipeline;
  const kind = virtualOfficeWorkKind({
    status: input.status,
    event: input.event,
    aiConnected: true,
    desktopReady: true,
  });
  if (kind === "mail") return "메일 확인 -> 답장/일정 후보 -> 오피스 승인함";
  if (kind === "document") return "자료 선택 -> 읽기 후보 -> 초안/근거 -> 승인 후보";
  if (kind === "approval") return "결과 후보 -> 승인함 -> 실행 로그";
  if (kind === "desktop") return "읽기 전용 확인 -> 작업 후보 -> 승인 후 실행";
  if (input.status === "connection_required") return "연결 확인 -> 읽기 전용 점검 -> 업무 후보";
  if (input.status === "idle") return "업무 맡김 대기 -> 상태 표시 -> 승인 전 잠금";
  return "요청 이해 -> 담당자 작업 -> 승인 전 확인";
}

function metricPart(metrics: SelectedWorkActionEvent["metrics"], key: string, label: string) {
  const value = metrics?.[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return `${label} ${value}건`;
}

function virtualOfficeNextUserActionLabel(input: {
  status: VirtualOfficeWorkerStatus;
  event?: SelectedWorkActionEvent;
  aiConnected: boolean;
  desktopReady: boolean;
}) {
  if (input.status === "unknown") return "업무 기록에서 실행 상태 확인";
  const explicitNextAction = typeof input.event?.metrics?.virtualOfficeNextUserActionLabel === "string" ? input.event.metrics.virtualOfficeNextUserActionLabel : "";
  if (explicitNextAction) return explicitNextAction;
  if (input.status === "approval_pending") return "승인함에서 실행하기/고쳐달라고/보류";
  if (input.status === "connection_required") {
    if (!input.desktopReady) return "설치 앱 연결 확인";
    if (!input.aiConnected) return "AI 답변 연결 확인";
    return "필요 연결 확인";
  }
  if (input.status === "failed") return "복구 버튼으로 이어가기";
  if (input.status === "completed") return "실행 로그 확인";
  if (input.status === "idle") return "맡길 업무 없음";
  if (input.event?.status === "running") return "완료 전 대기";
  return "상태 지켜보기";
}

function virtualOfficeBlockerLabel(input: {
  status: VirtualOfficeWorkerStatus;
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  aiConnected: boolean;
  desktopReady: boolean;
}) {
  if (input.status === "unknown") return "현재 실행 상태 확인 필요";
  const explicitBlocker = typeof input.event?.metrics?.virtualOfficeBlockerLabel === "string" ? input.event.metrics.virtualOfficeBlockerLabel : "";
  if (explicitBlocker) return explicitBlocker;
  if (input.event?.metrics?.memoryPersonalizationSuggested === true) return "사용자 선택 전 자동 저장 없음";
  if (input.status === "connection_required") {
    if (!input.desktopReady) return "설치 앱 연결 전";
    if (!input.aiConnected) return "AI 답변 연결 전";
    return input.event?.detail || "필요 연결 확인 전";
  }
  if (input.status === "failed") return input.event?.detail || input.run?.detail || "복구 필요";
  if (input.status === "approval_pending") return "사용자 최종 승인 전 잠금";
  if (input.status === "idle") return "막힘 없음";
  if (input.status === "completed") return "막힘 없음";
  return "외부 실행 전 잠금";
}

function virtualOfficeSafetyBoundaryLabel(input: {
  status: VirtualOfficeWorkerStatus;
  event?: SelectedWorkActionEvent;
}) {
  if (input.status === "unknown") return "실행 상태 확인 필요";
  const explicitSafetyBoundary = typeof input.event?.metrics?.virtualOfficeSafetyBoundaryLabel === "string" ? input.event.metrics.virtualOfficeSafetyBoundaryLabel : "";
  if (explicitSafetyBoundary) return explicitSafetyBoundary;
  if (input.event?.metrics?.memoryPersonalizationSuggested === true) return "자동 저장 없음, 외부 실행 없음";
  if (input.status === "approval_pending") return "외부 실행은 승인함 최종 확인 전까지 잠김";
  if (input.status === "reading") return "읽기 전용, 변경 없음";
  if (input.status === "drafting" || input.status === "analyzing") return "후보 생성만, 외부 실행 없음";
  if (input.status === "connection_required") return "연결 전 자동 실행 없음";
  if (input.status === "failed") return "복구 전 자동 실행 없음";
  if (input.status === "completed") return "실행 로그와 결정 기록으로 확인";
  if (input.status === "idle") return "실제 이벤트 없으면 대기만 표시";
  const readOnly = input.event?.metrics?.readOnly;
  if (readOnly === true) return "읽기 전용, 변경 없음";
  return "외부 실행 전 잠금";
}

function virtualOfficePrimaryAction(input: {
  status: VirtualOfficeWorkerStatus;
  event?: SelectedWorkActionEvent;
  aiConnected: boolean;
  desktopReady: boolean;
}): VirtualOfficeWorkerEvent["primaryAction"] {
  if (input.status === "unknown") return "open_office";
  if (input.event?.metrics?.memoryPersonalizationSuggested === true) return "none";
  if (
    typeof input.event?.metrics?.recoveryProofChain === "string" ||
    typeof input.event?.metrics?.finalExecutionGateAuditId === "string"
  ) {
    return "open_office";
  }
  if (input.event?.kind === "release_readiness" && input.status === "failed") return "external_accounts";
  if (input.status === "approval_pending") return "open_office";
  if (input.status === "completed") return "open_office";
  if (input.status === "failed") return isAIRuntimeRelatedEvent(input.event) ? "connect_ai" : "external_accounts";
  if (input.status === "connection_required") {
    if (!input.aiConnected) return "connect_ai";
    return "external_accounts";
  }
  if (input.event?.kind === "automation") return "automation_log";
  return "none";
}

function virtualOfficePrimaryActionLabel(input: {
  status: VirtualOfficeWorkerStatus;
  event?: SelectedWorkActionEvent;
  aiConnected: boolean;
  desktopReady: boolean;
}) {
  if (input.event?.metrics?.memoryPersonalizationSuggested === true) return "선택 대기";
  if (input.event?.kind === "release_readiness" && input.status === "failed") return "현장 가이드 열기";
  const action = virtualOfficePrimaryAction(input);
  if (action === "open_office" && input.status === "approval_pending") return "승인함 열기";
  if (action === "open_office") return "실행 로그 보기";
  if (action === "connect_ai") return "AI 연결 복구";
  if (action === "external_accounts") return "필요 연결 열기";
  if (action === "automation_log") return "반복 로그 열기";
  return "팀원 선택";
}

export function createTeammateLastDoneFromEvents(events: SelectedWorkActionEvent[]) {
  const latest: Record<string, { detail: string; event: SelectedWorkActionEvent }> = {};
  for (const event of events) {
    if (event.status !== "done") continue;
    const teammateId = getTeammateIdFromWorkEvent(event);
    const detail = String(event.detail ?? "").trim();
    if (!teammateId || !detail) continue;
    const current = latest[teammateId];
    if (current && compareVirtualOfficeEventFreshness(current.event, event) >= 0) continue;
    latest[teammateId] = { detail, event };
  }
  return Object.fromEntries(
    Object.entries(latest).map(([teammateId, item]) => [
      teammateId,
      {
        detail: item.detail,
        eventId: item.event.id,
        updatedAt: item.event.updatedAt ?? item.event.createdAt,
      },
    ]),
  );
}

function groupLatestTeammateEvents(events: SelectedWorkActionEvent[]) {
  const latest = new Map<string, SelectedWorkActionEvent>();
  for (const event of events) {
    const teammateId = getTeammateIdFromWorkEvent(event);
    if (!teammateId) continue;
    const current = latest.get(teammateId);
    if (current && compareVirtualOfficeEventFreshness(current, event) >= 0) continue;
    latest.set(teammateId, event);
  }
  return latest;
}

function compareVirtualOfficeEventFreshness(a: SelectedWorkActionEvent, b: SelectedWorkActionEvent) {
  const aTime = virtualOfficeEventTimestamp(a);
  const bTime = virtualOfficeEventTimestamp(b);
  if (aTime !== bTime) return aTime - bTime;
  return String(a.id).localeCompare(String(b.id));
}

function virtualOfficeEventTimestamp(event: SelectedWorkActionEvent) {
  const updatedAt = Date.parse(event.updatedAt ?? "");
  if (!Number.isNaN(updatedAt)) return updatedAt;
  const createdAt = Date.parse(event.createdAt ?? "");
  return Number.isNaN(createdAt) ? 0 : createdAt;
}

function getTeammateIdFromWorkEvent(event: SelectedWorkActionEvent) {
  const metricId = typeof event.metrics?.teammateId === "string" ? event.metrics.teammateId : "";
  if (metricId) return metricId;
  const workItemId = String(event.workItemId ?? "");
  return workItemId.startsWith("ai-teammate:") ? workItemId.slice("ai-teammate:".length) : "";
}

function numericMetric(event: SelectedWorkActionEvent | undefined, key: string) {
  const value = event?.metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sanitizeVirtualOfficeIso(value: string | undefined) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function isAIRuntimeRelatedEvent(event: SelectedWorkActionEvent | undefined) {
  const text = `${event?.label ?? ""} ${event?.detail ?? ""} ${event?.sourceLabel ?? ""}`;
  return /AI|답변|Codex|OpenAI|Gemini|OAuth|로그인|모델|runtime/i.test(text);
}

function virtualOfficeStatusFromWorkEvent(event: SelectedWorkActionEvent): VirtualOfficeWorkerStatus {
  if (event.status === "unknown") return "unknown";
  if (event.status === "error") return "failed";
  if (event.status === "needs_desktop") return "connection_required";
  const explicitStatus = getExplicitVirtualOfficeStatus(event);
  // A finished preparation step may have produced a genuine approval candidate.
  if (event.status === "done") return explicitStatus === "approval_pending" ? "approval_pending" : "completed";
  const age = Date.now() - Date.parse(event.updatedAt ?? event.createdAt);
  if (!Number.isFinite(age) || age < 0 || age >= 2 * 60_000) return "unknown";
  if (explicitStatus) return explicitStatus;
  if (/승인|approval|final confirmation/u.test(`${event.label} ${event.detail}`)) return "approval_pending";
  if (/메일|파일|자료|창|읽|폴더|문서/u.test(`${event.label} ${event.detail}`)) return "reading";
  if (/초안|답장|보고서|작성|draft/u.test(`${event.label} ${event.detail}`)) return "drafting";
  if (/연결|복구|설정|권한|로그인|toolchain/u.test(`${event.label} ${event.detail}`)) return "problem_solving";
  return "analyzing";
}

function getExplicitVirtualOfficeStatus(event: SelectedWorkActionEvent): VirtualOfficeWorkerStatus | null {
  const metricStatus = typeof event.metrics?.virtualOfficeStatus === "string" ? event.metrics.virtualOfficeStatus : "";
  if (
    metricStatus === "idle" ||
    metricStatus === "connection_required" ||
    metricStatus === "reading" ||
    metricStatus === "analyzing" ||
    metricStatus === "drafting" ||
    metricStatus === "problem_solving" ||
    metricStatus === "approval_pending" ||
    metricStatus === "completed" ||
    metricStatus === "failed"
  ) {
    return metricStatus;
  }
  return null;
}

function sourceForVirtualOfficeWorker(input: {
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  lastDone?: VirtualOfficeLastDoneRecord;
  aiConnected: boolean;
  desktopReady: boolean;
}): VirtualOfficeWorkerEvent["source"] {
  if (input.run) return "live_run";
  if (input.event) return "work_event";
  if (input.lastDone) return "last_done";
  if (!input.aiConnected || !input.desktopReady) return "runtime_gate";
  return "idle";
}

function virtualOfficeSourceLabel(source: VirtualOfficeWorkerEvent["source"]) {
  if (source === "live_run") return "실시간 실행";
  if (source === "work_event") return "업무 이벤트";
  if (source === "last_done") return "최근 완료 기록";
  if (source === "runtime_gate") return "연결 상태";
  return "대기";
}

function virtualOfficeEvidenceLabel(input: {
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  lastDone?: VirtualOfficeLastDoneRecord;
  aiConnected: boolean;
  desktopReady: boolean;
}) {
  if (input.run) return `workerRuns:${input.run.phase}`;
  if (input.event) return `selectedWorkActionEvents:${input.event.id}`;
  if (input.lastDone) return `selectedWorkActionEvents:${input.lastDone.eventId}`;
  if (!input.desktopReady) return "runtimeGate:desktop";
  if (!input.aiConnected) return "runtimeGate:ai";
  return "idle:no_active_event";
}

function virtualOfficeEvidenceKind(input: {
  source: VirtualOfficeWorkerEvent["source"];
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  lastDone?: VirtualOfficeLastDoneRecord;
  aiConnected: boolean;
  desktopReady: boolean;
}): VirtualOfficeEvidenceKind {
  if (input.event || input.source === "work_event" || input.source === "last_done") return "selected_work_event";
  if (input.run && input.source === "live_run") return "live_run_signal";
  if (!input.aiConnected || !input.desktopReady || input.source === "runtime_gate") return "runtime_gate";
  return "idle_no_event";
}

function virtualOfficeActiveMotionAllowed(input: {
  source: VirtualOfficeWorkerEvent["source"];
  status: VirtualOfficeWorkerStatus;
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
}) {
  if (input.status === "idle" || input.status === "unknown" || input.status === "completed" || input.status === "failed" || input.status === "approval_pending" || input.status === "connection_required") return false;
  if (input.source === "work_event") return input.event?.status === "running";
  if (input.source === "live_run") {
    return Boolean(input.run?.detail?.trim()) && input.run?.phase !== "idle";
  }
  return false;
}

function virtualOfficeStateIntegrityLabel(input: {
  source: VirtualOfficeWorkerEvent["source"];
  status: VirtualOfficeWorkerStatus;
  run?: VirtualOfficeRunSignal;
  event?: SelectedWorkActionEvent;
  lastDone?: VirtualOfficeLastDoneRecord;
}) {
  if (input.source === "work_event" && input.event) return `실제 업무 이벤트: ${input.event.id}`;
  if (input.source === "live_run" && input.run) return `실시간 런타임 신호: ${input.run.phase}`;
  if (input.source === "last_done" && input.lastDone) return `완료 기록 이벤트: ${input.lastDone.eventId}`;
  if (input.source === "runtime_gate") return "연결 게이트에서만 표시";
  return "실제 이벤트 없으면 대기";
}
