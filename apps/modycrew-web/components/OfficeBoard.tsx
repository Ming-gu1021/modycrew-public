"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { InboxCleanupProvider, InboxCardRowTools, useInboxCleanup } from "@/components/InboxCardCleanup";
import { mailDispatchReviewState } from "@/lib/mail-dispatch-ui.mjs";
import VirtualOfficeScene, { type VirtualOfficeWorker as VirtualOfficeSceneWorker } from "@/components/VirtualOfficeScene";
import { getCrewCharacter, type CrewCharacterId } from "@/lib/crew-character-catalog";
import { deskLabels, type Desk, type DeskCardStatus } from "@/lib/office";
import { navigateInternalPath } from "@/lib/safe-navigation";
import {
  getFeatureLauncherCatalogItem,
  getProgressiveDisclosureFeatureLauncherItems,
  getQualityGateFeatureLauncherItems,
  validateFeatureLauncherReplacement,
  type FeatureLauncherCatalogItem,
} from "@/lib/feature-launcher-catalog";
import type {
  FinalActionDryRunResult,
  FinalActionExecutionResult,
  FinalActionKind,
  FinalConfirmationContract,
  ChannelDecisionFinalConfirmationContext,
  DesktopControlCapabilityId,
  ConnectorStatusRecord,
  LocalMemoryDelegationApprovalDecision,
  LocalMemoryDelegationArtifactRecord,
  LocalMemoryGrowthSuggestion,
  LocalMemoryIdentityFile,
  LocalMemorySkillSource,
  MailRedraftOptions,
} from "@/lib/desktop-bridge";
import type { WorkItem } from "@/lib/types";
import {
  WORK_AUTOMATION_MAILOPS_WORK_QUEUE_PROOF_LABEL,
  createMailOpsWorkQueueAutomationEvidence,
} from "@/lib/work-automation-engine";
import { ROLE_COMMAND_APPROVAL_HANDOFF_PROOF } from "@/lib/role-command-approval-handoff";
import { findExactMailWorkQueueRecord } from "@/lib/mail-send-approval-intent";
import {
  createUserComposedMailApprovalWorkItem,
  userComposedMailApprovalStorageKey,
  type UserComposedMailApprovalInput,
} from "@/lib/user-composed-mail-approval";
import {
  createModyMailOperationsWorkbenchPlan,
} from "../../../packages/domain/dist/mail-operations-workbench.js";
import { MailRedraftForm, type MailRedraftOutcome } from "@/components/MailRedraftForm";
import { MailCardTriageLine } from "@/components/MailCardTriageLine";
import {
  buildMailCardTriageView,
  countUrgentMailDecisions,
  type MailCardAssigneeOption,
} from "@/lib/mail-card-triage";
import styles from "./OfficeBoard.module.css";

const mailOpsWorkBenchFinalVisibleLayoutContract =
  'data-mailops-workbench-row-visible-layout="one_line_priority_decision_title_next_lock"';

type MailOpsOperationsWorkbenchInput = NonNullable<Parameters<typeof createModyMailOperationsWorkbenchPlan>[0]>;
type MailOpsRecipientListReviewInput = NonNullable<MailOpsOperationsWorkbenchInput["recipientListReview"]>;
type WorkSourceRecipientListReview = NonNullable<NonNullable<WorkItem["sourceEvidence"]>["recipientListReview"]>;

type MailOpsSupportedWorkFocusRoute =
  | "mailops_triage_to_approval"
  | "recipient_review_to_sample"
  | "manual_compose_to_check"
  | "mobile_share_to_workbench"
  | "calendar_candidate_to_final_confirmation"
  | "high_risk_review_gate"
  | "none";

type MailOpsSupportedWorkFocusResultRow = {
  id: string;
  label: string;
  value: string;
  detail: string;
  state: string;
  actionLabel: string;
  actionContract: string;
  actionKind: "anchor" | "select_workbench" | "open_composed";
  actionHref?: string;
  workbenchRowId?: string;
  workItem?: WorkItem;
};

function mailOpsSupportedWorkFocusFromHash(hash: string): MailOpsSupportedWorkFocusRoute {
  if (hash === "#mailops-bulk-send-review") return "recipient_review_to_sample";
  if (hash === "#mailops-user-composed-check") return "manual_compose_to_check";
  if (hash === "#mailops-capability-matrix") return "calendar_candidate_to_final_confirmation";
  if (hash === "#mailops-exception-coverage") return "high_risk_review_gate";
  if (hash === "#mailops-workbench-rows") return "mailops_triage_to_approval";
  return "none";
}

type Props = {
  desks: Desk[];
  progressValue: number;
  activeFeatureCount: number;
  hiddenDeskCount: number;
  enabledRuleCount: number;
  nextActionLabel: string;
  showVirtualOfficeScene?: boolean;
  crewMembers?: Array<{
    id: string;
    name: string;
    avatarId?: CrewCharacterId;
    templateId?: string;
    channelName: string;
    teamLabel: string;
    roleTitle: string;
    brief: string;
    personalityPreview: string;
    crewSoulPath: string;
    workLogPath: string;
    decisionLogPath: string;
    promptMemoryPath: string;
    latestDetail: string;
    latestLearnedSummary?: string;
    active: boolean;
    running: boolean;
    workCount: number;
    learnedWorkCount?: number;
    recentDecisionCount?: number;
    skillCount: number;
    identityReadyCount: number;
    identityFileCount: number;
    assignedGrowthCount: number;
  }>;
  /** 가상 오피스에서도 상단과 같은 크루 프로필을 연다. */
  onOpenCrewProfile?: (teammateId: string) => void;
  channelWorkSummaries?: Array<{
    id: string;
    name: string;
    channelName: string;
    teamLabel: string;
    roleTitle: string;
    brief: string;
    personalityPreview: string;
    statusLabel: string;
    runningCount: number;
    approvalCount: number;
    resultCount: number;
    growthCount: number;
    latestLabel: string;
    latestDetail: string;
    latestSource: string;
    learnedWorkCount?: number;
    recentDecisionCount?: number;
    latestLearnedLabel?: string;
    latestLearnedSummary?: string;
    crewSoulPath: string;
    workLogPath: string;
    decisionLogPath: string;
  }>;
  channelQueueItems?: Array<{
    id: string;
    teammateId: string;
    teammateName: string;
    channelName: string;
    teamLabel: string;
    kind: "running" | "approval" | "result" | "growth" | "error" | "unknown";
    label: string;
    detail: string;
    sourceLabel: string;
    updatedAt: string;
    memoryPath?: string;
    artifactId?: string;
    workItemId?: string;
    queueLabel?: string;
    outputKind?: string;
    skillId?: string;
    crewKitLabel?: string;
    approvalRequired?: boolean;
  }>;
  channelQueueFocus?: {
    sourceThreadId: string;
    sourceTeammateId: string;
    sourceTeammateName: string;
    targetTeammateIds: string[];
    targetLabels: string[];
    requestText: string;
    createdAt: number;
  } | null;
  activeChannelLabels?: string[];
  messengerConnections?: Array<{
    id: string;
    connectorId: string;
    label: string;
    state: string;
    statusLabel: string;
    detail: string;
    targetLabel: string;
    checkedAt?: string;
  }>;
  channelDecisions?: Array<{
    id: string;
    workItemId?: string;
    title: string;
    decision: string;
    decisionLabel?: string;
    channel: string;
    decidedBy: string;
    teammateName?: string;
    channelName?: string;
    teamLabel?: string;
    messagePreview?: string;
    targetCode?: string;
    targetWorkItemId?: string;
    notificationTargetMatch?: boolean;
    notificationTargetMatchLabel?: string;
    notificationTargetMatchContract?: string;
    approvalInboxRouteLabel?: string;
    appReconfirmLabel?: string;
    workerEventLabel?: string;
    finalExecutionBoundary?: string;
    mobileReceiveFilterIds?: string[];
    mobileReceiveFilterLabels?: string[];
    mobileReceiveFilterSummary?: string;
    mobileReceiveFilterContract?: string;
    requiresAppReconfirm: boolean;
    revisionInstruction?: string;
    decisionLogPath?: string;
    workLogPath?: string;
    queueState?: string;
  }>;
  connectorStatuses?: ConnectorStatusRecord[];
  connectionRecoveryHandoff?: {
    source: "connect-recovery";
    connectorId: string;
    connectorLabel: string;
  } | null;
  growthSuggestions?: LocalMemoryGrowthSuggestion[];
  skillSources?: LocalMemorySkillSource[];
  identityFiles?: LocalMemoryIdentityFile[];
  delegationArtifacts?: LocalMemoryDelegationArtifactRecord[];
  learnedDraftApprovalItems?: WorkItem[];
  /** 승인함 '처리됨' 탭 표시용: 이미 보류·수정 요청·거절한 학습 초안. 결정 처리에는 쓰지 않는다. */
  processedLearnedDraftItems?: WorkItem[];
  focusedLearnedDraftWorkItemId?: string;
  learnedDraftFocusContext?: {
    workItemId: string;
    draftCount: number;
    sourceLabel: string;
    nextUserChoice: string;
    createdAt: number;
  } | null;
  approvedOutputItems?: WorkItem[];
  externalApprovalCandidates?: WorkItem[];
  finalActionCandidates?: WorkItem[];
  /** 메일 카드 담당 AI 직원 선택지(직원 목록). */
  cardAssigneeTeammates?: MailCardAssigneeOption[];
  changingCardAssigneeId?: string | null;
  /** 담당을 바꾸지 못했을 때 그 카드에 적을 한 줄. */
  cardAssigneeNotice?: { workItemId: string; message: string } | null;
  onChangeCardAssignee?: (workItem: WorkItem, teammateId: string) => void | Promise<void>;
  finalConfirmation?: FinalConfirmationContract | null;
  finalActionValues?: Record<string, string>;
  finalDryRun?: FinalActionDryRunResult | null;
  finalDryRunWorkItemId?: string | null;
  finalExecution?: FinalActionExecutionResult | null;
  finalExecutionWorkItemId?: string | null;
  executionLogFocus?: {
    workItemId: string;
    auditId: string;
    dryRunAuditId: string;
    executionGateStatus: string;
    proofChain: string;
    rollbackLabel: string;
    sourceEventId: string;
    mailOpsQueueReviewContext?: string;
    mailOpsQueueReviewDecision?: string;
    mailOpsQueueReviewNote?: string;
    mailOpsWorkQueueAutomationProof?: string;
    mailOpsWorkQueueEngineHandoff?: string;
    mailOpsWorkQueueEnginePath?: string;
    mailOpsWorkQueueApprovalGate?: string;
    createdAt: number;
  } | null;
  finalConfirmationMessage?: string;
  browserTaskActionMessage?: string;
  mailOpsDecisionMessage?: string;
  localFileActionMessage?: string;
  localFilePatternMessage?: string;
  folderPlanActionMessage?: string;
  mailAutomationNotificationMessage?: string;
  mailAutomationNotificationDispatchReceipt?: {
    status: string;
    targetCount: number;
    targetIds: string[];
    providerMessageId: string;
    executionSummary: string;
  } | null;
  folderPlanOptionsByItemId?: Record<string, FolderPlanApprovalOptions>;
  preparingFinalActionId?: string | null;
  recordingMailOpsDecisionId?: string | null;
  runningLocalFileActionId?: string | null;
  runningFolderPlanActionId?: string | null;
  sendingMailAutomationNotificationId?: string | null;
  applyingMailAutomationNotificationDecisionId?: string | null;
  savingLocalFilePatternId?: string | null;
  runningDryRunActionId?: string | null;
  executingFinalActionId?: string | null;
  runningBrowserTaskActionId?: string | null;
  memoryOpenMessage?: string;
  forceOpenDetailFold?: boolean;
  onOpenDelegationArtifact?: (artifact: LocalMemoryDelegationArtifactRecord) => void;
  onOpenMemoryFile?: (relativePath: string) => void;
  onOpenApprovedOutput?: (workItem: WorkItem) => void;
  onOpenWorkerCompanion?: () => void | Promise<void>;
  onStageApprovedOutputFinalAction?: (workItem: WorkItem) => void;
  onRecordDelegationDecision?: (
    artifact: LocalMemoryDelegationArtifactRecord,
    decision: LocalMemoryDelegationApprovalDecision,
  ) => void;
  onPrepareFinalConfirmation?: (workItem: WorkItem) => void;
  onRecordMailOpsDecision?: (workItem: WorkItem, decision: "approved" | "change_requested" | "held") => void;
  /** 답장 카드의 '어떻게 고칠까요?' — 적은 지시로 AI 가 초안을 다시 쓴다(보내지 않음). fromSource 면 원래 메일을 읽고 새로 쓴다. */
  onRedraftMailReply?: (workItem: WorkItem, instruction: string, options?: MailRedraftOptions) => Promise<MailRedraftOutcome>;
  onRecordMailOpsWorkQueueReviewEvent?: (records: MailOpsWorkQueueReviewRecord[]) => void | Promise<void>;
  onRunLocalFileAction?: (workItem: WorkItem, action: "analyze" | "draft" | "hold") => void;
  onRunFolderPlanAction?: (workItem: WorkItem, action: FolderPlanApprovalAction) => void;
  onStageMailAttachmentFolderPlan?: (workItem: WorkItem) => void;
  onSendMailAutomationNotification?: (workItem: WorkItem) => void | Promise<void>;
  onApplyMailAutomationNotificationDecision?: (workItem: WorkItem) => void | Promise<void>;
  onChangeFolderPlanCollisionPolicy?: (workItemId: string, policy: FolderPlanCollisionPolicy) => void;
  onChangeFolderPlanExcludedKeywords?: (workItemId: string, value: string) => void;
  onSaveLocalFilePattern?: (workItem: WorkItem) => void;
  onChangeFinalActionValue?: (fieldId: string, value: string) => void;
  onRunFinalActionDryRun?: (workItem: WorkItem) => void;
  onExecuteFinalAction?: (workItem: WorkItem) => void;
  onRunBrowserTaskAction?: (workItem: WorkItem, capability: DesktopControlCapabilityId) => void;
  onUnlockNext?: () => void;
};

const statusLabel: Record<DeskCardStatus, string> = {
  analyzing: "분석 중",
  draft_ready: "초안 준비",
  approval_pending: "승인 대기",
  blocked: "차단됨",
  completed: "완료",
  failed: "실패",
};

const statusProgress: Record<DeskCardStatus, number> = {
  analyzing: 34,
  draft_ready: 62,
  approval_pending: 84,
  blocked: 48,
  completed: 100,
  failed: 100,
};

type FolderPlanApprovalAction = "preview" | "apply" | "revert";
type FolderPlanCollisionPolicy = "rename" | "skip";
type FolderPlanApprovalOptions = {
  collisionPolicy: FolderPlanCollisionPolicy;
  excludedPathKeywords: string;
  sourceLabel?: string;
};

function channelQueueKindLabel(kind: "running" | "approval" | "result" | "growth" | "error" | "unknown") {
  if (kind === "running") return "실행 중";
  if (kind === "approval") return "승인 대기";
  if (kind === "result") return "결과";
  if (kind === "error") return "실패";
  if (kind === "unknown") return "상태 확인 필요";
  return "업무 도구 추천";
}

function isMainControlChannel(teammateId: string) {
  return teammateId === "teammate-personal-operator" || teammateId === "control-empty";
}

function formatLiveChannelPrimaryLabel(teammateId: string, teammateName: string, channelName: string) {
  if (isMainControlChannel(teammateId)) return "새 채팅 접수함";
  return channelName || teammateName || "AI 팀원 작업";
}

function formatLiveChannelSecondaryLabel(
  teammateId: string,
  teammateName: string,
  channelName: string,
  teamLabel: string,
) {
  if (isMainControlChannel(teammateId)) {
    return `${channelName || "메인 컨트롤"} · ${teammateName || "기본 비서"}`;
  }
  return `${teammateName || "담당 AI 팀원"} · ${teamLabel || "역할"}`;
}

function strongerLiveKind(
  current: "running" | "approval" | "result" | "growth" | "error" | "unknown",
  next: "running" | "approval" | "result" | "growth" | "error" | "unknown",
) {
  const priority = { approval: 6, running: 5, error: 4, unknown: 3, growth: 2, result: 1 };
  return priority[next] > priority[current] ? next : current;
}

function liveStatusLabel(kind: "running" | "approval" | "result" | "growth" | "error" | "unknown", count: number) {
  const base = kind === "approval" ? "승인 대기" : kind === "running" ? "작업 중" : kind === "growth" ? "업무 도구 추천" : kind === "error" ? "실패" : kind === "unknown" ? "상태 확인 필요" : "결과 저장";
  return count > 1 ? `${base} ${count}` : base;
}

function summarizeLiveChannels(
  items: Array<{
    teammateId: string;
    kind: "running" | "approval" | "result" | "growth" | "error" | "unknown";
    teammateName: string;
    channelName: string;
    teamLabel: string;
    statusLabel: string;
    workload: string;
    sourceLabel: string;
    focused: boolean;
  }>,
) {
  const byChannel = new Map<
    string,
    {
      id: string;
      kind: "running" | "approval" | "result" | "growth" | "error" | "unknown";
      label: string;
      channelName: string;
      statusLabel: string;
      detail: string;
      focused: boolean;
      count: number;
    }
  >();

  for (const item of items) {
    const current = byChannel.get(item.teammateId);
    if (!current) {
      byChannel.set(item.teammateId, {
        id: `channel:${item.teammateId}`,
        kind: item.kind,
        label: formatLiveChannelPrimaryLabel(item.teammateId, item.teammateName, item.channelName),
        channelName: formatLiveChannelSecondaryLabel(item.teammateId, item.teammateName, item.channelName, item.teamLabel),
        statusLabel: item.statusLabel,
        detail: item.workload || item.sourceLabel,
        focused: item.focused,
        count: 1,
      });
      continue;
    }

    current.kind = strongerLiveKind(current.kind, item.kind);
    current.focused = current.focused || item.focused;
    current.count += 1;
    current.statusLabel = liveStatusLabel(current.kind, current.count);
    current.detail = item.workload || current.detail || item.sourceLabel;
  }

  return Array.from(byChannel.values()).slice(0, 8);
}

function workVisualLabel(state: string) {
  if (state === "running") return "작업 중";
  if (state === "approval") return "승인 대기";
  if (state === "ready" || state === "result" || state === "growth" || state === "active") return "준비됨";
  if (state === "done") return "완료";
  return "대기";
}

function WorkSignal({
  state,
  label,
  compact = false,
}: {
  state: string;
  label: string;
  compact?: boolean;
}) {
  return (
    <span
      className={styles.workSignal}
      data-state={state}
      data-compact={compact ? "true" : "false"}
      aria-label={`${label}: ${workVisualLabel(state)}`}
      title={`${label}: ${workVisualLabel(state)}`}
      role="img"
    >
      <b aria-hidden="true" />
      <b aria-hidden="true" />
      <b aria-hidden="true" />
    </span>
  );
}

function summarizeAssignmentKinds(items: NonNullable<Props["channelQueueItems"]>): string[] {
  const kinds = new Set<string>();
  for (const item of items) {
    const source = `${item.sourceLabel} ${item.outputKind ?? ""} ${item.queueLabel ?? ""}`;
    if (/메일|mail|send_email|mailops/u.test(source)) kinds.add("메일");
    if (/문서|document|knowledge|보고서/u.test(source)) kinds.add("문서");
    if (/폴더|folder|정리 계획/u.test(source)) kinds.add("폴더");
    if (/외부 계정|내 PC 작업 도우미|computer_use|web_page/u.test(source)) kinds.add("외부 승인");
    if (/SkillGrowth|성장/u.test(source)) kinds.add("업무 개선");
  }
  return [...kinds].slice(0, 4);
}

type OfficeWorkMethodItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "learned" | "default" | "choice" | "approval";
};

type OfficeExecutionBoundaryItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "chat" | "workspace" | "setting" | "approval";
};

type ApprovalSafetyRailItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "safe" | "review" | "danger" | "locked";
};

type FinalActionApprovalReviewItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "safe" | "review" | "danger" | "locked";
};

type FinalActionAuditReceiptItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  recordPath: string;
  state: "ready" | "review" | "locked";
};

type ApprovalActionReadinessCard = {
  id: string;
  title: string;
  sourceLabel: string;
  riskLabel: string;
  readinessGuide: FinalActionReadinessGuide;
  commonChecks: ApprovalCommonCheckItem[];
  computerUseChecks: ApprovalCommonCheckItem[];
  preview: string;
  logPath: string;
  rollbackGuide: string;
  decisionGuide: string;
  nextUserChoice: string;
  decisionSteps: ApprovalDecisionPathStep[];
  state: "safe" | "review" | "danger" | "locked";
};

type ApprovalCommonCheckItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "ready" | "active" | "locked";
};

type ApprovalDecisionPathStep = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "ready" | "active" | "locked";
};

const officeDecisionActionLabels = "실행하기 · 고쳐달라고 하기 · 보류하기";
const officeDecisionMemoryLabel = "다음부터 이렇게";
const mobileDecisionReplyContract = "phone_reply_code_to_same_notification_target_then_app_final_confirmation";
const mobileDecisionVirtualOfficeEventPath =
  "mobile_notification_reply_to_channel_decision_to_virtual_office_event_to_final_confirmation";
const officeDecisionActionLogLabel = "실행하기 · 고쳐달라고 하기 · 보류하기 · 업무 기록";

type OfficeQualityGateItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  replacementUserPath: string;
  replacementFeatureId: string;
  replacementHomeAction: string;
  replacementHref: string;
  runtimeProofLabel: string;
  verifyCommand: string;
  nextUserChoice: string;
  originalExposurePolicy: string;
  replacementReadiness: string;
  replacementExecutionContract: string;
  absorptionConnectionHref?: string;
  absorptionConnectionLabel?: string;
  absorptionConnectionAction?: string;
  absorptionConnectionRole?: string;
  state: "ready" | "hidden" | "rebuild" | "progressive";
};

type BrowserTaskProgressStep = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "done" | "active" | "review" | "locked";
};

type BrowserTaskDecisionRailItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "active" | "review" | "locked";
};

type BrowserTaskResultReceiptItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  recordPath: string;
  state: "ready" | "review" | "locked";
};

type MemorySearchFinalActionSourceGuide = {
  resultKind: string;
  safetyLabel: string;
  nextUserChoice: string;
  sourcePath: string;
  draftPreview: string;
  state: "ready" | "review" | "locked";
};

type BulkRecipientListGuide = {
  sourceLabel: string;
  recipientSummary: string;
  readinessSummary: string;
  exceptionSummary: string;
  groupSummary: string;
  recommendationSummary: string;
  decisionOverrideSummary: string;
  effectiveRecipientSummary: string;
  decisionOverrideSourceSummary: string;
  decisionOverrideHistorySummary: string;
  decisionOverrideRollbackSummary: string;
  sendDecisionSummary: string;
  holdDecisionSummary: string;
  excludeDecisionSummary: string;
  learningDecisionSummary: string;
  exclusionRuleSummary: string;
  exclusionReasonSummary: string;
  groupSampleSummary: string;
  personalizationGapSummary: string;
  nextReviewFocus: string;
  learningProfileSummary: string;
  learnedTargetSummary: string;
  learnedApprovalHabitSummary: string;
  learnedDefaultDecisionSummary: string;
  learnedOverrideSuggestionSummary: string;
  learnedOverrideActionSummary: string;
  sampleSummary: string;
  privacyBoundary: string;
  state: "ready" | "review" | "locked";
};

type MailThreadRecipientGuide = {
  replyTargetLabel: string;
  recipientDecisionSummary: string;
  sendSummary: string;
  holdSummary: string;
  excludeSummary: string;
  learningDecisionSummary: string;
  privacyBoundary: string;
  state: "ready" | "review" | "locked";
};

type MailWorkReviewGuide = {
  proof: string;
  bundleLabel: string;
  nextUserAction: string;
  originalSummary: string;
  draftSummary: string;
  replyMethodLabel: string;
  sendDecisionReason: string;
  editFocusLabel: string;
  attachmentSummary: string;
  finalApprovalBoundary: string;
  privacyBoundary: string;
  triageSummaryLabel: string;
  triageImportantLabel: string;
  triagePolicyLabel: string;
  triageEvidenceChips: string[];
  reviewItems: Array<{
    id: string;
    label: string;
    state: string;
    detail: string;
  }>;
  state: "ready" | "review" | "locked";
};

type RepeatWorkOfficeApprovalItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  sourceLabel: string;
  riskLabel: string;
  previewLabel: string;
  decisionLabel: string;
  logLabel: string;
  undoLabel: string;
  state: "approval" | "ready" | "locked";
};

type ApprovalDecisionReceiptCard = {
  id: string;
  label: string;
  title: string;
  detail: string;
  executionStateLabel: string;
  recordPath: string;
  rollbackLabel: string;
  nextStep: string;
  parallelWorkNextChoice: string;
  parallelWorkAction: "today_check" | "workers" | "open_office";
  state: "saved" | "review" | "blocked";
  mailOpsWorkQueueReview?: {
    decisionLabel: string;
    note: string;
    context: string;
    externalMutationLabel: string;
  };
};

type MailOpsDecisionReceiptComparisonRow = {
  id: string;
  title: string;
  decisionLabel: string;
  executionStateLabel: string;
  nextChoiceLabel: string;
  reviewDecisionLabel: string;
  reviewNote: string;
  reviewContext: string;
  externalMutationLabel: string;
  state: ApprovalDecisionReceiptCard["state"];
};

type OfficeParallelWorkContinuityItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  action: "today_check" | "workers" | "open_office";
  href: string;
  state: "running" | "approval" | "ready" | "idle";
};

type FinalActionReadinessGuide = {
  label: string;
  title: string;
  detail: string;
  nextAction: string;
  state: "ready" | "review" | "locked";
};

type FinalActionUserStep = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: "ready" | "active" | "locked";
};

type FinalActionUserStepCopy = {
  connectionReadyTitle: string;
  connectionMissingTitle: string;
  connectionOpenTitle: string;
  connectionOpenDetail: string;
  dryRunReadyTitle: string;
  dryRunActionTitle: string;
  dryRunLockedTitle: string;
  dryRunActionDetail: string;
  dryRunLockedDetail: string;
  gateRecordedTitle: string;
  gateActiveTitle: string;
  gateLockedTitle: string;
  gateActiveDetail: string;
  gateLockedDetail: string;
};

function riskWeight(risk?: string) {
  if (risk === "blocked") return 4;
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  if (risk === "low") return 1;
  return 0;
}

function riskLabelText(risk?: string) {
  if (risk === "blocked") return "차단";
  if (risk === "high") return "높음";
  if (risk === "medium") return "중간";
  if (risk === "low") return "낮음";
  return "대기";
}

function finalActionReadinessGuide(item: WorkItem): FinalActionReadinessGuide {
  const actionLabel = finalActionMutationLabel(item);
  if (item.finalAction?.kind === "scenario_review") {
    const scenario = item.sourceEvidence?.scenarioReview;
    const scenarioEvidenceDetail = [
      scenario?.preparedOutput ? `준비 결과: ${scenario.preparedOutput}` : "",
      scenario?.verificationEvidence ? `검증 증거: ${scenario.verificationEvidence}` : "",
      scenario?.finalActionBoundary ? `실행 경계: ${scenario.finalActionBoundary}` : "",
    ].filter(Boolean).join(" / ");
    return {
      label: "검토 전용",
      title: "메일 업무 케이스 확인",
      detail: scenarioEvidenceDetail || "금액, 계약, 세무, 클레임, 수신거부 같은 위험 기준을 기록하고 외부 실행은 하지 않습니다.",
      nextAction: "검토 기록 남기기",
      state: "review",
    };
  }
  if (item.finalAction?.readiness === "ready_for_final_confirmation") {
    return {
      label: "최종 확인 준비",
      title: `${actionLabel} 전 확인 준비`,
      detail: "연결 상태는 확인됐지만 실행 전 검토와 사용자 최종 확인이 남아 있습니다.",
      nextAction: "마지막 확인 준비",
      state: "review",
    };
  }
  if (item.finalAction?.readiness === "adapter_not_connected") {
    const nextAction =
      item.finalAction.kind === "create_calendar_event"
        ? "캘린더 연결 확인"
        : item.finalAction.kind === "send_email"
          ? "메일 연결 확인"
          : "연결 상태 확인";
    return {
      label: "연결 필요",
      title: `${actionLabel} 연결 전 잠금`,
      detail: item.finalAction.blockedReason || "실제 실행에 필요한 연결이 준비되기 전까지 잠겨 있습니다.",
      nextAction,
      state: "locked",
    };
  }
  if (item.browserTask) {
    return {
      label: "화면 확인 필요",
      title: "클릭·입력 전 잠금",
      detail: "화면 증거와 대상 확인 전에는 실제 클릭이나 입력을 실행하지 않습니다.",
      nextAction: "내 PC 작업 도우미 확인",
      state: "locked",
    };
  }
  return {
    label: "승인 필요",
    title: `${actionLabel} 전 확인`,
    detail: "사용자가 승인, 수정, 보류를 고르기 전에는 외부 실행하지 않습니다.",
    nextAction: "오피스 승인함 확인",
    state: "review",
  };
}

function finalActionUserStepCopy(kind?: FinalActionKind): FinalActionUserStepCopy {
  if (kind === "scenario_review") {
    return {
      connectionReadyTitle: "검토 전용 준비",
      connectionMissingTitle: "검토 준비 확인",
      connectionOpenTitle: "메일 업무 검토 열기",
      connectionOpenDetail: "메일 연결 없이도 감지된 업무 종류와 위험 기준을 먼저 확인합니다.",
      dryRunReadyTitle: "검토값 확인 완료",
      dryRunActionTitle: "검토값 확인",
      dryRunLockedTitle: "검토 전 잠금",
      dryRunActionDetail: "업무 범위, 위험 기준, 다음 처리 결정을 기록합니다.",
      dryRunLockedDetail: "감지된 메일 업무 케이스를 확인한 뒤 검토 기록을 남깁니다.",
      gateRecordedTitle: "검토 기록 있음",
      gateActiveTitle: "검토 완료 기록",
      gateLockedTitle: "검토 기록 잠김",
      gateActiveDetail: "외부 발송, 등록, 제출 없이 검토 완료만 감사 기록으로 남깁니다.",
      gateLockedDetail: "검토값 확인 기록이 있어야 완료 기록을 남길 수 있습니다.",
    };
  }

  if (kind === "send_bulk_email") {
    return {
      connectionReadyTitle: "메일 연결됨",
      connectionMissingTitle: "메일 발송 연결 먼저",
      connectionOpenTitle: "대량 메일 마지막 확인 준비",
      connectionOpenDetail: "메일 연결 상태와 명단 확인값을 먼저 불러옵니다.",
      dryRunReadyTitle: "명단 검토 완료",
      dryRunActionTitle: "명단 검토 누르기",
      dryRunLockedTitle: "명단 검토 전 잠금",
      dryRunActionDetail: "발송 후보 수, 제외/중복, 제목, 샘플 문안을 실제 발송 전 확인합니다.",
      dryRunLockedDetail: "메일 연결이 확인된 뒤 명단과 샘플 문안을 검토합니다.",
      gateRecordedTitle: "대량 발송 확인 기록 있음",
      gateActiveTitle: "대량 발송 전 마지막 확인",
      gateLockedTitle: "대량 발송 잠금",
      gateActiveDetail: "실제 대량 발송으로 이어질 수 있는 마지막 조건을 앱 안에서 확인합니다.",
      gateLockedDetail: "명단 실행 전 검토 기록이 있어야 마지막 대량 발송 조건을 확인할 수 있습니다.",
    };
  }
  if (kind === "create_calendar_event") {
    return {
      connectionReadyTitle: "캘린더 연결됨",
      connectionMissingTitle: "캘린더 연결 먼저",
      connectionOpenTitle: "일정 마지막 확인 준비",
      connectionOpenDetail: "캘린더 쓰기 권한과 일정 후보를 먼저 불러옵니다.",
      dryRunReadyTitle: "일정 검토 완료",
      dryRunActionTitle: "일정 시간 검토",
      dryRunLockedTitle: "일정 검토 전 잠금",
      dryRunActionDetail: "일정 제목, 시작/종료 시간, 참석자, 알림을 등록 전에 확인합니다.",
      dryRunLockedDetail: "캘린더 연결이 확인된 뒤 일정 후보를 검토합니다.",
      gateRecordedTitle: "등록 확인 기록 있음",
      gateActiveTitle: "등록 전 마지막 확인",
      gateLockedTitle: "등록 전 마지막 확인 잠김",
      gateActiveDetail: "실제 캘린더 등록으로 이어질 수 있는 마지막 조건을 앱 안에서 확인합니다.",
      gateLockedDetail: "일정 검토 기록이 있어야 캘린더 등록 조건을 확인할 수 있습니다.",
    };
  }

  if (kind === "share_file") {
    return {
      connectionReadyTitle: "파일 연결됨",
      connectionMissingTitle: "파일/드라이브 연결 먼저",
      connectionOpenTitle: "공유 마지막 확인 준비",
      connectionOpenDetail: "파일 공유 연결과 공유 후보를 먼저 불러옵니다.",
      dryRunReadyTitle: "공유 검토 완료",
      dryRunActionTitle: "공유 범위 검토",
      dryRunLockedTitle: "공유 검토 전 잠금",
      dryRunActionDetail: "공유 대상, 권한 범위, 민감정보 포함 여부를 공유 전에 확인합니다.",
      dryRunLockedDetail: "파일/드라이브 연결이 확인된 뒤 공유 범위를 검토합니다.",
      gateRecordedTitle: "공유 확인 기록 있음",
      gateActiveTitle: "공유 전 마지막 확인",
      gateLockedTitle: "공유 전 마지막 확인 잠김",
      gateActiveDetail: "실제 파일 공유로 이어질 수 있는 마지막 조건을 앱 안에서 확인합니다.",
      gateLockedDetail: "공유 범위 검토 기록이 있어야 파일 공유 조건을 확인할 수 있습니다.",
    };
  }

  return {
    connectionReadyTitle: "연결됨",
    connectionMissingTitle: "메일 연결 먼저",
    connectionOpenTitle: "마지막 확인 준비",
    connectionOpenDetail: "메일 연결 상태와 확인할 값을 먼저 불러옵니다.",
    dryRunReadyTitle: "검토 완료",
    dryRunActionTitle: "검토 누르기",
    dryRunLockedTitle: "검토 전 잠금",
    dryRunActionDetail: "수신자, 제목, 본문, 첨부 여부를 실제 발송 전 한 번 더 확인합니다.",
    dryRunLockedDetail: "메일 연결이 확인된 뒤 실행 전 검토를 진행합니다.",
    gateRecordedTitle: "확인 기록 있음",
    gateActiveTitle: "마지막 확인",
    gateLockedTitle: "실행 잠금",
    gateActiveDetail: "실제 발송으로 이어질 수 있는 마지막 조건을 앱 안에서 확인합니다.",
    gateLockedDetail: "실행 전 검토 기록이 있어야 마지막 발송 조건을 확인할 수 있습니다.",
  };
}

function finalActionUserStepKind(kind?: NonNullable<WorkItem["finalAction"]>["kind"] | FinalActionKind): FinalActionKind | undefined {
  if (
    kind === "send_email" ||
    kind === "send_bulk_email" ||
    kind === "create_calendar_event" ||
    kind === "share_file" ||
    kind === "scenario_review"
  ) {
    return kind;
  }
  return undefined;
}

function buildFinalActionUserSteps(input: {
  item: WorkItem;
  confirmation: FinalConfirmationContract | null;
  dryRun: FinalActionDryRunResult | null;
  dryRunReady: boolean;
  execution: FinalActionExecutionResult | null;
  finalConfirmationMessage?: string;
}): FinalActionUserStep[] {
  const hasFinalAction = Boolean(input.item.finalAction);
  const connectionReady = Boolean(input.confirmation?.adapterConnected);
  const connectionKnown = Boolean(input.confirmation);
  const messageConfirmsFinalAction = /마지막 확인 완료|실제 처리 요청 완료|실행 요청/u.test(input.finalConfirmationMessage ?? "");
  const executionRecorded = Boolean(input.execution?.auditId || input.execution?.status || input.execution?.userMessage || messageConfirmsFinalAction);
  const copy = finalActionUserStepCopy(finalActionUserStepKind(input.confirmation?.actionKind ?? input.item.finalAction?.kind));
  return [
    {
      id: "connection",
      label: "1 연결 확인",
      title: connectionReady
        ? copy.connectionReadyTitle
        : connectionKnown
          ? copy.connectionMissingTitle
          : copy.connectionOpenTitle,
      detail: connectionReady
        ? input.confirmation?.adapter.userMessage || "필요한 연결을 확인했습니다."
        : connectionKnown
          ? input.confirmation?.adapter.userMessage || "필요한 연결을 먼저 완료해야 합니다."
          : copy.connectionOpenDetail,
      state: connectionReady ? "ready" : hasFinalAction ? "active" : "locked",
    },
    {
      id: "dry-run",
      label: "2 실행 전 검토",
      title: input.dryRunReady ? copy.dryRunReadyTitle : connectionReady ? copy.dryRunActionTitle : copy.dryRunLockedTitle,
      detail: input.dryRunReady
        ? input.dryRun?.userMessage || "내용, 대상, 필수값 검토 기록이 준비됐습니다."
        : connectionReady
          ? copy.dryRunActionDetail
          : copy.dryRunLockedDetail,
      state: input.dryRunReady ? "ready" : connectionReady ? "active" : "locked",
    },
    {
      id: "gate",
      label: "3 마지막 확인",
      title: executionRecorded ? copy.gateRecordedTitle : input.dryRunReady ? copy.gateActiveTitle : copy.gateLockedTitle,
      detail: executionRecorded
        ? input.execution?.userMessage || input.finalConfirmationMessage || "최종 실행 조건 확인 기록이 남았습니다."
        : input.dryRunReady
          ? copy.gateActiveDetail
          : copy.gateLockedDetail,
      state: executionRecorded ? "ready" : input.dryRunReady ? "active" : "locked",
    },
  ];
}

function extractLabeledNoteValue(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = text.match(new RegExp(`(?:^|\\n)${escaped}:\\s*([^\\n]+)`, "u"));
  return match?.[1]?.trim() ?? "";
}

function buildMemorySearchFinalActionSourceGuide(item: WorkItem): MemorySearchFinalActionSourceGuide | null {
  const noteText = [item.body, item.summary, item.draft?.body, item.approvedOutput?.path, item.approvedOutput?.name]
    .filter(Boolean)
    .join("\n");
  const looksLikeMemorySearchDraft =
    /memory_search_draft|지난 업무 초안|지난 업무|검색 종류:/u.test(noteText) ||
    item.approvedOutput?.kind === "execution_candidate";
  if (!looksLikeMemorySearchDraft) return null;

  const resultKind = extractLabeledNoteValue(noteText, "검색 종류") || "지난 업무 초안";
  const safetyLabel =
    extractLabeledNoteValue(noteText, "안전 경계") ||
    item.finalAction?.blockedReason ||
    "외부 발송, 일정 등록, 파일 변경은 앱의 마지막 확인 전까지 잠급니다.";
  const nextUserChoice =
    extractLabeledNoteValue(noteText, "다음 선택") ||
    officeNextUserChoiceForWorkItem(item);
  const sourcePath =
    extractLabeledNoteValue(noteText, "출처") ||
    item.approvedOutput?.path ||
    "memory/work-patterns/WorkPatternMemory.md";
  const draftPreview =
    extractLabeledNoteValue(noteText, "초안") ||
    item.draft?.body ||
    item.summary ||
    "지난 업무 검색 결과를 바탕으로 만든 초안입니다.";

  return {
    resultKind,
    safetyLabel,
    nextUserChoice,
    sourcePath,
    draftPreview: draftPreview.length > 180 ? `${draftPreview.slice(0, 180)}...` : draftPreview,
    state: item.finalAction?.readiness === "ready_for_final_confirmation" ? "review" : "locked",
  };
}

function countLabel(value: number | null | undefined, fallback = "0") {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value)).toLocaleString("ko-KR");
}

function safeCount(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function countFromLabel(label: unknown, fallback = 1) {
  if (typeof label !== "string") return fallback;
  const match = label.match(/(\d+)\s*(?:건|명|행)/u);
  return match?.[1] ? safeCount(Number(match[1]), fallback) : fallback;
}

function normalizeRecipientDecisionRows(values: unknown, fallbackLabel: string, fallbackCount = 0) {
  const rows = Array.isArray(values) ? values : [];
  const normalizedRows = rows
    .map((entry, index) => {
      if (entry && typeof entry === "object") {
        const row = entry as { label?: unknown; count?: unknown; reason?: unknown };
        const label = typeof row.label === "string" && row.label.trim()
          ? row.label
          : `${fallbackLabel} ${index + 1}`;
        return {
          label,
          count: safeCount(row.count, countFromLabel(label, fallbackCount || 1)),
          reason: typeof row.reason === "string" && row.reason.trim() ? row.reason : "메일 작업대 검토 기준",
        };
      }
      const label = typeof entry === "string" && entry.trim() ? entry : `${fallbackLabel} ${index + 1}`;
      return {
        label,
        count: rows.length === 1 && fallbackCount > 0 ? fallbackCount : countFromLabel(label),
        reason: "메일 작업대 검토 기준",
      };
    })
    .filter((row) => row.label);

  if (!normalizedRows.length && fallbackCount > 0) {
    return [{ label: fallbackLabel, count: fallbackCount, reason: "메일 작업대 집계 기준" }];
  }
  return normalizedRows;
}

function normalizeRecipientGroupRows(values: unknown, fallbackLabel: string, fallbackCount = 0) {
  const rows = Array.isArray(values) ? values : [];
  const normalizedRows = rows
    .map((entry, index) => {
      if (entry && typeof entry === "object") {
        const row = entry as { label?: unknown; count?: unknown; reason?: unknown };
        const label = typeof row.label === "string" && row.label.trim()
          ? row.label
          : `${fallbackLabel} ${index + 1}`;
        return {
          label,
          count: safeCount(row.count, countFromLabel(label, fallbackCount || 1)),
          reason: typeof row.reason === "string" && row.reason.trim() ? row.reason : "메일 작업대 검토 기준",
        };
      }
      const label = typeof entry === "string" && entry.trim() ? entry : `${fallbackLabel} ${index + 1}`;
      return {
        label,
        count: rows.length === 1 && fallbackCount > 0 ? fallbackCount : countFromLabel(label),
        reason: "메일 작업대 검토 기준",
      };
    })
    .filter((row) => row.label);

  if (!normalizedRows.length && fallbackCount > 0) {
    return [{ label: fallbackLabel, count: fallbackCount, reason: "메일 작업대 집계 기준" }];
  }
  return normalizedRows;
}

function normalizeMailOpsRecipientListReview(
  review: WorkSourceRecipientListReview | undefined,
): MailOpsRecipientListReviewInput | undefined {
  if (!review) return undefined;
  const source = review as WorkSourceRecipientListReview & Partial<MailOpsRecipientListReviewInput> & {
    recommendedGroupLabels?: string[];
    targetGroupLabels?: string[];
    exclusionRuleLabels?: string[];
    exclusionReasonLabels?: string[];
    groupSamplePreviewLabels?: string[];
    personalizationGapLabels?: string[];
    samplePreviewCount?: number;
  };
  const rowCount = safeCount(source.rowCount);
  const validRecipientCount = safeCount(source.validRecipientCount, rowCount);
  const effectiveRecipientCount = safeCount(source.userDecisionOverride?.effectiveRecipientCount, -1);
  const candidateCount = effectiveRecipientCount >= 0
    ? effectiveRecipientCount
    : safeCount(source.candidateCount, validRecipientCount);
  const excludedCount = safeCount(source.excludedCount);
  const duplicateCount = safeCount(source.duplicateCount);
  const missingAddressCount = safeCount(source.missingAddressCount);
  const missingPersonalizationCount = safeCount(source.missingPersonalizationCount);
  const readyForSampleCount = safeCount(source.readyForSampleCount, safeCount(source.samplePreviewCount));
  const personalizationReviewCount = safeCount(source.personalizationReviewCount, missingPersonalizationCount);
  const derivedExcludeCount = Math.max(excludedCount + duplicateCount + missingAddressCount, validRecipientCount - candidateCount, 0);
  const holdCount = Math.max(missingAddressCount, source.userDecisionOverride?.holdLabels?.length ?? 0);
  const sendRows = normalizeRecipientDecisionRows(
    source.recipientDecisionMatrix?.send ?? source.userDecisionOverride?.includeLabels ?? source.recommendedGroupLabels ?? source.targetGroupLabels,
    "발송 후보",
    candidateCount,
  );
  const holdRows = normalizeRecipientDecisionRows(
    source.recipientDecisionMatrix?.hold ?? source.userDecisionOverride?.holdLabels,
    "보류 후보",
    holdCount,
  );
  const excludeRows = normalizeRecipientDecisionRows(
    source.recipientDecisionMatrix?.exclude ?? source.userDecisionOverride?.excludeLabels ?? source.exclusionReasonLabels,
    "제외 후보",
    derivedExcludeCount,
  );
  const samplePreviewCount = safeCount(
    Array.isArray(source.samplePreviews) ? source.samplePreviews.length : source.samplePreviewCount,
    readyForSampleCount,
  );
  const samplePreviews = Array.isArray(source.samplePreviews) && source.samplePreviews.length
    ? source.samplePreviews
    : Array.from({ length: samplePreviewCount }, (_, index) => ({
        id: `mailops-sample-${index + 1}`,
        groupLabel: source.targetGroupLabels?.[index] || source.recommendedGroupLabels?.[index] || "샘플 문안",
        personalizationKeys: [],
        missingPersonalizationKeys: index < personalizationReviewCount ? ["확인 필요"] : [],
        riskLabels: [],
        status: index < readyForSampleCount ? "ready_for_sample" as const : "needs_review" as const,
      }));

  return {
    status: source.status === "needs_columns" || source.status === "empty" ? source.status : "review_required",
    sourceLabel: source.sourceLabel || "대량 메일 명단",
    sourceType: source.sourceType || "manual",
    rowCount,
    candidateCount,
    validRecipientCount,
    readyForSampleCount,
    personalizationReviewCount,
    excludedCount,
    duplicateCount,
    missingAddressCount,
    missingPersonalizationCount,
    detectedColumns: source.detectedColumns ?? {
      personalizationColumns: [],
    },
    targetGroups: normalizeRecipientGroupRows(source.targetGroups ?? source.targetGroupLabels, "대상 그룹", validRecipientCount),
    recommendedTargetGroups: normalizeRecipientGroupRows(
      source.recommendedTargetGroups ?? source.recommendedGroupLabels,
      "추천 그룹",
      candidateCount,
    ),
    recipientDecisionMatrix: {
      send: sendRows,
      hold: holdRows,
      exclude: excludeRows,
    },
    exclusionRuleSummary: source.exclusionRuleSummary ?? source.exclusionRuleLabels ?? [],
    exclusionReasonBreakdown: normalizeRecipientGroupRows(
      source.exclusionReasonBreakdown ?? source.exclusionReasonLabels,
      "제외 사유",
      derivedExcludeCount,
    ),
    groupSamplePreviews: Array.isArray(source.groupSamplePreviews)
      ? source.groupSamplePreviews
      : (source.groupSamplePreviewLabels ?? []).map((label, index) => ({
          groupLabel: label,
          validCount: countFromLabel(label, 1),
          sampleCount: countFromLabel(label, 1),
          readySampleCount: index < readyForSampleCount ? 1 : 0,
          reviewSampleCount: index < personalizationReviewCount ? 1 : 0,
          personalizationKeys: [],
          missingPersonalizationKeys: index < personalizationReviewCount ? ["확인 필요"] : [],
          riskLabels: [],
        })),
    personalizationGapSummary: source.personalizationGapSummary ?? source.personalizationGapLabels ?? [],
    recipientDecisionSummary: source.recipientDecisionSummary || "명단, 제외 규칙, 샘플 문안을 최종 확인해야 합니다.",
    nextReviewFocus: source.nextReviewFocus || "명단과 샘플 문안을 확인한 뒤 마지막 확인으로 이동하세요.",
    samplePreviews,
    dryRunSummary: source.dryRunSummary ?? {
      wouldSendCount: candidateCount,
      wouldExcludeCount: derivedExcludeCount,
      readyForSampleCount,
      personalizationReviewCount,
      sampleSize: samplePreviewCount,
      blockedReason: source.dryRunBlockedReason || "최종 확인 전까지 실제 발송 차단",
    },
    checklist: source.checklist ?? [
      "명단 행 수와 발송 후보 수 확인",
      "제외, 수신거부, 중복, 주소 누락 확인",
      "샘플 문안과 개인화 값 확인",
      "최종 승인 전까지 실제 발송 차단",
    ],
    approvalGate: source.approvalGate || source.userDecisionOverride?.approvalGate || "최종 승인 전까지 발송하지 않습니다.",
    privacyBoundary: source.privacyBoundary || "대량 메일 명단의 원문 주소는 작업대 요약에 노출하지 않습니다.",
  };
}

function findMailOpsRecipientListReview(items: WorkItem[]): MailOpsRecipientListReviewInput | undefined {
  for (const item of items) {
    const review = normalizeMailOpsRecipientListReview(item.sourceEvidence?.recipientListReview);
    if (review) return review;
  }
  return undefined;
}

function buildBulkRecipientListGuide(item: WorkItem): BulkRecipientListGuide | null {
  if (item.finalAction?.kind !== "send_bulk_email") return null;
  const review = item.sourceEvidence?.recipientListReview;
  if (!review) return null;
  const validRecipientCount = countLabel(review.validRecipientCount);
  const readyForSampleCount = countLabel(review.readyForSampleCount);
  const personalizationReviewCount = countLabel(review.personalizationReviewCount);
  const rowCount = countLabel(review.rowCount);
  const excludedCount = countLabel(review.excludedCount);
  const duplicateCount = countLabel(review.duplicateCount);
  const missingAddressCount = countLabel(review.missingAddressCount);
  const targetGroupLabels = review.targetGroupLabels?.filter(Boolean).slice(0, 4) ?? [];
  const recommendedGroupLabels = review.recommendedGroupLabels?.filter(Boolean).slice(0, 3) ?? [];
  const sendDecisionLabels = review.recipientDecisionMatrix?.send?.filter(Boolean).slice(0, 3) ?? [];
  const holdDecisionLabels = review.recipientDecisionMatrix?.hold?.filter(Boolean).slice(0, 3) ?? [];
  const excludeDecisionLabels = review.recipientDecisionMatrix?.exclude?.filter(Boolean).slice(0, 3) ?? [];
  const exclusionRuleLabels = review.exclusionRuleLabels?.filter(Boolean).slice(0, 3) ?? [];
  const exclusionReasonLabels = review.exclusionReasonLabels?.filter(Boolean).slice(0, 4) ?? [];
  const groupSamplePreviewLabels = review.groupSamplePreviewLabels?.filter(Boolean).slice(0, 4) ?? [];
  const personalizationGapLabels = review.personalizationGapLabels?.filter(Boolean).slice(0, 4) ?? [];
  const learnedTargetGroupLabels = review.learnedTargetGroupLabels?.filter(Boolean).slice(0, 4) ?? [];
  const learnedApprovalHabitLabels = review.learnedApprovalHabitLabels?.filter(Boolean).slice(0, 3) ?? [];
  const learnedIncludeOverrideLabels = review.learnedIncludeOverrideLabels?.filter(Boolean).slice(0, 3) ?? [];
  const learnedExcludeOverrideLabels = review.learnedExcludeOverrideLabels?.filter(Boolean).slice(0, 3) ?? [];
  const learnedHoldOverrideLabels = review.learnedHoldOverrideLabels?.filter(Boolean).slice(0, 3) ?? [];
  const learnedDefaultDecisionLabels = [
    ...(review.learnedDefaultDecisionMatrix?.send?.filter(Boolean).slice(0, 2) ?? []),
    ...(review.learnedDefaultDecisionMatrix?.exclude?.filter(Boolean).slice(0, 2) ?? []),
    ...(review.learnedDefaultDecisionMatrix?.hold?.filter(Boolean).slice(0, 2) ?? []),
  ];
  const learningDecisionHints = review.learningDecisionHints?.filter(Boolean).slice(0, 3) ?? [];
  const decisionOverride = review.userDecisionOverride;
  const decisionOverrideHistory = decisionOverride?.history?.filter((entry) => entry?.summary).slice(-3) ?? [];
  const overrideEffectiveCount =
    typeof decisionOverride?.effectiveRecipientCount === "number" && Number.isFinite(decisionOverride.effectiveRecipientCount)
      ? decisionOverride.effectiveRecipientCount
      : null;

  return {
    sourceLabel: review.sourceLabel || item.sourceLabel || "명단 자료",
    recipientSummary: overrideEffectiveCount !== null
      ? `전체 ${rowCount}행 중 수정 후 발송 후보 ${countLabel(overrideEffectiveCount)}명`
      : `전체 ${rowCount}행 중 발송 후보 ${validRecipientCount}명`,
    readinessSummary: `바로 샘플 가능 ${readyForSampleCount}명 · 개인화 확인 필요 ${personalizationReviewCount}명`,
    exceptionSummary: `제외 ${excludedCount}명 · 중복 ${duplicateCount}건 · 주소 누락 ${missingAddressCount}건`,
    groupSummary: targetGroupLabels.length ? targetGroupLabels.join(", ") : "대상 그룹 확인 필요",
    recommendationSummary:
      recommendedGroupLabels.length > 0
        ? recommendedGroupLabels.join(" / ")
        : review.recipientDecisionSummary || "추천 대상 그룹 확인 필요",
    decisionOverrideSummary: decisionOverride?.summary
      ? [
          decisionOverride.patchSummary ? `이번 수정 ${decisionOverride.patchSummary}` : "",
          decisionOverride.summary,
          decisionOverride.includeLabels?.length ? `포함 ${decisionOverride.includeLabels.join(", ")}` : "",
          decisionOverride.excludeLabels?.length ? `제외 ${decisionOverride.excludeLabels.join(", ")}` : "",
          decisionOverride.holdLabels?.length ? `보류 ${decisionOverride.holdLabels.join(", ")}` : "",
        ].filter(Boolean).join(" / ")
      : "사용자 수정 요청 없음",
    effectiveRecipientSummary: overrideEffectiveCount !== null
      ? `수정 후 후보 ${countLabel(overrideEffectiveCount)}명 · ${decisionOverride?.countBasis || "사용자 수정 요청 기준"}`
      : `현재 후보 ${validRecipientCount}명 · 원본 명단 검토 기준`,
    decisionOverrideSourceSummary: decisionOverride?.source === "learned_suggestion"
      ? `학습 수정 추천 기준${decisionOverride.sourceSummary ? ` · ${decisionOverride.sourceSummary}` : ""}`
      : decisionOverride?.sourceSummary || "사용자 직접 수정 또는 원본 명단 검토 기준",
    decisionOverrideHistorySummary: decisionOverrideHistory.length
      ? decisionOverrideHistory.map((entry, index) => `${index + 1}. ${entry.patchSummary ? `${entry.patchSummary} - ` : ""}${entry.summary}`).join(" / ")
      : "수정 요청 이력 없음",
    decisionOverrideRollbackSummary: decisionOverrideHistory.length
      ? "최종 실행 전 '원래대로' 또는 '보류'라고 말하면 수정본을 되돌리거나 잠글 수 있습니다."
      : "수정 요청이 생기면 승인 전 이력으로 남겨 되돌릴 수 있습니다.",
    sendDecisionSummary: sendDecisionLabels.length
      ? sendDecisionLabels.join(" / ")
      : "발송 추천 그룹 확인 필요",
    holdDecisionSummary: holdDecisionLabels.length
      ? holdDecisionLabels.join(" / ")
      : "보류할 대상 없음",
    excludeDecisionSummary: excludeDecisionLabels.length
      ? excludeDecisionLabels.join(" / ")
      : "명시 제외 대상 없음",
    learningDecisionSummary: learningDecisionHints.length
      ? learningDecisionHints.join(" / ")
      : "과거 발송 패턴과 현재 명단의 일치 여부는 아직 부족합니다.",
    exclusionRuleSummary:
      exclusionRuleLabels.length > 0
        ? exclusionRuleLabels.join(" / ")
        : "수신거부, 제외 대상, 중복 주소 규칙 확인 필요",
    exclusionReasonSummary:
      exclusionReasonLabels.length > 0
        ? exclusionReasonLabels.join(" / ")
        : "제외 사유별 카운트는 명단 검토 뒤 표시됩니다.",
    groupSampleSummary:
      groupSamplePreviewLabels.length > 0
        ? groupSamplePreviewLabels.join(" / ")
        : "그룹별 샘플 확인 필요",
    personalizationGapSummary:
      personalizationGapLabels.length > 0
        ? personalizationGapLabels.join(" / ")
        : review.missingPersonalizationCount
          ? `개인화 누락 ${countLabel(review.missingPersonalizationCount)}건 확인 필요`
          : "개인화 누락 없음 또는 확인 대기",
      nextReviewFocus: review.nextReviewFocus || "추천 대상 그룹과 제외 규칙을 확인한 뒤 실행 전 검토를 진행하세요.",
    learningProfileSummary:
      review.learningProfileSummary || "저장된 메일 발송 결정 패턴이 있으면 다음 추천에 참고합니다.",
    learnedTargetSummary: learnedTargetGroupLabels.length
      ? learnedTargetGroupLabels.join(", ")
      : "저장된 대상 그룹 학습 없음",
    learnedApprovalHabitSummary: learnedApprovalHabitLabels.length
      ? learnedApprovalHabitLabels.join(" / ")
      : "저장된 승인 습관 없음",
    learnedDefaultDecisionSummary: review.learnedDefaultDecisionSummary || (
      learnedDefaultDecisionLabels.length
        ? `다음 검토 기본 추천: ${learnedDefaultDecisionLabels.join(" / ")}`
        : "학습 기본 추천 없음"
    ),
    learnedOverrideSuggestionSummary: review.learnedOverrideSuggestionSummary || [
      learnedIncludeOverrideLabels.length ? `포함 ${learnedIncludeOverrideLabels.join(", ")}` : "",
      learnedExcludeOverrideLabels.length ? `제외 ${learnedExcludeOverrideLabels.join(", ")}` : "",
      learnedHoldOverrideLabels.length ? `보류 ${learnedHoldOverrideLabels.join(", ")}` : "",
    ].filter(Boolean).join(" / ") || "저장된 명단 수정 선호 없음",
    learnedOverrideActionSummary: review.learnedOverrideSuggestionSummary
      ? "채팅에서 '학습 추천 적용' 또는 '학습 추천 무시'라고 말하면 승인 전 수정본에 반영하거나 유지합니다."
      : "학습 추천이 쌓이면 채팅으로 적용하거나 무시할 수 있습니다.",
    sampleSummary: review.samplePreviewCount
      ? `샘플 ${countLabel(review.samplePreviewCount)}건 확인`
      : "샘플 문안 확인 필요",
    privacyBoundary: [
      review.privacyBoundary || "수신자 이름과 이메일 원문은 화면에 직접 표시하지 않습니다.",
      review.learningPrivacyBoundary,
    ]
      .filter(Boolean)
      .join(" "),
    state: item.finalAction?.readiness === "ready_for_final_confirmation" ? "review" : "locked",
  };
}

function buildMailThreadRecipientGuide(item: WorkItem): MailThreadRecipientGuide | null {
  if (item.finalAction?.kind !== "send_email") return null;
  const decision = item.sourceEvidence?.mailThreadRecipientDecision;
  if (!decision) return null;
  const sendLabels = decision.sendCandidateLabels?.filter(Boolean).slice(0, 3) ?? [];
  const holdLabels = decision.holdCandidateLabels?.filter(Boolean).slice(0, 3) ?? [];
  const excludeLabels = decision.excludeCandidateLabels?.filter(Boolean).slice(0, 3) ?? [];
  const learningHints = decision.learningDecisionHints?.filter(Boolean).slice(0, 3) ?? [];
  return {
    replyTargetLabel: decision.replyTargetLabel || "보낸 사람 확인",
    recipientDecisionSummary: decision.recipientDecisionSummary || "답장 대상 후보를 최종 확인해야 합니다.",
    sendSummary: sendLabels.length ? sendLabels.join(" / ") : "답장 후보 확인 필요",
    holdSummary: holdLabels.length ? holdLabels.join(" / ") : "보류할 수신자 신호 없음",
    excludeSummary: excludeLabels.length ? excludeLabels.join(" / ") : "명시 제외 대상 없음",
    learningDecisionSummary: learningHints.length
      ? learningHints.join(" / ")
      : "저장된 업무 방식이 있으면 수신자 판단에 참고합니다.",
    privacyBoundary: decision.privacyBoundary || "원문 이메일 주소는 화면에 직접 표시하지 않습니다.",
    state: item.finalAction?.readiness === "ready_for_final_confirmation" ? "review" : "locked",
  };
}

function buildMailWorkReviewGuide(item: WorkItem): MailWorkReviewGuide | null {
  if (item.finalAction?.kind !== "send_email" && item.finalAction?.kind !== "create_calendar_event") return null;
  const review = item.sourceEvidence?.mailWorkReview;
  if (!review) return null;
  const bundle = item.sourceEvidence?.mailWorkBundle;
  const triage = item.sourceEvidence?.mailTriageEvidence;
  const triageEvidenceChips = [
    triage?.priorityLabel,
    ...(triage?.workKindLabels ?? []),
    triage?.classificationReason,
  ]
    .filter((chip): chip is string => Boolean(chip))
    .slice(0, 5);
  const reviewItems = (review.reviewItems ?? [])
    .filter((entry) => entry?.label || entry?.detail)
    .slice(0, 6)
    .map((entry, index) => ({
      id: entry.id || `mail-work-review-${index}`,
      label: entry.label || "검토",
      state: entry.state || "needs_review",
      detail: entry.detail || "최종 확인 전 다시 점검합니다.",
    }));
  return {
    proof: review.proof || "mail_work_review_to_final_confirmation",
    bundleLabel: bundle?.bundleLabel || review.workScenarioLabel || "메일 업무 후보",
    nextUserAction: bundle?.nextUserAction || "원문, 초안, 일정 후보를 확인한 뒤 필요한 실행만 승인합니다.",
    originalSummary: review.originalSummary || item.sourceEvidence?.messageSnippet || item.summary || "메일 원문 요약 확인 필요",
    draftSummary: review.draftSummary || item.sourceEvidence?.draftPreview || item.draft?.body || "답장 초안 확인 필요",
    replyMethodLabel: review.replyMethodLabel || "답장 초안 수정 후 승인 발송",
    sendDecisionReason: review.sendDecisionReason || "업무 후보로 분류됐지만 최종 확인 전까지 발송하지 않습니다.",
    editFocusLabel: review.editFocusLabel || "수신자, 본문, 첨부, 위험 표현",
    attachmentSummary: review.attachmentSummary || "첨부/링크 누락 여부를 최종 확인에서 점검합니다.",
    finalApprovalBoundary: review.finalApprovalBoundary || "승인 대기 항목만 오피스 마지막 확인으로 이동합니다.",
    privacyBoundary: review.privacyBoundary || "메일 주소와 비밀번호, 로그인 승인 정보는 표시하지 않습니다.",
    triageSummaryLabel:
      triage?.distributionLabel ||
      `분류 ${triage?.classification || "업무 후보"} · 제외 ${triage?.ignoredNoiseCount ?? 0}건`,
    triageImportantLabel:
      triage?.importantWorkLabel ||
      `답장 ${triage?.replyDraftCandidateCount ?? 0} · 일정 ${triage?.calendarDraftCandidateCount ?? 0} · 첨부 ${triage?.attachmentSignalCandidateCount ?? 0}`,
    triagePolicyLabel:
      triage?.safetyBoundary ||
      "광고/뉴스레터/스팸성 메일은 본문 preview 전에 제외하고 업무 후보만 승인 대기 작업으로 넘깁니다.",
    triageEvidenceChips: triageEvidenceChips.length ? triageEvidenceChips : ["업무 후보", "최종 확인 전 실행 없음"],
    reviewItems,
    state: item.finalAction?.readiness === "ready_for_final_confirmation" ? "review" : "locked",
  };
}

function userComposedMailReviewStateLabel(state: string | undefined) {
  if (state === "ok") return "통과";
  if (state === "missing") return "입력 필요";
  return "확인 필요";
}

function isUserComposedMailReviewItem(item: WorkItem) {
  return item.sourceEvidence?.providerId === "user_composed_mail_check_result_to_approval_preview";
}

function userComposedMailDraftFieldsForItem(item: WorkItem): UserComposedMailDraftFields {
  const sendReviewItems = item.sourceEvidence?.userComposedMailReview?.sendReviewItems ?? [];
  const attachmentReviewTitle = sendReviewItems.find((review) => review.id === "attachment")?.title;
  const attachmentChecklist = item.finalAction?.checklist.find((check) => /첨부/u.test(check));
  const attachments = (attachmentReviewTitle || attachmentChecklist || "")
    .replace(/^첨부\s*확인\s*:\s*/u, "")
    .trim();
  return {
    to: item.sourceEvidence?.replyToLabel || "",
    subject: item.sourceEvidence?.messageSubject || "",
    body: item.sourceEvidence?.draftPreview || item.draft?.body || item.body || "",
    attachments,
  };
}

function upsertUserComposedMailApprovalWorkItemInStorage(item: WorkItem): void {
  if (typeof window === "undefined") return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(userComposedMailApprovalStorageKey) || "[]");
    const current = Array.isArray(parsed) ? parsed.filter((entry) => entry?.id !== item.id) : [];
    window.localStorage.setItem(userComposedMailApprovalStorageKey, JSON.stringify([item, ...current].slice(0, 6)));
  } catch {
    window.localStorage.setItem(userComposedMailApprovalStorageKey, JSON.stringify([item]));
  }
}

function finalConfirmationConnectActionLabel(confirmation: FinalConfirmationContract): string {
  if (confirmation.adapterConnected) return "연결 관리";
  const label = confirmation.adapter.connectLabel || confirmation.adapter.label || "연결";
  return /하기$/u.test(label) ? label : `${label}하기`;
}

function finalConfirmationConnectHref(confirmation: FinalConfirmationContract): string {
  const href = confirmation.adapter.connectHref || "/connect";
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("from", "office");
  params.set("panel", "office");
  params.set("goal", `${confirmation.actionLabel} 연결 후 마지막 확인 준비`);
  if (confirmation.adapter.connectorId && !params.get("connector")) {
    params.set("connector", confirmation.adapter.connectorId);
  }
  return `${path}?${params.toString()}`;
}

function finalConfirmationResumeConnectHref(confirmation: FinalConfirmationContract, item: WorkItem, connectHref?: string): string {
  const href = connectHref || finalConfirmationConnectHref(confirmation);
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  const returnTo = `/office?from=connect-recovery&panel=office&focusFinalAction=${encodeURIComponent(item.id)}`;
  params.set("from", "office");
  params.set("panel", "office");
  params.set("resume", "mail_final_confirmation");
  params.set("resumeWorkItemId", item.id);
  params.set("resumeSource", "provider_dispatch_recovery");
  params.set("returnTo", returnTo);
  if (!params.get("goal")) {
    params.set("goal", `${confirmation.actionLabel} 권한 복구 후 같은 승인 메일로 돌아가기`);
  }
  if (confirmation.adapter.connectorId && !params.get("connector")) {
    params.set("connector", confirmation.adapter.connectorId);
  }
  return `${path}?${params.toString()}`;
}

function isFinalActionSentForOffice(
  item: WorkItem,
  execution: { status?: string; alreadySent?: boolean } | null | undefined,
): boolean {
  return (
    Boolean(item.finalAction?.sentAt) ||
    item.finalAction?.readiness === "sent" ||
    execution?.status === "final_execution_provider_dispatched" ||
    execution?.status === "final_execution_provider_partial" ||
    execution?.status === "final_execution_already_sent" ||
    execution?.alreadySent === true
  );
}

function finalExecutionGateRecoveryPlan(confirmation: FinalConfirmationContract) {
  const gate = confirmation.finalExecutionGate;
  const mailSendApproved =
    gate?.actionKind === "send_email" &&
    gate.mailSendApprovalGateStatus === "approve" &&
    gate.adapterConnected === true &&
    confirmation.adapterConnected === true;
  const dispatchStatus = gate?.liveAdapterDispatchStatus ?? (mailSendApproved ? "live_send_adapter_ready" : "not_mail_send");
  const ready = dispatchStatus === "live_send_adapter_ready";
  const needsSendScope = dispatchStatus === "connector_ready_send_scope_required";
  const pendingAdapter = dispatchStatus === "connector_ready_send_adapter_pending";
  const needsConnection =
    !confirmation.adapterConnected || dispatchStatus === "no_send_connector_ready" || dispatchStatus === "needs_connection";
  const actionLabel = ready
    ? "마지막 확인으로 이어가기"
    : needsSendScope
      ? "메일 발송 권한 확인"
      : pendingAdapter
        ? "앱 확인 발송으로 이어가기"
        : finalConfirmationConnectActionLabel(confirmation);
  const reason = ready
    ? "Gmail, Outlook, SMTP 발송 경로가 준비되어도 실행 전 검토와 최종 확인 전에는 보내지 않습니다."
    : needsSendScope
      ? "메일 읽기 연결은 있지만 발송 권한이나 SMTP 발송 설정이 부족합니다."
      : pendingAdapter
        ? "계정은 확인됐지만 실제 발송 어댑터 준비 증거가 부족해 앱 최종 확인 경로로 묶어둡니다."
        : needsConnection
          ? "메일 계정 연결이나 발송 가능한 계정 확인이 필요합니다."
          : "실제 발송 전 연결, 권한, 실행 로그 준비 상태를 다시 확인합니다.";
  return {
    state: ready ? "ready" : needsConnection || needsSendScope || pendingAdapter ? "review" : "locked",
    label: gate?.liveAdapterOneLineLabel || (ready ? "메일 전송 경로 준비됨" : "메일 전송 준비 확인 필요"),
    reason,
    actionLabel,
    resumeLabel: ready
      ? "승인된 메일만 전송 후보로 유지"
      : "설정 뒤 이 승인 항목으로 돌아와 계속 진행",
    dispatchStatus,
    proofChain: gate?.liveAdapterProofChain || (mailSendApproved ? "mail_adapter_connected_approval_gate_approved_final_confirmation_locked" : "not_mail_send"),
    options: gate?.liveAdapterOptions ?? (mailSendApproved
      ? [
          {
            id: "gmail",
            label: "Gmail API 발송",
            readiness: "ready",
            connectorId: "gmail",
            statusLabel: "준비됨",
            finalApprovalRequired: true,
            dryRunRequired: true,
            externalMutationOnlyAfterFinalConfirmation: true,
          },
          {
            id: "outlook",
            label: "Outlook Graph 발송",
            readiness: "ready",
            connectorId: "outlook",
            statusLabel: "준비됨",
            finalApprovalRequired: true,
            dryRunRequired: true,
            externalMutationOnlyAfterFinalConfirmation: true,
          },
          {
            id: "smtp",
            label: "회사 SMTP 발송",
            readiness: "ready",
            connectorId: confirmation.adapter.connectorId || "company-mail",
            statusLabel: "준비됨",
            finalApprovalRequired: true,
            dryRunRequired: true,
            externalMutationOnlyAfterFinalConfirmation: true,
          },
          {
            id: "app_final_confirmation",
            label: "앱 마지막 확인",
            readiness: "available",
            statusLabel: "최종 확인 전 잠금",
            finalApprovalRequired: true,
            dryRunRequired: true,
            externalMutationOnlyAfterFinalConfirmation: true,
          },
        ]
      : []),
    mobileLabel: gate?.mobileMailIntakeSupported || mailSendApproved
      ? gate?.mobileMailIntakeBoundary || "휴대폰으로 받은 메일도 선택한 항목만 메일 직원 작업함으로 가져옵니다."
      : "휴대폰 메일 가져오기는 아직 이 항목에 연결되지 않았습니다.",
  };
}

function liveAdapterOptionStateLabel(readiness: string | undefined) {
  if (readiness === "ready") return "준비됨";
  if (readiness === "connector_ready_send_scope_required") return "발송 권한 필요";
  if (readiness === "connector_ready_send_adapter_pending") return "어댑터 준비 중";
  if (readiness === "needs_connection") return "연결 필요";
  if (readiness === "standby") return "대기";
  if (readiness === "available") return "앱 확인 가능";
  return "확인 필요";
}

function finalExecutionDispatchLabel(dispatchStatus: string | undefined) {
  if (dispatchStatus === "live_send_adapter_ready") return "실제 전송 준비";
  if (dispatchStatus === "connector_ready_send_scope_required") return "발송 권한 필요";
  if (dispatchStatus === "connector_ready_send_adapter_pending") return "어댑터 준비 중";
  if (dispatchStatus === "no_send_connector_ready") return "발송 연결 필요";
  return "앱 확인 전용";
}

function officeNextUserChoiceForWorkItem(item: WorkItem): string {
  if (isWebmailFallbackApprovalItem(item)) {
    return "웹메일 로그인 확인 또는 계정 보관함";
  }
  if (item.browserTask) {
    return getFeatureLauncherCatalogItem("feature-computer-use")?.nextUserChoice ?? "내 PC 작업 도우미 또는 오피스 승인함";
  }
  if (item.finalAction?.kind === "send_email" || item.finalAction?.kind === "send_bulk_email") {
    return getFeatureLauncherCatalogItem("feature-mail")?.nextUserChoice ?? "메일 연결 또는 계정 보관함";
  }
  if (item.finalAction?.kind === "create_calendar_event") {
    return getFeatureLauncherCatalogItem("feature-schedule-prep")?.nextUserChoice ?? "캘린더 연결 또는 승인함 확인";
  }
  if (item.localFile || item.source === "local_file" || item.source === "uploaded_file") {
    return getFeatureLauncherCatalogItem("feature-document-learning")?.nextUserChoice ?? "자료 선택 또는 기억 위치 확인";
  }
  if (item.draft) {
    return getFeatureLauncherCatalogItem("feature-draft-report")?.nextUserChoice ?? "문서 학습 또는 AI 팀원 결과";
  }
  return getFeatureLauncherCatalogItem("feature-final-approval")?.nextUserChoice ?? "오피스 승인함 또는 미리보기 다시 확인";
}

function visibleOfficeNextChoice(value: string | null | undefined): string {
  const source = (value ?? "").trim();
  if (/반복\s*(업무|후보)|문장\s*빌더/u.test(source)) return "반복 업무 다시 열기";
  if (/메일|계정\s*보관함/u.test(source)) return "메일 연결하기";
  if (/캘린더|일정/u.test(source)) return "캘린더 연결하기";
  if (/파일\s*다시|파일\/폴더|자료\s*선택|문서\s*학습|기억\s*위치/u.test(source)) return "자료 선택하기";
  if (/내\s*PC|열린\s*창|최근\s*파일|브라우저|화면\s*증거/u.test(source)) return "작업 범위 고르기";
  if (/보고서|AI\s*팀원/u.test(source)) return "자료 선택하기";
  if (/오피스\s*승인함|승인/u.test(source)) return "승인함 보기";
  if (/연결/u.test(source)) return "연결 확인하기";
  return "다음 단계 확인";
}

function highestWorkItemRisk(items: WorkItem[]) {
  return items.reduce((highest, item) => {
    const signalRisk = item.riskSignals.reduce(
      (signalHighest, signal) => (riskWeight(signal.riskLabel) > riskWeight(signalHighest) ? signal.riskLabel : signalHighest),
      item.riskLabel,
    );
    return riskWeight(signalRisk) > riskWeight(highest) ? signalRisk : highest;
  }, "low" as string);
}

function buildApprovalSafetyRail(input: {
  approvalWaitCount: number;
  previewCount: number;
  mutationCount: number;
  rollbackGuideCount: number;
  executionLogCount: number;
  highestRisk: string;
}): ApprovalSafetyRailItem[] {
  return [
    {
      id: "risk",
      label: "위험도",
      title: input.approvalWaitCount ? `${riskLabelText(input.highestRisk)} · ${input.approvalWaitCount}개 확인` : "승인 대기 없음",
      detail: input.approvalWaitCount
        ? "높은 위험 신호가 있으면 보안 데스크와 최종 확인을 먼저 봅니다."
        : "외부 발송, 등록, 삭제, 이동 후보가 생기면 이곳에 표시됩니다.",
      state: riskWeight(input.highestRisk) >= 3 ? "danger" : input.approvalWaitCount ? "review" : "safe",
    },
    {
      id: "preview",
      label: "미리보기",
      title: input.previewCount ? `${input.previewCount}개 초안/후보` : "미리보기 대기",
      detail: "내용, 대상, 예상 결과를 먼저 보여주고 바로 실행하지 않습니다.",
      state: input.previewCount ? "review" : "safe",
    },
    {
      id: "execute-or-cancel",
      label: "결정",
      title: input.approvalWaitCount ? officeDecisionActionLabels : "결정 대기",
      detail: input.approvalWaitCount
        ? `${officeDecisionActionLabels} 중 하나를 고르기 전에는 외부 실행을 열지 않습니다.`
        : "후보가 생기면 실행할지, 고칠지, 보류할지 같은 카드에서 고릅니다.",
      state: input.approvalWaitCount ? "review" : "locked",
    },
    {
      id: "final-confirmation",
      label: "최종 확인",
      title: input.mutationCount ? `${input.mutationCount}개 외부 변경 잠금` : "외부 변경 없음",
      detail: "발송, 등록, 공유, 클릭, 파일 변경은 사용자 최종 확인 버튼 전까지 실행하지 않습니다.",
      state: input.mutationCount ? "locked" : "safe",
    },
    {
      id: "execution-log",
      label: "실행 로그",
      title: input.executionLogCount ? `${input.executionLogCount}개 기록 경로` : "로그 대기",
      detail: `${officeDecisionActionLabels}, 실행 전 검토, 최종 확인은 업무 기록과 감사 기록으로 이어집니다.`,
      state: input.executionLogCount ? "review" : "locked",
    },
    {
      id: "rollback",
      label: "되돌리기",
      title: input.rollbackGuideCount ? `${input.rollbackGuideCount}개 안내 있음` : "실행 전 잠금",
      detail: input.mutationCount
        ? "파일 변경, 발송, 등록, 클릭은 되돌리기 안내나 최종 확인 없이는 열리지 않습니다."
        : "현재 외부 변경 후보가 없어 실행 전 잠금 상태입니다.",
      state: input.rollbackGuideCount ? "review" : input.mutationCount ? "locked" : "safe",
    },
  ];
}

function buildOfficeQualityGateItems(input: {
  qualityGateFeatures: readonly FeatureLauncherCatalogItem[];
  progressiveFeatures: readonly FeatureLauncherCatalogItem[];
  channelQueueItems: NonNullable<Props["channelQueueItems"]>;
  approvalWorkItems: WorkItem[];
}): OfficeQualityGateItem[] {
  const rows: OfficeQualityGateItem[] = [...input.qualityGateFeatures].sort(officeQualityGatePriority).map((item) => {
    const replacement = item.replacementFeatureId ? getFeatureLauncherCatalogItem(item.replacementFeatureId) : null;
    const replacementAction = item.replacementHomeAction || replacement?.homeAction || "";
    const isNotificationAbsorbed = item.id === "feature-notify-assistant" || item.id === "feature-messengers";
    const isFinalApprovalAbsorbed = item.id === "feature-final-approval";
    const isMailDraftAbsorbed = item.id === "feature-draft-mail";
    const isDelegationAbsorbed = item.id === "feature-delegation";
    const isCrewKitAbsorbed = item.id === "feature-crewkit";
    const absorptionConnectionHref = isNotificationAbsorbed
      ? "/connect?singleSetting=messenger-channel"
      : isFinalApprovalAbsorbed
        ? "/office?preview=workbench"
      : isMailDraftAbsorbed
        ? "/?setupTask=feature-mail"
      : isDelegationAbsorbed
        ? "/?setupTask=feature-draft-report"
      : isCrewKitAbsorbed
        ? "/?panel=workers"
        : undefined;
    const absorptionConnectionLabel = isNotificationAbsorbed
      ? "알림 연결"
      : isFinalApprovalAbsorbed
        ? "마지막 확인 준비"
      : isMailDraftAbsorbed
        ? "메일 점검 열기"
      : isDelegationAbsorbed
        ? "보고서 만들기"
      : isCrewKitAbsorbed
        ? "AI 팀원 열기"
        : undefined;
    const absorptionConnectionAction = isNotificationAbsorbed
      ? "messenger_channels"
      : isFinalApprovalAbsorbed
        ? "open_office_final_confirmation"
      : isMailDraftAbsorbed
        ? "mailops_check"
      : isDelegationAbsorbed
        ? "delegation_report_draft"
      : isCrewKitAbsorbed
        ? "workers"
        : undefined;
    const absorptionConnectionRole = isNotificationAbsorbed
      ? "supplemental_notification_connection"
      : isFinalApprovalAbsorbed
        ? "supplemental_final_confirmation"
      : isMailDraftAbsorbed
        ? "supplemental_mail_draft"
      : isDelegationAbsorbed
        ? "supplemental_report_draft"
      : isCrewKitAbsorbed
        ? "supplemental_teammate_task"
        : undefined;
    const replacementReadiness = validateFeatureLauncherReplacement({
      replacementFeatureId: item.replacementFeatureId,
      replacementHomeAction: replacementAction,
    });
    return {
      id: `catalog-${item.id}`,
      label: item.qualityStatus === "remove_or_rebuild" ? "재구축 후보" : "흡수됨",
      title: item.userLabel,
      detail: item.qualityReason,
      replacementUserPath: item.replacementUserPath || replacement?.userLabel || "대표 업무 흐름",
      replacementFeatureId: item.replacementFeatureId || replacement?.id || "",
      replacementHomeAction: replacementAction,
      replacementHref: officeHomeActionHref(replacementAction),
      runtimeProofLabel: replacement?.runtimeProofLabel || item.runtimeProofLabel,
      verifyCommand: replacement?.verifyCommand || item.verifyCommand,
      nextUserChoice: replacement?.nextUserChoice || item.nextUserChoice,
      originalExposurePolicy: "locked_until_rebuilt_or_absorbed",
      replacementReadiness: replacementReadiness.ready ? "launch_ready_verified" : replacementReadiness.reason,
      replacementExecutionContract: replacementReadiness.ready
        ? "replacement_launch_ready_runtime_safety_evidence_verified"
        : "replacement_blocked_until_runtime_safety_evidence_verified",
      absorptionConnectionHref,
      absorptionConnectionLabel,
      absorptionConnectionAction,
      absorptionConnectionRole,
      state: item.qualityStatus === "remove_or_rebuild" ? "rebuild" : "hidden",
    };
  });

  const weakQueueItems = input.channelQueueItems
    .filter((item) => /자동화 규칙|규칙|기술 용어|setup|tool|terminal|cron|skill file|feature-rules/iu.test(
      [
        item.label,
        item.detail,
        item.queueLabel,
        item.sourceLabel,
        item.skillId,
        item.crewKitLabel,
      ].filter(Boolean).join(" "),
    ))
    .slice(0, 3)
    .map((item) => ({
      id: `queue-quality-${item.id}`,
      label: "대체 경로",
      title: item.label,
      detail: "기술형 작업 이름은 사용자가 보는 승인 카드로 직접 올리지 않고 쉬운 업무 흐름으로 바꿉니다.",
      replacementUserPath: "반복 업무 만들기",
      replacementFeatureId: "feature-repeat-work",
      replacementHomeAction: "repeat_work_save_draft",
      replacementHref: officeHomeActionHref("repeat_work_save_draft"),
      runtimeProofLabel: "문장 빌더와 승인 후보",
      verifyCommand: "npm run verify:repeat-work-builder-browser",
      nextUserChoice: "반복 후보 저장 또는 필요한 연결",
      originalExposurePolicy: "locked_until_rebuilt_or_absorbed",
      replacementReadiness: "launch_ready_verified",
      replacementExecutionContract: "replacement_launch_ready_runtime_safety_evidence_verified",
      state: "hidden" as const,
    }));

  const weakApprovalItems = input.approvalWorkItems
    .filter((item) => /자동화 규칙|규칙|feature-rules|technical|tool|terminal|cron|skill file/iu.test(
      [
        item.title,
        item.summary,
        item.sourceLabel,
        item.body,
        item.sourceEvidence?.providerId,
        item.sourceEvidence?.connectorId,
        item.sourceEvidence?.approvalCandidateLabels?.join(" "),
      ].filter(Boolean).join(" "),
    ))
    .slice(0, 3)
    .map((item) => ({
      id: `approval-quality-${item.id}`,
      label: "승인 전 변환",
      title: item.title,
      detail: "오피스 승인함에서도 약한 기능명은 그대로 실행하지 않고 사용자가 이해하는 업무 카드로 재작성합니다.",
      replacementUserPath: "반복 업무 만들기",
      replacementFeatureId: "feature-repeat-work",
      replacementHomeAction: "repeat_work_save_draft",
      replacementHref: officeHomeActionHref("repeat_work_save_draft"),
      runtimeProofLabel: "문장 빌더와 승인 후보",
      verifyCommand: "npm run verify:repeat-work-builder-browser",
      nextUserChoice: "반복 후보 저장 또는 필요한 연결",
      originalExposurePolicy: "locked_until_rebuilt_or_absorbed",
      replacementReadiness: "launch_ready_verified",
      replacementExecutionContract: "replacement_launch_ready_runtime_safety_evidence_verified",
      state: "hidden" as const,
    }));

  const seen = new Set<string>();
  const progressiveRows = input.progressiveFeatures.slice(0, 3).map((item) => ({
    id: `progressive-${item.id}`,
    label: "필요할 때만 열기",
    title: item.userLabel,
    detail: "검증된 큰 기능은 승인 화면을 복잡하게 만들지 않도록 필요한 순간에만 엽니다.",
    replacementUserPath: item.userLabel,
    replacementFeatureId: item.id,
    replacementHomeAction: item.homeAction,
    replacementHref: officeHomeActionHref(item.homeAction),
    runtimeProofLabel: item.runtimeProofLabel,
    verifyCommand: item.verifyCommand,
    nextUserChoice: item.nextUserChoice,
    originalExposurePolicy: "progressive_disclosure_until_needed",
    replacementReadiness: "launch_ready_verified",
    replacementExecutionContract: "replacement_launch_ready_runtime_safety_evidence_verified",
    state: "progressive" as const,
  }));

  const visibleRows = [...rows, ...weakQueueItems, ...weakApprovalItems]
    .filter((item) => {
      const key = `${item.title}:${item.replacementUserPath}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const visibleProgressiveRows = progressiveRows.filter((item) => {
    const key = `${item.title}:${item.replacementUserPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!visibleProgressiveRows.length) return visibleRows.slice(0, 6);
  return [...visibleRows.slice(0, 5), visibleProgressiveRows[0]];
}

function officeQualityGatePriority(left: FeatureLauncherCatalogItem, right: FeatureLauncherCatalogItem) {
  return officeQualityGatePriorityValue(left) - officeQualityGatePriorityValue(right);
}

function officeQualityGatePriorityValue(item: FeatureLauncherCatalogItem) {
  if (item.id === "feature-rules") return 0;
  if (item.id === "feature-final-approval") return 1;
  if (item.id === "feature-notify-assistant") return 2;
  if (item.id === "feature-messengers") return 3;
  if (item.id === "feature-draft-mail") return 4;
  if (item.id === "feature-delegation") return 5;
  if (item.id === "feature-crewkit") return 6;
  return 10;
}

function officeHomeActionHref(action: string) {
  if (action === "automation_check" || action === "repeat_work_builder" || action === "repeat_work_save_draft") return "/?workTools=repeat";
  if (action === "today_check") return "/?preview=workbench";
  if (action === "workers") return "/?panel=workers";
  if (action === "mailops_check") return "/?easyStart=mail";
  if (action === "delegation_report_draft") return "/?setupTask=feature-draft-report";
  if (action === "messenger_channels") return "/connect?singleSetting=messenger-channel";
  if (action === "computer_use") return "/?computerUse=1";
  if (action === "learn_files") return "/learn";
  if (action === "open_office") return "/office?preview=workbench";
  return "/";
}

function buildFinalActionApprovalReview(input: {
  item: WorkItem;
  confirmation: FinalConfirmationContract | null;
  dryRun: FinalActionDryRunResult | null;
  execution: FinalActionExecutionResult | null;
}): FinalActionApprovalReviewItem[] {
  const itemRisk = highestWorkItemRisk([input.item]);
  const previewText =
    input.dryRun?.dryRun?.executionPlan.summary ||
    input.confirmation?.checklist[0] ||
    input.item.browserTask?.dryRunPlan?.expectedResult ||
    input.item.finalAction?.checklist[0] ||
    input.item.summary ||
    "실행 전에 내용과 대상을 먼저 확인합니다.";
  const logText =
    input.execution?.auditFile || input.execution?.auditId
      ? "최종 실행 감사 기록"
      : input.dryRun?.auditFile || input.dryRun?.auditId
        ? "실행 전 검토 기록"
        : "실행 전 검토 전에는 실행 로그를 만들지 않습니다.";
  const rollbackText =
    input.item.browserTask?.dryRunPlan?.rollbackGuide ||
    input.item.browserTask?.finalPresenceContract?.limitedExecutionGate?.rollbackGuide ||
    input.item.finalAction?.blockedReason ||
    "실행 전에는 취소할 수 있고, 실행 뒤에는 감사 기록으로 되돌리기 기준을 확인합니다.";
  return [
    {
      id: "risk",
      label: "위험도",
      title: riskLabelText(itemRisk),
      detail: input.item.riskSignals[0]?.reason || "외부 발송, 일정 등록, 공유 같은 변경 작업은 최종 확인 전 잠깁니다.",
      state: riskWeight(itemRisk) >= 3 ? "danger" : riskWeight(itemRisk) >= 2 ? "review" : "safe",
    },
    {
      id: "preview",
      label: "미리보기",
      title: input.confirmation ? "확인 계약 준비" : "계약 준비 전",
      detail: previewText,
      state: input.confirmation || input.dryRun ? "review" : "locked",
    },
    {
      id: "log",
      label: "기록",
      title: input.execution?.auditId ? "실행 기록 있음" : input.dryRun?.auditId ? "실행 전 검토 기록 있음" : "기록 대기",
      detail: logText,
      state: input.execution?.auditId || input.dryRun?.auditId ? "review" : "locked",
    },
    {
      id: "rollback",
      label: "되돌리기",
      title: rollbackText ? "안내 있음" : "확인 필요",
      detail: rollbackText,
      state: rollbackText ? "review" : "locked",
    },
    {
      id: "next",
      label: "막히면",
      title: "다음 선택지",
      detail: officeNextUserChoiceForWorkItem(input.item),
      state: "review",
    },
  ];
}

function channelDecisionRecommendedFinalAction(decision: string): ChannelDecisionFinalConfirmationContext["recommendedFinalAction"] {
  if (decision === "approved") return "prepare_final_confirmation";
  if (decision === "change_requested") return "revise_before_final_confirmation";
  if (decision === "held") return "hold_before_execution";
  return "exclude_from_execution";
}

function channelDecisionFinalState(decision: string): ChannelDecisionFinalConfirmationContext["state"] {
  if (decision === "approved") return "ready";
  if (decision === "change_requested") return "review";
  return "locked";
}

function channelDecisionDraftInstruction(decision: NonNullable<WorkItem["channelDecision"]>) {
  if (decision.decision === "approved") {
    return "휴대폰 승인 의사를 반영했습니다. 앱에서 수신자, 본문, 첨부만 마지막 확인합니다.";
  }
  if (decision.decision === "change_requested") {
    return decision.revisionInstruction
      ? `수정 요청 반영: ${decision.revisionInstruction}`
      : "수정 요청 의사를 반영했습니다. 초안을 다시 만든 뒤 마지막 확인으로 이어갑니다.";
  }
  if (decision.decision === "held") {
    return "휴대폰 보류 의사를 반영했습니다. 사용자가 다시 진행하기 전까지 외부 실행을 열지 않습니다.";
  }
  return "휴대폰 거절 의사를 반영했습니다. 이 실행 후보는 앱에서 다시 승인하기 전까지 실행하지 않습니다.";
}

function buildChannelDecisionFinalContext(input: {
  item: WorkItem;
  confirmation: FinalConfirmationContract | null;
}): ChannelDecisionFinalConfirmationContext | null {
  if (input.confirmation?.channelDecisionContext) return input.confirmation.channelDecisionContext;
  const decision = input.item.channelDecision;
  if (!decision) return null;
  const decisionLabelText = decision.decisionLabel ?? decisionLabel(decision.decision);
  return {
    channel: decision.channel,
    decision: decision.decision,
    decisionLabel: decisionLabelText,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    targetCode: decision.targetCode,
    targetWorkItemId: decision.targetWorkItemId ?? input.item.id,
    notificationTargetMatch: decision.notificationTargetMatch ?? Boolean(decision.targetCode || input.item.id),
    notificationTargetMatchLabel:
      decision.notificationTargetMatchLabel ??
      (decision.targetCode
        ? `${decision.targetCode} 알림 코드가 이 승인 후보로 고정됐습니다.`
        : "휴대폰 답장을 앱 승인함의 같은 후보에 연결했습니다."),
    notificationTargetMatchContract:
      decision.notificationTargetMatchContract ?? "approval_notification_code_to_same_work_item_final_confirmation",
    summaryLabel: `${decision.targetCode ? `${decision.targetCode} · ` : ""}${decisionLabelText} · ${decision.appReconfirmLabel ?? "앱 최종 확인 필요"}`,
    approvalInboxRouteLabel: decision.approvalInboxRouteLabel ?? "ModyCrew > 오피스 > 승인함",
    appReconfirmLabel: decision.appReconfirmLabel ?? "앱 최종 확인 필요",
    workerEventLabel: decision.workerEventLabel ?? `${decision.channel}에서 ${decisionLabelText} 의사 수신`,
    finalExecutionBoundary:
      decision.finalExecutionBoundary ??
      "휴대폰 답장은 의사 기록만, 실제 메일 발송/일정 등록/파일 공유는 앱 최종 확인 후 실행",
    mobileReceiveFilterIds: decision.mobileReceiveFilterIds,
    mobileReceiveFilterLabels: decision.mobileReceiveFilterLabels,
    mobileReceiveFilterSummary: decision.mobileReceiveFilterSummary,
    mobileReceiveFilterContract: decision.mobileReceiveFilterContract,
    recommendedFinalAction: channelDecisionRecommendedFinalAction(decision.decision),
    state: channelDecisionFinalState(decision.decision),
    draftInstruction: channelDecisionDraftInstruction(decision),
    messagePreview: decision.messagePreview,
    revisionInstruction: decision.revisionInstruction,
    requiresAppReconfirm: decision.requiresAppReconfirm,
    externalMutation: false,
  };
}

function buildChannelDecisionProofSteps(context: ChannelDecisionFinalConfirmationContext | null) {
  if (!context) return [];
  return [
    {
      id: "phone_reply",
      label: "휴대폰 답장",
      title: context.targetCode ? `${context.targetCode} · ${context.decisionLabel ?? decisionLabel(context.decision)}` : context.decisionLabel ?? decisionLabel(context.decision),
      detail: context.messagePreview || context.decidedAt || "채널 답장 수신",
      state: "ready",
    },
    {
      id: "notification_target",
      label: "대상 고정",
      title: context.notificationTargetMatch ? "같은 승인 후보" : "대상 확인 필요",
      detail: context.notificationTargetMatchLabel || "A번호와 앱 승인함 후보를 다시 확인합니다.",
      state: context.notificationTargetMatch ? "ready" : "review",
    },
    {
      id: "channel_record",
      label: "결정 기록",
      title: context.approvalInboxRouteLabel,
      detail: context.workerEventLabel,
      state: "ready",
    },
    {
      id: "worker_event",
      label: "AI 직원",
      title: "가상오피스 반영",
      detail: mobileDecisionVirtualOfficeEventPath,
      state: "ready",
    },
    {
      id: "app_reconfirm",
      label: "앱 최종 확인",
      title: context.appReconfirmLabel,
      detail: context.recommendedFinalAction === "prepare_final_confirmation" ? "마지막 확인 가능" : context.draftInstruction,
      state: context.state,
    },
    {
      id: "execution_log",
      label: "실행 로그",
      title: "외부 실행 전 잠금",
      detail: context.finalExecutionBoundary,
      state: "locked",
    },
  ];
}

function finalActionMutationLabel(item: WorkItem) {
  if (item.finalAction?.kind === "scenario_review") return "메일 업무 검토";
  if (item.finalAction?.kind === "send_email") return "메일 발송";
  if (item.finalAction?.kind === "send_bulk_email") return "대량 메일 발송";
  if (item.finalAction?.kind === "create_calendar_event") return "캘린더 등록";
  if (item.finalAction?.kind === "share_file") return "파일 공유";
  if (item.browserTask) return "클릭·입력";
  return "외부 실행";
}

function finalExecutionReceiptTitle(status?: string) {
  if (status === "final_execution_provider_dispatched") return "실제 처리 요청 완료";
  if (status === "final_execution_review_recorded") return "검토 기록 완료";
  if (status === "final_execution_live_adapter_required") return "실제 실행 잠김";
  if (status === "final_execution_confirmation_required") return "최종 조건 부족";
  if (status === "not_final_action") return "실행 후보 아님";
  return "실행 잠금";
}

function finalExecutionMissingRequirementLabel(requirement: string) {
  if (requirement === "liveProviderExecutionEnabled") return "실제 실행 연결";
  if (requirement === "liveSendAdapterImplementation") return "라이브 발송 어댑터";
  if (requirement === "providerAdapterConnected") return "서비스 연결";
  if (requirement === "finalUserPresence") return "사용자 최종 확인";
  if (requirement === "dryRunId") return "실행 전 검토";
  return "추가 확인";
}

function finalExecutionReceiptDetail(input: {
  item: WorkItem;
  execution: FinalActionExecutionResult | null;
  mutationLabel: string;
}) {
  if (!input.execution) return `${input.mutationLabel}은 사용자가 최종 확인하기 전까지 잠겨 있습니다.`;
  if (input.execution.status === "final_execution_provider_dispatched") {
    return input.execution.userMessage || `${input.mutationLabel} 요청을 보냈고 감사 기록을 남겼습니다.`;
  }
  if (input.execution.status === "final_execution_review_recorded") {
    return input.execution.userMessage || `${input.mutationLabel} 완료를 기록했고 외부 실행은 하지 않았습니다.`;
  }
  if (input.execution.status === "final_execution_live_adapter_required") {
    return input.execution.userMessage || `${input.mutationLabel}은 설치 앱에서 연결과 최종 확인이 준비된 뒤에만 진행할 수 있습니다.`;
  }
  if (input.execution.status === "final_execution_confirmation_required") {
    const missing = input.execution.missingRequirements?.length
      ? ` 필요한 확인: ${input.execution.missingRequirements.map(finalExecutionMissingRequirementLabel).join(", ")}`
      : "";
    return input.execution.userMessage || `최종 확인 조건이 아직 부족합니다.${missing}`;
  }
  return input.execution.userMessage || `${input.mutationLabel} 실행 결과를 확인했습니다.`;
}

function buildFinalActionAuditReceipts(input: {
  item: WorkItem;
  confirmation: FinalConfirmationContract | null;
  dryRun: FinalActionDryRunResult | null;
  execution: FinalActionExecutionResult | null;
}): FinalActionAuditReceiptItem[] {
  const mutationLabel = finalActionMutationLabel(input.item);
  const dryRunRecord = input.dryRun?.auditFile || input.dryRun?.auditId ? "실행 전 검토 기록" : "실행 전 검토 전에는 기록 대기";
  const executionRecord = input.execution?.auditFile || input.execution?.auditId ? "최종 실행 감사 기록" : "사용자 최종 확인 전까지 실행 기록 없음";
  const reviewedDraftPlan = input.dryRun?.dryRun?.executionPlan;
  const reviewedDraftDetail = [
    reviewedDraftPlan?.bodyPreview ? `본문: ${reviewedDraftPlan.bodyPreview}` : "",
    reviewedDraftPlan?.reviewNote ? `메모: ${reviewedDraftPlan.reviewNote}` : "",
    reviewedDraftPlan?.sendCheckSummary ? `점검: ${reviewedDraftPlan.sendCheckSummary}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const rollbackGuide =
    input.item.browserTask?.dryRunPlan?.rollbackGuide ||
    input.item.browserTask?.finalPresenceContract?.limitedExecutionGate?.rollbackGuide ||
    input.item.finalAction?.blockedReason ||
    "실행 전에는 취소/보류가 가능하고, 실행 뒤에는 감사 기록을 기준으로 되돌리기 가능 여부를 확인합니다.";
  return [
    {
      id: "decision",
      label: "결정",
      title: input.confirmation ? "사용자 최종 확인 대기" : "마지막 확인 준비 전",
      detail: `${mutationLabel}은 실행 전 검토와 최종 확인 버튼을 거치기 전에는 진행하지 않습니다.`,
      recordPath: input.confirmation ? "오피스 승인함 · 최종 확인 계약" : "오피스 승인함 · 확인 전 잠금",
      state: input.confirmation ? "review" : "locked",
    },
    ...(reviewedDraftDetail
      ? [
          {
            id: "reviewed-draft",
            label: "수정본",
            title: reviewedDraftPlan?.bodySource === "user_revised_draft" ? "작업함 수정본 기준" : "발송 본문 점검 기준",
            detail: reviewedDraftDetail,
            recordPath: input.dryRun?.auditFile || input.dryRun?.auditId ? "dry-run 실행 전 검토 증거" : "수정본 검토 대기",
            state: input.dryRun?.status === "final_action_dry_run_ready" ? "ready" : "review",
          } satisfies FinalActionAuditReceiptItem,
        ]
      : []),
    {
      id: "dry-run",
      label: "검토",
      title: input.dryRun?.status === "final_action_dry_run_ready" ? "실행 전 검토 완료" : "실행 전 검토 필요",
      detail: input.dryRun?.userMessage || "내용, 대상, 필수값을 먼저 검토해야 합니다.",
      recordPath: dryRunRecord,
      state: input.dryRun?.status === "final_action_dry_run_ready" ? "ready" : "locked",
    },
    {
      id: "execution",
      label: "실행",
      title: finalExecutionReceiptTitle(input.execution?.status),
      detail: finalExecutionReceiptDetail({ item: input.item, execution: input.execution, mutationLabel }),
      recordPath: executionRecord,
      state: input.execution?.status === "final_execution_provider_dispatched" ? "ready" : "locked",
    },
    {
      id: "rollback",
      label: "되돌리기",
      title: input.execution ? "감사 기록 기준 확인" : "실행 전 취소 가능",
      detail: rollbackGuide,
      recordPath: input.execution?.auditFile || input.dryRun?.auditFile ? "최종 실행 감사 기록" : "업무 기록과 감사 기록",
      state: input.execution || input.dryRun ? "review" : "locked",
    },
  ];
}

function buildExternalApprovalPlainCheck(item: WorkItem): FinalActionApprovalReviewItem[] {
  const itemRisk = highestWorkItemRisk([item]);
  const gate = item.browserTask?.finalPresenceContract?.limitedExecutionGate;
  const previewText =
    item.browserTask?.dryRunPlan?.expectedResult ||
    item.browserTask?.stagedAction?.label ||
    item.browserTask?.actionPlan?.[0]?.label ||
    item.sourceEvidence?.draftPreview ||
    item.summary ||
    "읽기 전용으로 대상과 예상 결과를 먼저 확인합니다.";
  const logText =
    gate?.postExecutionAuditFile ||
    gate?.executionAuditFile ||
    gate?.executionAttemptAuditFile ||
    gate?.confirmationAuditFile ||
    gate?.auditFile
      ? "내 PC 작업 감사 기록"
      : "화면 증거, 마지막 확인, 실행 요청은 업무 기록과 감사 기록에 남깁니다.";
  const rollbackText =
    item.browserTask?.dryRunPlan?.rollbackGuide ||
    gate?.rollbackGuide ||
    "실행 전 카드라 취소해도 외부 사이트, 파일, 메일은 바뀌지 않습니다.";

  return [
    {
      id: "risk",
      label: "위험도",
      title: riskLabelText(itemRisk),
      detail: item.riskSignals[0]?.reason || "외부 계정, 브라우저 화면, 클릭·입력 후보는 최종 확인 전 잠깁니다.",
      state: riskWeight(itemRisk) >= 3 ? "danger" : riskWeight(itemRisk) >= 2 ? "review" : "safe",
    },
    {
      id: "preview",
      label: "미리보기",
      title: item.browserTask?.finalPresenceContract ? "화면 확인 중" : "읽기/계획 먼저",
      detail: previewText,
      state: item.browserTask?.dryRunPlan || item.browserTask?.actionPlan?.length ? "review" : "locked",
    },
    {
      id: "choice",
      label: "선택",
      title: "앱에서 결정",
      detail: "실행하기, 고쳐달라고 하기, 보류하기, 연결 재점검을 앱 안의 승인함에서 고릅니다.",
      state: "review",
    },
    {
      id: "log",
      label: "기록",
      title: gate?.auditRecorded || gate?.executionAuditFile ? "감사 경로 있음" : "기록 대기",
      detail: logText,
      state: gate?.auditRecorded || gate?.executionAuditFile ? "review" : "locked",
    },
    {
      id: "rollback",
      label: "되돌리기",
      title: "되돌리기 안내",
      detail: rollbackText,
      state: rollbackText ? "review" : "locked",
    },
  ];
}

function buildApprovalCommonChecks(input: {
  risk: string | undefined;
  preview: string;
  logPath: string;
  rollbackGuide: string;
  decisionGuide: string;
  needsFinalGate: boolean;
}): ApprovalCommonCheckItem[] {
  const riskScore = riskWeight(input.risk);
  const hasLogPath = !/업무 기록과 감사 기록|기록에 남깁니다|기록 대기/u.test(input.logPath);
  return [
    {
      id: "risk",
      label: "위험도",
      title: riskLabelText(input.risk),
      detail:
        riskScore >= 3
          ? "외부 발송, 등록, 공유, 클릭, 파일 변경 후보는 최종 확인 전까지 잠급니다."
          : riskScore >= 2
            ? "앱 안에서 미리보기와 사용자 결정을 거친 뒤 다음 단계로 갑니다."
            : "읽기 전용 또는 내부 기록 후보입니다.",
      state: riskScore >= 2 ? "active" : "ready",
    },
    {
      id: "preview",
      label: "미리보기",
      title: "먼저 볼 항목",
      detail: input.preview,
      state: input.preview ? "ready" : "locked",
    },
    {
      id: "decision",
      label: "결정",
      title: input.needsFinalGate ? "실행 전 마지막 확인" : officeDecisionActionLabels,
      detail: input.decisionGuide,
      state: "active",
    },
    {
      id: "log",
      label: "로그",
      title: hasLogPath ? "기록 위치 있음" : "실행 전 기록 대기",
      detail: input.logPath,
      state: hasLogPath ? "ready" : "locked",
    },
    {
      id: "rollback",
      label: "되돌리기",
      title: "되돌리기 안내",
      detail: input.rollbackGuide,
      state: input.rollbackGuide ? "ready" : "locked",
    },
  ];
}

function buildComputerUseOfficeApprovalChecks(input: {
  item: WorkItem;
  risk: string | undefined;
  preview: string;
  logPath: string;
  rollbackGuide: string;
}): ApprovalCommonCheckItem[] {
  const isDesktopOrFileTask = Boolean(input.item.browserTask || input.item.localFile || input.item.source === "local_file");
  if (!isDesktopOrFileTask) {
    return [];
  }

  const riskScore = riskWeight(input.risk);
  const hasLogPath = !/업무 기록과 감사 기록|기록에 남깁니다|기록 대기/u.test(input.logPath);
  const isBrowserTask = Boolean(input.item.browserTask);
  return [
    {
      id: "risk",
      label: "위험도",
      title: riskLabelText(input.risk),
      detail: isBrowserTask
        ? "클릭·입력·제출 후보는 최종 확인 전 잠금"
        : "파일 열기·저장·이동·삭제 후보는 최종 확인 전 잠금",
      state: riskScore >= 2 ? "active" : "ready",
    },
    {
      id: "preview",
      label: "미리보기",
      title: isBrowserTask ? "화면/대상 확인" : "파일명·위치 확인",
      detail: input.preview,
      state: input.preview ? "ready" : "locked",
    },
    {
      id: "decision",
      label: "결정",
      title: officeDecisionActionLabels,
      detail: `${officeDecisionActionLabels} 중 하나를 오피스에서 고릅니다.`,
      state: "active",
    },
    {
      id: "log",
      label: "실행 로그",
      title: hasLogPath ? "기록 위치 있음" : "기록 대기",
      detail: input.logPath,
      state: hasLogPath ? "ready" : "locked",
    },
    {
      id: "rollback",
      label: "되돌리기 안내",
      title: "되돌리기 기준",
      detail: input.rollbackGuide,
      state: input.rollbackGuide ? "ready" : "locked",
    },
  ];
}

function buildApprovalActionReadinessCards(input: {
  workItems: WorkItem[];
  channelDecisions: NonNullable<Props["channelDecisions"]>;
  delegationArtifacts: LocalMemoryDelegationArtifactRecord[];
  finalDryRun: FinalActionDryRunResult | null;
  finalExecution: FinalActionExecutionResult | null;
}): ApprovalActionReadinessCard[] {
  const cards: ApprovalActionReadinessCard[] = [];
  for (const item of input.workItems.slice(0, 8)) {
    const itemRisk = highestWorkItemRisk([item]);
    const sourceLabel = [
      item.sourceLabel,
      item.sourceEvidence?.mailboxLabel,
      item.sourceEvidence?.providerId,
    ]
      .filter(Boolean)
      .map((part) => officeUserFacingSourceLabel(part))
      .slice(0, 2)
      .join(" · ") || "오피스 승인함";
    const preview =
      item.draft?.body ||
      item.sourceEvidence?.draftPreview ||
      item.sourceEvidence?.calendarCandidateText ||
      item.sourceEvidence?.calendarTimeRangeLabel ||
      item.browserTask?.dryRunPlan?.expectedResult ||
      item.finalAction?.checklist?.[0] ||
      item.summary ||
      "실행 전에 내용과 대상을 먼저 확인합니다.";
    const hasAuditRecord = Boolean(
      input.finalExecution?.auditFile ||
        input.finalExecution?.auditId ||
        input.finalDryRun?.auditFile ||
        input.finalDryRun?.auditId ||
        item.browserTask?.finalPresenceContract?.limitedExecutionGate?.auditFile ||
        item.browserTask?.finalPresenceContract?.limitedExecutionGate?.executionAuditFile ||
        item.approvedOutput?.path,
    );
    const logPath = hasAuditRecord
      ? "최종 실행 감사 기록"
      : "승인, 수정, 실행 전 검토, 실행 조건은 업무 기록과 감사 기록에 남습니다.";
    const rollbackGuide =
      item.browserTask?.dryRunPlan?.rollbackGuide ||
      item.browserTask?.finalPresenceContract?.limitedExecutionGate?.rollbackGuide ||
      item.finalAction?.blockedReason ||
      (item.draft?.requiresApprovalBeforeSend
        ? "승인 전에는 초안 상태로 보류하고, 실행 뒤에는 감사 기록에서 되돌리기 기준을 확인합니다."
        : "실행 전에는 취소할 수 있고, 실행 뒤에는 감사 기록을 먼저 확인합니다.");
    const decisionGuide = item.finalAction
      ? "마지막 확인 준비 -> 실행 전 검토 -> 마지막 확인 순서로 진행합니다."
      : item.browserTask
        ? "화면 읽기와 계획 확인 뒤 클릭/입력은 최종 확인 전까지 잠급니다."
        : `${officeDecisionActionLabels} 중 하나를 고르면 담당 AI 팀원 업무 기록에 남깁니다. ${officeDecisionMemoryLabel}는 직접 저장할 때만 적용합니다.`;
    const needsFinalGate = Boolean(item.finalAction || item.browserTask);
    cards.push({
      id: item.id,
      title: item.title,
      sourceLabel,
      riskLabel: riskLabelText(itemRisk),
      readinessGuide: finalActionReadinessGuide(item),
      commonChecks: buildApprovalCommonChecks({
        risk: itemRisk,
        preview,
        logPath,
        rollbackGuide,
        decisionGuide,
        needsFinalGate,
      }),
      computerUseChecks: buildComputerUseOfficeApprovalChecks({
        item,
        risk: itemRisk,
        preview,
        logPath,
        rollbackGuide,
      }),
      preview,
      logPath,
      rollbackGuide,
      decisionGuide,
      nextUserChoice: officeNextUserChoiceForWorkItem(item),
      decisionSteps: buildApprovalDecisionPathForWorkItem({
        item,
        finalDryRun: input.finalDryRun,
        finalExecution: input.finalExecution,
      }),
      state: riskWeight(itemRisk) >= 3 ? "danger" : riskWeight(itemRisk) >= 2 ? "review" : "safe",
    });
  }

  for (const decision of input.channelDecisions.slice(0, 3)) {
    cards.push({
      id: `decision-${decision.id}`,
      title: decision.title,
      sourceLabel: `${decision.channel} · ${decision.decidedBy}`,
      riskLabel: decision.requiresAppReconfirm ? "중간" : "낮음",
      readinessGuide: {
        label: decision.requiresAppReconfirm ? "앱 재확인" : "기록 완료",
        title: decision.requiresAppReconfirm ? "앱에서 한 번 더 확인" : "결정 기록",
        detail: decision.requiresAppReconfirm
          ? "메신저 결정만으로 외부 실행하지 않고 앱 승인함에서 다시 확인합니다."
          : "외부 실행 없이 결정 기록과 다음 후보 품질에 반영합니다.",
      nextAction: decision.requiresAppReconfirm ? "오피스 승인함 확인" : "AI 팀원 작업 확인",
        state: decision.requiresAppReconfirm ? "review" : "ready",
      },
      preview: decision.messagePreview || decision.revisionInstruction || "알림에서 고른 결정을 앱의 마지막 확인으로 다시 모읍니다.",
      logPath: decision.decisionLogPath || decision.workLogPath || "결정 기록과 업무 기록에 남깁니다.",
      rollbackGuide: decision.revisionInstruction || "고쳐달라고 하기와 보류하기는 담당 AI 팀원 작업으로 되돌려 다시 작성합니다.",
      decisionGuide: decision.requiresAppReconfirm
        ? "메신저 결정만으로 실행하지 않고 앱에서 한 번 더 확인합니다."
        : `알림에서 고른 결정은 기록으로 남기고 ${officeDecisionMemoryLabel}를 눌렀을 때만 다음 후보 품질에 반영합니다.`,
      commonChecks: buildApprovalCommonChecks({
        risk: decision.requiresAppReconfirm ? "medium" : "low",
        preview: decision.messagePreview || decision.revisionInstruction || "알림에서 고른 결정을 앱의 마지막 확인으로 다시 모읍니다.",
        logPath: decision.decisionLogPath || decision.workLogPath || "결정 기록과 업무 기록에 남깁니다.",
        rollbackGuide: decision.revisionInstruction || "고쳐달라고 하기와 보류하기는 담당 AI 팀원 작업으로 되돌려 다시 작성합니다.",
        decisionGuide: decision.requiresAppReconfirm
          ? "메신저 결정만으로 실행하지 않고 앱에서 한 번 더 확인합니다."
          : `알림에서 고른 결정은 기록으로 남기고 ${officeDecisionMemoryLabel}를 눌렀을 때만 다음 후보 품질에 반영합니다.`,
        needsFinalGate: decision.requiresAppReconfirm,
      }),
      computerUseChecks: [],
      nextUserChoice: "오피스 승인함 또는 AI 팀원 작업 다시 확인",
      decisionSteps: buildApprovalDecisionPathForRecordedDecision(decision),
      state: decision.requiresAppReconfirm ? "review" : "safe",
    });
  }

  for (const artifact of input.delegationArtifacts.filter((artifact) => artifact.artifactKind === "approval" && !artifact.approvalDecision).slice(0, 3)) {
    cards.push({
      id: `artifact-${artifact.id}`,
      title: artifact.title,
      sourceLabel: artifact.teammateName || "AI 팀원 결과",
      riskLabel: artifactApprovalRequired(artifact) ? "중간" : "낮음",
      readinessGuide: {
        label: artifactApprovalRequired(artifact) ? "승인 필요" : "읽기 전용",
        title: artifactApprovalRequired(artifact) ? "결과 승인 대기" : "외부 실행 없음",
        detail: artifactApprovalRequired(artifact)
          ? `${officeDecisionActionLabels} 중 하나를 고르기 전에는 다음 실행으로 넘기지 않습니다.`
          : "결과를 확인하고 필요하면 새 업무로 이어갈 수 있습니다.",
        nextAction: artifactApprovalRequired(artifact) ? "승인함에서 결정" : "AI 팀원 결과 확인",
        state: artifactApprovalRequired(artifact) ? "review" : "ready",
      },
      preview: artifact.requestText || artifact.rows?.[0]?.summary || "팀원 결과 승인 요청입니다.",
      logPath: artifact.relativePath ? officeMemoryReferenceLabel(artifact.relativePath) : "AI 팀원 결과와 담당 팀원 업무 기록에 남습니다.",
      rollbackGuide: artifact.nextActionLabel || "고쳐달라고 하기를 선택하면 담당 AI 팀원 재작업으로 되돌립니다.",
      decisionGuide: `${officeDecisionActionLabels} 중 하나를 선택합니다.`,
      commonChecks: buildApprovalCommonChecks({
        risk: artifactApprovalRequired(artifact) ? "medium" : "low",
        preview: artifact.requestText || artifact.rows?.[0]?.summary || "팀원 결과 승인 요청입니다.",
        logPath: artifact.relativePath ? officeMemoryReferenceLabel(artifact.relativePath) : "AI 팀원 결과와 담당 팀원 업무 기록에 남습니다.",
        rollbackGuide: artifact.nextActionLabel || "고쳐달라고 하기를 선택하면 담당 AI 팀원 재작업으로 되돌립니다.",
        decisionGuide: `${officeDecisionActionLabels} 중 하나를 선택합니다.`,
        needsFinalGate: artifactApprovalRequired(artifact),
      }),
      computerUseChecks: [],
      nextUserChoice: "AI 팀원 또는 보고서 만들기",
      decisionSteps: buildApprovalDecisionPathForDelegationArtifact(artifact),
      state: artifactApprovalRequired(artifact) ? "review" : "safe",
    });
  }

  return cards.slice(0, 8);
}

function buildApprovalDecisionPathForWorkItem(input: {
  item: WorkItem;
  finalDryRun: FinalActionDryRunResult | null;
  finalExecution: FinalActionExecutionResult | null;
}): ApprovalDecisionPathStep[] {
  const hasPreview = Boolean(
    input.item.draft ||
      input.item.sourceEvidence?.draftPreview ||
      input.item.sourceEvidence?.calendarCandidateText ||
      input.item.browserTask?.dryRunPlan ||
      input.item.finalAction?.checklist?.length,
  );
  const needsFinalGate = Boolean(input.item.finalAction || input.item.browserTask?.requiresFinalUserPresence);
  const dryRunReady = Boolean(input.finalDryRun?.auditId || input.item.browserTask?.finalPresenceContract?.limitedExecutionGate?.auditFile);
  const executionRecorded = Boolean(input.finalExecution?.auditId || input.item.approvedOutput?.path);
  return [
    {
      id: "preview",
      label: "미리보기 확인",
      title: hasPreview ? "내용과 대상 확인" : "미리보기 대기",
      detail: hasPreview ? "바로 실행하지 않고 먼저 볼 항목이 준비됐습니다." : "후보가 생기면 내용과 대상을 먼저 보여줍니다.",
      state: hasPreview ? "ready" : "locked",
    },
    {
      id: "decision",
      label: "앱에서 결정",
      title: officeDecisionActionLabels,
      detail: `사용자가 고른 결정만 업무 기록에 남깁니다. ${officeDecisionMemoryLabel}는 직접 저장할 때만 적용합니다.`,
      state: "active",
    },
    {
      id: "dry-run",
      label: "실행 전 검토",
      title: dryRunReady ? "검토 기록 있음" : needsFinalGate ? "검토 필요" : "최종 실행 없음",
      detail: needsFinalGate ? "발송, 등록, 클릭, 파일 변경 전 실행 전 검토를 확인합니다." : "초안 후보는 외부 실행 없이 보류할 수 있습니다.",
      state: dryRunReady ? "ready" : needsFinalGate ? "active" : "locked",
    },
    {
      id: "log",
      label: "실행 로그",
      title: executionRecorded ? "기록 있음" : "기록 대기",
      detail: `${officeDecisionActionLabels}, 실행 전 검토, 최종 실행 조건을 감사 기록에 남깁니다.`,
      state: executionRecorded ? "ready" : "locked",
    },
  ];
}

function buildApprovalDecisionPathForRecordedDecision(
  decision: NonNullable<Props["channelDecisions"]>[number],
): ApprovalDecisionPathStep[] {
  return [
    {
      id: "preview",
      label: "결정 내용 확인",
      title: decision.messagePreview ? "요약 있음" : "메시지 확인",
      detail: decision.messagePreview || "메신저나 AI 팀원 작업에서 들어온 결정 내용을 확인합니다.",
      state: "ready",
    },
    {
      id: "decision",
      label: "앱에서 재확인",
      title: decision.requiresAppReconfirm ? "최종 확인 필요" : "기록 반영",
      detail: decision.requiresAppReconfirm ? "외부 실행 전 앱 승인함에서 다시 확인합니다." : "결정 로그에 반영합니다.",
      state: decision.requiresAppReconfirm ? "active" : "ready",
    },
    {
      id: "route",
      label: "담당 팀원 반영",
      title: decision.channelName || decision.channel,
      detail: "고쳐달라고 하기와 보류하기는 담당 AI 팀원 작업으로 되돌아갑니다.",
      state: "ready",
    },
    {
      id: "log",
      label: "실행 로그",
      title: decision.decisionLogPath || decision.workLogPath ? "기록 있음" : "기록 대기",
      detail: decision.decisionLogPath || decision.workLogPath ? "팀원 결정 기록과 업무 기록에 남깁니다." : "결정 기록과 업무 기록에 남깁니다.",
      state: decision.decisionLogPath || decision.workLogPath ? "ready" : "locked",
    },
  ];
}

function buildApprovalDecisionPathForDelegationArtifact(
  artifact: LocalMemoryDelegationArtifactRecord,
): ApprovalDecisionPathStep[] {
  return [
    {
      id: "preview",
      label: "결과 확인",
      title: artifact.title,
      detail: artifact.requestText || artifact.rows?.[0]?.summary || "팀원 결과 내용을 먼저 확인합니다.",
      state: "ready",
    },
    {
      id: "decision",
      label: officeDecisionActionLabels,
      title: artifactApprovalRequired(artifact) ? "결정 필요" : "검토 가능",
      detail: `${officeDecisionActionLabels} 중 하나를 선택합니다.`,
      state: artifactApprovalRequired(artifact) ? "active" : "ready",
    },
    {
      id: "route",
      label: "재작업 경로",
      title: artifact.nextActionLabel || "담당 AI 팀원",
      detail: "고쳐달라고 하기를 선택하면 담당 AI 팀원에게 되돌립니다.",
      state: "active",
    },
    {
      id: "log",
      label: "실행 로그",
      title: artifact.relativePath ? "기록 있음" : "기록 대기",
      detail: artifact.relativePath ? officeMemoryReferenceLabel(artifact.relativePath) : "AI 팀원 결과와 담당 팀원 업무 기록에 남습니다.",
      state: artifact.relativePath ? "ready" : "locked",
    },
  ];
}

function parseMailOpsWorkQueueReviewReceipt(message: string): ApprovalDecisionReceiptCard["mailOpsWorkQueueReview"] | undefined {
  const reviewMarker = message.includes("작업함 검토 반영:")
    ? "작업함 검토 반영:"
    : "업무대장 검토 반영:";
  const proofMarker = "검토 컨텍스트 proof:";
  if (!message.includes(reviewMarker)) return undefined;

  const reviewStart = message.indexOf(reviewMarker) + reviewMarker.length;
  const proofStart = message.indexOf(proofMarker, reviewStart);
  const reviewSegment = message
    .slice(reviewStart, proofStart > -1 ? proofStart : undefined)
    .trim();
  const [decisionPart, notePart = ""] = reviewSegment.split("· 수정 메모:");
  const proofSegment = proofStart > -1 ? message.slice(proofStart + proofMarker.length).trim() : "";
  const [contextPart = "", externalMutationPart = ""] = proofSegment.split("· 외부 실행");
  const decisionLabel = decisionPart.trim();
  if (!decisionLabel) return undefined;

  return {
    decisionLabel,
    note: notePart.trim(),
    context: contextPart.trim(),
    externalMutationLabel: externalMutationPart.trim() || "false",
  };
}

function buildApprovalDecisionReceiptCards(input: {
  mailOpsDecisionMessage: string;
  localFileActionMessage: string;
  localFilePatternMessage: string;
  folderPlanActionMessage: string;
  finalConfirmationMessage: string;
}): ApprovalDecisionReceiptCard[] {
  const cards: ApprovalDecisionReceiptCard[] = [];
  if (input.mailOpsDecisionMessage) {
    const isRevision = /수정 요청|고쳐달라고/u.test(input.mailOpsDecisionMessage);
    const isHold = /보류하기|보류했습니다|취소/u.test(input.mailOpsDecisionMessage);
    const isApproved = /승인|최종 확인/u.test(input.mailOpsDecisionMessage);
    const mailOpsWorkQueueReview = parseMailOpsWorkQueueReviewReceipt(input.mailOpsDecisionMessage);
    cards.push({
      id: "mailops-decision",
      label: isRevision ? "고쳐달라고 하기" : isHold ? "보류하기" : isApproved ? "실행하기 기록" : "결정 기록",
      title: input.mailOpsDecisionMessage,
      detail: isRevision
        ? "담당 AI 팀원에게 다시 확인할 내용을 넘겼습니다."
        : isHold
          ? "외부 실행 없이 후보를 보류했습니다."
          : "다음 단계로 넘어가기 전 앱의 마지막 확인을 계속 유지합니다.",
      executionStateLabel: isRevision || isHold ? "외부 실행 없음" : "마지막 확인 전 실행 안 함",
      recordPath: /DecisionMemory|DecisionLog/u.test(input.mailOpsDecisionMessage)
        ? "업무 결정 기억 · 팀원 결정 기록"
        : "오피스 마지막 확인 계약",
      rollbackLabel: isRevision
        ? "고쳐달라고 하기로 되돌아가며 발송, 등록, 파일 변경은 실행하지 않습니다."
        : isHold
          ? "보류한 후보라 원본 변경 없음, 필요하면 새 후보 생성"
          : "실행 전 검토와 마지막 확인 전까지 되돌릴 외부 변경은 만들지 않습니다.",
      nextStep: isRevision
        ? "담당 AI 팀원이 고친 초안을 다시 확인합니다."
        : isHold
          ? "필요하면 같은 요청을 다시 열거나 자료를 바꿔 새 후보를 만듭니다."
          : "마지막 확인 준비와 실행 전 검토를 차례로 확인합니다.",
      parallelWorkNextChoice: isRevision
        ? "추가 작업 맡기기로 수정 초안을 분리합니다."
        : isHold
          ? "승인함 보기에서 멈춘 후보를 확인합니다."
          : "승인함 보기에서 마지막 확인을 이어갑니다.",
      parallelWorkAction: isRevision ? "workers" : "open_office",
      state: isHold ? "blocked" : isRevision ? "review" : "saved",
      mailOpsWorkQueueReview,
    });
  }

  if (input.localFileActionMessage) {
    const isHold = /취소|보류/u.test(input.localFileActionMessage);
    const isDraft = /초안/u.test(input.localFileActionMessage);
    cards.push({
      id: "local-file-decision",
      label: isHold ? "보류하기" : isDraft ? "초안 준비" : "분석 완료",
      title: input.localFileActionMessage,
      detail: /원본 파일/u.test(input.localFileActionMessage)
        ? "원본 파일은 변경하지 않고 승인함 기록만 갱신했습니다."
        : "선택한 파일 범위 안에서 읽기/초안 후보만 처리했습니다.",
      executionStateLabel: isHold ? "외부 실행 없음" : isDraft ? "초안 후보만 생성" : "읽기 분석만 완료",
      recordPath: "학습 초안 오피스 승인함 · 로컬 파일 작업 기록",
      rollbackLabel: isHold
        ? "원본 파일 변경 없음, 필요하면 자료를 다시 선택합니다."
        : "파일 저장, 이동, 삭제, 외부 공유는 실행하지 않았습니다.",
      nextStep: isHold
        ? "필요하면 자료를 다시 선택하거나 새 초안 후보를 만듭니다."
        : isDraft
          ? "초안 내용을 확인한 뒤 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다."
          : "분석 결과를 보고 초안 만들기 또는 보류하기를 선택합니다.",
      parallelWorkNextChoice: isHold
        ? "기존 작업 확인에서 자료 선택 흐름을 다시 엽니다."
        : isDraft
          ? "승인함 보기에서 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다."
          : "추가 작업 맡기기로 새 초안 생성을 분리합니다.",
      parallelWorkAction: isHold ? "today_check" : isDraft ? "open_office" : "workers",
      state: isHold ? "blocked" : "saved",
    });
  }

  if (input.localFilePatternMessage) {
    cards.push({
      id: "local-file-pattern",
      label: "방식 저장",
      title: input.localFilePatternMessage,
      detail: "다음 유사 요청에서 추천 카드와 업무 방식 기준으로 다시 쓸 수 있습니다.",
      executionStateLabel: "참고 기준만 저장",
      recordPath: "지난 업무 기억",
      rollbackLabel: "저장한 방식 관리에서 삭제할 수 있고 원본 파일은 변경하지 않습니다.",
      nextStep: "다음 요청에서 추천되면 이번 요청에 넣기로 적용합니다.",
      parallelWorkNextChoice: "추가 작업 맡기기에서 저장한 방식을 새 요청에 적용합니다.",
      parallelWorkAction: "workers",
      state: "saved",
    });
  }

  if (input.folderPlanActionMessage) {
    const isPreview = /검토|미리보기|dry-run/u.test(input.folderPlanActionMessage);
    const isRevert = /되돌리/u.test(input.folderPlanActionMessage);
    const isBlocked = /먼저|없습니다|필요|설치된 데스크톱 앱|오류/u.test(input.folderPlanActionMessage);
    cards.push({
      id: "folder-plan-decision",
      label: isBlocked ? "정리 확인 필요" : isPreview ? "실행 전 검토" : isRevert ? "되돌리기 기록" : "정리 적용 기록",
      title: input.folderPlanActionMessage,
      detail: isPreview
        ? "원본 이동 없이 적용 후보와 제외/충돌 기준만 확인했습니다."
        : isRevert
          ? "적용 기록 파일을 기준으로 되돌리기 결과를 남겼습니다."
          : "사용자 승인 문구를 거친 폴더 정리 적용 결과를 남겼습니다.",
      executionStateLabel: isPreview ? "원본 변경 없음" : isRevert ? "되돌리기 기록" : "실행하기 기록",
      recordPath: "오피스 승인함 · 폴더 정리 적용/되돌리기 기록",
      rollbackLabel: isPreview
        ? "아직 이동한 파일이 없어 취소하면 원본 변경 없음"
        : isRevert
          ? "되돌리기 기록 파일을 기준으로 확인"
          : "되돌리기는 '정리 되돌리기 승인' 후에만 실행",
      nextStep: isPreview
        ? "제외/충돌 항목을 확인한 뒤 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다."
        : "필요하면 승인함에서 실행 로그와 되돌리기 기준을 확인합니다.",
      parallelWorkNextChoice: isBlocked
        ? "승인함 보기에서 필요한 연결과 자료를 확인합니다."
        : isPreview
          ? "승인함 보기에서 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다."
          : "승인함 보기에서 실행 로그와 되돌리기 기준을 확인합니다.",
      parallelWorkAction: "open_office",
      state: isBlocked ? "review" : "saved",
    });
  }

  if (input.finalConfirmationMessage && !/사용자 마지막 확인 전까지 외부 변경 차단|사용자 최종 확인 전까지 외부 변경 차단/u.test(input.finalConfirmationMessage)) {
    cards.push({
      id: "final-confirmation",
      label: /오류|실패|먼저/u.test(input.finalConfirmationMessage) ? "확인 필요" : "최종 확인",
      title: input.finalConfirmationMessage,
      detail: "실행 전 검토와 최종 실행 확인 상태를 앱 승인함에 남깁니다.",
      executionStateLabel: /실제 처리 요청 완료|실행 요청/u.test(input.finalConfirmationMessage)
        ? "실행 요청 기록됨"
        : "마지막 확인 전 실행 안 함",
      recordPath: "최종 실행 감사 기록",
      rollbackLabel: /실제 처리 요청 완료|실행 요청/u.test(input.finalConfirmationMessage)
        ? "실행 뒤에는 감사 기록에서 되돌리기 가능 여부를 확인합니다."
        : "실행 전 검토와 마지막 확인 전까지 외부 변경은 만들지 않습니다.",
      nextStep: /먼저 (dry-run|실행 전 검토)/u.test(input.finalConfirmationMessage)
        ? "실행 전 검토를 먼저 완료합니다."
        : "마지막 확인 전까지 외부 실행은 잠겨 있습니다.",
      parallelWorkNextChoice: /먼저 (dry-run|실행 전 검토)/u.test(input.finalConfirmationMessage)
        ? "승인함 보기에서 실행 전 검토를 먼저 완료합니다."
        : "승인함 보기에서 마지막 확인과 감사 기록을 확인합니다.",
      parallelWorkAction: "open_office",
      state: /오류|실패|먼저/u.test(input.finalConfirmationMessage) ? "review" : "saved",
    });
  }

  return cards.slice(0, 3);
}

function buildOfficeWorkMethodRail(
  items: NonNullable<Props["channelQueueItems"]>,
  approvalWaitCount: number,
): OfficeWorkMethodItem[] {
  const queueText = items
    .map((item) => `${item.outputKind ?? ""} ${item.queueLabel ?? ""} ${item.sourceLabel} ${item.label} ${item.detail}`)
    .join(" ");
  const hasDocument = /document|knowledge|보고서|문서|word|excel|hwp/u.test(queueText);
  const hasMail = /mail|메일|mailops|send_email|calendar|일정/u.test(queueText);
  const hasFolder = /folder|폴더|정리|cleanup|tidy|folder_plan/u.test(queueText);

  return [
    {
      id: "learned-format",
      label: "학습한 형식",
      title: hasDocument || hasMail ? "문서·메일은 기존 톤과 양식 우선" : "AI 팀원 기억과 업무 기록 우선",
      detail: hasDocument
        ? "보고서, Word, Excel, 한글, 메일 초안의 문체와 표 구조를 초안 기준으로 씁니다."
        : hasMail
          ? "답장 톤, 일정 잡는 기준, 반복 문의 처리 방식을 먼저 적용합니다."
          : "담당 팀원의 기억과 최근 업무 기록을 먼저 참고합니다.",
      state: "learned",
    },
    {
      id: "default-folder",
      label: "기본 정리 방식",
      title: hasFolder ? "중복·프로젝트·날짜별 분류" : "안전한 초안/실행 전 검토",
      detail: hasFolder
        ? "폴더 정리는 중복 후보, 프로젝트별 분류, 날짜별 분류를 함께 제안하되 원본은 건드리지 않습니다."
        : "초안 작성과 후보 생성은 먼저 보여주고 외부 실행은 보류합니다.",
      state: "default",
    },
    {
      id: "alternate-method",
      label: "다른 방식 선택",
      title: "업무 폴더별·고객별·파일 종류별 전환",
      detail: "사용자가 원하면 정리 기준이나 문서 형식을 바꿔 다시 승인함에 올립니다.",
      state: "choice",
    },
    {
      id: "approval-lock",
      label: "승인 잠금",
      title: approvalWaitCount ? `${approvalWaitCount}개 실행 전 잠금` : "삭제·이동·발송 전 잠금",
      detail: "삭제, 이동, 이름 변경, 파일 저장, 메일 발송, 일정 등록은 앱의 마지막 확인 후에만 진행합니다.",
      state: "approval",
    },
  ];
}

function buildOfficeExecutionBoundaryRail(approvalWaitCount: number): OfficeExecutionBoundaryItem[] {
  return [
    {
      id: "small-feature",
      label: "초안 후보",
      title: "초안·후보 생성",
      detail: "채팅에서 만든 메일 초안, 문서 후보, 정리 검토는 먼저 결과만 보여줍니다.",
      state: "chat",
    },
    {
      id: "large-workspace",
      label: "오피스 승인함",
      title: "실행 전 확인",
      detail: "외부 계정, 팀원 결과, 실행 전 확인 후보는 이 오피스 카드에서 넓게 확인합니다.",
      state: "workspace",
    },
    {
      id: "single-setting",
      label: "필요 설정",
      title: "필요 설정만 열기",
      detail: "계정 보관함, 연결 재점검, 내 PC 작업 도우미는 각각 자기 설정칸만 엽니다.",
      state: "setting",
    },
    {
      id: "approval-lock",
      label: "승인 잠금",
      title: approvalWaitCount ? `${approvalWaitCount}개 최종 확인` : "외부 실행 전 잠금",
      detail: "발송, 등록, 삭제, 이동, 클릭, 입력은 사용자 최종 확인 뒤에만 진행합니다.",
      state: "approval",
    },
  ];
}

function buildBrowserTaskProgressSteps(item: WorkItem): BrowserTaskProgressStep[] {
  const task = item.browserTask;
  if (!task) return [];
  const hasPlan = Boolean(task.dryRunPlan || task.actionPlan?.length || task.stagedAction);
  const contract = task.finalPresenceContract;
  const screenEvidenceCaptured =
    contract?.screenEvidenceStatus === "captured" || contract?.screenEvidenceStatus === "not_required";
  const targetMatched = contract?.targetElementMatchStatus === "matched";
  const gate = contract?.limitedExecutionGate;
  const gateRecorded = Boolean(gate?.auditRecorded || gate?.auditFile || gate?.executionAuditFile);
  const executionConfirmed =
    gate?.executionStatus === "executed" ||
    gate?.executionStatus === "adapter_locked";
  return [
    {
      id: "card",
      label: "1",
      title: "업무 카드",
      detail: [task.host || item.sourceLabel || "브라우저 업무", task.requiresFinalUserPresence ? "최종 확인 필요" : "읽기 후보"]
        .filter(Boolean)
        .join(" · "),
      state: "done",
    },
    {
      id: "preview",
      label: "2",
      title: hasPlan ? "미리보기 있음" : "미리보기 대기",
      detail: task.dryRunPlan?.expectedResult || task.stagedAction?.label || task.actionPlan?.[0]?.label || "무엇을 클릭/입력할지 먼저 카드로 만듭니다.",
      state: hasPlan ? "review" : "active",
    },
    {
      id: "screen",
      label: "3",
      title: screenEvidenceCaptured ? "화면 증거 확인" : contract ? "화면 증거 필요" : "화면 증거 대기",
      detail:
        contract?.screenEvidence?.sourceLabel ||
        contract?.targetElementDescription ||
        "내 PC 작업 도우미 확인에서 대상 화면을 읽기 전용으로 붙입니다.",
      state: screenEvidenceCaptured ? "done" : contract ? "active" : "locked",
    },
    {
      id: "gate",
      label: "4",
      title: gateRecorded ? "마지막 확인 기록" : targetMatched ? "마지막 확인 준비" : "마지막 확인 잠금",
      detail:
        gate?.confirmationPhrase ||
        contract?.blockedReason ||
        "대상 요소 매칭과 확인 문구가 있어야 클릭/입력 후보를 열 수 있습니다.",
      state: gateRecorded ? "review" : targetMatched ? "active" : "locked",
    },
    {
      id: "audit",
      label: "5",
      title: executionConfirmed ? "감사 기록 있음" : "기록 대기",
      detail:
        gate?.executionAuditFile || gate?.auditFile
          ? "내 PC 작업 감사 기록"
          : task.dryRunPlan?.rollbackGuide || "승인, 실행 요청, 결과 확인은 감사 로그로 남깁니다.",
      state: executionConfirmed || gateRecorded ? "review" : "locked",
    },
  ];
}

function browserTaskNextActionLabel(item: WorkItem): string {
  const task = item.browserTask;
  if (!task) return "다음 선택: 오피스 승인함에서 처리합니다.";
  const contract = task.finalPresenceContract;
  const gate = contract?.limitedExecutionGate;
  if (!task.dryRunPlan && !task.actionPlan?.length) return "다음 선택: 내 PC 작업 도우미 확인에서 작업 계획을 먼저 만듭니다.";
  if (!contract) return "다음 선택: 내 PC 작업 도우미 확인에서 화면 증거를 붙이고 대상 요소를 확인합니다.";
  if (contract.screenEvidenceStatus === "not_captured") return "다음 선택: 화면 증거 붙이기로 대상 화면을 읽기 전용 확인합니다.";
  if (contract.targetElementMatchStatus !== "matched") return "다음 선택: 대상 요소 매칭으로 실행 전 검토 대상과 화면을 비교합니다.";
  if (!gate?.auditRecorded) return "다음 선택: 마지막 확인을 준비해 감사 ID와 확인 문구를 남깁니다.";
  if (!gate.userConfirmationVerified) return "다음 선택: 최종 문구 확인 뒤에도 실제 조작은 잠금 상태로 점검합니다.";
  return "다음 선택: 실행 요청과 결과 확인은 감사 로그를 남긴 뒤 사용자 승인으로만 진행합니다.";
}

function browserTaskNextActionCapability(item: WorkItem): { capability: DesktopControlCapabilityId; label: string } | null {
  const task = item.browserTask;
  if (!task) return null;
  const contract = task.finalPresenceContract;
  const gate = contract?.limitedExecutionGate;
  if (!task.dryRunPlan && !task.actionPlan?.length) {
    return { capability: "plan_browser_actions", label: "작업 계획 만들기" };
  }
  if (!contract || contract.screenEvidenceStatus === "not_captured") {
    return { capability: "attach_browser_screen_evidence", label: "화면 증거 붙이기" };
  }
  if (contract.targetElementMatchStatus !== "matched") {
    return { capability: "match_browser_target_element", label: "대상 요소 매칭" };
  }
  if (!gate?.auditRecorded) {
    return { capability: "prepare_browser_limited_execution", label: "마지막 확인 준비" };
  }
  if (!gate.userConfirmationVerified) {
    return { capability: "confirm_browser_limited_execution", label: "최종 문구 확인" };
  }
  if (gate.executionStatus === "executed" && gate.postExecutionStatus !== "verified") {
    return { capability: "verify_browser_limited_execution_result", label: "결과 화면 확인" };
  }
  return { capability: "request_browser_limited_execution", label: "실행 요청 점검" };
}

function buildBrowserTaskDecisionRail(item: WorkItem): BrowserTaskDecisionRailItem[] {
  const task = item.browserTask;
  if (!task) return [];
  const nextAction = browserTaskNextActionCapability(item);
  const gate = task.finalPresenceContract?.limitedExecutionGate;
  const auditLabel =
    gate?.postExecutionAuditFile ||
    gate?.executionAuditFile ||
    gate?.executionAttemptAuditFile ||
    gate?.confirmationAuditFile ||
    gate?.auditFile ||
    "";
  const rollbackGuide =
    task.dryRunPlan?.rollbackGuide ||
    gate?.rollbackGuide ||
    "실행 전 카드라 취소하면 외부 변경 없이 보류됩니다.";
  return [
    {
      id: "execute",
      label: "실행",
      title: nextAction ? nextAction.label : "실행 요청 대기",
      detail: "설치 앱에서 읽기/감사 기록부터 진행하고 실제 클릭·입력은 계속 승인 잠금입니다.",
      state: nextAction ? "active" : "locked",
    },
    {
      id: "cancel",
      label: "취소",
      title: "취소/보류 가능",
      detail: "실행 전 카드라 취소해도 외부 사이트, 파일, 메일은 바뀌지 않습니다.",
      state: "review",
    },
    {
      id: "log",
      label: "로그",
      title: auditLabel ? "기록 근거 있음" : "로그 대기",
      detail: auditLabel
        ? officeMemoryReferenceLabel(auditLabel)
        : "화면 증거, 마지막 확인, 실행 요청은 업무 기록과 감사 기록에 남깁니다.",
      state: auditLabel ? "review" : "locked",
    },
    {
      id: "rollback",
      label: "되돌리기",
      title: "되돌리기 안내",
      detail: rollbackGuide,
      state: rollbackGuide ? "review" : "locked",
    },
  ];
}

function browserTaskAuditPath(item: WorkItem) {
  const gate = item.browserTask?.finalPresenceContract?.limitedExecutionGate;
  return (
    gate?.postExecutionAuditFile ||
    gate?.executionAuditFile ||
    gate?.executionAttemptAuditFile ||
    gate?.confirmationAuditFile ||
    gate?.auditFile ||
    "내 PC 작업 도우미 감사 기록 대기"
  );
}

function browserTaskResultTitle(item: WorkItem) {
  const gate = item.browserTask?.finalPresenceContract?.limitedExecutionGate;
  if (gate?.executionStatus === "executed" || gate?.status === "executed") return "실제 처리 완료";
  if (gate?.executionAttemptAuditFile || gate?.executionStatus === "adapter_locked") return "실행 요청 차단 기록";
  if (gate?.auditRecorded || gate?.auditFile) return "마지막 확인 준비됨";
  return "실행 전 잠금";
}

function buildBrowserTaskResultReceipts(item: WorkItem): BrowserTaskResultReceiptItem[] {
  const task = item.browserTask;
  if (!task) return [];
  const contract = task.finalPresenceContract;
  const gate = contract?.limitedExecutionGate;
  const auditPath = browserTaskAuditPath(item);
  const screenEvidenceCaptured =
    contract?.screenEvidenceStatus === "captured" || contract?.screenEvidenceStatus === "not_required";
  const targetMatched = contract?.targetElementMatchStatus === "matched";
  const executionResultDetail =
    gate?.adapterResultSummary ||
    gate?.userVisibleOutcome ||
    gate?.blockedReason ||
    contract?.blockedReason ||
    "클릭·입력은 화면 증거와 최종 확인 전까지 실행하지 않습니다.";
  const rollbackGuide =
    task.dryRunPlan?.rollbackGuide ||
    gate?.rollbackGuide ||
    "실행 전 카드라 취소해도 외부 사이트, 파일, 메일은 바뀌지 않습니다.";

  return [
    {
      id: "result",
      label: "결과",
      title: browserTaskResultTitle(item),
      detail: executionResultDetail,
      recordPath: auditPath,
      state: gate?.executionStatus === "executed" || gate?.status === "executed" ? "ready" : gate?.auditRecorded || gate?.executionAttemptAuditFile ? "review" : "locked",
    },
    {
      id: "screen",
      label: "화면",
      title: screenEvidenceCaptured ? "화면 증거 확인" : "화면 증거 대기",
      detail:
        contract?.screenEvidence?.evidenceSummary ||
        contract?.screenEvidence?.sourceLabel ||
        contract?.targetElementDescription ||
        task.dryRunPlan?.clickTarget ||
        "대상 화면을 읽기 전용으로 확인한 뒤에만 다음 단계로 넘어갑니다.",
      recordPath: contract?.screenEvidence?.sourceLabel || auditPath,
      state: screenEvidenceCaptured ? "review" : "locked",
    },
    {
      id: "confirmation",
      label: "확인",
      title: targetMatched ? "대상 확인 완료" : gate?.auditRecorded ? "확인 문구 기록" : "최종 확인 대기",
      detail:
        gate?.confirmationPhrase ||
        contract?.userConfirmationPhrase ||
        contract?.blockedReason ||
        "사용자가 앱에서 대상과 문구를 확인하기 전에는 실제 클릭·입력을 열지 않습니다.",
      recordPath: gate?.confirmationAuditFile || auditPath,
      state: targetMatched || gate?.auditRecorded ? "review" : "locked",
    },
    {
      id: "rollback",
      label: "되돌리기",
      title: "되돌리기 안내",
      detail: rollbackGuide,
      recordPath: auditPath,
      state: rollbackGuide ? "review" : "locked",
    },
  ];
}

function isRepeatWorkApprovalCandidateText(text: string) {
  return /반복|자동|업무팩|점검|automation|trigger|scheduler|scheduleBriefing|triggerRule|메일·일정/u.test(text);
}

function buildRepeatWorkOfficeApprovalItems(input: {
  channelQueueItems: NonNullable<Props["channelQueueItems"]>;
  finalActionCandidates: WorkItem[];
  externalApprovalCandidates: WorkItem[];
  learnedDraftApprovalItems: WorkItem[];
}): RepeatWorkOfficeApprovalItem[] {
  const candidates: RepeatWorkOfficeApprovalItem[] = [];
  const seen = new Set<string>();
  const push = (item: RepeatWorkOfficeApprovalItem, dedupeKey = item.id) => {
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    candidates.push(item);
  };

  for (const item of input.channelQueueItems) {
    if (item.kind !== "approval") continue;
    const searchText = [
      item.label,
      item.detail,
      item.sourceLabel,
      item.queueLabel,
      item.outputKind,
      item.skillId,
      item.crewKitLabel,
    ]
      .filter(Boolean)
      .join(" ");
    if (!isRepeatWorkApprovalCandidateText(searchText)) continue;
    const hasExternalExecutionRisk = /발송|등록|공유|클릭|입력|제출|이동|삭제|최종 확인|calendar|email|share/u.test(searchText);
    push({
      id: `queue-${item.id}`,
      label: item.queueLabel || item.sourceLabel || "승인 후보",
      title: item.label,
      detail: item.detail || "반복 업무 점검 결과를 오피스 승인함에서 확인합니다.",
      sourceLabel: item.channelName || item.teammateName || "오피스 승인함",
      riskLabel: hasExternalExecutionRisk ? "높음 · 외부 실행 잠금" : "중간 · 반복 실행 후보",
      previewLabel: item.detail || "점검 결과와 실행 후보를 먼저 읽습니다.",
      decisionLabel: hasExternalExecutionRisk ? "최종 확인 전 실행하지 않음" : "실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다.",
      logLabel: hasExternalExecutionRisk ? "마지막 확인 기록 대기" : "업무 기록과 승인 결정 로그에 남깁니다.",
      undoLabel: "실행 전 취소 가능, 실행 뒤 감사 기록 기준 확인",
      state: "approval",
    }, item.workItemId ?? item.id);
  }

  for (const item of [...input.finalActionCandidates, ...input.externalApprovalCandidates, ...input.learnedDraftApprovalItems]) {
    const repeatEvidenceText = [
      item.sourceEvidence?.providerId,
      item.sourceEvidence?.connectorId,
      item.sourceEvidence?.approvalCandidateLabels?.join(" "),
      item.scheduleBriefing?.triggerRuleId,
      item.scheduleBriefing?.reason,
      item.browserTask?.stagedAction?.label,
    ]
      .filter(Boolean)
      .join(" ");
    if ((item.finalAction || item.browserTask) && !isRepeatWorkApprovalCandidateText(repeatEvidenceText)) continue;
    const searchText = [
      item.title,
      item.summary,
      item.sourceLabel,
      repeatEvidenceText,
      item.finalAction?.label,
      item.browserTask?.stagedAction?.label,
    ]
      .filter(Boolean)
      .join(" ");
    if (!isRepeatWorkApprovalCandidateText(searchText)) continue;
    push({
      id: `work-${item.id}`,
      label: item.finalAction ? "실행 전 확인 후보" : item.browserTask ? "외부 작업 후보" : "초안 승인 후보",
      title: item.title,
      detail: item.summary || item.body || "점검 결과가 생기면 실행 전 미리보기로 확인합니다.",
      sourceLabel: item.sourceLabel || "반복 업무 점검",
      riskLabel: item.finalAction || item.browserTask ? "높음 · 외부 실행 잠금" : "중간 · 초안 승인",
      previewLabel: item.summary || item.finalAction?.label || item.browserTask?.stagedAction?.label || "실행 전 미리보기로 확인",
      decisionLabel: item.finalAction || item.browserTask ? "최종 확인 전 실행하지 않음" : "실행하기, 고쳐달라고 하기, 보류하기 선택",
      logLabel: item.finalAction || item.browserTask ? "마지막 확인 기록 대기" : "업무 기록에 승인 결정을 남김",
      undoLabel: item.finalAction || item.browserTask ? "실행 전 취소 가능, 실행 뒤 감사 기록 기준 확인" : "취소해도 외부 사이트와 파일은 바뀌지 않음",
      state: item.finalAction || item.browserTask ? "locked" : "approval",
    }, item.id);
  }

  return candidates.slice(0, 4);
}

function channelQueueActionProfile(
  item: NonNullable<Props["channelQueueItems"]>[number],
  hasArtifact: boolean,
  hasWorkItem: boolean,
) {
  if (item.kind === "approval" && hasWorkItem) {
    return {
      tone: "approval",
      label: "최종 확인 필요",
      detail: "실행 전 검토 후 앱 안에서 실행을 확정합니다.",
    };
  }
  if (item.kind === "approval" && hasArtifact) {
    return {
      tone: "approval",
      label: "결과 승인 필요",
      detail: "승인, 수정, 보류 중 하나로 담당 AI 팀원에게 되돌려 보냅니다.",
    };
  }
  if (item.kind === "running") {
    return {
      tone: "running",
      label: "작업 중",
      detail: "진행 기록은 담당 AI 팀원 업무 기록과 오피스 이벤트에 남습니다.",
    };
  }
  if (item.kind === "growth") {
    return {
      tone: "growth",
      label: "업무 도구 추천",
      detail: "업무 도구 추천을 확인하고 필요한 도구만 켭니다.",
    };
  }
  if (item.kind === "error" || item.kind === "unknown") {
    return { tone: "error", label: item.kind === "error" ? "실패 확인" : "실행 상태 확인 필요", detail: item.detail };
  }
  return {
    tone: "result",
    label: item.approvalRequired ? "승인 경계 저장" : "결과 저장됨",
    detail: item.memoryPath ? "결과 문서 또는 업무 기록을 열어 확인합니다." : "결과가 오피스 승인함에 정리되었습니다.",
  };
}

function channelQueueNextSteps(
  item: NonNullable<Props["channelQueueItems"]>[number],
  hasArtifact: boolean,
  hasWorkItem: boolean,
) {
  return [
    {
      id: "review",
      label: "확인",
      detail: hasArtifact ? "결과 문서" : hasWorkItem ? "실행 후보" : item.queueLabel || channelQueueKindLabel(item.kind),
      state: item.kind === "running" ? "running" : item.kind === "error" || item.kind === "unknown" ? "todo" : "done",
    },
    {
      id: "decision",
      label: item.kind === "approval" ? "결정" : "담당",
      detail: item.kind === "approval" ? officeDecisionActionLabels : item.channelName,
      state: item.kind === "approval" ? "approval" : item.kind === "running" ? "running" : item.kind === "error" || item.kind === "unknown" ? "todo" : "done",
    },
    {
      id: "memory",
      label: "기록",
      detail: item.memoryPath ? "업무 방식/작업 기록" : "오피스 이벤트",
      state: item.kind === "error" || item.kind === "unknown" ? "todo" : item.memoryPath || item.kind === "result" || item.kind === "growth" ? "done" : "todo",
    },
  ] as const;
}

function mailOpsAssistantDecisionRail(input: { isCalendar: boolean; readiness: string }) {
  const ready = input.readiness === "ready_for_final_confirmation";
  return [
    {
      id: "review",
      label: input.isCalendar ? "일정 후보" : "답장 초안",
      detail: "내용 확인",
      state: "done",
    },
    {
      id: "decision",
      label: officeDecisionActionLabels,
      detail: "업무 비서에게 전달",
      state: "active",
    },
    {
      id: "dry_run",
      label: "실행 전 검토",
      detail: ready ? "검증 가능" : "연결 확인 후",
      state: ready ? "active" : "locked",
    },
    {
      id: "final",
      label: input.isCalendar ? "캘린더 등록" : "메일 발송",
      detail: "사용자 최종 확인 전 잠금",
      state: "locked",
    },
  ] as const;
}

function connectorLabel(record: ConnectorStatusRecord) {
  if (record.siteLabel) return record.siteLabel;
  if (record.siteHost) return record.siteHost;
  return record.connectorId
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

const mailOpsWorkQueueReviewStorageKey = "modycrew-mailops-work-queue-review-v1";
const mailOpsWorkQueueReviewContextContract = "local_review_to_approval_candidate_context";
const mailOpsWorkQueueProofChainContract =
  "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log";

type MailOpsWorkQueueDecision = "approve" | "revise" | "hold" | "exclude";
type MailOpsWorkQueueFinalConfirmationRoute = "included" | "held" | "excluded";

type MailOpsWorkQueueReviewRecord = {
  itemId: string;
  title: string;
  category: string;
  intakeSessionId?: string;
  approvalPreviewId?: string;
  approvalWorkItemId?: string;
  sourceTraceLabel?: string;
  sourceTraceContract?: "mail_intake_session_to_preview_to_work_queue_to_final_confirmation";
  decision: MailOpsWorkQueueDecision;
  note: string;
  revisedDraft?: string;
  previewId?: string;
  decisionReasonSummary?: string;
  sendCheckSummary?: string;
  finalConfirmationRoute?: MailOpsWorkQueueFinalConfirmationRoute;
  draftBodySource?: "user_revised_draft" | "review_note" | "approval_preview" | "classification";
  updatedAt: string;
  approvalContext: typeof mailOpsWorkQueueReviewContextContract;
  externalMutation: false;
};

type MailOpsWorkQueueReviewSummary = {
  total: number;
  approve: number;
  revise: number;
  hold: number;
  exclude: number;
  latestUpdatedAt: string;
};

type MailOpsWorkQueueEventState = "done" | "active" | "approval" | "locked";

type MailOpsWorkQueueEventTimelineItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: MailOpsWorkQueueEventState;
};

type MailOpsWorkBenchRow = {
  id: string;
  title: string;
  sourceKind: "provider_read" | "mobile_share" | "user_composed" | "role_command";
  sourceRecord: MailOpsWorkQueueReviewRecord;
  sourceTraceLabel: string;
  sourceTraceContract: string;
  approvalPreviewId: string;
  approvalWorkItemId: string;
  categoryLabel: string;
  scenarioLabel: string;
  decision: MailOpsWorkQueueDecision;
  decisionLabel: string;
  oneLineDecisionLabel: string;
  priorityLabel: string;
  routeLabel: string;
  reason: string;
  compactSummary: string;
  detailSummary: string;
  classificationReasonLabel: string;
  approvalOutcomeLabel: string;
  actionCandidateLabel: string;
  reviewChecklistLabels: string[];
  draftPreview: string;
  sendCheckSummary: string;
  sendBoundaryLabel: string;
  nextActionLabel: string;
  updatedLabel: string;
  finalActionWorkItemId: string;
  finalActionReady: boolean;
  state: "included" | "held" | "excluded";
};

type UserComposedMailDraftFields = {
  to: string;
  subject: string;
  body: string;
  attachments: string;
};

function mailOpsWorkQueueDecisionLabel(decision: MailOpsWorkQueueDecision): string {
  if (decision === "approve") return "승인 대기";
  if (decision === "revise") return "수정 요청";
  if (decision === "hold") return "확인 필요";
  return "답장 안 보냄";
}

function mailOpsWorkQueueDecisionActionLabel(decision: MailOpsWorkQueueDecision): string {
  if (decision === "approve") return "답장 보냄";
  if (decision === "revise") return "수정 요청";
  if (decision === "hold") return "확인 필요";
  return "답장 안 보냄";
}

function readMailOpsWorkQueueReviewRecords(): MailOpsWorkQueueReviewRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(mailOpsWorkQueueReviewStorageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((record): record is MailOpsWorkQueueReviewRecord =>
        Boolean(
          record &&
            typeof record.itemId === "string" &&
            typeof record.title === "string" &&
            typeof record.decision === "string" &&
            record.approvalContext === mailOpsWorkQueueReviewContextContract &&
            record.externalMutation === false,
        ),
      )
      .slice(0, 40);
  } catch {
    return [];
  }
}

function updateMailOpsWorkQueueReviewRecord(
  itemId: string,
  patch: Partial<Pick<MailOpsWorkQueueReviewRecord, "decision" | "note" | "revisedDraft" | "sendCheckSummary" | "decisionReasonSummary" | "finalConfirmationRoute" | "draftBodySource" | "updatedAt">>,
): MailOpsWorkQueueReviewRecord[] {
  if (typeof window === "undefined") return [];
  const records = readMailOpsWorkQueueReviewRecords();
  const updatedRecords: MailOpsWorkQueueReviewRecord[] = records.map((record) =>
    record.itemId === itemId
      ? {
          ...record,
          ...patch,
          updatedAt: patch.updatedAt ?? new Date().toISOString(),
          approvalContext: mailOpsWorkQueueReviewContextContract,
          externalMutation: false,
        } satisfies MailOpsWorkQueueReviewRecord
      : record,
  );
  window.localStorage.setItem(mailOpsWorkQueueReviewStorageKey, JSON.stringify(updatedRecords));
  return updatedRecords;
}

function upsertMailOpsWorkQueueReviewRecord(
  record: MailOpsWorkQueueReviewRecord,
  patch: Partial<Pick<MailOpsWorkQueueReviewRecord, "decision" | "note" | "revisedDraft" | "sendCheckSummary" | "decisionReasonSummary" | "finalConfirmationRoute" | "draftBodySource" | "updatedAt">>,
): MailOpsWorkQueueReviewRecord[] {
  if (typeof window === "undefined") return [];
  const records = readMailOpsWorkQueueReviewRecords();
  const exists = records.some((item) => item.itemId === record.itemId);
  const nextRecord: MailOpsWorkQueueReviewRecord = {
    ...record,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
    approvalContext: mailOpsWorkQueueReviewContextContract,
    externalMutation: false,
  };
  const nextRecords = exists
    ? records.map((item) => (item.itemId === record.itemId ? nextRecord : item))
    : [nextRecord, ...records].slice(0, 40);
  window.localStorage.setItem(mailOpsWorkQueueReviewStorageKey, JSON.stringify(nextRecords));
  return nextRecords;
}

function summarizeMailOpsWorkQueueReviewRecords(records: MailOpsWorkQueueReviewRecord[]): MailOpsWorkQueueReviewSummary {
  return records.reduce<MailOpsWorkQueueReviewSummary>(
    (summary, record) => ({
      total: summary.total + 1,
      approve: summary.approve + (record.decision === "approve" ? 1 : 0),
      revise: summary.revise + (record.decision === "revise" ? 1 : 0),
      hold: summary.hold + (record.decision === "hold" ? 1 : 0),
      exclude: summary.exclude + (record.decision === "exclude" ? 1 : 0),
      latestUpdatedAt:
        record.updatedAt && (!summary.latestUpdatedAt || Date.parse(record.updatedAt) > Date.parse(summary.latestUpdatedAt))
          ? record.updatedAt
          : summary.latestUpdatedAt,
    }),
    { total: 0, approve: 0, revise: 0, hold: 0, exclude: 0, latestUpdatedAt: "" },
  );
}

function buildMailOpsWorkQueueEventTimeline(input: {
  reviewSummary: MailOpsWorkQueueReviewSummary;
  candidateCount: number;
}): MailOpsWorkQueueEventTimelineItem[] {
  const reviewedOrCandidateCount = input.reviewSummary.total || input.candidateCount;
  const heldCount = input.reviewSummary.revise + input.reviewSummary.hold;
  return [
    {
      id: "read_classify",
      label: "읽기/분류",
      title: reviewedOrCandidateCount ? `${reviewedOrCandidateCount}건 업무 분류` : "메일 읽기 대기",
      detail: reviewedOrCandidateCount
        ? "답장 필요, 확인 필요, 답장 안 보냄으로 나눔"
        : "메일 연결 또는 사용자의 업무 요청이 필요합니다.",
      state: reviewedOrCandidateCount ? "done" : "locked",
    },
    {
      id: "draft_candidates",
      label: "초안/후보",
      title: input.candidateCount ? `${input.candidateCount}개 실행 후보` : "초안 후보 대기",
      detail: input.candidateCount ? "답장 초안과 일정 후보를 승인함에 올림" : "분류 뒤 초안 후보를 만듭니다.",
      state: input.candidateCount ? "done" : "locked",
    },
    {
      id: "work_queue_review",
      label: "작업함 검토",
      title: input.reviewSummary.total ? "수정/제외 판단 반영" : "검토 기록 대기",
      detail: input.reviewSummary.total
        ? `승인 ${input.reviewSummary.approve}건 · 수정/확인 ${heldCount}건 · 제외 ${input.reviewSummary.exclude}건`
        : "사용자가 작업함에서 결정하면 이 단계가 채워집니다.",
      state: input.reviewSummary.total ? "active" : "locked",
    },
    {
      id: "approval_forward",
      label: "최종 확인",
      title: input.reviewSummary.approve ? `${input.reviewSummary.approve}건만 최종 확인` : "승인 항목 없음",
      detail: input.reviewSummary.approve ? "승인 대기 항목만 마지막 확인 카드로 이동" : "보류/제외 항목은 실행하지 않습니다.",
      state: input.reviewSummary.approve ? "approval" : "locked",
    },
    {
      id: "final_lock",
      label: "발송 잠금",
      title: "외부 실행 잠금 유지",
      detail: "사용자 최종 확인 전 메일 발송, 일정 등록, 파일 변경 없음",
      state: "locked",
    },
  ];
}

function mailOpsWorkQueueReviewForWorkItem(
  item: WorkItem,
  reviewRecords: MailOpsWorkQueueReviewRecord[] = readMailOpsWorkQueueReviewRecords(),
): MailOpsWorkQueueReviewRecord | null {
  const records = reviewRecords;
  if (!records.length || !item.id) return null;
  // 정확히 같은 카드 ID로만 연결합니다(itemId 포함 — 직접 쓴 메일 점검 기록). 제목 '부분 포함' 매칭은
  // 다른 메일의 승인·수정본을 엉뚱한 카드에 붙여 A 거래처 답장이 B 거래처로 나갈 수 있었습니다.
  return findExactMailWorkQueueRecord(records, item.id);
}

function mailOpsFocusedFinalBatchState(record: MailOpsWorkQueueReviewRecord): "included" | "held" | "excluded" {
  if (record.decision === "approve") return "included";
  if (record.decision === "exclude") return "excluded";
  return "held";
}

function mailOpsFocusedFinalBatchRouteLabel(state: "included" | "held" | "excluded"): string {
  if (state === "included") return "최종 확인 포함";
  if (state === "excluded") return "발송 제외";
  return "검토 유지";
}

function mailOpsFocusedFinalBatchFallbackNote(state: "included" | "held" | "excluded"): string {
  if (state === "included") return "수신자, 제목, 본문, 첨부를 마지막으로 확인합니다.";
  if (state === "excluded") return "이 최종 확인 묶음에서 제외되어 발송되지 않습니다.";
  return "수정 또는 추가 확인 뒤 다시 승인할 수 있습니다.";
}

function mailOpsWorkBenchCategoryLabel(category: string): string {
  if (/role_command/u.test(category)) return "역할 후보";
  if (/mobile/u.test(category)) return "휴대폰 메일";
  if (/no_reply|exclude|광고|newsletter/u.test(category)) return "답장 불필요";
  if (/calendar|schedule|일정/u.test(category)) return "일정 후보";
  if (/follow|후속|리마인드|재확인/u.test(category)) return "후속 확인";
  if (/review|hold|confirm|확인/u.test(category)) return "확인 필요";
  return "답장 후보";
}

function isMobileShareWorkQueueItem(item: WorkItem): boolean {
  const text = [
    item.source,
    item.sourceLabel,
    item.senderLabel,
    item.title,
    item.summary,
    item.sourceEvidence?.providerId,
    item.sourceEvidence?.connectorId,
    item.sourceEvidence?.mailboxLabel,
    item.sourceEvidence?.detectedIntentLabels?.join(" "),
    item.sourceEvidence?.approvalCandidateLabels?.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  return item.source === "mobile_share" || /mobile_share|휴대폰 선택 메일|휴대폰 메일/iu.test(text);
}

function createMobileShareWorkQueueReviewRecord(item: WorkItem): MailOpsWorkQueueReviewRecord {
  const evidence = item.sourceEvidence;
  const text = [
    item.title,
    item.summary,
    item.body,
    evidence?.messageSubject,
    evidence?.messageSnippet,
    evidence?.draftPreview,
    evidence?.calendarCandidateText,
    ...(evidence?.detectedIntentLabels ?? []),
    ...(evidence?.approvalCandidateLabels ?? []),
  ].filter(Boolean).join(" ");
  const hasRisk = item.riskLabel === "high" || item.riskLabel === "blocked" || /환불|클레임|불만|계약|세금|공공|책임|보상|긴급|urgent|risk|contract|refund/iu.test(text);
  const isCalendar = item.finalAction?.kind === "create_calendar_event" || /일정|예약|미팅|상담|시간|방문|calendar|schedule/iu.test(text);
  const decision: MailOpsWorkQueueDecision = hasRisk ? "hold" : "approve";
  const category = isCalendar ? "mobile_calendar" : hasRisk ? "mobile_review" : "mobile_reply";
  const reviewLabel = hasRisk ? "휴대폰 공유 메일 위험/조건 확인 필요" : isCalendar ? "휴대폰 공유 메일 일정 후보 승인 대기" : "휴대폰 공유 메일 답장 후보 승인 대기";
  return {
    itemId: `mobile-work-row-${item.id}`,
    title: evidence?.messageSubject || item.title,
    category,
    approvalPreviewId: item.id,
    approvalWorkItemId: item.id,
    sourceTraceLabel: `mobile_share -> ${item.id} -> workbench`,
    sourceTraceContract: "mail_intake_session_to_preview_to_work_queue_to_final_confirmation",
    decision,
    note: reviewLabel,
    revisedDraft: evidence?.draftPreview || evidence?.calendarCandidateText || item.draft?.body || item.body || item.summary,
    previewId: item.id,
    decisionReasonSummary: evidence?.mailWorkReview?.sendDecisionReason || reviewLabel,
    sendCheckSummary: evidence?.mailWorkReview?.finalApprovalBoundary || "휴대폰에서 가져온 메일은 앱 최종 확인 전까지 발송/일정 등록하지 않습니다.",
    finalConfirmationRoute: decision === "approve" ? "included" : "held",
    draftBodySource: "approval_preview",
    updatedAt: item.receivedAt || new Date().toISOString(),
    approvalContext: mailOpsWorkQueueReviewContextContract,
    externalMutation: false,
  };
}

function isRoleCommandMailReviewItem(item: WorkItem): boolean {
  const evidence = item.sourceEvidence;
  const text = [
    item.source,
    item.sourceLabel,
    item.title,
    item.summary,
    item.finalAction?.label,
    evidence?.providerId,
    evidence?.connectorId,
    evidence?.mailboxLabel,
    evidence?.messageSubject,
    evidence?.detectedIntentLabels?.join(" "),
    evidence?.approvalCandidateLabels?.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    item.finalAction?.kind === "send_email" &&
    evidence?.detectedIntentLabels?.includes(ROLE_COMMAND_APPROVAL_HANDOFF_PROOF) === true &&
    /role_quick_command|mail_or_inquiry|메일|문의|답장/iu.test(text)
  );
}

function createRoleCommandMailWorkQueueReviewRecord(item: WorkItem): MailOpsWorkQueueReviewRecord {
  const evidence = item.sourceEvidence;
  const draftPreview = evidence?.draftPreview || item.draft?.body || item.body || item.summary;
  return {
    itemId: `role-command-mail-row-${item.id}`,
    title: evidence?.messageSubject || item.title,
    category: "role_command_mail",
    approvalPreviewId: item.id,
    approvalWorkItemId: item.id,
    sourceTraceLabel: `role_quick_command -> ${ROLE_COMMAND_APPROVAL_HANDOFF_PROOF} -> mailops_workbench`,
    sourceTraceContract: "mail_intake_session_to_preview_to_work_queue_to_final_confirmation",
    decision: "hold",
    note: "실제 AI 답변 뒤 메일/문의 후보로 분류됨. 원문, 수신자, 제목, 본문, 첨부 확인 전까지 보류",
    revisedDraft: draftPreview,
    previewId: item.id,
    decisionReasonSummary:
      evidence?.mailWorkReview?.sendDecisionReason ||
      "AI 연결과 역할 답변은 통과했지만 실제 메일 원문과 수신자 확인 전까지 발송하지 않습니다.",
    sendCheckSummary:
      evidence?.mailWorkReview?.finalApprovalBoundary ||
      "수신자, 제목, 본문, 첨부, 일정 영향을 작업함과 마지막 확인에서 재점검",
    finalConfirmationRoute: "held",
    draftBodySource: "approval_preview",
    updatedAt: item.receivedAt || new Date().toISOString(),
    approvalContext: mailOpsWorkQueueReviewContextContract,
    externalMutation: false,
  };
}

function mailOpsWorkBenchNextActionLabel(record: MailOpsWorkQueueReviewRecord): string {
  if (record.decision === "approve") return "마지막 확인 준비";
  if (record.decision === "revise") return "초안 수정 후 다시 승인";
  if (record.decision === "exclude") return "발송 제외 유지";
  return "보류 후 추가 확인";
}

function mailOpsWorkBenchOneLineDecisionLabel(decision: MailOpsWorkQueueDecision): string {
  if (decision === "approve") return "보낼 메일";
  if (decision === "exclude") return "안 보냄";
  return "수정/확인";
}

function mailOpsWorkBenchPriorityLabel(
  record: MailOpsWorkQueueReviewRecord,
  state: MailOpsWorkBenchRow["state"],
): string {
  if (/role_command/u.test(record.category)) return "역할";
  if (/mobile/u.test(record.category)) return "휴대폰";
  if (state === "included") return "우선";
  if (state === "excluded") return "제외";
  return "확인";
}

function mailOpsWorkBenchSendBoundaryLabel(
  state: MailOpsWorkBenchRow["state"],
  finalActionReady: boolean,
): string {
  if (state === "excluded") return "발송 제외";
  if (finalActionReady) return "최종 전 잠금";
  return "발송 잠금";
}

function mailOpsWorkBenchScenarioLabel(input: {
  record: MailOpsWorkQueueReviewRecord;
  state: MailOpsWorkBenchRow["state"];
  sendCheckSummary: string;
}): string {
  const scenarioText = `${input.record.category} ${input.record.title}`;
  const reviewText = `${input.record.note} ${input.record.decisionReasonSummary ?? ""} ${input.sendCheckSummary}`;
  if (/calendar|schedule|일정 후보|예약 후보|미팅 후보/iu.test(scenarioText)) return "일정 후보";
  if (input.state === "excluded") return "답장 안 보냄";
  if (input.state === "held" && /첨부|파일|링크|attachment/iu.test(reviewText)) return "첨부 확인";
  if (input.state === "held") return "수정 필요";
  return "답장 필요";
}

function mailOpsWorkBenchApprovalOutcomeLabel(
  state: MailOpsWorkBenchRow["state"],
  finalActionReady: boolean,
): string {
  if (state === "excluded") return "승인해도 발송 제외";
  if (state === "included" && finalActionReady) return "마지막 확인 가능";
  if (state === "included") return "승인 후보 대기";
  return "수정 후 승인 가능";
}

function mailOpsWorkBenchActionCandidateLabel(
  state: MailOpsWorkBenchRow["state"],
  finalActionReady: boolean,
): string {
  if (state === "excluded") return "발송 제외";
  if (finalActionReady) return "발송 후보";
  if (state === "included") return "답장 승인 후보";
  return "수정 후 답장 후보";
}

function mailOpsWorkBenchReviewChecklistLabels(input: {
  record: MailOpsWorkQueueReviewRecord;
  state: MailOpsWorkBenchRow["state"];
  finalActionReady: boolean;
  sendCheckSummary: string;
}): string[] {
  const labels = [
    input.record.decision === "exclude" ? "발송 제외 확인" : "원문/요청 확인",
    /수신자|참조|recipient|to|cc/iu.test(input.sendCheckSummary) ? "수신자 점검" : "제목/본문 점검",
    /첨부|파일|링크|attachment/iu.test(input.sendCheckSummary) ? "첨부/링크 점검" : "위험 표현 점검",
    input.finalActionReady ? "마지막 확인 준비" : input.state === "held" ? "수정 후 다시 승인" : "외부 발송 잠금",
  ];
  return Array.from(new Set(labels)).slice(0, 4);
}

function buildMailOpsWorkBenchRows(
  records: MailOpsWorkQueueReviewRecord[],
  finalActionCandidates: WorkItem[] = [],
): MailOpsWorkBenchRow[] {
  return records
    .map((record) => {
      const state = mailOpsFocusedFinalBatchState(record);
      const matchedFinalAction = finalActionCandidates.find(
        (item) => mailOpsWorkQueueReviewForWorkItem(item, [record])?.itemId === record.itemId,
      );
      const decisionLabel = mailOpsWorkQueueDecisionLabel(record.decision);
      const nextActionLabel = mailOpsWorkBenchNextActionLabel(record);
      const oneLineDecisionLabel = mailOpsWorkBenchOneLineDecisionLabel(record.decision);
      const reason =
        record.decisionReasonSummary ||
        record.note ||
        mailOpsFocusedFinalBatchFallbackNote(state);
      const sendCheckSummary =
        record.sendCheckSummary ||
        (state === "included"
          ? "수신자, 제목, 본문, 첨부를 마지막 확인에서 재점검"
          : "승인 항목이 아니므로 실제 발송 경로에서 제외");
      const sourceKind: MailOpsWorkBenchRow["sourceKind"] = /mobile/u.test(record.category)
        ? "mobile_share"
        : /role_command/u.test(record.category)
          ? "role_command"
          : /composed/u.test(record.category)
          ? "user_composed"
          : "provider_read";
      const finalActionReady = Boolean(matchedFinalAction && state === "included");
      const priorityLabel = mailOpsWorkBenchPriorityLabel(record, state);
      const sendBoundaryLabel = mailOpsWorkBenchSendBoundaryLabel(state, finalActionReady);
      const classificationReasonLabel = reason.replace(/\s+/gu, " ").trim();
      const intakeMailWorkReview = matchedFinalAction?.sourceEvidence?.mailWorkReview;
      const scenarioLabel =
        intakeMailWorkReview?.workScenarioLabel ||
        mailOpsWorkBenchScenarioLabel({ record, state, sendCheckSummary });
      const approvalOutcomeLabel = mailOpsWorkBenchApprovalOutcomeLabel(state, finalActionReady);
      const actionCandidateLabel =
        intakeMailWorkReview?.actionCandidateLabel ||
        mailOpsWorkBenchActionCandidateLabel(state, finalActionReady);
      const reviewChecklistLabels =
        intakeMailWorkReview?.reviewChecklistLabels?.length
          ? intakeMailWorkReview.reviewChecklistLabels.slice(0, 4)
          : mailOpsWorkBenchReviewChecklistLabels({
              record,
              state,
              finalActionReady,
              sendCheckSummary,
            });
      return {
        id: record.itemId,
        title: record.title,
        sourceKind,
        sourceRecord: record,
        sourceTraceLabel: record.sourceTraceLabel ?? "",
        sourceTraceContract: record.sourceTraceContract ?? "",
        approvalPreviewId: record.approvalPreviewId ?? record.previewId ?? "",
        approvalWorkItemId: record.approvalWorkItemId ?? "",
        categoryLabel: mailOpsWorkBenchCategoryLabel(record.category),
        scenarioLabel,
        decision: record.decision,
        decisionLabel,
        oneLineDecisionLabel,
        priorityLabel,
        routeLabel: mailOpsFocusedFinalBatchRouteLabel(state),
        reason,
        compactSummary: `${nextActionLabel} · ${sendBoundaryLabel}`,
        detailSummary: `${reason} · ${sendCheckSummary}`,
        classificationReasonLabel,
        approvalOutcomeLabel,
        actionCandidateLabel,
        reviewChecklistLabels,
        draftPreview:
          record.revisedDraft ||
          (record.note ? `수정 메모 기준으로 초안 재검토: ${record.note}` : "초안 없음 · 발송하지 않음"),
        sendCheckSummary,
        sendBoundaryLabel,
        nextActionLabel,
        updatedLabel: record.updatedAt ? new Date(record.updatedAt).toLocaleString("ko-KR") : "시간 기록 없음",
        finalActionWorkItemId: matchedFinalAction?.id ?? "",
        finalActionReady,
        state,
      };
    })
    .sort((left, right) => {
      const order = { included: 0, held: 1, excluded: 2 } as const;
      return order[left.state] - order[right.state];
    })
    .slice(0, 10);
}

function createUserComposedMailWorkQueueReviewRecord(item: WorkItem): MailOpsWorkQueueReviewRecord {
  const review = item.sourceEvidence?.userComposedMailReview;
  const reviewItems = review?.reviewItems ?? [];
  const ready = reviewItems.length > 0 && reviewItems.every((reviewItem) => reviewItem.state === "ok");
  const sendReviewLabels = (review?.sendReviewItems ?? [])
    .map((reviewItem) => reviewItem.label || reviewItem.title)
    .filter(Boolean)
    .slice(0, 6)
    .join(", ");
  return {
    itemId: item.id,
    title: item.title,
    category: "composed",
    decision: ready ? "approve" : "hold",
    note: "작성 메일 점검함에서 수신자, 제목, 본문, 첨부, 위험 표현을 확인",
    revisedDraft: item.sourceEvidence?.draftPreview || item.draft?.body || item.body,
    previewId: ready ? item.id : undefined,
    decisionReasonSummary: review?.revisionSuggestion || "작성 메일 점검 결과를 승인 후보로 연결",
    sendCheckSummary: sendReviewLabels
      ? `작성 메일 발송 전 요약: ${sendReviewLabels}`
      : "수신자, 제목, 본문, 첨부, 위험 표현, 일정 영향을 마지막 확인에서 재점검",
    finalConfirmationRoute: ready ? "included" : "held",
    draftBodySource: "user_revised_draft",
    updatedAt: item.receivedAt || new Date().toISOString(),
    approvalContext: mailOpsWorkQueueReviewContextContract,
    externalMutation: false,
  };
}

type OfficeBoardView = "today" | "approval" | "records" | "archive";

const officeBoardViewStorageKey = "modycrew-office-board-view-v1";
const officeBoardViews = ["today", "approval", "records", "archive"] as const;

function normalizeOfficeBoardView(value: unknown): OfficeBoardView {
  return typeof value === "string" && (officeBoardViews as readonly string[]).includes(value)
    ? (value as OfficeBoardView)
    : "today";
}

function readStoredOfficeBoardView(): OfficeBoardView {
  if (typeof window === "undefined") return "today";
  try {
    return normalizeOfficeBoardView(window.localStorage.getItem(officeBoardViewStorageKey));
  } catch {
    return "today";
  }
}

function readOfficeBoardViewFromLocation(): OfficeBoardView | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const explicitView = readExplicitOfficeBoardViewFromLocation();
    if (explicitView) return explicitView;
    const hash = window.location.hash;
    if (
      params.has("focusFinalAction") ||
      params.has("focusFinalActionCard") ||
      hash === "#final-action-candidates" ||
      hash === "#local-file-approval-queue" ||
      hash === "#learned-draft-approval"
    ) {
      return "approval";
    }
  } catch {
    return null;
  }
  return null;
}

function readExplicitOfficeBoardViewFromLocation(): OfficeBoardView | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const explicitView = params.get("officeView") ?? params.get("view");
    if (explicitView && (officeBoardViews as readonly string[]).includes(explicitView)) {
      return explicitView as OfficeBoardView;
    }
  } catch {
    return null;
  }
  return null;
}

function readFocusedFinalActionWorkItemIdFromLocation(): string {
  if (typeof window === "undefined") return "";
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("focusFinalActionCard")?.trim() || params.get("focusFinalAction")?.trim() || "";
  } catch {
    return "";
  }
}

function readInitialOfficeBoardView(): OfficeBoardView {
  return readOfficeBoardViewFromLocation() ?? readStoredOfficeBoardView();
}

function officeBoardViewBaseLabel(view: OfficeBoardView) {
  if (view === "approval") return "승인";
  if (view === "records") return "기록";
  if (view === "archive") return "보관";
  return "오늘";
}

/** 접힌 실행 후보 한 줄 앞머리: 결정 대기 중인 급한 메일이면 '급함 · ', 담당이 있으면 '담당: X · '. */
function moreListTriagePrefix(item: WorkItem): string {
  const view = buildMailCardTriageView(item);
  return [view.badgeLabel, view.assigneeLabel].filter(Boolean).map((part) => `${part} · `).join("");
}

type OfficeChannelDecisionRow = NonNullable<Props["channelDecisions"]>[number];
type ApprovalInboxKind = "final_action" | "learned_draft" | "external" | "artifact" | "channel";
type ApprovalInboxOutcome = "sent" | "approved" | "held" | "change_requested" | "rejected" | "completed";
type ApprovalInboxSegment = "pending" | "processed" | "all";
type ApprovalInboxTone = "primary" | "safe" | "warning" | "danger" | "neutral";
type ApprovalInboxEntry = {
  key: string;
  kind: ApprovalInboxKind;
  title: string;
  crewName: string;
  crewAvatarId?: string;
  sourceLabel: string;
  typeLabel: string;
  risk?: string;
  at?: string;
  outcome?: ApprovalInboxOutcome;
  outcomeAt?: string;
  outcomeNote?: string;
  workItem?: WorkItem;
  artifact?: LocalMemoryDelegationArtifactRecord;
  channel?: OfficeChannelDecisionRow;
};
type ApprovalInboxAction = { key: string; label: string; tone: "primary" | "secondary" | "quiet"; disabled: boolean; run?: () => void };
type ApprovalInboxCheck = { tone: "warning" | "info" | "check"; text: string };
type ApprovalInboxPreviewRow = { label: string; value: string; strong?: boolean };

// 승인함 '자세히'(기존 전문 패널) 열림 상태. 같은 세션에서 다시 열어도 사용자가 고른 대로 유지한다.
const approvalDetailsStorageKey = "modycrew-office-approval-details-v1";

function approvalInboxWorkItemOutcome(item: WorkItem, sent: boolean): ApprovalInboxOutcome | undefined {
  if (sent) return "sent";
  if (item.status === "held") return "held";
  if (item.status === "change_requested") return "change_requested";
  if (item.status === "rejected") return "rejected";
  // 학습 초안을 승인하면 문서로 저장되고(approvedOutput) 카드는 완료가 된다.
  if (item.status === "completed" && item.approvedOutput) return "approved";
  if (item.status === "completed") return "completed";
  return undefined;
}

function approvalInboxArtifactOutcome(decision?: string): ApprovalInboxOutcome | undefined {
  if (decision === "approved" || decision === "change_requested" || decision === "held" || decision === "rejected") return decision;
  return undefined;
}

/** 기존 승인 데이터(실행 전 확인·학습 초안·외부 계정·팀원 결과·휴대폰 결정)를 한 목록으로 모은다. 새 값은 만들지 않는다. */
function buildApprovalInboxEntries(input: {
  finalActionCandidates: WorkItem[];
  learnedDraftApprovalItems: WorkItem[];
  externalApprovalCandidates: WorkItem[];
  /** 이미 처리한 초안(보류·수정 요청·거절, 승인해 문서로 저장한 것). '처리됨' 탭에만 보인다. */
  processedDraftItems: WorkItem[];
  delegationArtifacts: LocalMemoryDelegationArtifactRecord[];
  channelDecisions: OfficeChannelDecisionRow[];
  crewMembers: Array<{ id: string; name: string; avatarId?: CrewCharacterId }>;
  finalExecution: FinalActionExecutionResult | null;
  finalExecutionWorkItemId: string | null;
  focusedWorkItemId: string;
}): ApprovalInboxEntry[] {
  const crewById = new Map(input.crewMembers.map((member) => [member.id, member]));
  const crewByName = new Map(input.crewMembers.map((member) => [member.name, member]));
  const avatarFor = (id?: string, name?: string) =>
    (id ? crewById.get(id)?.avatarId : undefined) ?? (name ? crewByName.get(name)?.avatarId : undefined);
  const entries: ApprovalInboxEntry[] = [];
  const seenWorkItems = new Set<string>();
  const pushWorkItem = (item: WorkItem, kind: ApprovalInboxKind, typeLabel: string) => {
    if (seenWorkItems.has(item.id)) return;
    seenWorkItems.add(item.id);
    const execution = input.finalExecutionWorkItemId === item.id ? input.finalExecution : null;
    const sent = kind === "final_action" && isFinalActionSentForOffice(item, execution);
    const crewName = (item.assigneeName || item.teammateName || "").trim();
    const outcome = approvalInboxWorkItemOutcome(item, sent);
    const savedOutput = outcome === "approved" ? item.approvedOutput : undefined;
    entries.push({
      key: `work:${item.id}`,
      kind,
      title: item.title?.trim() || "제목 없는 요청",
      crewName,
      crewAvatarId: avatarFor(item.assigneeTeammateId || item.teammateId, crewName),
      sourceLabel: officeUserFacingSourceLabel(item.sourceLabel || "업무 카드"),
      typeLabel,
      risk: item.riskLabel,
      at: item.receivedAt,
      outcome,
      outcomeAt: sent ? item.finalAction?.sentAt || execution?.sentAt : savedOutput?.createdAt,
      outcomeNote: savedOutput?.name ? `‘${savedOutput.name}’ 문서로 저장했어요.` : undefined,
      workItem: item,
    });
  };
  input.finalActionCandidates.forEach((item) =>
    pushWorkItem(item, "final_action", item.finalAction?.label?.trim() || finalActionLabel(item.finalAction?.kind)),
  );
  input.learnedDraftApprovalItems.forEach((item) => pushWorkItem(item, "learned_draft", learnedDraftApprovalLabel(item)));
  input.externalApprovalCandidates.forEach((item) => pushWorkItem(item, "external", externalApprovalLabel(item)));
  input.processedDraftItems
    .filter((item) => approvalInboxWorkItemOutcome(item, false))
    .forEach((item) => pushWorkItem(item, "learned_draft", learnedDraftApprovalLabel(item)));
  input.delegationArtifacts
    .filter((artifact) => artifact.artifactKind === "approval")
    .forEach((artifact) => {
      const outcome = approvalInboxArtifactOutcome(artifact.approvalDecision);
      const crewName = (artifact.teammateName || artifact.rows?.[0]?.teammateName || "").trim();
      entries.push({
        key: `artifact:${artifact.id}`,
        kind: "artifact",
        title: artifact.title?.trim() || "AI 팀원 결과",
        crewName,
        crewAvatarId: avatarFor(artifact.sourceTeammateId, crewName),
        sourceLabel: "AI 팀원 결과",
        typeLabel: "결과 승인",
        at: artifact.createdAt,
        outcome,
        outcomeAt: outcome ? artifact.decidedAt : undefined,
        outcomeNote: outcome ? artifact.decisionNote || artifact.nextActionLabel : undefined,
        artifact,
      });
    });
  input.channelDecisions
    .filter((decision) => decision.requiresAppReconfirm && !(decision.workItemId && seenWorkItems.has(decision.workItemId)))
    .forEach((decision) => {
      const crewName = (decision.teammateName || "").trim();
      entries.push({
        key: `channel:${decision.id}`,
        kind: "channel",
        title: decision.title?.trim() || "휴대폰에서 보낸 결정",
        crewName,
        crewAvatarId: avatarFor(undefined, crewName),
        sourceLabel: decision.channel || "메신저",
        typeLabel: `${decision.channel || "메신저"} 결정`,
        channel: decision,
      });
    });
  if (input.focusedWorkItemId) {
    const index = entries.findIndex((entry) => entry.workItem?.id === input.focusedWorkItemId);
    if (index > 0) entries.unshift(...entries.splice(index, 1));
  }
  return entries;
}

function approvalInboxAgo(iso: string | undefined, now: number | null): string {
  if (!iso || now === null) return "";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diff = now - time;
  if (diff < 0) return "";
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  const date = new Date(time);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function approvalInboxClock(iso: string | undefined): string {
  const time = Date.parse(iso ?? "");
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(time));
}

/**
 * 결정 막대의 결과 안내 한 줄. 처리 함수가 결과 문장 뒤에 덧붙이는 업무대장 검토 내역(내부 표기 포함)은
 * '자세히'와 업무 기록에 그대로 남으므로 여기서는 결과 문장만 보여 준다.
 */
function approvalInboxResultLine(message: string): string {
  const index = message.indexOf(" 업무대장 검토 반영:");
  return (index >= 0 ? message.slice(0, index) : message).trim();
}

function approvalInboxRisk(risk?: string): { label: string; tone: ApprovalInboxTone } | null {
  if (risk === "low") return { label: "위험도 낮음", tone: "safe" };
  if (risk === "medium") return { label: "위험도 보통", tone: "warning" };
  if (risk === "high") return { label: "위험도 높음", tone: "danger" };
  if (risk === "blocked") return { label: "실행 차단", tone: "danger" };
  return null;
}

function approvalInboxOutcomeCopy(entry: ApprovalInboxEntry): { label: string; tone: ApprovalInboxTone; result: string } {
  const calendar = entry.workItem?.finalAction?.kind === "create_calendar_event";
  switch (entry.outcome) {
    case "sent":
      return { label: "승인됨", tone: "safe", result: calendar ? "일정을 등록했어요." : "보냈어요." };
    case "approved":
      return { label: "승인됨", tone: "safe", result: entry.outcomeNote || "승인했어요." };
    case "held":
      return { label: "보류됨", tone: "neutral", result: "실행하지 않고 보류했어요." };
    case "change_requested":
      return { label: "수정 요청함", tone: "primary", result: "담당 크루에게 다시 고쳐 달라고 했어요." };
    case "rejected":
      return { label: "거절됨", tone: "danger", result: "실행하지 않았어요." };
    case "completed":
      return { label: "처리됨", tone: "safe", result: "처리를 마쳤어요." };
    default:
      return { label: "승인 대기", tone: "warning", result: "" };
  }
}

function approvalInboxHasFinalConsonant(word: string): boolean | null {
  const code = word.trim().slice(-1).charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  return null;
}

function approvalInboxObjectParticle(word: string): string {
  const final = approvalInboxHasFinalConsonant(word);
  return final === null ? "을(를)" : final ? "을" : "를";
}

function approvalInboxOutcomePhrase(entry: ApprovalInboxEntry): string {
  switch (entry.outcome) {
    case "sent":
      return entry.workItem?.finalAction?.kind === "create_calendar_event" ? "일정을 등록했어요" : "보냈어요";
    case "approved":
      return "승인했어요";
    case "held":
      return "보류했어요";
    case "change_requested":
      return "수정을 요청했어요";
    case "rejected":
      return "거절했어요";
    default:
      return "처리했어요";
  }
}

/** "업무 비서가 승인을 요청했어요" — 받침에 맞춰 이/가를 고른다. 한글이 아니면 조사를 붙이지 않는다. */
function approvalInboxRequestLine(name: string): { name: string; rest: string } {
  const final = approvalInboxHasFinalConsonant(name);
  if (final === null) return { name, rest: " · 승인 요청" };
  return { name, rest: `${final ? "이" : "가"} 승인을 요청했어요` };
}

function ApprovalInboxFace({ avatarId, name }: { avatarId?: string; name: string }) {
  const src = avatarId ? getCrewCharacter(avatarId)?.asset.idle.src : undefined;
  return (
    <span
      className={styles.approvalInboxFace}
      data-face-crop={src ? (src.includes("-portrait-") ? "square" : "tall") : "initial"}
      style={src ? ({ "--approval-face-image": `url("${src}")` } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      {src ? null : name.trim().slice(0, 1) || "?"}
    </span>
  );
}

function ApprovalInboxIcon({ kind }: { kind: "alert" | "check" | "info" | "send" | "clock" | "chevron" | "pause" | "edit" | "x" | "phone" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === "alert" ? <><path d="M10 3.5 2.8 16h14.4L10 3.5Z" /><path d="M10 8.2v3.6M10 14.1h.01" /></> : null}
      {kind === "check" ? <path d="m4.5 10.5 3.5 3.5 7.5-8" /> : null}
      {kind === "info" ? <><circle cx="10" cy="10" r="7" /><path d="M10 9v4.5M10 6.6h.01" /></> : null}
      {kind === "send" ? <path d="M17 3 8.5 11.5M17 3l-5 14-3.5-5.5L3 8l14-5Z" /> : null}
      {kind === "clock" ? <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 1.5" /></> : null}
      {kind === "chevron" ? <path d="m7.5 5 5 5-5 5" /> : null}
      {kind === "pause" ? <path d="M7.5 5v10M12.5 5v10" /> : null}
      {kind === "edit" ? <path d="M4 16h3l8.5-8.5-3-3L4 13v3Z" /> : null}
      {kind === "x" ? <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" /> : null}
      {kind === "phone" ? <><rect x="6" y="2.8" width="8" height="14.4" rx="1.6" /><path d="M9.2 14.4h1.6" /></> : null}
    </svg>
  );
}

type OfficeApprovalInboxProps = Pick<
  Props,
  | "finalActionValues"
  | "finalConfirmationMessage"
  | "mailOpsDecisionMessage"
  | "browserTaskActionMessage"
  | "localFileActionMessage"
  | "folderPlanActionMessage"
  | "preparingFinalActionId"
  | "runningDryRunActionId"
  | "executingFinalActionId"
  | "recordingMailOpsDecisionId"
  | "runningFolderPlanActionId"
  | "runningLocalFileActionId"
  | "runningBrowserTaskActionId"
  | "onPrepareFinalConfirmation"
  | "onRunFinalActionDryRun"
  | "onExecuteFinalAction"
  | "onRecordMailOpsDecision"
  | "onRecordDelegationDecision"
  | "onRunFolderPlanAction"
  | "onRunLocalFileAction"
  | "onRunBrowserTaskAction"
  | "onChangeFinalActionValue"
  | "onRedraftMailReply"
> & {
  entries: ApprovalInboxEntry[];
  focusedKey: string;
  finalConfirmation: FinalConfirmationContract | null;
  finalDryRun: FinalActionDryRunResult | null;
  finalDryRunWorkItemId: string | null;
  finalExecution: FinalActionExecutionResult | null;
  finalExecutionWorkItemId: string | null;
  onOpenDetails: (targetLabel?: string) => void;
  onShowToday: () => void;
};

/** 승인함 두 칸(목록·상세)의 최소 높이. 창이 이보다 낮으면 페이지 스크롤로 나머지를 본다. */
const APPROVAL_INBOX_MIN_PANE_HEIGHT = 360;
/** 두 칸 아래 끝과 첫 화면 아래 끝 사이 여백. */
const APPROVAL_INBOX_PANE_BOTTOM_GAP = 16;

/** 내용이 실제로 넘쳐 굴러가는 가장 가까운 조상. 높이 제한 없이 내용만큼 자라는 overflow 영역은 건너뛴다. */
function approvalInboxScrollParent(node: HTMLElement): HTMLElement | null {
  for (let element = node.parentElement; element; element = element.parentElement) {
    const { overflowY } = window.getComputedStyle(element);
    if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1) return element;
  }
  const page = document.scrollingElement;
  return page instanceof HTMLElement && page.scrollHeight > page.clientHeight + 1 ? page : null;
}

/**
 * 고른 요청의 상세 첫머리를 화면에 보이게 한다.
 * - 목록과 상세가 위아래로 쌓인 좁은 화면: 상세로 내려 준다.
 * - 나란한 넓은 화면: 상세 첫머리가 화면 밖이나 상단 막대 밑에 있을 때만 옮긴다.
 * 스크롤 영역 맨 위에 붙어 있는 막대(오피스 상단 막대) 아래를 보이는 영역으로 본다.
 */
function revealApprovalInboxDetail(detail: HTMLElement | null) {
  const list = detail?.previousElementSibling;
  if (!detail || !(list instanceof HTMLElement)) return;
  const scroller = approvalInboxScrollParent(detail);
  if (!scroller) return;
  const page = scroller === document.scrollingElement;
  const view = page ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
  let visibleTop = view.top;
  if (!page) {
    for (const child of Array.from(scroller.children)) {
      if (window.getComputedStyle(child).position !== "sticky") continue;
      const rect = child.getBoundingClientRect();
      if (rect.top <= view.top + 1 && rect.bottom > visibleTop) visibleTop = rect.bottom;
    }
  }
  const top = detail.getBoundingClientRect().top;
  const stacked = top >= list.getBoundingClientRect().bottom - 1;
  const hidden = top < visibleTop - 1 || top > view.bottom - 96;
  if (stacked || hidden) scroller.scrollBy({ top: top - visibleTop - 8, behavior: "smooth" });
}

/**
 * 승인함: 대기/처리됨/전체 → 목록 → 상세(무엇·왜·보낼 내용·확인할 점) → 고정 결정 막대.
 * 결정 버튼은 기존 승인 카드와 같은 처리 함수를 같은 조건으로 부른다. 외부 발송·등록은
 * 지금처럼 마지막 확인 준비 → 실행 전 검토 → 마지막 확인을 모두 거쳐야만 진행된다.
 */
/**
 * 원문을 읽지 않고 만든 고정 문구 답장 초안. 메일함 점검('메일 답장 초안')과 백그라운드 점검('업무팩 답장 초안')의 규칙 초안이다.
 * AI 초안·다시 쓴 초안·사용자가 고친 초안은 해당하지 않는다.
 */
function isTemplateMailReplyDraft(item: WorkItem): boolean {
  return item.finalAction?.kind === "send_email" && (item.draft?.toneLabel === "메일 답장 초안" || item.draft?.toneLabel === "업무팩 답장 초안");
}

function OfficeApprovalInbox(props: OfficeApprovalInboxProps) {
  return <InboxCleanupProvider>{controls => <OfficeApprovalInboxContent {...props} cleanupToolbar={controls} />}</InboxCleanupProvider>;
}

function OfficeApprovalInboxContent(props: OfficeApprovalInboxProps & { cleanupToolbar: ReactNode }) {
  const cleanup = useInboxCleanup();
  const {
    entries: allEntries,
    focusedKey,
    finalConfirmation,
    finalActionValues = {},
    finalDryRun,
    finalDryRunWorkItemId,
    finalExecution,
    finalExecutionWorkItemId,
    preparingFinalActionId = null,
    runningDryRunActionId = null,
    executingFinalActionId = null,
    recordingMailOpsDecisionId = null,
    runningFolderPlanActionId = null,
    runningLocalFileActionId = null,
    runningBrowserTaskActionId = null,
    onPrepareFinalConfirmation,
    onRunFinalActionDryRun,
    onExecuteFinalAction,
    onRecordMailOpsDecision,
    onRecordDelegationDecision,
    onRunFolderPlanAction,
    onRunLocalFileAction,
    onRunBrowserTaskAction,
    onChangeFinalActionValue,
    onOpenDetails,
    onShowToday,
    onRedraftMailReply,
  } = props;
  // 고정 문구 초안을 원문에 맞춰 다시 쓰는 중인 카드와 결과 안내.
  const [templateRedraft, setTemplateRedraft] = useState<{ id: string; busy: boolean; text: string } | null>(null);
  const entries = allEntries.filter(entry => !entry.workItem || !cleanup?.hidden.has(entry.workItem.id));
  const pendingEntries = entries.filter((entry) => !entry.outcome);
  const processedEntries = entries.filter((entry) => entry.outcome);
  const [segment, setSegment] = useState<ApprovalInboxSegment>("pending");
  const [selectedKey, setSelectedKey] = useState(focusedKey);
  const [actedKey, setActedKey] = useState("");
  // 결정한 요청이 목록에서 빠져도(예: 다른 단계로 넘어간 파일 작업) 결과 안내를 보여 주려고 마지막으로 누른 요청을 기억한다.
  const [actedSnapshot, setActedSnapshot] = useState<ApprovalInboxEntry | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const inboxRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!focusedKey) return;
    setSelectedKey(focusedKey);
    setSegment("all");
  }, [focusedKey]);
  const visibleEntries = segment === "pending" ? pendingEntries : segment === "processed" ? processedEntries : entries;
  const selected = visibleEntries.find((entry) => entry.key === selectedKey) ?? visibleEntries[0] ?? null;
  const actedEntry = actedKey ? entries.find((entry) => entry.key === actedKey) : undefined;
  const hasInboxBody = visibleEntries.length > 0;
  const selectedEntryKey = selected?.key ?? "";
  // 넓은 화면에서는 목록과 상세가 각자 스크롤한다(메일 앱처럼). 두 칸의 높이를 첫 화면 아래 끝에 맞춰,
  // 목록을 내려 아래쪽 요청을 골라도 상세와 결정 막대가 제자리에서 바로 보이게 한다.
  // 값은 --approval-inbox-pane-height 로 넘기고, CSS는 두 칸이 나란할 때만 쓴다.
  useEffect(() => {
    const root = inboxRef.current;
    if (!root || !hasInboxBody) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const body = bodyRef.current;
      if (!body) return;
      // 페이지가 이미 굴러가 있어도 첫 화면 기준 위치로 잰다.
      let scrolled = 0;
      for (let element = body.parentElement; element; element = element.parentElement) scrolled += element.scrollTop;
      const top = body.getBoundingClientRect().top + scrolled;
      const height = Math.max(APPROVAL_INBOX_MIN_PANE_HEIGHT, Math.floor(window.innerHeight - top - APPROVAL_INBOX_PANE_BOTTOM_GAP));
      const current = Number.parseFloat(root.style.getPropertyValue("--approval-inbox-pane-height")) || 0;
      if (Math.abs(current - height) >= 2) root.style.setProperty("--approval-inbox-pane-height", `${height}px`);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(fit);
    };
    schedule();
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(root);
    return () => {
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hasInboxBody]);
  // 대기·처리됨·전체를 바꾸면 목록을 맨 위부터 보여 준다.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [segment]);
  // 고른 요청이 바뀌면 상세는 첫머리부터 보여 주고, 목록 칸에서는 고른 줄이 보이게 목록 칸만 굴린다.
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 });
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !row || list.scrollHeight <= list.clientHeight + 1) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
    else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
  }, [selectedEntryKey]);
  const select = (key: string) => {
    setSelectedKey(key);
    // 고른 요청의 상세 첫머리가 바로 보이게 한다(좁은 화면은 상세로 내려 주고, 넓은 화면은 상세가 화면 밖일 때만 옮긴다).
    window.requestAnimationFrame(() => revealApprovalInboxDetail(detailRef.current));
  };
  const act = (entry: ApprovalInboxEntry, run?: () => void) => {
    if (!run) return;
    setActedKey(entry.key);
    setActedSnapshot(entry);
    run();
  };

  const decisionFor = (entry: ApprovalInboxEntry): { actions: ApprovalInboxAction[]; guide: string; boundary: string } => {
    const item = entry.workItem;
    if (entry.kind === "final_action" && item) {
      const kind = item.finalAction?.kind;
      const confirmation = finalConfirmation?.workItemId === item.id ? finalConfirmation : null;
      const dryRun = finalDryRunWorkItemId === item.id ? finalDryRun : null;
      const dryRunReady = dryRun?.status === "final_action_dry_run_ready" && Boolean(dryRun.dryRun);
      const execution = finalExecutionWorkItemId === item.id ? finalExecution : null;
      const sent = isFinalActionSentForOffice(item, execution);
      const mail = kind === "send_email" || kind === "send_bulk_email";
      const verb = mail ? "발송" : kind === "create_calendar_event" ? "등록" : kind === "share_file" ? "공유" : "실행";
      const verbAction = mail ? "보내기" : verb;
      const verbNot = mail ? "보내지" : `${verb}하지`;
      const recording = recordingMailOpsDecisionId === item.id;
      const canRecord =
        Boolean(onRecordMailOpsDecision) &&
        (mail || kind === "create_calendar_event" || Boolean(item.browserTask) || Boolean(item.localFile));
      const primary: ApprovalInboxAction = sent
        ? { key: "sent", label: kind === "create_calendar_event" ? "등록했어요" : "보냈어요", tone: "primary", disabled: true }
        : !confirmation
          ? {
              key: "approve",
              label: preparingFinalActionId === item.id ? "준비 중…" : "승인",
              tone: "primary",
              disabled: !onPrepareFinalConfirmation || preparingFinalActionId === item.id || recording,
              run: () => onPrepareFinalConfirmation?.(item),
            }
          : !dryRunReady
            ? {
                key: "dry_run",
                label: runningDryRunActionId === item.id ? "검토 중…" : `${verb} 전 검토`,
                tone: "primary",
                disabled: !onRunFinalActionDryRun || runningDryRunActionId === item.id,
                run: () => onRunFinalActionDryRun?.(item),
              }
            : {
                key: "execute",
                label: executingFinalActionId === item.id ? "확인 중…" : `확인하고 ${verbAction}`,
                tone: "primary",
                disabled: !onExecuteFinalAction || executingFinalActionId === item.id,
                run: () => onExecuteFinalAction?.(item),
              };
      const actions: ApprovalInboxAction[] = [primary];
      if (canRecord && !sent) {
        actions.push(
          { key: "change", label: "수정 요청", tone: "secondary", disabled: recording, run: () => onRecordMailOpsDecision?.(item, "change_requested") },
          { key: "hold", label: "보류", tone: "quiet", disabled: recording, run: () => onRecordMailOpsDecision?.(item, "held") },
        );
      }
      const guide = sent
        ? kind === "create_calendar_event" ? "등록한 기록은 업무 기록에 남아 있어요." : "보낸 기록은 업무 기록에 남아 있어요."
        : execution
          ? [executionStatusLabel(execution.status), execution.userMessage].filter(Boolean).join(" · ")
          : !confirmation
            ? `승인해도 바로 ${verbNot} 않아요. ${verb} 전 검토와 마지막 확인을 거쳐요.`
            : !dryRunReady
              ? dryRun
                ? [dryRunStatusLabel(dryRun.status), dryRun.userMessage].filter(Boolean).join(" · ")
                : `내용을 확인한 뒤 ${verb} 전 검토를 눌러 주세요.`
              : `마지막 확인을 누르면 실행 조건을 다시 확인해요. 실행 잠금이 켜져 있으면 실제로 ${verbNot} 않아요.`;
      return { actions, guide, boundary: "final_confirmation_before_external_mutation" };
    }
    if (entry.kind === "learned_draft" && item) {
      if (item.source === "local_file" && isFolderPlanApprovalItem(item)) {
        return {
          actions: [
            {
              key: "apply",
              label: runningFolderPlanActionId === `${item.id}:apply` ? "정리 중…" : "승인하고 정리",
              tone: "primary",
              disabled: !onRunFolderPlanAction || runningFolderPlanActionId === `${item.id}:apply`,
              run: () => onRunFolderPlanAction?.(item, "apply"),
            },
            {
              key: "preview",
              label: runningFolderPlanActionId === `${item.id}:preview` ? "검토 중…" : "미리 검토",
              tone: "secondary",
              disabled: !onRunFolderPlanAction || runningFolderPlanActionId === `${item.id}:preview`,
              run: () => onRunFolderPlanAction?.(item, "preview"),
            },
            {
              key: "hold",
              label: "보류",
              tone: "quiet",
              disabled: !onRunLocalFileAction || runningLocalFileActionId === `${item.id}:hold`,
              run: () => onRunLocalFileAction?.(item, "hold"),
            },
          ],
          guide: "미리 검토로 옮길 파일을 먼저 볼 수 있어요. 정리한 뒤 되돌리기는 자세히에서 요청해요.",
          boundary: "local_file_change_after_user_choice",
        };
      }
      if (item.source === "local_file") {
        return {
          actions: [
            {
              key: "draft",
              label: runningLocalFileActionId === `${item.id}:draft` ? "초안 중…" : "초안 만들기",
              tone: "primary",
              disabled: !onRunLocalFileAction || runningLocalFileActionId === `${item.id}:draft`,
              run: () => onRunLocalFileAction?.(item, "draft"),
            },
            {
              key: "analyze",
              label: runningLocalFileActionId === `${item.id}:analyze` ? "분석 중…" : "분석하기",
              tone: "secondary",
              disabled: !onRunLocalFileAction || runningLocalFileActionId === `${item.id}:analyze`,
              run: () => onRunLocalFileAction?.(item, "analyze"),
            },
            {
              key: "hold",
              label: "보류",
              tone: "quiet",
              disabled: !onRunLocalFileAction || runningLocalFileActionId === `${item.id}:hold`,
              run: () => onRunLocalFileAction?.(item, "hold"),
            },
          ],
          guide: "고른 작업만 진행돼요. 메일 발송·일정 등록·외부 저장은 열리지 않아요.",
          boundary: "local_file_read_only_until_approval",
        };
      }
      const recording = recordingMailOpsDecisionId === item.id;
      return {
        actions: [
          { key: "approve", label: recording ? "저장 중…" : "승인", tone: "primary", disabled: !onRecordMailOpsDecision || recording, run: () => onRecordMailOpsDecision?.(item, "approved") },
          { key: "change", label: "수정 요청", tone: "secondary", disabled: !onRecordMailOpsDecision || recording, run: () => onRecordMailOpsDecision?.(item, "change_requested") },
          { key: "hold", label: "보류", tone: "quiet", disabled: !onRecordMailOpsDecision || recording, run: () => onRecordMailOpsDecision?.(item, "held") },
        ],
        guide: "승인하면 문서로 저장하거나 다음 확인 단계로 넘겨요. 메일 발송·일정 등록은 마지막 확인을 한 번 더 거쳐요.",
        boundary: "final_confirmation_before_external_mutation",
      };
    }
    if (entry.kind === "external" && item) {
      const recording = recordingMailOpsDecisionId === item.id;
      const actions: ApprovalInboxAction[] = onRecordMailOpsDecision
        ? [
            {
              key: "approve",
              label: preparingFinalActionId === item.id ? "준비 중…" : "승인",
              tone: "primary",
              disabled: !onPrepareFinalConfirmation || preparingFinalActionId === item.id || recording,
              run: () => onPrepareFinalConfirmation?.(item),
            },
            { key: "change", label: "수정 요청", tone: "secondary", disabled: recording, run: () => onRecordMailOpsDecision?.(item, "change_requested") },
            { key: "hold", label: "보류", tone: "quiet", disabled: recording, run: () => onRecordMailOpsDecision?.(item, "held") },
          ]
        : [];
      return {
        actions,
        guide: "승인해도 클릭·입력은 바로 하지 않아요. 화면 확인과 마지막 확인을 거쳐요.",
        boundary: "final_confirmation_before_external_mutation",
      };
    }
    if (entry.kind === "artifact" && entry.artifact) {
      const artifact = entry.artifact;
      return {
        actions: onRecordDelegationDecision
          ? [
              { key: "approve", label: "승인", tone: "primary", disabled: false, run: () => onRecordDelegationDecision(artifact, "approved") },
              { key: "change", label: "수정 요청", tone: "secondary", disabled: false, run: () => onRecordDelegationDecision(artifact, "change_requested") },
              { key: "hold", label: "보류", tone: "quiet", disabled: false, run: () => onRecordDelegationDecision(artifact, "held") },
            ]
          : [],
        guide: "승인하면 실행 후보로 넘어가요. 실제 발송·등록 전에는 마지막 확인을 다시 받아요.",
        boundary: "final_confirmation_before_external_mutation",
      };
    }
    return {
      actions: [{ key: "details", label: "자세히에서 확인", tone: "primary", disabled: false, run: () => onOpenDetails("메신저 결정 인박스") }],
      guide: entry.channel?.appReconfirmLabel || "앱에서 마지막 확인이 필요해요.",
      boundary: "final_confirmation_before_external_mutation",
    };
  };

  const messageFor = (entry: ApprovalInboxEntry) => {
    const message =
      entry.kind === "learned_draft"
        ? props.localFileActionMessage || props.folderPlanActionMessage || props.mailOpsDecisionMessage
        : entry.kind === "external"
          ? props.browserTaskActionMessage || props.finalConfirmationMessage || props.mailOpsDecisionMessage
          : entry.kind === "final_action"
            ? props.finalConfirmationMessage || props.mailOpsDecisionMessage
            : "";
    return approvalInboxResultLine(message || "");
  };
  const actedGoneMessage =
    actedKey && !actedEntry && actedSnapshot?.key === actedKey ? messageFor(actedSnapshot) : "";

  const detailFor = (entry: ApprovalInboxEntry) => {
    const item = entry.workItem;
    const chips: Array<{ tone: ApprovalInboxTone; label: string; icon?: "alert" | "send" | "clock" | "phone" }> = [];
    const risk = approvalInboxRisk(entry.risk);
    if (risk) chips.push({ ...risk, icon: "alert" });
    chips.push({ tone: "neutral", label: entry.typeLabel, icon: entry.kind === "final_action" ? "send" : undefined });
    const checks: ApprovalInboxCheck[] = [];
    const rows: ApprovalInboxPreviewRow[] = [];
    let what = "";
    let why = "";
    let body = "";
    if (item) {
      const evidence = item.sourceEvidence;
      const kind = item.finalAction?.kind;
      if (kind === "send_email" || kind === "send_bulk_email") chips.push({ tone: "neutral", label: "보낸 뒤 되돌릴 수 없음", icon: "clock" });
      if (item.channelDecision?.decisionLabel) chips.push({ tone: "neutral", label: `휴대폰에서 ${item.channelDecision.decisionLabel}`, icon: "phone" });
      const recipient = evidence?.replyToLabel || evidence?.replyToAddressMasked || item.senderLabel || "";
      const subject = evidence?.messageSubject || evidence?.originalSubject || "";
      if (kind === "send_email") {
        what = recipient
          ? subject ? `${recipient}에게 ‘${subject}’ 답장을 보내요.` : `${recipient}에게 메일을 보내요.`
          : "메일을 보내요.";
      } else if (kind === "send_bulk_email") {
        const count = evidence?.recipientListReview?.validRecipientCount;
        what = count ? `받는 사람 ${count}명에게 같은 메일을 보내요.` : "여러 받는 사람에게 같은 메일을 보내요.";
      } else if (kind === "create_calendar_event") {
        const schedule = item.schedules?.[0];
        what = schedule?.label ? `캘린더에 ‘${schedule.label}’ 일정을 등록해요.` : "캘린더에 일정을 등록해요.";
      } else if (kind === "share_file") {
        what = item.localFile?.name ? `‘${item.localFile.name}’ 파일을 공유해요.` : "파일을 공유해요.";
      } else if (kind === "connect_mailbox") {
        what = "웹메일 계정을 연결해요.";
      } else if (kind === "scenario_review") {
        what = "운영 점검 결과를 확인해요.";
      } else if (entry.kind === "external") {
        what = item.browserTask?.host ? `${item.browserTask.host} 화면에서 작업해요.` : "외부 화면에서 작업해요.";
      } else {
        what = `${entry.typeLabel}${approvalInboxObjectParticle(entry.typeLabel)} 확인해요.`;
      }
      const summary = item.summary?.trim();
      if (summary && entry.kind !== "final_action") what = `${what} ${summary}`;
      why =
        evidence?.mailWorkReview?.sendDecisionReason ||
        item.priorityReason ||
        item.assigneeReason ||
        evidence?.mailWorkReview?.originalSummary ||
        (entry.kind === "final_action" ? summary || "" : "");
      if (kind === "send_email" || kind === "send_bulk_email") {
        if (recipient) rows.push({ label: "받는 사람", value: recipient });
        if (subject) rows.push({ label: "원래 메일", value: subject, strong: true });
        body = item.draft?.body || evidence?.draftPreview || "";
        if (isTemplateMailReplyDraft(item)) checks.push({ tone: "info", text: "기본 문구로 만든 초안이에요. '원문 보고 다시 쓰기'를 누르면 원래 메일을 읽고 정해 둔 말투·서명으로 다시 써요. 서명(명함)과 말투는 메일 → 필터·메일 도구 → 답장 서명·말투에서 계정별로 정해요." });
      } else if (kind === "create_calendar_event") {
        const schedule = item.schedules?.[0];
        if (schedule?.label) rows.push({ label: "일정", value: schedule.label, strong: true });
        const range = evidence?.calendarTimeRangeLabel || (schedule ? [approvalInboxClock(schedule.startsAt), approvalInboxClock(schedule.endsAt)].filter(Boolean).join(" ~ ") : "");
        if (range) rows.push({ label: "시간", value: range });
        if (evidence?.calendarLocationLabel) rows.push({ label: "장소", value: evidence.calendarLocationLabel });
        if (evidence?.calendarAttendeeLabels?.length) rows.push({ label: "참석", value: evidence.calendarAttendeeLabels.join(", ") });
        if (evidence?.calendarConflictLabel) checks.push({ tone: "warning", text: evidence.calendarConflictLabel });
      } else if (entry.kind === "external") {
        const plan = item.browserTask?.dryRunPlan;
        if (item.browserTask?.host) rows.push({ label: "사이트", value: item.browserTask.host });
        if (plan?.intendedInput) rows.push({ label: "입력할 내용", value: plan.intendedInput });
        if (plan?.clickTarget) rows.push({ label: "누를 곳", value: plan.clickTarget, strong: true });
        if (plan?.expectedResult) body = plan.expectedResult;
        if (plan?.rollbackGuide) checks.push({ tone: "info", text: plan.rollbackGuide });
      } else {
        if (item.localFile?.name) rows.push({ label: "파일", value: item.localFile.name, strong: true });
        if (item.localFile?.folder) rows.push({ label: "위치", value: item.localFile.folder });
        body = item.draft?.body || evidence?.draftPreview || item.localFile?.preview || "";
      }
      item.riskSignals
        .filter((signal) => signal.reason?.trim())
        .slice(0, 2)
        .forEach((signal) => checks.push({ tone: "warning", text: signal.label ? `${signal.label}: ${signal.reason}` : signal.reason }));
      if (evidence?.mailWorkReview?.editFocusLabel) checks.push({ tone: "info", text: `고칠 만한 곳: ${evidence.mailWorkReview.editFocusLabel}` });
      (item.finalAction?.checklist ?? []).slice(0, 4).forEach((check) => checks.push({ tone: "check", text: check }));
    } else if (entry.artifact) {
      const artifact = entry.artifact;
      what = artifact.nextActionLabel || "AI 팀원이 만든 결과를 승인할지 정해요.";
      why = artifact.requestText ? `요청: ‘${artifact.requestText}’` : "";
      (artifact.rows ?? [])
        .filter((row) => row.summary?.trim())
        .slice(0, 4)
        .forEach((row) => rows.push({ label: row.teammateName || row.channelName || "크루", value: row.summary ?? "" }));
    } else if (entry.channel) {
      const decision = entry.channel;
      what = `${decision.channel || "메신저"}에서 ‘${decision.decisionLabel || decisionLabel(decision.decision)}’ 결정을 보냈어요.`;
      why = decision.messagePreview ? `받은 답장: ‘${decision.messagePreview}’` : "";
      if (decision.finalExecutionBoundary) checks.push({ tone: "info", text: decision.finalExecutionBoundary });
    }
    // 수정 요청·보류 버튼이 있는 대기 요청에만 붙인다(처리된 요청과 파일 작업에는 맞지 않는 말).
    if (!entry.outcome && entry.kind !== "channel" && !(entry.kind === "learned_draft" && item?.source === "local_file")) {
      checks.push({ tone: "info", text: "수정 요청과 보류는 밖으로 보내지 않고 업무 기록에만 남겨요." });
    }
    return { chips, what: what || entry.title, why, rows, body, checks };
  };

  const segments: Array<{ id: ApprovalInboxSegment; label: string; count?: number }> = [
    { id: "pending", label: "대기", count: pendingEntries.length },
    { id: "processed", label: "처리됨" },
    { id: "all", label: "전체" },
  ];

  const renderForm = (entry: ApprovalInboxEntry) => {
    const item = entry.workItem;
    if (entry.kind !== "final_action" || !item || finalConfirmation?.workItemId !== item.id) return null;
    const confirmation = finalConfirmation;
    const execution = finalExecutionWorkItemId === item.id ? finalExecution : null;
    const sent = isFinalActionSentForOffice(item, execution);
    const kind = item.finalAction?.kind;
    const heading = kind === "send_email" || kind === "send_bulk_email" ? "보낼 내용" : kind === "create_calendar_event" ? "등록할 내용" : "실행할 내용";
    return (
      <section className={styles.approvalInboxForm} aria-label={`${heading} 마지막 확인`}>
        <header>
          <h3>{heading}</h3>
          <span className={styles.approvalInboxChip} data-tone={confirmation.adapterConnected ? "safe" : "warning"}>
            <i aria-hidden="true" />
            {confirmation.adapterConnected ? "연결됨" : confirmation.adapter?.connectLabel || "연결 필요"}
          </span>
        </header>
        {confirmation.requiredFields.length ? (
          <div className={styles.approvalInboxFields}>
            {confirmation.requiredFields.map((field) => {
              if (field.id === "attachment_selection") {
                const selectedKeys = (finalActionValues[field.id] || "").split(",").filter(Boolean);
                return (
                  <fieldset key={field.id} className={styles.approvalInboxFieldWide}>
                    <legend>{field.label}{field.required ? " *" : ""}</legend>
                    {(confirmation.attachmentCandidates || []).map((file) => (
                      <label key={file.id} className={styles.approvalInboxCheckbox}>
                        <input
                          type="checkbox"
                          checked={selectedKeys.includes(file.key)}
                          disabled={sent}
                          onChange={(event) =>
                            onChangeFinalActionValue?.(
                              field.id,
                              event.target.checked ? [...selectedKeys, file.key].join(",") : selectedKeys.filter((key) => key !== file.key).join(","),
                            )
                          }
                        />
                        <span>{file.filename} · {Math.ceil(file.bytes / 1024)} KB</span>
                      </label>
                    ))}
                    {!confirmation.attachmentCandidates?.length ? <small>이 답장에 연결된 결과물이 없어요.</small> : null}
                  </fieldset>
                );
              }
              const value = finalActionValues[field.id] ?? confirmation.defaultValues?.[field.id] ?? "";
              return (
                <label key={field.id} className={field.multiline ? styles.approvalInboxFieldWide : undefined}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  {field.multiline ? (
                    <textarea rows={6} value={value} placeholder={field.placeholder} disabled={sent} onChange={(event) => onChangeFinalActionValue?.(field.id, event.target.value)} />
                  ) : (
                    <input value={value} placeholder={field.placeholder} disabled={sent} onChange={(event) => onChangeFinalActionValue?.(field.id, event.target.value)} />
                  )}
                </label>
              );
            })}
          </div>
        ) : null}
        {confirmation.sendScopeRecovery ? (
          <p className={styles.approvalInboxNote} role="status">
            {confirmation.sendScopeRecovery.userMessage}{" "}
            <a href={confirmation.sendScopeRecovery.connectHref}>{confirmation.sendScopeRecovery.actionLabel}</a>
          </p>
        ) : null}
        {confirmation.blockedReason ? <p className={styles.approvalInboxNote}>{confirmation.blockedReason}</p> : null}
      </section>
    );
  };

                                                                                     
  // 설치 앱이 카드의 계정·메일 id 로 원래 메일을 읽고(이전 대화 → 저장된 미리보기) 계정의 말투·서명으로 쓴다. 보내지 않는다.
  const runTemplateRedraft = async (item: WorkItem) => {
    if (!onRedraftMailReply || templateRedraft?.busy) return;
    setTemplateRedraft({ id: item.id, busy: true, text: "AI가 원문을 읽고 정해 둔 말투와 서명으로 다시 쓰고 있어요. 보내지는 않아요." });
    const outcome = await onRedraftMailReply(item, "", { fromSource: true }).catch(() => ({ ok: false, message: "다시 쓰지 못했어요. 잠시 뒤 다시 눌러 주세요." }));
    setTemplateRedraft({ id: item.id, busy: false, text: outcome.message || (outcome.ok ? "원문에 맞춰 다시 썼어요." : "다시 쓰지 못했어요.") });
  };
                                                                                                   
  const withDismissAction = (entry: ApprovalInboxEntry, decision: { actions: ApprovalInboxAction[]; guide: string; boundary: string }) => {
    const item = entry.workItem;
    if (!item || decision.actions.some(action => action.key === "sent")) return decision;
    const extra: ApprovalInboxAction[] = [];
    if (onRedraftMailReply && isTemplateMailReplyDraft(item)) {
      const busy = templateRedraft?.busy === true;
      extra.push({ key: "template_redraft", label: busy && templateRedraft?.id === item.id ? "다시 쓰는 중…" : "원문 보고 다시 쓰기", tone: "secondary", disabled: busy, run: () => void runTemplateRedraft(item) });
    }
    if (cleanup?.supported) extra.push({ key: "dismiss", label: "치우기", tone: "quiet", disabled: cleanup.busy, run: () => cleanup.dismiss(item) });
    return extra.length ? { ...decision, actions: [...decision.actions, ...extra] } : decision;
  };

  const renderDetail = (entry: ApprovalInboxEntry) => {
    const detail = detailFor(entry);
    const ago = approvalInboxAgo(entry.at, now);
    const requester = approvalInboxRequestLine(entry.crewName || entry.sourceLabel);
    const decision = entry.outcome ? null : withDismissAction(entry, decisionFor(entry));
    const outcome = entry.outcome ? approvalInboxOutcomeCopy(entry) : null;
    const message = actedKey === entry.key ? messageFor(entry) : "";
    const dryRun = entry.workItem && finalDryRunWorkItemId === entry.workItem.id ? finalDryRun : null;
    const nextBrowserAction = entry.kind === "external" && entry.workItem ? browserTaskNextActionCapability(entry.workItem) : null;
    const browserRunning = Boolean(nextBrowserAction && entry.workItem && runningBrowserTaskActionId === `${entry.workItem.id}:${nextBrowserAction.capability}`);
    const checks = [
      ...(dryRun?.validationMessages ?? []).map((text) => ({ tone: "warning" as const, text })),
      ...detail.checks,
    ];
    return (
      <article
        ref={detailRef}
        className={styles.approvalInboxDetail}
        aria-label={`${entry.title} 요청 내용`}
        data-approval-inbox-entry-kind={entry.kind}
        data-approval-inbox-entry-state={entry.outcome ?? "pending"}
      >
        <div className={styles.approvalInboxDetailBody}>
          <p className={styles.approvalInboxRequester}>
            <ApprovalInboxFace avatarId={entry.crewAvatarId} name={entry.crewName || entry.sourceLabel} />
            <span>
              <b>{requester.name}</b>
              {requester.rest}
              {ago ? <time dateTime={entry.at}> · {ago}</time> : null}
            </span>
          </p>
          <h2 className={styles.approvalInboxTitle}>{entry.title}</h2>
          <div className={styles.approvalInboxChips}>
            {detail.chips.map((chip) => (
              <span key={chip.label} className={styles.approvalInboxChip} data-tone={chip.tone}>
                {chip.icon ? <ApprovalInboxIcon kind={chip.icon} /> : null}
                {chip.label}
              </span>
            ))}
          </div>
          <div className={styles.approvalInboxFacts} data-columns={detail.why ? "2" : "1"}>
            <section>
              <h3>무엇을 하나요</h3>
              <p>{detail.what}</p>
            </section>
            {detail.why ? (
              <section>
                <h3>왜 필요한가요</h3>
                <p>{detail.why}</p>
              </section>
            ) : null}
          </div>
          {renderForm(entry) ?? (detail.rows.length || detail.body ? (
            <section className={styles.approvalInboxPreview} aria-label="미리 보기">
              {detail.rows.length ? (
                <dl>
                  {detail.rows.map((row) => (
                    <div key={`${row.label}-${row.value}`}>
                      <dt>{row.label}</dt>
                      <dd data-strong={row.strong ? "true" : undefined}>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {detail.body ? <p className={styles.approvalInboxPreviewBody}>{detail.body}</p> : null}
            </section>
          ) : null)}
          {checks.length ? (
            <section className={styles.approvalInboxChecks}>
              <h3>확인할 점</h3>
              <ul>
                {checks.map((check, index) => (
                  <li key={`${index}-${check.text}`} data-tone={check.tone}>
                    <ApprovalInboxIcon kind={check.tone === "warning" ? "alert" : check.tone === "check" ? "check" : "info"} />
                    <span>{check.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {nextBrowserAction && entry.workItem && !entry.outcome ? (
            <p className={styles.approvalInboxStep}>
              <span>다음 화면 확인 단계</span>
              <button
                type="button"
                className={styles.approvalInboxSecondary}
                disabled={!onRunBrowserTaskAction || browserRunning}
                onClick={() => act(entry, () => onRunBrowserTaskAction?.(entry.workItem!, nextBrowserAction.capability))}
              >
                {browserRunning ? "확인 중…" : nextBrowserAction.label}
              </button>
            </p>
          ) : null}
        </div>
        {decision ? (
          <footer
            className={styles.approvalInboxDecision}
            aria-label="선택한 요청 결정"
            data-approval-inbox-decision-boundary={decision.boundary}
            data-approval-inbox-external-mutation="false"
          >
            <div className={styles.approvalInboxDecisionButtons}>
              {decision.actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={action.tone === "primary" ? styles.approvalInboxPrimary : action.tone === "secondary" ? styles.approvalInboxSecondary : styles.approvalInboxQuiet}
                  data-approval-inbox-action={action.key}
                  disabled={action.disabled}
                  onClick={() => act(entry, action.run)}
                >
                  {action.key === "approve" || action.key === "execute" || action.key === "apply" ? <ApprovalInboxIcon kind="check" /> : null}
                  {action.key === "change" ? <ApprovalInboxIcon kind="edit" /> : null}
                  {action.key === "hold" ? <ApprovalInboxIcon kind="pause" /> : null}
                  {action.label}
                </button>
              ))}
            </div>
                <p role="status" aria-live="polite">{(templateRedraft && entry.workItem?.id === templateRedraft.id ? templateRedraft.text : "") || message || decision.guide}</p>
          </footer>
        ) : outcome ? (
          <footer className={styles.approvalInboxOutcome} data-tone={outcome.tone}>
            <ApprovalInboxIcon kind={outcome.tone === "danger" ? "x" : outcome.tone === "neutral" ? "pause" : "check"} />
            <p>
              <strong>{outcome.label}</strong>
              {entry.outcomeAt ? <span> · {approvalInboxClock(entry.outcomeAt)}</span> : null}
              <span> · {outcome.result}</span>
            </p>
          </footer>
        ) : null}
      </article>
    );
  };

  return (
    <section
      className={styles.approvalInbox}
      ref={inboxRef}
      aria-label="승인 요청함"
      data-approval-inbox="segments_list_detail_decision_bar"
      data-approval-inbox-pending-count={pendingEntries.length}
      data-approval-inbox-segment={segment}
    >
      {props.cleanupToolbar}
      <header className={styles.approvalInboxHead}>
        <div className={styles.approvalInboxSegments} role="group" aria-label="승인 요청 거르기">
          {segments.map((item) => (
            <button key={item.id} type="button" aria-pressed={segment === item.id} onClick={() => setSegment(item.id)}>
              {item.label}
              {item.count !== undefined ? (
                <span className={styles.approvalInboxCount} data-attention={item.count > 0 ? "true" : "false"}>{item.count}</span>
              ) : null}
            </button>
          ))}
        </div>
        <small>밖으로 나가는 일은 승인한 뒤에도 마지막 확인을 거쳐요.</small>
      </header>
      {actedEntry?.outcome && segment === "pending" ? (
        <p className={styles.approvalInboxNotice} role="status">
          <ApprovalInboxIcon kind="check" />
          <span>‘{actedEntry.title}’ — {approvalInboxOutcomePhrase(actedEntry)}.</span>
          <button type="button" className={styles.approvalInboxTextButton} onClick={() => { setSegment("processed"); setSelectedKey(actedEntry.key); }}>처리됨에서 보기</button>
        </p>
      ) : actedGoneMessage && actedSnapshot ? (
        <p className={styles.approvalInboxNotice} role="status">
          <ApprovalInboxIcon kind="check" />
          <span>‘{actedSnapshot.title}’ — {actedGoneMessage}</span>
        </p>
      ) : null}
      {visibleEntries.length ? (
        <div className={styles.approvalInboxBody} ref={bodyRef}>
          <ul className={styles.approvalInboxList} ref={listRef} aria-label="승인 요청 목록">
            {visibleEntries.map((entry) => {
              const risk = approvalInboxRisk(entry.risk);
              const outcome = entry.outcome ? approvalInboxOutcomeCopy(entry) : null;
              const confirmationReady = !entry.outcome && entry.kind === "final_action" && finalConfirmation?.workItemId === entry.workItem?.id;
              // 대기 요청은 요청한 뒤 지난 시간, 처리한 요청은 처리 시각이 있을 때만 보여 준다(받은 시각을 처리 시각처럼 보이지 않게).
              const rowTime = entry.outcome ? entry.outcomeAt : entry.at;
              const ago = approvalInboxAgo(rowTime, now);
              return (
                <li key={entry.key}>
                  {entry.workItem ? <InboxCardRowTools item={entry.workItem} /> : null}
                  <button
                    type="button"
                    className={styles.approvalInboxRow}
                    aria-current={entry.key === selected?.key ? "true" : undefined}
                    data-approval-inbox-row={entry.kind}
                    data-outcome={entry.outcome ?? "pending"}
                    onClick={() => select(entry.key)}
                    onContextMenu={event => { if (entry.workItem) cleanup?.menu(event, entry.workItem); }}
                    onKeyDown={event => { if (entry.workItem) cleanup?.menu(event, entry.workItem); }}
                  >
                    <ApprovalInboxFace avatarId={entry.crewAvatarId} name={entry.crewName || entry.sourceLabel} />
                    <span className={styles.approvalInboxRowText}>
                      <span className={styles.approvalInboxRowTop}>
                        <strong>{entry.title}</strong>
                        {ago ? <time dateTime={rowTime}>{ago}</time> : null}
                      </span>
                      <span className={styles.approvalInboxRowMeta}>{entry.crewName || entry.sourceLabel} · {entry.typeLabel}</span>
                      <span className={styles.approvalInboxRowBadges}>
                        {risk && !entry.outcome ? (
                          <span className={styles.approvalInboxChip} data-tone={risk.tone} data-size="small">
                            <ApprovalInboxIcon kind="alert" />
                            {risk.label}
                          </span>
                        ) : null}
                        <span className={styles.approvalInboxStatus} data-tone={outcome ? outcome.tone : confirmationReady ? "primary" : "warning"}>
                          <i aria-hidden="true" />
                          {outcome ? outcome.label : confirmationReady ? "마지막 확인 전" : "승인 대기"}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected ? renderDetail(selected) : null}
        </div>
      ) : (
        <div className={styles.approvalInboxEmpty} data-approval-inbox-empty={segment}>
          <span className={styles.approvalInboxEmptyIcon} aria-hidden="true"><ApprovalInboxIcon kind="check" /></span>
          <strong>{segment === "processed" ? "아직 처리한 요청이 없어요" : "승인할 요청이 없어요"}</strong>
          <p>
            {segment === "processed"
              ? "승인하거나 보류한 요청이 여기에 남아요."
              : "크루가 메일 발송이나 일정 등록처럼 밖으로 나가는 일을 하기 전에 여기서 먼저 확인을 받아요."}
          </p>
          {segment !== "processed" && processedEntries.length ? (
            <button type="button" className={styles.approvalInboxTextButton} onClick={() => setSegment("processed")}>처리한 요청 보기</button>
          ) : segment === "processed" && pendingEntries.length ? (
            <button type="button" className={styles.approvalInboxTextButton} onClick={() => setSegment("pending")}>대기 중인 요청 보기</button>
          ) : (
            <button type="button" className={styles.approvalInboxTextButton} onClick={onShowToday}>오늘 결과 보기</button>
          )}
        </div>
      )}
    </section>
  );
}

export function OfficeBoard({
  desks,
  progressValue,
  activeFeatureCount,
  hiddenDeskCount,
  enabledRuleCount,
  nextActionLabel,
  showVirtualOfficeScene = true,
  crewMembers = [],
  onOpenCrewProfile,
  channelWorkSummaries = [],
  channelQueueItems = [],
  channelQueueFocus = null,
  activeChannelLabels = [],
  messengerConnections = [],
  channelDecisions = [],
  connectorStatuses = [],
  connectionRecoveryHandoff = null,
  growthSuggestions = [],
  skillSources = [],
  identityFiles = [],
  delegationArtifacts = [],
  learnedDraftApprovalItems = [],
  processedLearnedDraftItems = [],
  focusedLearnedDraftWorkItemId = "",
  learnedDraftFocusContext = null,
  approvedOutputItems = [],
  externalApprovalCandidates = [],
  finalActionCandidates = [],
  cardAssigneeTeammates = [],
  changingCardAssigneeId = null,
  cardAssigneeNotice = null,
  onChangeCardAssignee,
  finalConfirmation = null,
  finalActionValues = {},
  finalDryRun = null,
  finalDryRunWorkItemId = null,
  finalExecution = null,
  finalExecutionWorkItemId = null,
  executionLogFocus = null,
  finalConfirmationMessage = "",
  browserTaskActionMessage = "",
  mailOpsDecisionMessage = "",
  localFileActionMessage = "",
  localFilePatternMessage = "",
  folderPlanActionMessage = "",
  mailAutomationNotificationMessage = "",
  mailAutomationNotificationDispatchReceipt = null,
  folderPlanOptionsByItemId = {},
  preparingFinalActionId = null,
  recordingMailOpsDecisionId = null,
  runningLocalFileActionId = null,
  runningFolderPlanActionId = null,
  sendingMailAutomationNotificationId = null,
  applyingMailAutomationNotificationDecisionId = null,
  savingLocalFilePatternId = null,
  runningDryRunActionId = null,
  executingFinalActionId = null,
  runningBrowserTaskActionId = null,
  memoryOpenMessage = "",
  forceOpenDetailFold = false,
  onOpenDelegationArtifact,
  onOpenMemoryFile,
  onOpenApprovedOutput,
  onOpenWorkerCompanion,
  onStageApprovedOutputFinalAction,
  onRecordDelegationDecision,
  onPrepareFinalConfirmation,
  onRecordMailOpsDecision,
  onRedraftMailReply,
  onRecordMailOpsWorkQueueReviewEvent,
  onRunLocalFileAction,
  onRunFolderPlanAction,
  onStageMailAttachmentFolderPlan,
  onSendMailAutomationNotification,
  onApplyMailAutomationNotificationDecision,
  onChangeFolderPlanCollisionPolicy,
  onChangeFolderPlanExcludedKeywords,
  onSaveLocalFilePattern,
  onChangeFinalActionValue,
  onRunFinalActionDryRun,
  onExecuteFinalAction,
  onRunBrowserTaskAction,
  onUnlockNext,
}: Props) {
  const [showAllResults, setShowAllResults] = useState(false);
  const [approvalDetailsOpen, setApprovalDetailsOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(approvalDetailsStorageKey) === "open") setApprovalDetailsOpen(true);
    } catch {
      // sessionStorage can be unavailable in hardened desktop webviews.
    }
  }, []);
  const [mailOpsEditingWorkBenchRowId, setMailOpsEditingWorkBenchRowId] = useState<string | null>(null);
  const [mailOpsSelectedWorkBenchRowIds, setMailOpsSelectedWorkBenchRowIds] = useState<string[]>([]);
  const [mailOpsWorkBenchDrafts, setMailOpsWorkBenchDrafts] = useState<Record<string, string>>({});
  const [mailOpsWorkBenchSaveMessage, setMailOpsWorkBenchSaveMessage] = useState("");
  const [editingUserComposedMailId, setEditingUserComposedMailId] = useState<string | null>(null);
  const [userComposedMailDrafts, setUserComposedMailDrafts] = useState<Record<string, UserComposedMailDraftFields>>({});
  const [userComposedMailOverrides, setUserComposedMailOverrides] = useState<Record<string, WorkItem>>({});
  const [mobileChannelDecisionFilter, setMobileChannelDecisionFilter] = useState<"all" | "ready" | "review" | "locked">("all");
  const [officeBoardView, setOfficeBoardView] = useState<OfficeBoardView>(readInitialOfficeBoardView);
  const [routeFocusedFinalActionWorkItemId, setRouteFocusedFinalActionWorkItemId] = useState<string>(
    readFocusedFinalActionWorkItemIdFromLocation,
  );
  const [routeExplicitOfficeBoardView, setRouteExplicitOfficeBoardView] = useState<OfficeBoardView | null>(
    readExplicitOfficeBoardViewFromLocation,
  );
  const [mailOpsSupportedWorkFocusRoute, setMailOpsSupportedWorkFocusRoute] =
    useState<MailOpsSupportedWorkFocusRoute>("none");
  const selectedOfficeBoardView = normalizeOfficeBoardView(officeBoardView);
  const activeOfficeBoardView =
    forceOpenDetailFold && selectedOfficeBoardView === "today" && routeExplicitOfficeBoardView !== "today"
      ? "approval"
      : selectedOfficeBoardView;
  // 채팅·업무판의 [승인함에서 보기]로 특정 카드를 찾아온 경우에도 상세를 열어 그 카드가 바로 보이게 한다.
  const shouldOpenOfficeDetailFold =
    activeOfficeBoardView === "archive" ||
    (forceOpenDetailFold && routeExplicitOfficeBoardView !== "today") ||
    Boolean(routeFocusedFinalActionWorkItemId);
  const [scrolledToFocusedFinalActionId, setScrolledToFocusedFinalActionId] = useState("");
  const focusedFinalActionLoaded = finalActionCandidates.some((item) => item.id === routeFocusedFinalActionWorkItemId);
  useEffect(() => {
    if (!routeFocusedFinalActionWorkItemId || !focusedFinalActionLoaded) return;
    if (scrolledToFocusedFinalActionId === routeFocusedFinalActionWorkItemId) return;
    const timer = window.setTimeout(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-final-action-work-item-id]")).find(
        (node) => node.dataset.finalActionWorkItemId === routeFocusedFinalActionWorkItemId,
      );
      if (!target) return;
      target.scrollIntoView({ block: "start", behavior: "auto" });
      setScrolledToFocusedFinalActionId(routeFocusedFinalActionWorkItemId);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [focusedFinalActionLoaded, routeFocusedFinalActionWorkItemId, scrolledToFocusedFinalActionId]);
  useEffect(() => {
    try {
      window.localStorage.setItem(officeBoardViewStorageKey, activeOfficeBoardView);
    } catch {
      // localStorage can be unavailable in hardened desktop webviews.
    }
  }, [activeOfficeBoardView]);
  useEffect(() => {
    const syncRouteOfficeView = () => {
      const routeView = readOfficeBoardViewFromLocation();
      if (routeView) setOfficeBoardView(routeView);
      setRouteExplicitOfficeBoardView(readExplicitOfficeBoardViewFromLocation());
      setRouteFocusedFinalActionWorkItemId(readFocusedFinalActionWorkItemIdFromLocation());
    };
    syncRouteOfficeView();
    window.addEventListener("hashchange", syncRouteOfficeView);
    return () => window.removeEventListener("hashchange", syncRouteOfficeView);
  }, []);
  useEffect(() => {
    const updateFocusRoute = () => {
      setMailOpsSupportedWorkFocusRoute(mailOpsSupportedWorkFocusFromHash(window.location.hash));
    };
    updateFocusRoute();
    window.addEventListener("hashchange", updateFocusRoute);
    return () => window.removeEventListener("hashchange", updateFocusRoute);
  }, []);
  const selectOfficeBoardView = (view: OfficeBoardView) => {
    if (view === "today") {
      setOfficeBoardView("today");
    } else {
      setOfficeBoardView(view);
    }
    setRouteExplicitOfficeBoardView(view);
  };
  const changeApprovalDetailsOpen = (open: boolean, targetLabel?: string) => {
    setApprovalDetailsOpen(open);
    try {
      window.sessionStorage.setItem(approvalDetailsStorageKey, open ? "open" : "closed");
    } catch {
      // The choice still applies to this screen.
    }
    if (open && targetLabel) {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(`[aria-label="${targetLabel}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 80);
    }
  };
  const totalDeskCount = desks.length + hiddenDeskCount;
  const visibleWorkCount = desks.reduce((sum, desk) => sum + desk.busy + desk.cards.length, 0);
  const liveCards = desks
    .flatMap((desk) =>
      desk.cards.map((card) => ({
        ...card,
        deskLabel: desk.shortLabel,
      })),
    )
    .slice(0, 5);
  const runningCrewCount = crewMembers.filter((member) => member.running).length;
  const activeCrewCount = crewMembers.filter((member) => member.active).length;
  const channelRunningCount = channelWorkSummaries.reduce((sum, channel) => sum + channel.runningCount, 0);
  const channelApprovalCount = channelWorkSummaries.reduce((sum, channel) => sum + channel.approvalCount, 0);
  const channelResultCount = channelWorkSummaries.reduce((sum, channel) => sum + channel.resultCount, 0);
  const focusedChannelIds = new Set(channelQueueFocus?.targetTeammateIds ?? []);
  const focusedChannelQueueItems = channelQueueItems.filter((item) => focusedChannelIds.has(item.teammateId));
  const orderedChannelQueueItems = focusedChannelIds.size
    ? [
        ...focusedChannelQueueItems,
        ...channelQueueItems.filter((item) => !focusedChannelIds.has(item.teammateId)),
      ]
    : channelQueueItems;
  const visibleChannelQueueItems = orderedChannelQueueItems.slice(0, 10);
  const connectedMessengerCount = messengerConnections.filter(
    (connection) => connection.state === "connected" || connection.state === "built_in",
  ).length;
  const mailAutomationChannelState = mailAutomationNotificationChannelState(messengerConnections);
  const crewChannelIndex = identityFiles.find((file) => file.kind === "crew_channel_index");
  const approvalArtifactCount = delegationArtifacts.filter(
    (artifact) => artifact.artifactKind === "approval" && !artifact.approvalDecision,
  ).length;
  const learnedDraftApprovalCount = learnedDraftApprovalItems.length;
  const focusedLearnedDraftItem = focusedLearnedDraftWorkItemId
    ? learnedDraftApprovalItems.find((item) => item.id === focusedLearnedDraftWorkItemId) ?? null
    : null;
  const externalApprovalCount = externalApprovalCandidates.length;
  const pendingResults = finalActionCandidates.filter(item => item.finalAction?.kind !== 'scenario_review' && ['draft_ready','needs_review','approval_pending'].includes(item.status) && item.finalAction?.readiness !== 'sent' && !item.finalAction?.sentAt);
  const scenarioChecks = finalActionCandidates.filter(item => item.finalAction?.kind === 'scenario_review');
  const finalActionCount = finalActionCandidates.length;
  // 접힌 상세 관제 요약에서도 급한 메일 수가 보이게 한다(열지 않아도 '급함'을 놓치지 않게).
  // 한 메일의 답장·일정·첨부 카드는 한 통으로 센다.
  const urgentFinalActionCount = countUrgentMailDecisions(finalActionCandidates);
  const approvalCandidateVisibleLimit = 1;
  const visibleExternalApprovalCandidates = externalApprovalCandidates.slice(0, approvalCandidateVisibleLimit);
  const hiddenExternalApprovalCandidates = externalApprovalCandidates.slice(approvalCandidateVisibleLimit);
  const orderedFinalActionCandidates = routeFocusedFinalActionWorkItemId
    ? [
        ...finalActionCandidates.filter((item) => item.id === routeFocusedFinalActionWorkItemId),
        ...finalActionCandidates.filter((item) => item.id !== routeFocusedFinalActionWorkItemId),
      ]
    : finalActionCandidates;
  const visibleFinalActionCandidates = orderedFinalActionCandidates.slice(0, approvalCandidateVisibleLimit);
  const hiddenFinalActionCandidates = orderedFinalActionCandidates.slice(approvalCandidateVisibleLimit);
  const hiddenMemorySearchFinalAction = hiddenFinalActionCandidates.find((item) =>
    Boolean(buildMemorySearchFinalActionSourceGuide(item)),
  );
  const hiddenMemorySearchFinalActionGuide = hiddenMemorySearchFinalAction
    ? buildMemorySearchFinalActionSourceGuide(hiddenMemorySearchFinalAction)
    : null;
  const mobileChannelDecisionRowsAll = channelDecisions
    .filter((decision) => decision.requiresAppReconfirm)
    .map((decision) => {
      const finalAction = decision.workItemId
        ? finalActionCandidates.find((item) => item.id === decision.workItemId)
        : null;
      const state =
        decision.decision === "approved" && finalAction
          ? "ready"
          : decision.decision === "change_requested"
            ? "review"
            : "locked";
      return {
        ...decision,
        finalAction,
        state,
        oneLineStatus: `${decision.targetCode ? `${decision.targetCode} · ` : ""}${decision.decisionLabel ?? decisionLabel(decision.decision)} · ${decision.appReconfirmLabel ?? "앱 최종 확인 필요"}`,
        virtualOfficeBridgeLabel: `${decision.targetCode ? `${decision.targetCode} · ` : ""}${decision.workerEventLabel ?? `${decision.channel} 결정 기록`} -> 앱 마지막 확인`,
        virtualOfficeReplyContract: mobileDecisionReplyContract,
        virtualOfficeEventPath: mobileDecisionVirtualOfficeEventPath,
        mobileReceiveSummary:
          decision.mobileReceiveFilterSummary ||
          (decision.mobileReceiveFilterLabels?.length ? decision.mobileReceiveFilterLabels.slice(0, 3).join(" / ") : ""),
      };
    });
  const mobileChannelDecisionRows = mobileChannelDecisionRowsAll
    .filter((row) => mobileChannelDecisionFilter === "all" || row.state === mobileChannelDecisionFilter)
    .slice(0, 5);
  const mobileChannelDecisionReadyCount = mobileChannelDecisionRowsAll.filter((row) => row.state === "ready").length;
  const mobileChannelDecisionReviewCount = mobileChannelDecisionRowsAll.filter((row) => row.state === "review").length;
  const mobileChannelDecisionLockedCount = mobileChannelDecisionRowsAll.filter((row) => row.state === "locked").length;
  const mobileChannelDecisionFilterTabs = [
    { id: "all", label: "전체", count: mobileChannelDecisionRowsAll.length },
    { id: "ready", label: "마지막 확인", count: mobileChannelDecisionReadyCount },
    { id: "review", label: "수정", count: mobileChannelDecisionReviewCount },
    { id: "locked", label: "보류", count: mobileChannelDecisionLockedCount },
  ] as const;
  const approvalWaitCount =
    channelDecisions.length + approvalArtifactCount + learnedDraftApprovalCount + externalApprovalCount + finalActionCount;
  const approvalWorkItems = [
    ...learnedDraftApprovalItems,
    ...externalApprovalCandidates,
    ...finalActionCandidates,
  ];
  const highestApprovalRisk = approvalWorkItems.length ? highestWorkItemRisk(approvalWorkItems) : "low";
  const approvalInboxEntries = buildApprovalInboxEntries({
    finalActionCandidates,
    learnedDraftApprovalItems,
    externalApprovalCandidates,
    processedDraftItems: [...processedLearnedDraftItems, ...approvedOutputItems],
    delegationArtifacts,
    channelDecisions,
    crewMembers,
    finalExecution,
    finalExecutionWorkItemId,
    focusedWorkItemId: routeFocusedFinalActionWorkItemId,
  });
  const rollbackGuideCount = approvalWorkItems.filter((item) =>
    Boolean(
      item.browserTask?.dryRunPlan?.rollbackGuide ||
      item.browserTask?.finalPresenceContract?.limitedExecutionGate?.rollbackGuide,
    ),
  ).length;
  const mutationCandidateCount =
    finalActionCandidates.length +
    externalApprovalCandidates.filter((item) => item.browserTask?.requiresFinalUserPresence || item.browserTask?.stagedAction).length +
    learnedDraftApprovalItems.filter((item) => item.draft?.requiresApprovalBeforeSend).length +
    delegationArtifacts.filter((artifact) => artifact.artifactKind === "approval" || artifactApprovalRequired(artifact)).length;
  const executionLogCount =
    delegationArtifacts.filter((artifact) => artifact.relativePath || artifact.approvalDecision || artifact.nextActionKind).length +
    channelDecisions.filter((decision) => decision.decisionLogPath || decision.workLogPath).length +
    Number(Boolean(finalDryRun?.auditId || finalExecution?.auditId));
  const previewCandidateCount =
    channelDecisions.length + approvalArtifactCount + learnedDraftApprovalCount + externalApprovalCount + finalActionCount;
  const approvalSafetyRailItems = buildApprovalSafetyRail({
    approvalWaitCount,
    previewCount: previewCandidateCount,
    mutationCount: mutationCandidateCount,
    rollbackGuideCount,
    executionLogCount,
    highestRisk: highestApprovalRisk,
  });
  const officeQualityGateItems = buildOfficeQualityGateItems({
    qualityGateFeatures: getQualityGateFeatureLauncherItems(),
    progressiveFeatures: getProgressiveDisclosureFeatureLauncherItems(),
    channelQueueItems,
    approvalWorkItems,
  });
  const officeBoardViewTabs = [
    {
      id: "today",
      label: "오늘",
      detail: "진행과 다음 할 일",
      countLabel: `${visibleWorkCount + channelRunningCount + runningCrewCount}건`,
    },
    {
      id: "approval",
      label: "승인",
      detail: "실행 전 확인",
      countLabel: `${approvalWaitCount}건`,
    },
    {
      id: "records",
      label: "기록",
      detail: "결정과 실행 로그",
      countLabel: `${executionLogCount}건`,
    },
    {
      id: "archive",
      label: "보관",
      detail: "설정과 숨긴 데스크",
      countLabel: `${hiddenDeskCount + skillSources.length + identityFiles.length}개`,
    },
  ] satisfies Array<{
    id: OfficeBoardView;
    label: string;
    detail: string;
    countLabel: string;
  }>;
  const officeBoardViewSummaries: Record<OfficeBoardView, { title: string; detail: string; scope: string }> = {
    today: {
      title: "오늘 볼 일만 먼저 정리",
      detail: "진행 중인 팀원, 다음 할 일, 필요한 설정만 남깁니다.",
      scope: "진행 중심",
    },
    approval: {
      title: "실행 전 확인만 모아보기",
      detail: "발송, 등록, 파일 변경처럼 승인 전 잠긴 후보를 따로 봅니다.",
      scope: "승인 중심",
    },
    records: {
      title: "결정과 실행 로그 확인",
      detail: "무엇을 결정했고 어디에 기록됐는지 필요할 때만 펼칩니다.",
      scope: "기록 중심",
    },
    archive: {
      title: "설정과 보관 자료 정리",
      detail: "숨긴 데스크, 업무 도구, 기억 파일처럼 자주 보지 않는 정보를 둡니다.",
      scope: "보관 중심",
    },
  };
  const activeOfficeBoardViewTab =
    officeBoardViewTabs.find((item) => item.id === activeOfficeBoardView) ?? officeBoardViewTabs[0];
  const activeOfficeBoardViewSummary = officeBoardViewSummaries[activeOfficeBoardView];
  const officeBoardFocusCards = [
    {
      id: "today",
      label: "오늘",
      title: channelRunningCount || runningCrewCount ? "진행 중인 팀원 먼저" : "새 업무 대기",
      detail: channelRunningCount || runningCrewCount
        ? "실행 중인 팀원과 바로 이어갈 다음 버튼만 먼저 봅니다."
        : "채팅에서 일을 맡기면 담당자와 다음 행동이 이 칸에 올라옵니다.",
      countLabel: `${visibleWorkCount + channelRunningCount + runningCrewCount}건`,
      actionLabel: "진행 보기",
      state: channelRunningCount || runningCrewCount ? "running" : "idle",
      view: "today",
    },
    {
      id: "approval",
      label: "승인",
      title: approvalWaitCount ? "실행 전 확인 필요" : "승인 대기 없음",
      detail: approvalWaitCount
        ? "발송, 일정 등록, 파일 변경 후보만 모아 최종 확인 전에 멈춥니다."
        : "외부 실행 후보가 생기면 이 탭에 먼저 모입니다.",
      countLabel: `${approvalWaitCount}건`,
      actionLabel: "승인 보기",
      state: approvalWaitCount ? "approval" : "idle",
      view: "approval",
    },
    {
      id: "records",
      label: "기록",
      title: executionLogCount ? "결정 기록 확인" : "기록 대기",
      detail: executionLogCount
        ? "무엇을 승인, 수정, 보류했는지와 실행 로그 위치를 필요할 때 펼칩니다."
        : "아직 남길 결정이나 실행 로그가 없습니다.",
      countLabel: `${executionLogCount}건`,
      actionLabel: "기록 보기",
      state: executionLogCount ? "ready" : "idle",
      view: "records",
    },
    {
      id: "archive",
      label: "보관",
      title: hiddenDeskCount || skillSources.length || identityFiles.length ? "설정과 보관 자료" : "보관 대기",
      detail: "숨긴 데스크, 업무 도구, 기억 파일처럼 자주 보지 않는 항목은 여기로 분리합니다.",
      countLabel: `${hiddenDeskCount + skillSources.length + identityFiles.length}개`,
      actionLabel: "보관 보기",
      state: hiddenDeskCount || skillSources.length || identityFiles.length ? "archive" : "idle",
      view: "archive",
    },
  ] satisfies Array<{
    id: OfficeBoardView;
    label: string;
    title: string;
    detail: string;
    countLabel: string;
    actionLabel: string;
    state: "running" | "approval" | "ready" | "archive" | "idle";
    view: OfficeBoardView;
  }>;
  const activeOfficeBoardFocusCard =
    officeBoardFocusCards.find((item) => item.id === activeOfficeBoardView) ?? officeBoardFocusCards[0];
  const otherOfficeBoardFocusCards = officeBoardFocusCards.filter((item) => item.id !== activeOfficeBoardView);
  const visibleOtherOfficeBoardFocusCards = otherOfficeBoardFocusCards.slice(0, 1);
  const hiddenOtherOfficeBoardFocusCards = otherOfficeBoardFocusCards.slice(1);
  const officeBoardActionHubProfiles = {
    today: {
      title: approvalWaitCount ? "승인할 일부터 확인" : channelRunningCount || runningCrewCount ? "진행 중인 일만 이어가기" : "새 업무를 맡길 준비",
      detail: approvalWaitCount
        ? "오늘 보기에서도 실행 전 확인이 먼저 보입니다."
        : "진행, 승인, 기록, 보관은 탭으로 나누고 현재 필요한 것만 남깁니다.",
      actionLabel: approvalWaitCount ? "승인 보기" : "현재 보기 유지",
      targetView: approvalWaitCount ? "approval" : "today",
      foldedTitle: `${executionLogCount + hiddenDeskCount + skillSources.length + identityFiles.length}개 상세 접힘`,
      foldedDetail: "결정 로그, 보관 자료, 숨긴 데스크는 필요할 때만 엽니다.",
      state: approvalWaitCount ? "approval" : channelRunningCount || runningCrewCount ? "running" : "idle",
    },
    approval: {
      title: approvalWaitCount ? `${approvalWaitCount}개 승인 후보만 보기` : "승인 대기 없음",
      detail: "발송, 일정 등록, 파일 변경처럼 위험한 실행 후보만 이 탭에 모읍니다.",
      actionLabel: finalActionCount ? "실행 후보 확인" : "오늘로 돌아가기",
      targetView: finalActionCount ? "approval" : "today",
      foldedTitle: `${finalActionCount + approvalWorkItems.length}개 실행 상세 접힘`,
      foldedDetail: "미리보기, 위험도, 체크리스트, 감사 로그는 후보를 펼칠 때만 봅니다.",
      state: approvalWaitCount ? "approval" : "idle",
    },
    records: {
      title: executionLogCount ? `${executionLogCount}건 기록 확인` : "기록 대기",
      detail: "이미 결정한 일과 실행 로그 위치만 따로 확인합니다.",
      actionLabel: approvalWaitCount ? "승인 보기" : "오늘로 돌아가기",
      targetView: approvalWaitCount ? "approval" : "today",
      foldedTitle: `${executionLogCount}개 영수증 접힘`,
      foldedDetail: "결정 영수증, 실행 로그, 되돌리기 기준은 기록 보기에서만 펼칩니다.",
      state: executionLogCount ? "ready" : "idle",
    },
    archive: {
      title: hiddenDeskCount || skillSources.length || identityFiles.length ? "보관 자료만 정리" : "보관 대기",
      detail: "자주 보지 않는 설정, 숨긴 데스크, 기억 파일은 기본 화면에서 분리합니다.",
      actionLabel: "오늘로 돌아가기",
      targetView: "today",
      foldedTitle: `${hiddenDeskCount + skillSources.length + identityFiles.length}개 보관 상세`,
      foldedDetail: "보관 항목은 기본 흐름을 방해하지 않도록 이 탭에만 둡니다.",
      state: hiddenDeskCount || skillSources.length || identityFiles.length ? "archive" : "idle",
    },
  } satisfies Record<
    OfficeBoardView,
    {
      title: string;
      detail: string;
      actionLabel: string;
      targetView: OfficeBoardView;
      foldedTitle: string;
      foldedDetail: string;
      state: "running" | "approval" | "ready" | "archive" | "idle";
    }
  >;
  const activeOfficeBoardActionHub = officeBoardActionHubProfiles[activeOfficeBoardView];
  const officeBoardPrimaryActionTargetsCurrentView =
    activeOfficeBoardActionHub.targetView === activeOfficeBoardView;
  const officeBoardPrimaryActionCanFocusCurrentView =
    officeBoardPrimaryActionTargetsCurrentView && activeOfficeBoardView === "approval" && finalActionCount > 0;
  const handleOfficeBoardPrimaryAction = () => {
    if (!officeBoardPrimaryActionTargetsCurrentView) {
      selectOfficeBoardView(activeOfficeBoardActionHub.targetView);
      return;
    }
    if (officeBoardPrimaryActionCanFocusCurrentView) {
      const target = document.getElementById("final-action-candidates");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    }
  };
  const officeBoardActionHubRows = [
    {
      id: "focus",
      label: "지금 볼 것",
      title: activeOfficeBoardActionHub.title,
      detail: activeOfficeBoardActionHub.detail,
      state: activeOfficeBoardActionHub.state,
    },
    {
      id: "folded",
      label: "접힌 상세",
      title: activeOfficeBoardActionHub.foldedTitle,
      detail: activeOfficeBoardActionHub.foldedDetail,
      state: "folded",
    },
    {
      id: "next",
      label: "다음 행동",
      title: activeOfficeBoardActionHub.actionLabel,
      detail:
        activeOfficeBoardActionHub.targetView === activeOfficeBoardView
          ? "이 보기 안에서 후보를 펼쳐 확인합니다."
          : `${officeBoardViewSummaries[activeOfficeBoardActionHub.targetView].scope}으로 이동합니다.`,
      state: activeOfficeBoardActionHub.targetView === activeOfficeBoardView ? activeOfficeBoardActionHub.state : "ready",
    },
  ] satisfies Array<{
    id: "focus" | "folded" | "next";
    label: string;
    title: string;
    detail: string;
    state: "running" | "approval" | "ready" | "archive" | "idle" | "folded";
  }>;
  const officeBoardFolderMapItems = [
    {
      id: "today",
      label: "오늘",
      title: "진행/다음 할 일",
      detail: "AI 팀원 활동과 지금 누를 버튼",
      countLabel: `${visibleWorkCount + channelRunningCount + runningCrewCount}건`,
      state: channelRunningCount || runningCrewCount ? "running" : "idle",
    },
    {
      id: "approval",
      label: "승인",
      title: "실행 전 확인",
      detail: "발송, 일정 등록, 파일 변경 후보",
      countLabel: `${approvalWaitCount}건`,
      state: approvalWaitCount ? "approval" : "idle",
    },
    {
      id: "records",
      label: "기록",
      title: "결정/실행 로그",
      detail: "결정 영수증과 되돌리기 기준",
      countLabel: `${executionLogCount}건`,
      state: executionLogCount ? "ready" : "idle",
    },
    {
      id: "archive",
      label: "보관",
      title: "설정/기억 자료",
      detail: "숨긴 데스크, 업무 도구, 기억 파일",
      countLabel: `${hiddenDeskCount + skillSources.length + identityFiles.length}개`,
      state: hiddenDeskCount || skillSources.length || identityFiles.length ? "archive" : "idle",
    },
  ] satisfies Array<{
    id: OfficeBoardView;
    label: string;
    title: string;
    detail: string;
    countLabel: string;
    state: "running" | "approval" | "ready" | "archive" | "idle";
  }>;
  const approvalActionReadinessCards = buildApprovalActionReadinessCards({
    workItems: approvalWorkItems,
    channelDecisions,
    delegationArtifacts,
    finalDryRun,
    finalExecution,
  });
  const approvalActionReadinessVisibleLimit = 1;
  const approvalActionReadinessPriority = (card: (typeof approvalActionReadinessCards)[number]) => {
    const stateScore = card.state === "danger" ? 40 : card.state === "review" ? 30 : card.state === "locked" ? 20 : 10;
    const riskScore = /높음|고위험|차단|외부/u.test(card.riskLabel) ? 8 : /중간|승인/u.test(card.riskLabel) ? 4 : 0;
    const finalScore = /최종|마지막|발송|등록|파일|클릭/u.test(`${card.title} ${card.readinessGuide.title}`) ? 3 : 0;
    return stateScore + riskScore + finalScore;
  };
  const prioritizedApprovalActionReadinessCards = approvalActionReadinessCards
    .map((card, index) => ({ card, index }))
    .sort((left, right) => approvalActionReadinessPriority(right.card) - approvalActionReadinessPriority(left.card) || left.index - right.index)
    .map(({ card }) => card);
  const visibleApprovalActionReadinessCards = prioritizedApprovalActionReadinessCards.slice(0, approvalActionReadinessVisibleLimit);
  const hiddenApprovalActionReadinessCards = prioritizedApprovalActionReadinessCards.slice(approvalActionReadinessVisibleLimit);
  const detachedApprovalActionReadinessCard =
    prioritizedApprovalActionReadinessCards.find((card) => card.title === "거래처 답장 메일 최종 확인") ?? null;
  const detachedApprovalActionReadinessItem = detachedApprovalActionReadinessCard
    ? approvalWorkItems.find((item) => item.id === detachedApprovalActionReadinessCard.id) ?? null
    : null;
  const detachedFinalActionConfirmation =
    detachedApprovalActionReadinessItem && finalConfirmation?.workItemId === detachedApprovalActionReadinessItem.id
      ? finalConfirmation
      : null;
  const detachedFinalActionDryRun =
    detachedApprovalActionReadinessItem && finalDryRunWorkItemId === detachedApprovalActionReadinessItem.id
      ? finalDryRun
      : null;
  const detachedFinalActionExecution =
    detachedApprovalActionReadinessItem && finalExecutionWorkItemId === detachedApprovalActionReadinessItem.id
      ? finalExecution
      : null;
  const detachedFinalActionAuditReceipts = detachedApprovalActionReadinessItem
    ? buildFinalActionAuditReceipts({
        item: detachedApprovalActionReadinessItem,
        confirmation: detachedFinalActionConfirmation,
        dryRun: detachedFinalActionDryRun,
        execution: detachedFinalActionExecution,
      })
    : [];
  const detachedBrowserTaskResultReceipts = detachedApprovalActionReadinessItem
    ? buildBrowserTaskResultReceipts(detachedApprovalActionReadinessItem)
    : [];
  const renderApprovalActionReadinessCard = (card: (typeof approvalActionReadinessCards)[number]) => (
    <li
      key={card.id}
      data-state={card.state}
      data-approval-card-contract="folded_risk_preview_decision_log_rollback"
      data-approval-risk-label={card.riskLabel}
      data-approval-decision-options="approve_cancel_change_hold"
      data-execution-log-policy="audit_or_decision_receipt"
      data-rollback-policy="guide_before_or_after_execution"
      data-next-user-choice={card.nextUserChoice}
      data-visible-next-choice={visibleOfficeNextChoice(card.nextUserChoice)}
      data-approval-card-mobile-default="main_decision_path_first_support_inside_details"
    >
      <span>{card.riskLabel}</span>
      <div>
        <strong>{card.title}</strong>
        <small>{card.sourceLabel}</small>
        <div className={styles.approvalReadinessGuide} data-state={card.readinessGuide.state}>
          <span>{card.readinessGuide.label}</span>
          <div>
            <strong>{card.readinessGuide.title}</strong>
            <small>{card.readinessGuide.detail}</small>
          </div>
          <em>{card.readinessGuide.nextAction}</em>
        </div>
        <ol
          className={styles.approvalCommonCheckRail}
          aria-label={`${card.title} 카드 내부 공통 승인 체크`}
          data-approval-common-check-visible="risk_preview_decision_log_rollback"
        >
          {card.commonChecks.map((check) => (
            <li key={`${card.id}-common-visible-${check.id}`} data-state={check.state}>
              <span>{check.label}</span>
              <strong>{check.title}</strong>
              <small>{check.detail}</small>
            </li>
          ))}
        </ol>
        {card.computerUseChecks.length ? (
          <dl
            className={styles.computerUseOfficeApprovalContract}
            aria-label={`${card.title} 카드 내부 내 PC 작업 승인 한눈에 보기`}
            data-computer-use-office-contract="risk_preview_decision_log_rollback"
          >
            {card.computerUseChecks.map((check) => (
              <div key={`${card.id}-computer-use-visible-${check.id}`} data-state={check.state}>
                <dt>{check.label}</dt>
                <dd>
                  <strong>{check.title}</strong>
                  <small>{check.detail}</small>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <ol className={styles.approvalDecisionPath} aria-label={`${card.title} 카드 내부 승인 결정 순서`}>
          {card.decisionSteps.map((step) => (
            <li key={`${card.id}-visible-${step.id}`} data-state={step.state}>
              <span>{step.label}</span>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </li>
          ))}
        </ol>
        <details
          className={styles.approvalReadinessDetails}
          aria-label={`${card.title} 승인 준비 상세`}
          data-approval-readiness-details="checks_record_rollback_decision_on_demand"
          data-approval-readiness-details-default="closed"
        >
          <summary>
            <span>상세 확인</span>
            <strong>체크 · 기록 · 되돌리기 · 결정 순서</strong>
          </summary>
          <div
            className={styles.approvalReadinessDetailsBody}
            aria-label={`${card.title} 접힌 승인 준비 상세 내용`}
            data-approval-readiness-details-body="hidden_until_user_opens"
          >
            <ol className={styles.approvalCommonCheckRail} aria-label={`${card.title} 접힌 공통 승인 체크`}>
              {card.commonChecks.map((check) => (
                <li key={`${card.id}-common-${check.id}`} data-state={check.state}>
                  <span>{check.label}</span>
                  <strong>{check.title}</strong>
                  <small>{check.detail}</small>
                </li>
              ))}
            </ol>
            {card.computerUseChecks.length ? (
              <dl
                className={styles.computerUseOfficeApprovalContract}
                aria-label={`${card.title} 접힌 내 PC 작업 승인 한눈에 보기`}
                data-computer-use-office-contract="risk_preview_decision_log_rollback"
              >
                {card.computerUseChecks.map((check) => (
                  <div key={`${card.id}-computer-use-${check.id}`} data-state={check.state}>
                    <dt>{check.label}</dt>
                    <dd>
                      <strong>{check.title}</strong>
                      <small>{check.detail}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <dl>
              <div>
                <dt>미리보기</dt>
                <dd>{card.preview}</dd>
              </div>
              <div>
                <dt>기록</dt>
                <dd>{card.logPath}</dd>
              </div>
              <div>
                <dt>되돌리기</dt>
                <dd>{card.rollbackGuide}</dd>
              </div>
              <div>
                <dt>다음 선택</dt>
                <dd>{card.decisionGuide}</dd>
              </div>
              <div>
                <dt>막히면</dt>
                <dd>{visibleOfficeNextChoice(card.nextUserChoice)}</dd>
              </div>
            </dl>
            <ol className={styles.approvalDecisionPath} aria-label={`${card.title} 접힌 승인 결정 순서`}>
              {card.decisionSteps.map((step) => (
                <li key={`${card.id}-${step.id}`} data-state={step.state}>
                  <span>{step.label}</span>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </li>
              ))}
            </ol>
          </div>
        </details>
      </div>
    </li>
  );
  const approvalDecisionReceiptCards = buildApprovalDecisionReceiptCards({
    mailOpsDecisionMessage,
    localFileActionMessage,
    localFilePatternMessage,
    folderPlanActionMessage,
    finalConfirmationMessage,
  });
  const visibleApprovalDecisionReceiptCards = approvalDecisionReceiptCards.slice(0, 1);
  const hiddenApprovalDecisionReceiptCards = approvalDecisionReceiptCards.slice(1);
  const mailOpsDecisionReceiptComparisonRows: MailOpsDecisionReceiptComparisonRow[] = approvalDecisionReceiptCards
    .filter((card) => Boolean(card.mailOpsWorkQueueReview))
    .map((card) => ({
      id: `mailops-decision-comparison-${card.id}`,
      title: card.title,
      decisionLabel: card.label,
      executionStateLabel: card.executionStateLabel,
      nextChoiceLabel: visibleOfficeNextChoice(card.parallelWorkNextChoice),
      reviewDecisionLabel: card.mailOpsWorkQueueReview?.decisionLabel ?? "검토 기록 없음",
      reviewNote: card.mailOpsWorkQueueReview?.note || "수정 메모 없음",
      reviewContext: card.mailOpsWorkQueueReview?.context ?? "missing",
      externalMutationLabel: card.mailOpsWorkQueueReview?.externalMutationLabel ?? "false",
      state: card.state,
    }));
  const connectorReadyCount = connectorStatuses.filter((record) => record.status !== "site_login_stored" && record.recovery?.kind === "ready").length;
  const connectorIssueRecords = connectorStatuses.filter(
    (record) => record.recovery?.kind && record.recovery.kind !== "ready",
  );
  const credentialIssueCount = connectorIssueRecords.filter((record) =>
    /credential|connection|required|permission/u.test(record.recovery?.kind ?? ""),
  ).length;
  const computerUseRecoveryCount = connectorStatuses.filter((record) => {
    const recoveryText = [
      ...(record.recovery?.fallbackRoutes ?? []),
      ...(record.recovery?.fallbackConnectorIds ?? []),
      record.method,
      record.appPath,
      record.siteUrl,
    ].filter(Boolean).join(" ");
    return /내 PC 작업 도우미|computer-use|app|site|browser|웹|앱/u.test(recoveryText);
  }).length + externalApprovalCount;
  const activeRecoveryRecords = connectorIssueRecords.slice(0, 3);
  const visibleConnectionRecoveryRecords = activeRecoveryRecords.slice(0, 1);
  const hiddenConnectionRecoveryRecords = activeRecoveryRecords.slice(1);
  const connectionRecoveryRoutes = [
    {
      id: "official",
      label: "공식 연결",
      detail: connectorReadyCount ? `${connectorReadyCount}개 연결 확인` : connectorIssueRecords.length ? `${connectorIssueRecords.length}개 재점검` : connectionRecoveryHandoff ? "방금 연결 확인에서 이동" : "연결 전",
      state: connectorReadyCount ? "done" : connectorIssueRecords.length || connectionRecoveryHandoff ? "active" : "idle",
    },
    {
      id: "vault",
      label: "계정 보관함",
      detail: credentialIssueCount ? `${credentialIssueCount}개 저장/재승인` : connectionRecoveryHandoff ? "비밀번호는 채팅 밖" : "secret은 채팅 밖",
      state: credentialIssueCount || connectionRecoveryHandoff ? "active" : connectorReadyCount ? "done" : "idle",
    },
    {
      id: "computer_use",
      label: "내 PC 작업 도우미 읽기",
      detail: computerUseRecoveryCount ? `${computerUseRecoveryCount}개 화면 확인 후보` : connectionRecoveryHandoff ? "읽기 후보로 이어가기" : "읽기 후보 준비",
      state: computerUseRecoveryCount || connectionRecoveryHandoff ? "active" : "idle",
    },
    {
      id: "office_queue",
      label: "오피스 승인함",
      detail: externalApprovalCount ? `${externalApprovalCount}개 승인 카드` : finalActionCount ? `${finalActionCount}개 최종 확인` : connectionRecoveryHandoff ? "최종 확인 전 실행 잠금" : "외부 실행 잠금",
      state: externalApprovalCount || finalActionCount || connectionRecoveryHandoff ? "approval" : "locked",
    },
  ] as const;
  const readyIdentityCount = identityFiles.filter((file) => file.state === "ready").length;
  const activeSkillSourceCount = skillSources.filter((source) => source.status === "active").length;
  const externalSkillSourceCount = skillSources.filter(
    (source) => source.connectorIds?.length || source.externalToolHints?.length,
  ).length;
  const officeStateLabel = runningCrewCount
    ? `${runningCrewCount}명 실행 중`
    : activeCrewCount
      ? `${activeCrewCount}명 대기 중`
      : "컨트롤 대기";
  const stageCards = [
    {
      id: "intake",
      label: "받은 업무",
      detail: visibleWorkCount > 0 ? `${visibleWorkCount}개 처리 중` : "기본 대기",
      progress: desks.length > 0 ? 100 : 0,
      state: "done",
    },
    {
      id: "tools",
      label: "연결·자료",
      detail: activeFeatureCount > 0 ? `${activeFeatureCount}개 열림` : "필요할 때 추가",
      progress: Math.min(100, activeFeatureCount * 24),
      state: activeFeatureCount > 0 ? "active" : "todo",
    },
    {
      id: "automation",
      label: "자동화",
      detail: enabledRuleCount > 0 ? `${enabledRuleCount}개 작동` : "사용자가 켜면 표시",
      progress: enabledRuleCount > 0 ? 100 : activeFeatureCount > 0 ? 36 : 0,
      state: enabledRuleCount > 0 ? "done" : activeFeatureCount > 0 ? "active" : "todo",
    },
  ] as const;
  const primaryQueueItem =
    focusedChannelQueueItems.find((item) => item.kind === "running" || item.kind === "approval") ??
    focusedChannelQueueItems[0] ??
    visibleChannelQueueItems.find((item) => item.kind === "running" || item.kind === "approval") ??
    visibleChannelQueueItems[0];
  const primaryQueueChannel = primaryQueueItem
    ? channelWorkSummaries.find((channel) => channel.id === primaryQueueItem.teammateId)
    : null;
  const currentFlowSteps = [
    {
      id: "chat",
      label: "채팅 명령",
      detail: channelQueueFocus ? "전달 기록" : primaryQueueItem ? "접수됨" : "대기",
      state: channelQueueFocus || primaryQueueItem ? "done" : "idle",
    },
    {
      id: "crew",
      label: primaryQueueItem?.teammateName ?? "AI 팀원",
      detail: primaryQueueItem?.queueLabel ?? primaryQueueChannel?.statusLabel ?? (channelQueueFocus ? "실행 상태 확인 전" : officeStateLabel),
      state: primaryQueueItem?.kind === "running" ? "running" : primaryQueueItem?.kind === "approval" ? "approval" : primaryQueueItem?.kind === "result" ? "done" : "idle",
    },
    {
      id: "result",
      label: primaryQueueItem?.kind === "approval" ? "승인 확인" : "결과 묶음",
      detail: primaryQueueItem?.outputKind ? outputKindLabel(primaryQueueItem.outputKind) : approvalWaitCount ? `${approvalWaitCount}개 확인` : "대기",
      state: primaryQueueItem?.kind === "approval" || approvalWaitCount > 0 ? "approval" : primaryQueueItem?.kind === "result" ? "done" : "idle",
    },
  ] as const;
  const officeCommandTitle = primaryQueueItem
    ? `${primaryQueueItem.teammateName}에게 넘어간 업무`
    : channelQueueFocus
      ? "채팅에서 AI 팀원에게 넘긴 업무"
      : "메인 컨트롤 대기";
  const officeCommandDetail = primaryQueueItem
    ? primaryQueueItem.detail
    : channelQueueFocus
      ? channelQueueFocus.requestText
      : "채팅에서 일을 맡기면 담당 AI 팀원, 오피스 승인함, 결과 파일이 이곳에 이어집니다.";
  const officeCommandMeta = [
    primaryQueueItem?.channelName ?? channelQueueFocus?.targetLabels?.[0] ?? "메인 컨트롤",
    primaryQueueItem ? channelQueueKindLabel(primaryQueueItem.kind) : officeStateLabel,
    approvalWaitCount ? `승인 ${approvalWaitCount}` : "승인 대기 없음",
  ];
  const officeWorkMethodRailItems = buildOfficeWorkMethodRail(channelQueueItems, approvalWaitCount);
  const officeExecutionBoundaryItems = buildOfficeExecutionBoundaryRail(approvalWaitCount);
  const officeSingleSettingShortcuts = [
    {
      id: "codex-oauth",
      label: "AI 답변 연결",
      detail: "앱 안 대화 엔진 연결",
      href: officeSingleSettingHref("codex-oauth", "AI 답변 연결 설정만 확인합니다"),
    },
    {
      id: "mail-calendar",
      label: "메일/캘린더",
      detail: "메일 계정과 일정, 계정 보관함 연결",
      href: officeSingleSettingHref("mail-calendar", "메일과 캘린더 연결 설정만 확인합니다"),
    },
    {
      id: "vault",
      label: "계정 보관함",
      detail: "외부 사이트 계정 저장소",
      href: officeSingleSettingHref("vault", "계정 보관함 설정만 확인합니다", { externalAccounts: "1" }),
    },
    {
      id: "computer-use",
      label: "내 PC 작업 도우미",
      detail: "화면 확인과 읽기 모드",
      href: officeSingleSettingHref("computer-use", "내 PC 작업 도우미 안전 설정만 확인합니다"),
    },
  ];
  const approvalBridgeSteps = [
    {
      id: "assistant",
      label: "오피스 승인함",
      detail: "앱 안 기본 승인함",
      state: "ready",
    },
    {
      id: "messenger",
      label: "외부 메신저",
      detail: connectedMessengerCount > 1 ? `${connectedMessengerCount - 1}개 선택 연결` : "필요할 때만 연결",
      state: connectedMessengerCount > 1 ? "ready" : "idle",
    },
    {
      id: "approval",
      label: officeDecisionActionLabels,
      detail: approvalWaitCount ? `${approvalWaitCount}개 확인 대기` : "후보 없음",
      state: approvalWaitCount ? "active" : "idle",
    },
    {
      id: "final",
      label: "최종 실행 확인",
      detail: finalActionCount ? `${finalActionCount}개 실행 직전` : "외부 실행 잠금",
      state: finalActionCount ? "active" : "locked",
    },
  ] as const;
  const repeatWorkApprovalSteps = [
    {
      id: "repeat-enabled",
      label: "반복 설정",
      title: enabledRuleCount ? `${enabledRuleCount}개 켜짐` : "꺼진 후보 대기",
      detail: enabledRuleCount
        ? "사용자가 켠 반복 업무만 점검 대상입니다."
        : "문장 빌더에서 후보를 저장하고 켠 뒤에만 점검합니다.",
      state: enabledRuleCount ? "ready" : "idle",
    },
    {
      id: "repeat-preview",
      label: "미리보기",
      title: approvalWaitCount ? `${approvalWaitCount}개 승인 후보` : "후보 없음",
      detail: approvalWaitCount
        ? "업무 후보와 승인 대기에 올라온 내용을 먼저 확인합니다."
        : "점검 결과가 생기면 무엇을 할지 먼저 보여줍니다.",
      state: approvalWaitCount ? "approval" : enabledRuleCount ? "ready" : "idle",
    },
    {
      id: "repeat-decision",
      label: "선택",
      title: officeDecisionActionLabels,
      detail: "사용자가 고른 결정만 오피스 승인함과 업무 기록에 남깁니다.",
      state: approvalWaitCount ? "approval" : "locked",
    },
    {
      id: "repeat-log",
      label: "로그 보기",
      title: executionLogCount ? `${executionLogCount}개 실행 로그` : "로그 대기",
      detail: "외부 발송, 일정 등록, 파일 변경은 앱의 마지막 확인 전까지 잠겨 있습니다.",
      state: executionLogCount ? "ready" : "locked",
    },
  ] as const;
  const repeatWorkOfficeApprovalItems = buildRepeatWorkOfficeApprovalItems({
    channelQueueItems,
    finalActionCandidates,
    externalApprovalCandidates,
    learnedDraftApprovalItems,
  });
  const mailCalendarActionCandidates = finalActionCandidates.filter(
    (item) =>
      item.finalAction?.kind === "send_email" ||
      item.finalAction?.kind === "send_bulk_email" ||
      item.finalAction?.kind === "create_calendar_event",
  );
  const mailOpsWorkQueueReviewRecords = readMailOpsWorkQueueReviewRecords();
  const mailOpsMobileShareWorkQueueReviewRecords = finalActionCandidates
    .filter(isMobileShareWorkQueueItem)
    .map(createMobileShareWorkQueueReviewRecord)
    .filter((record) => !mailOpsWorkQueueReviewRecords.some((existing) => existing.itemId === record.itemId))
    .slice(0, 8);
  const roleCommandMailWorkQueueReviewRecords = mailCalendarActionCandidates
    .filter(isRoleCommandMailReviewItem)
    .map(createRoleCommandMailWorkQueueReviewRecord)
    .filter((record) => !mailOpsWorkQueueReviewRecords.some((existing) => existing.itemId === record.itemId))
    .slice(0, 8);
  const mailOpsVisibleWorkQueueReviewRecords = [
    ...roleCommandMailWorkQueueReviewRecords,
    ...mailOpsWorkQueueReviewRecords,
  ].slice(0, 40);
  const mailOpsWorkQueueReviewSummary = summarizeMailOpsWorkQueueReviewRecords(mailOpsVisibleWorkQueueReviewRecords);
  const userComposedMailWorkQueueReviewRecords = finalActionCandidates
    .filter(isUserComposedMailReviewItem)
    .map((item) => createUserComposedMailWorkQueueReviewRecord(userComposedMailOverrides[item.id] ?? item));
  const mailOpsEventReviewRecords = [
    ...mailOpsVisibleWorkQueueReviewRecords,
    ...userComposedMailWorkQueueReviewRecords,
  ];
  const mailOpsEventReviewSignature = mailOpsEventReviewRecords
    .map((record) =>
      [
        record.itemId,
        record.decision,
        record.finalConfirmationRoute ?? "",
        record.previewId ?? "",
        record.updatedAt,
        record.category,
        record.draftBodySource ?? "",
        record.revisedDraft?.length ?? 0,
        record.decisionReasonSummary ?? "",
        record.sendCheckSummary ?? "",
      ].join(":"),
    )
    .join("|");
  useEffect(() => {
    if (!onRecordMailOpsWorkQueueReviewEvent || !mailOpsEventReviewRecords.length) return;
    void onRecordMailOpsWorkQueueReviewEvent(mailOpsEventReviewRecords);
  }, [mailOpsEventReviewSignature, onRecordMailOpsWorkQueueReviewEvent]);
  const mailOpsEventReviewSummary = summarizeMailOpsWorkQueueReviewRecords(mailOpsEventReviewRecords);
  const mailOpsWorkQueueAutomationEvidence = createMailOpsWorkQueueAutomationEvidence({
    records: mailOpsVisibleWorkQueueReviewRecords,
  });
  const mailOpsWorkQueueAutomationProofLabel =
    mailOpsWorkQueueAutomationEvidence.proofLabel || WORK_AUTOMATION_MAILOPS_WORK_QUEUE_PROOF_LABEL;
  const mailOpsEventAutomationEvidence = createMailOpsWorkQueueAutomationEvidence({
    records: mailOpsEventReviewRecords,
  });
  const mailOpsWorkBenchRows = buildMailOpsWorkBenchRows(mailOpsVisibleWorkQueueReviewRecords, finalActionCandidates);
  const mailOpsSelectedWorkBenchRows = mailOpsWorkBenchRows.filter((row) => mailOpsSelectedWorkBenchRowIds.includes(row.id));
  const mailOpsSelectedWorkBenchCount = mailOpsSelectedWorkBenchRows.length;
  const mailOpsEditingWorkBenchRow = mailOpsWorkBenchRows.find((row) => row.id === mailOpsEditingWorkBenchRowId) ?? null;
  const mailOpsFocusedWorkBenchRow = mailOpsEditingWorkBenchRow ?? mailOpsSelectedWorkBenchRows[0] ?? mailOpsWorkBenchRows[0] ?? null;
  const mailOpsSelectedWorkBenchTitle =
    mailOpsSelectedWorkBenchRows[0]?.title
      ? mailOpsSelectedWorkBenchRows.length === 1
        ? mailOpsSelectedWorkBenchRows[0].title
        : `${mailOpsSelectedWorkBenchRows[0].title} 외 ${mailOpsSelectedWorkBenchRows.length - 1}건`
      : "선택 없음";
  const mailOpsFocusedEditDraft = mailOpsFocusedWorkBenchRow
    ? mailOpsWorkBenchDrafts[mailOpsFocusedWorkBenchRow.id] ??
      (mailOpsFocusedWorkBenchRow.draftPreview.startsWith("초안 없음") ? "" : mailOpsFocusedWorkBenchRow.draftPreview)
    : "";
  const mailOpsFocusedEditSummary = mailOpsFocusedWorkBenchRow
    ? `${mailOpsFocusedWorkBenchRow.oneLineDecisionLabel} · ${mailOpsFocusedWorkBenchRow.nextActionLabel} · ${mailOpsFocusedWorkBenchRow.sendBoundaryLabel}`
    : "메일을 선택하면 초안과 승인 상태를 여기서 봅니다";
  const mailOpsSelectedReplyCount = mailOpsSelectedWorkBenchRows.filter((row) => row.state === "included").length;
  const mailOpsSelectedReviewCount = mailOpsSelectedWorkBenchRows.filter((row) => row.state === "held").length;
  const mailOpsSelectedExcludedCount = mailOpsSelectedWorkBenchRows.filter((row) => row.state === "excluded").length;
  const mailOpsBulkSelectionPreviewLabel = mailOpsSelectedWorkBenchCount
    ? `현재 답장 ${mailOpsSelectedReplyCount} · 검토 ${mailOpsSelectedReviewCount} · 제외 ${mailOpsSelectedExcludedCount}`
    : "메일을 선택하면 일괄 처리 결과를 미리 봅니다";
  const mailOpsBulkApprovePreviewLabel = mailOpsSelectedWorkBenchCount
    ? `답장 보냄 → ${mailOpsSelectedWorkBenchCount}건 마지막 확인 후보`
    : "답장 보낼 메일 선택";
  const mailOpsBulkReviewPreviewLabel = mailOpsSelectedWorkBenchCount
    ? `수정/확인 → ${mailOpsSelectedWorkBenchCount}건 발송 경로 제외`
    : "검토할 메일 선택";
  const mailOpsBulkExcludePreviewLabel = mailOpsSelectedWorkBenchCount
    ? `답장 안 보냄 → ${mailOpsSelectedWorkBenchCount}건 제외`
    : "제외할 메일 선택";
  const mailOpsFinalConfirmationQueueRows = mailOpsWorkBenchRows.filter((row) => row.state === "included");
  const mailOpsFinalConfirmationReadyRows = mailOpsFinalConfirmationQueueRows.filter((row) => row.finalActionReady);
  const mailOpsFinalConfirmationWaitingRows = mailOpsFinalConfirmationQueueRows.filter((row) => !row.finalActionReady);
  const mailOpsFinalConfirmationNextRow =
    mailOpsFinalConfirmationReadyRows[0] ?? mailOpsFinalConfirmationQueueRows[0] ?? null;
  const mailOpsFinalExecutionRunwayItems = [
    {
      id: "approved",
      label: "승인 후보",
      title: `${mailOpsFinalConfirmationQueueRows.length}건`,
      detail: "작업함에서 승인한 메일만 마지막 확인 후보로 이동합니다.",
      state: mailOpsFinalConfirmationQueueRows.length ? "ready" : "locked",
    },
    {
      id: "dry_run",
      label: "dry-run",
      title: mailOpsFinalConfirmationReadyRows.length ? "실행 전 검토 가능" : "후보 연결 필요",
      detail: "수신자, 본문, 첨부, 연결 상태를 실제 발송 전에 검토합니다.",
      state: mailOpsFinalConfirmationReadyRows.length ? "review" : "locked",
    },
    {
      id: "final_confirm",
      label: "마지막 확인",
      title: mailOpsFinalConfirmationReadyRows.length ? `${mailOpsFinalConfirmationReadyRows.length}건 준비` : "잠금",
      detail: "사용자가 마지막 확인을 누르기 전에는 외부 메일을 보내지 않습니다.",
      state: mailOpsFinalConfirmationReadyRows.length ? "review" : "locked",
    },
    {
      id: "execution_log",
      label: "실행 로그",
      title: "발송 후 기록",
      detail: "실제 발송 요청이 승인된 뒤 감사 기록과 실행 로그로 남깁니다.",
      state: "locked",
    },
  ] satisfies Array<{
    id: string;
    label: string;
    title: string;
    detail: string;
    state: "ready" | "review" | "locked";
  }>;
  const mailOpsAiRoleExecutionBridgeItems = [
    {
      id: "ai_connection",
      label: "AI 연결",
      value: "라우터",
      detail: "Codex/OpenAI/Gemini 중 실제 답변 경로를 확인",
      state: "ready",
    },
    {
      id: "role_payload",
      label: "역할 부여",
      value: "메일 비서",
      detail: "roleContext가 요청에 포함되어야 업무가 시작",
      state: "ready",
    },
    {
      id: "answer_receipt",
      label: "답변 영수증",
      value: "필수",
      detail: "aiRuntimeReceipt가 있어야 작업함 후보 생성",
      state: "ready",
    },
    {
      id: "workbench",
      label: "작업함",
      value: `${mailOpsWorkBenchRows.length}건`,
      detail: "답장, 수정, 제외를 한 줄로 선별",
      state: mailOpsWorkBenchRows.length ? "ready" : "idle",
    },
    {
      id: "approval_execution",
      label: "승인/실행",
      value: mailOpsFinalConfirmationReadyRows.length ? `${mailOpsFinalConfirmationReadyRows.length}건` : "잠금",
      detail: "마지막 확인 전 외부 발송 잠금",
      state: mailOpsFinalConfirmationReadyRows.length ? "approval" : "locked",
    },
  ] satisfies Array<{
    id: string;
    label: string;
    value: string;
    detail: string;
    state: "ready" | "idle" | "approval" | "locked";
  }>;
  const mailOpsAiRoleExecutionBridgeSummary = `AI 역할 실행 · 작업함 ${mailOpsWorkBenchRows.length}건 · 마지막 확인 ${
    mailOpsFinalConfirmationReadyRows.length
  }건 · 외부 발송 잠금`;
  const mailOpsWorkBenchReviewCount = mailOpsWorkQueueReviewSummary.revise + mailOpsWorkQueueReviewSummary.hold;
  const userComposedMailApprovalRows = finalActionCandidates
    .filter(isUserComposedMailReviewItem)
    .map((item) => {
      const currentItem = userComposedMailOverrides[item.id] ?? item;
      const review = currentItem.sourceEvidence?.userComposedMailReview;
      const reviewItems = review?.reviewItems ?? [];
      const sendReviewItems = review?.sendReviewItems ?? [];
      const ready = reviewItems.length > 0 && reviewItems.every((reviewItem) => reviewItem.state === "ok");
      const needsReviewCount = reviewItems.filter((reviewItem) => reviewItem.state !== "ok").length;
      const missingCount = reviewItems.filter((reviewItem) => reviewItem.state === "missing").length;
      return {
        item: currentItem,
        review,
        reviewItems,
        sendReviewItems,
        ready,
        needsReviewCount,
        missingCount,
      };
    });
  const userComposedMailReadyCount = userComposedMailApprovalRows.filter((row) => row.ready).length;
  const userComposedMailNeedsReviewCount = userComposedMailApprovalRows.filter((row) => !row.ready).length;
  const userComposedMailSendReviewCount = userComposedMailApprovalRows.reduce((count, row) => count + row.sendReviewItems.length, 0);
  const userComposedMailReviewItemCount = userComposedMailApprovalRows.reduce((count, row) => count + row.reviewItems.length, 0);
  const userComposedMailNeedsReviewItemCount = userComposedMailApprovalRows.reduce((count, row) => count + row.needsReviewCount, 0);
  const userComposedMailMissingItemCount = userComposedMailApprovalRows.reduce((count, row) => count + row.missingCount, 0);
  const userComposedMailLockedSendReviewCount = userComposedMailApprovalRows.reduce(
    (count, row) => count + row.sendReviewItems.filter((item) => item.state === "locked").length,
    0,
  );
  const mailOpsMobileHandoffCandidateCount = mailOpsMobileShareWorkQueueReviewRecords.length;
  const mailOpsCalendarCandidateCount = mailCalendarActionCandidates.filter(
    (item) => item.finalAction?.kind === "create_calendar_event",
  ).length;
  const mailOpsFollowUpCandidateCount = mailOpsWorkBenchRows.filter((row) =>
    /후속|리마인드|재확인|follow|remind/u.test(`${row.title} ${row.reason} ${row.detailSummary}`),
  ).length;
  const mailOpsSignalText = mailOpsWorkBenchRows
    .map((row) => `${row.title} ${row.reason} ${row.detailSummary} ${row.sendCheckSummary}`)
    .join(" ");
  const mailOpsSignalCount = (pattern: RegExp) => mailOpsWorkBenchRows.filter((row) =>
    pattern.test(`${row.title} ${row.reason} ${row.detailSummary} ${row.sendCheckSummary}`),
  ).length;
  const mailOpsRecipientListReview = findMailOpsRecipientListReview(approvalWorkItems);
  const mailOpsOperationsWorkbenchPlan = createModyMailOperationsWorkbenchPlan({
    analysis: {
      stats: {
        totalMessages: mailOpsWorkQueueReviewSummary.total,
        workItems: mailOpsWorkQueueReviewSummary.approve + mailOpsWorkBenchReviewCount,
        reviewItems: mailOpsWorkBenchReviewCount,
        ignoredItems: mailOpsWorkQueueReviewSummary.exclude,
        approvalCandidates: mailOpsWorkQueueReviewSummary.approve,
        replyCandidates: mailOpsWorkQueueReviewSummary.approve,
        calendarCandidates: mailOpsCalendarCandidateCount,
        attachmentSignals: mailOpsSignalCount(/첨부|파일|pdf|xlsx?|docx?|자료|계약서/u),
        bulkMailSignals: mailOpsWorkBenchRows.length > 1 ? mailOpsWorkBenchRows.length : 0,
        recipientDecisionSignals: mailOpsSignalCount(/수신자|참조|숨은참조|cc|bcc|대상|누구에게/u),
        followUpSignals: mailOpsFollowUpCandidateCount,
        recipientSourceSignals: mailOpsSignalCount(/명단|엑셀|csv|리스트|수신자 목록/u),
        quoteProposalSignals: mailOpsSignalCount(/견적|제안|가격|조건/u),
        invoicePaymentSignals: mailOpsSignalCount(/정산|청구|입금|세금계산서|영수증/u),
        contractLegalSignals: mailOpsSignalCount(/계약|법무|약관|책임|합의/u),
        publicTaxSignals: mailOpsSignalCount(/공공기관|세무|국세|전자세금|제출/u),
        complaintEscalationSignals: mailOpsSignalCount(/클레임|불만|긴급|항의|환불/u),
        reservationOrderSignals: mailOpsSignalCount(/예약|주문|방문|변경/u),
        complianceUnsubscribeSignals: mailOpsSignalCount(/수신거부|구독해지|마케팅|광고 제외/u),
        customerInquirySignals: mailOpsSignalCount(/문의|고객|상담|거래처|파트너/u),
        vendorProcurementSignals: mailOpsSignalCount(/발주|구매|납기|품목|거래 조건/u),
        hrRecruitingSignals: mailOpsSignalCount(/채용|면접|지원자|이력서|인사/u),
        documentSubmissionSignals: mailOpsSignalCount(/자료|보고서|제출|문서|파일 공유/u),
        securityAccountAlertSignals: mailOpsSignalCount(/보안|계정|비밀번호|인증|토큰/u),
        internalCollaborationSignals: mailOpsSignalCount(/담당자|내부|공유|협업|팀/u),
        threadContextSignals: mailOpsSignalCount(/회신|답장|전달|스레드|이전 약속/u),
        deliveryFailureSignals: mailOpsSignalCount(/반송|발송 실패|실패|bounce|undelivered/u),
        outOfOfficeSignals: mailOpsSignalCount(/부재중|자동응답|out of office/u),
        sentHistoryAuditSignals: mailOpsSignalCount(/승인 기록|발송 로그|감사|되돌림|이력/u),
        mailInfoDigestSignals: mailOpsSignalText.trim() ? 1 : 0,
        mobileReviewHandoffSignals: mailOpsMobileHandoffCandidateCount,
      },
    } as unknown as NonNullable<MailOpsOperationsWorkbenchInput["analysis"]>,
    userComposedDrafts: userComposedMailApprovalRows.length,
    mobileApprovalCandidateCount: mailOpsMobileHandoffCandidateCount,
    mobileSharedMailCount: approvalWorkItems.filter((item) => item.source === "mobile_share").length,
    mobileReceiveFilterLabels: ["승인 대기", "긴급/위험", "일정 후보", "후속 확인", "요약 전달"],
    recipientListReview: mailOpsRecipientListReview,
  });
  const mailOpsExceptionCoverageRows = [
    ...mailOpsOperationsWorkbenchPlan.exceptionCoverage.rows.filter((row) => row.status === "observed"),
    ...mailOpsOperationsWorkbenchPlan.exceptionCoverage.rows.filter((row) => row.status !== "observed"),
  ].slice(0, 8);
  const visibleMailOpsCapabilityRows = mailOpsOperationsWorkbenchPlan.coverageMatrix.slice(0, 1);
  const hiddenMailOpsCapabilityRows = mailOpsOperationsWorkbenchPlan.coverageMatrix.slice(1);
  const visibleMailOpsExceptionCoverageRows = mailOpsExceptionCoverageRows.slice(0, 1);
  const hiddenMailOpsExceptionCoverageRows = mailOpsExceptionCoverageRows.slice(1);
  const mailOpsBulkSendReviewPlan = mailOpsOperationsWorkbenchPlan.bulkSendReview;
  const userComposedMailNextActionLabel =
    userComposedMailReadyCount > 0
      ? "작성 메일 마지막 확인 준비"
      : userComposedMailMissingItemCount > 0
        ? "누락 항목 입력"
        : userComposedMailNeedsReviewItemCount > 0
          ? "수정 항목 확인"
          : "작성 메일 점검";
  const mailOpsWorkBenchTriageCards = [
    {
      state: "ready",
      label: "답장 보내기",
      value: `${mailOpsWorkQueueReviewSummary.approve}건`,
      detail: mailOpsFinalConfirmationNextRow
        ? `다음 확인: ${mailOpsFinalConfirmationNextRow.title}`
        : "승인한 메일만 마지막 확인으로 이동",
    },
    {
      state: "review",
      label: "수정/확인",
      value: `${mailOpsWorkBenchReviewCount}건`,
      detail: "초안, 수신자, 첨부를 고친 뒤 다시 승인",
    },
    {
      state: "excluded",
      label: "답장 안 보냄",
      value: `${mailOpsWorkQueueReviewSummary.exclude}건`,
      detail: "마지막 확인과 실제 발송 경로에서 제외",
    },
    {
      state: "compose",
      label: "내가 쓴 메일",
      value: `${userComposedMailApprovalRows.length}건`,
      detail: `점검 통과 ${userComposedMailReadyCount}건 · 확인 필요 ${userComposedMailNeedsReviewCount}건`,
    },
  ] as const;
  const mailOpsReplyNeededRows = mailOpsWorkBenchRows.filter((row) => row.state === "included");
  const mailOpsReviewNeededRows = mailOpsWorkBenchRows.filter((row) => row.state === "held");
  const mailOpsExcludedRows = mailOpsWorkBenchRows.filter((row) => row.state === "excluded");
  const mailOpsWorkBenchPriorityQueueAllRows = [
    ...mailOpsReviewNeededRows,
    ...mailOpsReplyNeededRows,
    ...mailOpsExcludedRows,
  ].map((row, index) => ({
    row,
    rank: index + 1,
    label: row.state === "held" ? "수정 먼저" : row.state === "included" ? "승인 준비" : "제외 확인",
    action:
      row.state === "held"
        ? "본문/수신자 고치기"
        : row.state === "included"
          ? "마지막 확인"
          : "발송 제외",
  }));
  const mailOpsWorkBenchPriorityQueueRows = mailOpsWorkBenchPriorityQueueAllRows.slice(0, 1);
  const hiddenMailOpsWorkBenchPriorityRows = mailOpsWorkBenchPriorityQueueAllRows.slice(1);
  const visibleMailOpsWorkBenchRows = mailOpsWorkBenchRows.slice(0, 1);
  const hiddenMailOpsWorkBenchRows = mailOpsWorkBenchRows.slice(1);
  const mailOpsWorkBenchClusterCards = [
    {
      id: "reply",
      state: mailOpsReplyNeededRows.length > 0 ? "ready" : "idle",
      label: "답장 보낼 메일",
      value: `${mailOpsReplyNeededRows.length}건`,
      sample: mailOpsReplyNeededRows[0]?.title ?? "승인한 답장 후보 없음",
      action: "초안 확인 후 마지막 확인",
    },
    {
      id: "review",
      state: mailOpsReviewNeededRows.length > 0 ? "review" : "idle",
      label: "수정할 메일",
      value: `${mailOpsReviewNeededRows.length}건`,
      sample: mailOpsReviewNeededRows[0]?.title ?? "수정 대기 없음",
      action: "수신자/본문/첨부 수정",
    },
    {
      id: "exclude",
      state: mailOpsExcludedRows.length > 0 ? "excluded" : "idle",
      label: "답장 안 보낼 메일",
      value: `${mailOpsExcludedRows.length}건`,
      sample: mailOpsExcludedRows[0]?.title ?? "제외 항목 없음",
      action: "발송 경로 제외 유지",
    },
    {
      id: "composed",
      state: userComposedMailApprovalRows.length > 0 ? "compose" : "idle",
      label: "내가 쓴 메일",
      value: `${userComposedMailApprovalRows.length}건`,
      sample:
        userComposedMailApprovalRows[0]?.item.sourceEvidence?.messageSubject ??
        userComposedMailApprovalRows[0]?.item.title ??
        "작성 메일 점검 대기",
      action: "보내기 전 내용 점검",
    },
  ] as const;
  const mailOpsCoverageRows = [
    {
      id: "reply",
      label: "답장",
      value: `${mailOpsReplyNeededRows.length}건`,
      state: mailOpsReplyNeededRows.length > 0 ? "ready" : "idle",
      detail: mailOpsReplyNeededRows[0]?.title ?? "답장 후보 없음",
    },
    {
      id: "review",
      label: "수정",
      value: `${mailOpsReviewNeededRows.length}건`,
      state: mailOpsReviewNeededRows.length > 0 ? "review" : "idle",
      detail: mailOpsReviewNeededRows[0]?.title ?? "수정/확인 대기 없음",
    },
    {
      id: "no_reply",
      label: "제외",
      value: `${mailOpsExcludedRows.length}건`,
      state: mailOpsExcludedRows.length > 0 ? "excluded" : "idle",
      detail: mailOpsExcludedRows[0]?.title ?? "답장 안 보낼 메일 없음",
    },
    {
      id: "calendar",
      label: "일정",
      value: `${mailOpsCalendarCandidateCount}건`,
      state: mailOpsCalendarCandidateCount > 0 ? "ready" : "idle",
      detail: mailOpsCalendarCandidateCount ? "일정 후보는 캘린더 최종 확인으로 분리" : "일정 후보 없음",
    },
    {
      id: "follow_up",
      label: "후속",
      value: `${mailOpsFollowUpCandidateCount}건`,
      state: mailOpsFollowUpCandidateCount > 0 ? "review" : "idle",
      detail: mailOpsFollowUpCandidateCount ? "재확인/리마인드 후보 검토" : "후속 확인 없음",
    },
    {
      id: "mobile",
      label: "휴대폰",
      value: `${mailOpsMobileHandoffCandidateCount}건`,
      state: mailOpsMobileHandoffCandidateCount > 0 ? "mobile" : "idle",
      detail: "휴대폰에서는 승인/수정/보류 의사만 받고 앱에서 최종 확인",
    },
    {
      id: "composed",
      label: "작성",
      value: `${userComposedMailApprovalRows.length}건`,
      state: userComposedMailApprovalRows.length > 0 ? "compose" : "idle",
      detail: userComposedMailApprovalRows[0]?.item.title ?? "내가 쓴 메일 점검 대기",
    },
  ] as const;
  const mailOpsGroupCount = (groupId: string) =>
    mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === groupId)?.count ?? 0;
  const visibleMailOpsOperationsGroups = mailOpsOperationsWorkbenchPlan.groups.slice(0, 1);
  const hiddenMailOpsOperationsGroups = mailOpsOperationsWorkbenchPlan.groups.slice(1);
  const mailOpsUnifiedQueueRows = [
    {
      id: "provider_inbox",
      sourceKind: "provider_read",
      label: "받은 메일",
      count: mailOpsWorkBenchRows.length,
      state: mailOpsWorkBenchRows.length ? "ready" : "idle",
      oneLine: `${mailOpsWorkBenchRows.length}건 · 답장 ${mailOpsReplyNeededRows.length} · 수정 ${mailOpsReviewNeededRows.length} · 제외 ${mailOpsExcludedRows.length}`,
      detail: mailOpsReplyNeededRows[0]?.title || mailOpsReviewNeededRows[0]?.title || mailOpsExcludedRows[0]?.title || "메일 연결 후 선별 결과가 들어옵니다.",
      nextAction: mailOpsReplyNeededRows.length ? "승인 후보 확인" : mailOpsReviewNeededRows.length ? "수정 후 승인" : "메일 읽기 연결",
      actionLabel: mailOpsWorkBenchRows.length ? "메일 행 보기" : "메일 연결",
      actionHref: mailOpsWorkBenchRows.length ? "#mailops-workbench-rows" : "/connect?recommend=company-mail&goal=메일",
      actionContract: "provider_mail_rows_to_edit_approval",
    },
    {
      id: "mobile_mail",
      sourceKind: "mobile_share_or_pwa",
      label: "휴대폰 메일",
      count: mailOpsGroupCount("mobile_handoff"),
      state: mailOpsGroupCount("mobile_handoff") ? "mobile" : "idle",
      oneLine: `${mailOpsGroupCount("mobile_handoff")}건 · 휴대폰에서 고른 메일/결정 확인`,
      detail: mailOpsOperationsWorkbenchPlan.mobileHandoff.receiveBridge.oneLineLabel,
      nextAction: "앱 승인함에서 다시 확인",
      actionLabel: "휴대폰에서 가져오기",
      actionHref: "/mail-share?from=mailops-unified",
      actionContract: "mobile_share_to_app_approval_queue",
    },
    {
      id: "user_composed",
      sourceKind: "manual_compose",
      label: "직접 작성",
      count: userComposedMailApprovalRows.length,
      state: userComposedMailApprovalRows.length ? "compose" : "idle",
      oneLine: `${userComposedMailApprovalRows.length}건 · 점검 통과 ${userComposedMailReadyCount} · 확인 필요 ${userComposedMailNeedsReviewCount}`,
      detail: userComposedMailApprovalRows[0]?.item.sourceEvidence?.messageSubject || userComposedMailApprovalRows[0]?.item.title || "작성한 메일은 보내기 전 점검으로 들어옵니다.",
      nextAction: userComposedMailNextActionLabel,
      actionLabel: userComposedMailApprovalRows.length ? "작성 메일 점검" : "작성 점검 열기",
      actionHref: "#mailops-user-composed-check",
      actionContract: "manual_compose_check_to_approval_candidate",
    },
    {
      id: "bulk_send",
      sourceKind: "recipient_list_review",
      label: "대량 발송",
      count: mailOpsBulkSendReviewPlan.candidateCount,
      state: mailOpsBulkSendReviewPlan.status === "ready_for_review"
        ? "ready"
        : mailOpsBulkSendReviewPlan.status === "needs_recipient_list"
          ? "review"
          : "idle",
      oneLine: mailOpsBulkSendReviewPlan.oneLineLabel,
      detail: mailOpsBulkSendReviewPlan.approvalGate,
      nextAction: mailOpsBulkSendReviewPlan.status === "ready_for_review" ? "샘플/제외 확인" : "명단 선택",
      actionLabel: mailOpsBulkSendReviewPlan.status === "ready_for_review" ? "대량 샘플 확인" : "명단 검토",
      actionHref: "#mailops-bulk-send-review",
      actionContract: "recipient_list_review_to_sample_final_confirmation",
    },
  ] as const;
  const mailOpsUnifiedQueueActiveCount = mailOpsUnifiedQueueRows.filter((row) => row.count > 0).length;
  const visibleMailOpsUnifiedQueueRows = mailOpsUnifiedQueueRows.slice(0, 1);
  const hiddenMailOpsUnifiedQueueRows = mailOpsUnifiedQueueRows.slice(1);
  const mailOpsSupportedWorkRows = mailOpsOperationsWorkbenchPlan.supportedWorkLabels.slice(0, 12).map((label, index) => {
    const normalizedLabel = label.replace(/\s+/gu, " ").trim();
    const state =
      /발송|수신자|계약|세무|공공|예외|첨부|반송|부재중|수신거부/u.test(normalizedLabel)
        ? "approval"
        : /휴대폰|내가 쓴|직접|대량|일정|후속/u.test(normalizedLabel)
          ? "ready"
          : "covered";
    const route =
      /휴대폰/u.test(normalizedLabel)
        ? "mobile_share_to_workbench"
        : /대량|수신자/u.test(normalizedLabel)
          ? "recipient_review_to_sample"
          : /내가 쓴|직접/u.test(normalizedLabel)
            ? "manual_compose_to_check"
            : /일정/u.test(normalizedLabel)
              ? "calendar_candidate_to_final_confirmation"
              : /계약|세무|공공|예외|첨부|반송|부재중|수신거부/u.test(normalizedLabel)
                ? "high_risk_review_gate"
                : "mailops_triage_to_approval";
    const actionHref =
      route === "mobile_share_to_workbench"
        ? "/mail-share?from=mailops-supported-work"
        : route === "recipient_review_to_sample"
          ? "#mailops-bulk-send-review"
          : route === "manual_compose_to_check"
            ? "#mailops-user-composed-check"
            : route === "calendar_candidate_to_final_confirmation"
              ? "#mailops-capability-matrix"
              : route === "high_risk_review_gate"
                ? "#mailops-exception-coverage"
                : "#mailops-workbench-rows";
    const actionLabel =
      route === "mobile_share_to_workbench"
        ? "가져오기"
        : route === "recipient_review_to_sample"
          ? "명단"
          : route === "manual_compose_to_check"
            ? "점검"
            : route === "calendar_candidate_to_final_confirmation"
              ? "일정"
              : route === "high_risk_review_gate"
                ? "예외"
                : "메일";
    const actionContract =
      route === "mobile_share_to_workbench"
        ? "supported_mobile_share_to_app_approval_queue"
        : route === "recipient_review_to_sample"
          ? "supported_recipient_review_to_sample_final_confirmation"
          : route === "manual_compose_to_check"
            ? "supported_manual_compose_to_check_final_confirmation"
            : route === "calendar_candidate_to_final_confirmation"
              ? "supported_calendar_candidate_to_capability_review"
              : route === "high_risk_review_gate"
                ? "supported_high_risk_exception_to_review_gate"
                : "supported_mailops_triage_to_workbench_rows";
    return {
      id: `supported-work-${index + 1}`,
      label: normalizedLabel,
      state,
      route,
      actionHref,
      actionLabel,
      actionContract,
      detail:
        state === "approval"
          ? "승인함과 마지막 확인을 지나야 실행합니다"
          : "한 줄 후보로 접고 필요할 때 상세를 엽니다",
    };
  });
  const visibleMailOpsSupportedWorkRows = mailOpsSupportedWorkRows.slice(0, 1);
  const hiddenMailOpsSupportedWorkRows = mailOpsSupportedWorkRows.slice(1);
  const focusedMailOpsSupportedWorkRow =
    mailOpsSupportedWorkRows.find((row) => row.route === mailOpsSupportedWorkFocusRoute) ?? null;
  const mailOpsSupportedWorkFocusLabel =
    focusedMailOpsSupportedWorkRow?.label ??
    (mailOpsSupportedWorkFocusRoute === "recipient_review_to_sample"
      ? "대량/수신자 검토"
      : mailOpsSupportedWorkFocusRoute === "manual_compose_to_check"
        ? "직접 작성 메일 점검"
        : mailOpsSupportedWorkFocusRoute === "calendar_candidate_to_final_confirmation"
          ? "일정 후보 검토"
          : mailOpsSupportedWorkFocusRoute === "high_risk_review_gate"
            ? "고위험/예외 검토"
            : mailOpsSupportedWorkFocusRoute === "mailops_triage_to_approval"
              ? "받은 메일 선별"
              : "지원 업무 선택 전");
  const mailOpsSupportedWorkFocusNext =
    mailOpsSupportedWorkFocusRoute === "recipient_review_to_sample"
      ? "명단, 제외, 샘플, 개인화 확인"
      : mailOpsSupportedWorkFocusRoute === "manual_compose_to_check"
        ? "수신자, 제목, 본문, 첨부 점검"
        : mailOpsSupportedWorkFocusRoute === "mobile_share_to_workbench"
          ? "휴대폰에서 선택한 메일 가져오기"
          : mailOpsSupportedWorkFocusRoute === "calendar_candidate_to_final_confirmation"
            ? "일정 후보와 최종 확인 경로 보기"
            : mailOpsSupportedWorkFocusRoute === "high_risk_review_gate"
              ? "계약/세무/첨부/반송 같은 예외 게이트 확인"
              : mailOpsSupportedWorkFocusRoute === "mailops_triage_to_approval"
                ? "답장, 수정, 제외 행 확인"
                : "지원 업무를 누르면 관련 작업대가 초점 표시됩니다";
  const mailOpsSupportedWorkFocusRows: MailOpsSupportedWorkFocusResultRow[] =
    mailOpsSupportedWorkFocusRoute === "recipient_review_to_sample"
      ? mailOpsBulkSendReviewPlan.checklist.slice(0, 5).map((row) => ({
          id: row.id,
          label: row.label,
          value: `${row.count}건`,
          detail: row.detail,
          state: row.state,
          actionLabel: "보기",
          actionContract: "focus_result_open_bulk_review",
          actionKind: "anchor" as const,
          actionHref: "#mailops-bulk-send-review",
        }))
      : mailOpsSupportedWorkFocusRoute === "manual_compose_to_check"
        ? userComposedMailApprovalRows.slice(0, 5).map((row) => ({
            id: row.item.id,
            label: row.ready ? "점검 통과" : row.missingCount > 0 ? "입력 필요" : "확인 필요",
            value: row.item.sourceEvidence?.messageSubject ?? row.item.title,
            detail: `${row.needsReviewCount}개 확인 · ${row.sendReviewItems.length}개 발송 점검`,
            state: row.ready ? "ready" : "review",
            actionLabel: "점검",
            actionContract: "focus_result_open_composed_mail_check",
            actionKind: "open_composed" as const,
            workItem: row.item,
          }))
        : mailOpsSupportedWorkFocusRoute === "calendar_candidate_to_final_confirmation"
          ? mailOpsCoverageRows.filter((row) => row.id === "calendar" || row.id === "follow_up").map((row) => ({
              id: row.id,
              label: row.label,
              value: row.value,
              detail: row.detail,
              state: row.state,
              actionLabel: "보기",
              actionContract: "focus_result_open_calendar_capability",
              actionKind: "anchor" as const,
              actionHref: "#mailops-capability-matrix",
            }))
          : mailOpsSupportedWorkFocusRoute === "high_risk_review_gate"
            ? mailOpsExceptionCoverageRows.filter((row) => row.highRisk || row.status === "observed").slice(0, 5).map((row) => ({
                id: row.id,
                label: row.label,
                value: row.count > 0 ? `${row.count}건` : "대기",
                detail: row.safetyGate,
                state: row.highRisk ? "approval" : row.status,
                actionLabel: "예외",
                actionContract: "focus_result_open_exception_review",
                actionKind: "anchor" as const,
                actionHref: "#mailops-exception-coverage",
              }))
            : mailOpsSupportedWorkFocusRoute === "mailops_triage_to_approval"
              ? mailOpsWorkBenchRows.slice(0, 5).map((row) => ({
                  id: row.id,
                  label: row.categoryLabel,
                  value: row.title,
                  detail: row.nextActionLabel,
                  state: row.state,
                  actionLabel: "선택",
                  actionContract: "focus_result_select_workbench_row",
                  actionKind: "select_workbench" as const,
                  workbenchRowId: row.id,
              }))
              : [];
  const visibleMailOpsSupportedWorkFocusRows = mailOpsSupportedWorkFocusRows.slice(0, 1);
  const hiddenMailOpsSupportedWorkFocusRows = mailOpsSupportedWorkFocusRows.slice(1);
  const handleOpenUserComposedMailEditor = (item: WorkItem) => {
    setEditingUserComposedMailId(item.id);
    setUserComposedMailDrafts((drafts) => ({
      ...drafts,
      [item.id]: drafts[item.id] ?? userComposedMailDraftFieldsForItem(item),
    }));
    setMailOpsWorkBenchSaveMessage("");
  };
  const handleChangeUserComposedMailDraft = (itemId: string, field: keyof UserComposedMailDraftFields, value: string) => {
    setUserComposedMailDrafts((drafts) => ({
      ...drafts,
      [itemId]: {
        ...(drafts[itemId] ?? { to: "", subject: "", body: "", attachments: "" }),
        [field]: value,
      },
    }));
  };
  const handleSaveUserComposedMailDraft = (item: WorkItem) => {
    const draft = userComposedMailDrafts[item.id] ?? userComposedMailDraftFieldsForItem(item);
    const input: UserComposedMailApprovalInput = {
      to: draft.to.replace(/\s+/gu, " ").trim(),
      subject: draft.subject.replace(/\s+/gu, " ").trim(),
      body: draft.body.replace(/\s+/gu, " ").trim(),
      attachments: draft.attachments.replace(/\s+/gu, " ").trim(),
      checkFocus: "수신자, 제목, 본문 톤, 금지 표현, 첨부 누락, 일정 등록 영향",
      receivedAt: new Date().toISOString(),
    };
    if (!input.to || !input.subject || !input.body) {
      setMailOpsWorkBenchSaveMessage("수신자, 제목, 본문을 입력해야 작성 메일을 승인 후보로 갱신할 수 있습니다.");
      return;
    }
    const updatedItem = createUserComposedMailApprovalWorkItem(input);
    upsertUserComposedMailApprovalWorkItemInStorage(updatedItem);
    setUserComposedMailOverrides((overrides) => ({ ...overrides, [item.id]: updatedItem }));
    setUserComposedMailDrafts((drafts) => ({ ...drafts, [item.id]: userComposedMailDraftFieldsForItem(updatedItem) }));
    setEditingUserComposedMailId(null);
    setMailOpsWorkBenchSaveMessage("작성 메일 수정본을 저장했고 승인 후보를 다시 점검했습니다. 실제 발송은 마지막 확인 전까지 잠겨 있습니다.");
  };
  const toggleMailOpsWorkBenchRowSelection = (rowId: string) => {
    setMailOpsSelectedWorkBenchRowIds((selected) =>
      selected.includes(rowId) ? selected.filter((id) => id !== rowId) : [...selected, rowId],
    );
    setMailOpsWorkBenchSaveMessage("");
  };
  const setAllMailOpsWorkBenchRowSelection = (selected: boolean) => {
    setMailOpsSelectedWorkBenchRowIds(selected ? mailOpsWorkBenchRows.map((row) => row.id) : []);
    setMailOpsWorkBenchSaveMessage("");
  };
  const handleOpenMailOpsWorkBenchEditor = (row: MailOpsWorkBenchRow) => {
    setMailOpsEditingWorkBenchRowId(row.id);
    setMailOpsWorkBenchDrafts((drafts) => ({
      ...drafts,
      [row.id]: drafts[row.id] ?? (row.draftPreview.startsWith("초안 없음") ? "" : row.draftPreview),
    }));
    setMailOpsWorkBenchSaveMessage("");
  };
  const handleSaveMailOpsWorkBenchDraft = (row: MailOpsWorkBenchRow) => {
    // 문단(줄바꿈)은 그대로 둡니다 — 한 줄로 붙인 채 고객에게 발송되던 문제를 막습니다.
    const revisedDraft = (mailOpsWorkBenchDrafts[row.id] ?? "").replace(/\r\n?/gu, "\n").trim().slice(0, 12000);
    if (!revisedDraft) {
      setMailOpsWorkBenchSaveMessage("수정본 본문을 입력해야 승인 후보로 넘길 수 있습니다.");
      return;
    }
    upsertMailOpsWorkQueueReviewRecord(row.sourceRecord, {
      decision: "approve",
      revisedDraft,
      note: "작업대에서 수정본 저장 후 승인 후보로 전환",
      decisionReasonSummary: "사용자가 작업대에서 본문을 수정했고 답장 발송 후보로 승인",
      sendCheckSummary: row.sendCheckSummary || "수신자, 제목, 본문, 첨부를 마지막 확인에서 재점검",
      finalConfirmationRoute: "included",
      draftBodySource: "user_revised_draft",
      updatedAt: new Date().toISOString(),
    });
    setMailOpsEditingWorkBenchRowId(null);
    setMailOpsWorkBenchSaveMessage(`${row.title} 수정본을 저장했고 승인 후보로 넘겼습니다. 실제 발송은 마지막 확인 전까지 잠겨 있습니다.`);
  };
  const handleSetMailOpsWorkBenchDecision = (row: MailOpsWorkBenchRow, decision: MailOpsWorkQueueDecision) => {
    const route: MailOpsWorkQueueFinalConfirmationRoute =
      decision === "approve" ? "included" : decision === "exclude" ? "excluded" : "held";
    const label = mailOpsWorkQueueDecisionActionLabel(decision);
    upsertMailOpsWorkQueueReviewRecord(row.sourceRecord, {
      decision,
      note:
        decision === "approve"
          ? "작업대에서 답장 보낼 메일로 변경"
          : decision === "exclude"
            ? "작업대에서 답장 안 보냄으로 변경"
            : "작업대에서 수정/확인 필요로 변경",
      decisionReasonSummary:
        decision === "approve"
          ? "사용자가 작업대에서 답장 발송 후보로 직접 변경"
          : decision === "exclude"
            ? "사용자가 작업대에서 발송 제외로 직접 변경"
            : "사용자가 작업대에서 추가 확인 뒤 다시 승인하도록 변경",
      sendCheckSummary:
        decision === "approve"
          ? "수신자, 제목, 본문, 첨부를 마지막 확인에서 재점검"
          : decision === "exclude"
            ? "답장 안 보냄으로 변경되어 실제 발송 경로에서 제외"
            : "수정/확인 뒤 다시 승인하기 전까지 실제 발송 경로에서 제외",
      finalConfirmationRoute: route,
      draftBodySource: decision === "approve" ? "review_note" : "classification",
      updatedAt: new Date().toISOString(),
    });
    setMailOpsEditingWorkBenchRowId(null);
    setMailOpsWorkBenchSaveMessage(`${row.title} 결정을 ${label}(으)로 바꿨습니다. 실제 발송은 마지막 확인 전까지 잠겨 있습니다.`);
  };
  const handleApplyMailOpsWorkBenchBulkDecision = (decision: MailOpsWorkQueueDecision) => {
    if (!mailOpsSelectedWorkBenchRows.length) {
      setMailOpsWorkBenchSaveMessage("먼저 일괄 처리할 메일을 선택하세요.");
      return;
    }
    const route: MailOpsWorkQueueFinalConfirmationRoute =
      decision === "approve" ? "included" : decision === "exclude" ? "excluded" : "held";
    const label = mailOpsWorkQueueDecisionActionLabel(decision);
    const now = new Date().toISOString();
    for (const row of mailOpsSelectedWorkBenchRows) {
      upsertMailOpsWorkQueueReviewRecord(row.sourceRecord, {
        decision,
        note:
          decision === "approve"
            ? "작업대에서 선택 항목을 답장 보낼 메일로 일괄 변경"
            : decision === "exclude"
              ? "작업대에서 선택 항목을 답장 안 보냄으로 일괄 변경"
              : "작업대에서 선택 항목을 수정/확인 필요로 일괄 변경",
        decisionReasonSummary:
          decision === "approve"
            ? "사용자가 선택한 메일을 답장 발송 후보로 일괄 변경"
            : decision === "exclude"
              ? "사용자가 선택한 메일을 발송 제외로 일괄 변경"
              : "사용자가 선택한 메일을 추가 확인 뒤 다시 승인하도록 일괄 변경",
        sendCheckSummary:
          decision === "approve"
            ? "선택 승인 항목은 수신자, 제목, 본문, 첨부를 마지막 확인에서 재점검"
            : decision === "exclude"
              ? "선택 제외 항목은 실제 발송 경로에서 제외"
              : "선택 검토 항목은 다시 승인하기 전까지 실제 발송 경로에서 제외",
        finalConfirmationRoute: route,
        draftBodySource: decision === "approve" ? "review_note" : "classification",
        updatedAt: now,
      });
    }
    setMailOpsEditingWorkBenchRowId(null);
    setMailOpsSelectedWorkBenchRowIds([]);
    setMailOpsWorkBenchSaveMessage(`선택한 ${mailOpsSelectedWorkBenchRows.length}건을 ${label}(으)로 바꿨습니다. 실제 발송은 마지막 확인 전까지 잠겨 있습니다.`);
  };
  const handlePrepareMailOpsWorkBenchFinalConfirmation = (row: MailOpsWorkBenchRow) => {
    const target = finalActionCandidates.find((item) => item.id === row.finalActionWorkItemId);
    if (!target) {
      setMailOpsWorkBenchSaveMessage(`${row.title}은 아직 마지막 확인 후보와 연결되지 않았습니다. 먼저 승인 후보를 만든 뒤 이어갈 수 있습니다.`);
      return;
    }
    setMailOpsWorkBenchSaveMessage(`${row.title} 마지막 확인 준비로 이어갑니다. 실제 발송은 마지막 확인 전까지 잠겨 있습니다.`);
    onPrepareFinalConfirmation?.(target);
  };
  const mailOpsWorkQueueEventTimeline = buildMailOpsWorkQueueEventTimeline({
    reviewSummary: mailOpsEventReviewSummary,
    candidateCount: mailCalendarActionCandidates.length,
  });
  const focusedFinalActionCandidate = finalConfirmation
    ? userComposedMailOverrides[finalConfirmation.workItemId] ??
      finalActionCandidates.find((item) => item.id === finalConfirmation.workItemId)
    : null;
  const focusedFinalDryRun =
    finalConfirmation && finalDryRunWorkItemId === finalConfirmation.workItemId ? finalDryRun : null;
  const focusedFinalExecution =
    finalConfirmation && finalExecutionWorkItemId === finalConfirmation.workItemId ? finalExecution : null;
  const focusedMemorySearchGuide = focusedFinalActionCandidate
    ? buildMemorySearchFinalActionSourceGuide(focusedFinalActionCandidate)
    : null;
  const focusedBulkRecipientListGuide = focusedFinalActionCandidate
    ? buildBulkRecipientListGuide(focusedFinalActionCandidate)
    : null;
  const focusedMailWorkReviewGuide = focusedFinalActionCandidate
    ? buildMailWorkReviewGuide(focusedFinalActionCandidate)
    : null;
  const focusedMailOpsWorkQueueReview = focusedFinalActionCandidate
    ? mailOpsWorkQueueReviewForWorkItem(focusedFinalActionCandidate, mailOpsWorkQueueReviewRecords)
    : null;
  const focusedMailOpsBatchBreakdownItems = mailOpsWorkQueueReviewRecords
    .map((record) => {
      const state = mailOpsFocusedFinalBatchState(record);
      return {
        ...record,
        state,
        routeLabel: mailOpsFocusedFinalBatchRouteLabel(state),
        decisionLabel: mailOpsWorkQueueDecisionLabel(record.decision),
        note:
          record.revisedDraft
            ? `수정본 본문: ${record.revisedDraft.replace(/\s+/gu, " ").trim().slice(0, 160)}`
            : record.note || mailOpsFocusedFinalBatchFallbackNote(state),
        decisionReasonSummary: record.decisionReasonSummary || "작업함 결정 근거를 마지막 확인에서 다시 점검합니다.",
        sendCheckSummary: record.sendCheckSummary || "수신자, 제목, 본문, 첨부, 일정 영향은 마지막 확인 전 다시 점검합니다.",
        finalConfirmationRoute: record.finalConfirmationRoute || state,
      };
    })
    .sort((left, right) => {
      const order = { included: 0, held: 1, excluded: 2 } as const;
      return order[left.state] - order[right.state];
    })
    .slice(0, 8);
  const focusedIsUserComposedMailReview = focusedFinalActionCandidate
    ? isUserComposedMailReviewItem(focusedFinalActionCandidate)
    : false;
  const focusedUserComposedMailReview =
    focusedFinalActionCandidate && focusedIsUserComposedMailReview
      ? focusedFinalActionCandidate.sourceEvidence?.userComposedMailReview
      : null;
  const focusedFinalMailSendReviewItems =
    focusedFinalActionCandidate?.finalAction?.kind === "send_email"
      ? [
          {
            id: "recipient",
            label: "수신자",
            value:
              focusedFinalActionCandidate.sourceEvidence?.replyToLabel ||
              finalConfirmation?.defaultValues?.recipient ||
              "최종 확인에서 수신자 입력 필요",
            detail: "답장 대상과 참조를 마지막으로 확인",
            state:
              focusedFinalActionCandidate.sourceEvidence?.replyToLabel || finalConfirmation?.defaultValues?.recipient
                ? "ready"
                : "review",
          },
          {
            id: "cc_bcc",
            label: "참조/숨은참조",
            value:
              finalConfirmation?.defaultHints?.cc ||
              finalConfirmation?.defaultHints?.bcc ||
              focusedFinalActionCandidate.sourceEvidence?.mailThreadLabel ||
              "참조, 숨은참조, 전체 회신 여부 확인",
            detail: "불필요한 참조와 전체 회신 위험을 마지막으로 확인",
            state:
              finalConfirmation?.defaultHints?.cc || finalConfirmation?.defaultHints?.bcc
                ? "ready"
                : "review",
          },
          {
            id: "subject",
            label: "제목",
            value:
              focusedFinalActionCandidate.sourceEvidence?.messageSubject ||
              finalConfirmation?.defaultValues?.subject ||
              focusedFinalActionCandidate.title,
            detail: "업무 목적이 드러나는지 확인",
            state: "ready",
          },
          {
            id: "body",
            label: "본문",
            value:
              focusedMailOpsWorkQueueReview?.revisedDraft ||
              focusedMailWorkReviewGuide?.draftSummary ||
              focusedFinalActionCandidate.sourceEvidence?.draftPreview ||
              focusedFinalActionCandidate.draft?.body ||
              "최종 확인에서 본문 검토 필요",
            detail: focusedMailOpsWorkQueueReview?.revisedDraft
              ? "작업함에서 수정한 본문을 최종 확인에 반영"
              : focusedMailOpsWorkQueueReview?.draftBodySource === "review_note"
                ? "작업함 수정 메모를 기준으로 본문을 다시 점검"
                : "초안/후보 본문을 최종 확인에서 재검토",
            state:
              focusedMailOpsWorkQueueReview?.revisedDraft ||
              focusedMailWorkReviewGuide?.draftSummary ||
              focusedFinalActionCandidate.sourceEvidence?.draftPreview ||
              focusedFinalActionCandidate.draft?.body
                ? "ready"
                : "review",
          },
          {
            id: "attachment",
            label: "첨부",
            value:
              focusedMailWorkReviewGuide?.attachmentSummary ||
              finalConfirmation?.defaultHints?.attachment ||
              "첨부/링크 누락 여부 확인",
            detail: "파일, 링크, 민감정보 포함 여부 확인",
            state: "review",
          },
          {
            id: "risk_language",
            label: "위험 표현",
            value:
              focusedMailOpsWorkQueueReview?.sendCheckSummary ||
              focusedMailWorkReviewGuide?.editFocusLabel ||
              focusedFinalActionCandidate.riskSignals.map((signal) => signal.label).join(" / ") ||
              "금액, 약속, 민감정보, 금지 표현 점검",
            detail: focusedMailOpsWorkQueueReview?.decisionReasonSummary || "과도한 확정 표현과 개인정보 포함 여부 확인",
            state: focusedFinalActionCandidate.riskSignals.length ? "review" : "ready",
          },
          {
            id: "calendar_side_effect",
            label: "일정 등록",
            value:
              focusedFinalActionCandidate.sourceEvidence?.calendarTimeRangeLabel ||
              focusedFinalActionCandidate.sourceEvidence?.calendarCandidateText ||
              "이 메일 확인만으로 일정 등록 없음",
            detail: "캘린더 등록이나 초대 발송은 별도 마지막 확인에서만 진행",
            state:
              focusedFinalActionCandidate.sourceEvidence?.calendarTimeRangeLabel ||
              focusedFinalActionCandidate.sourceEvidence?.calendarCandidateText
                ? "review"
                : "ready",
          },
        ]
      : [];
  const shouldShowFocusedFinalMailSendReview = focusedFinalMailSendReviewItems.length > 0;
  const focusedFinalLiveAdapterRecovery = finalConfirmation ? finalExecutionGateRecoveryPlan(finalConfirmation) : null;
  const focusedFinalExecutionHandoffItems = finalConfirmation
    ? [
        {
          id: "confirm_phrase",
          label: "확인 문구",
          title: finalConfirmation.confirmPhrase || finalConfirmation.finalExecutionGate?.confirmPhraseRequired || "최종 실행 확인",
          detail: `${finalConfirmation.requiredFields.length}개 입력값과 함께 사용자가 직접 확인`,
          state: "review",
        },
        {
          id: "dry_run",
          label: "실행 전 검토",
          title: focusedFinalDryRun ? dryRunStatusLabel(focusedFinalDryRun.status) : "검토 대기",
          detail: focusedFinalDryRun?.dryRun?.executionPlan.summary || "수신자, 제목, 본문, 첨부, 제외 기준을 먼저 점검합니다.",
          state: focusedFinalDryRun?.status === "final_action_dry_run_ready" ? "ready" : "review",
        },
        {
          id: "live_send_adapter",
          label: "전송 연결",
          title: focusedFinalLiveAdapterRecovery?.label ?? "메일 전송 준비 확인 필요",
          detail: focusedFinalLiveAdapterRecovery
            ? `${focusedFinalLiveAdapterRecovery.reason} · ${focusedFinalLiveAdapterRecovery.actionLabel} · ${focusedFinalLiveAdapterRecovery.resumeLabel}`
            : "실제 전송 전 연결과 권한을 확인합니다.",
          state: focusedFinalLiveAdapterRecovery?.state ?? "review",
        },
        {
          id: "execution_log",
          label: "실행 로그",
          title: focusedFinalExecution ? executionStatusLabel(focusedFinalExecution.status) : "실행 로그 대기",
          detail: focusedFinalExecution?.auditId
            ? `감사 기록 ${focusedFinalExecution.auditId} 기준으로 확인`
            : focusedFinalDryRun?.auditId
              ? `실행 전 검토 ${focusedFinalDryRun.auditId} 기준으로 기록`
              : "실행 요청 뒤 감사 기록과 결과를 남깁니다.",
          state: focusedFinalExecution ? "ready" : "review",
        },
        {
          id: "next_time_memory",
          label: "다음부터 이렇게",
          title: "사용자가 저장할 때만 기억",
          detail: "답장할 메일 선별, 보류/제외, 수정본 반영 기준을 다음 업무 제안으로 남깁니다.",
          state: focusedFinalExecution ? "ready" : "locked",
        },
      ]
    : [];
  const focusedFinalActionKind = focusedFinalActionCandidate?.finalAction?.kind;
  const focusedMailSendApprovalGateStatus =
    focusedFinalExecution?.finalExecutionGate?.mailSendApprovalGateStatus ||
    focusedFinalDryRun?.finalExecutionGate?.mailSendApprovalGateStatus ||
    finalConfirmation?.finalExecutionGate?.mailSendApprovalGateStatus ||
    focusedFinalActionCandidate?.finalAction?.mailSendApprovalGate?.decision ||
    "not_required";
  const focusedMailSendApprovalGatePolicy =
    focusedFinalExecution?.finalExecutionGate?.mailSendApprovalGatePolicy ||
    focusedFinalDryRun?.finalExecutionGate?.mailSendApprovalGatePolicy ||
    finalConfirmation?.finalExecutionGate?.mailSendApprovalGatePolicy ||
    focusedFinalActionCandidate?.finalAction?.mailSendApprovalGate?.policy ||
    "not_required";
  const focusedApprovedMailRunwayItems =
    finalConfirmation &&
    !focusedIsUserComposedMailReview &&
    (focusedFinalActionKind === "send_email" || focusedFinalActionKind === "send_bulk_email")
      ? [
          {
            id: "work_queue_record",
            label: "작업함 승인 기록",
            title:
              focusedMailOpsWorkQueueReview?.decision === "approve"
                ? "승인된 메일만 실행 경로"
                : focusedMailOpsWorkQueueReview
                  ? `${mailOpsWorkQueueDecisionLabel(focusedMailOpsWorkQueueReview.decision)} 항목은 실행 전 재검토`
                  : "승인 기록 확인 필요",
            detail:
              focusedMailOpsWorkQueueReview?.decisionReasonSummary ||
              "메일 선별, 답장 필요 여부, 수정 메모를 최종 확인 전에 다시 연결합니다.",
            state: focusedMailOpsWorkQueueReview?.decision === "approve" ? "ready" : "review",
          },
          {
            id: "final_confirmation",
            label: "마지막 확인",
            title: finalConfirmation.confirmPhrase || "최종 실행 확인",
            detail: "수신자, 제목, 본문, 첨부, 일정 영향 값을 사용자가 직접 확인합니다.",
            state: finalConfirmation.adapterConnected ? "ready" : "review",
          },
          {
            id: "dry_run",
            label: "실행 전 검토",
            title: focusedFinalDryRun ? dryRunStatusLabel(focusedFinalDryRun.status) : "dry-run 대기",
            detail:
              focusedFinalDryRun?.dryRun?.executionPlan.summary ||
              focusedMailOpsWorkQueueReview?.sendCheckSummary ||
              "실제 발송 전 수신자, 참조, 본문, 첨부, 제외 항목을 점검합니다.",
            state: focusedFinalDryRun?.status === "final_action_dry_run_ready" ? "ready" : "review",
          },
          {
            id: "execution_log",
            label: "실행 로그",
            title: focusedFinalExecution ? executionStatusLabel(focusedFinalExecution.status) : "최종 확인 전 로그 대기",
            detail: focusedFinalExecution?.auditId
              ? `실행 감사 기록 ${focusedFinalExecution.auditId}`
              : "승인 버튼만으로는 외부 발송하지 않고, 최종 실행 결과와 되돌리기 기준을 로그로 남깁니다.",
            state: focusedFinalExecution ? "ready" : "locked",
          },
        ]
      : [];
  const focusedUserComposedMailRunwayItems =
    finalConfirmation && focusedIsUserComposedMailReview && focusedUserComposedMailReview
      ? [
          {
            id: "check_result",
            label: "내용 점검",
            title: focusedUserComposedMailReview.readinessLabel || "작성 메일 점검",
            detail: "수신자, 제목, 본문, 첨부, 위험 표현, 일정 영향까지 먼저 확인합니다.",
            state: focusedUserComposedMailReview.reviewItems?.every((review) => review.state === "ok") ? "ready" : "review",
          },
          {
            id: "edit_suggestion",
            label: "수정 제안",
            title: "수정 후 승인 후보",
            detail: focusedUserComposedMailReview.revisionSuggestion || "필요한 수정을 반영한 뒤 승인 후보로 넘깁니다.",
            state: focusedUserComposedMailReview.reviewItems?.some((review) => review.state !== "ok") ? "review" : "ready",
          },
          {
            id: "approval_candidate",
            label: "승인 후보",
            title: "사용자가 고른 뒤에만 진행",
            detail: focusedUserComposedMailReview.approvalGate || "사용자 최종 확인 전 외부 발송 없음",
            state: "locked",
          },
          {
            id: "final_dry_run",
            label: "마지막 확인",
            title: focusedFinalDryRun ? dryRunStatusLabel(focusedFinalDryRun.status) : "실행 전 검토 대기",
            detail:
              focusedFinalDryRun?.dryRun?.executionPlan.summary ||
              "메일 연결, 수신자, 참조, 본문, 첨부를 dry-run으로 다시 확인합니다.",
            state: focusedFinalDryRun?.status === "final_action_dry_run_ready" ? "ready" : "review",
          },
          {
            id: "execution_log",
            label: "실행 로그",
            title: focusedFinalExecution ? executionStatusLabel(focusedFinalExecution.status) : "최종 확인 전 로그 대기",
            detail: focusedFinalExecution?.auditId
              ? `실행 감사 기록 ${focusedFinalExecution.auditId}`
              : "실제 발송 요청 뒤 감사 기록과 되돌리기 기준을 남깁니다.",
            state: focusedFinalExecution ? "ready" : "locked",
          },
        ]
      : [];
  const shouldShowFocusedMailOpsBatchContext =
    Boolean(focusedFinalActionCandidate) &&
    (Boolean(focusedMailOpsWorkQueueReview) || mailOpsWorkQueueReviewSummary.total > 0);
  const mailReplyCandidateCount = mailCalendarActionCandidates.filter((item) => item.finalAction?.kind === "send_email").length;
  const mailBulkCandidateCount = mailCalendarActionCandidates.filter((item) => item.finalAction?.kind === "send_bulk_email").length;
  const calendarCandidateCount = mailCalendarActionCandidates.filter((item) => item.finalAction?.kind === "create_calendar_event").length;
  const mailScenarioReviewCandidateCount = finalActionCandidates.filter((item) => item.finalAction?.kind === "scenario_review").length;
  const mailRecipientReviewCandidateCount = mailCalendarActionCandidates.filter(
    (item) => item.finalAction?.kind === "send_bulk_email" && Boolean(item.sourceEvidence?.recipientListReview),
  ).length;
  const mailOpsLoopSteps = [
    {
      id: "read_mailbox",
      label: "메일함 읽기",
      detail: mailCalendarActionCandidates.length || channelDecisions.length ? "업무 후보 수집됨" : "연결 후 시작",
      state: mailCalendarActionCandidates.length || channelDecisions.length ? "done" : "idle",
    },
    {
      id: "learn_style",
      label: "업무 방식 학습",
      detail: activeSkillSourceCount || readyIdentityCount ? "AI 팀원 기억/업무 방식 반영" : "첫 분석 대기",
      state: activeSkillSourceCount || readyIdentityCount ? "done" : "idle",
    },
    {
      id: "draft_candidates",
      label: "답장·일정 후보",
      detail: `${mailReplyCandidateCount}개 답장 · ${calendarCandidateCount}개 일정`,
      state: mailCalendarActionCandidates.length ? "active" : "idle",
    },
    {
      id: "final_approval",
      label: "승인 후 실행",
      detail: approvalWaitCount ? `${approvalWaitCount}개 확인 대기` : "외부 실행 잠금",
      state: approvalWaitCount ? "approval" : "locked",
    },
  ] as const;
  const mailConnectorRecords = connectorStatuses.filter((record) =>
    /mail|gmail|outlook|imap|smtp|inbox|exchange|company-mail/u.test(
      [
        record.category,
        record.connectorId,
        record.method,
        record.siteLabel,
        record.siteHost,
      ].filter(Boolean).join(" ").toLowerCase(),
    ),
  );
  const mailReadyForOffice = mailConnectorRecords.some((record) =>
    record.status !== "site_login_stored" && /connected|ready|loaded|stored|token_exchanged|context_ready|imap_connected|mail_loaded|verified/u.test(
      String(record.status ?? "").toLowerCase(),
    ),
  );
  const mailIssueCount = mailConnectorRecords.filter((record) =>
    record.recovery?.kind && record.recovery.kind !== "ready",
  ).length;
  const mailOpsWorkMapItems = [
    {
      id: "mail_view",
      label: "보기",
      title: "메일 업무 보기",
      detail: mailCalendarActionCandidates.length || mailScenarioReviewCandidateCount
        ? `업무 후보 ${mailCalendarActionCandidates.length + mailScenarioReviewCandidateCount}개`
        : "업무를 고르면 읽기 전용 후보 생성",
      state: mailCalendarActionCandidates.length || mailScenarioReviewCandidateCount ? "active" : "idle",
    },
    {
      id: "recipient_decision",
      label: "판단",
      title: "누구에게 보낼지",
      detail: mailRecipientReviewCandidateCount
        ? `명단/수신자 검토 ${mailRecipientReviewCandidateCount}개`
        : "받는 사람, 참조, 제외 기준 확인",
      state: mailRecipientReviewCandidateCount ? "active" : "idle",
    },
    {
      id: "bulk_mail",
      label: "대량",
      title: "대량메일 준비",
      detail: mailBulkCandidateCount
        ? `대량 발송 후보 ${mailBulkCandidateCount}개`
        : "대상표, 제외 규칙, 샘플 문안 먼저",
      state: mailBulkCandidateCount ? "approval" : "locked",
    },
    {
      id: "operational_exceptions",
      label: "예외",
      title: "반송·부재중·스레드",
      detail: "발송 실패, 자동응답, 처리 이력까지 확인",
      state: mailScenarioReviewCandidateCount || approvalWaitCount ? "active" : "idle",
    },
    {
      id: "connection_prep",
      label: "연결",
      title: "필요한 연결만",
      detail: mailReadyForOffice ? "메일 읽기 권한 확인됨" : "계정 보관함과 2차 인증은 필요할 때",
      state: mailReadyForOffice ? "ready" : mailIssueCount ? "issue" : "idle",
    },
    {
      id: "final_approval",
      label: "승인",
      title: "최종 확인함",
      detail: approvalWaitCount ? `${approvalWaitCount}개 실행 전 확인` : "발송/등록/공유 잠금 유지",
      state: approvalWaitCount ? "approval" : "locked",
    },
    {
      id: "decision_learning",
      label: "학습",
      title: "처리 방식 학습",
      detail: activeSkillSourceCount || readyIdentityCount ? "수정/승인 기준 반영" : "승인·수정 결과부터 저장",
      state: activeSkillSourceCount || readyIdentityCount ? "ready" : "idle",
    },
  ] as const;
  const mailOpsOfficeContinuity = [
    {
      id: "official",
      label: "공식 연결",
      detail: mailReadyForOffice
        ? "메일 읽기 권한 확인됨"
        : mailIssueCount
          ? `${mailIssueCount}개 연결 재점검`
          : "메일 연결 전",
      state: mailReadyForOffice ? "ready" : mailIssueCount ? "issue" : "idle",
    },
    {
      id: "vault",
      label: "계정 보관함",
      detail: credentialIssueCount ? `${credentialIssueCount}개 보안값 재저장` : "사이트 링크와 앱 위치 대기",
      state: credentialIssueCount ? "active" : mailReadyForOffice ? "ready" : "idle",
    },
    {
      id: "computer_use",
      label: "내 PC 작업 도우미 읽기",
      detail: computerUseRecoveryCount ? `${computerUseRecoveryCount}개 화면 읽기 후보` : "공식 연결이 안 될 때 대체",
      state: computerUseRecoveryCount ? "active" : "idle",
    },
    {
      id: "assistant_inbox",
      label: "오피스 승인함",
      detail: approvalWaitCount ? `${approvalWaitCount}개 승인 대기` : "후보 생기면 기본 승인함",
      state: approvalWaitCount ? "approval" : finalActionCount ? "active" : "locked",
    },
  ] as const;
  const mailOpsLoopCards = mailCalendarActionCandidates.slice(0, 3).map((item) => ({
    id: item.id,
    kind: item.finalAction?.kind ?? "send_email",
    label: finalActionLabel(item.finalAction?.kind),
    title: item.title,
    detail: item.finalAction?.blockedReason || item.summary,
    source: [
      item.sourceEvidence?.mailboxLabel || item.sourceLabel,
      item.sourceEvidence?.messageSubject,
      item.sourceEvidence?.calendarTimeRangeLabel,
    ].filter(Boolean).join(" · "),
    readiness: item.finalAction?.readiness ?? "adapter_not_connected",
    nextUserChoice: officeNextUserChoiceForWorkItem(item),
  }));
  const mailOpsApprovalAssistantQueue = mailCalendarActionCandidates.slice(0, 4).map((item) => {
    const isCalendar = item.finalAction?.kind === "create_calendar_event";
    const ownerQueueItem = channelQueueItems.find((queueItem) => queueItem.workItemId === item.id);
    const queueReview = mailOpsWorkQueueReviewForWorkItem(item, mailOpsWorkQueueReviewRecords);
    const owner = ownerQueueItem
      ? `${ownerQueueItem.teammateName} · ${ownerQueueItem.channelName}`
      : item.sourceLabel || "오피스 승인함";
    const readiness = item.finalAction?.readiness ?? "adapter_not_connected";
    const lockedReason = item.finalAction?.blockedReason || "최종 확인 전까지 외부 발송/등록은 잠겨 있습니다.";
    const preview = item.draft?.body || item.schedules?.[0]?.conflictNote || item.summary;
    const meta = [
      item.sourceEvidence?.mailWorkBundle?.bundleLabel,
      item.sourceEvidence?.messageSubject,
      item.sourceEvidence?.senderPreview,
      item.sourceEvidence?.calendarTimeRangeLabel,
      item.sourceEvidence?.calendarConflictLabel,
      ...(item.sourceEvidence?.calendarAttendeeLabels ?? []),
    ].filter(Boolean).slice(0, 5) as string[];
    return {
      id: item.id,
      kind: item.finalAction?.kind ?? "send_email",
      label: isCalendar ? "일정 후보" : "답장 후보",
      title: item.title,
      owner,
      preview,
      meta,
      readiness,
      compactSummary: `${owner} · ${readiness === "ready_for_final_confirmation" ? "마지막 확인 가능" : "연결 필요"} · ${isCalendar ? "일정" : "답장"}`,
      detailSummary: `${preview} · ${lockedReason}`,
      lockedReason,
      nextUserChoice: officeNextUserChoiceForWorkItem(item),
      queueReview,
      rail: mailOpsAssistantDecisionRail({
        isCalendar,
        readiness,
      }),
    };
  });
  const roleAssignmentSummaries = channelWorkSummaries
    .map((channel) => {
      const items = channelQueueItems.filter((item) => item.teammateId === channel.id);
      const approvalItems = items.filter((item) => item.kind === "approval");
      const runningItems = items.filter((item) => item.kind === "running");
      const latest = items[0];
      return {
        id: channel.id,
        name: channel.name,
        channelName: channel.channelName,
        teamLabel: channel.teamLabel,
        roleTitle: channel.roleTitle,
        total: items.length,
        approvalCount: approvalItems.length,
        runningCount: runningItems.length,
        latestLabel: latest?.label || channel.latestLabel,
        latestDetail: latest?.detail || channel.latestDetail,
        assignmentKinds: summarizeAssignmentKinds(items),
      };
    })
    .filter((summary) => summary.total > 0)
    .slice(0, 6);
  const memoryLearningSummaries = channelWorkSummaries
    .filter((channel) => (channel.learnedWorkCount ?? 0) > 0 || (channel.recentDecisionCount ?? 0) > 0)
    .slice(0, 6);
  const crewKitExecutionSummaries = crewMembers
    .map((member) => {
      const channel = channelWorkSummaries.find((summary) => summary.id === member.id);
      const items = channelQueueItems.filter((item) => item.teammateId === member.id);
      const crewKitItems = items.filter((item) =>
        Boolean(item.skillId || item.crewKitLabel || item.queueLabel || item.outputKind) ||
        /CrewKit|SkillGrowth|첫 실행|DelegationArtifacts|AI 팀원 결과/u.test(`${item.label} ${item.sourceLabel}`),
      );
      const latest = crewKitItems[0] ?? items[0];
      return {
        id: member.id,
        name: member.name,
        channelName: member.channelName,
        teamLabel: member.teamLabel,
        roleTitle: member.roleTitle,
        skillCount: member.skillCount,
        growthCount: member.assignedGrowthCount,
        runningCount: channel?.runningCount ?? (member.running ? 1 : 0),
        approvalCount: channel?.approvalCount ?? 0,
        queueCount: crewKitItems.length,
        label: latest?.crewKitLabel || latest?.queueLabel || latest?.label || member.latestDetail,
        detail: latest?.detail || member.latestLearnedSummary || member.latestDetail,
        outputLabel: latest?.outputKind ? outputKindLabel(latest.outputKind) : latest?.sourceLabel || "AI 팀원 기억",
        state:
          latest?.kind === "running" || member.running
            ? "running"
            : latest?.kind === "approval" || (channel?.approvalCount ?? 0) > 0
              ? "approval"
              : latest
                ? "ready"
                : "idle",
        memoryPath: member.workLogPath,
      };
    })
    .filter((summary) => summary.skillCount > 0 || summary.growthCount > 0 || summary.queueCount > 0)
    .slice(0, 6);
  const agentStateItems = [
    {
      id: "control",
      label: "메인",
      detail: officeStateLabel,
      state: runningCrewCount > 0 ? "running" : activeCrewCount > 0 ? "ready" : "idle",
    },
    {
      id: "queue",
      label: "결과",
      detail: primaryQueueItem?.queueLabel || primaryQueueItem?.label || "대기",
      state: channelApprovalCount > 0 ? "approval" : channelRunningCount > 0 ? "running" : channelResultCount > 0 ? "ready" : "idle",
    },
    {
      id: "approval",
      label: "승인",
      detail: approvalWaitCount > 0 ? `${approvalWaitCount}개 확인` : "대기",
      state: approvalWaitCount > 0 ? "approval" : "idle",
    },
  ] as const;
  const channelQueueOverviewItems = [
    {
      id: "running",
      label: "실행중",
      value: String(channelRunningCount || runningCrewCount),
      detail: primaryQueueItem?.kind === "running" ? primaryQueueItem.label : "AI 팀원 처리",
      state: channelRunningCount || runningCrewCount ? "running" : "idle",
    },
    {
      id: "approval",
      label: "승인대기",
      value: String(approvalWaitCount),
      detail: approvalWaitCount ? "발송·등록·삭제 전 확인" : "잠긴 실행 없음",
      state: approvalWaitCount ? "approval" : "idle",
    },
    {
      id: "result",
      label: "결과",
      value: String(channelResultCount),
      detail: channelResultCount ? "보고서·메일·자료 결과" : "결과 대기",
      state: channelResultCount ? "ready" : "idle",
    },
    {
      id: "growth",
      label: "도구 추천",
      value: String(growthSuggestions.length + activeSkillSourceCount),
      detail: growthSuggestions.length || activeSkillSourceCount ? "업무 도구 후보와 추천" : "필요할 때 제안",
      state: growthSuggestions.length || activeSkillSourceCount ? "growth" : "idle",
    },
  ] as const;
  const officeSceneWorkers: VirtualOfficeSceneWorker[] = crewMembers
    .filter((member) => !isMainControlChannel(member.id))
    .map((member, index) => {
      const identityText = `${member.templateId ?? ""} ${member.teamLabel} ${member.roleTitle} ${member.brief}`;
      const fallbackRoles: VirtualOfficeSceneWorker["role"][] = ["mail", "doc", "file", "approval"];
      const role: VirtualOfficeSceneWorker["role"] = /메일|문의|답장|mail|inbox/u.test(identityText)
        ? "mail"
        : /문서|보고서|마케팅|개발|document|report|marketing|development/u.test(identityText)
          ? "doc"
          : /승인|재무|법무|계약|finance|legal|approval/u.test(identityText)
            ? "approval"
            : /파일|바탕화면|자료|정리|desktop|file|memory/u.test(identityText)
              ? "file"
              : fallbackRoles[index % fallbackRoles.length];
      const memberQueueItems = channelQueueItems.filter((item) => item.teammateId === member.id);
      const memberApprovalCount = memberQueueItems.filter((item) => item.kind === "approval").length;
      const memberRunning = member.running || memberQueueItems.some((item) => item.kind === "running");
      return {
        id: `office-scene-${member.id}`,
        avatarId: member.avatarId,
        name: member.name,
        role,
        roleLabel: member.roleTitle,
        status: memberApprovalCount ? "waiting" : memberRunning ? "working" : "idle",
        queueCount: memberApprovalCount || undefined,
        statusLines: [
          member.latestDetail || (memberRunning ? "맡은 업무를 처리하고 있어요" : "새 업무를 기다리고 있어요"),
          memberQueueItems[0]?.detail || member.brief,
          "외부 실행은 마지막 확인 전까지 잠겨 있어요",
        ].filter(Boolean),
        figure: Array.from(member.name.trim())[0],
      };
    });  const officeParallelWorkContinuityItems: OfficeParallelWorkContinuityItem[] = [
    {
      id: "existing",
      label: "기존 작업",
      title: channelRunningCount || runningCrewCount ? `${channelRunningCount || runningCrewCount}개 진행 중` : "진행 작업 확인",
      detail: primaryQueueItem?.label || "오늘 업무와 진행 중인 후보를 먼저 확인합니다.",
      action: "today_check",
      href: officeHomeActionHref("today_check"),
      state: channelRunningCount || runningCrewCount ? "running" : "idle",
    },
    {
      id: "new",
      label: "추가 작업",
      title: activeCrewCount ? `${activeCrewCount}명에게 맡길 수 있음` : "담당자에게 새 요청",
      detail: channelQueueFocus?.requestText || "새 요청은 담당자나 쉬운 시작에서 따로 맡깁니다.",
      action: "workers",
      href: officeHomeActionHref("workers"),
      state: channelQueueFocus || channelRunningCount || runningCrewCount ? "ready" : "idle",
    },
    {
      id: "approval",
      label: "승인 정리",
      title: approvalWaitCount ? `${approvalWaitCount}개 승인 전 확인` : "승인 전 잠금 유지",
      detail: approvalWaitCount ? "새 요청과 기존 후보를 승인함에서 실행, 취소, 보류로 정리합니다." : "발송, 일정 등록, 파일 변경은 승인 전까지 잠급니다.",
      action: "open_office",
      href: officeHomeActionHref("open_office"),
      state: approvalWaitCount ? "approval" : "idle",
    },
  ];
  const visibleOfficeParallelWorkContinuityItems = officeParallelWorkContinuityItems.slice(0, 1);
  const hiddenOfficeParallelWorkContinuityItems = officeParallelWorkContinuityItems.slice(1);
  const isMailOpsCrewMember = (member: {
    id: string;
    name: string;
    channelName: string;
    teamLabel: string;
    roleTitle: string;
  }) => /메일|MailOps|mail/u.test(`${member.id} ${member.name} ${member.channelName} ${member.teamLabel} ${member.roleTitle}`);
  const hasMailOpsCrewMember = crewMembers.some(isMailOpsCrewMember);
  const mailOpsWorkerEvidenceActive = mailOpsEventReviewSummary.total > 0 || mailOpsEventAutomationEvidence.composedCount > 0;
  const mailOpsWorkerQueueLabel = `작업함 ${mailOpsEventReviewSummary.total}건 · 작성 메일 점검 ${mailOpsEventAutomationEvidence.composedCount}건`;
  const mailOpsWorkerStateLabel =
    mailOpsEventReviewSummary.approve > 0
      ? "승인 대기"
      : mailOpsEventReviewSummary.total > 0
        ? "점검 중"
        : "대기";
  const mailOpsWorkerNextActionLabel =
    mailOpsEventReviewSummary.approve > 0
      ? `${mailOpsEventReviewSummary.approve}건만 마지막 확인 준비`
      : mailOpsEventReviewSummary.total > 0
        ? "수정/보류/제외 결정 확인"
        : "메일 업무 기록 대기";
  const crewPresenceRows = crewMembers.map((member) => {
    const channel = channelWorkSummaries.find((summary) => summary.id === member.id);
    const items = channelQueueItems.filter((item) => item.teammateId === member.id);
    const latest = items[0];
    const mailOpsEventBacked =
      mailOpsWorkerEvidenceActive &&
      (isMailOpsCrewMember(member) || (!hasMailOpsCrewMember && isMainControlChannel(member.id)));
    const mailOpsEventBusEvidence =
      mailOpsEventBacked && channel?.latestSource === "메일 직원 작업함"
        ? `selectedWorkActionEvents:mailops-work-queue-review-${member.id}`
        : mailOpsEventBacked
          ? "local_work_queue_records_pending_event"
          : "";
    const workLoad =
      (channel?.runningCount ?? 0) +
      (channel?.approvalCount ?? 0) +
      (channel?.resultCount ?? 0);
    const state =
      mailOpsEventBacked && mailOpsEventReviewSummary.approve > 0
        ? "approval"
        : (channel?.runningCount ?? 0) > 0 || member.running
        ? "running"
        : (channel?.approvalCount ?? 0) > 0
          ? "approval"
          : workLoad > 0 || member.active || mailOpsEventBacked
            ? "ready"
            : "idle";
    return {
      id: member.id,
      name: member.name,
      templateId: member.templateId,
      channelName: member.channelName,
      teamLabel: member.teamLabel,
      roleTitle: member.roleTitle,
      brief: member.brief,
      personalityPreview: member.personalityPreview,
      state,
      stateLabel:
        mailOpsEventBacked
          ? mailOpsWorkerStateLabel
          : state === "running"
          ? "작업 중"
          : state === "approval"
            ? "승인 대기"
            : state === "ready"
              ? "대기"
              : "휴식",
      queueLabel: mailOpsEventBacked
        ? mailOpsWorkerQueueLabel
        : latest?.queueLabel || latest?.label || channel?.latestLabel || member.latestDetail,
      runningCount: channel?.runningCount ?? (member.running ? 1 : 0),
      approvalCount: (channel?.approvalCount ?? 0) + (mailOpsEventBacked ? mailOpsEventReviewSummary.approve : 0),
      resultCount: channel?.resultCount ?? 0,
      skillCount: member.skillCount,
      memoryCount: member.identityReadyCount,
      memoryTotal: member.identityFileCount,
      memoryPath: member.workLogPath,
      mailOpsEventBacked,
      mailOpsEventTotal: mailOpsEventBacked ? mailOpsEventReviewSummary.total : 0,
      mailOpsEventApproved: mailOpsEventBacked ? mailOpsEventReviewSummary.approve : 0,
      mailOpsEventComposed: mailOpsEventBacked ? mailOpsEventAutomationEvidence.composedCount : 0,
      mailOpsAutomationProof: mailOpsEventBacked ? mailOpsEventAutomationEvidence.proofLabel : "",
      mailOpsNextActionLabel: mailOpsEventBacked ? mailOpsWorkerNextActionLabel : "",
      mailOpsEventBusEvidence,
    };
  });
  const officeCustomWorkerCount = crewPresenceRows.filter((row) => row.templateId === "custom").length;
  const officeBaseWorkerCount = Math.max(crewPresenceRows.length - officeCustomWorkerCount, 0);
  const officeFocusCards = crewPresenceRows.length
    ? crewPresenceRows.map((row) => ({
        id: row.id,
        name: row.name,
        channelName: row.channelName,
        state: row.state,
        stateLabel: row.stateLabel,
        brief: row.queueLabel,
        meta: `${row.roleTitle} · 업무 도구 ${row.skillCount}`,
        memoryPath: row.memoryPath,
      }))
    : [
        {
          id: "control-empty",
          name: "메인 컨트롤",
          channelName: "앱 오피스 승인함",
          state: "ready",
          stateLabel: "대기",
          brief: "채팅에서 업무를 맡기면 담당 AI 팀원과 오피스 승인함으로 이어집니다.",
          meta: "기본 채널 · 업무 기억 준비",
          memoryPath: "memory/CrewSoul.md",
        },
      ];
  const liveHandoffItems = visibleChannelQueueItems.map((item) => {
    const channel = channelWorkSummaries.find((summary) => summary.id === item.teammateId);
    return {
      id: item.id,
      teammateId: item.teammateId,
      kind: item.kind,
      focused: focusedChannelIds.has(item.teammateId),
      teammateName: item.teammateName,
      channelName: item.channelName,
      teamLabel: item.teamLabel,
      label: item.queueLabel || item.label,
      detail: item.detail,
      sourceLabel: item.sourceLabel,
      statusLabel:
        item.kind === "running"
          ? "작업 중"
          : item.kind === "approval"
            ? "승인 대기"
            : item.kind === "growth"
              ? "업무 도구 추천"
              : item.kind === "error" ? "실패" : item.kind === "unknown" ? "상태 확인 필요" : "결과 저장",
      workload: [
        channel?.runningCount ? `작업 ${channel.runningCount}` : "",
        channel?.approvalCount ? `승인 ${channel.approvalCount}` : "",
        channel?.resultCount ? `결과 ${channel.resultCount}` : "",
      ].filter(Boolean).join(" · "),
    };
  });
  const liveChannelRailItems = liveHandoffItems.length
    ? summarizeLiveChannels(liveHandoffItems)
    : crewPresenceRows.map((row) => ({
        id: row.id,
        kind: row.state === "approval" ? "approval" : row.state === "running" ? "running" : "result",
        label: formatLiveChannelPrimaryLabel(row.id, row.name, row.channelName),
        channelName: formatLiveChannelSecondaryLabel(row.id, row.name, row.channelName, row.teamLabel),
        statusLabel: row.stateLabel,
        detail: row.queueLabel,
        focused: false,
      }));
  const officeWorkerActivityStageItems = liveHandoffItems.length
    ? liveHandoffItems.slice(0, 3).map((item) => ({
        id: item.id,
        workerId: item.teammateId,
        state: item.kind === "approval" ? "approval" : item.kind === "running" ? "running" : item.kind === "growth" ? "growth" : item.kind === "error" || item.kind === "unknown" ? "idle" : "ready",
        teamLabel: item.teamLabel,
        name: item.teammateName,
        workLabel: item.label,
        detail: item.channelName,
        statusLabel: item.statusLabel,
        source: "live_handoff",
        activeMotionAllowed: item.kind === "running",
      }))
    : crewPresenceRows.slice(0, 3).map((row) => ({
        id: row.id,
        workerId: row.id,
        state: row.state,
        teamLabel: row.teamLabel,
        name: row.name,
        workLabel: row.queueLabel || row.roleTitle,
        detail: row.channelName,
        statusLabel: row.stateLabel,
        source: "crew_presence",
        activeMotionAllowed: row.state === "running",
      }));
  const officeWorkerHubRows = crewPresenceRows.map((row) => {
    const channel = channelWorkSummaries.find((summary) => summary.id === row.id);
    return {
      id: row.id,
      name: row.name,
      channelName: row.channelName,
      teamLabel: row.teamLabel,
      state: row.state,
      stateLabel: row.stateLabel,
      queueLabel: row.queueLabel,
      runningCount: row.runningCount,
      approvalCount: row.approvalCount,
      resultCount: row.resultCount,
      memoryCount: row.memoryCount,
      memoryTotal: row.memoryTotal,
      mailOpsEventBacked: row.mailOpsEventBacked,
      mailOpsEventTotal: row.mailOpsEventTotal,
      mailOpsEventApproved: row.mailOpsEventApproved,
      mailOpsEventComposed: row.mailOpsEventComposed,
      mailOpsAutomationProof: row.mailOpsAutomationProof,
      mailOpsNextActionLabel: row.mailOpsNextActionLabel,
      mailOpsEventBusEvidence: row.mailOpsEventBusEvidence,
      crewSoulPath: channel?.crewSoulPath ?? `memory/crew-souls/${row.id}/CrewSoul.md`,
      workLogPath: channel?.workLogPath ?? row.memoryPath,
      decisionLogPath: channel?.decisionLogPath ?? `memory/crew-souls/${row.id}/DecisionLog.md`,
    };
  });
  const [selectedOfficeWorkerId, setSelectedOfficeWorkerId] = useState("");
  const preferredOfficeWorkerId =
    officeWorkerHubRows.find((row) => row.mailOpsEventBacked)?.id ?? officeWorkerHubRows[0]?.id ?? "";
  const selectedWorkerId =
    selectedOfficeWorkerId && officeWorkerHubRows.some((row) => row.id === selectedOfficeWorkerId)
      ? selectedOfficeWorkerId
      : preferredOfficeWorkerId;
  const selectedWorker = officeWorkerHubRows.find((row) => row.id === selectedWorkerId) ?? officeWorkerHubRows[0];
  const nextVisibleOfficeWorker = officeWorkerHubRows.find((row) => row.id !== selectedWorkerId);
  const visibleOfficeWorkerHubRows = officeWorkerHubRows.filter(
    (row) => row.id === selectedWorkerId || row.id === nextVisibleOfficeWorker?.id,
  );
  const hiddenOfficeWorkerHubRows = officeWorkerHubRows.filter(
    (row) => !visibleOfficeWorkerHubRows.some((visibleRow) => visibleRow.id === row.id),
  );
  const selectedWorkerQueueItems = selectedWorker
    ? visibleChannelQueueItems.filter((item) => item.teammateId === selectedWorker.id).slice(0, 5)
    : [];
  const selectedWorkerBaseLogs = selectedWorkerQueueItems.length
    ? selectedWorkerQueueItems.map((item) => ({
        id: item.id,
        state: item.kind,
        label: item.queueLabel || item.label,
        detail: item.detail,
        time: item.updatedAt,
      }))
    : selectedWorker
      ? [
          {
            id: `${selectedWorker.id}-idle`,
            state: selectedWorker.state,
            label: selectedWorker.queueLabel || "대기 중",
            detail:
              selectedWorker.state === "running"
                ? "현재 작업을 처리하고 있습니다."
                : selectedWorker.state === "approval"
                  ? "사용자 승인을 기다리고 있습니다."
                  : "새 업무가 들어오면 이 로그에 먼저 표시됩니다.",
            time: "현재",
          },
        ]
      : [];
  const selectedWorkerMailOpsLog = selectedWorker?.mailOpsEventBacked
    ? {
        id: `${selectedWorker.id}-mailops-event-evidence`,
        state: selectedWorker.mailOpsEventApproved > 0 ? "approval" : "ready",
        label: "작성 메일 점검 이벤트",
        detail: `${mailOpsWorkerQueueLabel} · 마지막 확인 전 외부 실행 없음`,
        time: "실제 이벤트",
      }
    : null;
  const selectedWorkerLogs = selectedWorkerMailOpsLog
    ? [selectedWorkerMailOpsLog, ...selectedWorkerBaseLogs].slice(0, 5)
    : selectedWorkerBaseLogs;
  const selectedWorkerLogVisibleLimit = 2;
  const visibleSelectedWorkerLogs = selectedWorkerLogs.slice(0, selectedWorkerLogVisibleLimit);
  const hiddenSelectedWorkerLogs = selectedWorkerLogs.slice(selectedWorkerLogVisibleLimit);
  const renderWorkerActivityLogItem = (item: (typeof selectedWorkerLogs)[number]) => (
    <li key={item.id} data-state={item.state}>
      <i aria-hidden="true" />
      <div>
        <strong>{item.label}</strong>
        <small>{item.detail}</small>
      </div>
      <time>{item.time}</time>
    </li>
  );
  const selectedWorkerMailOpsStatusRail = selectedWorker?.mailOpsEventBacked
    ? [
        {
          id: "triage",
          state: selectedWorker.mailOpsEventTotal > 0 ? "ready" : "idle",
          label: "받은 메일 선별",
          value: `${selectedWorker.mailOpsEventTotal}건`,
        },
        {
          id: "compose",
          state: selectedWorker.mailOpsEventComposed > 0 ? "ready" : "idle",
          label: "초안/작성 점검",
          value: `${selectedWorker.mailOpsEventComposed}건`,
        },
        {
          id: "approval",
          state: selectedWorker.mailOpsEventApproved > 0 ? "approval" : "idle",
          label: "승인 대기",
          value: `${selectedWorker.mailOpsEventApproved}건`,
        },
        {
          id: "locked",
          state: "locked",
          label: "외부 실행",
          value: "0건",
        },
      ]
    : [];
  const delegationOutcomeRows = [
    ...delegationArtifacts.slice(0, 4).map((artifact) => {
      const artifactTeammateId = artifact.rows?.find((row) => row.teammateId)?.teammateId ||
        metricText(artifact.metrics?.targetTeammateId);
      const artifactOutput = artifactOutputKind(artifact);
      return {
        id: `artifact-${artifact.id}`,
        state: artifact.approvalDecision
          ? "merged"
          : artifact.artifactKind === "approval" || artifactApprovalRequired(artifact)
            ? "approval"
            : "ready",
        label: artifactOutput ? outputKindLabel(artifactOutput) : artifactKindLabel(artifact.artifactKind),
        title: artifact.title,
        owner: artifact.teammateName || artifact.rows?.[0]?.teammateName || "메인 컨트롤",
        detail: artifact.requestText || artifact.rows?.[0]?.summary || "역할별 AI 팀원 결과",
        memoryPath: artifact.relativePath,
        workLogPath: artifactTeammateId ? `memory/crew-souls/${artifactTeammateId}/WorkLog.md` : "",
        decisionLogPath: artifactTeammateId ? `memory/crew-souls/${artifactTeammateId}/DecisionLog.md` : "",
        countLabel: `${artifact.rows?.length ?? 0}명 팀원`,
        evidenceLabel: artifactOutput === "delegated_channel_answer"
          ? "저장된 AI 팀원 결과"
          : artifactOutput ? outputKindLabel(artifactOutput) : "AI 팀원 결과 기록",
        artifact,
      };
    }),
    ...visibleChannelQueueItems
      .filter((item) => item.kind === "result" || item.kind === "approval")
      .slice(0, 3)
      .map((item) => ({
        id: `queue-${item.id}`,
        state: item.kind === "approval" ? "approval" : "ready",
        label: item.outputKind ? outputKindLabel(item.outputKind) : channelQueueKindLabel(item.kind),
        title: item.label,
        owner: `${item.teammateName} · ${item.channelName}`,
        detail: item.detail,
        memoryPath: item.memoryPath ?? item.sourceLabel,
        workLogPath: `memory/crew-souls/${item.teammateId}/WorkLog.md`,
        decisionLogPath: `memory/crew-souls/${item.teammateId}/DecisionLog.md`,
        countLabel: item.queueLabel || item.sourceLabel,
        evidenceLabel: item.outputKind === "delegated_channel_answer"
          ? "저장된 AI 팀원 결과"
          : item.outputKind ? outputKindLabel(item.outputKind) : "오피스 승인함",
        artifact: item.artifactId ? delegationArtifacts.find((artifact) => artifact.id === item.artifactId) : undefined,
      })),
  ].slice(0, 5);

  return (
    <section
      className={styles.board}
      data-office-board="today"
      data-office-board-organization="today_approval_records_archive"
      data-office-board-view={activeOfficeBoardView}
      data-office-approval-details={approvalDetailsOpen ? "open" : "closed"}
      tabIndex={-1}
      aria-label="AI 오피스 데스크 보드"
    >
      <section className={styles.officeHero} aria-label="AI 오피스 시작">
        <header className={styles.head}>
          <div>
            <h1>결과와 승인</h1>
          </div>

        </header>

        {showVirtualOfficeScene ? (
        <section
          className={styles.officeSceneStage}
          aria-label="크루가 일하는 가상 오피스"
          data-office-scene-stage="concept_v2_virtual_office_full_size"
          data-office-scene-source="created_crew_members_and_channel_queue_state"
          data-office-scene-visible="created_agents_only_dynamic_pages"
          data-office-scene-approval-count={approvalWaitCount}
          data-office-scene-external-mutation="false"
        >
          <VirtualOfficeScene
            workers={officeSceneWorkers}
            approvalCount={approvalWaitCount}
            height={360}
            onCreateWorker={() => navigateInternalPath("/?panel=workers&workerTab=create")}
            onWorkerClick={(workerId) => {
              if (onOpenCrewProfile) {
                onOpenCrewProfile(workerId.replace(/^office-scene-/u, ""));
                return;
              }
              const worker = officeSceneWorkers.find((candidate) => candidate.id === workerId);
              if (worker?.status === "waiting" || worker?.role === "approval") {
                selectOfficeBoardView("approval");
                return;
              }
              if (worker?.role === "file") {
                selectOfficeBoardView("archive");
                return;
              }
              selectOfficeBoardView("today");
            }}
          />
        </section>
        ) : null}

        <nav
          className={styles.officeBoardViewTabs}
          aria-label="업무 오피스 보기"
          data-office-board-organization="today_approval_records_archive"
          data-office-board-tab-format="today_approval_records_archive_fixed"
          data-office-board-tab-visible="base_label_only_count_detail_in_summary_folder"
          data-office-board-tab-count-default="hidden"
          data-office-board-tab-detail-default="hidden"
          data-office-board-user-config="preferred_view_per_page"
          data-office-board-view={activeOfficeBoardView}
        >
          {officeBoardViewTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`업무 오피스 ${officeBoardViewBaseLabel(item.id)} 보기 · ${item.countLabel} · ${item.detail}`}
              aria-pressed={activeOfficeBoardView === item.id}
              data-office-board-tab={item.id}
              data-office-board-tab-role={officeBoardViewBaseLabel(item.id)}
              data-office-board-tab-count={item.countLabel}
              data-active={activeOfficeBoardView === item.id ? "true" : "false"}
              onClick={() => selectOfficeBoardView(item.id)}
            >
              <span>{officeBoardViewBaseLabel(item.id)}</span>
              <strong aria-hidden="true">{item.countLabel}</strong>
              <small>
                <b>{item.label}</b>
                {" · "}
                {item.detail}
              </small>
            </button>
          ))}
        </nav>

        {activeOfficeBoardView === "approval" ? (
          <>
            <OfficeApprovalInbox
              entries={approvalInboxEntries}
              focusedKey={routeFocusedFinalActionWorkItemId ? `work:${routeFocusedFinalActionWorkItemId}` : ""}
              finalConfirmation={finalConfirmation}
              finalActionValues={finalActionValues}
              finalDryRun={finalDryRun}
              finalDryRunWorkItemId={finalDryRunWorkItemId}
              finalExecution={finalExecution}
              finalExecutionWorkItemId={finalExecutionWorkItemId}
              finalConfirmationMessage={finalConfirmationMessage}
              mailOpsDecisionMessage={mailOpsDecisionMessage}
              browserTaskActionMessage={browserTaskActionMessage}
              localFileActionMessage={localFileActionMessage}
              folderPlanActionMessage={folderPlanActionMessage}
              preparingFinalActionId={preparingFinalActionId}
              runningDryRunActionId={runningDryRunActionId}
              executingFinalActionId={executingFinalActionId}
              recordingMailOpsDecisionId={recordingMailOpsDecisionId}
              runningFolderPlanActionId={runningFolderPlanActionId}
              runningLocalFileActionId={runningLocalFileActionId}
              runningBrowserTaskActionId={runningBrowserTaskActionId}
              onPrepareFinalConfirmation={onPrepareFinalConfirmation}
              onRunFinalActionDryRun={onRunFinalActionDryRun}
              onExecuteFinalAction={onExecuteFinalAction}
              onRecordMailOpsDecision={onRecordMailOpsDecision}
              onRecordDelegationDecision={onRecordDelegationDecision}
              onRunFolderPlanAction={onRunFolderPlanAction}
              onRunLocalFileAction={onRunLocalFileAction}
              onRunBrowserTaskAction={onRunBrowserTaskAction}
              onChangeFinalActionValue={onChangeFinalActionValue}
              onRedraftMailReply={onRedraftMailReply}
              onOpenDetails={(targetLabel) => changeApprovalDetailsOpen(true, targetLabel)}
              onShowToday={() => selectOfficeBoardView("today")}
            />
            <button
              type="button"
              className={styles.approvalDetailsToggle}
              aria-expanded={approvalDetailsOpen}
              data-office-approval-details-toggle="expert_panels_folded"
              onClick={() => changeApprovalDetailsOpen(!approvalDetailsOpen)}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="m7.5 5 5 5-5 5" />
              </svg>
              <span>
                <strong>{approvalDetailsOpen ? "자세히 닫기" : "자세히 보기"}</strong>
                <small>승인 기준·실행 기록·전체 확인 카드</small>
              </span>
            </button>
          </>
        ) : null}

        <section className={styles.resultList} aria-label="업무 결과와 검토 목록">
          <div className={styles.resultHeading}><strong>검토할 결과 {pendingResults.length}건</strong><a href="/documents/">저장한 문서</a></div>
          {pendingResults.length ? <ul>{pendingResults.slice(0,showAllResults ? undefined : 6).map(item => <li key={item.id}>
            <div><strong>{item.title}</strong>
              <p className={styles.resultMeta}><span>{item.assigneeName || item.teammateName || '담당 미지정'}</span><span>{item.priority === 'urgent' ? '긴급' : item.priority === 'low' ? '낮음' : item.priority === 'normal' ? '보통' : '우선순위 미정'}</span><span>{item.status === 'draft_ready' ? '초안 준비됨' : '검토 대기'}</span></p>
            </div><a href={`/office/?officeView=approval&focusFinalActionCard=${encodeURIComponent(item.id)}`}>검토</a>
          </li>)}</ul> : <p>검토를 기다리는 결과가 없습니다.</p>}
          {pendingResults.length>6 && <button type="button" onClick={()=>setShowAllResults(value=>!value)}>{showAllResults ? '간단히 보기' : `결과 ${pendingResults.length}건 모두 보기`}</button>}
          {approvedOutputItems.length>0 && <><strong>저장된 결과</strong><ul>{approvedOutputItems.slice(0,5).map(item=><li key={item.id}><strong>{item.title}</strong><button type="button" disabled={!onOpenApprovedOutput} onClick={()=>onOpenApprovedOutput?.(item)}>열기</button></li>)}</ul></>}
          {scenarioChecks.length>0 && <details className={styles.routineChecks}><summary>운영 점검 {scenarioChecks.length}건</summary><ul>{scenarioChecks.map(item=><li key={item.id}><strong>{item.title}</strong><a href={`/office/?officeView=approval&focusFinalActionCard=${encodeURIComponent(item.id)}`}>확인</a></li>)}</ul></details>}
        </section>
        <details
          className={styles.officeLiveMonitor}
          aria-label="AI 팀원 활동 메인"
          data-worker-monitor-shell="summary_first_details_on_demand"
          data-worker-monitor-shell-default="closed"
          data-worker-monitor-shell-body="hidden_until_user_opens"
          data-worker-monitor-approval-priority="visible_before_approval_action_hub"
          data-worker-monitor-approval-default={activeOfficeBoardView === "approval" ? "open_for_approval_view" : "not_active"}
          data-worker-monitor-approval-mobile-default="open_summary_stage_compact"
          data-worker-selector-disclosure="selected_worker_one_next_then_more_inside_details"
          data-worker-selector-visible-count={visibleOfficeWorkerHubRows.length}
          data-worker-selector-hidden-count={hiddenOfficeWorkerHubRows.length}
        >
          <summary className={styles.officeLiveMonitorSummary}>
            <div>
              <span>AI 팀원 활동</span>
              <strong>{selectedWorker ? `${selectedWorker.name} · ${selectedWorker.stateLabel}` : "AI 팀원 대기"}</strong>
            </div>
            <small>
              작업 {selectedWorker?.runningCount ?? 0} · 승인 {selectedWorker?.approvalCount ?? 0}
            </small>
          </summary>
          <details
            className={styles.workerMonitorTabs}
            aria-label="AI 팀원 선택"
            data-worker-selector-fold="selected_worker_on_demand"
            data-worker-selector-fold-default="closed"
            data-worker-selector-body="hidden_until_user_opens"
          >
            <summary className={styles.workerMonitorTabsHead}>
              <span>팀원 선택</span>
              <strong>{selectedWorker ? `${selectedWorker.name} 중심` : "기본 비서 중심"}</strong>
              <small>{hiddenOfficeWorkerHubRows.length ? `${hiddenOfficeWorkerHubRows.length}명 접힘` : "나머지 없음"}</small>
            </summary>
            {officeWorkerHubRows.length ? (
              <>
                <div
                  className={styles.workerMonitorPrimaryTabs}
                  role="tablist"
                  aria-label="AI 팀원 바로 선택"
                  data-worker-selector-primary-list="selected_worker_one_next"
                >
                  {visibleOfficeWorkerHubRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      role="tab"
                      aria-selected={row.id === selectedWorkerId}
                      data-state={row.state}
                      onClick={() => setSelectedOfficeWorkerId(row.id)}
                    >
                      <WorkSignal state={row.state} label={`${row.name} 상태`} compact />
                      <span>{row.name}</span>
                      <small>{row.stateLabel}</small>
                    </button>
                  ))}
                </div>
                {hiddenOfficeWorkerHubRows.length ? (
                  <details
                    className={styles.workerMonitorMoreTabs}
                    aria-label="AI 팀원 나머지 선택"
                    data-worker-selector-more="remaining_workers_collapsed"
                    data-worker-selector-more-default="closed"
                  >
                    <summary>
                      <span>다른 팀원</span>
                      <strong>{hiddenOfficeWorkerHubRows.length}명 더 보기</strong>
                    </summary>
                    <div role="tablist" aria-label="AI 팀원 접힌 선택">
                      {hiddenOfficeWorkerHubRows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          role="tab"
                          aria-selected={row.id === selectedWorkerId}
                          data-state={row.state}
                          onClick={() => setSelectedOfficeWorkerId(row.id)}
                        >
                          <WorkSignal state={row.state} label={`${row.name} 상태`} compact />
                          <span>{row.name}</span>
                          <small>{row.stateLabel}</small>
                        </button>
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            ) : (
              <div
                className={styles.workerMonitorPrimaryTabs}
                role="tablist"
                aria-label="AI 팀원 바로 선택"
                data-worker-selector-primary-list="selected_worker_one_next"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected="true"
                  data-state="idle"
                >
                  <WorkSignal state="idle" label="기본 비서 상태" compact />
                  <span>기본 비서</span>
                  <small>대기</small>
                </button>
              </div>
            )}
          </details>

          <article
            className={styles.workerMonitorStage}
            data-state={selectedWorker?.state ?? "idle"}
            data-worker-mailops-event-backed={selectedWorker?.mailOpsEventBacked ? "true" : "false"}
            data-worker-mailops-event-total={selectedWorker?.mailOpsEventTotal ?? 0}
            data-worker-mailops-event-composed={selectedWorker?.mailOpsEventComposed ?? 0}
            data-worker-mailops-event-bus-evidence={selectedWorker?.mailOpsEventBusEvidence ?? ""}
            data-worker-mailops-event-external-mutation="false"
            aria-label="선택한 AI 팀원 활동"
          >
            <header>
              <div>
                <span>{selectedWorker?.teamLabel ?? "AI 팀원"}</span>
                <strong>{selectedWorker ? `${selectedWorker.name} · ${selectedWorker.channelName}` : "AI 팀원 대기"}</strong>
                <small>{selectedWorker?.queueLabel ?? "채팅에서 업무를 맡기면 활동이 표시됩니다."}</small>
              </div>
              <b>{selectedWorker?.stateLabel ?? "휴식"}</b>
            </header>
            <details
              className={styles.workerMonitorDetailsFold}
              aria-label="선택한 AI 팀원 활동 상세"
              data-worker-monitor-details="metrics_logs_actions_on_demand"
              data-worker-monitor-details-default="closed"
              data-worker-monitor-details-body="hidden_until_user_opens"
            >
              <summary>
                <span>활동 상세</span>
                <strong>
                  작업 {selectedWorker?.runningCount ?? 0} · 승인 {selectedWorker?.approvalCount ?? 0}
                </strong>
              </summary>
              <dl className={styles.workerMonitorMetrics}>
                <div>
                  <dt>작업 중</dt>
                  <dd>{selectedWorker?.runningCount ?? 0}</dd>
                </div>
                <div>
                  <dt>승인 대기</dt>
                  <dd>{selectedWorker?.approvalCount ?? 0}</dd>
                </div>
                <div>
                  <dt>결과</dt>
                  <dd>{selectedWorker?.resultCount ?? 0}</dd>
                </div>
                <div>
                  <dt>기억</dt>
                  <dd>{selectedWorker ? `${selectedWorker.memoryCount}/${selectedWorker.memoryTotal || "?"}` : "0"}</dd>
                </div>
              </dl>
              {selectedWorker?.mailOpsEventBacked ? (
                <section
                  className={styles.workerMailOpsEvidence}
                  aria-label="선택한 AI 직원 메일 이벤트 증거"
                  data-worker-mailops-evidence="work_queue_and_composed_mail_events"
                  data-worker-mailops-evidence-total={selectedWorker.mailOpsEventTotal}
                  data-worker-mailops-evidence-approved={selectedWorker.mailOpsEventApproved}
                  data-worker-mailops-evidence-composed={selectedWorker.mailOpsEventComposed}
                  data-worker-mailops-evidence-bus={selectedWorker.mailOpsEventBusEvidence}
                  data-worker-mailops-evidence-automation-proof={selectedWorker.mailOpsAutomationProof}
                  data-worker-mailops-evidence-external-mutation="false"
                >
                  <header>
                    <span>메일 담당자 이벤트</span>
                    <strong>{mailOpsWorkerQueueLabel}</strong>
                    <small>{selectedWorker.mailOpsNextActionLabel}</small>
                  </header>
                  <div
                    className={styles.workerMailOpsEvidenceSummary}
                    aria-label="선택한 AI 직원 메일 이벤트 한 줄 요약"
                    data-worker-mailops-evidence-summary="counts_only_details_collapsed"
                    data-worker-mailops-evidence-summary-external-mutation="false"
                  >
                    <span>요약</span>
                    <strong>
                      작업함 {selectedWorker.mailOpsEventTotal}건 · 작성 점검 {selectedWorker.mailOpsEventComposed}건 · 승인 {selectedWorker.mailOpsEventApproved}건
                    </strong>
                    <small>외부 실행 0건</small>
                  </div>
                  <details
                    className={styles.workerMailOpsEvidenceDetails}
                    aria-label="선택한 AI 직원 메일 이벤트 상세 증거"
                    data-worker-mailops-evidence-details="status_rail_counts_automation_proof_collapsed"
                    data-worker-mailops-evidence-details-external-mutation="false"
                  >
                    <summary>
                      <span>상세 보기</span>
                      <small>상태 레일 · 승인 후보 · 작성 점검 · 자동화 증거</small>
                    </summary>
                    <ol
                      className={styles.workerMailOpsStatusRail}
                      aria-label="선택한 AI 직원 메일 상태 레일"
                      data-worker-mailops-status-rail="triage_compose_check_approval_lock"
                      data-worker-mailops-status-source="selected_work_action_events"
                      data-worker-mailops-status-total={selectedWorker.mailOpsEventTotal}
                      data-worker-mailops-status-composed={selectedWorker.mailOpsEventComposed}
                      data-worker-mailops-status-approval={selectedWorker.mailOpsEventApproved}
                      data-worker-mailops-status-external-mutation="false"
                    >
                      {selectedWorkerMailOpsStatusRail.map((item) => (
                        <li key={item.id} data-state={item.state} data-status={item.id}>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </li>
                      ))}
                    </ol>
                    <dl>
                      <div>
                        <dt>승인 후보</dt>
                        <dd>{selectedWorker.mailOpsEventApproved}건</dd>
                      </div>
                      <div>
                        <dt>작성 메일</dt>
                        <dd>{selectedWorker.mailOpsEventComposed}건</dd>
                      </div>
                      <div>
                        <dt>외부 실행</dt>
                        <dd>0건</dd>
                      </div>
                    </dl>
                    <p>{selectedWorker.mailOpsAutomationProof} · 마지막 확인 전 발송 없음</p>
                  </details>
                </section>
              ) : null}
              <ol
                className={styles.workerActivityLog}
                aria-label="선택한 AI 팀원 활동 로그"
                data-worker-activity-log="recent_two_then_more_inside_details"
                data-worker-activity-log-count={selectedWorkerLogs.length}
                data-worker-activity-visible-count={visibleSelectedWorkerLogs.length}
                data-worker-activity-hidden-count={hiddenSelectedWorkerLogs.length}
                data-worker-activity-visible-limit={selectedWorkerLogVisibleLimit}
              >
                {visibleSelectedWorkerLogs.map(renderWorkerActivityLogItem)}
              </ol>
              {hiddenSelectedWorkerLogs.length ? (
                <details
                  className={styles.workerActivityMore}
                  aria-label="선택한 AI 팀원 나머지 활동 로그"
                  data-worker-activity-more="remaining_logs_collapsed"
                  data-worker-activity-more-count={hiddenSelectedWorkerLogs.length}
                  data-worker-activity-more-default="closed"
                >
                  <summary>
                    <span>나머지 기록</span>
                    <strong>{hiddenSelectedWorkerLogs.length}개 더 보기</strong>
                    <small>필요할 때만 펼칩니다</small>
                  </summary>
                  <ol className={styles.workerActivityLog} aria-label="선택한 AI 팀원 접힌 활동 로그">
                    {hiddenSelectedWorkerLogs.map(renderWorkerActivityLogItem)}
                  </ol>
                </details>
              ) : null}
              <footer>
                <button
                  type="button"
                  onClick={() => selectedWorker?.workLogPath ? onOpenMemoryFile?.(selectedWorker.workLogPath) : undefined}
                  disabled={!selectedWorker?.workLogPath || !onOpenMemoryFile}
                >
                  작업 로그
                </button>
                <button
                  type="button"
                  onClick={() => selectedWorker?.decisionLogPath ? onOpenMemoryFile?.(selectedWorker.decisionLogPath) : undefined}
                  disabled={!selectedWorker?.decisionLogPath || !onOpenMemoryFile}
                >
                  결정 기록
                </button>
              </footer>
            </details>
          </article>
        </details>

        <details
          className={styles.officeOpsSummaryFold}
          aria-label="오피스 채널 작업 요약"
          data-density="compact_status_strip"
          data-office-ops-summary-fold="counts_on_demand"
          data-office-ops-summary-default="closed"
          data-office-ops-summary-body="hidden_until_user_opens"
        >
          <summary>
            <span>실행 요약</span>
            <strong>승인 {approvalWaitCount} · 작업 {visibleWorkCount}</strong>
            <small>자세한 수치는 필요할 때</small>
          </summary>
          <dl
            className={styles.officeOpsSummary}
            data-density="compact_status_strip"
            data-office-ops-summary-grid="hidden_until_user_opens"
          >
            {channelQueueOverviewItems.map((item) => (
              <div key={`ops-summary-${item.id}`} data-state={item.state}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
                <small>{item.detail}</small>
              </div>
            ))}
          </dl>
        </details>



        <details className={styles.simpleGuide}><summary>화면 안내와 처리 기준</summary><section
          className={styles.officeMinimalAction}
          aria-label="지금 할 일"
          data-office-minimal-action={activeOfficeBoardActionHub.targetView}
        >
          <div>
            <span>{activeOfficeBoardViewTab.label}</span>
            <strong>{activeOfficeBoardActionHub.actionLabel}</strong>
          </div>
          {officeBoardPrimaryActionTargetsCurrentView && !officeBoardPrimaryActionCanFocusCurrentView ? (
            <span>확인 중</span>
          ) : (
            <button type="button" onClick={handleOfficeBoardPrimaryAction}>
              열기
            </button>
          )}
        </section>
<section
          className={styles.officeBoardFocusSummary}
          aria-label="업무 오피스 보기별 한눈에 보기"
          data-office-board-focus-summary="active_view_first_then_other_views_on_demand"
          data-office-board-view={activeOfficeBoardView}
          data-active-view-count={activeOfficeBoardFocusCard.countLabel}
          data-other-view-disclosure="one_next_view_then_more_inside_details"
          data-other-view-visible-count={visibleOtherOfficeBoardFocusCards.length}
          data-other-view-hidden-count={hiddenOtherOfficeBoardFocusCards.length}
        >
          <article
            aria-label={`현재 상태 · ${activeOfficeBoardFocusCard.label} · ${activeOfficeBoardFocusCard.title}`}
            data-state={activeOfficeBoardFocusCard.state}
            data-view={activeOfficeBoardFocusCard.view}
          >
            <span>{activeOfficeBoardFocusCard.label} · {activeOfficeBoardFocusCard.countLabel}</span>
            <strong>{activeOfficeBoardFocusCard.title}</strong>
          </article>
          {activeOfficeBoardView !== "today" ? (
            <button
              type="button"
              className={styles.officeBoardTodayReset}
              aria-label="오늘 보기"
              data-office-board-view-reset="today_visible_mobile"
              onClick={() => selectOfficeBoardView("today")}
            >
              <span>기본 보기</span>
              <strong>오늘 보기</strong>
              <small>상세를 열지 않고 오늘 업무로 돌아갑니다.</small>
            </button>
          ) : null}
          <details
            className={styles.officeBoardOtherViewsFold}
            aria-label="업무 오피스 다른 보기 접힘"
            data-office-board-other-views-fold="all_other_views_on_demand"
            data-office-board-other-views-default="closed"
            data-office-board-other-views-body="hidden_until_user_opens"
          >
            <summary>
              <span>다른 보기</span>
              <strong>{visibleOtherOfficeBoardFocusCards.length + hiddenOtherOfficeBoardFocusCards.length}개</strong>
            </summary>
            <div className={styles.officeBoardOtherViewRail} aria-label="업무 오피스 다른 보기 요약">
              <ol
                className={styles.officeBoardOtherViewList}
                aria-label="업무 오피스 바로 갈 다른 보기"
                data-office-board-other-view-list="one_next_view"
              >
                {visibleOtherOfficeBoardFocusCards.map((item) => (
                  <li key={item.id} data-state={item.state}>
                    <button type="button" onClick={() => selectOfficeBoardView(item.view)}>
                      <span>{item.label}</span>
                      <strong>{item.countLabel}</strong>
                      <small>{item.actionLabel}</small>
                    </button>
                  </li>
                ))}
              </ol>
              {hiddenOtherOfficeBoardFocusCards.length ? (
                <details
                  className={styles.officeBoardFocusMore}
                  aria-label="업무 오피스 나머지 보기"
                  data-office-board-other-views-more="remaining_views_collapsed"
                  data-office-board-other-views-more-default="closed"
                >
                  <summary>
                    <span>나머지 보기</span>
                    <strong>{hiddenOtherOfficeBoardFocusCards.length}개 접힘</strong>
                  </summary>
                  <ol>
                    {hiddenOtherOfficeBoardFocusCards.map((item) => (
                      <li key={item.id} data-state={item.state}>
                        <button type="button" onClick={() => selectOfficeBoardView(item.view)}>
                          <span>{item.label}</span>
                          <strong>{item.countLabel}</strong>
                          <small>{item.actionLabel}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </div>
          </details>
        </section>
<section
          className={styles.officeBoardActionHub}
          aria-label="업무 오피스 지금 볼 것"
          data-office-board-action-hub="active_view_summary_folded_details_next_action"
          data-office-board-action-hub-visible="lead_primary_button_details_closed"
          data-office-board-view={activeOfficeBoardView}
          data-office-board-action-target={activeOfficeBoardActionHub.targetView}
          data-office-board-action-step-count={officeBoardActionHubRows.length}
          data-office-board-action-step-visible-count="0"
          data-office-board-action-step-hidden-count={officeBoardActionHubRows.length}
          data-office-board-folded-detail-count={
            activeOfficeBoardView === "approval"
              ? finalActionCount + approvalWorkItems.length
              : activeOfficeBoardView === "records"
                ? executionLogCount
                : hiddenDeskCount + skillSources.length + identityFiles.length + executionLogCount
          }
        >
          <div className={styles.officeBoardActionHubLead}>
            <span>지금 볼 것</span>
            <strong>{activeOfficeBoardActionHub.actionLabel}</strong>
          </div>
          <details
            className={styles.officeBoardActionHubDetails}
            aria-label="업무 오피스 접힌 상세 묶음"
            data-office-board-action-details="folded_counts_and_destinations"
            data-office-board-action-details-default="closed"
            data-office-board-action-steps="all_steps_inside_details"
          >
            <summary>
              <span>접힌 상세</span>
              <strong>다른 보기와 안내</strong>
            </summary>
            <ol aria-label="업무 오피스 현재 보기 정리">
              {officeBoardActionHubRows.map((item) => (
                <li key={item.id} data-state={item.state} data-office-board-action-step={item.id}>
                  <span>{item.label}</span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </li>
              ))}
            </ol>
            <ul>
              <li>
                <span>승인</span>
                <strong>{approvalWaitCount}건</strong>
                <small>실행 전 확인 탭</small>
              </li>
              <li>
                <span>기록</span>
                <strong>{executionLogCount}건</strong>
                <small>결정과 로그 탭</small>
              </li>
              <li>
                <span>보관</span>
                <strong>{hiddenDeskCount + skillSources.length + identityFiles.length}개</strong>
                <small>설정과 자료 탭</small>
              </li>
            </ul>
          </details>
          <div
            className={styles.officeBoardPrimaryAction}
            data-office-board-primary-action="one_button_first_detail_folded"
            data-office-board-primary-action-target={activeOfficeBoardActionHub.targetView}
            data-office-board-primary-action-current={officeBoardPrimaryActionTargetsCurrentView ? "true" : "false"}
            data-office-board-primary-action-detail="why_visible_counts_folded"
          >
            <span>
              {officeBoardPrimaryActionTargetsCurrentView && !officeBoardPrimaryActionCanFocusCurrentView
                ? "현재 상태"
                : "지금 누를 버튼"}
            </span>
            {officeBoardPrimaryActionTargetsCurrentView && !officeBoardPrimaryActionCanFocusCurrentView ? (
              <strong>현재 화면에서 확인 중</strong>
            ) : (
              <button type="button" onClick={handleOfficeBoardPrimaryAction}>
                {activeOfficeBoardActionHub.actionLabel}
              </button>
            )}
          </div>
        </section>
<details
          className={styles.officeBoardFolderMap}
          aria-label="업무 오피스 폴더 지도"
          data-office-board-folder-map="today_approval_records_archive_slots"
          data-office-board-folder-map-visible="summary_first_folder_slots_on_demand"
          data-office-board-folder-map-format="fixed_tabs_user_start_view"
          data-office-board-folder-map-default="closed"
          data-office-board-layout-guide-placement="inside_folder_map"
          data-office-board-view={activeOfficeBoardView}
        >
          <summary>
            <span>화면 안내</span>
            <strong>탭 구성</strong>
            <small>필요할 때 열기</small>
          </summary>
          <div
            className={styles.officeBoardLayoutGuide}
            data-office-board-customization="preferred_view_reset"
            data-page-layout-format="fixed_tabs_user_start_view"
            data-office-board-view={activeOfficeBoardView}
            data-office-board-scope={activeOfficeBoardViewSummary.scope}
            data-custom-layout={activeOfficeBoardView === "today" ? "false" : "true"}
            data-preferred-view-state={activeOfficeBoardView === "today" ? "default" : "custom"}
            aria-label="업무 오피스 페이지 내 구성"
          >
            <div>
              <span>내 시작 화면</span>
              <strong>{activeOfficeBoardViewSummary.title}</strong>
              <small>{activeOfficeBoardViewSummary.detail} · 탭 포맷은 유지하고 시작 화면만 바꿉니다.</small>
            </div>
            <p>{activeOfficeBoardView === "today" ? `${activeOfficeBoardViewTab.countLabel} · 기본 보기` : "현재 보기가 저장됨"}</p>
            <button
              type="button"
              onClick={() => selectOfficeBoardView("today")}
              disabled={activeOfficeBoardView === "today"}
            >
              오늘 보기
            </button>
          </div>
          <ol aria-label="업무 오피스 정보 폴더">
            {officeBoardFolderMapItems.map((item) => (
              <li
                key={item.id}
                data-state={item.state}
                data-active={activeOfficeBoardView === item.id ? "true" : "false"}
                data-office-board-folder-slot={item.id}
              >
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <small>{item.countLabel}</small>
              </li>
            ))}
          </ol>
          <details
            className={styles.officeBoardFolderMapDetails}
            aria-label="업무 오피스 폴더 상세 기준"
            data-office-board-folder-map-details="section_destinations_collapsed"
            data-office-board-folder-map-details-default="closed"
          >
            <summary>
              <span>정리 기준</span>
              <strong>같은 포맷 안에서 시작 보기만 바꿉니다</strong>
            </summary>
            <dl>
              {officeBoardFolderMapItems.map((item) => (
                <div key={`folder-map-detail-${item.id}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.detail}</dd>
                </div>
              ))}
            </dl>
          </details>
        </details>
<section
          className={styles.officeWorkerActivityStage}
          aria-label="오피스 AI 팀원 활동 스테이지"
          data-office-worker-activity-stage="state_backed_worker_motion_board"
          data-office-worker-activity-stage-source={liveHandoffItems.length ? "live_handoff_items" : "crew_presence_rows"}
          data-office-worker-activity-stage-motion="active_states_only"
          data-office-worker-activity-display-order="base_custom_current_work_approval_lock"
          data-office-worker-activity-visual-language="same_as_worker_companion"
          data-office-worker-activity-approval-mobile="identity_current_work_approval_lock_compact"
          data-office-worker-activity-stage-external-mutation="false"
        >
          <header>
            <div>
              <span>AI 팀원 활동</span>
              <strong>{primaryQueueItem ? `${primaryQueueItem.teammateName} · ${channelQueueKindLabel(primaryQueueItem.kind)}` : "AI 팀원 대기"}</strong>
            </div>
            <small>{officeWorkerActivityStageItems.length ? `${officeWorkerActivityStageItems.length}명 표시` : "채팅에서 맡기면 표시"}</small>
          </header>
          <section
            className={styles.officeWorkerActivityIdentityRail}
            aria-label="오피스 직원 활동 표시 기준"
            data-office-worker-activity-identity-rail="base_custom_current_work_approval_lock"
            data-office-worker-activity-identity-visible="base_custom_current_work_approval_lock"
            data-office-worker-activity-identity-hidden="settings_templates_diagnostics"
            data-office-worker-activity-base-count={officeBaseWorkerCount}
            data-office-worker-activity-custom-count={officeCustomWorkerCount}
            data-office-worker-activity-final-boundary="approval_before_external_mutation"
            data-office-worker-activity-external-mutation="false"
          >
            <article data-kind="worker_type" data-state={officeCustomWorkerCount ? "custom" : "base"}>
              <span>직원 유형</span>
              <strong>기본 {officeBaseWorkerCount} · 꾸미기 {officeCustomWorkerCount}</strong>
            </article>
            <article data-kind="current_work" data-state={primaryQueueItem?.kind === "running" ? "running" : primaryQueueItem?.kind === "approval" ? "approval" : primaryQueueItem?.kind === "result" || primaryQueueItem?.kind === "growth" ? "ready" : officeWorkerActivityStageItems[0]?.state ?? "idle"}>
              <span>현재 업무</span>
              <strong>{primaryQueueItem?.label ?? officeWorkerActivityStageItems[0]?.workLabel ?? "맡긴 일 대기"}</strong>
            </article>
            <article data-kind="approval_lock" data-state={approvalWaitCount ? "approval" : "locked"}>
              <span>승인 잠금</span>
              <strong>{approvalWaitCount ? `${approvalWaitCount}건 승인 대기` : "외부 실행 잠금"}</strong>
            </article>
            <article data-kind="next_check" data-state={approvalWaitCount ? "approval" : "ready"}>
              <span>다음 확인</span>
              <strong>{approvalWaitCount ? "승인함에서 결정" : "결과 확인부터"}</strong>
            </article>
          </section>
          <section
            className={styles.officeWorkerActivityCompanionRail}
            aria-label="오피스 직원 일하는 모습 연결"
            data-office-worker-activity-companion-rail="small_window_desktop_overlay_status_first"
            data-office-worker-activity-companion-visible="app_preview_desktop_overlay_current_work"
            data-office-worker-activity-companion-hidden="position_size_character_settings_until_support_open"
            data-office-worker-activity-companion-action="open_worker_companion"
            data-office-worker-activity-companion-display="base_custom_workers_optional_desktop_overlay"
            data-office-worker-activity-companion-current-window="work_status_not_settings"
            data-office-worker-activity-companion-user-language="working_view_not_small_window_label"
            data-office-worker-activity-companion-final-boundary="approval_before_external_mutation"
            data-office-worker-activity-companion-external-mutation="false"
          >
            <article data-kind="app_preview" data-state={selectedWorker ? selectedWorker.state : "idle"}>
              <span>앱 안 미리보기</span>
              <strong>{selectedWorker ? `${selectedWorker.name} 상태판` : "기본 직원 상태판"}</strong>
            </article>
            <article data-kind="desktop_overlay" data-state={onOpenWorkerCompanion ? "ready" : "locked"}>
              <span>바탕화면 일하는 모습</span>
              <strong>{onOpenWorkerCompanion ? "설치 앱에서 열기" : "설치 앱 필요"}</strong>
            </article>
            <button
              type="button"
              data-kind="open_companion"
              data-office-worker-activity-companion-button="true"
              onClick={() => void onOpenWorkerCompanion?.()}
              disabled={!onOpenWorkerCompanion}
            >
              <span>일하는 모습</span>
              <strong>일하는 모습 보기</strong>
              <small>설정·꾸미기는 필요할 때</small>
            </button>
          </section>
          <ol
            className={styles.officeWorkerActivityDecisionPath}
            aria-label="오피스 직원 활동 공통 결정 순서"
            data-office-worker-activity-decision-path="result_confirm_decide_log_remember"
            data-office-worker-activity-decision-language="same_as_mail_document_approval"
            data-office-worker-activity-decision-actions="execute_request_change_hold"
            data-office-worker-activity-decision-record="execution_log_and_manual_memory"
            data-office-worker-activity-decision-final-boundary="approval_before_external_mutation"
          >
            <li data-step="result_confirm">
              <span>결과 확인</span>
              <strong>직원이 올린 결과</strong>
            </li>
            <li data-step="decision">
              <span>결정</span>
              <strong>{officeDecisionActionLabels}</strong>
            </li>
            <li data-step="execution_log">
              <span>실행 로그</span>
              <strong>기록 위치 확인</strong>
            </li>
            <li data-step="manual_memory">
              <span>다음부터 이렇게</span>
              <strong>원할 때만 저장</strong>
            </li>
          </ol>
          <div>
            {officeWorkerActivityStageItems.map((item) => (
              <button
                key={`office-worker-stage-${item.id}`}
                type="button"
                data-state={item.state}
                data-active-motion={item.activeMotionAllowed ? "true" : "false"}
                data-office-worker-stage-source={item.source}
                data-office-worker-stage-external-mutation="false"
                onClick={() => {
                  const match = officeWorkerHubRows.find((row) => row.id === item.workerId || row.name === item.name);
                  if (match) setSelectedOfficeWorkerId(match.id);
                }}
                aria-label={`${item.name} 오피스 활동 보기`}
              >
                <i aria-hidden="true">{item.teamLabel.slice(0, 1).toUpperCase()}</i>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.workLabel}</small>
                </span>
                <em>{item.statusLabel}</em>
                <b aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
<section
          className={styles.approvalSafetyRail}
          aria-label="승인 안전 요약"
          data-safety-contract="approval_queue_guardrail"
          data-high-risk-policy="draft_preview_only_until_final_confirmation"
          data-approval-queue-contract="risk_preview_decision_log_rollback"
          data-final-action-contract="external_mutation_requires_user_final_confirmation"
          data-final-confirmation-policy="required_before_external_mutation"
          data-rollback-policy="guide_required_when_mutation_possible"
          data-risk-level={highestApprovalRisk}
          data-approval-count={approvalWaitCount}
          data-preview-count={previewCandidateCount}
          data-mutation-count={mutationCandidateCount}
          data-rollback-count={rollbackGuideCount}
          data-execution-log-count={executionLogCount}
          data-decision-options="approve_cancel_change_hold"
          data-user-decision-options="approve_cancel_change_hold"
          data-user-decision-labels="run_change_hold_remember"
          data-office-approval-safety-layout="worker_result_primary_decision_then_safety_details_folded"
          data-office-approval-first-priority="worker_result_to_primary_decision_before_safety_text"
          data-office-approval-first-screen="worker_result_now_decision_record_then_details"
          data-office-approval-support-default="safety_copy_settings_history_after_decision"
          data-office-approval-mobile-support-default="today_decision_deck_only_support_summaries_folded"
          data-office-approval-view-mobile-support="decision_topbar_compact_support_summaries_folded"
          data-office-approval-view-mobile-order="worker_status_then_decision_deck_before_scene"
          data-modycrew-core-components="work_row_worker_status_strip_approval_decision_rail_details_fold"
          data-modycrew-core-component-language="approval_worker_result_decision_details_same_order"
        >
          <header>
            <div>
              <span>직원이 올린 승인함</span>
              <strong>{approvalWaitCount ? `${approvalWaitCount}개 결과 확인` : "직원 결과 대기"}</strong>
            </div>
            <small>직원 결과를 보고 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다.</small>
          </header>
          <section
            className={styles.approvalDecisionDeck}
            aria-label="오피스 승인함 결정 작업대"
            data-office-approval-decision-deck="worker_result_three_choices_first"
            data-office-approval-decision-workbench="worker_result_execute_change_hold_first"
            data-office-approval-decision-visible="worker_result_three_choices_small_window"
            data-office-approval-decision-hidden="worker_path_safety_logs_memory_until_detail"
            data-office-approval-decision-current-window="work_status_not_settings"
            data-office-approval-decision-deck-visible="worker_result_now_then_run_change_hold"
            data-office-approval-decision-deck-support="handoff_path_safety_after_decision_deck"
            data-office-approval-decision-deck-hidden="diagnostics_settings_templates_history_until_details"
            data-office-approval-visible-now="worker_result_working_view_three_choices"
            data-office-approval-support-rails="decision_path_after_choice_first_flow_log_memory_hidden_until_choice"
            data-office-approval-decision-deck-final-boundary="approval_before_external_mutation"
          >
            <section
              className={styles.approvalDecisionDeskRail}
              aria-label="오피스 승인함 첫 화면 결정 책상"
              data-office-approval-decision-desk="worker_result_three_choices_working_view"
              data-office-approval-decision-desk-visible="worker_result_working_view_run_change_hold"
              data-office-approval-decision-desk-hidden="execution_log_manual_memory_diagnostics_settings_templates_history_until_choice"
              data-office-approval-decision-desk-order="worker_result_working_view_decision_then_details"
              data-office-approval-decision-desk-source="primaryQueueItem_approvalWaitCount_executionLogCount"
              data-office-approval-decision-desk-companion="status_only_open_working_view"
              data-office-approval-decision-desk-current-window="work_status_not_settings"
              data-office-approval-decision-desk-visible-order="worker_result|working_view|run_change_hold"
              data-office-approval-decision-desk-final-boundary="approval_before_external_mutation"
              data-office-approval-decision-desk-external-mutation="false"
            >
              <ol>
                <li data-step="worker_result" data-state={primaryQueueItem ? "ready" : approvalWaitCount ? "approval" : "idle"}>
                  <span>직원 결과</span>
                  <strong>{primaryQueueItem?.label ?? (approvalWaitCount ? `${approvalWaitCount}개 대기` : "결과 대기")}</strong>
                  <small>{primaryQueueItem?.teammateName ?? "메일·문서 직원"}</small>
                </li>
                <li data-step="small_window" data-state={onOpenWorkerCompanion ? "ready" : "preview"}>
                  <span>일하는 모습</span>
                  <strong>현재 업무 상태</strong>
                  <small>직원 상태만 확인</small>
                </li>
                <li data-step="decision" data-state={approvalWaitCount ? "approval" : "locked"}>
                  <span>세 결정</span>
                  <strong>{officeDecisionActionLabels}</strong>
                  <small>외부 실행 전 확인</small>
                </li>
                <li data-step="execution_log" data-state={executionLogCount ? "ready" : "locked"}>
                  <span>실행 로그</span>
                  <strong>{executionLogCount ? `${executionLogCount}건 기록` : "결정 뒤 기록"}</strong>
                  <small>감사 기록</small>
                </li>
                <li data-step="manual_memory" data-state="locked">
                  <span>기억</span>
                  <strong>{officeDecisionMemoryLabel}</strong>
                  <small>사용자 선택 때만</small>
                </li>
              </ol>
              <div role="group" aria-label="오피스 승인함 첫 화면 바로가기">
                <a href={officeHomeActionHref("open_office")} data-office-approval-decision-desk-action="choose_decision">
                  결정하기
                </a>
                <button
                  type="button"
                  onClick={() => void onOpenWorkerCompanion?.()}
                  disabled={!onOpenWorkerCompanion}
                  data-office-approval-decision-desk-action="open_small_window"
                >
                  일하는 모습
                </button>
                <a href={officeHomeActionHref("open_office")} data-office-approval-decision-desk-action="open_log_memory">
                  로그·기억
                </a>
              </div>
            </section>
            <section
              className={styles.approvalDecisionTopBar}
              aria-label="오피스 승인함 첫 결정 바"
              data-office-approval-top-decision-bar="worker_result_three_choices_small_window_lock"
              data-office-approval-top-decision-visible="one_result_working_view_run_change_hold"
              data-office-approval-top-decision-hidden="handoff_path_safety_settings_logs_until_details"
              data-office-approval-top-decision-source="primaryQueueItem_approvalWaitCount_worker_companion"
              data-office-approval-top-decision-current-window="work_status_not_settings"
              data-office-approval-top-decision-final-boundary="approval_before_external_mutation"
              data-office-approval-top-decision-external-mutation="false"
            >
              <article data-kind="result" data-state={primaryQueueItem ? "ready" : approvalWaitCount ? "approval" : "idle"}>
                <span>이번 결과</span>
                <strong>{primaryQueueItem?.label ?? (approvalWaitCount ? `${approvalWaitCount}개 결과 확인` : "결과 대기")}</strong>
                <small>{primaryQueueItem?.teammateName ?? "메일·문서 담당 직원"}</small>
              </article>
              <button
                type="button"
                aria-label="승인함에서 직원 일하는 모습 보기"
                data-office-approval-top-decision-action="open_worker_companion"
                onClick={() => void onOpenWorkerCompanion?.()}
                disabled={!onOpenWorkerCompanion}
              >
                <span>일하는 모습</span>
                <strong>일하는 모습 보기</strong>
                <small>일하는 모습 확인</small>
              </button>
              <article data-kind="decision" data-state={approvalWaitCount ? "approval" : "locked"}>
                <span>바로 결정</span>
                <strong>{officeDecisionActionLabels}</strong>
                <small>실행 전 마지막 확인</small>
              </article>
              <article data-kind="lock" data-state="locked">
                <span>잠금</span>
                <strong>승인 전 외부 실행 없음</strong>
                <small>발송·저장·공유 잠금</small>
              </article>
            </section>
            <section
              className={styles.approvalWorkerNowRail}
              aria-label="승인함 직원 결과 지금 처리"
              data-office-worker-result-now="mail_document_worker_decision_first"
              data-office-worker-result-now-source="approval_queue_items_and_worker_results"
              data-office-worker-result-now-actions="execute_request_change_hold"
              data-office-worker-result-now-final-boundary="approval_before_external_mutation"
              data-office-worker-result-now-record="office_worker_log_and_manual_memory"
              data-office-worker-result-decision-path="result_decide_log_remember"
              data-office-worker-result-decision-language="mail_document_same_order"
              data-office-worker-result-visible-order="result_confirm|run_change_hold"
              data-office-worker-result-first-screen="result_decision_record_memory_then_details"
              data-office-worker-result-visible-now="worker_result_decision_only"
              data-office-worker-result-support-default="decision_path_record_logs_memory_hidden_until_choice"
              data-office-worker-result-now-display="decision_first_result_only"
            >
              <div
                className={styles.approvalWorkerDecisionPath}
                aria-label="승인함 직원 결과 공통 결정 순서"
                data-office-worker-result-compact-path="result_confirm_decide_log_remember"
                data-office-worker-result-visible-language="result_confirm_decision_execution_log_manual_memory"
                data-office-worker-result-hidden-work="diagnostics_settings_templates_after_decision"
                data-office-worker-result-support-default="diagnostics_settings_templates_hidden_until_needed"
              >
                <b>결과 확인</b>
                <b>결정</b>
                <b>실행 로그</b>
                <b>다음부터 이렇게</b>
              </div>
              <article data-kind="worker_result" data-state={primaryQueueItem ? "ready" : approvalWaitCount ? "approval" : "idle"}>
                <span>직원 결과</span>
                <strong>{primaryQueueItem?.label ?? (approvalWaitCount ? `${approvalWaitCount}개 결과` : "메일·문서 후보 대기")}</strong>
                <small>{primaryQueueItem?.teammateName ?? "메일·문서·승인 담당 직원"}</small>
              </article>
              <article data-kind="decision" data-state={approvalWaitCount ? "approval" : "locked"}>
                <span>지금 결정</span>
                <strong>{officeDecisionActionLabels}</strong>
                <small>실행하기 전 확인</small>
              </article>
              <article data-kind="record" data-state={executionLogCount ? "ready" : "locked"}>
                <span>기록</span>
                <strong>실행 로그 · 다음부터 이렇게</strong>
                <small>원할 때만 기억</small>
              </article>
            </section>
            <section
              className={styles.approvalPrimaryCheckpoint}
              aria-label="오피스 승인함 지금 할 일"
              data-office-visible-priority="choose_run_change_hold_then_log_remember"
              data-first-visible-action={officeDecisionActionLabels}
              data-next-visible-action="실행 로그 확인"
              data-remember-visible-action={officeDecisionMemoryLabel}
              data-final-action-lock="required_before_external_mutation"
              data-first-three-minute-handoff="prompt_next_approval_log_remember"
              data-office-finish-rhythm="run_change_hold_log_rollback_remember"
              data-office-primary-choice-count="3"
              data-office-primary-choice-target="approval_card_decision_buttons"
            >
              <div>
                <span>지금 할 일</span>
                <strong>{officeDecisionActionLabels}</strong>
              </div>
              <div
                className={styles.approvalDecisionChoiceRail}
                aria-label="오피스 승인함 세 결정 선택지"
                data-office-approval-primary-decision="run_change_hold_first"
                data-office-approval-primary-decision-visible="three_choices_before_log_memory"
                data-office-approval-primary-decision-hidden="execution_log_memory_settings_after_choice"
                data-office-approval-primary-decision-final-boundary="final_confirmation_before_external_mutation"
                data-office-approval-primary-decision-external-mutation="false"
                data-office-approval-primary-decision-target="approval_card_decision_buttons"
              >
                <a href={officeHomeActionHref("open_office")} data-decision-choice="run">
                  <span>실행하기</span>
                  <small>최종 확인으로</small>
                </a>
                <a href={officeHomeActionHref("open_office")} data-decision-choice="change">
                  <span>고쳐달라고 하기</span>
                  <small>직원에게 되돌림</small>
                </a>
                <a href={officeHomeActionHref("open_office")} data-decision-choice="hold">
                  <span>보류하기</span>
                  <small>실행 없이 기록</small>
                </a>
              </div>
              <section
                className={styles.approvalDecisionAfterChoicePreview}
                aria-label="오피스 승인함 결정 후 다음 확인"
                data-office-approval-after-choice-preview="decision_to_final_check_log_memory"
                data-office-approval-after-choice-preview-visible="final_check_log_rollback_memory_summary"
                data-office-approval-after-choice-preview-hidden="diagnostics_settings_templates_history_until_details"
                data-office-approval-after-choice-preview-default="visible_summary"
                data-office-approval-after-choice-preview-source="approvalDecisionChoiceRail"
                data-office-approval-after-choice-preview-final-boundary="final_confirmation_before_external_mutation"
                data-office-approval-after-choice-preview-external-mutation="false"
              >
                <ol>
                  <li data-step="final_check">
                    <span>1</span>
                    <strong>최종 확인</strong>
                  </li>
                  <li data-step="execution_log">
                    <span>2</span>
                    <strong>실행 로그</strong>
                  </li>
                  <li data-step="rollback">
                    <span>3</span>
                    <strong>되돌리기</strong>
                  </li>
                  <li data-step="manual_memory">
                    <span>4</span>
                    <strong>{officeDecisionMemoryLabel}</strong>
                  </li>
                </ol>
              </section>
              <section
                className={styles.approvalDecisionAfterChoiceRail}
                aria-label="오피스 승인함 결정 후 확인 경로"
                data-office-approval-after-choice-rail="run_change_hold_to_final_check_log_rollback_memory"
                data-office-approval-after-choice-visible="final_check_execution_log_rollback_manual_memory"
                data-office-approval-after-choice-hidden="diagnostics_settings_templates_history_until_details"
                data-office-approval-after-choice-default="hidden_until_choice"
                data-office-approval-after-choice-source="approval_queue_decision_and_execution_receipts"
                data-office-approval-after-choice-final-boundary="approval_before_external_mutation"
                data-office-approval-after-choice-external-mutation="false"
              >
                <article data-step="final_check" data-state={approvalWaitCount ? "approval" : "locked"}>
                  <span>선택 뒤</span>
                  <strong>최종 확인</strong>
                  <small>실행하기도 마지막 확인 전까지 멈춤</small>
                </article>
                <article data-step="execution_log" data-state={executionLogCount ? "ready" : "locked"}>
                  <span>기록</span>
                  <strong>실행 로그</strong>
                  <small>{executionLogCount ? `${executionLogCount}건 기록` : "결정 뒤 기록"}</small>
                </article>
                <article data-step="rollback" data-state={rollbackGuideCount ? "ready" : "locked"}>
                  <span>되돌리기</span>
                  <strong>되돌리기 안내</strong>
                  <small>파일·외부 실행 가능 업무는 복구 기준 표시</small>
                </article>
                <article data-step="manual_memory" data-state="locked">
                  <span>기억</span>
                  <strong>{officeDecisionMemoryLabel}</strong>
                  <small>사용자가 눌렀을 때만 저장</small>
                </article>
              </section>
              <small>첫 화면에서 넘어온 업무도 승인 카드에서 하나를 고른 뒤 실행 로그와 되돌리기를 보고, 마음에 드는 방식만 다음부터 이렇게로 저장합니다.</small>
              <section
                className={styles.approvalDecisionFirstFlow}
                aria-label="오피스 승인함 첫 결정 흐름"
                data-office-approval-first-flow="worker_result_to_run_change_hold_to_log_memory"
                data-office-approval-first-flow-visible="worker_result_three_decisions_log_memory"
                data-office-approval-first-flow-hidden="diagnostics_settings_templates_history_until_details"
                data-office-approval-first-flow-default="hidden_until_choice"
                data-office-approval-first-flow-final-boundary="approval_before_external_mutation"
                data-office-approval-first-flow-external-mutation="false"
              >
                <article data-step="result" data-state={primaryQueueItem ? "ready" : approvalWaitCount ? "approval" : "idle"}>
                  <span>직원 결과</span>
                  <strong>{primaryQueueItem?.label ?? (approvalWaitCount ? `${approvalWaitCount}개 결과` : "결과 대기")}</strong>
                </article>
                <article data-step="decision" data-state={approvalWaitCount ? "approval" : "locked"}>
                  <span>바로 결정</span>
                  <strong>{officeDecisionActionLabels}</strong>
                </article>
                <article data-step="record" data-state={executionLogCount ? "ready" : "locked"}>
                  <span>기록</span>
                  <strong>로그 · 다음부터</strong>
                </article>
              </section>
              <nav
                className={styles.approvalPrimaryActionStrip}
                aria-label="오피스 승인함 지금 누를 버튼"
                data-office-primary-actions="decide_log_remember"
                data-office-primary-disclosure="decide_first_log_remember_folded"
                data-office-primary-visible-count="1"
                data-office-primary-hidden-count="2"
                data-first-action="실행하기/고쳐달라고 하기/보류하기"
                data-first-action-visible-label="세 선택지 보기"
                data-log-action="실행 로그 확인"
                data-save-action="다음부터 이렇게"
                data-save-rule="manual_next_time_only"
                data-mobile-safe-width="390"
              >
                <a href={officeHomeActionHref("open_office")} data-action="decide">
                  세 선택지 보기
                </a>
                <details
                  className={styles.approvalPrimaryMoreActions}
                  aria-label="오피스 승인함 나머지 버튼"
                  data-office-primary-more-actions="log_remember_on_demand"
                  data-office-primary-more-actions-default="closed"
                >
                  <summary>
                    <span>나머지 버튼</span>
                    <strong>실행 로그 · 다음부터 이렇게</strong>
                  </summary>
                  <div>
                    <a href={officeHomeActionHref("open_office")} data-action="log">
                      실행 로그 확인
                    </a>
                    <a href={officeHomeActionHref("today_check")} data-action="remember">
                      다음부터 이렇게
                    </a>
                  </div>
                </details>
              </nav>
            </section>
          </section>
          <section
            className={styles.approvalWorkerHandoffStrip}
            aria-label="직원 결과 승인함 연결 요약"
            data-office-worker-handoff="worker_result_to_decision_log_memory"
            data-office-worker-handoff-source={primaryQueueItem?.teammateName ?? "담당 직원"}
            data-office-worker-handoff-approval-count={approvalWaitCount}
            data-office-worker-handoff-final-boundary="approval_before_external_mutation"
            data-office-worker-handoff-next="decide_log_remember"
          >
            <article data-step="worker_result" data-state={primaryQueueItem ? "ready" : approvalWaitCount ? "approval" : "idle"}>
              <span>직원이 올린 결과</span>
              <strong>{primaryQueueItem?.label ?? (approvalWaitCount ? `${approvalWaitCount}개 승인 후보` : "승인 후보 대기")}</strong>
              <small>{primaryQueueItem?.channelName ?? "메일·문서 담당 직원 결과가 여기로 모입니다."}</small>
            </article>
            <article data-step="approval_decision" data-state={approvalWaitCount ? "approval" : "locked"}>
              <span>사용자 최종 확인</span>
              <strong>{officeDecisionActionLabels}</strong>
              <small>결정 전에는 발송, 등록, 저장, 공유를 실행하지 않습니다.</small>
            </article>
            <article data-step="log_memory" data-state={executionLogCount ? "ready" : "locked"}>
              <span>기록과 다음부터 이렇게</span>
              <strong>실행 로그 · {officeDecisionMemoryLabel}</strong>
              <small>마음에 드는 방식만 사용자가 직접 저장합니다.</small>
            </article>
          </section>
          <section
            className={styles.approvalWorkerSurfacePath}
            aria-label="승인함 직원 결과 공통 경로"
            data-office-worker-result-cross-surface-path="chat_result_small_window_approval_queue_lock"
            data-office-worker-result-language="chat_companion_approval_same_terms"
            data-office-worker-result-surface-path-display="compact_support_after_now_decision"
            data-office-worker-result-path-visual="stepped_route_small_window_primary"
            data-office-worker-result-small-window-action="open_worker_companion"
            data-office-worker-result-current-window="work_status_not_settings"
            data-office-worker-result-user-language="working_view_not_small_window_label"
            data-office-worker-result-final-boundary="approval_before_external_mutation"
          >
            <span data-step="chat_result">채팅 결과</span>
            <button
              type="button"
              aria-label="직원 일하는 모습 보기"
              data-step="small_window"
              data-office-worker-result-small-window-button="true"
              data-office-worker-result-small-window-fallback-route="/?panel=workers&view=full&workerTab=employees&workerCompanion=1"
              onClick={() => void onOpenWorkerCompanion?.()}
              disabled={!onOpenWorkerCompanion}
            >
              일하는 모습 보기
            </button>
            <span data-step="approval_queue">오피스 승인함</span>
            <strong data-step="final_lock">승인 전 잠금</strong>
          </section>
          <details
            className={styles.approvalDecisionSummaryRail}
            aria-label="오피스 승인함 결정 한눈에 보기"
            data-office-decision-summary="preview_run_change_hold_log_remember"
            data-office-decision-summary-default="closed"
            data-office-decision-summary-body="hidden_until_user_opens"
            data-user-decision-labels="run_change_hold_remember"
            data-execution-log="office_and_worker_log"
            data-work-pattern-save="manual_next_time_only"
            data-final-action-lock="required_before_external_mutation"
            data-first-three-minute-handoff="prompt_next_approval_log_remember"
            data-office-finish-rhythm="preview_decision_log_rollback_remember"
            data-mobile-safe-width="390"
          >
            <summary>
              <span>결정 흐름</span>
              <strong>미리보기 · 결정 · 기록 · 저장</strong>
            </summary>
            <ol>
              <li data-state="preview">
                <span>미리보기</span>
                <strong>내용 먼저 확인</strong>
                <small>대상과 위험 신호 확인</small>
              </li>
              <li data-state="decision">
                <span>결정</span>
                <strong>{officeDecisionActionLabels}</strong>
                <small>실행하기/고쳐달라고 하기/보류하기 선택</small>
              </li>
              <li data-state="log">
                <span>기록</span>
                <strong>실행 로그 확인</strong>
                <small>결정과 잠금 기록</small>
              </li>
              <li data-state="remember">
                <span>저장</span>
                <strong>{officeDecisionMemoryLabel}</strong>
                <small>직접 누를 때만 기억</small>
              </li>
            </ol>
          </details>
          <details
            className={styles.approvalSafetyDetailFold}
            aria-label="승인 안전 상세 기준"
            data-office-approval-safety-detail="risk_preview_final_log_rollback_folded"
          >
            <summary>
              <span>안전 기준 상세</span>
              <strong>위험도, 미리보기, 최종 확인, 로그, 되돌리기</strong>
            </summary>
            <ol>
              {approvalSafetyRailItems.map((item) => (
                <li key={item.id} data-state={item.state}>
                  <span>{item.label}</span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </li>
              ))}
            </ol>
          </details>
          <details className={styles.approvalBoundaryFold} aria-label="승인 안전 기준 자세히 보기">
            <summary>
              <span>안전 기준</span>
              <strong>고위험 업무와 실제 실행 잠금</strong>
            </summary>
            <p
              className={styles.approvalBoundaryNote}
              data-security-boundary="permissions_scope_audit_log_rollback_design"
              data-high-risk-examples="contract_tax_public_payment_refund_personal_data"
            >
              오피스 승인함은 실수 방지 안전장치입니다. 실제 보안 경계는 Windows 권한, 폴더 범위 제한, 실행 로그, 되돌리기 가능한 작업 설계로 함께 지킵니다.
              계약, 세무, 공공기관, 결제, 환불, 개인정보 업로드 같은 고위험 업무는 초안과 미리보기까지만 만들고 사용자 최종 확인 전까지 실행하지 않습니다.
              선택지는 실행하기, 고쳐달라고 하기, 보류하기이며 외부 변경 후보는 사용자 최종 확인 버튼 전까지 잠깁니다. 마음에 드는 방식은 다음부터 이렇게를 눌렀을 때만 저장합니다.
            </p>
          </details>
          <details
            className={styles.approvalAfterDecisionBlock}
            aria-label="오피스 승인 후 확인 위치"
            data-approval-after-decision-contract="decision_receipt_log_rollback_next_choice"
            data-approval-after-decision-default="closed"
            data-approval-after-decision-body="hidden_until_user_opens"
            data-execution-log-policy="audit_or_decision_receipt"
            data-rollback-policy="guide_before_or_after_execution"
            data-next-choice-policy="show_next_user_choice_when_blocked"
          >
            <summary>
              <span>승인 후 확인 위치</span>
              <strong>로그 · 되돌리기 · 다음 선택</strong>
            </summary>
            <div className={styles.approvalAfterDecisionHeader}>
              <span>오피스 승인 후 확인 위치</span>
              <small>승인 후에는 실행 로그, 되돌리기 안내, 다음 선택지, 다음부터 이렇게 저장 위치를 함께 확인합니다.</small>
            </div>
            <nav
              className={styles.approvalDecisionShortcutStrip}
              aria-label="오피스 승인 후 바로 할 일"
              data-office-short-action-strip="decide_log_remember"
              data-office-short-action-strip-disclosure="inside_details"
              data-office-short-action-strip-default="hidden_until_user_opens"
              data-first-action="실행하기/고쳐달라고 하기/보류하기"
              data-first-action-visible-label="세 선택지 보기"
              data-log-action="실행 로그 확인"
              data-save-action="다음부터 이렇게"
              data-mobile-safe-width="390"
            >
              <a href={officeHomeActionHref("open_office")} data-action="decide">
                세 선택지 보기
              </a>
              <a href={officeHomeActionHref("open_office")} data-action="log">
                실행 로그
              </a>
              <a href={officeHomeActionHref("today_check")} data-action="remember">
                다음부터 이렇게
              </a>
            </nav>
            <ol className={styles.approvalAfterDecisionRail} aria-label="오피스 승인 후 확인 위치">
              <li data-state="log">
                <span>실행 로그</span>
                <strong>기록 위치 확인</strong>
                <small>실행하기, 고쳐달라고 하기, 보류하기 뒤 어디에 기록됐는지 보여줍니다.</small>
                <a href={officeHomeActionHref("open_office")}>실행 로그 확인</a>
              </li>
              <li data-state="rollback">
                <span>되돌리기 안내</span>
                <strong>복구 기준 확인</strong>
                <small>파일 변경, 등록, 발송 후보는 되돌릴 수 있는 기준을 함께 표시합니다.</small>
                <a href={officeHomeActionHref("open_office")}>되돌리기 기준 보기</a>
              </li>
              <li data-state="next">
                <span>다음 선택</span>
                <strong>막혔을 때 경로</strong>
                <small>막히면 연결 확인하기, 자료 선택하기, 승인함 보기 중 하나로 이어갑니다.</small>
                <a href={officeHomeActionHref("workers")}>추가 작업 맡기기</a>
              </li>
              <li data-state="remember">
                <span>저장</span>
                <strong>다음부터 이렇게</strong>
                <small>채팅 영수증의 실제 저장 버튼을 직접 누를 때만 다음 요청에 반영합니다.</small>
              </li>
            </ol>
          </details>
        </section>
<details className={styles.officeQualityGateRail} aria-label="오피스 품질 기준">
          <summary>
            <div>
              <span>오피스 품질 기준</span>
              <strong>
                {officeQualityGateItems.length
                  ? `${officeQualityGateItems.length}개 기능을 쉬운 경로로 정리`
                  : "승인함 품질 기준 유지"}
              </strong>
            </div>
            <small>부족한 기능은 대체 · 큰 기능은 필요할 때만 엽니다</small>
          </summary>
          <ol>
            {officeQualityGateItems.length ? (
              officeQualityGateItems.map((item) => (
                <li
                  key={item.id}
                  data-state={item.state}
                  data-replacement-feature-id={item.replacementFeatureId}
                  data-replacement-action={item.replacementHomeAction}
                  data-runtime-proof={item.runtimeProofLabel}
                  data-verify-command={item.verifyCommand}
                  data-next-user-choice={item.nextUserChoice}
                  data-visible-next-choice={visibleOfficeNextChoice(item.nextUserChoice)}
                  data-original-exposure-policy={item.originalExposurePolicy}
                  data-replacement-readiness={item.replacementReadiness}
                  data-replacement-execution-contract={item.replacementExecutionContract}
                >
                  <span>{item.label}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                    <small>작동 확인된 대표 기능만 실행</small>
                    <small>막히면: {visibleOfficeNextChoice(item.nextUserChoice)}</small>
                  </div>
                  <a
                    href={item.replacementHref}
                    data-feature-id={item.replacementFeatureId}
                    data-original-exposure-policy={item.originalExposurePolicy}
                    data-replacement-readiness={item.replacementReadiness}
                    data-replacement-execution-contract={item.replacementExecutionContract}
                  >
                    {item.replacementUserPath}
                  </a>
                  {item.absorptionConnectionHref ? (
                    <a
                      href={item.absorptionConnectionHref}
                      data-absorption-connection-action={item.absorptionConnectionAction}
                      data-absorption-connection-role={item.absorptionConnectionRole}
                    >
                      {item.absorptionConnectionLabel}
                    </a>
                  ) : null}
                </li>
              ))
            ) : (
              <li data-state="ready">
                <span>유지</span>
                <div>
                  <strong>대표 업무만 노출</strong>
                  <small>오피스 승인함에는 실행 경로와 안전 경계가 있는 작업만 표시합니다.</small>
                </div>
                <em>오피스 승인함</em>
              </li>
            )}
          </ol>
        </details>
<section
          className={styles.approvalActionReadinessPanel}
          aria-label="승인 실행 준비 카드"
          data-approval-action-readiness-count={approvalActionReadinessCards.length}
          data-approval-readiness-visible-count={visibleApprovalActionReadinessCards.length}
          data-approval-readiness-hidden-count={hiddenApprovalActionReadinessCards.length}
          data-approval-readiness-visible-limit={approvalActionReadinessVisibleLimit}
          data-approval-readiness-disclosure="summary_cards_details_on_demand"
          data-approval-readiness-list-disclosure="first_one_then_more_inside_details"
          data-approval-readiness-default="details_closed"
          data-approval-readiness-mobile-default="main_decision_path_first_support_inside_details"
        >
          <header>
            <div>
              <span>승인 실행 준비 카드</span>
              <strong>
                {approvalActionReadinessCards.length
                  ? `${approvalActionReadinessCards.length}개 후보를 실행 전 점검`
                  : "실행 전 점검 후보 없음"}
              </strong>
            </div>
            <small>왜 조심해야 하는지 · 무엇을 볼지 · 어디에 기록될지 · 어떻게 되돌릴지</small>
          </header>
          {approvalActionReadinessCards.length ? (
            <>
              <ol>{visibleApprovalActionReadinessCards.map(renderApprovalActionReadinessCard)}</ol>
              {hiddenApprovalActionReadinessCards.length ? (
                <details
                  className={styles.approvalReadinessMore}
                  aria-label="승인 실행 준비 나머지 후보"
                  data-approval-readiness-more="remaining_cards_collapsed"
                  data-approval-readiness-more-count={hiddenApprovalActionReadinessCards.length}
                  data-approval-readiness-more-default="closed"
                >
                  <summary>
                    <span>나머지 후보</span>
                    <strong>{hiddenApprovalActionReadinessCards.length}개 더 보기</strong>
                    <small>필요할 때만 펼칩니다</small>
                  </summary>
                  <ol>{hiddenApprovalActionReadinessCards.map(renderApprovalActionReadinessCard)}</ol>
                </details>
              ) : null}
            </>
          ) : (
            <p>발송, 등록, 파일 변경, 클릭 같은 후보가 생기면 실행 전 점검 카드로 먼저 보여줍니다.</p>
          )}
        </section></details>
        <details
          className={styles.officeSupportFold}
          aria-label="보조 설정과 승인 기준"
          data-office-support-fold="settings_approval_rules_on_demand"
          data-office-support-fold-default="closed"
          data-office-support-body="hidden_until_user_opens"
        >
          <summary>
            <span>보조 설정과 승인 기준</span>
            <strong>필요할 때만 펼칩니다</strong>
          </summary>
          <div>
            <div className={styles.officeSupportIntro} aria-label="보조 설정 섹션">
              <strong>필요 설정</strong>
              <span>연결, 업무 기준, 승인 잠금은 필요할 때만 펼쳐 확인합니다</span>
            </div>

            <section
              className={styles.officeParallelWorkRail}
              aria-label="오피스 기존 작업과 추가 작업 병행"
              data-parallel-work-contract="keep_existing_start_new_review_office"
              data-parallel-work-disclosure="existing_first_then_more_inside_details"
              data-parallel-work-visible-count={visibleOfficeParallelWorkContinuityItems.length}
              data-parallel-work-hidden-count={hiddenOfficeParallelWorkContinuityItems.length}
              data-existing-work-action="today_check"
              data-new-work-action="workers"
              data-approval-action="open_office"
              data-mutation-policy="existing_work_preserved_new_work_requires_approval"
              data-running-count={channelRunningCount || runningCrewCount}
              data-approval-count={approvalWaitCount}
              data-execution-log-count={executionLogCount}
            >
              <header>
                <div>
                  <span>병행 작업 확인</span>
                  <strong>기존 진행과 새 요청을 승인함에서 나눠 봅니다</strong>
                </div>
                <small>하던 일은 유지 · 새 요청은 분리 · 외부 실행은 승인 전 잠금</small>
              </header>
              <ol
                className={styles.officeParallelWorkPrimaryList}
                aria-label="오피스 병행 작업 먼저 볼 항목"
                data-parallel-work-primary-list="existing_work_first"
              >
                {visibleOfficeParallelWorkContinuityItems.map((item) => (
                  <li key={item.id} data-state={item.state} data-action={item.action}>
                    <span>{item.label}</span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                    <a href={item.href}>{item.label === "기존 작업" ? "기존 작업 확인" : item.label === "추가 작업" ? "추가 작업 맡기기" : "승인함 보기"}</a>
                  </li>
                ))}
              </ol>
              {hiddenOfficeParallelWorkContinuityItems.length ? (
                <details
                  className={styles.officeParallelWorkMore}
                  aria-label="오피스 병행 작업 추가 선택"
                  data-parallel-work-more="new_work_and_approval_collapsed"
                  data-parallel-work-more-default="closed"
                >
                  <summary>
                    <span>다음 선택</span>
                    <strong>추가 작업·승인함 {hiddenOfficeParallelWorkContinuityItems.length}개</strong>
                  </summary>
                  <ol
                    aria-label="오피스 병행 작업 접힌 항목"
                    data-parallel-work-hidden-list="new_work_approval_on_demand"
                  >
                    {hiddenOfficeParallelWorkContinuityItems.map((item) => (
                      <li key={item.id} data-state={item.state} data-action={item.action}>
                        <span>{item.label}</span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                        <a href={item.href}>{item.label === "추가 작업" ? "추가 작업 맡기기" : "승인함 보기"}</a>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </section>

            <div className={styles.officeProgress} aria-label={`AI 오피스 설정 진행률 ${progressValue}%`}>
              <div className={styles.motionRail} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className={styles.progressBody}>
                <strong>{progressValue}%</strong>
                <span>{desks.length}/{totalDeskCount} 데스크 · {enabledRuleCount}개 자동화</span>
                <i aria-hidden="true">
                  <b style={{ width: `${progressValue}%` }} />
                </i>
              </div>
              <button type="button" onClick={onUnlockNext} disabled={!onUnlockNext}>
                {nextActionLabel}
              </button>
            </div>

            <section className={styles.officeWorkMethodRail} aria-label="오피스 업무 기준과 승인 잠금">
              <header>
                <div>
                  <span>업무 기준</span>
                  <strong>작성·정리·실행 잠금 기준</strong>
                </div>
                <small>학습 형식 · 기본 방식 · 전환 · 승인 잠금</small>
              </header>
              <ol>
                {officeWorkMethodRailItems.map((item) => (
                  <li key={item.id} data-state={item.state}>
                    <span>{item.label}</span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </li>
                ))}
              </ol>
            </section>

            <nav className={styles.officeSingleSettingShortcuts} aria-label="필요 설정 바로가기">
              {officeSingleSettingShortcuts.map((item) => (
                <a key={item.id} href={item.href}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </a>
              ))}
            </nav>

            <section className={styles.officeCommandDeck} aria-label="채팅 오피스 커맨드 덱">
              <div className={styles.officeCommandMain}>
                <span>현재 업무 흐름</span>
                <strong>{officeCommandTitle}</strong>
                <p>{officeCommandDetail}</p>
              </div>
              <div className={styles.officeCommandMeta} aria-label="현재 오피스 메타">
                {officeCommandMeta.map((item) => (
                  <b key={item}>{item}</b>
                ))}
              </div>
              <ol className={styles.officeCommandRoute} aria-label="업무 전달 경로">
                <li data-state="done">
                  <i aria-hidden="true" />
                  <span>메인 컨트롤</span>
                </li>
                <li data-state={primaryQueueItem?.kind === "running" ? "running" : primaryQueueItem?.kind === "approval" ? "approval" : primaryQueueItem?.kind === "result" ? "done" : "idle"}>
                  <i aria-hidden="true" />
                  <span>{primaryQueueItem?.channelName ?? "AI 팀원 작업"}</span>
                </li>
                <li data-state={approvalWaitCount ? "approval" : primaryQueueItem?.kind === "result" ? "done" : "idle"}>
                  <i aria-hidden="true" />
                  <span>{approvalWaitCount ? "승인 확인" : "결과 대기"}</span>
                </li>
              </ol>
            </section>
          </div>
        </details>







        {approvalDecisionReceiptCards.length ? (
          <section
            className={styles.approvalDecisionReceiptPanel}
            aria-label="승인 결정 결과 영수증"
            data-approval-decision-receipt-count={approvalDecisionReceiptCards.length}
            data-approval-decision-receipt-disclosure="latest_one_then_more_inside_details"
            data-approval-decision-receipt-visible-count={visibleApprovalDecisionReceiptCards.length}
            data-approval-decision-receipt-hidden-count={hiddenApprovalDecisionReceiptCards.length}
          >
            <header>
              <div>
                <span>승인 결정 결과</span>
                <strong>방금 누른 결정과 기록 위치를 확인합니다</strong>
              </div>
              <small>무엇이 바뀌었는지 · 어디에 남았는지 · 다음에 무엇을 할지</small>
            </header>
            {mailOpsDecisionReceiptComparisonRows.length ? (
              <details
                className={styles.mailOpsDecisionReceiptComparison}
                aria-label="메일 결정 실행 로그 비교표"
                data-mailops-decision-comparison="decision_review_log_next_external_mutation_false"
                data-mailops-decision-comparison-count={mailOpsDecisionReceiptComparisonRows.length}
                data-mailops-decision-comparison-default="closed"
                data-mailops-decision-comparison-context={
                  mailOpsDecisionReceiptComparisonRows.map((row) => row.reviewContext).filter(Boolean).join(" | ")
                }
                data-mailops-decision-comparison-external-mutation="false"
                data-log-action="open_office"
                data-work-pattern-save="manual_next_time_only"
                data-mobile-safe-width="390"
              >
                <summary>
                  <span>메일 결정 비교</span>
                  <strong>{mailOpsDecisionReceiptComparisonRows.length}건 비교 접힘</strong>
                  <small>작업함 검토가 붙은 결정만 필요할 때 펼칩니다.</small>
                </summary>
                <div
                  className={styles.mailOpsDecisionReceiptComparisonBody}
                  data-mailops-decision-comparison-body="hidden_until_user_opens"
                >
                  <header>
                    <span>메일 결정 비교</span>
                    <strong>결정 · 실행 로그 · 다음 행동</strong>
                    <small>작업함 검토가 붙은 결정만 표시합니다.</small>
                  </header>
                  <div role="table" aria-label="메일 결정 실행 로그 비교">
                    <div role="row" data-row="header">
                      <span role="columnheader">결정</span>
                      <span role="columnheader">실행 로그</span>
                      <span role="columnheader">작업함</span>
                      <span role="columnheader">다음</span>
                    </div>
                    {mailOpsDecisionReceiptComparisonRows.map((row) => (
                      <div
                        key={row.id}
                        role="row"
                        data-state={row.state}
                        data-mailops-decision-row={row.id}
                        data-mailops-decision-label={row.decisionLabel}
                        data-mailops-review-decision={row.reviewDecisionLabel}
                        data-mailops-review-context={row.reviewContext}
                        data-mailops-external-mutation={row.externalMutationLabel}
                      >
                        <span role="cell">
                          <strong>{row.decisionLabel}</strong>
                          <small>{row.title}</small>
                        </span>
                        <span role="cell">
                          <strong>{row.executionStateLabel}</strong>
                          <small>외부 실행 {row.externalMutationLabel}</small>
                        </span>
                        <span role="cell">
                          <strong>{row.reviewDecisionLabel}</strong>
                          <small>{row.reviewNote}</small>
                        </span>
                        <span role="cell">
                          <strong>{row.nextChoiceLabel}</strong>
                          <small>실행 로그 확인 후 필요할 때만 저장</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
            <ol
              aria-label="최근 승인 결정 결과"
              data-approval-decision-receipt-primary-list="latest_one"
            >
              {visibleApprovalDecisionReceiptCards.map((card) => (
                <li key={card.id} data-state={card.state}>
                  <span>{card.label}</span>
                  <div>
                    <strong>{card.title}</strong>
                    <p>{card.detail}</p>
                    <section
                      className={styles.approvalDecisionCurrentState}
                      aria-label={`${card.title} 현재 결정 상태`}
                      data-decision-current-state="selected_execution_record_next"
                      data-decision-label={card.label}
                      data-execution-state={card.executionStateLabel}
                      data-record-path={officeMemoryReferenceLabel(card.recordPath)}
                      data-next-choice-action={card.parallelWorkAction}
                      data-work-pattern-save="manual_next_time_only"
                      data-final-action-lock="required_before_external_mutation"
                      data-mobile-safe-width="390"
                    >
                      <span>현재 상태</span>
                      <strong>{card.label} · {card.executionStateLabel}</strong>
                      <small>
                        기록 위치는 {officeMemoryReferenceLabel(card.recordPath)}입니다. 다음은 {visibleOfficeNextChoice(card.parallelWorkNextChoice)}이고, 마음에 든 방식만 다음부터 이렇게로 저장합니다.
                      </small>
                    </section>
                    {card.mailOpsWorkQueueReview ? (
                      <section
                        className={styles.mailOpsDecisionReceiptReview}
                        aria-label={`${card.title} 작업함 검토 실행 로그 반영`}
                        data-mailops-decision-receipt-context="work_queue_review_to_execution_log"
                        data-mailops-decision-receipt-review-context={card.mailOpsWorkQueueReview.context}
                        data-mailops-decision-receipt-review-decision={card.mailOpsWorkQueueReview.decisionLabel}
                        data-mailops-decision-receipt-external-mutation={card.mailOpsWorkQueueReview.externalMutationLabel}
                        data-mailops-decision-receipt-engine-handoff={mailOpsWorkQueueAutomationEvidence.evidenceContract}
                        data-mailops-decision-receipt-engine-path={mailOpsWorkQueueAutomationEvidence.enginePathContract}
                        data-mailops-decision-receipt-approval-gate={mailOpsWorkQueueAutomationEvidence.approvalGateContract}
                        data-mailops-decision-receipt-automation-proof={mailOpsWorkQueueAutomationProofLabel}
                        data-mailops-decision-receipt-proof-label="작업함 결정 기록 기준으로 승인 후보만 마지막 확인과 실행 로그에 연결"
                        data-log-action="open_office"
                        data-next-choice-action={card.parallelWorkAction}
                        data-mobile-safe-width="390"
                      >
                        <span>작업함 검토</span>
                        <strong>{card.mailOpsWorkQueueReview.decisionLabel} · 실행 로그에 같이 남김</strong>
                        <small>{mailOpsWorkQueueAutomationProofLabel}</small>
                        <small>
                          {card.mailOpsWorkQueueReview.note
                            ? `수정 메모: ${card.mailOpsWorkQueueReview.note}`
                            : "수정 메모 없이 결정만 반영했습니다."}
                        </small>
                        <small>외부 실행 {card.mailOpsWorkQueueReview.externalMutationLabel} · 승인 전까지 발송하지 않음</small>
                      </section>
                    ) : null}
                    <details
                      className={styles.approvalDecisionReceiptMore}
                      aria-label={`${card.title} 결정 상세 더 보기`}
                      data-decision-receipt-more="summary_record_rollback_next_on_demand"
                      data-decision-receipt-more-default="closed"
                    >
                      <summary>
                        <span>결정 상세</span>
                        <strong>기록 · 되돌리기 · 다음 단계</strong>
                      </summary>
                      <div
                        className={styles.approvalDecisionReceiptMoreBody}
                        data-decision-receipt-more-body="hidden_until_user_opens"
                      >
                        <ol
                          className={styles.approvalDecisionPlainSummary}
                          aria-label={`${card.title} 쉬운 결정 요약`}
                          data-decision-plain-summary="decision_execution_rollback_next"
                          data-decision-label={card.label}
                          data-execution-state={card.executionStateLabel}
                          data-rollback-label={card.rollbackLabel}
                          data-next-choice-action={card.parallelWorkAction}
                          data-mobile-safe-width="390"
                        >
                          <li data-state={card.state}>
                            <span>이번 결정</span>
                            <strong>{card.label}</strong>
                            <small>{visibleOfficeNextChoice(card.parallelWorkNextChoice)}</small>
                          </li>
                          <li data-state="execution">
                            <span>실행 여부</span>
                            <strong>{card.executionStateLabel}</strong>
                            <small>외부 발송, 등록, 파일 변경은 승인 전까지 잠급니다.</small>
                          </li>
                          <li data-state="rollback">
                            <span>되돌리기</span>
                            <strong>되돌릴 기준 확인</strong>
                            <small>{card.rollbackLabel}</small>
                          </li>
                        </ol>
                        <ol
                          className={styles.approvalDecisionRecordTrail}
                          aria-label={`${card.title} 결정 기록 실행 로그 저장 순서`}
                          data-decision-record-trail="decision_record_execution_log_next_time_next_choice"
                          data-decision-label={card.label}
                          data-record-path={officeMemoryReferenceLabel(card.recordPath)}
                          data-log-action="open_office"
                          data-next-time-action="today_check"
                          data-next-choice-action={card.parallelWorkAction}
                          data-work-pattern-save="manual_next_time_only"
                          data-mobile-safe-width="390"
                        >
                          <li data-step="decision" data-state={card.state}>
                            <span>1</span>
                            <strong>결정 기록</strong>
                            <small>{card.label} 선택을 업무 기록에 남깁니다.</small>
                          </li>
                          <li data-step="log">
                            <span>2</span>
                            <strong>실행 로그</strong>
                            <small>{card.executionStateLabel}</small>
                          </li>
                          <li data-step="remember">
                            <span>3</span>
                            <strong>다음부터 이렇게</strong>
                            <small>저장 버튼을 누른 방식만 다음 요청에 참고합니다.</small>
                          </li>
                          <li data-step="next">
                            <span>4</span>
                            <strong>{visibleOfficeNextChoice(card.parallelWorkNextChoice)}</strong>
                            <small>{card.nextStep}</small>
                          </li>
                        </ol>
                        <dl>
                          <div>
                            <dt>실행 상태</dt>
                            <dd>{card.executionStateLabel}</dd>
                          </div>
                          <div>
                            <dt>기록 위치</dt>
                            <dd>{officeMemoryReferenceLabel(card.recordPath)}</dd>
                          </div>
                          <div>
                            <dt>되돌리기 기준</dt>
                            <dd>{card.rollbackLabel}</dd>
                          </div>
                          <div>
                            <dt>다음 단계</dt>
                            <dd>{card.nextStep}</dd>
                          </div>
                        </dl>
                        <ol
                          className={styles.approvalDecisionReceiptSummary}
                          aria-label={`${card.title} 결정 후 한눈에 보기`}
                          data-decision-receipt-summary="decision_record_log_remember_next"
                          data-log-action="open_office"
                          data-next-time-action="today_check"
                          data-next-choice-action={card.parallelWorkAction}
                          data-work-pattern-save="manual_next_time_only"
                          data-mobile-safe-width="390"
                        >
                          <li data-state={card.state}>
                            <span>결정</span>
                            <strong>{card.label}</strong>
                            <small>{card.executionStateLabel}</small>
                          </li>
                          <li data-state="log">
                            <span>기록</span>
                            <strong>실행 로그 확인</strong>
                            <small>{officeMemoryReferenceLabel(card.recordPath)}</small>
                          </li>
                          <li data-state="remember">
                            <span>저장</span>
                            <strong>다음부터 이렇게</strong>
                            <small>직접 저장할 때만 다음 요청에 참고</small>
                          </li>
                          <li data-state="next">
                            <span>다음</span>
                            <strong>{visibleOfficeNextChoice(card.parallelWorkNextChoice)}</strong>
                            <small>{card.nextStep}</small>
                          </li>
                        </ol>
                      </div>
                    </details>
                    <div
                      className={styles.approvalDecisionActionRail}
                      aria-label={`${card.title} 실행 로그와 저장 행동`}
                      data-decision-receipt-actions="log_next_time_next_choice"
                      data-log-action="open_office"
                      data-next-time-action="today_check"
                      data-next-choice-action={card.parallelWorkAction}
                      data-mobile-safe-width="390"
                    >
                      <a href={officeHomeActionHref("open_office")}>실행 로그 확인</a>
                      <a href={officeHomeActionHref("today_check")}>다음부터 이렇게 저장 위치</a>
                      <a href={officeHomeActionHref(card.parallelWorkAction)}>{visibleOfficeNextChoice(card.parallelWorkNextChoice)}</a>
                    </div>
                    <ol
                      className={styles.approvalDecisionParallelRail}
                      aria-label={`${card.title} 병행 작업 다음 확인`}
                      data-parallel-work-receipt="decision_result_keeps_existing_and_routes_next"
                      data-primary-action={card.parallelWorkAction}
                      data-mobile-safe-width="390"
                    >
                      <li data-action="today_check" data-state={card.parallelWorkAction === "today_check" ? "active" : "ready"}>
                        <span>기존 작업</span>
                        <strong>기존 작업 확인</strong>
                        <small>하던 후보와 승인 기록은 유지합니다.</small>
                        <a href={officeHomeActionHref("today_check")}>기존 작업 확인</a>
                      </li>
                      <li data-action="workers" data-state={card.parallelWorkAction === "workers" ? "active" : "ready"}>
                        <span>추가 작업</span>
                        <strong>추가 작업 맡기기</strong>
                        <small>새 요청은 담당 AI 팀원 흐름으로 분리합니다.</small>
                        <a href={officeHomeActionHref("workers")}>추가 작업 맡기기</a>
                      </li>
                      <li data-action="open_office" data-state={card.parallelWorkAction === "open_office" ? "active" : "ready"}>
                        <span>승인함</span>
                        <strong>승인함 보기</strong>
                        <small>{card.parallelWorkNextChoice}</small>
                        <a href={officeHomeActionHref("open_office")}>승인함 보기</a>
                      </li>
                    </ol>
                  </div>
                </li>
              ))}
            </ol>
            {hiddenApprovalDecisionReceiptCards.length ? (
              <details
                className={styles.approvalDecisionReceiptListMore}
                aria-label="나머지 승인 결정 결과"
                data-approval-decision-receipt-more-list="remaining_receipts_collapsed"
                data-approval-decision-receipt-more-default="closed"
                data-approval-decision-receipt-more-count={hiddenApprovalDecisionReceiptCards.length}
              >
                <summary>
                  <span>나머지 결정</span>
                  <strong>{hiddenApprovalDecisionReceiptCards.length}개 더 보기</strong>
                  <small>기록 위치와 다음 행동만 필요할 때 펼칩니다</small>
                </summary>
                <ol aria-label="접힌 승인 결정 결과 요약">
                  {hiddenApprovalDecisionReceiptCards.map((card) => (
                    <li key={`hidden-${card.id}`} data-state={card.state}>
                      <span>{card.label}</span>
                      <div>
                        <strong>{card.title}</strong>
                        <p>{card.executionStateLabel} · {officeMemoryReferenceLabel(card.recordPath)}</p>
                        <div
                          className={styles.approvalDecisionActionRail}
                          aria-label={`${card.title} 접힌 실행 로그와 저장 행동`}
                          data-decision-receipt-actions="log_next_time_next_choice"
                          data-log-action="open_office"
                          data-next-time-action="today_check"
                          data-next-choice-action={card.parallelWorkAction}
                          data-mobile-safe-width="390"
                        >
                          <a href={officeHomeActionHref("open_office")}>실행 로그 확인</a>
                          <a href={officeHomeActionHref(card.parallelWorkAction)}>{visibleOfficeNextChoice(card.parallelWorkNextChoice)}</a>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </section>
        ) : null}

        <section className={styles.repeatWorkApprovalBridge} aria-label="반복 업무 승인 실행 흐름">
          <header>
            <div>
              <span>반복 업무 승인 실행 흐름</span>
              <strong>반복 업무도 승인함에서 실행하기, 고쳐달라고 하기, 보류하기를 고릅니다</strong>
            </div>
            <small>사용자가 켠 반복 업무만 점검 대상입니다. · 최종 승인 전 잠금 · 업무 기록과 감사 기록</small>
          </header>
          <ol>
            {repeatWorkApprovalSteps.map((item) => (
              <li key={item.id} data-state={item.state}>
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.repeatWorkOfficeApprovalQueue} aria-label="반복 업무 오피스 승인 후보" data-repeat-work-source="repeat_work">
          <header>
            <div>
              <span>반복 업무 오피스 승인 후보</span>
              <strong>
                {repeatWorkOfficeApprovalItems.length
                  ? `${repeatWorkOfficeApprovalItems.length}개 후보가 승인함에 연결됨`
                  : "점검 결과가 생기면 승인 후보가 여기에 표시됩니다"}
              </strong>
            </div>
            <small>{officeDecisionActionLogLabel}</small>
          </header>
          <p>오피스 승인함 · 반복 업무 실행/보류/수정 기록. 필요하면 자료를 다시 선택하거나 새 후보를 만듭니다.</p>
          {repeatWorkOfficeApprovalItems.length ? (
            <ol>
              {repeatWorkOfficeApprovalItems.map((item) => (
                <li key={item.id} data-state={item.state}>
                  <span>{item.label}</span>
                  <strong>{item.title}</strong>
                  <small>{item.sourceLabel}</small>
                  <p>{item.detail}</p>
                  <dl className={styles.repeatWorkOfficeApprovalSummary} aria-label={`${item.title} 실행 취소 로그 되돌리기`}>
                    <div>
                      <dt>위험도</dt>
                      <dd>{item.riskLabel}</dd>
                    </div>
                    <div>
                      <dt>미리보기</dt>
                      <dd>{item.previewLabel}</dd>
                    </div>
                    <div>
                      <dt>결정</dt>
                      <dd>{item.decisionLabel}</dd>
                    </div>
                    <div>
                      <dt>실행 로그</dt>
                      <dd>{item.logLabel}</dd>
                    </div>
                    <div>
                      <dt>되돌리기</dt>
                      <dd>{item.undoLabel}</dd>
                    </div>
                  </dl>
                  <div className={styles.repeatWorkOfficeApprovalSteps} aria-label={`${item.title} 처리 단계`}>
                    <em>미리보기</em>
                    <em>결정 선택</em>
                    <em>최종 실행 잠금</em>
                    <em>업무 기록</em>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>반복 업무 점검에서 승인 후보가 생기면 실행하기, 고쳐달라고 하기, 보류하기를 오피스 승인함에서 고릅니다.</p>
          )}
        </section>

        <details
          className={styles.officeMonitorArchive}
          data-office-minimal-policy="approval_first_worker_details_folded"
          data-default-state="closed_until_user_opens"
          data-primary-visible-surface="approval_queue_then_worker_details"
        >
          <summary>
            <span>보조 관제</span>
            <strong>승인할 팀원 작업만 먼저 보고, 세부 관제는 필요할 때만 펼칩니다</strong>
            <small>
              승인 {approvalWaitCount} · 작업 {liveChannelRailItems.length} · 결과 {delegationOutcomeRows.length}
            </small>
          </summary>
          <div className={styles.officeMonitorArchiveBody}>
            <section className={styles.officeLiveChannelRail} aria-label="오피스 AI 팀원 실시간 레일">
              <header>
                <div>
                  <span>실시간 팀원</span>
                  <strong>{liveChannelRailItems.length ? "승인 필요한 팀원 작업만 먼저 확인합니다" : "AI 팀원 대기"}</strong>
                </div>
                <small>
                  작업 {channelRunningCount || runningCrewCount} · 승인 {approvalWaitCount} · 결과 {channelResultCount}
                </small>
              </header>
              {liveChannelRailItems.length ? (
                <ol>
                  {liveChannelRailItems.map((item, index) => (
                    <li key={`live-channel-rail-${item.id}`} data-kind={item.kind} data-focused={item.focused ? "true" : "false"}>
                      <span>
                        <i aria-hidden="true" />
                        <b>{index + 1}</b>
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <small>{item.channelName} · {item.statusLabel}</small>
                      </div>
                      <em>{item.detail}</em>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>채팅에서 AI 팀원을 만들거나 업무를 맡기면 승인할 일과 결과만 먼저 표시하고, 세부 작업 상태는 여기에서 펼쳐 확인합니다.</p>
              )}
            </section>

            <section className={styles.officeFocusBoard} aria-label="오피스 포커스 보드">
              <header>
                <div>
                  <span>AI 팀원 상태</span>
                  <strong>AI 팀원 활동 보드</strong>
                </div>
                <small>
                  {primaryQueueItem
                    ? `${primaryQueueItem.teammateName} 채널이 현재 업무를 처리 중`
                    : "메인 컨트롤에서 AI 팀원에게 자연스럽게 이어집니다"}
                </small>
              </header>
              <div className={styles.officeFocusGrid}>
                {officeFocusCards.map((card) => (
                  <article key={card.id} data-state={card.state}>
                    <i aria-hidden="true" />
                    <div>
                      <span>{card.stateLabel}</span>
                      <strong>{card.name}</strong>
                      <small>{card.channelName}</small>
                    </div>
                    <p>{card.brief}</p>
                    <footer>
                      <b>{card.meta}</b>
                      <button
                        type="button"
                        onClick={() => onOpenMemoryFile?.(card.memoryPath)}
                        disabled={!onOpenMemoryFile}
                      >
                        기억 열기
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            </section>

        <section className={styles.officeWorkerHub} aria-label="AI 팀원 작업 허브">
          <header>
            <div>
              <span>AI 작업 로그</span>
              <strong>AI 팀원별로 누가 일하고 어디에 기록되는지 봅니다</strong>
            </div>
            <small>{officeWorkerHubRows.length ? `${officeWorkerHubRows.length}명 표시` : "AI 팀원 대기"}</small>
          </header>
          {officeWorkerHubRows.length ? (
            <ol>
              {officeWorkerHubRows.map((row) => (
                <li
                  key={`worker-hub-${row.id}`}
                  data-state={row.state}
                  data-worker-hub-row-compact="worker_status_only_details_inside"
                  data-worker-hub-row-compact-summary={`${row.name} · ${row.stateLabel} · ${row.queueLabel}`}
                  data-worker-hub-row-external-mutation="false"
                >
                  <span>{row.teamLabel.slice(0, 1).toUpperCase()}</span>
                  <div
                    className={styles.officeWorkerHubMain}
                    aria-label={`${row.name} AI 작업 로그 한 줄 요약`}
                    data-worker-hub-row-main="worker_status_details_collapsed"
                  >
                    <strong>{row.name}</strong>
                    <small>{row.channelName} · {row.stateLabel}</small>
                  </div>
                  <details
                    className={styles.officeWorkerHubDetails}
                    aria-label={`${row.name} AI 작업 로그 상세`}
                    data-worker-hub-row-details="queue_counts_records_collapsed"
                    data-worker-hub-details-external-mutation="false"
                  >
                    <summary>
                      <span>상세 보기</span>
                      <small>작업 {row.runningCount} · 승인 {row.approvalCount} · 결과 {row.resultCount}</small>
                    </summary>
                    <p>{row.queueLabel}</p>
                    <em>
                      작업 {row.runningCount} · 승인 {row.approvalCount} · 결과 {row.resultCount}
                    </em>
                    <div className={styles.officeWorkerHubActions}>
                      <button
                        type="button"
                        onClick={() => onOpenMemoryFile?.(row.crewSoulPath)}
                        disabled={!onOpenMemoryFile}
                      >
                        업무 방식
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenMemoryFile?.(row.workLogPath)}
                        disabled={!onOpenMemoryFile}
                      >
                        작업 기록
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenMemoryFile?.(row.decisionLogPath)}
                        disabled={!onOpenMemoryFile}
                      >
                        결정 기록
                      </button>
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p>채팅에서 AI 팀원을 만들거나 업무를 맡기면 이곳에 담당자, 상태, 업무 기록, 결정 기록이 먼저 표시됩니다.</p>
          )}
        </section>

        <section className={styles.officeDelegationOutcomeHub} aria-label="AI 팀원 결과 허브">
          <header>
            <div>
              <span>AI 팀원 결과</span>
              <strong>팀원 결과, 저장 기록, 승인 경계를 한곳에서 봅니다</strong>
            </div>
            <small>
              {delegationOutcomeRows.length
                ? `${delegationOutcomeRows.length}개 결과 표시`
                : "팀원 결과 대기"}
            </small>
          </header>
          <section
            className={styles.officeDelegationOutcomeNextRail}
            aria-label="AI 팀원 결과 처리 순서"
            data-delegation-office-next-path="result_open_decide_log_remember"
            data-result-button="팀원 답변 보기"
            data-decision-buttons="실행하기|고쳐달라고 하기|보류하기"
            data-log-label="실행 로그 확인"
            data-save-label="다음부터 이렇게"
            data-final-action-lock="required_before_external_mutation"
            data-mobile-safe-width="390"
          >
            <span>지금 볼 순서</span>
            <ol>
              <li data-state="result">
                <strong>팀원 답변 보기</strong>
                <small>팀원 답변 원문과 취합 결과를 먼저 확인합니다.</small>
              </li>
              <li data-state="decision">
                <strong>실행하기 · 고쳐달라고 하기 · 보류</strong>
                <small>외부 실행 전 사용자가 승인함에서 직접 고릅니다.</small>
              </li>
              <li data-state="log">
                <strong>실행 로그 확인</strong>
                <small>결정 기록과 업무 기록에서 실행 잠금 상태를 봅니다.</small>
              </li>
              <li data-state="remember">
                <strong>다음부터 이렇게</strong>
                <small>마음에 든 방식만 사용자가 직접 저장합니다.</small>
              </li>
            </ol>
          </section>
          {delegationOutcomeRows.length ? (
            <ol>
              {delegationOutcomeRows.map((row) => {
                const outcomeLogPath = row.workLogPath || row.memoryPath;
                const isPendingDelegationApproval =
                  row.artifact?.artifactKind === "approval" && !row.artifact.approvalDecision;
                return (
                <li
                  key={row.id}
                  data-state={row.state}
                  data-delegation-outcome-row-compact="result_title_status_only_details_inside"
                  data-delegation-outcome-row-compact-summary={`${row.title} · ${row.owner} · ${row.countLabel}`}
                  data-delegation-outcome-row-external-mutation="false"
                >
                  <span>{row.label}</span>
                  <div
                    className={styles.officeDelegationOutcomeMain}
                    aria-label={`${row.title} AI 팀원 결과 한 줄 요약`}
                    data-delegation-outcome-row-main="result_title_status_details_collapsed"
                  >
                    <strong>{row.title}</strong>
                    <small>{row.owner} · {row.countLabel}</small>
                  </div>
                  <div
                    className={styles.officeDelegationOutcomeActions}
                    aria-label={`${row.title} 지금 할 일`}
                    data-delegation-row-actions={
                      isPendingDelegationApproval ? "answer_decide_log_remember" : "answer_log_remember_decide"
                    }
                    data-first-action={row.artifact ? "팀원 답변 보기" : "기억 열기"}
                    data-decision-first={isPendingDelegationApproval ? "실행하기|고쳐달라고 하기|보류하기" : undefined}
                    data-log-action="실행 로그 확인"
                    data-save-action="다음부터 이렇게 저장 위치"
                    data-decision-actions={isPendingDelegationApproval ? "실행하기|고쳐달라고 하기|보류하기" : undefined}
                    data-mobile-safe-width="390"
                  >
                    {row.artifact ? (
                      <button
                        type="button"
                        data-action="answer"
                        onClick={() => onOpenDelegationArtifact?.(row.artifact!)}
                        disabled={!onOpenDelegationArtifact}
                      >
                        팀원 답변 보기
                      </button>
                    ) : row.memoryPath ? (
                      <button
                        type="button"
                        onClick={() => onOpenMemoryFile?.(row.memoryPath)}
                        disabled={!onOpenMemoryFile}
                      >
                        기억 열기
                      </button>
                    ) : null}
                    {isPendingDelegationApproval ? (
                      <>
                        <button
                          type="button"
                          data-action="approve"
                          onClick={() => onRecordDelegationDecision?.(row.artifact!, "approved")}
                          disabled={!onRecordDelegationDecision}
                        >
                          실행하기
                        </button>
                        <button
                          type="button"
                          data-action="revise"
                          onClick={() => onRecordDelegationDecision?.(row.artifact!, "change_requested")}
                          disabled={!onRecordDelegationDecision}
                        >
                          고쳐달라고 하기
                        </button>
                        <button
                          type="button"
                          data-action="hold"
                          onClick={() => onRecordDelegationDecision?.(row.artifact!, "held")}
                          disabled={!onRecordDelegationDecision}
                        >
                          보류하기
                        </button>
                      </>
                    ) : null}
                    {outcomeLogPath ? (
                      <button
                        type="button"
                        data-action="log"
                        onClick={() => onOpenMemoryFile?.(outcomeLogPath)}
                        disabled={!onOpenMemoryFile}
                      >
                        실행 로그 확인
                      </button>
                    ) : null}
                    {row.decisionLogPath ? (
                      <button
                        type="button"
                        data-action="memory"
                        onClick={() => onOpenMemoryFile?.(row.decisionLogPath)}
                        disabled={!onOpenMemoryFile}
                      >
                        결정 기록
                      </button>
                    ) : null}
                    <a href={officeHomeActionHref("today_check")} data-action="remember">
                      다음부터 이렇게 저장 위치
                    </a>
                  </div>
                  <details
                    className={styles.officeDelegationOutcomeDetails}
                    aria-label={`${row.title} AI 팀원 결과 상세`}
                    data-delegation-outcome-row-details="detail_evidence_actions_collapsed"
                    data-delegation-outcome-details-external-mutation="false"
                  >
                    <summary>
                      <span>상세 보기</span>
                      <small>{row.evidenceLabel}</small>
                    </summary>
                    <p>{row.detail}</p>
                    <em>{row.evidenceLabel}</em>
                    <code title="내부 기록 경로는 앱이 관리합니다.">{officeMemoryReferenceLabel(row.memoryPath)}</code>
                    <div
                      className={styles.officeDelegationOutcomeActions}
                      aria-label={`${row.title} 지금 할 일`}
                      data-delegation-row-actions={
                        isPendingDelegationApproval ? "answer_decide_log_remember" : "answer_log_remember_decide"
                      }
                      data-first-action={row.artifact ? "팀원 답변 보기" : "기억 열기"}
                      data-decision-first={isPendingDelegationApproval ? "실행하기|고쳐달라고 하기|보류하기" : undefined}
                      data-log-action="실행 로그 확인"
                      data-save-action="다음부터 이렇게 저장 위치"
                      data-decision-actions={isPendingDelegationApproval ? "실행하기|고쳐달라고 하기|보류하기" : undefined}
                      data-mobile-safe-width="390"
                    >
                      {row.artifact ? (
                        <button
                          type="button"
                          data-action="answer"
                          onClick={() => onOpenDelegationArtifact?.(row.artifact!)}
                          disabled={!onOpenDelegationArtifact}
                        >
                          팀원 답변 보기
                        </button>
                      ) : row.memoryPath ? (
                        <button
                          type="button"
                          onClick={() => onOpenMemoryFile?.(row.memoryPath)}
                          disabled={!onOpenMemoryFile}
                        >
                          기억 열기
                        </button>
                      ) : null}
                      {isPendingDelegationApproval ? (
                        <>
                          <button
                            type="button"
                            data-action="approve"
                            onClick={() => onRecordDelegationDecision?.(row.artifact!, "approved")}
                            disabled={!onRecordDelegationDecision}
                          >
                            실행하기
                          </button>
                          <button
                            type="button"
                            data-action="revise"
                            onClick={() => onRecordDelegationDecision?.(row.artifact!, "change_requested")}
                            disabled={!onRecordDelegationDecision}
                          >
                            고쳐달라고 하기
                          </button>
                          <button
                            type="button"
                            data-action="hold"
                            onClick={() => onRecordDelegationDecision?.(row.artifact!, "held")}
                            disabled={!onRecordDelegationDecision}
                          >
                            보류하기
                          </button>
                        </>
                      ) : null}
                      {outcomeLogPath ? (
                        <button
                          type="button"
                          data-action="log"
                          onClick={() => onOpenMemoryFile?.(outcomeLogPath)}
                          disabled={!onOpenMemoryFile}
                        >
                          실행 로그 확인
                        </button>
                      ) : null}
                      {row.decisionLogPath ? (
                        <button
                          type="button"
                          data-action="memory"
                          onClick={() => onOpenMemoryFile?.(row.decisionLogPath)}
                          disabled={!onOpenMemoryFile}
                        >
                          결정 기록
                        </button>
                      ) : null}
                      <a href={officeHomeActionHref("today_check")} data-action="remember">
                        다음부터 이렇게 저장 위치
                      </a>
                    </div>
                    {row.artifact?.artifactKind === "approval" ? (
                      <DelegationDecisionOutcomeRail artifact={row.artifact} label={row.title} />
                    ) : null}
                  </details>
                </li>
                );
              })}
            </ol>
          ) : (
            <p>메인 컨트롤에서 AI 팀원에게 분배한 결과가 저장되면 팀원 결과, 업무 기록, 승인 후보가 이곳에 먼저 표시됩니다.</p>
          )}
        </section>

        <div className={styles.agentStateStrip} aria-label="AI 팀원 실시간 상태">
          {agentStateItems.map((item) => (
            <span key={item.id} data-state={item.state}>
              <i aria-hidden="true" />
              <b>{item.label}</b>
              <small>{item.detail}</small>
            </span>
          ))}
        </div>

        <section className={styles.chatNativeOfficeStatus} aria-label="채팅에서 이어진 현재 업무 흐름">
          <div>
            <span>현재 흐름</span>
            <strong>{primaryQueueItem?.label ?? "채팅 명령을 기다리는 중"}</strong>
            <small>
              {primaryQueueItem
                ? `${primaryQueueItem.teammateName} · ${primaryQueueItem.channelName} · ${channelQueueKindLabel(primaryQueueItem.kind)}`
                : "메인 컨트롤에서 AI 팀원에게 이어집니다"}
            </small>
            {channelQueueFocus ? (
              <div className={styles.channelQueueFocusBanner} aria-label="채팅에서 넘어온 팀원 작업">
                <b>채팅에서 넘어온 팀원 작업</b>
                <small>요청 전달 기록 · 실제 실행 상태는 아래에서 확인</small>
                <small>
                  {channelQueueFocus.sourceTeammateName} → {channelQueueFocus.targetLabels.slice(0, 3).join(" · ") ||
                    `${channelQueueFocus.targetTeammateIds.length}명 팀원`}
                </small>
                <em>{channelQueueFocus.requestText}</em>
              </div>
            ) : null}
          </div>
          <ol>
            {currentFlowSteps.map((step) => (
              <li key={step.id} data-state={step.state}>
                <i aria-hidden="true" />
                <b>{step.label}</b>
                <small>{step.detail}</small>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.officeLiveHandoff} aria-label="메인 컨트롤 AI 팀원 작업 실시간 레일">
          <header>
            <div>
              <span>실시간 분배</span>
              <strong>메인 컨트롤에서 AI 팀원에게 이어지는 일</strong>
            </div>
            <small>{liveHandoffItems.length ? `${liveHandoffItems.length}개 팀원 추적` : "채팅에서 맡기면 바로 표시"}</small>
          </header>
          {liveHandoffItems.length ? (
            <ol>
              {liveHandoffItems.map((item) => (
                <li
                  key={`handoff-${item.id}`}
                  data-kind={item.kind}
                  data-focused={item.focused ? "true" : "false"}
                  data-live-handoff-row-compact="worker_task_status_only_details_inside"
                  data-live-handoff-row-compact-summary={`${item.teammateName} · ${item.label} · ${item.statusLabel}`}
                  data-live-handoff-row-external-mutation="false"
                >
                  <span>{item.teamLabel.slice(0, 1).toUpperCase()}</span>
                  <div
                    className={styles.officeLiveHandoffMain}
                    aria-label={`${item.label} 실시간 분배 한 줄 요약`}
                    data-live-handoff-row-main="worker_task_status_details_collapsed"
                  >
                    <strong>{item.teammateName} · {item.label}</strong>
                    <small>{item.channelName} · {item.statusLabel}{item.workload ? ` · ${item.workload}` : ""}</small>
                  </div>
                  <details
                    className={styles.officeLiveHandoffDetails}
                    aria-label={`${item.label} 실시간 분배 상세`}
                    data-live-handoff-row-details="detail_source_workload_collapsed"
                    data-live-handoff-details-external-mutation="false"
                  >
                    <summary>
                      <span>상세 보기</span>
                      <small>{item.sourceLabel || "업무 출처 확인"}</small>
                    </summary>
                    <p>{item.detail}</p>
                    <em>{item.sourceLabel}</em>
                    <b>{item.statusLabel}</b>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p>채팅에서 업무를 맡기면 담당 AI 팀원, 작업 이름, 승인 상태가 이 레일에 먼저 표시됩니다.</p>
          )}
        </section>

        <section className={styles.channelQueueOverview} aria-label="AI 팀원 작업 요약">
          <header>
            <div>
              <span>AI 팀원 작업</span>
              <strong>{primaryQueueItem ? `${primaryQueueItem.teammateName} · ${channelQueueKindLabel(primaryQueueItem.kind)}` : "AI 팀원 대기"}</strong>
            </div>
            <small>{visibleChannelQueueItems.length ? `${visibleChannelQueueItems.length}개 최근 작업` : "채팅에서 맡기면 이곳에 표시"}</small>
          </header>
          <ol>
            {channelQueueOverviewItems.map((item) => (
              <li key={item.id} data-state={item.state}>
                <i aria-hidden="true" />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </li>
            ))}
          </ol>
        </section>

            <section className={styles.crewPresenceMatrix} aria-label="AI 팀원 현재 상태">
              <header>
                <div>
                  <span>AI 팀원</span>
                  <strong>{crewPresenceRows.length ? `${crewPresenceRows.length}명 팀원 상태` : "AI 팀원 준비"}</strong>
                </div>
                <small>팀원 · 작업 · 승인 · 기억 · 업무 도구를 한 줄로 봅니다</small>
              </header>
              {crewPresenceRows.length ? (
                <ol>
                  {crewPresenceRows.map((row) => (
                    <li
                      key={row.id}
                      data-state={row.state}
                      data-crew-presence-row-compact="worker_queue_status_only_details_inside"
                      data-crew-presence-row-compact-summary={`${row.name} · ${row.queueLabel} · ${row.stateLabel}`}
                      data-crew-presence-row-external-mutation="false"
                    >
                      <span>
                        {row.teamLabel.slice(0, 1).toUpperCase()}
                        <WorkSignal state={row.state} label={`${row.name} ${row.channelName}`} compact />
                      </span>
                      <div
                        className={styles.crewPresenceMain}
                        aria-label={`${row.name} AI 팀원 한 줄 요약`}
                        data-crew-presence-row-main="worker_queue_status_details_collapsed"
                      >
                        <strong>{row.name}</strong>
                        <small>{row.channelName} · {row.queueLabel} · {row.stateLabel}</small>
                      </div>
                      <details
                        className={styles.crewPresenceDetails}
                        aria-label={`${row.name} AI 팀원 상세`}
                        data-crew-presence-row-details="role_memory_counts_tools_collapsed"
                        data-crew-presence-details-external-mutation="false"
                      >
                        <summary>
                          <span>상세 보기</span>
                          <small>{row.roleTitle} · 작업 {row.runningCount} · 승인 {row.approvalCount}</small>
                        </summary>
                        <p title={row.brief}>{row.brief}</p>
                        <em className={styles.crewPersonality}>{row.personalityPreview}</em>
                        <dl>
                          <div>
                            <dt>상태</dt>
                            <dd>{row.stateLabel}</dd>
                          </div>
                          <div>
                            <dt>작업</dt>
                            <dd>{row.runningCount}</dd>
                          </div>
                          <div>
                            <dt>승인</dt>
                            <dd>{row.approvalCount}</dd>
                          </div>
                          <div>
                            <dt>결과</dt>
                            <dd>{row.resultCount}</dd>
                          </div>
                          <div>
                            <dt>기억</dt>
                            <dd>{row.memoryCount}/{row.memoryTotal || "?"}</dd>
                          </div>
                          <div>
                            <dt>업무 도구</dt>
                            <dd>{row.skillCount}</dd>
                          </div>
                        </dl>
                        <button
                          type="button"
                          onClick={() => onOpenMemoryFile?.(row.memoryPath)}
                          disabled={!onOpenMemoryFile}
                        >
                          기억 열기
                        </button>
                      </details>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>AI 팀원을 추가하면 역할별 작업, 기억, 실행 상태가 이곳에 먼저 표시됩니다.</p>
              )}
            </section>
          </div>
        </details>

        <ol className={styles.stageRail} aria-label="AI 오피스가 열리는 순서">
          {stageCards.map((stage) => (
            <li key={stage.id} data-state={stage.state}>
              <span>{stage.label}</span>
              <strong>{stage.detail}</strong>
              <i aria-hidden="true">
                <b style={{ width: `${stage.progress}%` }} />
              </i>
            </li>
          ))}
        </ol>
      </section>

      <details
        className={styles.officeFlowArchive}
        open={mailOpsSupportedWorkFocusRoute === "mailops_triage_to_approval"}
        data-office-flow-archive-open-reason={
          mailOpsSupportedWorkFocusRoute === "mailops_triage_to_approval" ? "mailops_workbench_deeplink" : "manual"
        }
      >
        <summary>
          <span>운영 흐름</span>
          <strong>분배, 메신저, 메일 승인 흐름은 필요할 때만 펼칩니다</strong>
          <small>
            승인 {approvalWaitCount} · 메일 {mailOpsLoopCards.length + mailOpsApprovalAssistantQueue.length} · 팀원 {crewMembers.length}
          </small>
        </summary>
        <div className={styles.officeFlowArchiveBody}>
      <section className={styles.officeCommandBridge} aria-label="채팅형 업무 흐름">
        <header>
          <div>
            <span>메인 컨트롤</span>
            <strong>채팅에서 맡기면 AI 팀원이 나눠 처리합니다</strong>
          </div>
          <small>{activeChannelLabels.length ? activeChannelLabels.join(" · ") : "앱 메인 컨트롤 채널"}</small>
        </header>
        <ol>
          <li data-state="done">
            <span>1</span>
            <div>
              <strong>대화에서 업무 접수</strong>
              <small>새 채팅 또는 선택한 외부 알림 채널에서 요청을 받습니다.</small>
            </div>
          </li>
          <li data-state={crewMembers.length > 1 ? "done" : "active"}>
            <span>2</span>
            <div>
              <strong>역할별 AI 팀원 분배</strong>
              <small>{crewMembers.length ? `${crewMembers.length}명 팀원이 기억 기준으로 판단` : "기본 비서가 먼저 분류"}</small>
            </div>
          </li>
          <li data-state={visibleWorkCount > 0 ? "active" : "todo"}>
            <span>3</span>
            <div>
              <strong>오피스에서 진행 확인</strong>
              <small>{visibleWorkCount > 0 ? `${visibleWorkCount}개 업무가 데스크에 표시됨` : "실행되면 이곳에 상태가 쌓임"}</small>
            </div>
          </li>
          <li data-state={approvalWaitCount > 0 ? "active" : "todo"}>
            <span>4</span>
            <div>
              <strong>마지막 확인 후 진행</strong>
              <small>{approvalWaitCount ? `${approvalWaitCount}개 승인 후보 대기` : "발송·등록·삭제는 앱에서 다시 확인"}</small>
            </div>
          </li>
        </ol>
      </section>

      <section className={styles.messengerConnectionPanel} aria-label="메신저 연결 관제">
        <header>
          <div>
            <span>메신저 연결</span>
            <strong>{connectedMessengerCount ? `${connectedMessengerCount}개 채널 연결` : "앱 채널 대기"}</strong>
          </div>
          <small>외부 메신저는 결정함과 팀원 작업함으로만 들어옵니다</small>
        </header>
        {messengerConnections.length ? (
          <ol>
            {messengerConnections.slice(0, 6).map((connection) => (
              <li key={connection.id} data-state={connection.state}>
                <span>{connection.statusLabel}</span>
                <div>
                  <strong>{connection.label}</strong>
                  <small>{connection.targetLabel}</small>
                  <p>{connection.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>앱 메인 컨트롤에서 먼저 받고, Telegram/Slack/Discord가 연결되면 승인과 수정 요청이 여기로 흐릅니다.</p>
        )}
      </section>

      <section className={styles.approvalNotificationBridge} aria-label="오피스 승인함과 마지막 확인 흐름">
        <header>
          <div>
            <span>오피스 승인함</span>
            <strong>오피스 승인함이 기본 승인함입니다</strong>
          </div>
          <small>메일·일정·외부 사이트 후보는 먼저 앱 안으로 모이고, 사용자가 승인할 때만 밖으로 나갑니다</small>
        </header>
        <ol>
          {approvalBridgeSteps.map((step, index) => (
            <li key={step.id} data-state={step.state}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
            </li>
          ))}
        </ol>
        <p>
          Telegram·Slack·Discord는 없어도 됩니다. 기본은 앱의 오피스 승인함이며, 외부 채널은 바깥에서도 실행하기·고쳐달라고 하기·보류하기 결정만
          남기기 위한 선택 경로입니다.
        </p>
      </section>

      <section className={styles.mailOpsOfficeLoop} aria-label="메일 일정 승인 흐름">
        <header>
          <div>
            <span>메일 승인 흐름</span>
            <strong>메일에서 답장·일정 승인까지</strong>
          </div>
          <small>
            답장 {mailReplyCandidateCount} · 일정 {calendarCandidateCount} · 최종 확인 {approvalWaitCount}
          </small>
        </header>
        <div
          className={styles.mailOpsWorkMap}
          aria-label="메일 업무 전체 처리 지도"
          data-mail-work-map-contract="view_recipient_bulk_ops_connection_approval_learning"
          data-connection-policy="optional_after_work_choice"
          data-send-policy="final_confirmation_required"
          data-learning-policy="decision_memory_without_raw_addresses"
        >
          <header>
            <div>
              <span>업무 지도</span>
              <strong>보기, 대상 판단, 대량 발송, 운영 예외, 연결, 승인, 학습을 한 흐름으로 봅니다</strong>
            </div>
            <small>메일 연결은 필요한 단계에서만 열고, 실제 발송은 마지막 확인 전까지 잠급니다.</small>
          </header>
          <ol>
            {mailOpsWorkMapItems.map((item, index) => (
              <li
                key={item.id}
                data-step={item.id}
                data-state={item.state}
                data-mail-work-map-row-compact="step_label_status_only_details_inside"
                data-mail-work-map-row-compact-summary={`${index + 1}. ${item.label} · ${item.title}`}
              >
                <span>{index + 1}</span>
                <div
                  className={styles.mailOpsWorkMapMain}
                  aria-label={`${item.title} 메일 업무 단계 한 줄 요약`}
                  data-mail-work-map-row-main="step_label_status_details_collapsed"
                >
                  <b>{item.label}</b>
                  <strong>{item.title}</strong>
                </div>
                <details
                  className={styles.mailOpsWorkMapDetails}
                  aria-label={`${item.title} 메일 업무 단계 상세`}
                  data-mail-work-map-row-details="detail_policy_status_collapsed"
                  data-mail-work-map-details-external-mutation="false"
                >
                  <summary>
                    <span>상세 보기</span>
                    <small>{item.detail}</small>
                  </summary>
                  <p>{item.detail}</p>
                  <small>
                    {item.id === "final_approval"
                      ? "승인된 후보만 마지막 확인으로 이동하고 실제 발송은 계속 잠깁니다."
                      : item.id === "connection_prep"
                        ? "메일 연결은 업무를 고른 뒤 필요한 단계에서만 엽니다."
                        : "필요한 정보만 확인하고 다음 단계로 넘깁니다."}
                  </small>
                </details>
              </li>
            ))}
          </ol>
        </div>
        <ol className={styles.mailOpsOfficeSteps}>
          {mailOpsLoopSteps.map((step) => (
            <li key={step.id} data-state={step.state}>
              <i aria-hidden="true" />
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </li>
          ))}
        </ol>
        <div className={styles.mailOpsOfficeContinuity} aria-label="메일 오피스 연결 이어가기">
          <header>
            <div>
              <span>연결 이어가기</span>
              <strong>공식 연결이 막혀도 승인함까지 이어집니다</strong>
            </div>
            <small>보관함과 내 PC 작업 도우미는 후보 정리까지만, 외부 실행은 최종 확인 전 잠금</small>
          </header>
          <ol>
            {mailOpsOfficeContinuity.map((item, index) => (
              <li
                key={item.id}
                data-state={item.state}
                data-mailops-continuity-row-compact="step_label_status_only_details_inside"
                data-mailops-continuity-row-compact-summary={`${index + 1}. ${item.label} · ${item.detail}`}
                data-mailops-continuity-row-external-mutation="false"
              >
                <span>{index + 1}</span>
                <div
                  className={styles.mailOpsOfficeContinuityMain}
                  aria-label={`${item.label} 메일 오피스 연결 한 줄 요약`}
                  data-mailops-continuity-row-main="step_label_details_collapsed"
                >
                  <strong>{item.label}</strong>
                </div>
                <details
                  className={styles.mailOpsOfficeContinuityDetails}
                  aria-label={`${item.label} 메일 오피스 연결 상세`}
                  data-mailops-continuity-row-details="status_reason_boundary_collapsed"
                  data-mailops-continuity-details-external-mutation="false"
                >
                  <summary>
                    <span>상세 보기</span>
                    <small>{item.detail}</small>
                  </summary>
                  <p>{item.detail}</p>
                  <small>
                    {item.id === "assistant_inbox"
                      ? "승인함 후보만 최종 확인으로 이동하고 실제 발송은 계속 잠깁니다."
                      : item.id === "computer_use"
                        ? "화면 읽기와 후보 정리까지만 진행하고 클릭/입력은 최종 확인 전까지 잠깁니다."
                        : item.id === "vault"
                          ? "보안값은 채팅이 아니라 보관함에서만 다룹니다."
                          : "공식 메일 연결이 가능하면 이 경로를 우선 사용합니다."}
                  </small>
                </details>
              </li>
            ))}
          </ol>
        </div>
        {mailOpsLoopCards.length ? (
          <div className={styles.mailOpsOfficeCards} aria-label="메일 일정 실행 후보">
            {mailOpsLoopCards.map((card) => (
              <article
                key={card.id}
                data-kind={card.kind}
                data-readiness={card.readiness}
                data-mailops-office-card-compact="kind_title_action_only_details_inside"
                data-mailops-office-card-compact-summary={`${card.label} · ${card.title} · ${card.source || "메일 업무 후보"}`}
                data-mailops-office-card-external-mutation="false"
              >
                <span>{card.label}</span>
                <div
                  className={styles.mailOpsOfficeCardMain}
                  aria-label={`${card.title} 메일 일정 실행 후보 한 줄 요약`}
                  data-mailops-office-card-main="title_source_details_collapsed"
                >
                  <strong>{card.title}</strong>
                  <small>{card.source || "메일 업무 후보"}</small>
                </div>
                <details
                  className={styles.mailOpsOfficeCardDetails}
                  aria-label={`${card.title} 메일 일정 실행 후보 상세`}
                  data-mailops-office-card-details="detail_next_choice_collapsed"
                  data-mailops-office-card-details-external-mutation="false"
                >
                  <summary>
                    <span>상세 보기</span>
                    <small>막히면: {visibleOfficeNextChoice(card.nextUserChoice)}</small>
                  </summary>
                  <p>{card.detail}</p>
                  <small>막히면: {visibleOfficeNextChoice(card.nextUserChoice)}</small>
                </details>
                <button
                  type="button"
                  onClick={() => {
                    const target = finalActionCandidates.find((item) => item.id === card.id);
                    if (target) onPrepareFinalConfirmation?.(target);
                  }}
                  disabled={!onPrepareFinalConfirmation || preparingFinalActionId === card.id}
                >
                  {preparingFinalActionId === card.id ? "준비 중" : "마지막 확인 준비"}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p>
            메일 연결 후 메일 점검이 메일함을 읽으면 답장 후보와 일정 후보를 만들고, 오피스 승인함 확인 뒤 최종 실행
            카드로 보냅니다.
          </p>
        )}
        {mailOpsApprovalAssistantQueue.length ||
        mailOpsRecipientListReview ||
        mailOpsSupportedWorkFocusRoute === "mailops_triage_to_approval" ? (
          <div className={styles.mailOpsAssistantQueue} aria-label="메일 오피스 승인함">
            <header>
              <div>
                <span>메일 승인함</span>
                <strong>답장·일정 후보 승인함</strong>
              </div>
              <small>초안 보기 → 실행하기/고쳐달라고 하기/보류하기 → 마지막 확인 순서로 잠겨 있습니다</small>
            </header>
            <section
              className={styles.mailOpsOfficeTopWorkBar}
              aria-label="메일 자동화 첫 업무 바"
              data-mailops-office-top-work-bar="work_rows_draft_candidates_approval_lock_first"
              data-mailops-office-top-work-visible="mail_rows_draft_candidates_approval_queue_final_lock"
              data-mailops-office-top-work-hidden="engine_proof_scenario_settings_diagnostics_until_details"
              data-mailops-office-top-work-source="mailOpsWorkQueueReviewSummary_and_finalActionCandidates"
              data-mailops-office-top-work-final-boundary="final_confirmation_before_external_send"
              data-mailops-office-top-work-external-mutation="false"
            >
              <article data-step="work_rows" data-state={mailOpsWorkQueueReviewSummary.total ? "ready" : "idle"}>
                <span>처리표</span>
                <strong>{mailOpsWorkQueueReviewSummary.total ? `${mailOpsWorkQueueReviewSummary.total}건 분류` : "메일 읽기 대기"}</strong>
                <small>답장·제외·확인</small>
              </article>
              <article data-step="draft_candidates" data-state={mailOpsWorkQueueReviewSummary.approve ? "approval" : "locked"}>
                <span>초안 후보</span>
                <strong>{mailOpsWorkQueueReviewSummary.approve ? `${mailOpsWorkQueueReviewSummary.approve}건 승인 대기` : "후보 없음"}</strong>
                <small>승인 전 발송 없음</small>
              </article>
              <article data-step="approval_queue" data-state={mailOpsApprovalAssistantQueue.length ? "approval" : "locked"}>
                <span>승인함</span>
                <strong>실행·수정·보류</strong>
                <small>사용자 결정</small>
              </article>
              <article data-step="final_lock" data-state="locked">
                <span>잠금</span>
                <strong>마지막 확인 전 발송 없음</strong>
                <small>증빙·설정은 상세</small>
              </article>
            </section>
            {mailOpsWorkQueueReviewSummary.total ? (
              <section
                className={styles.mailOpsAssistantBatchContext}
                aria-label="메일 직원 작업함 승인 묶음 요약"
                data-mailops-office-batch-context="work_queue_review_counts_to_final_confirmation"
                data-mailops-office-batch-total={mailOpsWorkQueueReviewSummary.total}
                data-mailops-office-batch-approve={mailOpsWorkQueueReviewSummary.approve}
                data-mailops-office-batch-review={mailOpsWorkQueueReviewSummary.revise + mailOpsWorkQueueReviewSummary.hold}
                data-mailops-office-batch-exclude={mailOpsWorkQueueReviewSummary.exclude}
                data-mailops-office-batch-engine-handoff={mailOpsWorkQueueAutomationEvidence.evidenceContract}
                data-mailops-office-batch-engine-path={mailOpsWorkQueueAutomationEvidence.enginePathContract}
                data-mailops-office-batch-approval-gate={mailOpsWorkQueueAutomationEvidence.approvalGateContract}
                data-mailops-office-batch-automation-proof={mailOpsWorkQueueAutomationProofLabel}
                data-mailops-office-batch-external-mutation="false"
              >
                <span>작업함 묶음</span>
                <dl>
                  <div data-state="ready">
                    <dt>승인 대기</dt>
                    <dd>{mailOpsWorkQueueReviewSummary.approve}건</dd>
                  </div>
                  <div data-state="review">
                    <dt>수정/확인</dt>
                    <dd>{mailOpsWorkQueueReviewSummary.revise + mailOpsWorkQueueReviewSummary.hold}건</dd>
                  </div>
                  <div data-state="excluded">
                    <dt>제외</dt>
                    <dd>{mailOpsWorkQueueReviewSummary.exclude}건</dd>
                  </div>
                </dl>
                <small>승인 대기 항목만 마지막 확인으로 이동 · 보류/제외 항목은 실행하지 않음</small>
                <small>{mailOpsWorkQueueAutomationProofLabel}</small>
              </section>
            ) : null}
            {mailOpsWorkBenchRows.length ||
            userComposedMailApprovalRows.length ||
            mailOpsRecipientListReview ||
            mailOpsSupportedWorkFocusRoute === "mailops_triage_to_approval" ? (
              <section
                className={styles.mailOpsWorkBench}
                aria-label="메일 답장 선별 작업대"
                data-mailops-workbench="reply_needed_hold_exclude_draft_review_approval"
                data-mailops-workbench-total={mailOpsWorkQueueReviewSummary.total}
                data-mailops-workbench-send-ready={mailOpsWorkQueueReviewSummary.approve}
                data-mailops-workbench-needs-review={mailOpsWorkQueueReviewSummary.revise + mailOpsWorkQueueReviewSummary.hold}
                data-mailops-workbench-excluded={mailOpsWorkQueueReviewSummary.exclude}
                data-mailops-workbench-user-composed-path="compose_check_edit_approval_final_send"
                data-mailops-workbench-external-mutation="false"
              >
                <header>
                  <div>
                    <span>메일 작업대</span>
                    <strong>답장 보낼 메일만 골라 승인합니다</strong>
                  </div>
                  <small>받은 메일과 직접 작성한 메일 모두 초안 점검, 수정, 승인, 마지막 확인 뒤에만 발송합니다.</small>
                </header>
                <nav
                  className={styles.mailOpsWorkBenchPrimaryRail}
                  aria-label="메일 작업대 핵심 행동"
                  data-mailops-workbench-primary-rail="visible_actions_first_supporting_details_folded"
                  data-mailops-workbench-primary-rail-actions="mail_check_rows_composed_mail_connect_final_confirmation"
                  data-mailops-workbench-primary-rail-visible="one_primary_action_then_more_inside_details"
                  data-mailops-workbench-primary-visible-count="1"
                  data-mailops-workbench-primary-hidden-count="3"
                  data-mailops-workbench-primary-rail-external-mutation="false"
                >
                  <a
                    href={mailOpsWorkBenchRows.length ? "#mailops-workbench-rows" : "/?setupTask=feature-mail"}
                    data-mailops-workbench-primary-action="mail_check_or_rows"
                    data-mailops-workbench-primary-action-state={mailOpsWorkBenchRows.length ? "ready" : "needs_check"}
                  >
                    <span>메일 점검</span>
                    <strong>{mailOpsWorkBenchRows.length ? `${mailOpsWorkBenchRows.length}건 보기` : "점검 시작"}</strong>
                  </a>
                  <details
                    className={styles.mailOpsWorkBenchPrimaryMore}
                    aria-label="메일 작업대 보조 행동"
                    data-mailops-workbench-primary-more="supporting_actions_on_demand"
                    data-mailops-workbench-primary-more-default="closed"
                    data-mailops-workbench-primary-more-visible="summary_only_until_user_opens"
                    data-mailops-workbench-primary-more-hidden-count="3"
                  >
                    <summary>
                      <span>보조 행동</span>
                      <strong>작성·연결·마지막 확인</strong>
                    </summary>
                    <div
                      className={styles.mailOpsWorkBenchPrimaryMoreBody}
                      data-mailops-workbench-primary-more-body="hidden_until_user_opens"
                    >
                      <a
                        href="#mailops-user-composed-check"
                        data-mailops-workbench-primary-action="user_composed_check"
                        data-mailops-workbench-primary-action-state={userComposedMailApprovalRows.length ? "ready" : "empty"}
                      >
                        <span>작성 메일</span>
                        <strong>{userComposedMailApprovalRows.length ? `${userComposedMailApprovalRows.length}건 점검` : "본문 점검"}</strong>
                      </a>
                      <a
                        href="/connect?recommend=company-mail&goal=메일"
                        data-mailops-workbench-primary-action="mail_connection"
                        data-mailops-workbench-primary-action-state={mailOpsWorkBenchRows.length ? "optional" : "needed"}
                      >
                        <span>메일 연결</span>
                        <strong>{mailOpsWorkBenchRows.length ? "연결 확인" : "먼저 연결"}</strong>
                      </a>
                      <a
                        href="#mailops-final-confirmation-queue"
                        data-mailops-workbench-primary-action="final_confirmation"
                        data-mailops-workbench-primary-action-state={mailOpsFinalConfirmationReadyRows.length ? "ready" : "locked"}
                      >
                        <span>마지막 확인</span>
                        <strong>{mailOpsFinalConfirmationReadyRows.length ? `${mailOpsFinalConfirmationReadyRows.length}건 대기` : "잠금"}</strong>
                      </a>
                    </div>
                  </details>
                </nav>
                <section
                  className={styles.mailOpsAiRoleExecutionBridge}
                  aria-label="AI 역할 실행 브리지"
                  data-mailops-workbench-ai-spine="ai_connection_role_payload_real_answer_workbench_final_lock"
                  data-mailops-ai-role-execution-bridge="ai_connection_role_real_answer_workbench_approval_execution"
                  data-mailops-ai-role-execution-bridge-visible="one_line_summary_details_inside"
                  data-mailops-ai-role-execution-bridge-steps-default="closed"
                  data-mailops-ai-role-execution-bridge-steps-visible="summary_only_until_user_opens"
                  data-mailops-ai-role-execution-bridge-summary={mailOpsAiRoleExecutionBridgeSummary}
                  data-mailops-workbench-ai-spine-router="AIRuntimeRouter"
                  data-mailops-ai-role-execution-bridge-router="AIRuntimeRouter"
                  data-mailops-workbench-ai-spine-role-contract="role_assignment_runtime_v1"
                  data-mailops-ai-role-execution-bridge-role-contract="createAITextGenerationPayload.roleContext"
                  data-mailops-workbench-ai-spine-payload-contract="createAITextGenerationPayload.roleContext"
                  data-mailops-workbench-ai-spine-receipt-contract="aiRuntimeReceipt.runtimeContext"
                  data-mailops-ai-role-execution-bridge-receipt-contract="aiRuntimeReceipt.runtimeContext"
                  data-mailops-workbench-ai-spine-work-contract="role_assignment_to_work_automation_engine_v1"
                  data-mailops-ai-role-execution-bridge-work-contract="role_assignment_to_work_automation_engine_v1"
                  data-mailops-workbench-ai-spine-mailops-contract="mail_teammate_to_conversation_engine_to_mailops_workqueue"
                  data-mailops-ai-role-execution-bridge-mailops-contract="ai_answer_receipt_to_mailops_workqueue_handoff"
                  data-mailops-ai-role-execution-bridge-final-boundary="app_final_confirmation_before_external_send"
                  data-mailops-workbench-ai-spine-visible-first="one_line_ai_status_then_details"
                  data-mailops-workbench-ai-spine-fake-result-policy="stop_before_fake_answer_or_fake_work_card"
                  data-mailops-ai-role-execution-bridge-fake-result-policy="stop_before_fake_answer_or_fake_work_card"
                  data-mailops-ai-role-execution-bridge-external-mutation="false"
                  data-mailops-workbench-ai-spine-external-mutation="false"
                >
                  <div>
                    <span>AI 역할 실행</span>
                    <strong>{mailOpsAiRoleExecutionBridgeSummary}</strong>
                  </div>
                  <small>실제 답변 영수증이 있는 요청만 메일 업무대장과 승인함으로 이어집니다.</small>
                  <details
                    className={styles.mailOpsAiRoleExecutionDetails}
                    aria-label="AI 역할 실행 단계 상세"
                    data-mailops-ai-role-execution-bridge-steps="runtime_steps_on_demand"
                    data-mailops-ai-role-execution-bridge-steps-default="closed"
                  >
                    <summary>
                      <span>실행 단계</span>
                      <strong>{mailOpsAiRoleExecutionBridgeItems.length}단계 확인</strong>
                    </summary>
                    <ol
                      aria-label="AI 역할 실행 단계"
                      data-mailops-ai-role-execution-bridge-steps-body="hidden_until_user_opens"
                    >
                      {mailOpsAiRoleExecutionBridgeItems.map((item) => (
                        <li
                          key={`mailops-ai-role-execution-bridge-${item.id}`}
                          data-mailops-workbench-ai-spine-step={item.id}
                          data-mailops-ai-role-execution-bridge-step={item.id}
                          data-state={item.state}
                        >
                          <span>{item.label}</span>
                          <b>{item.value}</b>
                          <small>{item.detail}</small>
                        </li>
                      ))}
                    </ol>
                  </details>
                </section>
                <section
                  className={styles.mailOpsUnifiedApprovalRunway}
                  aria-label="메일 작업대 통합 승인 레일"
                  data-mailops-unified-approval-runway="provider_composed_mobile_edit_approve_final_confirmation"
                  data-mailops-unified-approval-runway-visible="one_line_source_to_final_lock"
                  data-mailops-unified-approval-runway-flow-default="closed"
                  data-mailops-unified-approval-runway-flow-visible="summary_only_until_user_opens"
                  data-mailops-unified-approval-runway-provider-count={mailOpsWorkBenchRows.length}
                  data-mailops-unified-approval-runway-composed-count={userComposedMailApprovalRows.length}
                  data-mailops-unified-approval-runway-mobile-count={mailOpsMobileHandoffCandidateCount}
                  data-mailops-unified-approval-runway-final-count={mailOpsFinalConfirmationReadyRows.length}
                  data-mailops-unified-approval-runway-flow="edit_to_approval_candidate_to_final_confirmation_to_send_lock"
                  data-mailops-unified-approval-runway-external-mutation="false"
                >
                  <details
                    className={styles.mailOpsUnifiedApprovalFlow}
                    aria-label="메일 작업대 승인 흐름 상세"
                    data-mailops-unified-approval-flow="provider_composed_mobile_final_on_demand"
                    data-mailops-unified-approval-flow-default="closed"
                  >
                    <summary>
                      <span>승인 흐름</span>
                      <strong>메일 종류별 승인 경로</strong>
                      <small>
                        받은 {mailOpsWorkBenchRows.length} · 작성 {userComposedMailApprovalRows.length} · 휴대폰 {mailOpsMobileHandoffCandidateCount} · 마지막 {mailOpsFinalConfirmationReadyRows.length}
                      </small>
                    </summary>
                    <ol data-mailops-unified-approval-flow-body="hidden_until_user_opens">
                      {[
                        {
                          id: "provider",
                          label: "받은 메일",
                          value: `${mailOpsWorkBenchRows.length}건`,
                          detail: "선별/수정 후 승인 후보",
                          state: mailOpsWorkBenchRows.length ? "ready" : "idle",
                        },
                        {
                          id: "composed",
                          label: "작성 메일",
                          value: `${userComposedMailApprovalRows.length}건`,
                          detail: "보내기 전 점검",
                          state: userComposedMailApprovalRows.length ? "ready" : "idle",
                        },
                        {
                          id: "mobile",
                          label: "휴대폰 메일",
                          value: `${mailOpsMobileHandoffCandidateCount}건`,
                          detail: "앱으로 넘겨 승인",
                          state: mailOpsMobileHandoffCandidateCount ? "ready" : "idle",
                        },
                        {
                          id: "final",
                          label: "마지막 확인",
                          value: mailOpsFinalConfirmationReadyRows.length ? `${mailOpsFinalConfirmationReadyRows.length}건` : "잠금",
                          detail: "전송 전 잠금",
                          state: mailOpsFinalConfirmationReadyRows.length ? "approval" : "locked",
                        },
                      ].map((item) => (
                        <li
                          key={`mailops-unified-approval-runway-${item.id}`}
                          data-mailops-unified-approval-runway-step={item.id}
                          data-state={item.state}
                          data-mailops-unified-approval-runway-step-external-mutation="false"
                        >
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                          <small>{item.detail}</small>
                        </li>
                      ))}
                    </ol>
                  </details>
                </section>
                <details
                  className={styles.mailOpsWorkBenchSupportFold}
                  aria-label="메일 작업대 보조 기준"
                  data-mailops-workbench-support-fold="supporting_queue_scope_focus_collapsed"
                  data-mailops-workbench-support-fold-default="closed"
                  data-mailops-workbench-support-fold-external-mutation="false"
                >
                  <summary>
                    <span>작업 기준 더 보기</span>
                    <strong>통합 작업함 · 지원 업무 · 포커스 결과</strong>
                    <small>필요할 때만 열어 보고, 실제 처리는 위 행동과 메일 행에서 합니다.</small>
                  </summary>
                  <section
                  className={styles.mailOpsUnifiedQueue}
                  aria-label="메일 통합 작업함"
                  data-mailops-unified-queue="provider_mobile_composed_bulk_one_line_rows"
                  data-mailops-unified-queue-row-mode="one_line_summary_details_inside"
                  data-mailops-unified-queue-disclosure="first_one_then_more_inside_details"
                  data-mailops-unified-queue-total={mailOpsUnifiedQueueRows.reduce((total, row) => total + row.count, 0)}
                  data-mailops-unified-queue-active={mailOpsUnifiedQueueActiveCount}
                  data-mailops-unified-queue-visible-count={visibleMailOpsUnifiedQueueRows.length}
                  data-mailops-unified-queue-hidden-count={hiddenMailOpsUnifiedQueueRows.length}
                  data-mailops-unified-provider-count={mailOpsWorkBenchRows.length}
                  data-mailops-unified-mobile-count={mailOpsGroupCount("mobile_handoff")}
                  data-mailops-unified-composed-count={userComposedMailApprovalRows.length}
                  data-mailops-unified-bulk-count={mailOpsBulkSendReviewPlan.candidateCount}
                  data-mailops-unified-external-mutation="false"
                >
                  <header>
                    <div>
                      <span>통합 작업함</span>
                      <strong>메일 종류별로 한 줄만 먼저 봅니다</strong>
                    </div>
                    <small>받은 메일, 휴대폰 메일, 직접 작성, 대량 발송을 같은 승인 규칙으로 묶습니다.</small>
                  </header>
                  <ol data-mailops-unified-queue-primary-list="first_one">
                    {visibleMailOpsUnifiedQueueRows.map((row) => (
                      <li
                        key={`mailops-unified-${row.id}`}
                        data-mailops-unified-row={row.id}
                        data-mailops-unified-row-source={row.sourceKind}
                        data-state={row.state}
                        data-mailops-unified-row-count={row.count}
                        data-mailops-unified-row-compact="source_count_action_only_details_inside"
                        data-mailops-unified-row-compact-summary={`${row.label} · ${row.oneLine}`}
                        data-mailops-unified-row-external-mutation="false"
                      >
                        <span>{row.label}</span>
                        <strong>{row.oneLine}</strong>
                        <a
                          className={styles.mailOpsUnifiedAction}
                          href={row.actionHref}
                          data-mailops-unified-row-action={row.actionContract}
                          data-mailops-unified-row-action-label={row.actionLabel}
                          data-mailops-unified-row-action-external-mutation="false"
                        >
                          {row.actionLabel}
                        </a>
                        <details
                          aria-label={`${row.label} 메일 통합 작업 상세`}
                          data-mailops-unified-row-details="reason_next_action_collapsed"
                          data-mailops-unified-row-details-external-mutation="false"
                        >
                          <summary>상세 보기</summary>
                          <p>{row.detail}</p>
                          <small>{row.nextAction} · 실제 발송은 앱 마지막 확인 전까지 잠금</small>
                        </details>
                      </li>
                    ))}
                  </ol>
                  {hiddenMailOpsUnifiedQueueRows.length ? (
                    <details
                      className={styles.mailOpsUnifiedQueueMore}
                      aria-label="나머지 메일 종류"
                      data-mailops-unified-queue-more="remaining_sources_on_demand"
                      data-mailops-unified-queue-more-default="closed"
                    >
                      <summary>
                        <span>나머지 메일 종류</span>
                        <strong>{hiddenMailOpsUnifiedQueueRows.length}개 더 보기</strong>
                      </summary>
                      <ol data-mailops-unified-queue-more-list="remaining_sources_collapsed">
                        {hiddenMailOpsUnifiedQueueRows.map((row) => (
                          <li
                            key={`mailops-unified-more-${row.id}`}
                            data-mailops-unified-row={row.id}
                            data-mailops-unified-row-source={row.sourceKind}
                            data-state={row.state}
                            data-mailops-unified-row-count={row.count}
                            data-mailops-unified-row-compact="source_count_action_only_details_inside"
                            data-mailops-unified-row-compact-summary={`${row.label} · ${row.oneLine}`}
                            data-mailops-unified-row-external-mutation="false"
                          >
                            <span>{row.label}</span>
                            <strong>{row.oneLine}</strong>
                            <a
                              className={styles.mailOpsUnifiedAction}
                              href={row.actionHref}
                              data-mailops-unified-row-action={row.actionContract}
                              data-mailops-unified-row-action-label={row.actionLabel}
                              data-mailops-unified-row-action-external-mutation="false"
                            >
                              {row.actionLabel}
                            </a>
                            <details
                              aria-label={`${row.label} 메일 통합 작업 상세`}
                              data-mailops-unified-row-details="reason_next_action_collapsed"
                              data-mailops-unified-row-details-external-mutation="false"
                            >
                              <summary>상세 보기</summary>
                              <p>{row.detail}</p>
                              <small>{row.nextAction} · 실제 발송은 앱 마지막 확인 전까지 잠금</small>
                            </details>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </section>
                <section
                  className={styles.mailOpsSupportedWorkRail}
                  aria-label="메일 업무 지원 범위 한 줄 보기"
                  data-mailops-supported-work-rail="domain_supported_work_labels_one_line"
                  data-mailops-supported-work-row-mode="one_line_label_details_inside"
                  data-mailops-supported-work-disclosure="first_one_then_more_inside_details"
                  data-mailops-supported-work-count={mailOpsOperationsWorkbenchPlan.supportedWorkLabels.length}
                  data-mailops-supported-work-visible-count={visibleMailOpsSupportedWorkRows.length}
                  data-mailops-supported-work-primary-count={visibleMailOpsSupportedWorkRows.length}
                  data-mailops-supported-work-hidden-count={hiddenMailOpsSupportedWorkRows.length}
                  data-mailops-supported-work-external-mutation="false"
                  data-mailops-supported-work-final-approval="send_calendar_file_share_delete_requires_app_final_confirmation"
                >
                  <header>
                    <div>
                      <span>지원 업무</span>
                      <strong>메일 업무 종류를 한 줄로 접어 봅니다</strong>
                    </div>
                    <small>{mailOpsOperationsWorkbenchPlan.supportedWorkLabels.length}개 범위 · 발송/일정/공유/삭제는 마지막 확인 뒤</small>
                  </header>
                  <ol data-mailops-supported-work-primary-list="first_one">
                    {visibleMailOpsSupportedWorkRows.map((row) => (
                      <li
                        key={row.id}
                        data-mailops-supported-work-row={row.route}
                        data-state={row.state}
                        data-selected={row.route === mailOpsSupportedWorkFocusRoute ? "true" : "false"}
                        data-mailops-supported-work-row-compact="label_only_details_inside"
                        data-mailops-supported-work-row-action={row.actionContract}
                        data-mailops-supported-work-row-action-href={row.actionHref}
                        data-mailops-supported-work-row-external-mutation="false"
                      >
                        <span>{row.label}</span>
                        <a
                          className={styles.mailOpsSupportedWorkAction}
                          href={row.actionHref}
                          data-mailops-supported-work-action={row.actionContract}
                          data-mailops-supported-work-action-label={row.actionLabel}
                          data-mailops-supported-work-action-external-mutation="false"
                        >
                          {row.actionLabel}
                        </a>
                        <details
                          aria-label={`${row.label} 메일 업무 지원 상세`}
                          data-mailops-supported-work-row-details="route_policy_collapsed"
                          data-mailops-supported-work-row-route={row.route}
                        >
                          <summary>상세</summary>
                          <small>{row.detail}</small>
                        </details>
                      </li>
                    ))}
                  </ol>
                  {hiddenMailOpsSupportedWorkRows.length ? (
                    <details
                      className={styles.mailOpsSupportedWorkMore}
                      aria-label="나머지 지원 업무"
                      data-mailops-supported-work-more="remaining_supported_work_on_demand"
                      data-mailops-supported-work-more-default="closed"
                    >
                      <summary>
                        <span>나머지 지원 업무</span>
                        <strong>{hiddenMailOpsSupportedWorkRows.length}개 더 보기</strong>
                      </summary>
                      <ol data-mailops-supported-work-more-list="remaining_supported_work_collapsed">
                        {hiddenMailOpsSupportedWorkRows.map((row) => (
                          <li
                            key={`more-${row.id}`}
                            data-mailops-supported-work-row={row.route}
                            data-state={row.state}
                            data-selected={row.route === mailOpsSupportedWorkFocusRoute ? "true" : "false"}
                            data-mailops-supported-work-row-compact="label_only_details_inside"
                            data-mailops-supported-work-row-action={row.actionContract}
                            data-mailops-supported-work-row-action-href={row.actionHref}
                            data-mailops-supported-work-row-external-mutation="false"
                          >
                            <span>{row.label}</span>
                            <a
                              className={styles.mailOpsSupportedWorkAction}
                              href={row.actionHref}
                              data-mailops-supported-work-action={row.actionContract}
                              data-mailops-supported-work-action-label={row.actionLabel}
                              data-mailops-supported-work-action-external-mutation="false"
                            >
                              {row.actionLabel}
                            </a>
                            <details
                              aria-label={`${row.label} 메일 업무 지원 상세`}
                              data-mailops-supported-work-row-details="route_policy_collapsed"
                              data-mailops-supported-work-row-route={row.route}
                            >
                              <summary>상세</summary>
                              <small>{row.detail}</small>
                            </details>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </section>
                <section
                  className={styles.mailOpsSupportedWorkFocus}
                  aria-label="메일 지원 업무 현재 초점"
                  data-mailops-supported-work-focus="hash_to_workbench_filter"
                  data-mailops-supported-work-focus-route={mailOpsSupportedWorkFocusRoute}
                  data-mailops-supported-work-focus-label={mailOpsSupportedWorkFocusLabel}
                  data-mailops-supported-work-focus-next={mailOpsSupportedWorkFocusNext}
                  data-mailops-supported-work-focus-external-mutation="false"
                >
                  <span>현재 초점</span>
                  <strong>{mailOpsSupportedWorkFocusLabel}</strong>
                  <small>{mailOpsSupportedWorkFocusNext} · 외부 실행 없음</small>
                </section>
                <section
                  className={styles.mailOpsSupportedWorkFocusResults}
                  aria-label="메일 지원 업무 포커스 결과"
                  data-mailops-supported-work-focus-results="focused_rows_one_line_details_inside"
                  data-mailops-supported-work-focus-results-disclosure="first_one_then_more_inside_details"
                  data-mailops-supported-work-focus-results-route={mailOpsSupportedWorkFocusRoute}
                  data-mailops-supported-work-focus-results-count={mailOpsSupportedWorkFocusRows.length}
                  data-mailops-supported-work-focus-results-visible-count={visibleMailOpsSupportedWorkFocusRows.length}
                  data-mailops-supported-work-focus-results-hidden-count={hiddenMailOpsSupportedWorkFocusRows.length}
                  data-mailops-supported-work-focus-results-external-mutation="false"
                >
                  <header>
                    <span>포커스 결과</span>
                    <strong>{mailOpsSupportedWorkFocusRows.length ? `${mailOpsSupportedWorkFocusRows.length}개 후보` : "지원 업무를 선택하면 후보를 접어 보여줍니다"}</strong>
                    <small>{mailOpsSupportedWorkFocusNext}</small>
                  </header>
                  {mailOpsSupportedWorkFocusRows.length ? (
                    <>
                    <ol data-mailops-supported-work-focus-results-primary-list="first_one">
                      {visibleMailOpsSupportedWorkFocusRows.map((row) => (
                        <li
                          key={`mailops-supported-work-focus-result-${row.id}`}
                          data-mailops-supported-work-focus-result-row={row.id}
                          data-state={row.state}
                          data-mailops-supported-work-focus-result-compact="label_value_only_details_inside"
                          data-mailops-supported-work-focus-result-action={row.actionContract}
                          data-mailops-supported-work-focus-result-action-kind={row.actionKind}
                          data-mailops-supported-work-focus-result-external-mutation="false"
                        >
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                          {row.actionKind === "anchor" ? (
                            <a
                              className={styles.mailOpsSupportedWorkFocusResultAction}
                              href={row.actionHref}
                              data-mailops-supported-work-focus-result-action-button={row.actionContract}
                              data-mailops-supported-work-focus-result-action-external-mutation="false"
                            >
                              {row.actionLabel}
                            </a>
                          ) : (
                            <button
                              type="button"
                              className={styles.mailOpsSupportedWorkFocusResultAction}
                              data-mailops-supported-work-focus-result-action-button={row.actionContract}
                              data-mailops-supported-work-focus-result-action-external-mutation="false"
                              onClick={() => {
                                if (row.actionKind === "select_workbench" && row.workbenchRowId) {
                                  setMailOpsSelectedWorkBenchRowIds([row.workbenchRowId]);
                                  setMailOpsWorkBenchSaveMessage("포커스 결과에서 선택한 메일만 선택했습니다. 실제 발송은 마지막 확인 전까지 잠겨 있습니다.");
                                }
                                if (row.actionKind === "open_composed" && row.workItem) {
                                  handleOpenUserComposedMailEditor(row.workItem);
                                }
                              }}
                            >
                              {row.actionLabel}
                            </button>
                          )}
                          <details
                            aria-label={`${row.label} 포커스 결과 상세`}
                            data-mailops-supported-work-focus-result-details="detail_collapsed"
                            data-mailops-supported-work-focus-result-details-external-mutation="false"
                          >
                            <summary>상세</summary>
                            <small>{row.detail}</small>
                          </details>
                        </li>
                      ))}
                    </ol>
                    {hiddenMailOpsSupportedWorkFocusRows.length ? (
                      <details
                        className={styles.mailOpsSupportedWorkFocusMore}
                        aria-label="나머지 포커스 결과"
                        data-mailops-supported-work-focus-more="remaining_focus_results_on_demand"
                        data-mailops-supported-work-focus-more-default="closed"
                      >
                        <summary>
                          <span>나머지 후보</span>
                          <strong>{hiddenMailOpsSupportedWorkFocusRows.length}개 더 보기</strong>
                        </summary>
                        <ol data-mailops-supported-work-focus-more-list="remaining_focus_results_collapsed">
                          {hiddenMailOpsSupportedWorkFocusRows.map((row) => (
                            <li
                              key={`mailops-supported-work-focus-result-more-${row.id}`}
                              data-mailops-supported-work-focus-result-row={row.id}
                              data-state={row.state}
                              data-mailops-supported-work-focus-result-compact="label_value_only_details_inside"
                              data-mailops-supported-work-focus-result-action={row.actionContract}
                              data-mailops-supported-work-focus-result-action-kind={row.actionKind}
                              data-mailops-supported-work-focus-result-external-mutation="false"
                            >
                              <span>{row.label}</span>
                              <strong>{row.value}</strong>
                              {row.actionKind === "anchor" ? (
                                <a
                                  className={styles.mailOpsSupportedWorkFocusResultAction}
                                  href={row.actionHref}
                                  data-mailops-supported-work-focus-result-action-button={row.actionContract}
                                  data-mailops-supported-work-focus-result-action-external-mutation="false"
                                >
                                  {row.actionLabel}
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.mailOpsSupportedWorkFocusResultAction}
                                  data-mailops-supported-work-focus-result-action-button={row.actionContract}
                                  data-mailops-supported-work-focus-result-action-external-mutation="false"
                                  onClick={() => {
                                    if (row.actionKind === "select_workbench" && row.workbenchRowId) {
                                      setMailOpsSelectedWorkBenchRowIds([row.workbenchRowId]);
                                      setMailOpsWorkBenchSaveMessage("포커스 결과에서 선택한 메일만 선택했습니다. 실제 발송은 마지막 확인 전까지 잠겨 있습니다.");
                                    }
                                    if (row.actionKind === "open_composed" && row.workItem) {
                                      handleOpenUserComposedMailEditor(row.workItem);
                                    }
                                  }}
                                >
                                  {row.actionLabel}
                                </button>
                              )}
                              <details
                                aria-label={`${row.label} 포커스 결과 상세`}
                                data-mailops-supported-work-focus-result-details="detail_collapsed"
                                data-mailops-supported-work-focus-result-details-external-mutation="false"
                              >
                                <summary>상세</summary>
                                <small>{row.detail}</small>
                              </details>
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                    </>
                  ) : (
                    <p>지원 업무를 누르면 이곳에 관련 후보만 한 줄로 모읍니다. 실제 발송이나 외부 변경은 일어나지 않습니다.</p>
                  )}
                </section>
                </details>
                <section
                  className={styles.mailOpsWorkBenchTriageBoard}
                  aria-label="메일 작업대 전체 업무 계약"
                  data-mailops-operations-compact="one_line_metrics_details_inside"
                  data-mailops-operations-workbench-contract={mailOpsOperationsWorkbenchPlan.contract}
                  data-mailops-operations-workbench-mode={mailOpsOperationsWorkbenchPlan.workbenchMode}
                  data-mailops-operations-mobile-boundary={mailOpsOperationsWorkbenchPlan.mobileHandoff.boundary}
                  data-mailops-operations-mobile-receive-contract={mailOpsOperationsWorkbenchPlan.mobileHandoff.receiveBridge.contract}
                  data-mailops-operations-mobile-receive-inputs={mailOpsOperationsWorkbenchPlan.mobileHandoff.receiveBridge.acceptedInputs.join("|")}
                  data-mailops-operations-mobile-receive-final-confirmation={String(mailOpsOperationsWorkbenchPlan.mobileHandoff.receiveBridge.finalAppConfirmationRequired)}
                  data-mailops-operations-mobile-receive-external-mutation={String(mailOpsOperationsWorkbenchPlan.mobileHandoff.receiveBridge.externalMutation)}
                  data-mailops-operations-send-before-approval={String(mailOpsOperationsWorkbenchPlan.approvalPolicy.externalSendBeforeApproval)}
                  data-mailops-operations-final-user-presence={String(mailOpsOperationsWorkbenchPlan.approvalPolicy.finalUserPresenceRequired)}
                  data-mailops-operations-batch-review={String(mailOpsOperationsWorkbenchPlan.approvalPolicy.batchReviewRequired)}
                  data-mailops-operations-reply-count={mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "reply_required")?.count ?? 0}
                  data-mailops-operations-review-count={mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "needs_review")?.count ?? 0}
                  data-mailops-operations-no-reply-count={mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "no_reply")?.count ?? 0}
                  data-mailops-operations-calendar-count={mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "calendar_candidate")?.count ?? 0}
                  data-mailops-operations-follow-up-count={mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "follow_up")?.count ?? 0}
                  data-mailops-operations-composed-count={mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "user_composed")?.count ?? 0}
                  data-mailops-operations-mobile-count={mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "mobile_handoff")?.count ?? 0}
                  data-mailops-operations-ready-channel-count={mailOpsOperationsWorkbenchPlan.channels.filter((channel) => channel.readiness !== "needs_setup").length}
                  data-mailops-operations-send-adapter-count={mailOpsOperationsWorkbenchPlan.sendAdapters.length}
                  data-mailops-operations-group-disclosure="first_one_then_more_inside_details"
                  data-mailops-operations-group-visible-count={visibleMailOpsOperationsGroups.length}
                  data-mailops-operations-group-hidden-count={hiddenMailOpsOperationsGroups.length}
                >
                  <div>
                    <span>전체 메일 작업대</span>
                    <strong>수집 · 선별 · 초안 · 수정 · 승인 · 전송 로그</strong>
                    <small>
                      답장 {mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "reply_required")?.count ?? 0}건 ·
                      검토 {mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "needs_review")?.count ?? 0}건 ·
                      일정 {mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "calendar_candidate")?.count ?? 0}건 ·
                      후속 {mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "follow_up")?.count ?? 0}건 ·
                      휴대폰 {mailOpsOperationsWorkbenchPlan.groups.find((group) => group.id === "mobile_handoff")?.count ?? 0}건 · 전송 잠금
                    </small>
                  </div>
                  <ol data-mailops-operations-group-primary-list="first_one">
                    {visibleMailOpsOperationsGroups.map((group) => (
                      <li
                        key={`mailops-operations-group-${group.id}`}
                        data-state={group.count > 0 ? "ready" : "idle"}
                        data-mailops-operations-group={group.id}
                        data-mailops-operations-group-count={group.count}
                        data-mailops-operations-group-external-mutation={String(group.externalMutation)}
                      >
                        <span>{group.label}</span>
                        <strong>{group.count}건</strong>
                        <small>{group.nextAction}</small>
                      </li>
                    ))}
                  </ol>
                  {hiddenMailOpsOperationsGroups.length ? (
                    <details
                      className={styles.mailOpsOperationsGroupMore}
                      aria-label="나머지 메일 작업 묶음"
                      data-mailops-operations-group-more="remaining_groups_on_demand"
                      data-mailops-operations-group-more-default="closed"
                    >
                      <summary>
                        <span>나머지 묶음</span>
                        <strong>{hiddenMailOpsOperationsGroups.length}개 더 보기</strong>
                      </summary>
                      <ol data-mailops-operations-group-more-list="remaining_groups_collapsed">
                        {hiddenMailOpsOperationsGroups.map((group) => (
                          <li
                            key={`mailops-operations-group-more-${group.id}`}
                            data-state={group.count > 0 ? "ready" : "idle"}
                            data-mailops-operations-group={group.id}
                            data-mailops-operations-group-count={group.count}
                            data-mailops-operations-group-external-mutation={String(group.externalMutation)}
                          >
                            <span>{group.label}</span>
                            <strong>{group.count}건</strong>
                            <small>{group.nextAction}</small>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                  <details
                    className={styles.mailOpsWorkBenchClusterDetails}
                    aria-label="메일 작업대 연결과 전송 경로"
                    data-mailops-operations-details="channels_send_adapters_collapsed"
                    data-mailops-operations-group-details="coverage_next_actions_collapsed"
                    data-mailops-operations-details-external-mutation="false"
                  >
                    <summary>
                      <span>연결/전송 경로</span>
                      <strong>전송은 앱 마지막 확인 뒤</strong>
                      <small>{mailOpsOperationsWorkbenchPlan.mobileHandoff.digestLabel}</small>
                    </summary>
                    <p>
                      {mailOpsOperationsWorkbenchPlan.channels.slice(0, 3).map((channel) => channel.label).join(" / ")}
                      {" -> "}
                      {mailOpsOperationsWorkbenchPlan.sendAdapters.slice(0, 3).map((adapter) => adapter.label).join(" / ")}
                    </p>
                    <p>{mailOpsOperationsWorkbenchPlan.coverageSummary}</p>
                    <p>
                      {mailOpsOperationsWorkbenchPlan.mobileHandoff.receiveBridge.oneLineLabel} · 앱 최종 확인 전 발송 없음
                    </p>
                    <ol aria-label="메일 작업대 묶음별 다음 행동">
                      {mailOpsOperationsWorkbenchPlan.groups.map((group) => (
                        <li key={`mailops-operations-next-${group.id}`}>
                          <strong>{group.label}</strong>
                          <small>{group.nextAction}</small>
                        </li>
                      ))}
                    </ol>
                  </details>
                </section>
                <details
                  className={styles.mailOpsOperationsDetailsFold}
                  aria-label="메일 작업대 운영 상세"
                  data-mailops-operations-details-fold="capability_bulk_exception_on_demand"
                  data-mailops-operations-details-fold-default="closed"
                  data-mailops-operations-details-visible="summary_only_until_user_opens"
                  data-mailops-operations-details-external-mutation="false"
                >
                  <summary>
                    <span>운영 상세</span>
                    <strong>업무 범위 · 대량 발송 · 예외 커버리지</strong>
                    <small>
                      범위 {mailOpsOperationsWorkbenchPlan.coverageMatrix.length}개 · 대량 후보 {mailOpsBulkSendReviewPlan.candidateCount}건 · 예외 관찰 {mailOpsOperationsWorkbenchPlan.exceptionCoverage.observedCount}개
                    </small>
                  </summary>
                  <div
                    className={styles.mailOpsOperationsDetailsBody}
                    aria-label="메일 작업대 운영 상세 본문"
                    data-mailops-operations-details-body="hidden_until_user_opens"
                  >
                    <section
                      id="mailops-capability-matrix"
                      className={styles.mailOpsCapabilityMatrix}
                      aria-label="메일 작업대 업무 범위 매트릭스"
                      data-mailops-supported-work-filter-active={
                        mailOpsSupportedWorkFocusRoute === "calendar_candidate_to_final_confirmation" ? "true" : "false"
                      }
                      data-mailops-capability-matrix="inbox_reply_review_calendar_composed_mobile_bulk_send"
                      data-mailops-capability-row-mode="one_line_status_details_inside"
                      data-mailops-capability-total={mailOpsOperationsWorkbenchPlan.coverageMatrix.length}
                      data-mailops-capability-ready={mailOpsOperationsWorkbenchPlan.coverageMatrix.filter((row) => row.status === "ready").length}
                      data-mailops-capability-needs-connection={mailOpsOperationsWorkbenchPlan.coverageMatrix.filter((row) => row.status === "needs_connection").length}
                      data-mailops-capability-needs-final-approval={mailOpsOperationsWorkbenchPlan.coverageMatrix.filter((row) => row.status === "needs_final_approval").length}
                      data-mailops-capability-external-mutation="false"
                      data-mailops-capability-disclosure="first_one_then_more_inside_details"
                      data-mailops-capability-visible-count={visibleMailOpsCapabilityRows.length}
                      data-mailops-capability-hidden-count={hiddenMailOpsCapabilityRows.length}
                    >
                      <header>
                        <span>업무 범위</span>
                        <strong>확인, 답장, 일정, 작성 메일, 휴대폰, 일괄 승인, 전송까지 분리</strong>
                        <small>가능한 것은 바로 보여주고, 부족한 것은 연결 또는 마지막 확인으로 멈춥니다.</small>
                      </header>
                      <ol data-mailops-capability-primary-list="first_one">
                        {visibleMailOpsCapabilityRows.map((row) => (
                          <li
                            key={`mailops-capability-${row.id}`}
                            data-mailops-capability-row={row.id}
                            data-state={row.status}
                            data-mailops-capability-row-compact="label_status_only_details_inside"
                            data-mailops-capability-row-compact-summary={row.oneLineLabel}
                            data-mailops-capability-row-external-mutation={String(row.externalMutation)}
                            data-mailops-capability-row-channel={row.primaryChannelId ?? ""}
                            data-mailops-capability-row-send-adapter={row.sendAdapterId ?? ""}
                          >
                            <div
                              className={styles.mailOpsCapabilityMatrixMain}
                              aria-label={`${row.label} 업무 범위 한 줄 요약`}
                              data-mailops-capability-row-main="label_status_details_collapsed"
                            >
                              <span>{row.label}</span>
                              <strong>{row.statusLabel}</strong>
                            </div>
                            <details
                              className={styles.mailOpsCapabilityMatrixDetails}
                              aria-label={`${row.label} 업무 범위 상세`}
                              data-mailops-capability-row-details="coverage_status_policy_collapsed"
                              data-mailops-capability-row-details-external-mutation="false"
                            >
                              <summary>상세</summary>
                              <small>{row.detail}</small>
                            </details>
                          </li>
                        ))}
                      </ol>
                      {hiddenMailOpsCapabilityRows.length ? (
                        <details
                          className={styles.mailOpsCapabilityMatrixMore}
                          aria-label="나머지 업무 범위"
                          data-mailops-capability-more="remaining_capabilities_on_demand"
                          data-mailops-capability-more-default="closed"
                        >
                          <summary>
                            <span>나머지 범위</span>
                            <strong>{hiddenMailOpsCapabilityRows.length}개 더 보기</strong>
                          </summary>
                          <ol data-mailops-capability-more-list="remaining_capabilities_collapsed">
                            {hiddenMailOpsCapabilityRows.map((row) => (
                              <li
                                key={`mailops-capability-more-${row.id}`}
                                data-mailops-capability-row={row.id}
                                data-state={row.status}
                                data-mailops-capability-row-compact="label_status_only_details_inside"
                                data-mailops-capability-row-compact-summary={row.oneLineLabel}
                                data-mailops-capability-row-external-mutation={String(row.externalMutation)}
                                data-mailops-capability-row-channel={row.primaryChannelId ?? ""}
                                data-mailops-capability-row-send-adapter={row.sendAdapterId ?? ""}
                              >
                                <div
                                  className={styles.mailOpsCapabilityMatrixMain}
                                  aria-label={`${row.label} 업무 범위 한 줄 요약`}
                                  data-mailops-capability-row-main="label_status_details_collapsed"
                                >
                                  <span>{row.label}</span>
                                  <strong>{row.statusLabel}</strong>
                                </div>
                                <details
                                  className={styles.mailOpsCapabilityMatrixDetails}
                                  aria-label={`${row.label} 업무 범위 상세`}
                                  data-mailops-capability-row-details="coverage_status_policy_collapsed"
                                  data-mailops-capability-row-details-external-mutation="false"
                                >
                                  <summary>상세</summary>
                                  <small>{row.detail}</small>
                                </details>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
                    </section>
                    <section
                      id="mailops-bulk-send-review"
                      className={styles.mailOpsBulkSendReview}
                      aria-label="메일 작업대 대량 발송 검토"
                      data-mailops-supported-work-filter-active={
                        mailOpsSupportedWorkFocusRoute === "recipient_review_to_sample" ? "true" : "false"
                      }
                      data-mailops-anchor-target="bulk_send_review"
                      data-mailops-bulk-send-review={mailOpsBulkSendReviewPlan.contract}
                      data-mailops-bulk-send-row-mode={mailOpsBulkSendReviewPlan.rowMode}
                      data-mailops-bulk-send-status={mailOpsBulkSendReviewPlan.status}
                      data-mailops-bulk-send-candidate-count={mailOpsBulkSendReviewPlan.candidateCount}
                      data-mailops-bulk-send-ready-count={mailOpsBulkSendReviewPlan.sendCandidateCount}
                      data-mailops-bulk-send-hold-count={mailOpsBulkSendReviewPlan.holdCandidateCount}
                      data-mailops-bulk-send-exclude-count={mailOpsBulkSendReviewPlan.excludeCandidateCount}
                      data-mailops-bulk-send-sample-count={mailOpsBulkSendReviewPlan.readySampleCount}
                      data-mailops-bulk-send-personalization-review-count={mailOpsBulkSendReviewPlan.personalizationReviewCount}
                      data-mailops-bulk-send-before-final-approval={String(mailOpsBulkSendReviewPlan.canSendBeforeFinalApproval)}
                      data-mailops-bulk-send-external-mutation={String(mailOpsBulkSendReviewPlan.externalMutation)}
                    >
                      <header>
                        <span>대량 발송</span>
                        <strong>{mailOpsBulkSendReviewPlan.oneLineLabel}</strong>
                        <small>{mailOpsBulkSendReviewPlan.approvalGate}</small>
                      </header>
                      <ol>
                        {mailOpsBulkSendReviewPlan.checklist.map((row) => (
                          <li
                            key={`mailops-bulk-send-${row.id}`}
                            data-mailops-bulk-send-row={row.id}
                            data-state={row.state}
                            data-mailops-bulk-send-row-count={row.count}
                            data-mailops-bulk-send-row-compact="label_count_only_details_inside"
                            data-mailops-bulk-send-row-external-mutation={String(row.externalMutation)}
                          >
                            <span>{row.label}</span>
                            <strong>{row.count}건</strong>
                            <details
                              aria-label={`${row.label} 대량 발송 검토 상세`}
                              data-mailops-bulk-send-row-details="reason_safety_collapsed"
                              data-mailops-bulk-send-row-details-external-mutation="false"
                            >
                              <summary>상세</summary>
                              <small>{row.detail}</small>
                            </details>
                          </li>
                        ))}
                      </ol>
                      <small>{mailOpsBulkSendReviewPlan.privacyBoundary}</small>
                    </section>
                    <section
                      id="mailops-exception-coverage"
                      className={styles.mailOpsExceptionCoverage}
                      aria-label="메일 작업대 운영 예외 커버리지"
                      data-mailops-supported-work-filter-active={
                        mailOpsSupportedWorkFocusRoute === "high_risk_review_gate" ? "true" : "false"
                      }
                      data-mailops-exception-coverage={mailOpsOperationsWorkbenchPlan.exceptionCoverage.contract}
                      data-mailops-exception-row-mode={mailOpsOperationsWorkbenchPlan.exceptionCoverage.rowMode}
                      data-mailops-exception-total={mailOpsOperationsWorkbenchPlan.exceptionCoverage.rows.length}
                      data-mailops-exception-observed={mailOpsOperationsWorkbenchPlan.exceptionCoverage.observedCount}
                      data-mailops-exception-high-risk={mailOpsOperationsWorkbenchPlan.exceptionCoverage.highRiskObservedCount}
                      data-mailops-exception-external-mutation={String(mailOpsOperationsWorkbenchPlan.exceptionCoverage.externalMutation)}
                      data-mailops-exception-disclosure="first_one_then_more_inside_details"
                      data-mailops-exception-visible-count={visibleMailOpsExceptionCoverageRows.length}
                      data-mailops-exception-hidden-count={hiddenMailOpsExceptionCoverageRows.length}
                    >
                      <header>
                        <span>운영 예외</span>
                        <strong>
                          관찰 {mailOpsOperationsWorkbenchPlan.exceptionCoverage.observedCount}개 · 고위험 {mailOpsOperationsWorkbenchPlan.exceptionCoverage.highRiskObservedCount}개
                        </strong>
                        <small>{mailOpsOperationsWorkbenchPlan.exceptionCoverage.summary}</small>
                      </header>
                      <ol data-mailops-exception-primary-list="first_one">
                        {visibleMailOpsExceptionCoverageRows.map((row) => (
                          <li
                            key={`mailops-exception-${row.id}`}
                            data-mailops-exception-row={row.id}
                            data-state={row.status}
                            data-mailops-exception-row-count={row.count}
                            data-mailops-exception-row-high-risk={row.highRisk ? "true" : "false"}
                            data-mailops-exception-row-compact="label_count_only_details_inside"
                            data-mailops-exception-row-summary={row.oneLineLabel}
                            data-mailops-exception-row-external-mutation={String(row.externalMutation)}
                          >
                            <div className={styles.mailOpsExceptionCoverageMain}>
                              <span>{row.label}</span>
                              <strong>{row.count > 0 ? `${row.count}건` : "대기"}</strong>
                            </div>
                            <details
                              aria-label={`${row.label} 운영 예외 상세`}
                              data-mailops-exception-row-details="action_safety_gate_collapsed"
                              data-mailops-exception-row-details-external-mutation="false"
                            >
                              <summary>상세</summary>
                              <small>{row.detail}</small>
                              <small>사용자 확인: {row.userAction}</small>
                              <small>안전 기준: {row.safetyGate}</small>
                            </details>
                          </li>
                        ))}
                      </ol>
                      {hiddenMailOpsExceptionCoverageRows.length ? (
                        <details
                          className={styles.mailOpsExceptionCoverageMore}
                          aria-label="나머지 운영 예외"
                          data-mailops-exception-more="remaining_exceptions_on_demand"
                          data-mailops-exception-more-default="closed"
                        >
                          <summary>
                            <span>나머지 예외</span>
                            <strong>{hiddenMailOpsExceptionCoverageRows.length}개 더 보기</strong>
                          </summary>
                          <ol data-mailops-exception-more-list="remaining_exceptions_collapsed">
                            {hiddenMailOpsExceptionCoverageRows.map((row) => (
                              <li
                                key={`mailops-exception-more-${row.id}`}
                                data-mailops-exception-row={row.id}
                                data-state={row.status}
                                data-mailops-exception-row-count={row.count}
                                data-mailops-exception-row-high-risk={row.highRisk ? "true" : "false"}
                                data-mailops-exception-row-compact="label_count_only_details_inside"
                                data-mailops-exception-row-summary={row.oneLineLabel}
                                data-mailops-exception-row-external-mutation={String(row.externalMutation)}
                              >
                                <div className={styles.mailOpsExceptionCoverageMain}>
                                  <span>{row.label}</span>
                                  <strong>{row.count > 0 ? `${row.count}건` : "대기"}</strong>
                                </div>
                                <details
                                  aria-label={`${row.label} 운영 예외 상세`}
                                  data-mailops-exception-row-details="action_safety_gate_collapsed"
                                  data-mailops-exception-row-details-external-mutation="false"
                                >
                                  <summary>상세</summary>
                                  <small>{row.detail}</small>
                                  <small>사용자 확인: {row.userAction}</small>
                                  <small>안전 기준: {row.safetyGate}</small>
                                </details>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
                    </section>
                  </div>
                </details>
                <details
                  className={styles.mailOpsWorkBenchClassificationFold}
                  aria-label="메일 작업대 분류와 기준"
                  data-mailops-workbench-classification-fold="coverage_edit_triage_cluster_on_demand"
                  data-mailops-workbench-classification-fold-default="closed"
                  data-mailops-workbench-classification-visible="summary_only_until_user_opens"
                  data-mailops-workbench-classification-external-mutation="false"
                >
                  <summary>
                    <span>분류와 기준</span>
                    <strong>
                      답장 {mailOpsReplyNeededRows.length} · 수정 {mailOpsReviewNeededRows.length} · 제외 {mailOpsExcludedRows.length} · 휴대폰 {mailOpsMobileHandoffCandidateCount}
                    </strong>
                    <small>커버리지, 편집 승인 흐름, 선별 보드, 분류 묶음은 필요할 때만 엽니다.</small>
                  </summary>
                  <div
                    className={styles.mailOpsWorkBenchClassificationBody}
                    aria-label="접힌 메일 분류 본문"
                    data-mailops-workbench-classification-body="hidden_until_user_opens"
                  >
                    <section
                      className={styles.mailOpsWorkBenchCoverageStrip}
                      aria-label="메일 작업대 한 줄 커버리지"
                      data-mailops-workbench-coverage-strip="reply_review_no_reply_calendar_follow_up_mobile_composed"
                      data-mailops-workbench-coverage-row-mode="one_line_status_detail_inside"
                      data-mailops-workbench-coverage-reply={mailOpsReplyNeededRows.length}
                      data-mailops-workbench-coverage-review={mailOpsReviewNeededRows.length}
                      data-mailops-workbench-coverage-no-reply={mailOpsExcludedRows.length}
                      data-mailops-workbench-coverage-calendar={mailOpsCalendarCandidateCount}
                      data-mailops-workbench-coverage-follow-up={mailOpsFollowUpCandidateCount}
                      data-mailops-workbench-coverage-mobile={mailOpsMobileHandoffCandidateCount}
                      data-mailops-workbench-coverage-composed={userComposedMailApprovalRows.length}
                      data-mailops-workbench-coverage-external-mutation="false"
                    >
                      <header>
                        <span>메일 업무</span>
                        <strong>
                          답장 {mailOpsReplyNeededRows.length} · 수정 {mailOpsReviewNeededRows.length} · 제외 {mailOpsExcludedRows.length} · 휴대폰 {mailOpsMobileHandoffCandidateCount}
                        </strong>
                        <small>보낼 것과 안 보낼 것을 먼저 나누고, 상세는 각 행 안에서만 엽니다.</small>
                      </header>
                      <ol>
                        {mailOpsCoverageRows.map((row) => (
                          <li
                            key={`mailops-coverage-${row.id}`}
                            data-mailops-coverage-row={row.id}
                            data-state={row.state}
                            data-mailops-coverage-row-compact="label_count_only_details_inside"
                            data-mailops-coverage-row-external-mutation="false"
                          >
                            <span>{row.label}</span>
                            <strong>{row.value}</strong>
                            <details
                              aria-label={`${row.label} 메일 업무 상세`}
                              data-mailops-coverage-row-details="reason_next_action_collapsed"
                              data-mailops-coverage-row-details-external-mutation="false"
                            >
                              <summary>보기</summary>
                              <small>{row.detail}</small>
                            </details>
                          </li>
                        ))}
                      </ol>
                    </section>
                    <section
                      className={styles.mailOpsEditApprovalBridge}
                      aria-label="메일 작업대 편집 승인 브릿지"
                      data-mailops-edit-approval-bridge="provider_composed_mobile_edit_to_approval_candidate"
                      data-mailops-edit-approval-bridge-contract="draft_edit_to_approval_candidate_to_final_confirmation"
                      data-mailops-edit-approval-bridge-provider-count={mailOpsWorkBenchRows.length}
                      data-mailops-edit-approval-bridge-composed-count={userComposedMailApprovalRows.length}
                      data-mailops-edit-approval-bridge-mobile-count={mailOpsMobileHandoffCandidateCount}
                      data-mailops-edit-approval-bridge-external-mutation="false"
                    >
                      <header>
                        <span>편집 후 승인</span>
                        <strong>받은 메일, 작성 메일, 휴대폰 메일을 같은 승인 흐름으로 묶습니다</strong>
                        <small>수정본 저장은 승인 후보만 만들고, 실제 발송은 마지막 확인 전까지 잠깁니다.</small>
                      </header>
                      <ol>
                        <li data-source="provider_read" data-state={mailOpsWorkBenchRows.length ? "ready" : "idle"}>
                          <span>받은 메일</span>
                          <strong>{mailOpsWorkBenchRows.length}건</strong>
                          <small>작업대 행에서 수정 후 승인 후보</small>
                        </li>
                        <li data-source="user_composed" data-state={userComposedMailApprovalRows.length ? "ready" : "idle"}>
                          <span>내가 쓴 메일</span>
                          <strong>{userComposedMailApprovalRows.length}건</strong>
                          <small>작성 점검함에서 수정 후 마지막 확인</small>
                        </li>
                        <li data-source="mobile_handoff" data-state={mailOpsMobileHandoffCandidateCount ? "ready" : "idle"}>
                          <span>휴대폰 메일</span>
                          <strong>{mailOpsMobileHandoffCandidateCount}건</strong>
                          <small>휴대폰 의사는 기록만, 발송은 앱에서 확인</small>
                        </li>
                      </ol>
                    </section>
                    <section
                      className={styles.mailOpsWorkBenchTriageBoard}
                      aria-label="메일 작업대 선별 보드"
                      data-mailops-workbench-triage-board="reply_needed_review_excluded_composed_mail"
                      data-mailops-workbench-triage-board-reply-needed={mailOpsWorkQueueReviewSummary.approve}
                      data-mailops-workbench-triage-board-review-needed={mailOpsWorkBenchReviewCount}
                      data-mailops-workbench-triage-board-excluded={mailOpsWorkQueueReviewSummary.exclude}
                      data-mailops-workbench-triage-board-composed={userComposedMailApprovalRows.length}
                      data-mailops-workbench-triage-board-composed-ready={userComposedMailReadyCount}
                      data-mailops-workbench-triage-board-external-mutation="false"
                    >
                      <div>
                        <span>오늘 처리할 메일</span>
                        <strong>
                          답장 {mailOpsWorkQueueReviewSummary.approve}건 · 검토 {mailOpsWorkBenchReviewCount}건 · 제외 {mailOpsWorkQueueReviewSummary.exclude}건
                        </strong>
                        <small>AI 판단 근거를 보고 수정한 뒤 승인한 항목만 마지막 확인으로 넘깁니다.</small>
                      </div>
                      <ol>
                        {mailOpsWorkBenchTriageCards.map((card) => (
                          <li key={card.state} data-state={card.state}>
                            <span>{card.label}</span>
                            <strong>{card.value}</strong>
                            <small>{card.detail}</small>
                          </li>
                        ))}
                      </ol>
                    </section>
                    <section
                      className={styles.mailOpsWorkBenchClusterRail}
                      aria-label="메일 작업대 분류 묶음"
                      data-mailops-workbench-cluster-rail="reply_review_excluded_composed_grouped_summary"
                      data-mailops-workbench-cluster-reply={mailOpsReplyNeededRows.length}
                      data-mailops-workbench-cluster-review={mailOpsReviewNeededRows.length}
                      data-mailops-workbench-cluster-excluded={mailOpsExcludedRows.length}
                      data-mailops-workbench-cluster-composed={userComposedMailApprovalRows.length}
                      data-mailops-workbench-cluster-approved-only-route="true"
                      data-mailops-workbench-cluster-external-mutation="false"
                    >
                      <div>
                        <span>분류 묶음</span>
                        <strong>여러 메일을 답장, 수정, 제외, 작성 메일로 나눠 봅니다</strong>
                        <small>수정할 메일만 고치고, 승인한 메일만 마지막 확인으로 보냅니다.</small>
                      </div>
                      <ol>
                        {mailOpsWorkBenchClusterCards.map((card) => (
                          <li
                            key={card.id}
                            data-state={card.state}
                            data-cluster={card.id}
                            data-mailops-cluster-row-compact="count_label_only_details_inside"
                            data-mailops-cluster-row-compact-summary={`${card.label} · ${card.value}`}
                          >
                            <div
                              className={styles.mailOpsWorkBenchClusterMain}
                              data-mailops-cluster-row-main="count_label_details_collapsed"
                            >
                              <span>{card.label}</span>
                              <strong>{card.value}</strong>
                            </div>
                            <details
                              className={styles.mailOpsWorkBenchClusterDetails}
                              aria-label={`${card.label} 분류 상세`}
                              data-mailops-cluster-row-details="sample_action_collapsed"
                              data-mailops-cluster-row-details-external-mutation="false"
                            >
                              <summary>상세 보기</summary>
                              <p>{card.sample}</p>
                              <em>{card.action}</em>
                            </details>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>
                </details>
                <section
                  className={styles.mailOpsWorkBenchNextRail}
                  aria-label="메일 작업대 지금 할 일"
                  data-mailops-workbench-next-rail="visible_reply_review_exclude_composed_next_action"
                  data-mailops-workbench-next-rail-reply={mailOpsWorkQueueReviewSummary.approve}
                  data-mailops-workbench-next-rail-review={mailOpsWorkBenchReviewCount}
                  data-mailops-workbench-next-rail-excluded={mailOpsWorkQueueReviewSummary.exclude}
                  data-mailops-workbench-next-rail-composed={userComposedMailApprovalRows.length}
                  data-mailops-workbench-next-rail-next-final-title={mailOpsWorkQueueAutomationEvidence.nextFinalTitle}
                  data-mailops-workbench-next-rail-approved-only-route="true"
                  data-mailops-workbench-next-rail-external-mutation="false"
                >
                  <div>
                    <span>지금 할 일</span>
                    <strong>
                      {mailOpsWorkQueueReviewSummary.approve > 0
                        ? mailOpsWorkQueueAutomationEvidence.nextFinalTitle === "missing"
                          ? "답장 보낼 메일을 마지막 확인으로 넘깁니다"
                          : `마지막 확인: ${mailOpsWorkQueueAutomationEvidence.nextFinalTitle}`
                        : mailOpsWorkBenchReviewCount > 0
                          ? "수정/확인 메일부터 검토합니다"
                          : userComposedMailApprovalRows.length > 0
                            ? "작성 메일 점검 결과를 확인합니다"
                            : "답장할 메일을 먼저 고릅니다"}
                    </strong>
                    <small>선별 → 초안 수정 → 승인 항목만 마지막 확인 → 발송 잠금</small>
                  </div>
                  <ol>
                    <li data-state={mailOpsWorkQueueReviewSummary.approve > 0 ? "active" : "idle"}>
                      <span>답장 보낼 메일</span>
                      <strong>{mailOpsWorkQueueReviewSummary.approve}건</strong>
                    </li>
                    <li data-state={mailOpsWorkBenchReviewCount > 0 ? "active" : "idle"}>
                      <span>수정/확인</span>
                      <strong>{mailOpsWorkBenchReviewCount}건</strong>
                    </li>
                    <li data-state={mailOpsWorkQueueReviewSummary.exclude > 0 ? "active" : "idle"}>
                      <span>답장 안 보냄</span>
                      <strong>{mailOpsWorkQueueReviewSummary.exclude}건</strong>
                    </li>
                    <li data-state={userComposedMailApprovalRows.length > 0 ? "active" : "idle"}>
                      <span>내가 쓴 메일</span>
                      <strong>{userComposedMailApprovalRows.length}건</strong>
                    </li>
                  </ol>
                </section>
                {mailOpsWorkBenchPriorityQueueRows.length ? (
                  <section
                    className={styles.mailOpsWorkBenchPriorityQueue}
                    aria-label="메일 직원 작업함 우선 처리 큐"
                    data-mailops-workbench-priority-queue="review_first_then_final_confirmation"
                    data-mailops-workbench-priority-queue-count={mailOpsWorkBenchPriorityQueueAllRows.length}
                    data-mailops-workbench-priority-visible-count={mailOpsWorkBenchPriorityQueueRows.length}
                    data-mailops-workbench-priority-hidden-count={hiddenMailOpsWorkBenchPriorityRows.length}
                    data-mailops-workbench-priority-disclosure="first_one_then_more_inside_details"
                    data-mailops-workbench-priority-visible-limit="1"
                    data-mailops-workbench-priority-queue-review={mailOpsReviewNeededRows.length}
                    data-mailops-workbench-priority-queue-reply={mailOpsReplyNeededRows.length}
                    data-mailops-workbench-priority-queue-excluded={mailOpsExcludedRows.length}
                    data-mailops-workbench-priority-queue-external-mutation="false"
                  >
                    <header>
                      <span>처리 순서</span>
                      <strong>
                        {mailOpsReviewNeededRows.length
                          ? `${mailOpsReviewNeededRows.length}건 수정 먼저`
                          : mailOpsReplyNeededRows.length
                            ? `${mailOpsReplyNeededRows.length}건 마지막 확인`
                            : "제외 항목만 남음"}
                      </strong>
                      <small>각 행은 한 줄만 보고, 상세에서 초안과 근거를 엽니다.</small>
                    </header>
                    <ol>
                      {mailOpsWorkBenchPriorityQueueRows.map(({ row, rank, label, action }) => (
                        <li
                          key={`mailops-priority-${row.id}`}
                          data-mailops-workbench-priority-row={row.id}
                          data-mailops-workbench-priority-row-source-kind={row.sourceKind}
                          data-mailops-workbench-priority-row-rank={rank}
                          data-mailops-workbench-priority-row-state={row.state}
                          data-mailops-workbench-priority-row-action={action}
                        >
                          <span>{rank}</span>
                          <b>{label}</b>
                          <strong>{row.title}</strong>
                          <small>{action}</small>
                          <button type="button" onClick={() => handleOpenMailOpsWorkBenchEditor(row)}>
                            열기
                          </button>
                        </li>
                      ))}
                    </ol>
                    {hiddenMailOpsWorkBenchPriorityRows.length ? (
                      <details
                        className={styles.mailOpsWorkBenchMoreRows}
                        aria-label="메일 직원 작업함 나머지 처리 순서"
                        data-mailops-workbench-priority-more="remaining_rows_on_demand"
                        data-mailops-workbench-priority-more-count={hiddenMailOpsWorkBenchPriorityRows.length}
                      >
                        <summary>나머지 {hiddenMailOpsWorkBenchPriorityRows.length}건</summary>
                        <ol>
                          {hiddenMailOpsWorkBenchPriorityRows.map(({ row, rank, label, action }) => (
                            <li key={`mailops-priority-more-${row.id}`} data-state={row.state}>
                              <span>{rank}</span>
                              <strong>{row.title}</strong>
                              <small>{label} · {action}</small>
                              <button type="button" onClick={() => handleOpenMailOpsWorkBenchEditor(row)}>
                                열기
                              </button>
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </section>
                ) : null}
                {mailOpsReviewNeededRows.length > 0 ? (
                  <section
                    className={styles.mailOpsWorkBenchReviewLane}
                    aria-label="수정/확인 메일 빠른 처리"
                    data-mailops-review-lane="review_only_draft_edit_to_approval_candidate"
                    data-mailops-review-lane-count={mailOpsReviewNeededRows.length}
                    data-mailops-review-lane-next-title={mailOpsReviewNeededRows[0]?.title ?? ""}
                    data-mailops-review-lane-external-mutation="false"
                  >
                    <div>
                      <span>수정/확인</span>
                      <strong>{mailOpsReviewNeededRows.length}건만 먼저 고치기</strong>
                      <small>검토 대상만 모아 초안 수정 후 승인 후보로 전환합니다.</small>
                    </div>
                    <button
                      type="button"
                      data-mailops-review-lane-select-action="select_review_only"
                      onClick={() => {
                        setMailOpsSelectedWorkBenchRowIds(mailOpsReviewNeededRows.map((row) => row.id));
                        setMailOpsWorkBenchSaveMessage("수정/확인 메일만 선택했습니다. 수정 후 승인 후보로 넘길 항목을 확인하세요.");
                      }}
                    >
                      검토 메일만 선택
                    </button>
                    <ol>
                      {mailOpsReviewNeededRows.map((row, index) => (
                        <li
                          key={`mailops-review-lane-${row.id}`}
                          data-mailops-review-lane-row={row.id}
                          data-mailops-review-lane-row-index={index + 1}
                          data-mailops-review-lane-row-final-ready={row.finalActionReady ? "true" : "false"}
                        >
                          <span>{index + 1}</span>
                          <strong>{row.title}</strong>
                          <small>{row.nextActionLabel}</small>
                          <button type="button" onClick={() => handleOpenMailOpsWorkBenchEditor(row)}>
                            수정 시작
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}
                <section
                  className={styles.mailOpsWorkBenchDecisionStrip}
                  aria-label="메일 작업대 결정 요약"
                  data-mailops-workbench-decision-strip="reply_needed_review_excluded_next_final"
                  data-mailops-workbench-decision-strip-total={mailOpsWorkQueueReviewSummary.total}
                  data-mailops-workbench-decision-strip-approve={mailOpsWorkQueueReviewSummary.approve}
                  data-mailops-workbench-decision-strip-review={mailOpsWorkQueueReviewSummary.revise + mailOpsWorkQueueReviewSummary.hold}
                  data-mailops-workbench-decision-strip-exclude={mailOpsWorkQueueReviewSummary.exclude}
                  data-mailops-workbench-decision-strip-next-final-title={mailOpsWorkQueueAutomationEvidence.nextFinalTitle}
                  data-mailops-workbench-decision-strip-engine-handoff={mailOpsWorkQueueAutomationEvidence.evidenceContract}
                  data-mailops-workbench-decision-strip-approval-gate={mailOpsWorkQueueAutomationEvidence.approvalGateContract}
                  data-mailops-workbench-decision-strip-external-mutation="false"
                >
                  <div data-state="ready" data-mailops-decision-chip-compact="label_count_only_details_inside">
                    <span>답장 보낼 메일</span>
                    <strong>{mailOpsWorkQueueReviewSummary.approve}건</strong>
                    <details
                      className={styles.mailOpsWorkBenchDecisionDetails}
                      data-mailops-decision-chip-details="next_final_collapsed"
                      data-mailops-decision-chip-details-external-mutation="false"
                    >
                      <summary>상세</summary>
                      <small>
                        {mailOpsWorkQueueAutomationEvidence.nextFinalTitle === "missing"
                          ? "마지막 확인 대기 없음"
                          : `다음: ${mailOpsWorkQueueAutomationEvidence.nextFinalTitle}`}
                      </small>
                    </details>
                  </div>
                  <div data-state="review" data-mailops-decision-chip-compact="label_count_only_details_inside">
                    <span>수정/확인</span>
                    <strong>{mailOpsWorkQueueReviewSummary.revise + mailOpsWorkQueueReviewSummary.hold}건</strong>
                    <details
                      className={styles.mailOpsWorkBenchDecisionDetails}
                      data-mailops-decision-chip-details="review_route_collapsed"
                      data-mailops-decision-chip-details-external-mutation="false"
                    >
                      <summary>상세</summary>
                      <small>수정 후 다시 승인 후보로 이동</small>
                    </details>
                  </div>
                  <div data-state="excluded" data-mailops-decision-chip-compact="label_count_only_details_inside">
                    <span>답장 안 보냄</span>
                    <strong>{mailOpsWorkQueueReviewSummary.exclude}건</strong>
                    <details
                      className={styles.mailOpsWorkBenchDecisionDetails}
                      data-mailops-decision-chip-details="exclude_route_collapsed"
                      data-mailops-decision-chip-details-external-mutation="false"
                    >
                      <summary>상세</summary>
                      <small>마지막 확인과 발송 경로에서 제외</small>
                    </details>
                  </div>
                  <div data-state="locked" data-mailops-decision-chip-compact="label_count_only_details_inside">
                    <span>발송 잠금</span>
                    <strong>외부 실행 0건</strong>
                    <details
                      className={styles.mailOpsWorkBenchDecisionDetails}
                      data-mailops-decision-chip-details="external_send_lock_collapsed"
                      data-mailops-decision-chip-details-external-mutation="false"
                    >
                      <summary>상세</summary>
                      <small>사용자 최종 확인 전까지 발송하지 않음</small>
                    </details>
                  </div>
                </section>
                <section
                  className={styles.mailOpsWorkBenchBulkBar}
                  aria-label="메일 작업대 선택 일괄 처리"
                  data-mailops-workbench-bulk-bar="select_rows_apply_decision_no_external_mutation"
                  data-mailops-workbench-bulk-selected-count={mailOpsSelectedWorkBenchCount}
                  data-mailops-workbench-bulk-selected-title={mailOpsSelectedWorkBenchTitle}
                  data-mailops-workbench-bulk-selection-preview={mailOpsBulkSelectionPreviewLabel}
                  data-mailops-workbench-bulk-approve-preview={mailOpsBulkApprovePreviewLabel}
                  data-mailops-workbench-bulk-review-preview={mailOpsBulkReviewPreviewLabel}
                  data-mailops-workbench-bulk-exclude-preview={mailOpsBulkExcludePreviewLabel}
                  data-mailops-workbench-bulk-action-disabled={mailOpsSelectedWorkBenchCount === 0 ? "true" : "false"}
                  data-mailops-workbench-bulk-external-mutation="false"
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={mailOpsSelectedWorkBenchCount === mailOpsWorkBenchRows.length}
                      ref={(node) => {
                        if (node) node.indeterminate = mailOpsSelectedWorkBenchCount > 0 && mailOpsSelectedWorkBenchCount < mailOpsWorkBenchRows.length;
                      }}
                      onChange={(event) => setAllMailOpsWorkBenchRowSelection(event.target.checked)}
                    />
                    <span>전체 선택</span>
                  </label>
                  <strong>{mailOpsSelectedWorkBenchCount}건 선택</strong>
                  <small>{mailOpsSelectedWorkBenchTitle}</small>
                  <section
                    className={styles.mailOpsWorkBenchBulkPreview}
                    aria-label="메일 작업대 선택 결과 미리보기"
                    data-mailops-workbench-bulk-preview="selection_distribution_and_action_outcome"
                    data-mailops-workbench-bulk-preview-selected={mailOpsSelectedWorkBenchCount}
                    data-mailops-workbench-bulk-preview-current={mailOpsBulkSelectionPreviewLabel}
                    data-mailops-workbench-bulk-preview-external-mutation="false"
                  >
                    <span>{mailOpsBulkSelectionPreviewLabel}</span>
                    <b>{mailOpsBulkApprovePreviewLabel}</b>
                    <b>{mailOpsBulkReviewPreviewLabel}</b>
                    <b>{mailOpsBulkExcludePreviewLabel}</b>
                  </section>
                  <div>
                    <button
                      type="button"
                      onClick={() => handleApplyMailOpsWorkBenchBulkDecision("approve")}
                      disabled={mailOpsSelectedWorkBenchCount === 0}
                    >
                      선택 답장 보냄
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyMailOpsWorkBenchBulkDecision("hold")}
                      disabled={mailOpsSelectedWorkBenchCount === 0}
                    >
                      선택 수정/확인
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyMailOpsWorkBenchBulkDecision("exclude")}
                      disabled={mailOpsSelectedWorkBenchCount === 0}
                    >
                      선택 답장 안 보냄
                    </button>
                  </div>
                </section>
                {mailOpsFocusedWorkBenchRow ? (
                  <section
                    className={styles.mailOpsWorkBenchFocusedEditor}
                    aria-label="메일 작업대 선택 편집 도크"
                    data-mailops-workbench-focused-editor="selected_row_draft_decision_approval_dock"
                    data-mailops-workbench-focused-editor-row={mailOpsFocusedWorkBenchRow.id}
                    data-mailops-workbench-focused-editor-editing={mailOpsEditingWorkBenchRow?.id === mailOpsFocusedWorkBenchRow.id ? "true" : "false"}
                    data-mailops-workbench-focused-editor-selected-count={mailOpsSelectedWorkBenchCount}
                    data-mailops-workbench-focused-editor-decision={mailOpsFocusedWorkBenchRow.decision}
                    data-mailops-workbench-focused-editor-send-boundary={mailOpsFocusedWorkBenchRow.sendBoundaryLabel}
                    data-mailops-workbench-focused-editor-external-mutation="false"
                  >
                    <header>
                      <div>
                        <span>선택 메일 편집</span>
                        <strong>{mailOpsFocusedWorkBenchRow.title}</strong>
                        <small>{mailOpsFocusedEditSummary}</small>
                      </div>
                      <b>{mailOpsFocusedWorkBenchRow.routeLabel}</b>
                    </header>
                    <ol aria-label="선택 메일 처리 단계">
                      <li data-step="decision" data-state={mailOpsFocusedWorkBenchRow.state}>
                        <span>판단</span>
                        <strong>{mailOpsFocusedWorkBenchRow.oneLineDecisionLabel}</strong>
                      </li>
                      <li data-step="draft" data-state={mailOpsFocusedEditDraft ? "ready" : "empty"}>
                        <span>초안</span>
                        <strong>{mailOpsFocusedEditDraft ? "수정 가능" : "입력 필요"}</strong>
                      </li>
                      <li data-step="approval" data-state={mailOpsFocusedWorkBenchRow.finalActionReady ? "ready" : "locked"}>
                        <span>마지막 확인</span>
                        <strong>{mailOpsFocusedWorkBenchRow.finalActionReady ? "준비" : "대기"}</strong>
                      </li>
                      <li data-step="send" data-state="locked">
                        <span>발송</span>
                        <strong>{mailOpsFocusedWorkBenchRow.sendBoundaryLabel}</strong>
                      </li>
                    </ol>
                    <label>
                      <span>수정본 미리보기</span>
                      <textarea
                        value={mailOpsFocusedEditDraft}
                        rows={3}
                        placeholder="선택한 메일의 답장 초안을 여기서 바로 고칩니다."
                        onFocus={() => handleOpenMailOpsWorkBenchEditor(mailOpsFocusedWorkBenchRow)}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setMailOpsWorkBenchDrafts((drafts) => ({
                            ...drafts,
                            [mailOpsFocusedWorkBenchRow.id]: nextValue,
                          }));
                          if (mailOpsEditingWorkBenchRowId !== mailOpsFocusedWorkBenchRow.id) {
                            setMailOpsEditingWorkBenchRowId(mailOpsFocusedWorkBenchRow.id);
                          }
                        }}
                      />
                    </label>
                    <div>
                      <button type="button" onClick={() => handleSaveMailOpsWorkBenchDraft(mailOpsFocusedWorkBenchRow)}>
                        수정본 저장 후 승인
                      </button>
                      <button type="button" onClick={() => handleSetMailOpsWorkBenchDecision(mailOpsFocusedWorkBenchRow, "approve")}>
                        답장 보냄
                      </button>
                      <button type="button" onClick={() => handleSetMailOpsWorkBenchDecision(mailOpsFocusedWorkBenchRow, "hold")}>
                        수정/확인
                      </button>
                      <button type="button" onClick={() => handleSetMailOpsWorkBenchDecision(mailOpsFocusedWorkBenchRow, "exclude")}>
                        답장 안 보냄
                      </button>
                    </div>
                    <small>이 도크에서 저장해도 실제 발송은 마지막 확인 전까지 열리지 않습니다.</small>
                  </section>
                ) : null}
                {!mailOpsWorkBenchRows.length ? (
                  <p
                    className={styles.mailOpsWorkBenchSaveMessage}
                    data-mailops-workbench-empty-state="mail_connection_or_check_required"
                    data-mailops-workbench-empty-external-mutation="false"
                  >
                    아직 읽은 메일 후보가 없습니다. 메일 연결이나 메일 점검을 먼저 실행하면 답장 필요, 수정/확인, 제외 항목을 이 작업대에서 한 줄로 확인합니다.
                  </p>
                ) : null}
                <ol
                  id="mailops-workbench-rows"
                  className={styles.mailOpsWorkBenchRows}
                  data-mailops-anchor-target="provider_workbench_rows"
                  data-mailops-supported-work-filter-active={
                    mailOpsSupportedWorkFocusRoute === "mailops_triage_to_approval" ? "true" : "false"
                  }
                  data-mailops-workbench-row-disclosure="first_one_then_more_inside_details"
                  data-mailops-workbench-final-visible-layout-contract={mailOpsWorkBenchFinalVisibleLayoutContract}
                  data-mailops-workbench-visible-row-count={visibleMailOpsWorkBenchRows.length}
                  data-mailops-workbench-hidden-row-count={hiddenMailOpsWorkBenchRows.length}
                >
                  {visibleMailOpsWorkBenchRows.map((row) => {
                    const isEditing = mailOpsEditingWorkBenchRowId === row.id;
                    const isSelected = mailOpsSelectedWorkBenchRowIds.includes(row.id);
                    const draftValue = mailOpsWorkBenchDrafts[row.id] ?? (row.draftPreview.startsWith("초안 없음") ? "" : row.draftPreview);
                    return (
                      <li
                        key={row.id}
                        data-mailops-workbench-row={row.id}
                        data-mailops-workbench-row-source-kind={row.sourceKind}
                        data-mailops-workbench-row-mobile-share={row.sourceKind === "mobile_share" ? "true" : "false"}
                        data-mailops-workbench-row-role-command={row.sourceKind === "role_command" ? "true" : "false"}
                        data-mailops-workbench-row-state={row.state}
                        data-mailops-workbench-row-route={row.routeLabel}
                        data-mailops-workbench-row-editing={isEditing ? "true" : "false"}
                        data-mailops-workbench-row-final-action-id={row.finalActionWorkItemId}
                        data-mailops-workbench-row-final-ready={row.finalActionReady ? "true" : "false"}
                        data-mailops-workbench-row-source-trace={row.sourceTraceContract}
                        data-mailops-workbench-row-source-trace-label={row.sourceTraceLabel}
                        data-mailops-workbench-row-approval-preview-id={row.approvalPreviewId}
                        data-mailops-workbench-row-approval-work-item-id={row.approvalWorkItemId}
                        data-mailops-workbench-row-selected={isSelected ? "true" : "false"}
                        data-mailops-workbench-row-compact="status_title_next_action_only_details_inside"
                        data-mailops-workbench-row-compact-summary={row.compactSummary}
                        data-mailops-workbench-row-visible-layout="one_line_status_title_next_lock_scenario_inside_details"
                        data-mailops-workbench-row-priority={row.priorityLabel}
                        data-mailops-workbench-row-scenario={row.scenarioLabel}
                        data-mailops-workbench-row-decision-label={row.oneLineDecisionLabel}
                        data-mailops-workbench-row-send-boundary={row.sendBoundaryLabel}
                        data-mailops-workbench-row-reason={row.classificationReasonLabel}
                        data-mailops-workbench-row-approval-outcome={row.approvalOutcomeLabel}
                        data-mailops-workbench-row-action-candidate={row.actionCandidateLabel}
                        data-mailops-workbench-row-checklist={row.reviewChecklistLabels.join("|")}
                        data-mailops-workbench-row-external-mutation="false"
                      >
                        <div
                          className={styles.mailOpsWorkBenchRowShell}
                          aria-label={`${row.title} 메일 업무 한 줄`}
                          data-mailops-workbench-row-shell="select_priority_decision_title_next_action_only"
                        >
                          <label className={styles.mailOpsWorkBenchRowSelect}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleMailOpsWorkBenchRowSelection(row.id)}
                            />
                            <span>선택</span>
                          </label>
                          <span className={styles.mailOpsWorkBenchRowStatus}>{row.categoryLabel}</span>
                          <span
                            className={styles.mailOpsWorkBenchRowDecision}
                            data-mailops-workbench-row-decision={row.decision}
                          >
                            {row.oneLineDecisionLabel}
                          </span>
                          <div
                            className={styles.mailOpsWorkBenchRowMain}
                            aria-label={`${row.title} 한 줄 요약`}
                            data-mailops-workbench-row-main="one_line_summary_details_collapsed"
                          >
                            <strong>{row.title}</strong>
                            <small>{row.compactSummary}</small>
                          </div>
                          <span
                            className={styles.mailOpsWorkBenchRowNext}
                            data-mailops-workbench-row-next-action={row.nextActionLabel}
                          >
                            {row.nextActionLabel}
                          </span>
                          <button
                            type="button"
                            className={styles.mailOpsWorkBenchPrimaryAction}
                            data-mailops-workbench-action="prepare_final_confirmation"
                            data-mailops-workbench-row-primary-action="final_confirmation_or_waiting_only"
                            onClick={() => handlePrepareMailOpsWorkBenchFinalConfirmation(row)}
                            disabled={!onPrepareFinalConfirmation || !row.finalActionReady || preparingFinalActionId === row.finalActionWorkItemId}
                          >
                            {preparingFinalActionId === row.finalActionWorkItemId
                              ? "준비 중"
                              : row.finalActionReady
                                ? "마지막 확인"
                                : "후보 대기"}
                          </button>
                        </div>
                        <details
                          className={styles.mailOpsWorkBenchRowDetails}
                          aria-label={`${row.title} 상세 근거`}
                          data-mailops-workbench-row-details="draft_reason_flow_evidence_collapsed"
                          data-mailops-workbench-row-details-external-mutation="false"
                        >
                          <summary>
                            <span>상세 보기</span>
                            <small>초안, 판단 근거, 발송 점검</small>
                          </summary>
                          <p>{row.detailSummary}</p>
                          <p>{row.draftPreview}</p>
                          <section
                            className={styles.mailOpsWorkBenchRowReasonGrid}
                            aria-label={`${row.title} 판단과 승인 결과`}
                            data-mailops-workbench-row-reason-grid="why_outcome_checklist_inside_details"
                            data-mailops-workbench-row-reason-grid-outcome={row.approvalOutcomeLabel}
                            data-mailops-workbench-row-reason-grid-external-mutation="false"
                          >
                            <div>
                              <span>왜</span>
                              <strong>{row.classificationReasonLabel}</strong>
                            </div>
                            <div>
                              <span>승인하면</span>
                              <strong>{row.approvalOutcomeLabel} · {row.actionCandidateLabel}</strong>
                            </div>
                            <ol>
                              {row.reviewChecklistLabels.map((label) => (
                                <li key={`${row.id}-${label}`}>{label}</li>
                              ))}
                            </ol>
                          </section>
                          <section
                            className={styles.mailOpsWorkBenchRowFlow}
                            aria-label={`${row.title} 메일 처리 흐름`}
                            data-mailops-workbench-row-flow="classification_draft_edit_approval_final_lock"
                            data-mailops-workbench-row-flow-state={row.state}
                            data-mailops-workbench-row-flow-decision={row.decision}
                            data-mailops-workbench-row-flow-final-ready={row.finalActionReady ? "true" : "false"}
                            data-mailops-workbench-row-flow-external-mutation="false"
                          >
                            <ol>
                              <li data-step="classification" data-state="done">
                                <span>분류</span>
                                <strong>{row.categoryLabel}</strong>
                              </li>
                              <li data-step="decision" data-state={row.state === "excluded" ? "locked" : row.state}>
                                <span>판단</span>
                                <strong>{row.decisionLabel}</strong>
                              </li>
                              <li data-step="final" data-state={row.finalActionReady ? "included" : "held"}>
                                <span>마지막 확인</span>
                                <strong>{row.finalActionReady ? "준비 가능" : "후보 대기"}</strong>
                              </li>
                              <li data-step="lock" data-state="locked">
                                <span>발송</span>
                                <strong>잠금</strong>
                              </li>
                            </ol>
                          </section>
                          <dl>
                            <div>
                              <dt>업무 유형</dt>
                              <dd>{row.scenarioLabel}</dd>
                            </div>
                            <div>
                              <dt>AI 판단</dt>
                              <dd>{row.decisionLabel}</dd>
                            </div>
                            <div>
                              <dt>발송 전 점검</dt>
                              <dd>{row.sendCheckSummary}</dd>
                            </div>
                            <div>
                              <dt>발송 경계</dt>
                              <dd>{row.sendBoundaryLabel}</dd>
                            </div>
                            <div>
                              <dt>다음 행동</dt>
                              <dd>{row.nextActionLabel}</dd>
                            </div>
                            <div>
                              <dt>연결 증거</dt>
                              <dd>{row.sourceTraceLabel || "작업함 검토 기록 기준"}</dd>
                            </div>
                          </dl>
                          <div
                            className={styles.mailOpsWorkBenchActions}
                            aria-label={`${row.title} 내부 처리`}
                            data-mailops-workbench-row-actions="route_quick_decision_edit_inside_details"
                            data-mailops-workbench-row-actions-external-mutation="false"
                          >
                            <em>{row.routeLabel}</em>
                            <section
                              className={styles.mailOpsWorkBenchDecisionActions}
                              aria-label={`${row.title} 빠른 결정`}
                              data-mailops-workbench-decision-actions="approve_review_exclude_without_external_mutation"
                              data-mailops-workbench-decision-current={row.decision}
                              data-mailops-workbench-decision-external-mutation="false"
                            >
                              <button
                                type="button"
                                data-mailops-workbench-decision-action="approve"
                                data-active={row.decision === "approve" ? "true" : "false"}
                                onClick={() => handleSetMailOpsWorkBenchDecision(row, "approve")}
                              >
                                답장 보냄
                              </button>
                              <button
                                type="button"
                                data-mailops-workbench-decision-action="hold"
                                data-active={row.decision === "hold" || row.decision === "revise" ? "true" : "false"}
                                onClick={() => handleSetMailOpsWorkBenchDecision(row, "hold")}
                              >
                                수정/확인
                              </button>
                              <button
                                type="button"
                                data-mailops-workbench-decision-action="exclude"
                                data-active={row.decision === "exclude" ? "true" : "false"}
                                onClick={() => handleSetMailOpsWorkBenchDecision(row, "exclude")}
                              >
                                답장 안 보냄
                              </button>
                            </section>
                            <button type="button" onClick={() => handleOpenMailOpsWorkBenchEditor(row)}>
                              수정하기
                            </button>
                          </div>
                        </details>
                        {isEditing ? (
                          <section
                            className={styles.mailOpsWorkBenchEditor}
                            aria-label={`${row.title} 메일 초안 수정`}
                            data-mailops-workbench-editor="draft_edit_save_to_approval_candidate"
                            data-mailops-workbench-editor-external-mutation="false"
                          >
                            <label>
                              <span>수정본 본문</span>
                              <textarea
                                value={draftValue}
                                rows={4}
                                placeholder="수정할 답장 본문을 입력하세요"
                                onChange={(event) =>
                                  setMailOpsWorkBenchDrafts((drafts) => ({
                                    ...drafts,
                                    [row.id]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <div>
                              <button type="button" onClick={() => handleSaveMailOpsWorkBenchDraft(row)}>
                                수정본 저장 후 승인
                              </button>
                              <button type="button" onClick={() => setMailOpsEditingWorkBenchRowId(null)}>
                                닫기
                              </button>
                            </div>
                            <small>저장하면 승인 후보로 넘기지만, 실제 발송은 마지막 확인 전까지 계속 잠겨 있습니다.</small>
                          </section>
                      ) : null}
                    </li>
                    );
                  })}
                </ol>
                {hiddenMailOpsWorkBenchRows.length ? (
                  <details
                    className={styles.mailOpsWorkBenchMoreRows}
                    aria-label="메일 작업대 나머지 행"
                    data-mailops-workbench-more-rows="remaining_rows_on_demand"
                    data-mailops-workbench-more-row-count={hiddenMailOpsWorkBenchRows.length}
                    data-mailops-workbench-more-row-external-mutation="false"
                  >
                    <summary>나머지 메일 {hiddenMailOpsWorkBenchRows.length}건 보기</summary>
                    <ol>
                      {hiddenMailOpsWorkBenchRows.map((row) => {
                        const isEditing = mailOpsEditingWorkBenchRowId === row.id;
                        const isSelected = mailOpsSelectedWorkBenchRowIds.includes(row.id);
                        const draftValue = mailOpsWorkBenchDrafts[row.id] ?? (row.draftPreview.startsWith("초안 없음") ? "" : row.draftPreview);
                        return (
                          <li
                            key={`mailops-workbench-more-${row.id}`}
                            data-mailops-workbench-row={row.id}
                            data-mailops-workbench-more-row={row.id}
                            data-mailops-workbench-more-row-state={row.state}
                            data-mailops-workbench-row-source-kind={row.sourceKind}
                            data-mailops-workbench-row-mobile-share={row.sourceKind === "mobile_share" ? "true" : "false"}
                            data-mailops-workbench-row-role-command={row.sourceKind === "role_command" ? "true" : "false"}
                            data-mailops-workbench-row-state={row.state}
                            data-mailops-workbench-row-route={row.routeLabel}
                            data-mailops-workbench-row-editing={isEditing ? "true" : "false"}
                            data-mailops-workbench-row-final-action-id={row.finalActionWorkItemId}
                            data-mailops-workbench-row-final-ready={row.finalActionReady ? "true" : "false"}
                            data-mailops-workbench-row-source-trace={row.sourceTraceContract}
                            data-mailops-workbench-row-source-trace-label={row.sourceTraceLabel}
                            data-mailops-workbench-row-approval-preview-id={row.approvalPreviewId}
                            data-mailops-workbench-row-approval-work-item-id={row.approvalWorkItemId}
                            data-mailops-workbench-row-selected={isSelected ? "true" : "false"}
                            data-mailops-workbench-row-compact="status_title_next_action_only_details_inside"
                            data-mailops-workbench-row-compact-summary={row.compactSummary}
                            data-mailops-workbench-row-visible-layout="one_line_status_title_next_lock_scenario_inside_details"
                            data-mailops-workbench-row-priority={row.priorityLabel}
                            data-mailops-workbench-row-scenario={row.scenarioLabel}
                            data-mailops-workbench-row-decision-label={row.oneLineDecisionLabel}
                            data-mailops-workbench-row-send-boundary={row.sendBoundaryLabel}
                            data-mailops-workbench-row-reason={row.classificationReasonLabel}
                            data-mailops-workbench-row-approval-outcome={row.approvalOutcomeLabel}
                            data-mailops-workbench-row-action-candidate={row.actionCandidateLabel}
                            data-mailops-workbench-row-checklist={row.reviewChecklistLabels.join("|")}
                            data-mailops-workbench-row-external-mutation="false"
                          >
                            <div
                              className={styles.mailOpsWorkBenchRowShell}
                              aria-label={`${row.title} 메일 업무 한 줄`}
                              data-mailops-workbench-row-shell="select_priority_decision_title_next_action_only"
                            >
                              <label className={styles.mailOpsWorkBenchRowSelect}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleMailOpsWorkBenchRowSelection(row.id)}
                                />
                                <span>선택</span>
                              </label>
                              <span className={styles.mailOpsWorkBenchRowStatus}>{row.categoryLabel}</span>
                              <span
                                className={styles.mailOpsWorkBenchRowDecision}
                                data-mailops-workbench-row-decision={row.decision}
                              >
                                {row.oneLineDecisionLabel}
                              </span>
                              <div
                                className={styles.mailOpsWorkBenchRowMain}
                                aria-label={`${row.title} 한 줄 요약`}
                                data-mailops-workbench-row-main="one_line_summary_details_collapsed"
                              >
                                <strong>{row.title}</strong>
                                <small>{row.compactSummary}</small>
                              </div>
                              <span
                                className={styles.mailOpsWorkBenchRowNext}
                                data-mailops-workbench-row-next-action={row.nextActionLabel}
                              >
                                {row.nextActionLabel}
                              </span>
                              <button
                                type="button"
                                className={styles.mailOpsWorkBenchPrimaryAction}
                                data-mailops-workbench-action="prepare_final_confirmation"
                                data-mailops-workbench-row-primary-action="final_confirmation_or_waiting_only"
                                onClick={() => handlePrepareMailOpsWorkBenchFinalConfirmation(row)}
                                disabled={!onPrepareFinalConfirmation || !row.finalActionReady || preparingFinalActionId === row.finalActionWorkItemId}
                              >
                                {preparingFinalActionId === row.finalActionWorkItemId
                                  ? "준비 중"
                                  : row.finalActionReady
                                    ? "마지막 확인"
                                    : "후보 대기"}
                              </button>
                            </div>
                            <details
                              className={styles.mailOpsWorkBenchRowDetails}
                              aria-label={`${row.title} 상세 근거`}
                              data-mailops-workbench-row-details="draft_reason_flow_evidence_collapsed"
                              data-mailops-workbench-row-details-external-mutation="false"
                            >
                              <summary>
                                <span>상세 보기</span>
                                <small>초안, 판단 근거, 발송 점검</small>
                              </summary>
                              <p>{row.detailSummary}</p>
                              <p>{row.draftPreview}</p>
                              <section
                                className={styles.mailOpsWorkBenchRowFlow}
                                aria-label={`${row.title} 메일 처리 흐름`}
                                data-mailops-workbench-row-flow="classification_draft_edit_approval_final_lock"
                                data-mailops-workbench-row-flow-state={row.state}
                                data-mailops-workbench-row-flow-decision={row.decision}
                                data-mailops-workbench-row-flow-final-ready={row.finalActionReady ? "true" : "false"}
                                data-mailops-workbench-row-flow-external-mutation="false"
                              >
                                <ol>
                                  <li data-step="classification" data-state="done">
                                    <span>분류</span>
                                    <strong>{row.categoryLabel}</strong>
                                  </li>
                                  <li data-step="decision" data-state={row.state === "excluded" ? "locked" : row.state}>
                                    <span>판단</span>
                                    <strong>{row.decisionLabel}</strong>
                                  </li>
                                  <li data-step="final" data-state={row.finalActionReady ? "included" : "held"}>
                                    <span>마지막 확인</span>
                                    <strong>{row.finalActionReady ? "준비 가능" : "후보 대기"}</strong>
                                  </li>
                                  <li data-step="lock" data-state="locked">
                                    <span>발송</span>
                                    <strong>잠금</strong>
                                  </li>
                                </ol>
                              </section>
                              <div
                                className={styles.mailOpsWorkBenchActions}
                                aria-label={`${row.title} 내부 처리`}
                                data-mailops-workbench-row-actions="route_quick_decision_edit_inside_details"
                                data-mailops-workbench-row-actions-external-mutation="false"
                              >
                                <em>{row.routeLabel}</em>
                                <section
                                  className={styles.mailOpsWorkBenchDecisionActions}
                                  aria-label={`${row.title} 빠른 결정`}
                                  data-mailops-workbench-decision-actions="approve_review_exclude_without_external_mutation"
                                  data-mailops-workbench-decision-current={row.decision}
                                  data-mailops-workbench-decision-external-mutation="false"
                                >
                                  <button
                                    type="button"
                                    data-mailops-workbench-decision-action="approve"
                                    data-active={row.decision === "approve" ? "true" : "false"}
                                    onClick={() => handleSetMailOpsWorkBenchDecision(row, "approve")}
                                  >
                                    답장 보냄
                                  </button>
                                  <button
                                    type="button"
                                    data-mailops-workbench-decision-action="hold"
                                    data-active={row.decision === "hold" || row.decision === "revise" ? "true" : "false"}
                                    onClick={() => handleSetMailOpsWorkBenchDecision(row, "hold")}
                                  >
                                    수정/확인
                                  </button>
                                  <button
                                    type="button"
                                    data-mailops-workbench-decision-action="exclude"
                                    data-active={row.decision === "exclude" ? "true" : "false"}
                                    onClick={() => handleSetMailOpsWorkBenchDecision(row, "exclude")}
                                  >
                                    답장 안 보냄
                                  </button>
                                </section>
                                <button type="button" onClick={() => handleOpenMailOpsWorkBenchEditor(row)}>
                                  수정하기
                                </button>
                              </div>
                            </details>
                            {isEditing ? (
                              <section
                                className={styles.mailOpsWorkBenchEditor}
                                aria-label={`${row.title} 메일 초안 수정`}
                                data-mailops-workbench-editor="draft_edit_save_to_approval_candidate"
                                data-mailops-workbench-editor-external-mutation="false"
                              >
                                <label>
                                  <span>수정본 본문</span>
                                  <textarea
                                    value={draftValue}
                                    rows={4}
                                    placeholder="수정할 답장 본문을 입력하세요"
                                    onChange={(event) =>
                                      setMailOpsWorkBenchDrafts((drafts) => ({
                                        ...drafts,
                                        [row.id]: event.target.value,
                                      }))
                                    }
                                  />
                                </label>
                                <div>
                                  <button type="button" onClick={() => handleSaveMailOpsWorkBenchDraft(row)}>
                                    수정본 저장 후 승인
                                  </button>
                                  <button type="button" onClick={() => setMailOpsEditingWorkBenchRowId(null)}>
                                    닫기
                                  </button>
                                </div>
                                <small>저장하면 승인 후보로 넘기지만, 실제 발송은 마지막 확인 전까지 계속 잠겨 있습니다.</small>
                              </section>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                ) : null}
                <section
                  id="mailops-final-confirmation-queue"
                  className={styles.mailOpsFinalConfirmationQueue}
                  aria-label="메일 마지막 확인 대기열"
                  data-mailops-final-confirmation-queue="approved_rows_review_order_before_send"
                  data-mailops-final-confirmation-runway="approved_row_dry_run_final_confirm_execution_log"
                  data-mailops-final-confirmation-dry-run-contract="approved_row_to_dry_run_receipt_before_external_send"
                  data-mailops-final-confirmation-execution-log-contract="final_confirmation_to_execution_log_receipt"
                  data-mailops-final-confirmation-send-policy="dry_run_then_user_final_confirm_then_live_adapter"
                  data-mailops-final-confirmation-queue-total={mailOpsFinalConfirmationQueueRows.length}
                  data-mailops-final-confirmation-ready={mailOpsFinalConfirmationReadyRows.length}
                  data-mailops-final-confirmation-waiting={mailOpsFinalConfirmationWaitingRows.length}
                  data-mailops-final-confirmation-next-title={mailOpsFinalConfirmationNextRow?.title ?? "missing"}
                  data-mailops-final-confirmation-engine-handoff={mailOpsWorkQueueAutomationEvidence.evidenceContract}
                  data-mailops-final-confirmation-approval-gate={mailOpsWorkQueueAutomationEvidence.approvalGateContract}
                  data-mailops-final-confirmation-external-mutation="false"
                >
                  <header>
                    <div>
                      <span>마지막 확인 대기열</span>
                      <strong>승인된 메일을 마지막 확인 순서대로 봅니다</strong>
                    </div>
                    <small>바로 보낼 수 있는 후보와 아직 연결이 필요한 후보를 분리합니다</small>
                  </header>
                  <section
                    className={styles.mailOpsFinalExecutionRunway}
                    aria-label="메일 최종 실행 준비 레일"
                    data-mailops-final-execution-runway="approved_row_to_dry_run_to_final_confirmation_to_execution_log"
                    data-mailops-final-execution-runway-ready={mailOpsFinalConfirmationReadyRows.length}
                    data-mailops-final-execution-runway-waiting={mailOpsFinalConfirmationWaitingRows.length}
                    data-mailops-final-execution-runway-next-title={mailOpsFinalConfirmationNextRow?.title ?? "missing"}
                    data-mailops-final-execution-runway-send-policy="dry_run_then_user_final_confirm_then_live_adapter"
                    data-mailops-final-execution-runway-external-mutation="false"
                  >
                    <span>실행 준비</span>
                    <ol>
                      {mailOpsFinalExecutionRunwayItems.map((item) => (
                        <li key={`mailops-final-execution-runway-${item.id}`} data-step={item.id} data-state={item.state}>
                          <strong>{item.label}</strong>
                          <small>{item.title}</small>
                          <em>{item.detail}</em>
                        </li>
                      ))}
                    </ol>
                  </section>
                  {mailOpsFinalConfirmationQueueRows.length ? (
                    <>
                      <section
                        className={styles.mailOpsFinalConfirmationReviewStrip}
                        aria-label="메일 최종 확인 한 줄 점검"
                        data-mailops-final-review-strip="recipient_body_attachment_lock_one_line"
                        data-mailops-final-review-strip-total={mailOpsFinalConfirmationQueueRows.length}
                        data-mailops-final-review-strip-ready={mailOpsFinalConfirmationReadyRows.length}
                        data-mailops-final-review-strip-waiting={mailOpsFinalConfirmationWaitingRows.length}
                        data-mailops-final-review-strip-external-mutation="false"
                      >
                        <div>
                          <span>발송 직전 점검</span>
                          <strong>
                            준비 {mailOpsFinalConfirmationReadyRows.length}건 · 연결 필요 {mailOpsFinalConfirmationWaitingRows.length}건
                          </strong>
                          <small>수신자, 본문, 첨부, 발송 잠금을 한 줄로 먼저 확인합니다.</small>
                        </div>
                        <ol>
                          {mailOpsFinalConfirmationQueueRows.map((row, index) => (
                            <li
                              key={`mailops-final-review-${row.id}`}
                              data-mailops-final-review-row={row.id}
                              data-mailops-final-review-row-ready={row.finalActionReady ? "true" : "false"}
                              data-mailops-final-review-row-lock="send_locked_until_final_confirmation"
                              data-mailops-final-review-row-external-mutation="false"
                            >
                              <span>{index + 1}</span>
                              <strong>{row.title}</strong>
                              <small>수신자/첨부: {row.sendCheckSummary}</small>
                              <small>본문: {row.draftPreview}</small>
                              <b>{row.finalActionReady ? "최종 확인 가능" : "후보 연결 필요"}</b>
                              <em>발송 잠금</em>
                            </li>
                          ))}
                        </ol>
                      </section>
                      <ol className={styles.mailOpsFinalConfirmationQueueRows}>
                        {mailOpsFinalConfirmationQueueRows.map((row, index) => (
                          <li
                            key={row.id}
                            data-mailops-final-confirmation-row={row.id}
                            data-mailops-final-confirmation-row-ready={row.finalActionReady ? "true" : "false"}
                            data-mailops-final-confirmation-row-external-mutation="false"
                            data-mailops-final-confirmation-row-compact="order_title_status_action_only_details_inside"
                            data-mailops-final-confirmation-row-compact-summary={`${index + 1}. ${row.title} · ${
                              row.finalActionReady ? "최종 확인 준비 가능" : "승인 후보 연결 필요"
                            }`}
                          >
                            <span>{index + 1}</span>
                            <div
                              className={styles.mailOpsFinalConfirmationQueueRowMain}
                              aria-label={`${row.title} 마지막 확인 한 줄 요약`}
                              data-mailops-final-confirmation-row-main="one_line_summary_details_collapsed"
                            >
                              <strong>{row.title}</strong>
                            </div>
                            <em>{row.finalActionReady ? "최종 확인 준비 가능" : "승인 후보 연결 필요"}</em>
                            <button
                              type="button"
                              onClick={() => handlePrepareMailOpsWorkBenchFinalConfirmation(row)}
                              disabled={!onPrepareFinalConfirmation || !row.finalActionReady || preparingFinalActionId === row.finalActionWorkItemId}
                            >
                              {preparingFinalActionId === row.finalActionWorkItemId
                                ? "준비 중"
                                : row.finalActionReady
                                  ? "최종 확인 준비"
                                  : "후보 대기"}
                            </button>
                            <details
                              className={styles.mailOpsFinalConfirmationQueueRowDetails}
                              aria-label={`${row.title} 마지막 확인 상세`}
                              data-mailops-final-confirmation-row-details="send_check_route_lock_collapsed"
                              data-mailops-final-confirmation-row-details-external-mutation="false"
                            >
                              <summary>
                                <span>상세 보기</span>
                                <small>{row.sendCheckSummary}</small>
                              </summary>
                              <p>{row.sendCheckSummary}</p>
                              <small>
                                {row.finalActionReady
                                  ? "승인된 메일만 마지막 확인으로 이동하고 실제 발송은 계속 잠깁니다."
                                  : "승인 후보 연결이 끝날 때까지 발송 경로를 열지 않습니다."}
                              </small>
                            </details>
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : (
                    <p>아직 답장 보내기로 승인한 메일이 없습니다. 승인 전에는 마지막 확인과 발송 경로가 열리지 않습니다.</p>
                  )}
                  <footer>
                    <span>외부 실행 0건</span>
                    <small>사용자가 마지막 확인을 완료하기 전까지 발송하지 않습니다.</small>
                  </footer>
                </section>
                {userComposedMailApprovalRows.length ? (
                  <section
                    id="mailops-user-composed-check"
                    className={styles.userComposedMailCheckDesk}
                    aria-label="작성 메일 점검함"
                    data-mailops-anchor-target="user_composed_check"
                    data-mailops-supported-work-filter-active={
                      mailOpsSupportedWorkFocusRoute === "manual_compose_to_check" ? "true" : "false"
                    }
                    data-user-composed-mail-check-desk="compose_content_check_edit_approve_final_confirmation"
                    data-user-composed-mail-check-total={userComposedMailApprovalRows.length}
                    data-user-composed-mail-check-ready={userComposedMailReadyCount}
                    data-user-composed-mail-check-needs-review={userComposedMailNeedsReviewCount}
                    data-user-composed-mail-check-send-review-count={userComposedMailSendReviewCount}
                    data-user-composed-mail-check-review-item-count={userComposedMailReviewItemCount}
                    data-user-composed-mail-check-review-needed-count={userComposedMailNeedsReviewItemCount}
                    data-user-composed-mail-check-missing-count={userComposedMailMissingItemCount}
                    data-user-composed-mail-check-locked-count={userComposedMailLockedSendReviewCount}
                    data-user-composed-mail-check-next-action={userComposedMailNextActionLabel}
                    data-user-composed-mail-check-external-mutation="false"
                  >
                    <header>
                      <div>
                        <span>작성 메일 점검함</span>
                        <strong>내가 쓴 메일도 보내기 전에 점검합니다</strong>
                      </div>
                      <small>수신자, 제목, 본문, 첨부, 위험 표현, 일정 영향을 확인하고 승인 후보로만 넘깁니다</small>
                    </header>
                    <section
                      className={styles.userComposedMailCheckSummary}
                      aria-label="작성 메일 점검 요약"
                      data-user-composed-mail-check-summary="recipient_body_attachment_risk_approval_lock"
                      data-user-composed-mail-check-summary-ready={userComposedMailReadyCount}
                      data-user-composed-mail-check-summary-review-needed={userComposedMailNeedsReviewItemCount}
                      data-user-composed-mail-check-summary-missing={userComposedMailMissingItemCount}
                      data-user-composed-mail-check-summary-locked={userComposedMailLockedSendReviewCount}
                      data-user-composed-mail-check-summary-next-action={userComposedMailNextActionLabel}
                      data-user-composed-mail-check-summary-external-mutation="false"
                    >
                      <div>
                        <span>지금 할 일</span>
                        <strong>{userComposedMailNextActionLabel}</strong>
                        <small>수신자, 본문, 첨부, 위험 표현을 확인한 뒤 마지막 확인 전까지 발송을 잠급니다.</small>
                      </div>
                      <ol>
                        <li data-state={userComposedMailReadyCount > 0 ? "ready" : "review"}>
                          <span>점검 통과</span>
                          <strong>{userComposedMailReadyCount}건</strong>
                        </li>
                        <li data-state={userComposedMailNeedsReviewItemCount > 0 ? "review" : "ready"}>
                          <span>수정 필요</span>
                          <strong>{userComposedMailNeedsReviewItemCount}개</strong>
                        </li>
                        <li data-state={userComposedMailMissingItemCount > 0 ? "review" : "ready"}>
                          <span>누락 항목</span>
                          <strong>{userComposedMailMissingItemCount}개</strong>
                        </li>
                        <li data-state="locked">
                          <span>발송 잠금</span>
                          <strong>{userComposedMailLockedSendReviewCount}개</strong>
                        </li>
                      </ol>
                    </section>
                    <ol className={styles.userComposedMailCheckRows}>
                      {userComposedMailApprovalRows.map((row) => {
                        const isEditing = editingUserComposedMailId === row.item.id;
                        const draft = userComposedMailDrafts[row.item.id] ?? userComposedMailDraftFieldsForItem(row.item);
                        return (
                          <li
                            key={row.item.id}
                            data-user-composed-mail-check-row={row.item.id}
                            data-user-composed-mail-check-row-ready={row.ready ? "true" : "false"}
                            data-user-composed-mail-check-row-missing={row.missingCount}
                            data-user-composed-mail-check-row-editing={isEditing ? "true" : "false"}
                            data-user-composed-mail-check-row-mobile-receive={row.review?.mobileReceiveFilterLabels?.join(",") ?? ""}
                            data-user-composed-mail-check-row-final-route={row.review?.finalRouteLabel ?? ""}
                            data-user-composed-mail-check-row-compact="status_subject_action_only_details_inside"
                            data-user-composed-mail-check-row-external-mutation="false"
                          >
                            <div
                              className={styles.userComposedMailCheckRowMain}
                              aria-label={`${row.item.title} 작성 메일 한 줄 요약`}
                              data-user-composed-mail-check-row-main="one_line_summary_details_collapsed"
                            >
                              <span>{row.ready ? "점검 가능" : "수정 필요"}</span>
                              <strong>{row.item.sourceEvidence?.messageSubject || row.item.title}</strong>
                              <small>
                                {row.review?.oneLineSummary ||
                                  `통과 ${row.reviewItems.length - row.needsReviewCount}건 · 확인 ${row.needsReviewCount}건 · 발송 전 요약 ${row.sendReviewItems.length}건`}
                              </small>
                            </div>
                            <details
                              className={styles.userComposedMailCheckRowDetails}
                              aria-label={`${row.item.title} 작성 메일 상세 점검`}
                              data-user-composed-mail-check-row-details="recipient_check_items_approval_lock_collapsed"
                              data-user-composed-mail-check-row-details-external-mutation="false"
                            >
                              <summary>
                                <span>상세 보기</span>
                                <small>수신자, 본문, 첨부, 위험 표현</small>
                              </summary>
                              <p>{row.review?.revisionSuggestion || "수정 제안 확인 후 승인 후보로 넘깁니다."}</p>
                              <dl>
                                <div>
                                  <dt>수신 유형</dt>
                                  <dd>{row.review?.mobileReceiveFilterLabels?.join(" / ") || "승인 대기"}</dd>
                                </div>
                                <div>
                                  <dt>수신자</dt>
                                  <dd>{row.item.sourceEvidence?.replyToLabel || "입력 필요"}</dd>
                                </div>
                                <div>
                                  <dt>점검</dt>
                                  <dd>
                                    통과 {row.reviewItems.length - row.needsReviewCount}건 · 확인 {row.needsReviewCount}건 · 발송 전 요약 {row.sendReviewItems.length}건
                                  </dd>
                                </div>
                                <div>
                                  <dt>발송 경계</dt>
                                  <dd>{row.review?.approvalGate || "사용자 최종 확인 전 외부 발송 없음"}</dd>
                                </div>
                                <div>
                                  <dt>이동 경로</dt>
                                  <dd>{row.review?.finalRouteLabel || "작성 메일 점검 -> 승인 후보 -> 앱 마지막 확인"}</dd>
                                </div>
                              </dl>
                              {row.review?.revisedDraftPreview ? (
                                <p className={styles.userComposedMailRevisedPreview}>
                                  {row.review.revisedDraftPreview}
                                </p>
                              ) : null}
                              <ol aria-label={`${row.item.title} 작성 메일 점검 항목`}>
                                {row.reviewItems.slice(0, 5).map((review) => (
                                  <li key={`${row.item.id}-compose-check-${review.id ?? review.label}`} data-state={review.state ?? "needs_review"}>
                                    <span>{review.label ?? "점검"}</span>
                                    <strong>{userComposedMailReviewStateLabel(review.state)}</strong>
                                    <small>{review.detail ?? "최종 확인 전 다시 점검합니다."}</small>
                                  </li>
                                ))}
                              </ol>
                            </details>
                            <div className={styles.userComposedMailCheckActions}>
                              <button
                                type="button"
                                onClick={() => onPrepareFinalConfirmation?.(userComposedMailOverrides[row.item.id] ?? row.item)}
                                disabled={!onPrepareFinalConfirmation || !row.ready || preparingFinalActionId === row.item.id}
                              >
                                {preparingFinalActionId === row.item.id
                                  ? "준비 중"
                                  : row.ready
                                    ? "작성 메일 마지막 확인 준비"
                                    : "수정 확인 필요"}
                              </button>
                              <button type="button" onClick={() => handleOpenUserComposedMailEditor(row.item)}>
                                수정하기
                              </button>
                            </div>
                            {isEditing ? (
                              <section
                                className={styles.userComposedMailEditor}
                                aria-label={`${row.item.title} 작성 메일 수정`}
                                data-user-composed-mail-editor="edit_to_recheck_approval_candidate"
                                data-user-composed-mail-editor-external-mutation="false"
                              >
                                <label>
                                  <span>수신자</span>
                                  <input
                                    value={draft.to}
                                    onChange={(event) => handleChangeUserComposedMailDraft(row.item.id, "to", event.target.value)}
                                    placeholder="받는 사람"
                                  />
                                </label>
                                <label>
                                  <span>제목</span>
                                  <input
                                    value={draft.subject}
                                    onChange={(event) => handleChangeUserComposedMailDraft(row.item.id, "subject", event.target.value)}
                                    placeholder="메일 제목"
                                  />
                                </label>
                                <label>
                                  <span>첨부 메모</span>
                                  <input
                                    value={draft.attachments}
                                    onChange={(event) => handleChangeUserComposedMailDraft(row.item.id, "attachments", event.target.value)}
                                    placeholder="첨부 없음 또는 파일 확인 메모"
                                  />
                                </label>
                                <label>
                                  <span>본문</span>
                                  <textarea
                                    value={draft.body}
                                    rows={4}
                                    onChange={(event) => handleChangeUserComposedMailDraft(row.item.id, "body", event.target.value)}
                                    placeholder="발송 전 점검할 메일 본문"
                                  />
                                </label>
                                <div>
                                  <button type="button" onClick={() => handleSaveUserComposedMailDraft(row.item)}>
                                    수정본 저장 후 점검
                                  </button>
                                  <button type="button" onClick={() => setEditingUserComposedMailId(null)}>
                                    닫기
                                  </button>
                                </div>
                                <small>저장해도 실제 발송은 하지 않고, 작성 메일 승인 후보와 마지막 확인 기본값만 갱신합니다.</small>
                              </section>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                    <footer>
                      <span>발송 잠금</span>
                      <small>점검 결과를 저장해도 마지막 확인 전까지 실제 메일, 일정 등록, 첨부 발송은 실행하지 않습니다.</small>
                    </footer>
                  </section>
                ) : null}
                {mailOpsWorkBenchSaveMessage ? (
                  <p className={styles.mailOpsWorkBenchSaveMessage}>{mailOpsWorkBenchSaveMessage}</p>
                ) : null}
                <footer>
                  <span>승인만 발송 후보</span>
                  <small>보류, 수정 요청, 제외 항목은 최종 확인 카드와 실제 발송 경로에서 빠집니다.</small>
                </footer>
              </section>
            ) : null}
            <section
              className={styles.mailOpsEventTimeline}
              aria-label="메일 업무 이벤트 타임라인"
              data-mailops-event-timeline="read_classify_draft_review_approval_final_lock"
              data-mailops-event-source="work_queue_review_records"
              data-mailops-event-total={mailOpsEventReviewSummary.total}
              data-mailops-event-candidate-count={mailCalendarActionCandidates.length}
              data-mailops-event-approved={mailOpsEventReviewSummary.approve}
              data-mailops-event-held={mailOpsEventReviewSummary.revise + mailOpsEventReviewSummary.hold}
              data-mailops-event-excluded={mailOpsEventReviewSummary.exclude}
              data-mailops-event-composed={mailOpsEventAutomationEvidence.composedCount}
              data-mailops-event-proof-chain={mailOpsWorkQueueProofChainContract}
              data-mailops-event-engine-handoff={mailOpsEventAutomationEvidence.evidenceContract}
              data-mailops-event-engine-path={mailOpsEventAutomationEvidence.enginePathContract}
              data-mailops-event-automation-proof={mailOpsEventAutomationEvidence.proofLabel}
              data-mailops-event-worker-state-evidence={`업무대장 ${mailOpsEventReviewSummary.total}건 · 작성 메일 점검 ${mailOpsEventAutomationEvidence.composedCount}건 · 외부 실행 0건`}
              data-mailops-event-external-mutation="false"
            >
              <header>
                <div>
                  <span>AI 직원 이벤트</span>
                  <strong>메일 업무가 어디까지 왔는지</strong>
                </div>
                <small>업무대장 기록 기준 · 최종 확인 전 발송 없음</small>
              </header>
              <div
                className={styles.mailOpsEventCompactSummary}
                aria-label="메일 업무 이벤트 한 줄 요약"
                data-mailops-event-compact-summary="counts_only_details_collapsed"
                data-mailops-event-compact-summary-external-mutation="false"
              >
                <span>요약</span>
                <strong>
                  총 {mailOpsEventReviewSummary.total}건 · 승인 {mailOpsEventReviewSummary.approve}건 · 검토 {mailOpsEventReviewSummary.revise + mailOpsEventReviewSummary.hold}건 · 제외 {mailOpsEventReviewSummary.exclude}건 · 작성 {mailOpsEventAutomationEvidence.composedCount}건
                </strong>
                <small>외부 실행 0건</small>
              </div>
              <details
                className={styles.mailOpsEventTimelineDetails}
                aria-label="메일 업무 이벤트 상세 증거"
                data-mailops-event-details="proof_chain_event_steps_collapsed"
                data-mailops-event-details-external-mutation="false"
              >
                <summary>
                  <span>상세 보기</span>
                  <small>업무대장 → 승인함 후보 → 마지막 확인 → 실행 로그</small>
                </summary>
                <p>증거 사슬: 업무대장 → 승인함 후보 → 마지막 확인 → 실행 로그</p>
                <p>자동화 엔진 증거: {mailOpsEventAutomationEvidence.proofLabel}</p>
                <p>작성 메일 이벤트 증거: {mailOpsEventAutomationEvidence.composedCount}건 · 마지막 확인 전 외부 실행 없음</p>
                <ol>
                  {mailOpsWorkQueueEventTimeline.map((event) => (
                    <li key={event.id} data-state={event.state} data-event={event.id}>
                      <span>{event.label}</span>
                      <div>
                        <strong>{event.title}</strong>
                        <small>{event.detail}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </section>
            <section
              className={styles.approvalWorkerResultRail}
              aria-label="메일 담당 직원 승인함 결과"
              data-mailops-worker-approval-result="worker_output_to_approval_final_lock"
              data-worker-result-final-boundary="approval_before_external_mutation"
              data-mailops-worker-output-path="read_classify_draft_review_approval_final_lock"
              data-mailops-worker-result-total={mailOpsEventReviewSummary.total}
              data-mailops-worker-result-approval-ready={mailOpsEventReviewSummary.approve}
              data-mailops-worker-result-external-mutation="false"
            >
              <header>
                <span>직원 결과물</span>
                <strong>메일 담당자가 승인함에 올린 일</strong>
                <small>업무대장 → 승인함 후보 → 마지막 확인 → 실행 로그</small>
              </header>
              <ol>
                <li data-state="ready">
                  <span>읽기·분류</span>
                  <strong>{mailOpsEventReviewSummary.total}건</strong>
                  <small>받은 메일을 업무 행으로 나눴습니다.</small>
                </li>
                <li data-state={mailOpsEventReviewSummary.approve ? "approval" : "locked"}>
                  <span>승인 후보</span>
                  <strong>{mailOpsEventReviewSummary.approve}건</strong>
                  <small>답장/일정 후보만 마지막 확인으로 보냅니다.</small>
                </li>
                <li data-state="locked">
                  <span>실행 잠금</span>
                  <strong>외부 실행 0건</strong>
                  <small>사용자 최종 확인 전 발송, 등록, 첨부 처리는 없습니다.</small>
                </li>
              </ol>
            </section>
            <ol>
              {mailOpsApprovalAssistantQueue.map((item) => (
                <li
                  key={item.id}
                  data-kind={item.kind}
                  data-readiness={item.readiness}
                  data-mailops-assistant-row-compact="status_title_action_only_details_inside"
                  data-mailops-assistant-row-compact-summary={item.compactSummary}
                  data-mailops-assistant-row-external-mutation="false"
                >
                  <span>{item.label}</span>
                  <div
                    className={styles.mailOpsAssistantMain}
                    aria-label={`${item.title} 승인 후보 한 줄 요약`}
                    data-mailops-assistant-row-main="one_line_summary_details_collapsed"
                  >
                    <strong>{item.title}</strong>
                    <small>{item.compactSummary}</small>
                  </div>
                  <details
                    className={styles.mailOpsAssistantDetails}
                    aria-label={`${item.title} 승인 후보 상세`}
                    data-mailops-assistant-row-details="preview_review_flow_lock_collapsed"
                    data-mailops-assistant-row-details-external-mutation="false"
                  >
                    <summary>
                      <span>상세 보기</span>
                      <small>초안, 검토 메모, 승인 흐름</small>
                    </summary>
                    <p>{item.detailSummary}</p>
                    <p>{item.preview}</p>
                    {item.meta.length ? (
                      <div className={styles.mailOpsAssistantMeta}>
                        {item.meta.map((meta) => (
                          <em key={`${item.id}-${meta}`}>{meta}</em>
                        ))}
                      </div>
                    ) : null}
                    {item.queueReview ? (
                      <section
                        className={styles.mailOpsAssistantReviewContext}
                        aria-label={`${item.title} 작업함 검토 요약`}
                        data-mailops-office-review-context={item.queueReview.approvalContext}
                        data-mailops-office-review-decision={mailOpsWorkQueueDecisionLabel(item.queueReview.decision)}
                        data-mailops-office-review-external-mutation="false"
                      >
                        <span>작업함 검토</span>
                        <div>
                          <strong>{mailOpsWorkQueueDecisionLabel(item.queueReview.decision)}</strong>
                          <small>
                            {item.queueReview.note
                              ? `수정 메모: ${item.queueReview.note}`
                              : "수정 메모 없음 · 마지막 확인 전 외부 실행 없음"}
                          </small>
                        </div>
                        <em>마지막 확인 전 발송 없음</em>
                      </section>
                    ) : null}
                    <ol className={styles.mailOpsAssistantRail} aria-label={`${item.title} 승인 흐름`}>
                      {item.rail.map((step) => (
                        <li key={`${item.id}-${step.id}`} data-state={step.state}>
                          <i aria-hidden="true" />
                          <strong>{step.label}</strong>
                          <small>{step.detail}</small>
                        </li>
                      ))}
                    </ol>
                    <code>{item.lockedReason}</code>
                    <code>막히면: {visibleOfficeNextChoice(item.nextUserChoice)}</code>
                  </details>
                  <div className={styles.mailOpsAssistantActions}>
                    <button
                      type="button"
                      data-action="approve"
                      onClick={() => {
                        const target = finalActionCandidates.find((candidate) => candidate.id === item.id);
                        if (target) onRecordMailOpsDecision?.(target, "approved");
                      }}
                      disabled={!onRecordMailOpsDecision || preparingFinalActionId === item.id || recordingMailOpsDecisionId === item.id}
                    >
                      {preparingFinalActionId === item.id || recordingMailOpsDecisionId === item.id ? "처리 중" : "실행하기"}
                    </button>
                    <button
                      type="button"
                      data-action="revise"
                      onClick={() => {
                        const target = finalActionCandidates.find((candidate) => candidate.id === item.id);
                        if (target) onRecordMailOpsDecision?.(target, "change_requested");
                      }}
                      disabled={!onRecordMailOpsDecision || recordingMailOpsDecisionId === item.id}
                    >
                      고쳐달라고 하기
                    </button>
                    <button
                      type="button"
                      data-action="hold"
                      onClick={() => {
                        const target = finalActionCandidates.find((candidate) => candidate.id === item.id);
                        if (target) onRecordMailOpsDecision?.(target, "held");
                      }}
                      disabled={!onRecordMailOpsDecision || recordingMailOpsDecisionId === item.id}
                    >
                      보류하기
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {mailOpsDecisionMessage ? <p className={styles.mailOpsDecisionMessage}>{mailOpsDecisionMessage}</p> : null}
          </div>
        ) : null}
      </section>

      <section className={styles.crewLivePanel} aria-label="AI 팀원 관제">
        <header>
          <div>
            <span>AI 팀원</span>
            <strong>{crewMembers.length ? `${crewMembers.length}명 역할별 작업실` : "기본 비서 준비"}</strong>
          </div>
          <small>{activeChannelLabels.length ? activeChannelLabels.join(" · ") : "앱 메인 컨트롤"}</small>
          <em data-running={runningCrewCount > 0 ? "true" : "false"}>
            <i aria-hidden="true" />
            {officeStateLabel}
          </em>
        </header>
        <div className={styles.controlTower}>
          <div>
            <span>메인 관제</span>
            <strong>AI 팀원 목록</strong>
            <small>{crewChannelIndex ? "역할별 AI 팀원을 이어서 불러옵니다" : "기본 AI 팀원을 준비합니다"}</small>
          </div>
          <dl>
            <div>
              <dt>기억</dt>
              <dd>{readyIdentityCount}/{identityFiles.length || "?"}</dd>
            </div>
            <div>
              <dt>도구 추천</dt>
              <dd>{growthSuggestions.length}</dd>
            </div>
            <div>
              <dt>작업</dt>
              <dd>{visibleWorkCount}</dd>
            </div>
          </dl>
        </div>
        <ol className={styles.crewFlowLane} aria-label="AI 팀원 실행 단계">
          <li data-state="done">
            <span />
            <strong>명령 수신</strong>
            <small>메인 컨트롤</small>
          </li>
          <li data-state={runningCrewCount > 0 ? "active" : activeCrewCount > 0 ? "done" : "todo"}>
            <span />
            <strong>역할 처리</strong>
            <small>{runningCrewCount > 0 ? `${runningCrewCount}명 실행 중` : `${activeCrewCount || crewMembers.length}명 대기`}</small>
          </li>
          <li data-state={visibleWorkCount > 0 ? "active" : "todo"}>
            <span />
            <strong>오피스 기록</strong>
            <small>{visibleWorkCount}개 작업</small>
          </li>
          <li data-state={approvalWaitCount > 0 ? "active" : "todo"}>
            <span />
            <strong>승인 루프</strong>
            <small>{approvalWaitCount ? "확인 필요" : "대기"}</small>
          </li>
        </ol>
        <section className={styles.channelWorkPanel} aria-label="AI 팀원별 병렬 작업">
          <header>
            <div>
              <span>Parallel Channels</span>
              <strong>AI 팀원별 병렬 작업</strong>
            </div>
            <small>
              작업 {channelRunningCount} · 승인 {channelApprovalCount} · 결과 {channelResultCount}
            </small>
          </header>
          {channelWorkSummaries.length ? (
            <ol className={styles.channelWorkGrid}>
              {channelWorkSummaries.slice(0, 8).map((channel) => {
                const channelState =
                  channel.runningCount > 0
                    ? "running"
                    : channel.approvalCount > 0
                      ? "approval"
                      : channel.resultCount > 0
                        ? "result"
                        : "idle";
                return (
                <li key={channel.id} data-state={channelState}>
                  <div className={styles.channelWorkMark}>
                    <span>
                      {channel.teamLabel.slice(0, 1).toUpperCase()}
                      <WorkSignal state={channelState} label={`${channel.name} ${channel.channelName}`} compact />
                    </span>
                    <i aria-hidden="true" />
                  </div>
                  <div className={styles.channelWorkBody}>
                    <div className={styles.channelWorkTitle}>
                      <strong>{channel.name}</strong>
                      <small>{channel.channelName} · {channel.roleTitle}</small>
                    </div>
                    <p>{channel.latestLabel}</p>
                    <small>{channel.latestSource} · {channel.latestDetail}</small>
                    <dl>
                      <div>
                        <dt>작업</dt>
                        <dd>{channel.runningCount}</dd>
                      </div>
                      <div>
                        <dt>승인</dt>
                        <dd>{channel.approvalCount}</dd>
                      </div>
                      <div>
                        <dt>결과</dt>
                        <dd>{channel.resultCount}</dd>
                      </div>
                      <div>
                        <dt>도구 추천</dt>
                        <dd>{channel.growthCount}</dd>
                      </div>
                    </dl>
                    <footer>
                      <em>{channel.statusLabel}</em>
                      <code title="내부 기록 경로는 앱이 관리합니다.">
                        {officeMemoryReferenceLabel(channel.workLogPath)}
                      </code>
                    </footer>
                  </div>
                </li>
                );
              })}
            </ol>
          ) : (
            <p>AI 팀원을 추가하면 역할별 작업, 승인 대기, 결과 기록이 이곳에서 나뉘어 보입니다.</p>
          )}
          <section className={styles.crewKitExecutionPanel} aria-label="기능 실행 레일">
            <header>
              <span>기능 실행</span>
              <strong>AI 팀원이 어떤 능력으로 일하는지</strong>
              <small>{crewKitExecutionSummaries.length ? `${crewKitExecutionSummaries.length}명 연결` : "기능 대기"}</small>
            </header>
            {crewKitExecutionSummaries.length ? (
              <ol>
                {crewKitExecutionSummaries.map((summary) => (
                  <li key={`crewkit-execution-${summary.id}`} data-state={summary.state}>
                    <span>
                      {summary.teamLabel.slice(0, 1).toUpperCase()}
                      <WorkSignal state={summary.state} label={`${summary.name} 기능`} compact />
                    </span>
                    <div>
                      <strong>{summary.label}</strong>
                      <small>{summary.name} · {summary.channelName} · {summary.outputLabel}</small>
                      <p>{summary.detail}</p>
                      <div className={styles.crewKitExecutionStats}>
                        <b>기능 {summary.skillCount}</b>
                        <b>작업 {summary.queueCount}</b>
                        {summary.runningCount ? <b data-tone="running">실행 {summary.runningCount}</b> : null}
                        {summary.approvalCount ? <b data-tone="approval">승인 {summary.approvalCount}</b> : null}
                        {summary.growthCount ? <b data-tone="growth">추천 {summary.growthCount}</b> : null}
                      </div>
                    </div>
                    <code title="내부 기록 경로는 앱이 관리합니다.">{officeMemoryReferenceLabel(summary.memoryPath)}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <p>업무 도구 추천을 수락하거나 첫 실행을 누르면 담당 AI 팀원, 결과 묶음, 승인 상태가 이 레일에 표시됩니다.</p>
            )}
          </section>
          <section className={styles.roleAssignmentPanel} aria-label="역할별 업무 배정 요약">
            <header>
              <span>업무 배정</span>
              <strong>메일 · 문서 · 폴더 작업 배정</strong>
              <small>{roleAssignmentSummaries.length ? `${roleAssignmentSummaries.length}명 팀원 배정 중` : "업무가 들어오면 자동 배정"}</small>
            </header>
            {roleAssignmentSummaries.length ? (
              <ol>
                {roleAssignmentSummaries.map((summary) => (
                  <li key={summary.id} data-active={summary.approvalCount > 0 || summary.runningCount > 0 ? "true" : "false"}>
                    <span>
                      {summary.teamLabel.slice(0, 1).toUpperCase()}
                      <WorkSignal
                        state={summary.runningCount > 0 ? "running" : summary.approvalCount > 0 ? "approval" : "ready"}
                        label={`${summary.name} 업무 배정`}
                        compact
                      />
                    </span>
                    <div>
                      <strong>{summary.name}</strong>
                      <small>{summary.channelName} · {summary.roleTitle}</small>
                      <p>{summary.latestLabel}</p>
                      <em>{summary.latestDetail}</em>
                      <div className={styles.roleAssignmentKinds}>
                        {summary.assignmentKinds.map((kind) => (
                          <b key={`${summary.id}-${kind}`}>{kind}</b>
                        ))}
                        {summary.approvalCount ? <b data-tone="approval">승인 {summary.approvalCount}</b> : null}
                        {summary.runningCount ? <b data-tone="running">실행 {summary.runningCount}</b> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p>메일은 운영 담당, 문서와 정산·폴더 정리는 재무/운영 담당, 외부 사이트 확인은 운영 담당 승인함으로 모입니다.</p>
            )}
          </section>
          <section className={styles.memoryLearningPanel} aria-label="AI 팀원별 업무 방식 학습 요약">
            <header>
              <span>업무 방식 기억</span>
              <strong>AI 팀원별 학습 기억</strong>
              <small>{memoryLearningSummaries.length ? `${memoryLearningSummaries.length}명 학습 중` : "학습 기록 대기"}</small>
            </header>
            {memoryOpenMessage ? <p className={styles.memoryOpenMessage}>{memoryOpenMessage}</p> : null}
            {memoryLearningSummaries.length ? (
              <ol>
                {memoryLearningSummaries.map((summary) => (
                  <li key={`memory-${summary.id}`}>
                    <span>{summary.teamLabel.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <strong>{summary.name}</strong>
                      <small>{summary.channelName} · {summary.latestLearnedLabel || "업무 방식"}</small>
                      <em className={styles.memoryPersonality}>{summary.personalityPreview}</em>
                      <p>{summary.latestLearnedSummary || summary.latestDetail}</p>
                      <div>
                        <b>학습 {summary.learnedWorkCount ?? 0}</b>
                        <b>결정 {summary.recentDecisionCount ?? 0}</b>
                      </div>
                      <div className={styles.memoryLearningActions}>
                        <button
                          type="button"
                          onClick={() => onOpenMemoryFile?.(summary.crewSoulPath)}
                          disabled={!onOpenMemoryFile}
                        >
                          업무 방식 열기
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenMemoryFile?.(summary.workLogPath)}
                          disabled={!onOpenMemoryFile}
                        >
                          작업 기록 열기
                        </button>
                      </div>
                    </div>
                    <code title="내부 기록 경로는 앱이 관리합니다.">{officeMemoryReferenceLabel(summary.crewSoulPath)}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <p>메일, 문서, 폴더, 승인 수정 기록이 쌓이면 담당 AI 팀원의 업무 방식과 작업 기록에 요약되어 이곳에 표시됩니다.</p>
            )}
          </section>
          {visibleChannelQueueItems.length ? (
            <section className={styles.channelQueueDetail} aria-label="AI 팀원별 실행 결과 오피스 승인함">
              <header>
                <span>AI 팀원 결과</span>
                <strong>실행 · 승인 · 결과</strong>
                <small>{visibleChannelQueueItems.length}개 최근 항목</small>
              </header>
              <ol>
                {visibleChannelQueueItems.map((item) => (
                  (() => {
                    const queueArtifact = item.artifactId
                      ? delegationArtifacts.find((artifact) => artifact.id === item.artifactId)
                      : null;
                    const queueWorkItem = item.workItemId
                      ? finalActionCandidates.find((candidate) => candidate.id === item.workItemId)
                      : null;
                    const canDecideArtifact =
                      queueArtifact?.artifactKind === "approval" && !queueArtifact.approvalDecision;
                    const actionProfile = channelQueueActionProfile(item, Boolean(queueArtifact), Boolean(queueWorkItem));
                    const nextSteps = channelQueueNextSteps(item, Boolean(queueArtifact), Boolean(queueWorkItem));
                    const isFocusedQueueItem = focusedChannelIds.has(item.teammateId);
                    return (
                      <li key={item.id} data-kind={item.kind} data-focused={isFocusedQueueItem ? "true" : "false"}>
                        <span>{item.teamLabel.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{item.label}</strong>
                          <small>{item.teammateName} · {item.channelName} · {channelQueueKindLabel(item.kind)}</small>
                          <i className={styles.queuePulseDot} aria-hidden="true" />
                          {item.queueLabel || item.outputKind ? (
                            <div className={styles.queueMetaRow}>
                              {item.queueLabel ? <span>{item.queueLabel}</span> : null}
                              {item.outputKind ? <span>{outputKindLabel(item.outputKind)}</span> : null}
                              {item.approvalRequired ? <span data-tone="approval">승인 필요</span> : null}
                            </div>
                          ) : null}
                          <p>{item.detail}</p>
                          <em>{item.sourceLabel}</em>
                          <div className={styles.channelQueueActionHint} data-tone={actionProfile.tone}>
                            <b>{actionProfile.label}</b>
                            <small>{actionProfile.detail}</small>
                          </div>
                          <ol className={styles.queueActionRail} aria-label={`${item.label} 다음 액션`}>
                            {nextSteps.map((step) => (
                              <li key={step.id} data-state={step.state}>
                                <i aria-hidden="true" />
                                <strong>{step.label}</strong>
                                <small>{step.detail}</small>
                              </li>
                            ))}
                          </ol>
                          {canDecideArtifact ? (
                            <DelegationDecisionOutcomeRail artifact={queueArtifact} label={item.label} />
                          ) : null}
                          {queueArtifact || queueWorkItem || item.memoryPath ? (
                            <div className={styles.channelQueueActions} aria-label={`${item.label} 실행 액션`}>
                              {queueArtifact ? (
                                <button
                                  type="button"
                                  data-action="artifact"
                                  onClick={() => onOpenDelegationArtifact?.(queueArtifact)}
                                  disabled={!onOpenDelegationArtifact}
                                >
                                  결과 기록 열기
                                </button>
                              ) : null}
                              {canDecideArtifact ? (
                                <>
                                  <button
                                    type="button"
                                    data-action="approve"
                                    onClick={() => onRecordDelegationDecision?.(queueArtifact, "approved")}
                                    disabled={!onRecordDelegationDecision}
                                  >
                                    실행하기
                                  </button>
                                  <button
                                    type="button"
                                    data-action="revise"
                                  onClick={() => onRecordDelegationDecision?.(queueArtifact, "change_requested")}
                                  disabled={!onRecordDelegationDecision}
                                >
                                    고쳐달라고 하기
                                  </button>
                                  <button
                                    type="button"
                                    data-action="hold"
                                    onClick={() => onRecordDelegationDecision?.(queueArtifact, "held")}
                                    disabled={!onRecordDelegationDecision}
                                  >
                                    보류하기
                                  </button>
                                </>
                              ) : null}
                              {queueWorkItem ? (
                                <button
                                  type="button"
                                  data-action="confirm"
                                  onClick={() => onPrepareFinalConfirmation?.(queueWorkItem)}
                                  disabled={!onPrepareFinalConfirmation || preparingFinalActionId === queueWorkItem.id}
                                >
                                  {preparingFinalActionId === queueWorkItem.id ? "준비 중" : "마지막 확인 준비"}
                                </button>
                              ) : null}
                              {item.memoryPath ? (
                                <button
                                  type="button"
                                  data-action="memory"
                                  onClick={() => onOpenMemoryFile?.(item.memoryPath!)}
                                  disabled={!onOpenMemoryFile}
                                >
                                  {item.kind === "growth" ? "업무 도구 추천 열기" : item.kind === "running" ? "작업 기록 열기" : "기억 열기"}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        {item.memoryPath ? <code title="내부 기록 경로는 앱이 관리합니다.">{officeMemoryReferenceLabel(item.memoryPath)}</code> : null}
                      </li>
                    );
                  })()
                ))}
              </ol>
            </section>
          ) : null}
        </section>
        <div className={styles.crewLiveGrid}>
          {crewMembers.slice(0, 8).map((member) => (
            <article
              key={member.id}
              data-active={member.active ? "true" : "false"}
              data-running={member.running ? "true" : "false"}
            >
              <span>
                {member.teamLabel.slice(0, 1).toUpperCase()}
                <WorkSignal state={member.running ? "running" : member.active ? "ready" : "idle"} label={`${member.name} AI 팀원 작업`} compact />
              </span>
              <div>
                <strong>{member.name}</strong>
                <small>{member.channelName} · {member.roleTitle}</small>
              </div>
              <p>{member.latestDetail}</p>
              <dl>
                <div>
                  <dt>상태</dt>
                  <dd>{member.running ? "실행 중" : member.active ? "대기" : "휴식"}</dd>
                </div>
                <div>
                  <dt>기억</dt>
                  <dd>{member.identityReadyCount}/{member.identityFileCount || "?"}</dd>
                </div>
                <div>
                          <dt>업무 도구</dt>
                  <dd>{member.skillCount}개</dd>
                </div>
                <div>
                  <dt>도구 추천</dt>
                  <dd>{member.assignedGrowthCount}</dd>
                </div>
              </dl>
              <footer>
                <small>업무 기억 · 작업 기록 · 결정 기록</small>
                <code title="내부 기록 경로는 앱이 관리합니다.">
                  {officeMemoryReferenceLabel(member.workLogPath)}
                </code>
                <button
                  type="button"
                  onClick={() => onOpenMemoryFile?.(member.workLogPath)}
                  disabled={!onOpenMemoryFile}
                >
                  기억 열기
                </button>
                <em>
                  {member.workCount ? `${member.workCount}개 작업 기록` : "대기 중"}
                  {member.learnedWorkCount || member.recentDecisionCount
                    ? ` · 학습 ${member.learnedWorkCount ?? 0} · 결정 ${member.recentDecisionCount ?? 0}`
                    : ""}
                </em>
              </footer>
            </article>
          ))}
        </div>
      </section>
        </div>
      </details>

      {hiddenMemorySearchFinalAction && hiddenMemorySearchFinalActionGuide ? (
        <section
          className={styles.memorySearchFinalActionSource}
          data-state={hiddenMemorySearchFinalActionGuide.state}
          aria-label={`${hiddenMemorySearchFinalAction.title} 지난 업무 출처와 승인 경계`}
          data-hidden-final-action-memory-proof="visible_summary_before_detail_fold"
        >
          <span>지난 업무 근거</span>
          <div>
            <strong>{hiddenMemorySearchFinalActionGuide.resultKind}</strong>
            <small>{hiddenMemorySearchFinalActionGuide.safetyLabel}</small>
          </div>
          <dl>
            <div>
              <dt>출처</dt>
              <dd>{hiddenMemorySearchFinalActionGuide.sourcePath}</dd>
            </div>
            <div>
              <dt>초안 미리보기</dt>
              <dd>{hiddenMemorySearchFinalActionGuide.draftPreview}</dd>
            </div>
            <div>
              <dt>다음 선택</dt>
              <dd>{hiddenMemorySearchFinalActionGuide.nextUserChoice}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {detachedApprovalActionReadinessCard ? (
        <section
          className={styles.approvalReadinessDetailsBody}
          data-approval-card-contract="risk_preview_decision_log_rollback"
          data-approval-risk-label={detachedApprovalActionReadinessCard.riskLabel}
          data-approval-decision-options="approve_cancel_change_hold"
          data-execution-log-policy="audit_or_decision_receipt"
          data-rollback-policy="guide_before_or_after_execution"
          data-next-user-choice={detachedApprovalActionReadinessCard.nextUserChoice}
          data-visible-next-choice={visibleOfficeNextChoice(detachedApprovalActionReadinessCard.nextUserChoice)}
          data-mobile-approval-check-proof="visible_summary_before_detail_fold"
        >
          <div className={styles.approvalReadinessGuide} data-state={detachedApprovalActionReadinessCard.readinessGuide.state}>
            <span>{detachedApprovalActionReadinessCard.riskLabel}</span>
            <div>
              <strong>{detachedApprovalActionReadinessCard.title}</strong>
              <small>{detachedApprovalActionReadinessCard.sourceLabel}</small>
            </div>
            <em>{detachedApprovalActionReadinessCard.readinessGuide.nextAction}</em>
          </div>
          <ol
            className={styles.approvalCommonCheckRail}
            aria-label={`${detachedApprovalActionReadinessCard.title} 공통 승인 체크`}
          >
            {detachedApprovalActionReadinessCard.commonChecks.map((check) => (
              <li key={`${detachedApprovalActionReadinessCard.id}-detached-common-${check.id}`} data-state={check.state}>
                <span>{check.label}</span>
                <strong>{check.title}</strong>
                <small>{check.detail}</small>
              </li>
            ))}
          </ol>
          {detachedApprovalActionReadinessCard.computerUseChecks.length ? (
            <dl
              className={styles.computerUseOfficeApprovalContract}
              aria-label={`${detachedApprovalActionReadinessCard.title} 내 PC 작업 승인 한눈에 보기`}
              data-computer-use-office-contract="risk_preview_decision_log_rollback"
            >
              {detachedApprovalActionReadinessCard.computerUseChecks.map((check) => (
                <div key={`${detachedApprovalActionReadinessCard.id}-detached-computer-use-${check.id}`} data-state={check.state}>
                  <dt>{check.label}</dt>
                  <dd>
                    <strong>{check.title}</strong>
                    <small>{check.detail}</small>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <ol
            className={styles.approvalDecisionPath}
            aria-label={`${detachedApprovalActionReadinessCard.title} 승인 결정 순서`}
          >
            {detachedApprovalActionReadinessCard.decisionSteps.map((step) => (
              <li key={`${detachedApprovalActionReadinessCard.id}-detached-decision-${step.id}`} data-state={step.state}>
                <span>{step.label}</span>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </li>
            ))}
          </ol>
          {detachedFinalActionAuditReceipts.length ? (
            <dl
              className={styles.finalActionAuditReceipt}
              aria-label={`${detachedApprovalActionReadinessCard.title} 실행 결과와 되돌리기 기준`}
            >
              {detachedFinalActionAuditReceipts.map((receipt) => (
                <div key={`${detachedApprovalActionReadinessCard.id}-detached-receipt-${receipt.id}`} data-state={receipt.state}>
                  <dt>{receipt.label}</dt>
                  <dd>
                    <strong>{receipt.title}</strong>
                    <small>{receipt.detail}</small>
                    <code>{officeMemoryReferenceLabel(receipt.recordPath)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {detachedBrowserTaskResultReceipts.length ? (
            <dl
              className={styles.browserTaskResultReceipt}
              aria-label={`${detachedApprovalActionReadinessCard.title} 내 PC 작업 결과와 되돌리기 기준`}
            >
              {detachedBrowserTaskResultReceipts.map((receipt) => (
                <div key={`${detachedApprovalActionReadinessCard.id}-detached-browser-receipt-${receipt.id}`} data-state={receipt.state}>
                  <dt>{receipt.label}</dt>
                  <dd>
                    <strong>{receipt.title}</strong>
                    <small>{receipt.detail}</small>
                    <code>{officeMemoryReferenceLabel(receipt.recordPath)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div
            className={styles.finalActionDecisionActions}
            aria-label={`${detachedApprovalActionReadinessCard.title} 고쳐달라고 하기 또는 보류하기`}
          >
            <div
              className={styles.finalActionDecisionLead}
              data-final-decision-flow="run_change_hold_worklog_next_pattern"
              data-user-decision-labels="run_change_hold_remember"
            >
              <strong>{officeDecisionActionLabels}</strong>
              <small>
                고쳐달라고 하기와 보류하기는 외부 실행 없이 업무 기록으로 남깁니다. 실행하기는 연결과 실행 전 검토 뒤 마지막 확인으로 이어집니다.
              </small>
            </div>
          </div>
        </section>
      ) : null}

      <details
        className={styles.officeDetailFold}
        aria-label="업무 오피스 상세 관제"
        open={shouldOpenOfficeDetailFold ? true : undefined}
        data-office-detail-fold="memory_tools_approval_on_demand"
        data-office-detail-fold-default="closed"
        data-office-detail-body="hidden_until_user_opens"
        data-office-detail-alert-count={approvalWaitCount}
        data-office-detail-growth-count={growthSuggestions.length}
        data-office-detail-memory-count={readyIdentityCount}
      >
        <summary>
          <div>
            <span>{activeOfficeBoardView === "archive" ? "보관 폴더" : "상세 관제"}</span>
            <small>
              기억 {readyIdentityCount}/{identityFiles.length || 0} · 도구 추천 {growthSuggestions.length} · 승인 {approvalWaitCount}
            </small>
          </div>
          <ol className={styles.officeDetailSummaryMeta} aria-label="상세 관제 우선순위">
            <li data-state={approvalWaitCount > 0 ? "approval" : "idle"} data-mail-card-urgent-count={urgentFinalActionCount}>
              <b>{approvalWaitCount}</b>
              <span>{urgentFinalActionCount > 0 ? `승인 · 급함 ${urgentFinalActionCount}` : "승인"}</span>
            </li>
            <li data-state={growthSuggestions.length ? "growth" : "idle"}>
              <b>{growthSuggestions.length}</b>
              <span>도구 추천</span>
            </li>
            <li data-state={readyIdentityCount === identityFiles.length && identityFiles.length > 0 ? "ready" : "idle"}>
              <b>{readyIdentityCount}/{identityFiles.length || 0}</b>
              <span>기억</span>
            </li>
          </ol>
        </summary>
        <div className={styles.officeDetailGrid} data-office-detail-grid="hidden_until_user_opens">
          <details
            className={styles.officeMemoryArchive}
            data-office-memory-archive-disclosure="archive_summary_then_folder_details"
            data-office-memory-archive-default="closed"
          >
            <summary>
              <span>기억과 도구 추천 기록</span>
              <strong>이어쓰기, 도구 추천, 결과 기록은 필요할 때만 펼칩니다</strong>
              <small>
                기억 {readyIdentityCount}/{identityFiles.length || 0} · 도구 추천 {growthSuggestions.length} · 결과 {delegationArtifacts.length}
              </small>
            </summary>
            <div className={styles.officeMemoryArchiveBody} data-office-memory-archive-body="folders_hidden_until_open">
      <details
        className={styles.officeArchiveFolderFold}
        aria-label="보관 기억 폴더"
        data-office-archive-folder="identity"
        data-office-archive-folder-default="closed"
        data-office-archive-folder-disclosure="summary_then_panel"
      >
        <summary>
          <span>기억</span>
          <strong>
            {identityFiles.length
              ? `${readyIdentityCount}/${identityFiles.length}개 준비`
              : "기억 파일 대기"}
          </strong>
          <small>업무 방식과 답변 기준</small>
        </summary>
      <section className={styles.identityPanel} aria-label="업무 기억 복원">
        <header>
          <div>
            <span>업무 기억</span>
            <strong>
              {identityFiles.length
                ? `${identityFiles.filter((file) => file.state === "ready").length}/${identityFiles.length}개 기억 항목`
                : "기억 파일 진단 대기"}
            </strong>
          </div>
          <small>이 폴더를 새 PC에서 선택하면 AI 팀원, 업무 도구, 답변 기준을 이어받습니다</small>
        </header>
        {identityFiles.length ? (
          <ol>
            {identityFiles.slice(0, 5).map((file) => (
              <li key={`${file.kind}:${file.relativePath}`} data-state={file.state}>
                <span>{file.state === "ready" ? "준비" : "생성전"}</span>
                <div>
                  <strong>{officeIdentityFileDisplayLabel(file)}</strong>
                  <small>{officeIdentityFileDetailLabel(file)}</small>
                  {file.detail ? <p>{file.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>앱 프로필을 저장하면 업무 방식, 팀원별 기억, 업무 도구 목록, 답변 기준이 새 PC 이어쓰기 묶음으로 만들어집니다.</p>
        )}
      </section>
      </details>

      <details
        className={styles.officeArchiveFolderFold}
        aria-label="보관 업무 도구 추천 폴더"
        data-office-archive-folder="growth"
        data-office-archive-folder-default="closed"
        data-office-archive-folder-disclosure="summary_then_panel"
      >
        <summary>
          <span>도구 추천</span>
          <strong>{growthSuggestions.length ? `${growthSuggestions.length}개 추천` : "학습 대기"}</strong>
          <small>반복 업무에서 찾은 후보</small>
        </summary>
      <section className={styles.growthPanel} aria-label="업무 도구 추천">
        <header>
          <div>
            <span>업무 도구 추천</span>
            <strong>
              {growthSuggestions.length
                ? `${growthSuggestions.length}개 도구 제안`
                : "업무 패턴 학습 대기"}
            </strong>
          </div>
          <small>저장한 업무 방식에서 반복 신호를 찾으면 담당 팀원과 업무 도구 후보로 정리합니다</small>
        </header>
        {growthSuggestions.length ? (
          <ol>
            {growthSuggestions.slice(0, 4).map((suggestion) => (
              <li key={suggestion.id} data-priority={suggestion.priority}>
                <span>{suggestion.priority === "high" ? "우선" : "추천"}</span>
                <div>
                  <strong>{suggestion.title}</strong>
                  <small>{suggestion.skillLabel} · {officeSkillSourceKindLabel(suggestion.kind)}</small>
                  <p>{suggestion.nextAction}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>메일 점검, 자료 분석, 폴더 정리 결과가 쌓이면 이곳에 “다음에 켤 업무 도구”와 “담당 AI 팀원”이 표시됩니다.</p>
        )}
      </section>
      </details>

      <details
        className={styles.officeArchiveFolderFold}
        aria-label="보관 이어쓰기 목록 폴더"
        data-office-archive-folder="skill-source"
        data-office-archive-folder-default="closed"
        data-office-archive-folder-disclosure="summary_then_panel"
      >
        <summary>
          <span>이어쓰기</span>
          <strong>
            {skillSources.length
              ? `${activeSkillSourceCount}/${skillSources.length}개 도구`
              : "목록 대기"}
          </strong>
          <small>새 PC에서 다시 붙일 도구</small>
        </summary>
      <section className={styles.skillSourcePanel} aria-label="새 PC 이어쓰기 목록">
        <header>
          <div>
            <span>이어쓰기 목록</span>
            <strong>
              {skillSources.length
                ? `${activeSkillSourceCount}/${skillSources.length}개 업무 도구`
                : "새 PC 이어쓰기 목록 대기"}
            </strong>
          </div>
          <small>새 PC에서는 이 목록을 읽어 앱 기본 도구와 외부 연결 후보를 다시 붙입니다</small>
        </header>
        {skillSources.length ? (
          <ol>
            {skillSources.slice(0, 5).map((source) => (
              <li key={source.id} data-status={source.status}>
                <span>{source.status === "active" ? "활성" : "후보"}</span>
                <div>
                  <strong>{source.label}</strong>
                  <small>{officeSkillRestoreModeLabel(source.restoreMode)} · {officeSkillSourceKindLabel(source.sourceKind)}</small>
                  <p>{source.safetyBoundary}</p>
                  <div className={styles.skillSourceChips}>
                    {(source.connectorIds ?? []).slice(0, 3).map((connectorId) => (
                      <em key={`${source.id}-connector-${connectorId}`}>{officeConnectorIdLabel(connectorId)}</em>
                    ))}
                    {(source.externalToolHints ?? []).slice(0, 3).map((hint) => (
                      <em key={`${source.id}-hint-${hint}`}>{officeExternalToolHintLabel(hint)}</em>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>앱 프로필이 저장되면 업무 도구 목록과 이어쓰기 후보가 만들어지고, 메일·문서·코딩·내 PC 작업 도우미 같은 도구 후보가 이 목록으로 정리됩니다.</p>
        )}
        <footer>
          <span>외부 재승인 후보 {externalSkillSourceCount}개</span>
          <small>새 PC 이어쓰기 목록</small>
        </footer>
      </section>
      </details>

      <details
        className={styles.officeArchiveFolderFold}
        aria-label="보관 결과 기록 폴더"
        data-office-archive-folder="artifacts"
        data-office-archive-folder-default="closed"
        data-office-archive-folder-disclosure="summary_then_panel"
      >
        <summary>
          <span>결과 기록</span>
          <strong>{delegationArtifacts.length ? `${delegationArtifacts.length}개 기록` : "기록 대기"}</strong>
          <small>보고서·메일·승인 요청</small>
        </summary>
      <section className={styles.artifactPanel} aria-label="AI 팀원 결과 기록">
        <header>
          <div>
            <span>AI 팀원 결과</span>
            <strong>
              {delegationArtifacts.length
                ? `${delegationArtifacts.length}개 로컬 결과 기록`
                : "취합 결과 기록 대기"}
            </strong>
          </div>
          <small>AI 팀원 결과를 보고서, 메일, 승인 요청으로 저장하고 여기서 바로 확인합니다</small>
        </header>
        {delegationArtifacts.length ? (
          <ol>
            {delegationArtifacts.slice(0, 5).map((artifact) => (
              <li key={artifact.id} data-kind={artifact.artifactKind}>
                <span>{artifactKindLabel(artifact.artifactKind)}</span>
                <div>
                  <strong>{artifact.title}</strong>
                  <small>
                    {officeMemoryReferenceLabel(artifact.relativePath)} · {artifact.rows?.length ?? 0}명 팀원
                    {artifact.artifactKind === "approval" ? " · 앱의 마지막 확인 필요" : ""}
                  </small>
                  {artifactQueueLabel(artifact) || artifactOutputKind(artifact) ? (
                    <div className={styles.queueMetaRow}>
                      {artifactQueueLabel(artifact) ? <span>{artifactQueueLabel(artifact)}</span> : null}
                      {artifactOutputKind(artifact) ? <span>{outputKindLabel(artifactOutputKind(artifact))}</span> : null}
                      {artifactApprovalRequired(artifact) ? <span data-tone="approval">승인 경계</span> : null}
                    </div>
                  ) : null}
                  {artifact.requestText ? <p>{artifact.requestText}</p> : null}
                  {artifact.approvalDecision ? (
                    <em>
                      {approvalDecisionLabel(artifact.approvalDecision)} · {artifact.approvalStatus || "recorded"}
                    </em>
                  ) : null}
                  {artifact.nextActionKind ? (
                    <em>
                      {delegationNextActionLabel(artifact.nextActionKind)} · {artifact.nextActionLabel || artifact.nextActionStatus}
                    </em>
                  ) : null}
                  {artifact.artifactKind === "approval" ? (
                    <DelegationDecisionOutcomeRail artifact={artifact} label={artifact.title} />
                  ) : null}
                </div>
                <div className={styles.artifactActions}>
                  <button
                    type="button"
                    onClick={() => onOpenDelegationArtifact?.(artifact)}
                    disabled={!onOpenDelegationArtifact}
                  >
                    결과 기록 열기
                  </button>
                  {artifact.artifactKind === "approval" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onRecordDelegationDecision?.(artifact, "approved")}
                        disabled={!onRecordDelegationDecision}
                      >
                        실행하기
                      </button>
                      <button
                        type="button"
                        onClick={() => onRecordDelegationDecision?.(artifact, "change_requested")}
                        disabled={!onRecordDelegationDecision}
                      >
                        고쳐달라고 하기
                      </button>
                      <button
                        type="button"
                        onClick={() => onRecordDelegationDecision?.(artifact, "held")}
                        disabled={!onRecordDelegationDecision}
                      >
                        보류하기
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>메인 컨트롤에서 AI 팀원에게 분배한 뒤 “보고서 초안”, “메일 초안”, “승인 요청”을 누르면 로컬 기억 폴더에 결과 기록이 생깁니다.</p>
        )}
        <footer>
          <span>승인 후보 {approvalArtifactCount}개</span>
          <small>AI 팀원 결과 기록</small>
        </footer>
      </section>
      </details>
            </div>
          </details>

      <section
        className={styles.learnedDraftApprovalPanel}
        aria-label="학습 초안 오피스 승인함"
        data-learned-draft-approval-count={learnedDraftApprovalItems.length}
        data-learned-draft-action-message={
          folderPlanActionMessage || localFilePatternMessage || localFileActionMessage ? "true" : "false"
        }
      >
        <header>
          <div>
            <span>학습 초안 오피스 승인함</span>
            <strong>
              {learnedDraftApprovalItems.length
                ? `${learnedDraftApprovalItems.length}개 학습 초안 승인 대기`
                : "학습 초안 승인 대기 없음"}
            </strong>
          </div>
          <small>자료 탭에서 만든 보고서·메일·일정 초안만 분리해서 실행하기, 고쳐달라고 하기, 보류하기로 고릅니다</small>
        </header>
        <section
          className={styles.documentOfficeTopWorkBar}
          aria-label="문서 자동화 첫 업무 바"
          data-document-office-top-work-bar="source_draft_approval_save_share_lock_first"
          data-document-office-top-work-visible="source_choice_draft_candidates_approval_queue_save_share_lock"
          data-document-office-top-work-hidden="templates_settings_diagnostics_execution_logs_until_details"
          data-document-office-top-work-source="learnedDraftApprovalItems_and_focusedLearnedDraftItem"
          data-document-office-top-work-final-boundary="approval_before_save_share_submit"
          data-document-office-top-work-external-mutation="false"
        >
          <article data-step="source_choice" data-state={learnedDraftApprovalItems.length ? "ready" : "idle"}>
            <span>자료 선택</span>
            <strong>{learnedDraftApprovalItems.length ? `${learnedDraftApprovalItems.length}개 자료 확인` : "자료 대기"}</strong>
            <small>폴더·파일 기준</small>
          </article>
          <article data-step="draft_candidates" data-state={learnedDraftApprovalItems.length ? "approval" : "locked"}>
            <span>초안 후보</span>
            <strong>{focusedLearnedDraftItem?.title ?? (learnedDraftApprovalItems.length ? "승인 대기" : "후보 없음")}</strong>
            <small>보고서·메일·일정</small>
          </article>
          <article data-step="approval_queue" data-state={learnedDraftApprovalItems.length ? "approval" : "locked"}>
            <span>승인함</span>
            <strong>실행·수정·보류</strong>
            <small>사용자 결정</small>
          </article>
          <article data-step="save_share_lock" data-state="locked">
            <span>잠금</span>
            <strong>저장·공유·제출 잠금</strong>
            <small>최종 확인 전 실행 없음</small>
          </article>
        </section>

        {focusedLearnedDraftItem ? (
          <div
            className={styles.learnedDraftFocusNotice}
            data-state="approval"
            data-focused-learned-draft-id={focusedLearnedDraftItem.id}
            data-focused-learned-draft-kind={isMailAutomationNotificationItem(focusedLearnedDraftItem) ? "mail_automation_notification" : "learned_draft"}
            data-mail-automation-notification-focus={
              isMailAutomationNotificationItem(focusedLearnedDraftItem) ? "recent_polling_to_approval_queue" : undefined
            }
          >
            <span>{isMailAutomationNotificationItem(focusedLearnedDraftItem) ? "최근 자동 점검" : "방금 만든 초안"}</span>
            <div>
              <strong>{focusedLearnedDraftItem.title}</strong>
              <small>
                {isMailAutomationNotificationItem(focusedLearnedDraftItem)
                  ? "최근 점검 카드에서 넘어온 승인 후보입니다. 알림 전송과 실제 메일/일정/파일 실행은 여기서 다시 확인합니다."
                  : learnedDraftFocusContext?.draftCount
                  ? `${learnedDraftFocusContext.draftCount}개 초안 후보 중 먼저 확인할 카드입니다.`
                  : "문서 학습 결과에서 바로 넘어온 승인 카드입니다."}
              </small>
            </div>
            <em>{learnedDraftFocusContext?.nextUserChoice || "실행하기, 고쳐달라고 하기, 보류하기 중 선택"}</em>
          </div>
        ) : null}

        <section
          className={styles.approvalWorkerResultRail}
          aria-label="문서 담당 직원 승인함 결과"
          data-document-worker-approval-result="document_read_draft_to_approval_final_lock"
          data-learned-draft-worker-result="local_file_draft_to_approval_log"
          data-worker-result-final-boundary="approval_before_external_mutation"
          data-document-worker-result-total={learnedDraftApprovalItems.length}
          data-document-worker-result-external-mutation="false"
        >
          <header>
            <span>직원 결과물</span>
            <strong>문서 담당자가 승인함에 올린 일</strong>
            <small>자료 확인 → 초안 후보 → 승인함 → 실행 로그</small>
          </header>
          <ol>
            <li data-state={learnedDraftApprovalItems.length ? "ready" : "locked"}>
              <span>자료 확인</span>
              <strong>{learnedDraftApprovalItems.length ? `${learnedDraftApprovalItems.length}건` : "대기"}</strong>
              <small>파일, 폴더, 메일 첨부를 읽기 전용으로 확인합니다.</small>
            </li>
            <li data-state={learnedDraftApprovalItems.length ? "approval" : "locked"}>
              <span>초안 후보</span>
              <strong>승인함 분리</strong>
              <small>보고서, 메일, 일정, 정리 후보는 카드에서만 선택합니다.</small>
            </li>
            <li data-state="locked">
              <span>원본 잠금</span>
              <strong>변경 0건</strong>
              <small>저장, 이동, 삭제, 외부 공유는 사용자 확인 전 실행하지 않습니다.</small>
            </li>
          </ol>
        </section>

        {learnedDraftApprovalItems.length ? (
          <ol>
            {learnedDraftApprovalItems.map((item) => (
              <li
                key={item.id}
                data-kind={item.draft?.operationKind ?? "stage_approval"}
                data-learned-draft-id={item.id}
                data-focused={item.id === focusedLearnedDraftWorkItemId ? "true" : "false"}
                tabIndex={item.id === focusedLearnedDraftWorkItemId ? -1 : undefined}
              >
                <span>{learnedDraftApprovalLabel(item)}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {[
                      item.sourceLabel || "자료 학습",
                      item.localFile?.name,
                      item.draft?.requiresApprovalBeforeSend ? "승인 후 실행" : "초안 검토",
                    ].filter(Boolean).join(" · ")}
                  </small>
                  <p>{item.sourceEvidence?.draftPreview || item.localFile?.preview || item.summary}</p>
                  <div className={styles.learnedDraftMeta}>
                    <em>위험도 · {riskLabelText(item.riskLabel)}</em>
                    <em>외부 실행 잠금</em>
                  </div>
                  {isMailAutomationNotificationItem(item) ? (
                    <>
                      <section
                        className={styles.mailAutomationNotificationGuide}
                        aria-label={`${item.title} 메일 자동 점검 알림 경계`}
                        data-mail-automation-notification-card="app_inbox_draft_to_connected_channel_digest"
                        data-mail-automation-notification-contract={
                          mailAutomationNotificationEvidence(item)?.contract || "mail_polling_to_app_approval_notification_draft"
                        }
                        data-mail-automation-notification-dispatch-policy={
                          mailAutomationNotificationEvidence(item)?.dispatchPolicy || "app_inbox_draft_only_external_notification_requires_user_channel_setup"
                        }
                        data-mail-automation-notification-final-lock="mail_send_calendar_attachment_locked_until_app_final_confirmation"
                      >
                        <span>자동 점검</span>
                        <div>
                          <strong>{mailAutomationNotificationSummary(item)}</strong>
                          <small>
                            {mailAutomationNotificationEvidence(item)?.channelSummary || "앱 승인함"}으로 먼저 멈추고,
                            연결된 알림 채널은 사용자가 누를 때만 승인 후보 요약을 보냅니다.
                          </small>
                          {mailAutomationNotificationDigestItems(item).length ? (
                            <ul
                              className={styles.mailAutomationNotificationDigest}
                              aria-label={`${item.title} 메일 자동 점검 분류 요약`}
                              data-mail-automation-notification-triage-digest="ignored_important_approval_counts"
                            >
                              {mailAutomationNotificationDigestItems(item).map((label, index) => (
                                <li key={`${label}-${index}`}>{label}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <em>최종 확인 전 실행 없음</em>
                      </section>
                      <ol
                        className={styles.mailAutomationNotificationWorkflow}
                        aria-label={`${item.title} 메일 자동 점검 처리 흐름`}
                        data-mail-automation-notification-workflow="learning_filtering_approval_notification_final_confirmation"
                        data-mail-automation-notification-learning-policy={
                          mailAutomationNotificationEvidence(item)?.learningRuleSafePersistPolicy || "safe_labels_only_user_approved"
                        }
                        data-mail-automation-notification-final-lock="send_calendar_attachment_locked_until_app_final_confirmation"
                      >
                      {mailAutomationNotificationWorkflowItems(item, mailAutomationChannelState.externalState).map((step) => (
                        <li key={`${item.id}-mail-automation-workflow-${step.id}`} data-state={step.state}>
                          <span>{step.label}</span>
                          <strong>{step.title}</strong>
                          <small>{step.detail}</small>
                        </li>
                      ))}
                    </ol>
                    {mailAutomationNotificationCalendarHandoffItems(item).length ? (
                      <dl
                        className={styles.mailAutomationNotificationCalendarHandoff}
                        aria-label={`${item.title} 일정 후보 승인 연결`}
                        data-mail-automation-notification-calendar-handoff="meeting_mail_to_freebusy_calendar_candidate_final_approval"
                        data-mail-automation-notification-calendar-write-lock="calendar_create_invite_locked_until_final_confirmation"
                        data-mail-automation-notification-calendar-proof="freebusy_then_candidate_then_approval"
                      >
                        {mailAutomationNotificationCalendarHandoffItems(item).map((step) => (
                          <div key={`${item.id}-mail-automation-calendar-${step.id}`} data-state={step.state}>
                            <dt>{step.title}</dt>
                            <dd>{step.detail}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {mailAutomationNotificationAttachmentHandoffItems(item).length ? (
                      <dl
                        className={styles.mailAutomationNotificationAttachmentHandoff}
                        aria-label={`${item.title} 첨부 정리 승인 연결`}
                        data-mail-automation-notification-attachment-handoff="attachment_candidate_to_local_copy_folder_plan_approval"
                        data-mail-automation-notification-attachment-original-policy="mail_original_unchanged"
                        data-mail-automation-notification-attachment-final-lock="move_delete_share_locked_until_folder_plan_final_confirmation"
                      >
                        {mailAutomationNotificationAttachmentHandoffItems(item).map((step) => (
                          <div key={`${item.id}-mail-automation-attachment-${step.id}`} data-state={step.state}>
                            <dt>{step.title}</dt>
                            <dd>{step.detail}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </>
                ) : null}
                  {isMailAutomationNotificationItem(item) ? (
                    <>
                      <dl
                        className={styles.mailAutomationNotificationChannelState}
                        aria-label={`${item.title} 알림 연결 상태`}
                        data-mail-automation-notification-channel-state={mailAutomationChannelState.externalState}
                        data-mail-automation-notification-default-route="app_inbox_first"
                        data-mail-automation-notification-external-send="user_initiated_only"
                        data-mail-automation-notification-final-confirmation-lock="true"
                      >
                        <div data-state="app_inbox">
                          <dt>앱 승인함 기본</dt>
                          <dd>{mailAutomationChannelState.routeDetail}</dd>
                        </div>
                        <div data-state={mailAutomationChannelState.externalState}>
                          <dt>{mailAutomationChannelState.externalLabel}</dt>
                          <dd>{mailAutomationChannelState.externalDetail}</dd>
                        </div>
                        <div data-state="locked">
                          <dt>사용자 클릭만 발송</dt>
                          <dd>외부 알림은 승인 후보 요약이며 메일 발송, 일정 등록, 첨부 이동을 대신하지 않습니다.</dd>
                        </div>
                      </dl>
                      <ol
                        className={styles.mailAutomationNotificationDecisionPath}
                        aria-label={`${item.title} 메일 자동 점검 결정 경로`}
                        data-mail-automation-notification-decision-path="app_inbox_notification_reply_final_confirmation"
                        data-mail-automation-notification-reply-target-lock="same_a_code_same_work_item"
                        data-mail-automation-notification-ui-mode="compact_three_step_rail"
                      >
                        {mailAutomationNotificationDecisionPathItems(item, mailAutomationChannelState.externalState).map((step) => (
                          <li key={`${item.id}-mail-automation-decision-path-${step.id}`} data-state={step.state}>
                            <span>{step.label}</span>
                            <strong>{step.title}</strong>
                            <small>{step.detail}</small>
                          </li>
                        ))}
                      </ol>
                      <div
                        className={styles.mailAutomationNotificationActions}
                        data-mail-automation-notification-actions="connect_or_user_initiated_send"
                        data-mail-automation-notification-send-ready={mailAutomationChannelState.externalState === "connected" ? "true" : "false"}
                      >
                        {mailAutomationChannelState.externalState === "connected" ? (
                          <button
                            type="button"
                            onClick={() => void onSendMailAutomationNotification?.(item)}
                            disabled={!onSendMailAutomationNotification || sendingMailAutomationNotificationId === item.id}
                            data-mail-automation-notification-send-action="user_initiated_bridge_dispatch"
                            data-user-initiated-dispatch="true"
                          >
                            {sendingMailAutomationNotificationId === item.id ? "보내는 중" : "알림 보내기"}
                          </button>
                        ) : null}
                        {mailAutomationChannelState.externalState === "connected" ? (
                          <button
                            type="button"
                            onClick={() => void onApplyMailAutomationNotificationDecision?.(item)}
                            disabled={
                              !onApplyMailAutomationNotificationDecision ||
                              applyingMailAutomationNotificationDecisionId === item.id
                            }
                            data-mail-automation-notification-reply-action="poll_channel_reply_to_same_approval_candidate"
                            data-mail-automation-notification-reply-contract="phone_reply_code_to_same_notification_target_then_app_final_confirmation"
                            data-external-mutation="false"
                          >
                            {applyingMailAutomationNotificationDecisionId === item.id ? "확인 중" : "답장 확인"}
                          </button>
                        ) : null}
                        <a
                          className={styles.mailAutomationNotificationConnectLink}
                          href={mailAutomationNotificationConnectHref(item)}
                          data-mail-automation-notification-connect-action="open_messenger_channel_setup"
                          data-mail-automation-notification-return-to="office_approval_queue"
                        >
                          {mailAutomationChannelState.externalState === "connected" ? "알림 설정" : "알림 연결하기"}
                        </a>
                      </div>
                      {mailAutomationNotificationMessage ? (
                        <small
                          className={styles.mailAutomationNotificationSendState}
                          data-mail-automation-notification-send-state="latest_result"
                        >
                          {mailAutomationNotificationMessage}
                        </small>
                      ) : null}
                      {mailAutomationNotificationDispatchReceipt ? (
                        <dl
                          className={styles.mailAutomationNotificationDispatchLog}
                          aria-label={`${item.title} 알림 전송 실행 로그`}
                          data-mail-automation-notification-dispatch-log="user_click_result_no_mail_calendar_file_execution"
                          data-mail-automation-notification-dispatch-status={mailAutomationNotificationDispatchReceipt.status}
                          data-mail-automation-notification-dispatch-target-count={mailAutomationNotificationDispatchReceipt.targetCount}
                          data-mail-automation-notification-dispatch-target-ids={mailAutomationNotificationDispatchReceipt.targetIds.join(",")}
                        >
                          <div data-state="sent">
                            <dt>전송 상태</dt>
                            <dd>{mailAutomationNotificationDispatchReceipt.status}</dd>
                          </div>
                          <div data-state="targets">
                            <dt>대상</dt>
                            <dd>{mailAutomationNotificationDispatchReceipt.targetCount}건</dd>
                          </div>
                          <div data-state="locked">
                            <dt>실행</dt>
                            <dd>{mailAutomationNotificationDispatchReceipt.executionSummary}</dd>
                          </div>
                          <div data-state="receipt">
                            <dt>메시지 기록</dt>
                            <dd>{mailAutomationNotificationDispatchReceipt.providerMessageId}</dd>
                          </div>
                        </dl>
                      ) : null}
                    </>
                  ) : null}
                  {item.source === "local_file" ? (
                    <>
                      <ol className={styles.localFileApprovalSteps} aria-label={`${item.title} 파일 작업 다음 단계`}>
                        <li data-state={item.localFile?.extractedTextStatus === "ready" ? "done" : "active"}>
                          <span>1</span>
                          <div>
                            <strong>{isFolderPlanApprovalItem(item) ? "실행 전 검토" : "분석하기"}</strong>
                            <small>
                              {isFolderPlanApprovalItem(item)
                                ? "원본 변경 없이 제외, 충돌, 이동 후보를 먼저 확인합니다."
                                : "선택한 파일만 읽고 확인 항목을 만듭니다."}
                            </small>
                          </div>
                        </li>
                        <li data-state="approval">
                          <span>2</span>
                          <div>
                            <strong>{isFolderPlanApprovalItem(item) ? "실행하기" : "초안 만들기"}</strong>
                            <small>
                              {isFolderPlanApprovalItem(item)
                                ? "정리 적용 승인 확인 문구를 거친 뒤에만 정리 후보를 실행합니다."
                                : "보고서/답장/표 초안을 만들고 실행은 계속 잠급니다."}
                            </small>
                          </div>
                        </li>
                        <li data-state="locked">
                          <span>3</span>
                          <div>
                            <strong>{isFolderPlanApprovalItem(item) ? "보류하기 · 되돌리기 안내" : "변경 잠금"}</strong>
                            <small>
                              {isFolderPlanApprovalItem(item)
                                ? "보류하면 원본 변경 없음. 적용 기록이 있을 때만 승인 후 되돌립니다."
                                : "파일 저장, 이동, 삭제는 이 카드에서 실행하지 않습니다."}
                            </small>
                          </div>
                        </li>
                      </ol>
                      <dl
                        className={styles.localFileAfterActionRail}
                        aria-label={`${item.title} 파일 작업 후 확인 위치`}
                        data-local-file-after-action-contract="action_receipt_log_rollback_next_choice"
                        data-execution-log-policy="local_file_action_receipt"
                        data-rollback-policy="original_file_unchanged_or_audit_revert"
                        data-next-choice-policy="select_file_review_office_queue"
                      >
                        <div data-state="log">
                          <dt>실행 로그</dt>
                          <dd>분석, 초안, 보류, 저장 결과를 이 카드와 업무 기록에 남깁니다.</dd>
                        </div>
                        <div data-state="rollback">
                          <dt>되돌리기 기준</dt>
                          <dd>원본 파일은 바꾸지 않고, 저장·이동·삭제 후보는 앱의 마지막 확인 전까지 잠급니다.</dd>
                        </div>
                        <div data-state="next">
                          <dt>다음 선택</dt>
                          <dd>막히면 자료 선택하기, 승인함 보기, 작업 범위 고르기 중 하나로 이어갑니다.</dd>
                        </div>
                      </dl>
                      {isFolderPlanApprovalItem(item) ? (
                        <>
                          {isMailAttachmentFolderPlanItem(item) ? (
                            <section
                              className={styles.mailAttachmentFolderPlanGuide}
                              aria-label={`${item.title} 메일 첨부 정리 경계`}
                              data-mail-attachment-folder-plan="downloaded_attachment_to_folder_plan_approval"
                              data-mail-attachment-original-policy="mail_original_unchanged"
                              data-mail-attachment-external-share="false_before_final_confirmation"
                            >
                              <span>메일 첨부</span>
                              <div>
                                <strong>{mailAttachmentFolderPlanTitle(item)}</strong>
                                <small>내려받은 로컬 사본만 정리 후보로 올리고, 원본 메일/첨부 삭제와 외부 공유는 실행하지 않습니다.</small>
                              </div>
                              <em>정리 적용 승인 전까지 이동 없음</em>
                            </section>
                          ) : null}
                          <dl
                            className={styles.folderPlanDecisionRail}
                            aria-label={`${item.title} 폴더 정리 실행 고쳐달라고 하기 보류하기 결정`}
                            data-folder-plan-decision-contract="apply_cancel_revert_log"
                            data-user-decision-labels="run_change_hold"
                            data-folder-plan-apply-lock="requires_exact_apply_approval_phrase"
                            data-folder-plan-revert-lock="requires_exact_revert_approval_phrase"
                            data-folder-plan-manifest-policy="apply_manifest_before_revert"
                            data-folder-plan-original-policy="no_original_delete_or_overwrite_without_user_choice"
                          >
                            {folderPlanDecisionRailItems(item).map((step) => (
                              <div key={`${item.id}-folder-plan-${step.state}`} data-state={step.state}>
                                <dt>{step.title}</dt>
                                <dd>{step.detail}</dd>
                              </div>
                            ))}
                          </dl>
                          <div
                            className={styles.folderPlanControlPanel}
                            aria-label={`${item.title} 적용 전 제외와 충돌 선택`}
                            data-folder-plan-control-contract="collision_policy_exclusion_keywords_before_apply"
                            data-folder-plan-delete-policy="delete_not_productized"
                            data-folder-plan-overwrite-policy="overwrite_never_allowed"
                          >
                            <div>
                              <span>겹치면 어떻게 할까요?</span>
                              <div className={styles.folderPlanPolicyButtons} role="group" aria-label={`${item.title} 겹치는 파일 처리`}>
                                <button
                                  type="button"
                                  aria-pressed={(folderPlanOptionsByItemId[item.id]?.collisionPolicy ?? "rename") === "rename"}
                                  onClick={() => onChangeFolderPlanCollisionPolicy?.(item.id, "rename")}
                                >
                                  이름 바꾸기
                                </button>
                                <button
                                  type="button"
                                  aria-pressed={(folderPlanOptionsByItemId[item.id]?.collisionPolicy ?? "rename") === "skip"}
                                  onClick={() => onChangeFolderPlanCollisionPolicy?.(item.id, "skip")}
                                >
                                  건너뛰기
                                </button>
                              </div>
                            </div>
                            <label>
                              <span>정리에서 뺄 단어</span>
                              <input
                                type="text"
                                value={folderPlanOptionsByItemId[item.id]?.excludedPathKeywords ?? ""}
                                onChange={(event) => onChangeFolderPlanExcludedKeywords?.(item.id, event.currentTarget.value)}
                                placeholder="예: 임시, 다운로드중"
                              />
                              <small>
                                {folderPlanOptionsByItemId[item.id]?.sourceLabel
                                  ? `쉬운 세팅에서 고른 기준 · ${folderPlanOptionsByItemId[item.id]?.sourceLabel} · 쉼표로 나눠 쓰면 해당 단어가 들어간 파일은 적용에서 뺍니다.`
                                  : "쉼표로 나눠 쓰면 해당 단어가 들어간 파일은 적용에서 뺍니다."}
                              </small>
                            </label>
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <ol
                      className={styles.learnedDraftFinalGateSteps}
                      aria-label={`${item.title} 승인 후 최종 확인 경로`}
                      data-learned-draft-final-gate="approval_to_final_confirmation"
                    >
                      {learnedDraftFinalGateSteps(item).map((step) => (
                        <li key={`${item.id}-${step.label}`} data-state={step.state}>
                          <span>{step.label}</span>
                          <div>
                            <strong>{step.title}</strong>
                            <small>{step.detail}</small>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  <nav
                    className={styles.cardDecisionFollowupActions}
                    aria-label={`${item.title} 승인 카드 결정 후 바로 확인`}
                    data-card-decision-followup-actions="log_remember_next_choice"
                    data-card-decision-visible-priority="decision_done_log_first_remember_next"
                    data-decision-complete-label="결정 후 바로 볼 것"
                    data-card-decision-work-kind={learnedDraftApprovalLabel(item)}
                    data-card-decision-followup-path="decision_log_remember_next"
                    data-log-action="open_office"
                    data-save-action="today_check"
                    data-next-action="workers"
                    data-mobile-safe-width="390"
                  >
                    <span>{learnedDraftApprovalLabel(item)} · 결정 후 바로 볼 것</span>
                    <a href={officeHomeActionHref("open_office")} data-action="log">
                      실행 로그 확인
                    </a>
                    <a href={officeHomeActionHref("today_check")} data-action="remember">
                      다음부터 이렇게 저장 위치
                    </a>
                    <a href={officeHomeActionHref("workers")} data-action="next">
                      다음 작업 맡기기
                    </a>
                  </nav>
                </div>
                <div className={styles.learnedDraftActions}>
                  {item.source === "local_file" && isFolderPlanApprovalItem(item) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onRunFolderPlanAction?.(item, "preview")}
                        disabled={!onRunFolderPlanAction || runningFolderPlanActionId === `${item.id}:preview`}
                      >
                        {runningFolderPlanActionId === `${item.id}:preview` ? "검토 중" : "실행 전 검토"}
                      </button>
                      <button
                        type="button"
                        data-folder-plan-visible-action="run"
                        data-folder-plan-required-approval-phrase="정리 적용 승인"
                        onClick={() => onRunFolderPlanAction?.(item, "apply")}
                        disabled={!onRunFolderPlanAction || runningFolderPlanActionId === `${item.id}:apply`}
                      >
                        {runningFolderPlanActionId === `${item.id}:apply` ? "실행 중" : "실행하기"}
                      </button>
                      <button
                        type="button"
                        data-folder-plan-visible-action="change"
                        data-folder-plan-required-approval-phrase="정리 적용 승인 전 검토"
                        onClick={() => onRunFolderPlanAction?.(item, "preview")}
                        disabled={!onRunFolderPlanAction || runningFolderPlanActionId === `${item.id}:preview`}
                      >
                        {runningFolderPlanActionId === `${item.id}:preview` ? "다시 검토 중" : "고쳐달라고 하기"}
                      </button>
                      <button
                        type="button"
                        data-folder-plan-visible-action="revert"
                        data-folder-plan-required-approval-phrase="정리 되돌리기 승인"
                        onClick={() => onRunFolderPlanAction?.(item, "revert")}
                        disabled={!onRunFolderPlanAction || runningFolderPlanActionId === `${item.id}:revert`}
                      >
                        {runningFolderPlanActionId === `${item.id}:revert` ? "되돌리는 중" : "정리 되돌리기 승인"}
                      </button>
                      <button
                        type="button"
                        data-folder-plan-visible-action="hold"
                        onClick={() => onRunLocalFileAction?.(item, "hold")}
                        disabled={!onRunLocalFileAction || runningLocalFileActionId === `${item.id}:hold`}
                      >
                        {runningLocalFileActionId === `${item.id}:hold` ? "보류 중" : "보류하기"}
                      </button>
                    </>
                  ) : item.source === "local_file" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onRunLocalFileAction?.(item, "analyze")}
                        disabled={!onRunLocalFileAction || runningLocalFileActionId === `${item.id}:analyze`}
                      >
                        {runningLocalFileActionId === `${item.id}:analyze` ? "분석 중" : "분석하기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRunLocalFileAction?.(item, "draft")}
                        disabled={!onRunLocalFileAction || runningLocalFileActionId === `${item.id}:draft`}
                      >
                        {runningLocalFileActionId === `${item.id}:draft` ? "초안 중" : "초안 만들기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRunLocalFileAction?.(item, "hold")}
                        disabled={!onRunLocalFileAction || runningLocalFileActionId === `${item.id}:hold`}
                      >
                        {runningLocalFileActionId === `${item.id}:hold` ? "보류 중" : "보류하기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSaveLocalFilePattern?.(item)}
                        disabled={!onSaveLocalFilePattern || savingLocalFilePatternId === item.id}
                      >
                        {savingLocalFilePatternId === item.id ? "저장 중" : "다음부터 이렇게"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onRecordMailOpsDecision?.(item, "approved")}
                        disabled={!onRecordMailOpsDecision || recordingMailOpsDecisionId === item.id}
                      >
                        {recordingMailOpsDecisionId === item.id ? "저장 중" : "실행하기"}
                      </button>
                      <button
                        type="button"
                      onClick={() => onRecordMailOpsDecision?.(item, "change_requested")}
                      disabled={!onRecordMailOpsDecision || recordingMailOpsDecisionId === item.id}
                    >
                        고쳐달라고 하기
                      </button>
                      <button
                        type="button"
                      onClick={() => onRecordMailOpsDecision?.(item, "held")}
                      disabled={!onRecordMailOpsDecision || recordingMailOpsDecisionId === item.id}
                    >
                        보류하기
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>자료 탭에서 문서 형식을 학습해 만든 초안은 일반 설정이나 외부 계정 탭에 섞이지 않고 이 오피스 승인함으로 올라옵니다.</p>
        )}
        <footer>
          <span>{learnedDraftApprovalItems.length ? "오피스 승인함 연결됨" : "자료 학습 대기"}</span>
          <small>{folderPlanActionMessage || localFilePatternMessage || localFileActionMessage || "사용자 선택 전까지 메일 발송, 일정 등록, 외부 저장은 열리지 않습니다"}</small>
        </footer>
      </section>

      <section
        className={styles.approvedOutputPanel}
        aria-label="문서 작성 승인 결과"
        data-approved-output-count={approvedOutputItems.length}
        data-approved-output-first-screen="local_result_final_review_lock_then_file_details"
        data-approved-output-detail-default="file_paths_alternate_outputs_folded_until_needed"
        data-approved-output-final-boundary="share_submit_locked_until_final_confirmation"
      >
        <header>
          <div>
            <span>문서 결과</span>
            <strong>
              {approvedOutputItems.length
                ? `${approvedOutputItems.length}개 로컬 문서 결과`
                : "승인 문서 결과 대기"}
            </strong>
          </div>
          <small>학습 초안을 승인하면 Markdown과 Word 호환 문서 위치를 함께 보여줍니다</small>
        </header>

        {approvedOutputItems.length ? (
          <ol>
            {approvedOutputItems.map((item) => (
              <li key={`approved-output-${item.id}`} data-kind={item.approvedOutput?.kind ?? "approved_output"}>
                <span>{approvedOutputLabel(item)}</span>
                <div>
                  <strong>{item.approvedOutput?.name || item.title}</strong>
                  <small>
                    {[
                      item.sourceLabel || "문서 작성",
                      approvedOutputFolderLabel(item.approvedOutput?.folder),
                      item.approvedOutput?.alternatePaths?.length ? `보조 문서 ${item.approvedOutput.alternatePaths.length}개` : "",
                    ].filter(Boolean).join(" · ")}
                  </small>
                  <section
                    className={styles.approvedOutputDecisionRail}
                    aria-label={`${item.approvedOutput?.name || item.title} 승인 문서 다음 결정`}
                    data-approved-output-decision-rail="local_result_final_review_lock_first"
                    data-approved-output-primary-visible="saved_output_final_review_lock"
                    data-approved-output-hidden="file_paths_alternate_outputs_diagnostics_until_details"
                    data-approved-output-final-boundary="share_submit_locked_until_final_confirmation"
                    data-approved-output-external-mutation="false"
                  >
                    <article data-step="local_result" data-state="saved">
                      <span>로컬 결과</span>
                      <strong>{item.approvedOutput?.name ?? "승인 문서"}</strong>
                      <small>앱 문서 폴더에 저장</small>
                    </article>
                    <article data-step="final_review" data-state="approval">
                      <span>다음 결정</span>
                      <strong>공유/제출 전 확인</strong>
                      <small>최종 확인 카드로 이동</small>
                    </article>
                    <article data-step="share_submit_lock" data-state="locked">
                      <span>잠금</span>
                      <strong>공유/제출 잠금</strong>
                      <small>확인 전 외부 실행 없음</small>
                    </article>
                  </section>
                  <p>{item.summary}</p>
                  <details
                    className={styles.approvedOutputFilesFold}
                    data-approved-output-files-default="closed_after_decision_rail"
                    data-approved-output-files-visible="summary_until_open"
                    data-approved-output-files-hidden="alternate_paths_until_details"
                  >
                    <summary>
                      <span>파일 위치</span>
                      <strong>{item.approvedOutput?.name ?? "기본 Markdown"}</strong>
                      <small>{item.approvedOutput?.alternatePaths?.length ? `Word/Excel 호환 문서 ${item.approvedOutput.alternatePaths.length}개` : "기본 문서 1개"}</small>
                    </summary>
                    <div className={styles.approvedOutputFiles}>
                      <em>{item.approvedOutput?.name ?? "기본 Markdown"}</em>
                      {item.approvedOutput?.alternatePaths?.map((output) => (
                        <em key={`${item.id}-${output.path}`}>{output.label || output.name}</em>
                      ))}
                    </div>
                  </details>
                  <ol
                    className={styles.approvedOutputSafetySteps}
                    aria-label={`${item.approvedOutput?.name || item.title} 승인 문서 저장 공유 경로`}
                    data-approved-output-safety="local_output_before_share"
                    data-approved-output-safety-default="visible_after_decision_rail"
                  >
                    {approvedOutputSafetySteps(item).map((step) => (
                      <li key={`${item.id}-${step.label}`} data-state={step.state}>
                        <span>{step.label}</span>
                        <div>
                          <strong>{step.title}</strong>
                          <small>{step.detail}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className={styles.approvedOutputActions}>
                  <button
                    type="button"
                    onClick={() => onStageApprovedOutputFinalAction?.(item)}
                    disabled={!onStageApprovedOutputFinalAction || preparingFinalActionId === item.id}
                    data-approved-output-primary-action="stage_share_submit_final_review"
                  >
                    {preparingFinalActionId === item.id ? "준비 중" : "공유/제출 전 확인"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenApprovedOutput?.(item)}
                    disabled={!onOpenApprovedOutput}
                    data-approved-output-support-action="open_local_folder"
                  >
                    문서 폴더 열기
                  </button>
                  {item.approvedOutput?.alternatePaths?.length ? (
                    <button
                      type="button"
                      onClick={() => onOpenApprovedOutput?.(item)}
                      disabled={!onOpenApprovedOutput}
                      data-approved-output-support-action="open_compatible_output"
                    >
                      Word 호환 문서 위치
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>보고서·메일·일정 초안을 승인하면 로컬 문서 폴더에 저장되고, Word 호환 문서가 있으면 함께 표시됩니다.</p>
        )}
      </section>

      <section
        className={styles.externalApprovalPanel}
        aria-label="외부 계정과 내 PC 작업 도우미 승인 카드"
        data-external-approval-count={externalApprovalCandidates.length}
        data-external-approval-disclosure="first_one_then_more_inside_details"
        data-external-approval-first-screen="candidate_decision_final_lock_then_support_details"
        data-external-approval-primary-visible="first_candidate_next_decision_final_lock"
        data-external-approval-support-default="boundary_flow_owner_details_folded"
        data-external-approval-final-boundary="final_confirmation_before_external_mutation"
        data-external-approval-visible-count={visibleExternalApprovalCandidates.length}
        data-external-approval-hidden-count={hiddenExternalApprovalCandidates.length}
        data-external-approval-visible-limit={approvalCandidateVisibleLimit}
      >
        <header>
          <div>
            <span>외부 계정</span>
            <strong>
              {externalApprovalCandidates.length
                ? `${externalApprovalCandidates.length}개 보관함 승인 대기`
                : "보관함 승인 대기 없음"}
            </strong>
          </div>
          <small>공식 연결이 안 되는 업무는 계정 보관함과 내 PC 읽기 모드 뒤 앱 승인 카드로만 넘어옵니다</small>
        </header>

        <details
          className={styles.officeExecutionBoundaryFold}
          aria-label="외부 계정 실행 기준 더 보기"
          data-office-execution-boundary-fold="summary_first_steps_on_demand"
          data-office-execution-boundary-default="closed"
        >
          <summary>
            <span>기준</span>
            <strong>실행 전 승인 기준</strong>
          </summary>
          <ol className={styles.officeExecutionBoundaryRail} aria-label="오피스 실행 경계">
            {officeExecutionBoundaryItems.map((item) => (
              <li key={`external-${item.id}`} data-state={item.state}>
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </li>
            ))}
          </ol>
        </details>

        <details
          className={styles.externalApprovalSupportFold}
          aria-label="외부 계정 승인 경로 더 보기"
          data-external-approval-support-fold="boundary_flow_owner_details_on_demand"
          data-external-approval-support-default="closed"
          data-external-approval-support-body="hidden_until_user_opens"
        >
          <summary>
            <span>보조 경로</span>
            <strong>보관함 · 내 PC 경로</strong>
            <small>실행 기준과 연결 복구 흐름은 필요할 때만 확인합니다</small>
          </summary>
          <div className={styles.externalApprovalFlow} aria-label="외부 계정 승인 흐름">
            {["계정 보관함", "연결 재점검", "내 PC 작업 도우미 읽기", "앱 승인"].map((label, index) => (
              <span key={label} data-state={externalApprovalCandidates.length && index < 3 ? "done" : externalApprovalCandidates.length ? "active" : "idle"}>
                <i>{index + 1}</i>
                <b>{label}</b>
              </span>
            ))}
          </div>
        </details>

        {browserTaskActionMessage ? (
          <p className={styles.browserTaskActionMessage}>{browserTaskActionMessage}</p>
        ) : null}

        {externalApprovalCandidates.length ? (
          <>
          <ol data-external-approval-primary-list="first_one">
            {visibleExternalApprovalCandidates.map((item) => (
              (() => {
                const ownerQueueItem = channelQueueItems.find((queueItem) => queueItem.workItemId === item.id);
                const externalPlainChecks = buildExternalApprovalPlainCheck(item);
                const webmailFallbackChecks = buildWebmailFallbackStatusRail(item);
                const browserProgressSteps = buildBrowserTaskProgressSteps(item);
                const browserDecisionRail = buildBrowserTaskDecisionRail(item);
                const browserTaskResultReceipts = buildBrowserTaskResultReceipts(item);
                const externalComputerUseChecks = buildComputerUseOfficeApprovalChecks({
                  item,
                  risk: highestWorkItemRisk([item]),
                  preview: item.browserTask?.dryRunPlan?.expectedResult || item.summary || "실행 전에 대상 화면을 먼저 확인합니다.",
                  logPath: browserTaskResultReceipts.length ? "최종 실행 감사 기록" : "실행 전 기록 대기",
                  rollbackGuide: item.browserTask?.dryRunPlan?.rollbackGuide || "실행 전에는 취소할 수 있고, 실행 뒤에는 감사 기록을 먼저 확인합니다.",
                });
                const nextBrowserAction = browserTaskNextActionCapability(item);
                const browserActionRunning = Boolean(
                  nextBrowserAction && runningBrowserTaskActionId === `${item.id}:${nextBrowserAction.capability}`,
                );
                return (
                  <li
                    key={item.id}
                    data-host={item.browserTask?.host || "external"}
                    data-approval-card-contract="risk_preview_decision_log_rollback"
                    data-approval-decision-options="approve_cancel_change_hold"
                    data-execution-log-policy="audit_or_decision_receipt"
                    data-rollback-policy="guide_before_or_after_execution"
                    data-webmail-fallback-status={isWebmailFallbackApprovalItem(item) ? "metadata_first_secret_blind" : undefined}
                    data-next-user-choice={officeNextUserChoiceForWorkItem(item)}
                  >
                    <span>{externalApprovalLabel(item)}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {[
                          officeUserFacingSourceLabel(item.sourceLabel || "외부 계정"),
                          item.browserTask?.host,
                          item.browserTask?.requiresFinalUserPresence ? "최종 사용자 승인 필요" : "읽기 확인",
                        ].filter(Boolean).join(" · ")}
                      </small>
                      <section
                        className={styles.externalApprovalDecisionRail}
                        aria-label={`${item.title} 외부 실행 전 결정`}
                        data-external-approval-decision-rail="candidate_review_final_confirmation_lock_first"
                        data-external-approval-primary-visible="candidate_next_decision_final_lock"
                        data-external-approval-hidden="vault_computer_use_evidence_until_details"
                        data-external-approval-final-boundary="final_confirmation_before_external_mutation"
                        data-external-approval-external-mutation="false"
                      >
                        <article data-step="candidate">
                          <span>후보 확인</span>
                          <strong>{item.browserTask ? "내 PC 읽기 후보" : "계정 보관함 후보"}</strong>
                          <small>{item.browserTask?.dryRunPlan?.expectedResult || item.summary}</small>
                        </article>
                        <article data-step="final_review">
                          <span>다음 결정</span>
                          <strong>마지막 확인 준비</strong>
                          <small>실행하기를 누르면 앱 안의 최종 확인 카드로 이어집니다.</small>
                        </article>
                        <article data-step="external_lock">
                          <span>실행 잠금</span>
                          <strong>클릭 · 입력 · 발송 잠금</strong>
                          <small>최종 사용자 확인 전 외부 사이트, 파일, 메일은 바뀌지 않습니다.</small>
                        </article>
                      </section>
                      {ownerQueueItem ? (
                        <div className={styles.externalApprovalOwner}>
                          <b>{ownerQueueItem.teammateName}</b>
                          <small>
                            {ownerQueueItem.channelName} · {ownerQueueItem.teamLabel} · {ownerQueueItem.queueLabel || "오피스 승인함"}
                          </small>
                        </div>
                      ) : null}
                      <p>{item.browserTask?.dryRunPlan?.expectedResult || item.summary}</p>
                      {webmailFallbackChecks.length ? (
                        <dl
                          className={styles.webmailFallbackStatusRail}
                          aria-label={`${item.title} 웹메일 확인 상태`}
                          data-webmail-fallback-contract="login_reference_metadata_only_approval_queue"
                          data-webmail-secret-policy="raw_password_session_not_visible_to_ai"
                        >
                          {webmailFallbackChecks.map((check) => (
                            <div key={`${item.id}-webmail-${check.id}`} data-state={check.state}>
                              <dt>{check.label}</dt>
                              <dd>
                                <strong>{check.title}</strong>
                                <small>{check.detail}</small>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      <dl
                        className={styles.approvalPlainCheckGrid}
                        aria-label={`${item.title} 외부 승인 한눈에 보기`}
                      >
                        {externalPlainChecks.map((check) => (
                          <div key={`${item.id}-plain-${check.id}`} data-state={check.state}>
                            <dt>{check.label}</dt>
                            <dd>
                              <strong>{check.title}</strong>
                              <small>{check.detail}</small>
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {externalComputerUseChecks.length ? (
                        <dl
                          className={styles.computerUseOfficeApprovalContract}
                          aria-label={`${item.title} 내 PC 작업 승인 한눈에 보기`}
                          data-computer-use-office-contract="risk_preview_decision_log_rollback"
                        >
                          {externalComputerUseChecks.map((check) => (
                            <div key={`${item.id}-external-computer-use-${check.id}`} data-state={check.state}>
                              <dt>{check.label}</dt>
                              <dd>
                                <strong>{check.title}</strong>
                                <small>{check.detail}</small>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {browserTaskResultReceipts.length ? (
                        <dl
                          className={styles.browserTaskResultReceipt}
                          aria-label={`${item.title} 실행 결과와 되돌리기 기준`}
                        >
                          {browserTaskResultReceipts.map((receipt) => (
                            <div key={`${item.id}-browser-receipt-${receipt.id}`} data-state={receipt.state}>
                              <dt>{receipt.label}</dt>
                              <dd>
                                <strong>{receipt.title}</strong>
                                <small>{receipt.detail}</small>
                                <code>{officeMemoryReferenceLabel(receipt.recordPath)}</code>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {browserProgressSteps.length ? (
                        <section className={styles.browserTaskProgressRail} aria-label={`${item.title} 내 PC 작업 도우미 다음 단계`}>
                          <header>
                            <span>내 PC 작업 도우미 다음 단계</span>
                            <strong>{browserTaskNextActionLabel(item)}</strong>
                          </header>
                          <ol>
                            {browserProgressSteps.map((step) => (
                              <li key={`${item.id}-${step.id}`} data-state={step.state}>
                                <span>{step.label}</span>
                                <div>
                                  <strong>{step.title}</strong>
                                  <small>{step.detail}</small>
                                </div>
                              </li>
                            ))}
                          </ol>
                          {browserDecisionRail.length ? (
                            <dl
                              className={styles.browserTaskDecisionRail}
                              aria-label={`${item.title} 실행 취소 로그 되돌리기`}
                              data-computer-use-decision-contract="execute_cancel_log_rollback"
                              data-user-decision-options="execute_cancel_log_rollback"
                              data-final-confirmation-policy="required_before_click_input_file_change"
                              data-execution-log-policy="audit_or_office_receipt"
                              data-rollback-policy="guide_before_or_after_execution"
                            >
                              {browserDecisionRail.map((decision) => (
                                <div key={`${item.id}-decision-${decision.id}`} data-state={decision.state}>
                                  <dt>{decision.label}</dt>
                                  <dd>
                                    <strong>{decision.title}</strong>
                                    <small>{decision.detail}</small>
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                          {nextBrowserAction ? (
                            <footer>
                              <button
                                type="button"
                                onClick={() => onRunBrowserTaskAction?.(item, nextBrowserAction.capability)}
                                disabled={!onRunBrowserTaskAction || browserActionRunning}
                              >
                                {browserActionRunning ? "확인 중" : nextBrowserAction.label}
                              </button>
                              <small>설치 앱에서 읽기/감사 기록부터 진행하고 실제 클릭·입력은 계속 승인 잠금</small>
                            </footer>
                          ) : null}
                        </section>
                      ) : null}
                      {onRecordMailOpsDecision ? (
                        <div
                          className={styles.finalActionDecisionActions}
                          aria-label={`${item.title} 고쳐달라고 하기 또는 보류하기`}
                        >
                          <div
                            className={styles.finalActionDecisionLead}
                            data-final-decision-flow="run_change_hold_worklog_next_pattern"
                            data-user-decision-labels="run_change_hold_remember"
                          >
                            <strong>{officeDecisionActionLabels}</strong>
                            <small>
                              실행하기는 이 버튼에서 최종 확인 준비로 이어지고, 고쳐달라고 하기와 보류하기는 여기서 기록합니다. 결정 뒤 실행 로그와 업무 기록을 확인한
                              다음 마음에 드는 방식만 다음부터 이렇게로 저장합니다.
                            </small>
                          </div>
                          <dl
                            className={styles.finalActionDecisionRail}
                            aria-label={`${item.title} 고쳐달라고 하기 보류하기 다음 기록`}
                          >
                            <div data-state="run">
                              <dt>실행하기</dt>
                              <dd>
                                <strong>최종 확인으로 이어짐</strong>
                                <small>연결, 화면 증거, 실행 전 검토가 준비된 뒤에만 실제 실행 후보로 넘어갑니다.</small>
                              </dd>
                            </div>
                            <div data-state="review">
                              <dt>고쳐달라고 하기</dt>
                              <dd>
                                <strong>다시 확인으로 되돌림</strong>
                                <small>외부 실행 없이 담당 업무 비서 기록에 수정 이유를 남깁니다.</small>
                              </dd>
                            </div>
                            <div data-state="held">
                              <dt>보류하기</dt>
                              <dd>
                                <strong>내 PC 작업 후보 잠금 유지</strong>
                                <small>클릭, 입력, 파일 변경은 실행하지 않고 승인 카드만 멈춥니다.</small>
                              </dd>
                            </div>
                            <div data-state="log">
                              <dt>업무 기록</dt>
                              <dd>
                                <strong>감사 기록으로 남김</strong>
                                <small>다음 선택지는 화면 증거 다시 확인, 연결 확인, 오피스 승인함입니다.</small>
                              </dd>
                            </div>
                          </dl>
                          <button
                            type="button"
                            data-final-decision-action="run"
                            onClick={() => onPrepareFinalConfirmation?.(item)}
                            disabled={
                              !onPrepareFinalConfirmation ||
                              preparingFinalActionId === item.id ||
                              recordingMailOpsDecisionId === item.id
                            }
                          >
                            {preparingFinalActionId === item.id ? "준비 중" : "실행하기"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onRecordMailOpsDecision?.(item, "change_requested")}
                            disabled={recordingMailOpsDecisionId === item.id}
                          >
                            고쳐달라고 하기
                          </button>
                          <button
                            type="button"
                            onClick={() => onRecordMailOpsDecision?.(item, "held")}
                            disabled={recordingMailOpsDecisionId === item.id}
                          >
                            보류하기
                          </button>
                          <small>고쳐달라고 하기와 보류하기는 외부 실행 없이 업무 기록으로 남깁니다</small>
                          <nav
                            className={styles.cardDecisionFollowupActions}
                            aria-label={`${item.title} 결정 후 바로 확인`}
                            data-card-decision-followup-actions="log_remember_next_choice"
                            data-card-decision-visible-priority="decision_done_log_first_remember_next"
                            data-decision-complete-label="결정 후 바로 볼 것"
                            data-card-decision-work-kind={externalApprovalLabel(item)}
                            data-card-decision-followup-path="decision_log_remember_next"
                            data-log-action="open_office"
                            data-save-action="today_check"
                            data-next-action="workers"
                            data-mobile-safe-width="390"
                          >
                            <span>{externalApprovalLabel(item)} · 결정 후 바로 볼 것</span>
                            <a href={officeHomeActionHref("open_office")} data-action="log">
                              실행 로그 확인
                            </a>
                            <a href={officeHomeActionHref("today_check")} data-action="remember">
                              다음부터 이렇게 저장 위치
                            </a>
                            <a href={officeHomeActionHref("workers")} data-action="next">
                              다음 작업 맡기기
                            </a>
                          </nav>
                        </div>
                      ) : null}
                    </div>
                    <nav className={styles.externalApprovalActions} aria-label={`${item.title} 외부 계정 승인 액션`}>
                      <a href={officeSingleSettingHref("vault", "외부 계정 보관함만 설정합니다", { externalAccounts: "1" })}>
                        보관함 열기
                      </a>
                      <a href={officeSingleSettingHref("computer-use", "내 PC 작업 도우미 읽기 설정만 확인합니다", { workItem: item.id })}>
                        내 PC 작업 도우미 확인
                      </a>
                      {isWebmailFallbackApprovalItem(item) ? (
                        <>
                          <a
                            href={officeHomeActionHref("webmail_metadata_rehearsal")}
                            data-webmail-fallback-action="metadata_rehearsal"
                            data-secret-policy="credential_reference_only"
                          >
                            웹메일 리허설
                          </a>
                          <a
                            href={officeHomeActionHref("mail_live_e2e_rehearsal")}
                            data-webmail-fallback-action="live_e2e_rehearsal"
                            data-final-action-lock="send_calendar_file_locked_until_user_approval"
                          >
                            실전 리허설
                          </a>
                        </>
                      ) : null}
                    </nav>
                  </li>
                );
              })()
            ))}
          </ol>
          {hiddenExternalApprovalCandidates.length ? (
            <details
              className={styles.approvalCandidateMore}
              aria-label="외부 계정 나머지 승인 후보"
              data-external-approval-more="remaining_cards_collapsed"
              data-external-approval-more-default="closed"
            >
              <summary>
                <span>나머지 승인 후보</span>
                <strong>{hiddenExternalApprovalCandidates.length}개 접힘</strong>
                <small>필요할 때 제목과 다음 위치만 확인합니다</small>
              </summary>
              <ol className={styles.approvalCandidateMoreList}>
                {hiddenExternalApprovalCandidates.map((item) => (
                  <li key={`external-more-${item.id}`} data-state={item.browserTask?.requiresFinalUserPresence ? "approval" : "review"}>
                    <span>{externalApprovalLabel(item)}</span>
                    <strong>{item.title}</strong>
                    <small>{officeUserFacingSourceLabel(item.sourceLabel || "외부 계정")} · {officeNextUserChoiceForWorkItem(item)}</small>
                    <a href={officeSingleSettingHref("vault", "외부 계정 보관함만 설정합니다", { externalAccounts: "1" })}>
                      보관함
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          </>
        ) : (
          <p>보관함에서 사이트 계정을 저장하면 화면 확인용 카드가 이곳에 올라옵니다. 클릭·입력·발송은 앱의 마지막 확인 전까지 잠겨 있습니다.</p>
        )}
      </section>

      {finalConfirmation ? (
        <section
          className={styles.focusedFinalActionPanel}
          aria-label="포커스된 최종 확인"
          data-readiness={finalConfirmation.readiness}
        >
          <header>
            <div>
              <span>지금 확인할 실행 후보</span>
              <strong>{focusedFinalActionCandidate?.title ?? finalConfirmation.title}</strong>
            </div>
            <small>{finalConfirmation.actionLabel}</small>
          </header>
          {focusedMemorySearchGuide ? (
            <section
              className={styles.memorySearchFinalActionSource}
              data-state={focusedMemorySearchGuide.state}
              aria-label="지난 업무에서 온 최종 확인"
            >
              <span>지난 업무 근거</span>
              <div>
                <strong>{focusedMemorySearchGuide.resultKind}</strong>
                <small>{focusedMemorySearchGuide.safetyLabel}</small>
              </div>
              <em>{focusedMemorySearchGuide.nextUserChoice}</em>
            </section>
          ) : null}
          {focusedBulkRecipientListGuide ? (
            <section
              className={styles.bulkRecipientListGuide}
              data-state={focusedBulkRecipientListGuide.state}
              aria-label="대량 메일 명단 근거"
            >
              <span>명단 근거</span>
              <div>
                <strong>{focusedBulkRecipientListGuide.recipientSummary}</strong>
                <small>{focusedBulkRecipientListGuide.readinessSummary} · {focusedBulkRecipientListGuide.exceptionSummary}</small>
              </div>
              <dl>
                <div>
                  <dt>샘플 준비</dt>
                  <dd>{focusedBulkRecipientListGuide.readinessSummary}</dd>
                </div>
                <div>
                  <dt>추천 대상</dt>
                  <dd>{focusedBulkRecipientListGuide.recommendationSummary}</dd>
                </div>
                <div>
                  <dt>수정 반영</dt>
                  <dd>{focusedBulkRecipientListGuide.decisionOverrideSummary}</dd>
                </div>
                <div>
                  <dt>최종 후보</dt>
                  <dd>{focusedBulkRecipientListGuide.effectiveRecipientSummary}</dd>
                </div>
                <div>
                  <dt>수정 출처</dt>
                  <dd>{focusedBulkRecipientListGuide.decisionOverrideSourceSummary}</dd>
                </div>
                <div>
                  <dt>수정 이력</dt>
                  <dd>{focusedBulkRecipientListGuide.decisionOverrideHistorySummary}</dd>
                </div>
                <div>
                  <dt>되돌림 기준</dt>
                  <dd>{focusedBulkRecipientListGuide.decisionOverrideRollbackSummary}</dd>
                </div>
                <div>
                  <dt>제외 규칙</dt>
                  <dd>{focusedBulkRecipientListGuide.exclusionRuleSummary}</dd>
                </div>
                <div>
                  <dt>제외 사유</dt>
                  <dd>{focusedBulkRecipientListGuide.exclusionReasonSummary}</dd>
                </div>
                <div>
                  <dt>그룹 샘플</dt>
                  <dd>{focusedBulkRecipientListGuide.groupSampleSummary}</dd>
                </div>
                <div>
                  <dt>개인화 누락</dt>
                  <dd>{focusedBulkRecipientListGuide.personalizationGapSummary}</dd>
                </div>
                <div>
                  <dt>다음 검토</dt>
                  <dd>{focusedBulkRecipientListGuide.nextReviewFocus}</dd>
                </div>
                <div>
                  <dt>저장된 기준</dt>
                  <dd>{focusedBulkRecipientListGuide.learningProfileSummary}</dd>
                </div>
                <div>
                  <dt>학습 대상</dt>
                  <dd>{focusedBulkRecipientListGuide.learnedTargetSummary}</dd>
                </div>
                <div>
                  <dt>승인 습관</dt>
                  <dd>{focusedBulkRecipientListGuide.learnedApprovalHabitSummary}</dd>
                </div>
                <div>
                  <dt>학습 기본 추천</dt>
                  <dd>{focusedBulkRecipientListGuide.learnedDefaultDecisionSummary}</dd>
                </div>
                <div>
                  <dt>학습 수정 추천</dt>
                  <dd>{focusedBulkRecipientListGuide.learnedOverrideSuggestionSummary}</dd>
                </div>
                <div>
                  <dt>추천 적용</dt>
                  <dd>{focusedBulkRecipientListGuide.learnedOverrideActionSummary}</dd>
                </div>
              </dl>
              <em>{focusedBulkRecipientListGuide.privacyBoundary}</em>
            </section>
          ) : null}
          {focusedMailWorkReviewGuide && focusedFinalActionCandidate ? (
            <section
              className={styles.mailWorkReviewGuide}
              data-state={focusedMailWorkReviewGuide.state}
              aria-label={`${focusedFinalActionCandidate.title} 메일별 검토 근거`}
              data-mail-work-review="original_draft_recipient_attachment_final_boundary"
              data-mail-work-review-proof={focusedMailWorkReviewGuide.proof}
              data-mail-work-review-final-boundary="approved_only_final_confirmation_before_send"
              data-external-mutation="false"
            >
              <header>
                <div>
                  <span>메일별 검토 근거</span>
                  <strong>{focusedMailWorkReviewGuide.replyMethodLabel}</strong>
                </div>
                <small>{focusedMailWorkReviewGuide.finalApprovalBoundary}</small>
              </header>
              <dl>
                <div>
                  <dt>원문 요약</dt>
                  <dd>{focusedMailWorkReviewGuide.originalSummary}</dd>
                </div>
                <div>
                  <dt>초안/후보</dt>
                  <dd>{focusedMailWorkReviewGuide.draftSummary}</dd>
                </div>
                <div>
                  <dt>선별 이유</dt>
                  <dd>{focusedMailWorkReviewGuide.sendDecisionReason}</dd>
                </div>
                <div>
                  <dt>수정 포인트</dt>
                  <dd>{focusedMailWorkReviewGuide.editFocusLabel}</dd>
                </div>
                <div>
                  <dt>첨부/링크</dt>
                  <dd>{focusedMailWorkReviewGuide.attachmentSummary}</dd>
                </div>
                <div>
                  <dt>개인정보</dt>
                  <dd>{focusedMailWorkReviewGuide.privacyBoundary}</dd>
                </div>
              </dl>
              {focusedMailWorkReviewGuide.reviewItems.length ? (
                <ol aria-label={`${focusedFinalActionCandidate.title} 메일별 검토 체크리스트`}>
                  {focusedMailWorkReviewGuide.reviewItems.map((review) => (
                    <li key={`${focusedFinalActionCandidate.id}-focused-mail-work-review-${review.id}`} data-state={review.state}>
                      <span>{review.label}</span>
                      <strong>{userComposedMailReviewStateLabel(review.state)}</strong>
                      <small>{review.detail}</small>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          ) : null}
          {shouldShowFocusedMailOpsBatchContext ? (
            <section
              className={styles.focusedMailOpsBatchContext}
              aria-label="포커스된 최종 확인 작업함 승인 묶음"
              data-mailops-focused-final-batch="approved_only_from_work_queue"
              data-mailops-focused-final-total={mailOpsWorkQueueReviewSummary.total}
              data-mailops-focused-final-included-count={mailOpsWorkQueueReviewSummary.approve}
              data-mailops-focused-final-held-count={mailOpsWorkQueueReviewSummary.revise + mailOpsWorkQueueReviewSummary.hold}
              data-mailops-focused-final-excluded-count={mailOpsWorkQueueReviewSummary.exclude}
              data-mailops-focused-final-review-context={focusedMailOpsWorkQueueReview?.approvalContext ?? mailOpsWorkQueueReviewContextContract}
              data-mailops-focused-final-review-decision={
                focusedMailOpsWorkQueueReview
                  ? mailOpsWorkQueueDecisionLabel(focusedMailOpsWorkQueueReview.decision)
                  : "검토 기록 없음"
              }
              data-mailops-focused-final-proof-chain={mailOpsWorkQueueProofChainContract}
              data-mailops-focused-final-engine-handoff={mailOpsWorkQueueAutomationEvidence.evidenceContract}
              data-mailops-focused-final-engine-path={mailOpsWorkQueueAutomationEvidence.enginePathContract}
              data-mailops-focused-final-automation-proof={mailOpsWorkQueueAutomationProofLabel}
              data-mailops-focused-final-external-mutation="false"
            >
              <span>작업함 승인 묶음</span>
              <div>
                <strong>
                  {focusedMailOpsWorkQueueReview
                    ? `${mailOpsWorkQueueDecisionLabel(focusedMailOpsWorkQueueReview.decision)} 항목만 최종 확인`
                    : "승인 대기 항목만 최종 확인"}
                </strong>
                <small>
                  승인 {mailOpsWorkQueueReviewSummary.approve}건 · 보류/수정 {mailOpsWorkQueueReviewSummary.revise + mailOpsWorkQueueReviewSummary.hold}건 · 제외 {mailOpsWorkQueueReviewSummary.exclude}건
                </small>
              </div>
              <p>
                {focusedMailOpsWorkQueueReview?.note
                  ? `수정 메모: ${focusedMailOpsWorkQueueReview.note}`
                  : "수정 메모가 없는 항목은 최종 확인에서 수신자, 제목, 본문, 첨부를 다시 확인합니다."}
              </p>
              <p>자동화 엔진 증거: {mailOpsWorkQueueAutomationProofLabel}</p>
              {focusedMailOpsWorkQueueReview?.revisedDraft ? (
                <p data-mailops-focused-final-revised-draft="review_record_revised_draft_to_final_confirmation">
                  수정본 본문: {focusedMailOpsWorkQueueReview.revisedDraft.replace(/\s+/gu, " ").trim().slice(0, 240)}
                </p>
              ) : null}
              {focusedMailOpsWorkQueueReview?.decisionReasonSummary ? (
                <p
                  data-mailops-focused-final-decision-reason="work_queue_decision_reason_to_final_confirmation"
                  data-mailops-focused-final-route={focusedMailOpsWorkQueueReview.finalConfirmationRoute ?? "included"}
                >
                  판단 근거: {focusedMailOpsWorkQueueReview.decisionReasonSummary}
                </p>
              ) : null}
              {focusedMailOpsWorkQueueReview?.sendCheckSummary ? (
                <p data-mailops-focused-final-send-check-summary="work_queue_send_check_to_final_confirmation">
                  발송 전 점검: {focusedMailOpsWorkQueueReview.sendCheckSummary}
                </p>
              ) : null}
              {focusedMailOpsBatchBreakdownItems.length ? (
                <ol
                  className={styles.focusedMailOpsBatchBreakdown}
                  aria-label="포커스된 최종 확인 포함 보류 제외 목록"
                  data-mailops-focused-final-breakdown="included_held_excluded_by_work_queue_record"
                  data-mailops-focused-final-breakdown-evidence="decision_reason_send_check_final_route"
                  data-mailops-focused-final-breakdown-external-mutation="false"
                >
                  {focusedMailOpsBatchBreakdownItems.map((record) => (
                    <li
                      key={`${record.itemId}-${record.decision}`}
                      data-mailops-focused-final-item-state={record.state}
                      data-mailops-focused-final-item-decision={record.decision}
                      data-external-mutation={record.externalMutation === false ? "false" : "true"}
                    >
                      <span>{record.routeLabel}</span>
                      <strong>{record.title}</strong>
                      <small>
                        {record.decisionLabel} · {record.note}
                      </small>
                      <small>{record.decisionReasonSummary}</small>
                      <small>{record.sendCheckSummary}</small>
                    </li>
                  ))}
                </ol>
              ) : null}
              <small>업무대장 → 승인함 후보 → 마지막 확인 → 실행 로그</small>
              <small>보류/제외 항목은 이 최종 확인 카드에 포함하지 않으며 실제 발송은 계속 잠겨 있습니다.</small>
            </section>
          ) : null}
          {focusedUserComposedMailReview?.reviewItems?.length ? (
            <section
              className={styles.userComposedFinalReview}
              aria-label="포커스된 작성 메일 최종 확인 근거"
              data-user-composed-focused-final-review="recipient_subject_body_attachment_risk_to_final_confirmation"
              data-user-composed-final-proof={focusedUserComposedMailReview.proof ?? "user_composed_mail_check_result_to_approval_preview"}
              data-user-composed-final-boundary="review_edit_approve_final_confirmation_before_send"
              data-user-composed-final-ready={
                focusedUserComposedMailReview.reviewItems.every((review) => review.state === "ok") ? "true" : "false"
              }
            >
              <header>
                <span>작성 메일 최종 확인 근거</span>
                <strong>{focusedUserComposedMailReview.revisionSuggestion ?? "수정 제안 확인 후 승인 후보로 넘깁니다."}</strong>
                <small>{focusedUserComposedMailReview.approvalGate ?? "사용자 최종 확인 전 외부 발송 없음"}</small>
                <small>사용자 최종 확인 전 외부 발송 없음</small>
              </header>
              <ol>
                {focusedUserComposedMailReview.reviewItems.map((review) => (
                  <li key={`focused-user-composed-${review.id ?? review.label}`} data-state={review.state ?? "needs_review"}>
                    <span>{review.label ?? "점검"}</span>
                    <strong>{userComposedMailReviewStateLabel(review.state)}</strong>
                    <small>{review.detail ?? "최종 확인 전 다시 점검합니다."}</small>
                  </li>
                ))}
              </ol>
              {focusedUserComposedMailReview.sendReviewItems?.length ? (
                <section
                  className={styles.userComposedSendReviewRail}
                  aria-label="포커스된 작성 메일 발송 전 요약"
                  data-user-composed-focused-send-review="recipient_cc_bcc_subject_body_attachment_risk_calendar_approval"
                  data-user-composed-send-review-count={focusedUserComposedMailReview.sendReviewItems.length}
                  data-user-composed-send-review-external-mutation="false"
                >
                  <header>
                    <span>발송 전 요약</span>
                    <strong>수신자, 참조, 제목, 본문, 첨부, 위험 표현, 일정 등록 여부를 한 번에 확인합니다</strong>
                    <small>사용자 마지막 확인 전까지 메일 발송과 일정 등록은 계속 잠겨 있습니다.</small>
                  </header>
                  <ol>
                    {focusedUserComposedMailReview.sendReviewItems.map((review) => (
                      <li key={`focused-user-composed-send-${review.id ?? review.label}`} data-state={review.state ?? "needs_review"}>
                        <span>{review.label ?? "점검"}</span>
                        <strong>{review.title ?? userComposedMailReviewStateLabel(review.state)}</strong>
                        <small>{review.detail ?? "최종 확인 전 다시 점검합니다."}</small>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
              {focusedUserComposedMailReview ? (
                <section
                  className={styles.userComposedApprovalRunway}
                  aria-label="포커스된 작성 메일 발송 경로"
                  data-user-composed-focused-runway="compose_check_edit_approve_final_confirmation_dry_run_log"
                  data-user-composed-focused-runway-ready={
                    focusedUserComposedMailReview.reviewItems?.every((review) => review.state === "ok") ? "true" : "false"
                  }
                  data-user-composed-focused-runway-send-review-count={focusedUserComposedMailReview.sendReviewItems?.length ?? 0}
                  data-user-composed-focused-runway-external-mutation="false"
                >
                  <header>
                    <span>작성 메일 발송 경로</span>
                    <strong>내가 쓴 메일도 점검, 수정, 승인, 마지막 확인 뒤에만 발송합니다.</strong>
                    <small>승인 후보를 만든 것만으로는 메일 발송이나 일정 등록을 실행하지 않습니다.</small>
                  </header>
                  <ol>
                    {(focusedUserComposedMailRunwayItems.length
                      ? focusedUserComposedMailRunwayItems
                      : [
                          {
                            id: "check_result",
                            label: "내용 점검",
                            title: focusedUserComposedMailReview.readinessLabel || "작성 메일 점검",
                            detail: "수신자, 제목, 본문, 첨부, 위험 표현, 일정 영향까지 먼저 확인합니다.",
                            state: focusedUserComposedMailReview.reviewItems?.every((review) => review.state === "ok")
                              ? "ready"
                              : "review",
                          },
                          {
                            id: "edit_suggestion",
                            label: "수정 제안",
                            title: "수정 후 승인 후보",
                            detail:
                              focusedUserComposedMailReview.revisionSuggestion ||
                              "필요한 수정을 반영한 뒤 승인 후보로 넘깁니다.",
                            state: focusedUserComposedMailReview.reviewItems?.some((review) => review.state !== "ok")
                              ? "review"
                              : "ready",
                          },
                          {
                            id: "approval_candidate",
                            label: "승인 후보",
                            title: "사용자가 고른 뒤에만 진행",
                            detail: focusedUserComposedMailReview.approvalGate || "사용자 최종 확인 전 외부 발송 없음",
                            state: "locked",
                          },
                          {
                            id: "final_dry_run",
                            label: "마지막 확인",
                            title: "실행 전 검토 대기",
                            detail: "메일 연결, 수신자, 참조, 본문, 첨부를 dry-run으로 다시 확인합니다.",
                            state: "review",
                          },
                          {
                            id: "execution_log",
                            label: "실행 로그",
                            title: "최종 확인 전 로그 대기",
                            detail: "실제 발송 요청 뒤 감사 기록과 되돌리기 기준을 남깁니다.",
                            state: "locked",
                          },
                        ]).map((step) => (
                      <li key={`focused-user-composed-runway-${step.id}`} data-state={step.state}>
                        <span>{step.label}</span>
                        <strong>{step.title}</strong>
                        <small>{step.detail}</small>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </section>
          ) : null}
          {shouldShowFocusedFinalMailSendReview ? (
            <section
              className={styles.focusedFinalMailSendReview}
              aria-label="마지막 확인 메일 발송 전 확인표"
              data-mailops-focused-final-send-check="recipient_cc_bcc_subject_body_attachment_risk_calendar_review"
              data-mailops-focused-final-send-check-count={focusedFinalMailSendReviewItems.length}
              data-mailops-focused-final-send-check-body-source={
                focusedMailOpsWorkQueueReview?.revisedDraft ? "work_queue_revised_draft" : "mail_work_review_or_candidate"
              }
              data-mailops-focused-final-send-check-external-mutation="false"
            >
              <header>
                <span>발송 직전 확인</span>
                <strong>수신자, 참조, 제목, 본문, 첨부, 위험 표현, 일정 등록 여부를 한 번에 확인합니다</strong>
                <small>메일 발송과 캘린더 등록은 사용자 마지막 확인 전까지 각각 잠겨 있습니다.</small>
              </header>
              <ol>
                {focusedFinalMailSendReviewItems.map((item) => (
                  <li
                    key={`focused-final-mail-send-review-${item.id}`}
                    data-mailops-focused-final-send-check-row={item.id}
                    data-state={item.state}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {focusedFinalExecutionHandoffItems.length ? (
            <section
              className={styles.focusedFinalExecutionHandoff}
              role="group"
              aria-label="포커스된 최종 확인 실행 로그 연결"
              data-focused-final-execution-handoff="confirm_phrase_execute_log_manual_memory"
              data-focused-final-confirm-phrase={finalConfirmation.confirmPhrase}
              data-focused-final-required-field-count={finalConfirmation.requiredFields.length}
              data-focused-final-adapter-connected={finalConfirmation.adapterConnected ? "true" : "false"}
              data-focused-final-dry-run-status={focusedFinalDryRun?.status ?? "not_started"}
              data-focused-final-execution-status={focusedFinalExecution?.status ?? "not_started"}
              data-focused-final-memory-policy="manual_next_time_only"
              data-focused-final-mail-coverage="classify_reply_draft_edit_approve_send_check"
              data-focused-final-execution-external-mutation="false"
              data-focused-final-live-adapter-plan-contract={
                finalConfirmation.finalExecutionGate?.liveAdapterPlanContract ?? "not_mail_send"
              }
              data-focused-final-live-adapter-selected={
                finalConfirmation.finalExecutionGate?.liveAdapterSelectedId ?? "not_selected"
              }
              data-focused-final-live-adapter-dispatch-status={
                finalConfirmation.finalExecutionGate?.liveAdapterDispatchStatus ?? "not_mail_send"
              }
              data-focused-final-live-adapter-proof-chain={
                finalConfirmation.finalExecutionGate?.liveAdapterProofChain ?? "not_mail_send"
              }
              data-focused-final-live-adapter-recovery-state={focusedFinalLiveAdapterRecovery?.state ?? "review"}
              data-focused-final-live-adapter-recovery-action={focusedFinalLiveAdapterRecovery?.actionLabel ?? "연결 확인"}
            >
              <header>
                <span>실행 전 마지막 연결</span>
                <strong>확인 문구와 실행 전 검토값이 맞아야 실제 실행 요청으로 넘어갑니다.</strong>
                <small>
                  {focusedFinalLiveAdapterRecovery?.label ||
                    "메일 선별, 초안 수정, 승인 발송, 실행 로그, 다음부터 이렇게 제안을 한 줄로 확인합니다."}
                </small>
              </header>
              <ol>
                {focusedFinalExecutionHandoffItems.map((step) => (
                  <li key={`focused-final-execution-handoff-${step.id}`} data-state={step.state}>
                    <span>{step.label}</span>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {focusedApprovedMailRunwayItems.length ? (
            <section
              className={styles.focusedApprovedMailRunway}
              role="group"
              aria-label="포커스된 승인 메일 실행 전 경로"
              data-focused-final-approved-mail-runway="approved_work_queue_to_final_confirmation_to_dry_run_to_execution_log"
              data-focused-final-approved-route={focusedMailOpsWorkQueueReview?.finalConfirmationRoute ?? "missing"}
              data-focused-final-approved-decision={focusedMailOpsWorkQueueReview?.decision ?? "missing"}
              data-focused-final-mail-send-approval-gate-status={focusedMailSendApprovalGateStatus}
              data-focused-final-mail-send-approval-gate-policy={focusedMailSendApprovalGatePolicy}
              data-focused-final-approved-dry-run-required="true"
              data-focused-final-approved-execution-log-status={
                focusedFinalExecution?.status ?? focusedFinalDryRun?.status ?? "not_started"
              }
              data-focused-final-approved-external-mutation="false"
            >
              <header>
                <span>승인된 메일 실행 경로</span>
                <strong>답장할 메일만 최종 확인, 실행 전 검토, 실행 로그 순서로 보냅니다.</strong>
              <small>
                보류/제외 메일과 수정이 필요한 메일은 이 경로에서 실제 발송하지 않습니다. 승인 게이트:{" "}
                {focusedMailSendApprovalGateStatus}
              </small>
            </header>
            <p>
              승인된 메일 실행 경로 · 작업함 승인 기록 · 마지막 확인 · 실행 전 검토 · 실행 로그. 답장할 메일만 최종 확인, 실행 전
              검토, 실행 로그 순서로 보냅니다.
            </p>
            <ol>
                {focusedApprovedMailRunwayItems.map((step) => (
                  <li key={`focused-approved-mail-runway-${step.id}`} data-state={step.state}>
                    <span>{step.label}</span>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <dl>
            <div data-state={finalConfirmation.adapterConnected ? "ready" : "locked"}>
              <dt>연결</dt>
              <dd>
                <strong>{finalConfirmation.adapterConnected ? "연결됨" : "연결 필요"}</strong>
                <small>
                  {finalConfirmation.finalExecutionGate?.liveAdapterOneLineLabel ||
                    finalConfirmation.adapter.userMessage ||
                    finalConfirmation.adapter.connectLabel}
                </small>
              </dd>
            </div>
            <div data-state="review">
              <dt>확인할 일</dt>
              <dd>
                <strong>{finalConfirmation.checklist[0] ?? "체크리스트 확인"}</strong>
                <small>{finalConfirmation.checklist.length}개 항목 · 실행 전 검토 필요</small>
              </dd>
            </div>
            <div data-state="locked">
              <dt>실행 잠금</dt>
              <dd>
                <strong>마지막 확인 전 실행 안 함</strong>
                <small>{finalConfirmation.blockedReason || "발송·등록·공유는 마지막 확인 전까지 잠겨 있습니다."}</small>
              </dd>
            </div>
          </dl>
          <footer>
            <span>{finalConfirmationMessage || "최종 확인 항목이 준비되었습니다."}</span>
            <small>아래 실행 전 확인 후보에서 검토와 마지막 확인을 차례로 진행합니다.</small>
            <nav className={styles.focusedFinalActionActions} aria-label="포커스된 최종 확인 다음 행동">
              <a href={finalConfirmationConnectHref(finalConfirmation)}>
                {finalConfirmationConnectActionLabel(finalConfirmation)}
              </a>
              {focusedFinalActionCandidate ? (
                <button
                  type="button"
                  onClick={() => onPrepareFinalConfirmation?.(focusedFinalActionCandidate)}
                  disabled={!onPrepareFinalConfirmation || preparingFinalActionId === focusedFinalActionCandidate.id}
                >
                  {preparingFinalActionId === focusedFinalActionCandidate.id
                    ? "확인 중"
                    : finalConfirmation.adapterConnected
                      ? "연결 상태 다시 확인"
                      : "연결 후 다시 확인"}
                </button>
              ) : null}
              <a href="#final-action-candidates">실행 전 확인 후보 보기</a>
            </nav>
          </footer>
        </section>
      ) : null}

      <section
        id="final-action-candidates"
        tabIndex={-1}
        className={styles.finalActionPanel}
        aria-label="실행 전 확인 후보"
        data-final-action-count={finalActionCandidates.length}
        data-final-action-disclosure="first_one_then_more_inside_details"
        data-final-action-visible-count={visibleFinalActionCandidates.length}
        data-final-action-hidden-count={hiddenFinalActionCandidates.length}
        data-final-action-visible-limit={approvalCandidateVisibleLimit}
        data-final-action-mobile-default="summary_details_actions_first_evidence_after_open"
      >
        <header>
          <div>
            <span>실행 전 확인</span>
            <strong>
              {finalActionCandidates.length
                ? `${finalActionCandidates.length}개 실행 직전 확인`
                : "실행 후보 대기"}
            </strong>
          </div>
          <small>AI 팀원이 준비한 발송·등록·공유는 여기서 다시 확인한 뒤에만 진행됩니다</small>
        </header>
        {finalActionCandidates.some((item) => item.id.includes("mock")) ? (
          <p className={styles.finalActionPanelNotice}>미리보기 모드 최종 실행 후보: 실제 외부 발송 없이 승인 전 확인 UI를 검증합니다.</p>
        ) : finalConfirmationMessage ? (
          <p className={styles.finalActionPanelNotice}>{finalConfirmationMessage}</p>
        ) : null}
        <details
          className={styles.officeExecutionBoundaryFold}
          aria-label="실행 전 확인 기준 더 보기"
          data-office-execution-boundary-fold="summary_first_steps_on_demand"
          data-office-execution-boundary-default="closed"
        >
          <summary>
            <span>기준</span>
            <strong>실행 전 확인 경계</strong>
          </summary>
          <ol className={styles.officeExecutionBoundaryRail} aria-label="오피스 실행 전 확인 경계">
            {officeExecutionBoundaryItems.map((item) => (
              <li key={`final-${item.id}`} data-state={item.state}>
                <span>{item.label}</span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </li>
            ))}
          </ol>
        </details>
        {finalActionCandidates.length ? (
          <>
          <ol data-final-action-primary-list="first_one">
            {visibleFinalActionCandidates.map((item) => {
              const confirmation = finalConfirmation?.workItemId === item.id ? finalConfirmation : null;
              const dryRun = finalDryRunWorkItemId === item.id ? finalDryRun : null;
              const dryRunReady =
                dryRun?.status === "final_action_dry_run_ready" && Boolean(dryRun.dryRun);
              const execution = finalExecutionWorkItemId === item.id ? finalExecution : null;
              // 이미 보낸 카드는 다시 보낼 수 없게 버튼을 잠그고 '보냈어요'로 보여 줍니다(이중 발송 방지).
              const finalActionAlreadySent = isFinalActionSentForOffice(item, execution);
              const approvalReviewItems = buildFinalActionApprovalReview({ item, confirmation, dryRun, execution });
              const finalActionAuditReceipts = buildFinalActionAuditReceipts({ item, confirmation, dryRun, execution });
              const finalActionUserSteps = buildFinalActionUserSteps({ item, confirmation, dryRun, dryRunReady, execution, finalConfirmationMessage });
              const browserProgressSteps = buildBrowserTaskProgressSteps(item);
              const browserDecisionRail = buildBrowserTaskDecisionRail(item);
              const browserTaskResultReceipts = buildBrowserTaskResultReceipts(item);
              const nextBrowserAction = browserTaskNextActionCapability(item);
              const nextUserChoice = officeNextUserChoiceForWorkItem(item);
              const browserActionRunning = Boolean(
                nextBrowserAction && runningBrowserTaskActionId === `${item.id}:${nextBrowserAction.capability}`,
              );
              const readinessGuide = finalActionReadinessGuide(item);
              const memorySearchGuide = buildMemorySearchFinalActionSourceGuide(item);
              const bulkRecipientListGuide = buildBulkRecipientListGuide(item);
              const mailOpsQueueReview = mailOpsWorkQueueReviewForWorkItem(item);
              const mailThreadRecipientGuide = buildMailThreadRecipientGuide(item);
              const mailWorkReviewGuide = buildMailWorkReviewGuide(item);
              const userComposedMailReview = item.sourceEvidence?.userComposedMailReview;
              const mailSendApprovalGate = item.finalAction?.mailSendApprovalGate;
              const finalLiveAdapterRecovery = confirmation ? finalExecutionGateRecoveryPlan(confirmation) : null;
              const finalLiveAdapterMutationOnConfirm =
                confirmation?.finalExecutionGate?.liveAdapterExternalMutationOnConfirm ||
                finalLiveAdapterRecovery?.state === "ready";
              const mailSendApprovalGateStatus =
                execution?.finalExecutionGate?.mailSendApprovalGateStatus ||
                dryRun?.finalExecutionGate?.mailSendApprovalGateStatus ||
                confirmation?.finalExecutionGate?.mailSendApprovalGateStatus ||
                mailSendApprovalGate?.decision ||
                "not_required";
              const mailSendApprovalGatePolicy =
                execution?.finalExecutionGate?.mailSendApprovalGatePolicy ||
                dryRun?.finalExecutionGate?.mailSendApprovalGatePolicy ||
                confirmation?.finalExecutionGate?.mailSendApprovalGatePolicy ||
                mailSendApprovalGate?.policy ||
                "not_required";
              const channelDecisionFinalContext = buildChannelDecisionFinalContext({ item, confirmation });
              const channelDecisionProofSteps = buildChannelDecisionProofSteps(channelDecisionFinalContext);
              const shouldShowUserComposedMailReview =
                isUserComposedMailReviewItem(item) && Boolean(userComposedMailReview?.reviewItems?.length);
              const userComposedMailRunwayItems =
                shouldShowUserComposedMailReview && userComposedMailReview
                  ? [
                      {
                        id: "check_result",
                        label: "내용 점검",
                        title: userComposedMailReview.readinessLabel || "작성 메일 점검",
                        detail: "수신자, 제목, 본문, 첨부, 위험 표현, 일정 영향까지 먼저 확인합니다.",
                        state: userComposedMailReview.reviewItems?.every((review) => review.state === "ok") ? "ready" : "review",
                      },
                      {
                        id: "edit_suggestion",
                        label: "수정 제안",
                        title: "수정 후 승인 후보",
                        detail: userComposedMailReview.revisionSuggestion || "필요한 수정을 반영한 뒤 승인 후보로 넘깁니다.",
                        state: userComposedMailReview.reviewItems?.some((review) => review.state !== "ok") ? "review" : "ready",
                      },
                      {
                        id: "approval_candidate",
                        label: "승인 후보",
                        title: "사용자가 고른 뒤에만 진행",
                        detail: userComposedMailReview.approvalGate || "사용자 최종 확인 전 외부 발송 없음",
                        state: "locked",
                      },
                      {
                        id: "final_dry_run",
                        label: "마지막 확인",
                        title: dryRun ? dryRunStatusLabel(dryRun.status) : "실행 전 검토 대기",
                        detail:
                          dryRun?.dryRun?.executionPlan.summary ||
                          "메일 연결, 수신자, 참조, 본문, 첨부를 dry-run으로 다시 확인합니다.",
                        state: dryRun?.status === "final_action_dry_run_ready" ? "ready" : "review",
                      },
                      {
                        id: "execution_log",
                        label: "실행 로그",
                        title: execution ? executionStatusLabel(execution.status) : "최종 확인 전 로그 대기",
                        detail: execution?.auditId
                          ? `실행 감사 기록 ${execution.auditId}`
                          : "실제 발송 요청 뒤 감사 기록과 되돌리기 기준을 남깁니다.",
                        state: execution ? "ready" : "locked",
                      },
                    ]
                  : [];
              const finalDryRunRecipientDecision = dryRun?.dryRun?.executionPlan.recipientDecision;
              const finalDryRunSafetyChecks = dryRun?.dryRun?.executionPlan.safetyChecks ?? [];
              const finalDryRunReviewedDraft = dryRun?.dryRun?.executionPlan
                ? {
                    bodySource: dryRun.dryRun.executionPlan.bodySource || "",
                    bodyPreview: dryRun.dryRun.executionPlan.bodyPreview || "",
                    reviewNote: dryRun.dryRun.executionPlan.reviewNote || "",
                    sendCheckSummary: dryRun.dryRun.executionPlan.sendCheckSummary || "",
                  }
                : null;
              const shouldShowFinalDryRunReviewedDraft = Boolean(
                finalDryRunReviewedDraft &&
                  (finalDryRunReviewedDraft.bodyPreview ||
                    finalDryRunReviewedDraft.reviewNote ||
                    finalDryRunReviewedDraft.sendCheckSummary),
              );
              const executionLogFocusIsDecisionReceipt =
                executionLogFocus?.proofChain === "approval_decision_receipt_log_memory_next";
              const executionLogFocused = Boolean(
                executionLogFocus &&
                  (
                    (executionLogFocus.workItemId && executionLogFocus.workItemId === item.id) ||
                    executionLogFocus.auditId === execution?.auditId ||
                    executionLogFocus.auditId === dryRun?.auditId ||
                    executionLogFocus.dryRunAuditId === dryRun?.auditId
                  ),
              );
              const finalActionDetailsOpen = Boolean(executionLogFocused || confirmation);
              const canRecordFinalActionDecision =
                Boolean(onRecordMailOpsDecision) &&
                (item.finalAction?.kind === "send_email" ||
                  item.finalAction?.kind === "send_bulk_email" ||
                  item.finalAction?.kind === "create_calendar_event" ||
                  Boolean(item.browserTask) ||
                  Boolean(item.localFile));
              const finalActionCompactSummary = `${officeUserFacingSourceLabel(item.sourceLabel || "업무 카드")} · ${item.finalAction?.label ?? "실행 전 확인"} · ${
                item.finalAction?.readiness === "ready_for_final_confirmation" ? "연결 확인" : "연결 필요"
              }`;
              const finalActionDetailSummary = `${item.finalAction?.blockedReason || item.summary} · 막히면: ${nextUserChoice}`;
              const separatedFinalActionKind = separatedMailOpsFinalActionKind(item);
              const separatedFinalAction = separatedMailOpsFinalActionCopy(item);
              const attachmentDownloadReview = mailAttachmentDownloadReviewInfo(item);
              const finalApprovalCommitItems = [
                {
                  id: "approve_subject",
                  label: "승인 대상",
                  title: item.finalAction?.label ?? "실행 전 확인",
                  detail: item.title,
                  state: confirmation ? "ready" : "review",
                },
                {
                  id: "dry_run",
                  label: "실행 전 검토",
                  title: dryRunReady ? "검토 완료" : "검토 필요",
                  detail: dryRun?.auditId ? `감사 기록 ${dryRun.auditId}` : "dry-run 기록 전까지 실제 실행 잠금",
                  state: dryRunReady ? "ready" : "locked",
                },
                {
                  id: "final_button",
                  label: "최종 버튼",
                  title: dryRunReady ? "마지막 확인 가능" : "마지막 확인 잠김",
                  detail: dryRunReady ? "마지막 확인 버튼으로 실행 조건을 다시 점검" : "실행 전 검토 뒤에만 버튼 활성화",
                  state: dryRunReady ? "ready" : "locked",
                },
                {
                  id: "log_rollback",
                  label: "로그/되돌림",
                  title: execution?.auditId ? "실행 기록 있음" : "실행 전 기록 대기",
                  detail: execution?.auditId
                    ? `감사 기록 ${execution.auditId}`
                    : finalActionAuditReceipts.find((receipt) => receipt.id === "rollback")?.detail || "외부 변경 전이라 되돌릴 실행 없음",
                  state: execution?.auditId ? "ready" : "review",
                },
              ];
              return (
                <li
                  key={item.id}
                  className={executionLogFocused ? styles.finalActionFocusedByLog : undefined}
                  tabIndex={executionLogFocused ? -1 : undefined}
                  data-final-action-work-item-id={item.id}
                  data-readiness={item.finalAction?.readiness}
                  data-final-action-card-contract="risk_preview_final_confirmation_log_rollback"
                  data-approval-decision-options="approve_cancel_change_hold"
                  data-final-confirmation-policy="required_before_external_mutation"
                  data-execution-log-policy="dry_run_then_audit_receipt"
                  data-rollback-policy="guide_before_or_after_execution"
                  data-mail-send-approval-gate-status={mailSendApprovalGateStatus}
                  data-mail-send-approval-gate-policy={mailSendApprovalGatePolicy}
                  data-office-execution-log-focused={executionLogFocused ? "true" : "false"}
                  data-office-execution-log-focus-audit-id={executionLogFocused ? executionLogFocus?.auditId ?? "" : ""}
                  data-next-user-choice={nextUserChoice}
                  data-mailops-final-action-separated-kind={separatedFinalActionKind}
                  data-mailops-final-action-separated-contract="calendar_event_and_mail_attachment_folder_plan_have_distinct_final_confirmation_cards"
                  data-final-action-row-compact="status_title_action_only_details_inside"
                  data-final-action-row-compact-summary={finalActionCompactSummary}
                  data-final-action-mobile-default="summary_details_actions_first_evidence_after_open"
                >
                  <span>{finalActionLabel(item.finalAction?.kind)}</span>
                  <div
                    className={styles.finalActionRowMain}
                    aria-label={`${item.title} 실행 전 확인 한 줄 요약`}
                    data-final-action-row-main="one_line_summary_details_collapsed"
                  >
                    <strong>{item.title}</strong>
                    <small>{finalActionCompactSummary}</small>
                    <MailCardTriageLine
                      item={item}
                      teammates={cardAssigneeTeammates}
                      changing={changingCardAssigneeId === item.id}
                      notice={cardAssigneeNotice?.workItemId === item.id ? cardAssigneeNotice.message : ""}
                      onChangeAssignee={onChangeCardAssignee}
                    />
                  </div>
                  <details
                    key={confirmation?.id || item.id}
                    className={styles.finalActionRowDetails}
                    aria-label={`${item.title} 실행 전 확인 상세`}
                    data-final-action-row-details="readiness_review_preview_audit_collapsed"
                    data-final-action-row-details-external-mutation="false"
                    data-final-action-row-details-default="closed_until_user_opens"
                    open={finalActionDetailsOpen}
                  >
                    <summary>
                      <span>상세 보기</span>
                      <small>연결, 검토, 미리보기, 실행 로그</small>
                    </summary>
                    <p>{finalActionDetailSummary}</p>
                    {mailOpsQueueReview ? (
                      <section
                        className={styles.mailOpsFinalActionReviewContext}
                        aria-label={`${item.title} 작업함 검토 컨텍스트`}
                        data-mailops-final-review-context={mailOpsQueueReview.approvalContext}
                        data-mailops-final-review-decision={mailOpsWorkQueueDecisionLabel(mailOpsQueueReview.decision)}
                        data-mailops-final-review-external-mutation="false"
                      >
                        <span>작업함 검토</span>
                        <div>
                          <strong>{mailOpsWorkQueueDecisionLabel(mailOpsQueueReview.decision)}</strong>
                          <small>
                            {mailOpsQueueReview.note
                              ? `수정 메모: ${mailOpsQueueReview.note}`
                              : "수정 메모 없음 · 최종 확인 전 외부 실행 없음"}
                          </small>
                        </div>
                        <em>최종 확인 전 발송 없음</em>
                      </section>
                    ) : null}
                    {mailSendApprovalGate && item.finalAction?.kind === "send_email" ? (
                      <section
                        className={styles.mailOpsFinalActionReviewContext}
                        aria-label={`${item.title} 메일 발송 승인 게이트`}
                        data-mail-send-approval-gate="approved_mail_work_queue_or_user_composed_check_before_live_send"
                        data-mail-send-approval-gate-status={mailSendApprovalGateStatus}
                        data-mail-send-approval-gate-policy={mailSendApprovalGatePolicy}
                        data-mail-send-approval-gate-route={mailSendApprovalGate.finalRoute ?? "missing"}
                        data-mail-send-approval-gate-external-mutation="false"
                      >
                        <span>메일 발송 승인 게이트</span>
                        <div>
                          <strong>
                            {mailSendApprovalGate.decision === "approve" && mailSendApprovalGate.finalRoute === "included"
                              ? "승인된 항목만 발송 후보"
                              : "승인 전 발송 후보 잠금"}
                          </strong>
                          <small>
                            여러 메일 중 답장할 메일만 포함하고, 보류/제외/수정 필요 항목은 실제 발송 경로에서 제외합니다.
                          </small>
                        </div>
                        <em>실제 발송 전 외부 변경 없음</em>
                      </section>
                    ) : null}
                    {separatedFinalAction ? (
                      <section
                        className={styles.mailOpsFinalActionReviewContext}
                        aria-label={`${item.title} 일정 첨부 분리 최종 확인`}
                        data-mailops-separated-final-action={separatedFinalActionKind}
                        data-mailops-separated-final-action-contract="separate_calendar_registration_from_attachment_folder_plan_before_mutation"
                        data-mailops-separated-final-action-external-mutation="false"
                      >
                        <span>{separatedFinalAction.label}</span>
                        <div>
                          <strong>{separatedFinalAction.title}</strong>
                          <small>{separatedFinalAction.detail}</small>
                        </div>
                        <em>{separatedFinalAction.lockLabel}</em>
                      </section>
                    ) : null}
                    {attachmentDownloadReview ? (
                      <section
                        className={styles.mailOpsFinalActionReviewContext}
                        aria-label={`${item.title} 메일 첨부 다운로드 승인 연결`}
                        data-mail-attachment-download-review="approval_required_before_download"
                        data-mail-attachment-folder-plan-handoff={attachmentDownloadReview.handoffKind}
                        data-mail-attachment-original-policy="mail_original_unchanged"
                        data-mail-attachment-external-share="false_before_final_confirmation"
                      >
                        <span>첨부 다운로드</span>
                        <div>
                          <strong>{attachmentDownloadReview.title}</strong>
                          <small>{attachmentDownloadReview.detail}</small>
                          <div className={styles.officeExecutionLogRecoveryActions}>
                            <button
                              type="button"
                              onClick={() => onStageMailAttachmentFolderPlan?.(item)}
                              disabled={!onStageMailAttachmentFolderPlan || runningFolderPlanActionId === item.id}
                            >
                              {runningFolderPlanActionId === item.id ? "준비 중" : "다운로드 후 승인 카드"}
                            </button>
                          </div>
                        </div>
                        <em>{attachmentDownloadReview.lockLabel}</em>
                      </section>
                    ) : null}
                    {executionLogFocused && executionLogFocus ? (
                      <section
                        className={styles.officeExecutionLogFocus}
                        aria-label={`${item.title} 가상오피스 실행 차단 로그 상세`}
                        data-office-execution-log-focus={executionLogFocusIsDecisionReceipt ? "virtual_office_decision_receipt" : "virtual_office_final_gate"}
                        data-office-execution-log-audit-id={executionLogFocus.auditId}
                        data-office-execution-log-dry-run-id={executionLogFocus.dryRunAuditId}
                        data-office-execution-log-proof-chain={executionLogFocus.proofChain}
                        data-office-execution-log-source-event-id={executionLogFocus.sourceEventId}
                        data-office-execution-log-mailops-review-context={executionLogFocus.mailOpsQueueReviewContext ?? ""}
                        data-office-execution-log-mailops-review-decision={executionLogFocus.mailOpsQueueReviewDecision ?? ""}
                        data-office-execution-log-mailops-engine-handoff={executionLogFocus.mailOpsWorkQueueEngineHandoff ?? ""}
                        data-office-execution-log-mailops-engine-path={executionLogFocus.mailOpsWorkQueueEnginePath ?? ""}
                        data-office-execution-log-mailops-approval-gate={executionLogFocus.mailOpsWorkQueueApprovalGate ?? ""}
                        data-office-execution-log-mailops-automation-proof={executionLogFocus.mailOpsWorkQueueAutomationProof ?? ""}
                        data-office-execution-log-external-mutation="false"
                      >
                        <span>가상오피스에서 온 로그</span>
                        <div>
                          <strong>{executionLogFocusIsDecisionReceipt ? "승인 결정이 실행 로그에 기록됐습니다" : "실제 실행 게이트가 차단됐습니다"}</strong>
                          <small>{executionLogFocus.proofChain || "dry-run 이후 live 실행 게이트 확인"}</small>
                        </div>
                        <dl>
                          <div>
                            <dt>{executionLogFocusIsDecisionReceipt ? "결정 영수증 로그" : "실행 차단 감사 로그"}</dt>
                            <dd>{executionLogFocus.auditId}</dd>
                          </div>
                          <div>
                            <dt>{executionLogFocusIsDecisionReceipt ? "선택 후보" : "dry-run 감사 로그"}</dt>
                            <dd>{executionLogFocus.dryRunAuditId || "기록 대기"}</dd>
                          </div>
                          <div>
                            <dt>게이트 상태</dt>
                            <dd>
                              {executionLogFocusIsDecisionReceipt
                                ? "최종 확인 전 외부 실행 없음"
                                : executionStatusLabel(executionLogFocus.executionGateStatus)}
                            </dd>
                          </div>
                          <div>
                            <dt>되돌리기</dt>
                            <dd>{executionLogFocus.rollbackLabel || "외부 변경 없음"}</dd>
                          </div>
                          {executionLogFocus.mailOpsQueueReviewContext || executionLogFocus.mailOpsWorkQueueAutomationProof ? (
                            <>
                              <div>
                                <dt>작업함 결정</dt>
                                <dd>{executionLogFocus.mailOpsQueueReviewDecision || "검토 기록 없음"}</dd>
                              </div>
                              <div>
                                <dt>자동화 엔진 증거</dt>
                                <dd>{executionLogFocus.mailOpsWorkQueueAutomationProof || "작업함 결정 기록 대기"}</dd>
                              </div>
                            </>
                          ) : null}
                        </dl>
                        {executionLogFocus.mailOpsQueueReviewNote ? (
                          <p>작업함 메모: {executionLogFocus.mailOpsQueueReviewNote}</p>
                        ) : null}
                        <div
                          className={styles.officeExecutionLogRecovery}
                          data-office-execution-log-recovery="reason_action_resume"
                        >
                          <div>
                            <strong>막힌 이유</strong>
                            <small>
                              {executionLogFocusIsDecisionReceipt
                                ? "이 로그는 승인함에서 고른 결정만 기록합니다. 실제 발송/등록은 마지막 확인 전까지 실행하지 않았습니다."
                                : "실제 발송/등록을 수행할 live 실행 승인이 없어서 외부 변경 없이 멈췄습니다. 다시 이어가려면 실행 전 검토를 갱신하거나 마지막 확인을 다시 준비하세요."}
                            </small>
                          </div>
                          <div className={styles.officeExecutionLogRecoveryActions}>
                            <button
                              type="button"
                              data-office-log-recovery-action="rerun_dry_run"
                              onClick={() => onRunFinalActionDryRun?.(item)}
                              disabled={!onRunFinalActionDryRun || runningDryRunActionId === item.id}
                            >
                              {runningDryRunActionId === item.id ? "검토 중" : "실행 전 검토 다시"}
                            </button>
                            <button
                              type="button"
                              data-office-log-recovery-action="prepare_final_confirmation"
                              onClick={() => onPrepareFinalConfirmation?.(item)}
                              disabled={!onPrepareFinalConfirmation || preparingFinalActionId === item.id}
                            >
                              {preparingFinalActionId === item.id ? "준비 중" : "마지막 확인 다시 준비"}
                            </button>
                          </div>
                        </div>
                      </section>
                    ) : null}
                    <section
                      className={styles.finalActionReadinessGuide}
                      data-state={readinessGuide.state}
                      aria-label={`${item.title} 연결과 최종 확인 상태`}
                    >
                      <span>{readinessGuide.label}</span>
                      <div>
                        <strong>{readinessGuide.title}</strong>
                        <small>{readinessGuide.detail}</small>
                      </div>
                      <em>{readinessGuide.nextAction}</em>
                    </section>
                    {memorySearchGuide ? (
                      <section
                        className={styles.memorySearchFinalActionSource}
                        data-state={memorySearchGuide.state}
                        aria-label={`${item.title} 지난 업무 출처와 승인 경계`}
                      >
                        <span>지난 업무 근거</span>
                        <div>
                          <strong>{memorySearchGuide.resultKind}</strong>
                          <small>{memorySearchGuide.safetyLabel}</small>
                        </div>
                        <dl>
                          <div>
                            <dt>출처</dt>
                            <dd>{memorySearchGuide.sourcePath}</dd>
                          </div>
                          <div>
                            <dt>초안 미리보기</dt>
                            <dd>{memorySearchGuide.draftPreview}</dd>
                          </div>
                          <div>
                            <dt>다음 선택</dt>
                            <dd>{memorySearchGuide.nextUserChoice}</dd>
                          </div>
                        </dl>
                      </section>
                    ) : null}
                    {bulkRecipientListGuide ? (
                      <section
                        className={styles.bulkRecipientListGuide}
                        data-state={bulkRecipientListGuide.state}
                        aria-label={`${item.title} 대량 메일 명단 근거`}
                      >
                        <span>명단 근거</span>
                        <div>
                          <strong>{bulkRecipientListGuide.recipientSummary}</strong>
                          <small>{bulkRecipientListGuide.exceptionSummary}</small>
                        </div>
                        <dl>
                          <div>
                            <dt>원천</dt>
                            <dd>{bulkRecipientListGuide.sourceLabel}</dd>
                          </div>
                          <div>
                            <dt>대상 그룹</dt>
                            <dd>{bulkRecipientListGuide.groupSummary}</dd>
                          </div>
                          <div>
                            <dt>추천 대상</dt>
                            <dd>{bulkRecipientListGuide.recommendationSummary}</dd>
                          </div>
                          <div>
                            <dt>수정 반영</dt>
                            <dd>{bulkRecipientListGuide.decisionOverrideSummary}</dd>
                          </div>
                          <div>
                            <dt>최종 후보</dt>
                            <dd>{bulkRecipientListGuide.effectiveRecipientSummary}</dd>
                          </div>
                          <div>
                            <dt>수정 출처</dt>
                            <dd>{bulkRecipientListGuide.decisionOverrideSourceSummary}</dd>
                          </div>
                          <div>
                            <dt>수정 이력</dt>
                            <dd>{bulkRecipientListGuide.decisionOverrideHistorySummary}</dd>
                          </div>
                          <div>
                            <dt>되돌림 기준</dt>
                            <dd>{bulkRecipientListGuide.decisionOverrideRollbackSummary}</dd>
                          </div>
                          <div>
                            <dt>발송 추천</dt>
                            <dd>{bulkRecipientListGuide.sendDecisionSummary}</dd>
                          </div>
                          <div>
                            <dt>샘플 준비</dt>
                            <dd>{bulkRecipientListGuide.readinessSummary}</dd>
                          </div>
                          <div>
                            <dt>보류 대상</dt>
                            <dd>{bulkRecipientListGuide.holdDecisionSummary}</dd>
                          </div>
                          <div>
                            <dt>제외 대상</dt>
                            <dd>{bulkRecipientListGuide.excludeDecisionSummary}</dd>
                          </div>
                          <div>
                            <dt>학습 판단</dt>
                            <dd>{bulkRecipientListGuide.learningDecisionSummary}</dd>
                          </div>
                          <div>
                            <dt>제외 규칙</dt>
                            <dd>{bulkRecipientListGuide.exclusionRuleSummary}</dd>
                          </div>
                          <div>
                            <dt>제외 사유</dt>
                            <dd>{bulkRecipientListGuide.exclusionReasonSummary}</dd>
                          </div>
                          <div>
                            <dt>그룹 샘플</dt>
                            <dd>{bulkRecipientListGuide.groupSampleSummary}</dd>
                          </div>
                          <div>
                            <dt>개인화 누락</dt>
                            <dd>{bulkRecipientListGuide.personalizationGapSummary}</dd>
                          </div>
                          <div>
                            <dt>다음 검토</dt>
                            <dd>{bulkRecipientListGuide.nextReviewFocus}</dd>
                          </div>
                          <div>
                            <dt>저장된 기준</dt>
                            <dd>{bulkRecipientListGuide.learningProfileSummary}</dd>
                          </div>
                          <div>
                            <dt>학습 대상</dt>
                            <dd>{bulkRecipientListGuide.learnedTargetSummary}</dd>
                          </div>
                          <div>
                            <dt>승인 습관</dt>
                            <dd>{bulkRecipientListGuide.learnedApprovalHabitSummary}</dd>
                          </div>
                          <div>
                            <dt>학습 기본 추천</dt>
                            <dd>{bulkRecipientListGuide.learnedDefaultDecisionSummary}</dd>
                          </div>
                          <div>
                            <dt>학습 수정 추천</dt>
                            <dd>{bulkRecipientListGuide.learnedOverrideSuggestionSummary}</dd>
                          </div>
                          <div>
                            <dt>추천 적용</dt>
                            <dd>{bulkRecipientListGuide.learnedOverrideActionSummary}</dd>
                          </div>
                          <div>
                            <dt>샘플</dt>
                            <dd>{bulkRecipientListGuide.sampleSummary}</dd>
                          </div>
                          <div>
                            <dt>개인정보</dt>
                            <dd>{bulkRecipientListGuide.privacyBoundary}</dd>
                          </div>
                        </dl>
                      </section>
                    ) : null}
                    {mailWorkReviewGuide ? (
                      <section
                        className={styles.mailWorkReviewGuide}
                        data-state={mailWorkReviewGuide.state}
                        aria-label={`${item.title} 메일별 검토 근거`}
                        data-mail-work-review="original_draft_recipient_attachment_final_boundary"
                        data-mail-work-review-proof={mailWorkReviewGuide.proof}
                        data-mail-work-review-final-boundary="approved_only_final_confirmation_before_send"
                        data-mail-work-triage-summary={mailWorkReviewGuide.triageSummaryLabel}
                        data-mail-work-triage-important={mailWorkReviewGuide.triageImportantLabel}
                        data-external-mutation="false"
                      >
                        <header>
                          <div>
                            <span>메일별 검토 근거</span>
                            <strong>{mailWorkReviewGuide.replyMethodLabel}</strong>
                            <small>{mailWorkReviewGuide.bundleLabel}</small>
                          </div>
                          <small>{mailWorkReviewGuide.finalApprovalBoundary}</small>
                        </header>
                        <dl>
                          <div>
                            <dt>분류 증거</dt>
                            <dd>{mailWorkReviewGuide.triageSummaryLabel}</dd>
                          </div>
                          <div>
                            <dt>중요 후보</dt>
                            <dd>{mailWorkReviewGuide.triageImportantLabel}</dd>
                          </div>
                          <div>
                            <dt>원문 요약</dt>
                            <dd>{mailWorkReviewGuide.originalSummary}</dd>
                          </div>
                          <div>
                            <dt>초안/후보</dt>
                            <dd>{mailWorkReviewGuide.draftSummary}</dd>
                          </div>
                          <div>
                            <dt>선별 이유</dt>
                            <dd>{mailWorkReviewGuide.sendDecisionReason}</dd>
                          </div>
                          <div>
                            <dt>수정 포인트</dt>
                            <dd>{mailWorkReviewGuide.editFocusLabel}</dd>
                          </div>
                          <div>
                            <dt>다음 확인</dt>
                            <dd>{mailWorkReviewGuide.nextUserAction}</dd>
                          </div>
                          <div>
                            <dt>첨부/링크</dt>
                            <dd>{mailWorkReviewGuide.attachmentSummary}</dd>
                          </div>
                          <div>
                            <dt>개인정보</dt>
                            <dd>{mailWorkReviewGuide.privacyBoundary} {mailWorkReviewGuide.triagePolicyLabel}</dd>
                          </div>
                        </dl>
                        <ul className={styles.mailWorkTriageChips} aria-label={`${item.title} 메일 분류 증거`}>
                          {mailWorkReviewGuide.triageEvidenceChips.map((chip) => (
                            <li key={`${item.id}-triage-chip-${chip}`}>{chip}</li>
                          ))}
                        </ul>
                        {mailWorkReviewGuide.reviewItems.length ? (
                          <ol aria-label={`${item.title} 메일별 검토 체크리스트`}>
                            {mailWorkReviewGuide.reviewItems.map((review) => (
                              <li key={`${item.id}-mail-work-review-${review.id}`} data-state={review.state}>
                                <span>{review.label}</span>
                                <strong>{userComposedMailReviewStateLabel(review.state)}</strong>
                                <small>{review.detail}</small>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                      </section>
                    ) : null}
                    <ol className={styles.finalActionUserSteps} aria-label={`${item.title} 실행 전 확인 3단계`}>
                      {finalActionUserSteps.map((step) => (
                        <li key={`${item.id}-final-step-${step.id}`} data-state={step.state}>
                          <span>{step.label}</span>
                          <div>
                            <strong>{step.title}</strong>
                            <small>{step.detail}</small>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {item.finalAction?.checklist?.length ? (
                      <ul className={styles.finalActionChecklist} aria-label={`${item.title} 실행 전 체크리스트`}>
                        {item.finalAction.checklist.slice(0, 4).map((check) => (
                          <li key={check}>{check}</li>
                        ))}
                      </ul>
                    ) : null}
                    {shouldShowUserComposedMailReview && userComposedMailReview?.reviewItems?.length ? (
                      <section
                        className={styles.userComposedFinalReview}
                        aria-label={`${item.title} 작성 메일 최종 확인 근거`}
                        data-user-composed-final-review="recipient_subject_body_attachment_risk_to_final_confirmation"
                        data-user-composed-final-proof={userComposedMailReview.proof ?? "user_composed_mail_check_result_to_approval_preview"}
                        data-user-composed-final-boundary="review_edit_approve_final_confirmation_before_send"
                        data-user-composed-final-ready={
                          userComposedMailReview.reviewItems.every((review) => review.state === "ok") ? "true" : "false"
                        }
                      >
                        <header>
                          <span>작성 메일 최종 확인 근거</span>
                          <strong>{userComposedMailReview.revisionSuggestion ?? "수정 제안 확인 후 승인 후보로 넘깁니다."}</strong>
                          <small>{userComposedMailReview.approvalGate ?? "사용자 최종 확인 전 외부 발송 없음"}</small>
                          <small>사용자 최종 확인 전 외부 발송 없음</small>
                        </header>
                        <ol>
                          {userComposedMailReview.reviewItems.map((review) => (
                            <li key={`${item.id}-user-composed-final-${review.id ?? review.label}`} data-state={review.state ?? "needs_review"}>
                              <span>{review.label ?? "점검"}</span>
                              <strong>{userComposedMailReviewStateLabel(review.state)}</strong>
                              <small>{review.detail ?? "최종 확인 전 다시 점검합니다."}</small>
                            </li>
                          ))}
                        </ol>
                        {userComposedMailReview.sendReviewItems?.length ? (
                          <section
                            className={styles.userComposedSendReviewRail}
                            aria-label={`${item.title} 작성 메일 발송 전 요약`}
                            data-user-composed-send-review="recipient_cc_bcc_subject_body_attachment_risk_calendar_approval"
                            data-user-composed-send-review-count={userComposedMailReview.sendReviewItems.length}
                            data-user-composed-send-review-external-mutation="false"
                          >
                            <header>
                              <span>발송 전 요약</span>
                              <strong>수신자, 참조, 제목, 본문, 첨부, 위험 표현, 일정 등록 여부를 한 번에 확인합니다</strong>
                              <small>사용자 마지막 확인 전까지 메일 발송과 일정 등록은 계속 잠겨 있습니다.</small>
                            </header>
                            <ol>
                              {userComposedMailReview.sendReviewItems.map((review) => (
                                <li key={`${item.id}-user-composed-send-${review.id ?? review.label}`} data-state={review.state ?? "needs_review"}>
                                  <span>{review.label ?? "점검"}</span>
                                  <strong>{review.title ?? userComposedMailReviewStateLabel(review.state)}</strong>
                                  <small>{review.detail ?? "최종 확인 전 다시 점검합니다."}</small>
                                </li>
                              ))}
                            </ol>
                          </section>
                        ) : null}
                        {userComposedMailRunwayItems.length ? (
                          <section
                            className={styles.userComposedApprovalRunway}
                            aria-label={`${item.title} 작성 메일 발송 경로`}
                            data-user-composed-runway="compose_check_edit_approve_final_confirmation_dry_run_log"
                            data-user-composed-runway-ready={
                              userComposedMailReview.reviewItems?.every((review) => review.state === "ok") ? "true" : "false"
                            }
                            data-user-composed-runway-send-review-count={userComposedMailReview.sendReviewItems?.length ?? 0}
                            data-user-composed-runway-external-mutation="false"
                          >
                            <header>
                              <span>작성 메일 발송 경로</span>
                              <strong>내가 쓴 메일도 점검, 수정, 승인, 마지막 확인 뒤에만 발송합니다.</strong>
                              <small>승인 후보를 만든 것만으로는 메일 발송이나 일정 등록을 실행하지 않습니다.</small>
                            </header>
                            <ol>
                              {userComposedMailRunwayItems.map((step) => (
                                <li key={`${item.id}-user-composed-runway-${step.id}`} data-state={step.state}>
                                  <span>{step.label}</span>
                                  <strong>{step.title}</strong>
                                  <small>{step.detail}</small>
                                </li>
                              ))}
                            </ol>
                          </section>
                        ) : null}
                      </section>
                    ) : null}
                    {channelDecisionFinalContext ? (
                      <section
                        className={styles.channelDecisionFinalContext}
                        aria-label={`${item.title} 휴대폰 결정 마지막 확인 반영`}
                        data-channel-decision-final-context="phone_decision_to_final_confirmation"
                        data-channel-decision-final-state={channelDecisionFinalContext.state}
                        data-channel-decision-final-action={channelDecisionFinalContext.recommendedFinalAction}
                        data-channel-decision-final-target-code={channelDecisionFinalContext.targetCode ?? ""}
                        data-channel-decision-notification-target-match={channelDecisionFinalContext.notificationTargetMatch ? "true" : "false"}
                        data-channel-decision-notification-target-contract={channelDecisionFinalContext.notificationTargetMatchContract ?? ""}
                        data-channel-decision-final-boundary={channelDecisionFinalContext.finalExecutionBoundary}
                        data-channel-decision-mobile-receive={channelDecisionFinalContext.mobileReceiveFilterSummary ?? ""}
                        data-channel-decision-mobile-contract={channelDecisionFinalContext.mobileReceiveFilterContract ?? ""}
                        data-channel-decision-proof-chain="phone_reply_notification_target_channel_record_worker_event_app_final_confirmation_execution_log"
                        data-channel-decision-proof-step-count={channelDecisionProofSteps.length}
                        data-channel-decision-final-external-mutation="false"
                      >
                        <span>{channelDecisionFinalContext.summaryLabel}</span>
                        <strong>{channelDecisionFinalContext.draftInstruction}</strong>
                        <ol
                          className={styles.channelDecisionProofRail}
                          aria-label={`${item.title} 휴대폰 결정 증거 흐름`}
                          data-channel-decision-proof-rail="phone_reply_notification_target_channel_record_worker_event_app_final_confirmation_execution_log"
                          data-channel-decision-proof-external-mutation="false"
                        >
                          {channelDecisionProofSteps.map((step) => (
                            <li key={`${item.id}-channel-proof-${step.id}`} data-state={step.state}>
                              <span>{step.label}</span>
                              <strong>{step.title}</strong>
                              <small>{step.detail}</small>
                            </li>
                          ))}
                        </ol>
                        <details>
                          <summary>{channelDecisionFinalContext.approvalInboxRouteLabel}</summary>
                          {channelDecisionFinalContext.mobileReceiveFilterSummary ? (
                            <p>휴대폰 수신 유형: {channelDecisionFinalContext.mobileReceiveFilterSummary}</p>
                          ) : null}
                          {channelDecisionFinalContext.notificationTargetMatchLabel ? (
                            <p>대상 고정: {channelDecisionFinalContext.notificationTargetMatchLabel}</p>
                          ) : null}
                          <p>{channelDecisionFinalContext.finalExecutionBoundary}</p>
                          <small>{channelDecisionFinalContext.workerEventLabel}</small>
                          {channelDecisionFinalContext.revisionInstruction ? (
                            <em>{channelDecisionFinalContext.revisionInstruction}</em>
                          ) : null}
                        </details>
                      </section>
                    ) : null}
                    <ol className={styles.finalApprovalReviewGrid} aria-label={`${item.title} 승인 전 확인`}>
                      {approvalReviewItems.map((review) => (
                        <li key={`${item.id}-${review.id}`} data-state={review.state}>
                          <span>{review.label}</span>
                          <strong>{review.title}</strong>
                          <small>{review.detail}</small>
                        </li>
                      ))}
                    </ol>
                    <dl className={styles.finalActionAuditReceipt} aria-label={`${item.title} 카드 내부 실행 결과와 되돌리기 기준`}>
                      {finalActionAuditReceipts.map((receipt) => (
                        <div key={`${item.id}-receipt-${receipt.id}`} data-state={receipt.state}>
                          <dt>{receipt.label}</dt>
                          <dd>
                            <strong>{receipt.title}</strong>
                            <small>{receipt.detail}</small>
                            <code>{officeMemoryReferenceLabel(receipt.recordPath)}</code>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {browserTaskResultReceipts.length ? (
                      <dl
                        className={styles.browserTaskResultReceipt}
                        aria-label={`${item.title} 카드 내부 내 PC 작업 결과와 되돌리기 기준`}
                      >
                        {browserTaskResultReceipts.map((receipt) => (
                          <div key={`${item.id}-browser-receipt-${receipt.id}`} data-state={receipt.state}>
                            <dt>{receipt.label}</dt>
                            <dd>
                              <strong>{receipt.title}</strong>
                              <small>{receipt.detail}</small>
                              <code>{officeMemoryReferenceLabel(receipt.recordPath)}</code>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {browserProgressSteps.length ? (
                      <section className={styles.browserTaskProgressRail} aria-label={`${item.title} 내 PC 작업 도우미 다음 단계`}>
                        <header>
                          <span>내 PC 작업 도우미 다음 단계</span>
                          <strong>{browserTaskNextActionLabel(item)}</strong>
                        </header>
                        <ol>
                          {browserProgressSteps.map((step) => (
                            <li key={`${item.id}-${step.id}`} data-state={step.state}>
                              <span>{step.label}</span>
                              <div>
                                <strong>{step.title}</strong>
                                <small>{step.detail}</small>
                              </div>
                            </li>
                          ))}
                        </ol>
                        {browserDecisionRail.length ? (
                          <dl
                            className={styles.browserTaskDecisionRail}
                            aria-label={`${item.title} 실행 취소 로그 되돌리기`}
                            data-computer-use-decision-contract="execute_cancel_log_rollback"
                            data-user-decision-options="execute_cancel_log_rollback"
                            data-final-confirmation-policy="required_before_click_input_file_change"
                            data-execution-log-policy="audit_or_office_receipt"
                            data-rollback-policy="guide_before_or_after_execution"
                          >
                            {browserDecisionRail.map((decision) => (
                              <div key={`${item.id}-decision-${decision.id}`} data-state={decision.state}>
                                <dt>{decision.label}</dt>
                                <dd>
                                  <strong>{decision.title}</strong>
                                  <small>{decision.detail}</small>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                        {nextBrowserAction ? (
                          <footer>
                            <button
                              type="button"
                              onClick={() => onRunBrowserTaskAction?.(item, nextBrowserAction.capability)}
                              disabled={!onRunBrowserTaskAction || browserActionRunning}
                            >
                              {browserActionRunning ? "확인 중" : nextBrowserAction.label}
                            </button>
                            <small>설치 앱에서 읽기/감사 기록부터 진행하고 실제 클릭·입력은 계속 승인 잠금</small>
                          </footer>
                        ) : null}
                      </section>
                    ) : null}
                    {confirmation ? (
                      <div className={styles.finalConfirmationPreview}>
                        <strong>{confirmation.actionLabel}</strong>
                        <small>
                          {confirmation.finalExecutionGate?.liveAdapterOneLineLabel ||
                            `${confirmation.adapter.label} · ${
                              confirmation.adapterConnected ? "연결됨" : confirmation.adapter.connectLabel
                            }`}
                        </small>
                        <ul>
                          {confirmation.checklist.slice(0, 3).map((check) => (
                            <li key={check}>{check}</li>
                          ))}
                        </ul>
                        {confirmation.requiredFields.length ? (
                          <div className={styles.finalFieldGrid}>
                            {confirmation.requiredFields.map((field) => {const Field=field.id==='attachment_selection'?'div':'label';return (
                              <Field
                                key={field.id}
                                className={field.multiline ? styles.finalFieldWide : undefined}
                                data-final-field-multiline={field.multiline ? "true" : undefined}
                              >
                                <span>
                                  {field.label}
                                  {field.required ? " *" : ""}
                                </span>
                                {field.id === 'attachment_selection' ? (
                                  <span>
                                    {(confirmation.attachmentCandidates||[]).map(file=>{
                                      const selected=(finalActionValues[field.id]||'').split(',').filter(Boolean);
                                      return <label key={file.id} style={{display:'flex',gap:8,alignItems:'center',marginBlock:8}}><input type="checkbox" checked={selected.includes(file.key)} disabled={finalActionAlreadySent} onChange={event=>onChangeFinalActionValue?.(field.id,event.target.checked?[...selected,file.key].join(','):selected.filter(key=>key!==file.key).join(','))}/><span>{file.filename} · {Math.ceil(file.bytes/1024)} KB</span></label>;
                                    })}
                                    <small>{confirmation.attachmentNotice||(!confirmation.attachmentCandidates?.length?'이 답장에 연결된 결과물이 없습니다. 업무에서 문서를 저장하면 여기에 표시됩니다.':'선택한 결과물만 첨부합니다. 최대 5개, 합계 10 MB. 파일이 바뀌면 발송 전에 다시 확인합니다.')}</small>
                                  </span>
                                ) : field.multiline ? (
                                  // 실제로 나갈 본문 — 줄바꿈을 그대로 유지해 고쳐 보낼 수 있습니다.
                                  <textarea
                                    rows={8}
                                    value={finalActionValues[field.id] ?? confirmation.defaultValues?.[field.id] ?? ""}
                                    placeholder={field.placeholder}
                                    onChange={(event) => onChangeFinalActionValue?.(field.id, event.target.value)}
                                    disabled={finalActionAlreadySent}
                                  />
                                ) : (
                                  <input
                                    value={finalActionValues[field.id] ?? confirmation.defaultValues?.[field.id] ?? ""}
                                    placeholder={field.placeholder}
                                    onChange={(event) => onChangeFinalActionValue?.(field.id, event.target.value)}
                                    disabled={finalActionAlreadySent}
                                  />
                                )}
                                {confirmation.defaultHints?.[field.id] ? (
                                  <small>{confirmation.defaultHints[field.id]}</small>
                                ) : null}
                              </Field>
                            );})}
                            {confirmation.sendScopeRecovery ? (
                              <p className={styles.finalFieldWide} data-final-send-scope-required="true" role="status">
                                {confirmation.sendScopeRecovery.userMessage}{" "}
                                <a href={confirmation.sendScopeRecovery.connectHref}>{confirmation.sendScopeRecovery.actionLabel}</a>
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {dryRun ? (
                          <div className={styles.finalDryRunBox} data-status={dryRun.status}>
                            <strong>{dryRunStatusLabel(dryRun.status)}</strong>
                            <small>{dryRun.userMessage}</small>
                            {dryRun.dryRun ? (
                              <>
                                <p>{dryRun.dryRun.executionPlan.summary}</p>
                                <ul>
                                  {dryRun.dryRun.checks.slice(0, 4).map((check) => (
                                    <li key={check}>{check}</li>
                                  ))}
                                </ul>
                                {finalDryRunRecipientDecision ? (
                                  <dl
                                    className={styles.finalDryRunRecipientDecision}
                                    data-final-recipient-decision-contract="send_hold_exclude_cc_bcc_reviewed"
                                    aria-label={`${item.title} 실행 전 수신자 판단`}
                                  >
                                    {finalDryRunRecipientDecision.summary ? (
                                      <div>
                                        <dt>판단 요약</dt>
                                        <dd>{finalDryRunRecipientDecision.summary}</dd>
                                      </div>
                                    ) : null}
                                    {finalDryRunRecipientDecision.sendCandidateLabels?.length ? (
                                      <div>
                                        <dt>발송 추천</dt>
                                        <dd>{finalDryRunRecipientDecision.sendCandidateLabels.slice(0, 3).join(" / ")}</dd>
                                      </div>
                                    ) : null}
                                    {finalDryRunRecipientDecision.holdCandidateLabels?.length ? (
                                      <div>
                                        <dt>보류 확인</dt>
                                        <dd>{finalDryRunRecipientDecision.holdCandidateLabels.slice(0, 3).join(" / ")}</dd>
                                      </div>
                                    ) : null}
                                    {finalDryRunRecipientDecision.excludeCandidateLabels?.length ? (
                                      <div>
                                        <dt>제외 확인</dt>
                                        <dd>{finalDryRunRecipientDecision.excludeCandidateLabels.slice(0, 3).join(" / ")}</dd>
                                      </div>
                                    ) : null}
                                    {finalDryRunRecipientDecision.learningDecisionHints?.length ? (
                                      <div>
                                        <dt>학습 판단</dt>
                                        <dd>{finalDryRunRecipientDecision.learningDecisionHints.slice(0, 3).join(" / ")}</dd>
                                      </div>
                                    ) : null}
                                    {finalDryRunRecipientDecision.privacyBoundary ? (
                                      <div>
                                        <dt>개인정보</dt>
                                        <dd>{finalDryRunRecipientDecision.privacyBoundary}</dd>
                                      </div>
                                    ) : null}
                                  </dl>
                                ) : null}
                                {shouldShowFinalDryRunReviewedDraft && finalDryRunReviewedDraft ? (
                                  <section
                                    className={styles.finalDryRunReviewedDraft}
                                    aria-label={`${item.title} 작업함 수정본 실행 전 검토`}
                                    data-final-dry-run-revised-draft="work_queue_revised_draft_to_dry_run"
                                    data-final-dry-run-body-source={finalDryRunReviewedDraft.bodySource}
                                    data-final-dry-run-has-body-preview={finalDryRunReviewedDraft.bodyPreview ? "true" : "false"}
                                    data-final-dry-run-external-mutation="false"
                                  >
                                    <header>
                                      <span>수정본 기준</span>
                                      <strong>
                                        {finalDryRunReviewedDraft.bodySource === "user_revised_draft"
                                          ? "업무대장 수정본으로 발송 전 검토"
                                          : "발송 본문 기준 실행 전 검토"}
                                      </strong>
                                      <small>여러 메일 후보도 여기서 본문·메모·점검 요약을 보고 승인합니다</small>
                                    </header>
                                    {finalDryRunReviewedDraft.bodyPreview ? (
                                      <p>{finalDryRunReviewedDraft.bodyPreview}</p>
                                    ) : null}
                                    <dl>
                                      {finalDryRunReviewedDraft.reviewNote ? (
                                        <div>
                                          <dt>수정 메모</dt>
                                          <dd>{finalDryRunReviewedDraft.reviewNote}</dd>
                                        </div>
                                      ) : null}
                                      {finalDryRunReviewedDraft.sendCheckSummary ? (
                                        <div>
                                          <dt>발송 전 점검</dt>
                                          <dd>{finalDryRunReviewedDraft.sendCheckSummary}</dd>
                                        </div>
                                      ) : null}
                                      <div>
                                        <dt>외부 실행</dt>
                                        <dd>아직 없음 · 최종 확인 전 발송 차단</dd>
                                      </div>
                                    </dl>
                                  </section>
                                ) : null}
                                {finalDryRunSafetyChecks.length ? (
                                  <ul
                                    className={styles.finalDryRunSafetyChecks}
                                    data-final-dry-run-safety="recipient_cc_bcc_final_confirmation"
                                    aria-label={`${item.title} 실행 전 안전 체크`}
                                  >
                                    {finalDryRunSafetyChecks.slice(0, 5).map((check) => (
                                      <li key={check}>{finalDryRunSafetyCheckLabel(check)}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </>
                            ) : null}
                            {dryRun.validationMessages?.length ? (
                              <em>{dryRun.validationMessages.join(" · ")}</em>
                            ) : null}
                            {dryRun.missingFieldIds?.length ? (
                              <em>필수 확인값: {dryRun.missingFieldIds.join(", ")}</em>
                            ) : null}
                          </div>
                        ) : null}
                        <div
                          className={styles.finalExecutionGate}
                          data-ready={dryRunReady ? "true" : "false"}
                          data-live-adapter-plan-contract={
                            confirmation.finalExecutionGate?.liveAdapterPlanContract ?? "not_mail_send"
                          }
                          data-live-adapter-selected={
                            confirmation.finalExecutionGate?.liveAdapterSelectedId ?? "not_selected"
                          }
                          data-live-adapter-ready-count={
                            confirmation.finalExecutionGate?.liveAdapterReadyCount ?? 0
                          }
                          data-live-adapter-pending-count={
                            confirmation.finalExecutionGate?.liveAdapterPendingCount ?? 0
                          }
                          data-live-adapter-dispatch-status={
                            finalLiveAdapterRecovery?.dispatchStatus ?? confirmation.finalExecutionGate?.liveAdapterDispatchStatus ?? "not_mail_send"
                          }
                          data-live-adapter-external-mutation-on-confirm={
                            finalLiveAdapterMutationOnConfirm ? "true" : "false"
                          }
                          data-live-adapter-proof-chain={
                            confirmation.finalExecutionGate?.liveAdapterProofChain ?? "not_mail_send"
                          }
                          data-mobile-mail-intake-supported={
                            confirmation.finalExecutionGate?.mobileMailIntakeSupported || finalLiveAdapterRecovery?.state === "ready" ? "true" : "false"
                          }
                          data-live-adapter-recovery-state={finalLiveAdapterRecovery?.state ?? "review"}
                          data-live-adapter-recovery-action={finalLiveAdapterRecovery?.actionLabel ?? "연결 확인"}
                        >
                          <div>
                            <strong>
                              {finalLiveAdapterRecovery?.label || (dryRunReady ? "마지막 확인 가능" : "마지막 확인 잠김")}
                            </strong>
                            <small>
                              {finalLiveAdapterRecovery
                                ? `${finalLiveAdapterRecovery.actionLabel} · ${finalLiveAdapterRecovery.resumeLabel}`
                                : dryRunReady
                                  ? "실행 전 검토 ID와 확인 문구를 붙여 최종 실행 조건을 점검합니다."
                                  : "실행 전 검토가 끝나야 최종 실행 조건을 확인할 수 있습니다."}
                            </small>
                          </div>
                          <code>확인 문구: 최종 실행 확인</code>
                          <section
                            className={styles.finalAiExecutionControl}
                            aria-label={`${item.title} AI 실행 관제`}
                            data-ai-final-execution-control="ai_runtime_role_connector_dry_run_final_execute_log"
                            data-ai-final-execution-control-visible="one_line_summary_details_inside"
                            data-ai-final-execution-control-router="AIRuntimeRouter"
                            data-ai-final-execution-control-role-contract="role_assignment_runtime_v1"
                            data-ai-final-execution-control-work-contract="ConversationEngine_to_WorkAutomationEngine_to_ApprovalEngine"
                            data-ai-final-execution-control-send-policy="send_only_after_user_final_confirmation"
                            data-ai-final-execution-control-connector-ready={
                              finalLiveAdapterRecovery?.state === "ready" || confirmation.adapterConnected ? "true" : "false"
                            }
                            data-ai-final-execution-control-dry-run-ready={dryRunReady ? "true" : "false"}
                            data-ai-final-execution-control-execution-status={execution?.status ?? "not_started"}
                            data-ai-final-execution-control-external-mutation-before-confirmation="false"
                          >
                            <div>
                              <span>AI 실행 관제</span>
                              <strong>{dryRunReady ? "역할, 연결, 검토값 확인" : "역할은 받았고 실행 검토 대기"}</strong>
                              <small>AI 답변에서 온 승인 후보만 역할, 연결, dry-run, 마지막 확인, 실행 로그 순서로 이어갑니다.</small>
                            </div>
                            <ol>
                              <li data-step="ai_runtime" data-state="ready">
                                <span>AI 연결</span>
                                <strong>AIRuntimeRouter</strong>
                                <small>실제 답변 경로가 있는 업무만 승인 후보로 취급</small>
                              </li>
                              <li data-step="role_payload" data-state="ready">
                                <span>역할 부여</span>
                                <strong>{item.finalAction?.label ?? "업무 실행 역할"}</strong>
                                <small>역할 payload가 작업 후보와 승인함 경계로 전달</small>
                              </li>
                              <li
                                data-step="connector_readiness"
                                data-state={finalLiveAdapterRecovery?.state === "ready" || confirmation.adapterConnected ? "ready" : "review"}
                              >
                                <span>커넥터</span>
                                <strong>
                                  {finalExecutionDispatchLabel(
                                    finalLiveAdapterRecovery?.dispatchStatus ?? confirmation.finalExecutionGate?.liveAdapterDispatchStatus,
                                  )}
                                </strong>
                                <small>{confirmation.finalExecutionGate?.liveAdapterSelectedId ?? confirmation.adapter.requiredConnectorId}</small>
                              </li>
                              <li data-step="dry_run" data-state={dryRunReady ? "ready" : "locked"}>
                                <span>검토</span>
                                <strong>{dryRunReady ? "dry-run 완료" : "dry-run 필요"}</strong>
                                <small>{dryRun?.auditId ?? "외부 발송 전 검토 기록 대기"}</small>
                              </li>
                              <li data-step="final_execute_log" data-state={execution?.auditId ? "ready" : "locked"}>
                                <span>전송/로그</span>
                                <strong>{execution?.auditId ? "실행 로그 기록" : "최종 확인 전 잠금"}</strong>
                                <small>{execution?.auditId ?? "사용자 마지막 확인 뒤에만 실행 요청"}</small>
                              </li>
                            </ol>
                          </section>
                          <ol
                            className={styles.finalExecutionRunway}
                            aria-label={`${item.title} 승인 후 전송 가능 조건`}
                            data-final-execution-runway="dry_run_adapter_final_phrase_execution_log"
                            data-final-execution-runway-dispatch={
                              finalLiveAdapterRecovery?.dispatchStatus ?? confirmation.finalExecutionGate?.liveAdapterDispatchStatus ?? "not_mail_send"
                            }
                            data-final-execution-runway-selected-adapter={
                              confirmation.finalExecutionGate?.liveAdapterSelectedId ?? "app_final_confirmation_only"
                            }
                            data-final-execution-runway-ready-count={
                              confirmation.finalExecutionGate?.liveAdapterReadyCount ?? 0
                            }
                            data-final-execution-runway-pending-count={
                              confirmation.finalExecutionGate?.liveAdapterPendingCount ?? 0
                            }
                            data-final-execution-runway-provider-dispatch-contract={
                              confirmation.finalExecutionGate?.liveProviderDispatchContract ?? "not_mail_send"
                            }
                            data-final-execution-runway-provider-dispatch-mode={
                              confirmation.finalExecutionGate?.liveProviderDispatchMode ?? "final_confirmation_only"
                            }
                            data-final-execution-runway-external-mutation-before-confirmation="false"
                            data-final-execution-runway-external-mutation-on-confirm={
                              finalLiveAdapterMutationOnConfirm ? "true" : "false"
                            }
                          >
                            <li data-state={dryRunReady ? "done" : "waiting"}>
                              <span>검토</span>
                              <strong>{dryRunReady ? "실행 전 검토 완료" : "실행 전 검토 필요"}</strong>
                            </li>
                            <li data-state={finalLiveAdapterRecovery?.state === "ready" ? "ready" : "review"}>
                              <span>전송 경로</span>
                              <strong>
                                {finalExecutionDispatchLabel(finalLiveAdapterRecovery?.dispatchStatus ?? confirmation.finalExecutionGate?.liveAdapterDispatchStatus)}
                              </strong>
                            </li>
                            <li data-state="locked">
                              <span>최종 문구</span>
                              <strong>{confirmation.finalExecutionGate?.confirmPhraseRequired ?? "최종 실행 확인"}</strong>
                            </li>
                            <li data-state="locked">
                              <span>실행 로그</span>
                              <strong>발송 뒤 기록</strong>
                            </li>
                          </ol>
                          {finalLiveAdapterRecovery ? (
                            <details className={styles.finalExecutionRecovery}>
                              <summary>전송 준비 상세</summary>
                              <dl>
                                <div>
                                  <dt>이유</dt>
                                  <dd>{finalLiveAdapterRecovery.reason}</dd>
                                </div>
                                <div>
                                  <dt>해결</dt>
                                  <dd>{finalLiveAdapterRecovery.actionLabel}</dd>
                                </div>
                                <div>
                                  <dt>휴대폰</dt>
                                  <dd>{finalLiveAdapterRecovery.mobileLabel}</dd>
                                </div>
                                <div>
                                  <dt>증거</dt>
                                  <dd>{finalLiveAdapterRecovery.proofChain}</dd>
                                </div>
                              </dl>
                              {finalLiveAdapterRecovery.options.length ? (
                                <ol
                                  className={styles.finalExecutionAdapterOptions}
                                  aria-label={`${item.title} 전송 어댑터 준비 목록`}
                                  data-live-adapter-option-list="gmail_outlook_smtp_app_final_confirmation"
                                  data-live-adapter-option-count={finalLiveAdapterRecovery.options.length}
                                  data-live-adapter-option-external-mutation="false"
                                >
                                  {finalLiveAdapterRecovery.options.map((option) => (
                                    <li
                                      key={`${item.id}-live-adapter-${option.id}`}
                                      data-readiness={option.readiness}
                                      data-dispatch={option.dispatchImplementationStatus ?? "app_final_confirmation_only"}
                                      data-required-scope={option.requiredScopeValue ?? ""}
                                      data-recovery-action={option.recoveryActionLabel ?? ""}
                                      data-external-mutation-on-confirm={
                                        option.externalMutationOnlyAfterFinalConfirmation ? "true" : "false"
                                      }
                                    >
                                      <span>{liveAdapterOptionStateLabel(option.readiness)}</span>
                                      <strong>{option.label}</strong>
                                      <small>{option.statusLabel || option.connectorId || "앱 최종 확인 전용"}</small>
                                      {option.requiredScopeLabel ? (
                                        <em>{option.requiredScopeLabel}</em>
                                      ) : null}
                                      {option.recoveryActionLabel ? (
                                        <a href={option.connectHref || finalConfirmationConnectHref(confirmation)}>
                                          {option.recoveryActionLabel}
                                        </a>
                                      ) : null}
                                      {option.resumeAfterConnectLabel ? (
                                        <small>{option.resumeAfterConnectLabel}</small>
                                      ) : null}
                                    </li>
                                  ))}
                                </ol>
                              ) : null}
                            </details>
                          ) : null}
                        </div>
                        {execution ? (
                          <div className={styles.finalExecutionResult} data-status={execution.status}>
                            <strong>{executionStatusLabel(execution.status)}</strong>
                            <small>{execution.userMessage}</small>
                            {execution.finalExecutionReceipt ? (
                              <section
                                className={styles.finalExecutionReceipt}
                                aria-label={`${item.title} 최종 실행 영수증`}
                                data-final-execution-receipt="office_final_execution_receipt_v1"
                                data-final-execution-receipt-status={execution.finalExecutionReceipt.status}
                                data-final-execution-receipt-external-mutation={
                                  execution.finalExecutionReceipt.externalMutation ? "true" : "false"
                                }
                                data-final-execution-receipt-locked={
                                  execution.finalExecutionReceipt.finalSendOrCalendarMutationLocked ? "true" : "false"
                                }
                              >
                                <header>
                                  <span>{execution.finalExecutionReceipt.mutationLabel}</span>
                                  <strong>
                                    {execution.finalExecutionReceipt.externalMutation ? "실제 처리 기록" : "실행 잠금 기록"}
                                  </strong>
                                </header>
                                <p>{execution.finalExecutionReceipt.summary}</p>
                                <dl>
                                  <div>
                                    <dt>외부 변경</dt>
                                    <dd>{execution.finalExecutionReceipt.externalMutation ? "있음" : "없음"}</dd>
                                  </div>
                                  <div>
                                    <dt>감사 기록</dt>
                                    <dd>{execution.finalExecutionReceipt.auditId || execution.auditId || "대기"}</dd>
                                  </div>
                                  <div>
                                    <dt>게이트</dt>
                                    <dd>{execution.finalExecutionReceipt.gateStatus || execution.finalExecutionGate?.status || "확인"}</dd>
                                  </div>
                                </dl>
                              </section>
                            ) : null}
                            {execution.missingRequirements?.length ? (
                              <em>
                                필요한 확인: {execution.missingRequirements.map(finalExecutionMissingRequirementLabel).join(", ")}
                              </em>
                            ) : null}
                            {execution.providerDispatchRecovery ? (
                              <section
                                className={styles.finalExecutionProviderRecovery}
                                aria-label={`${item.title} 발송 권한 복구 후 이어가기`}
                                data-provider-dispatch-recovery="one_line_action_resume_details_collapsed"
                                data-provider-dispatch-recovery-contract={execution.providerDispatchRecovery.contract}
                                data-provider-dispatch-recovery-status={execution.providerDispatchRecovery.status}
                                data-provider-dispatch-recovery-kind={execution.providerDispatchRecovery.recoveryKind}
                                data-provider-dispatch-recovery-external-mutation={
                                  execution.providerDispatchRecovery.externalMutation ? "true" : "false"
                                }
                                data-provider-dispatch-recovery-resume="mail_final_confirmation"
                                data-provider-dispatch-recovery-resume-work-item={item.id}
                                data-provider-dispatch-recovery-return-to="office_focus_final_action"
                                data-provider-dispatch-recovery-proof-chain={execution.providerDispatchRecovery.proofChain}
                              >
                                <div className={styles.finalExecutionProviderRecoveryLine}>
                                  <span>{execution.providerDispatchRecovery.providerLabel}</span>
                                  <strong>{execution.providerDispatchRecovery.actionLabel}</strong>
                                  <a
                                    href={finalConfirmationResumeConnectHref(
                                      confirmation,
                                      item,
                                      execution.providerDispatchRecovery.connectHref,
                                    )}
                                    data-provider-dispatch-recovery-primary-action="send_scope_upgrade_resume_same_final_confirmation"
                                    data-provider-dispatch-recovery-action-href={execution.providerDispatchRecovery.connectHref}
                                  >
                                    권한 추가
                                  </a>
                                  <small>{execution.providerDispatchRecovery.resumeLabel}</small>
                                </div>
                                <details data-provider-dispatch-recovery-details="reason_action_resume_collapsed">
                                  <summary>복구 경로 상세</summary>
                                  <dl>
                                    <div>
                                      <dt>이유</dt>
                                      <dd>{execution.providerDispatchRecovery.reason}</dd>
                                    </div>
                                    <div>
                                      <dt>해결</dt>
                                      <dd>{execution.providerDispatchRecovery.actionLabel}</dd>
                                    </div>
                                    <div>
                                      <dt>다시 이어가기</dt>
                                      <dd>{execution.providerDispatchRecovery.resumeLabel}</dd>
                                    </div>
                                  </dl>
                                </details>
                              </section>
                            ) : null}
                            {execution.auditId ? <code>{execution.auditId}</code> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </details>
                  <section
                    className={styles.finalApprovalCommitSummary}
                    aria-label={`${item.title} 최종 승인 직전 요약`}
                    data-final-approval-commit-summary="approve_subject_dry_run_final_button_log_rollback"
                    data-final-approval-commit-dry-run-ready={dryRunReady ? "true" : "false"}
                    data-final-approval-commit-execution-recorded={execution?.auditId ? "true" : "false"}
                    data-final-approval-commit-external-mutation="false"
                  >
                    <div>
                      <span>승인 직전</span>
                      <strong>{dryRunReady ? "마지막 확인 버튼을 누르기 전 요약" : "실행 전 검토가 먼저 필요합니다"}</strong>
                      <small>승인 대상, 검토 기록, 최종 버튼, 로그/되돌림 기준을 한 줄로 확인합니다.</small>
                    </div>
                    <ol>
                      {finalApprovalCommitItems.map((commitItem) => (
                        <li key={`${item.id}-final-commit-${commitItem.id}`} data-state={commitItem.state}>
                          <span>{commitItem.label}</span>
                          <strong>{commitItem.title}</strong>
                          <small>{commitItem.detail}</small>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <div className={styles.finalActionButtons}>
                    <button
                      type="button"
                      onClick={() => onPrepareFinalConfirmation?.(item)}
                      disabled={!onPrepareFinalConfirmation || preparingFinalActionId === item.id || finalActionAlreadySent}
                    >
                      {preparingFinalActionId === item.id ? "준비 중" : "마지막 확인 준비"}
                    </button>
                    {confirmation && !finalActionAlreadySent ? (
                      <button
                        type="button"
                        onClick={() => onRunFinalActionDryRun?.(item)}
                        disabled={!onRunFinalActionDryRun || runningDryRunActionId === item.id}
                      >
                        {runningDryRunActionId === item.id ? "검증 중" : "실행 전 검토"}
                      </button>
                    ) : null}
                    {confirmation || finalActionAlreadySent ? (
                      <button
                        type="button"
                        onClick={() => onExecuteFinalAction?.(item)}
                        disabled={
                          finalActionAlreadySent ||
                          !dryRunReady ||
                          !onExecuteFinalAction ||
                          executingFinalActionId === item.id
                        }
                        data-final-action-sent={finalActionAlreadySent ? "true" : "false"}
                      >
                        {finalActionAlreadySent
                          ? item.finalAction?.kind === "create_calendar_event"
                            ? "등록했어요"
                            : "보냈어요"
                          : executingFinalActionId === item.id
                            ? "확인 중"
                            : "마지막 확인"}
                      </button>
                    ) : null}
                    {mailThreadRecipientGuide ? (
                      <section
                        className={styles.bulkRecipientListGuide}
                        data-state={mailThreadRecipientGuide.state}
                        aria-label={`${item.title} 답장 수신자 판단 근거`}
                      >
                        <span>답장 대상 근거</span>
                        <div>
                          <strong>{mailThreadRecipientGuide.replyTargetLabel}</strong>
                          <small>{mailThreadRecipientGuide.recipientDecisionSummary}</small>
                        </div>
                        <dl>
                          <div>
                            <dt>발송 추천</dt>
                            <dd>{mailThreadRecipientGuide.sendSummary}</dd>
                          </div>
                          <div>
                            <dt>보류 대상</dt>
                            <dd>{mailThreadRecipientGuide.holdSummary}</dd>
                          </div>
                          <div>
                            <dt>제외 대상</dt>
                            <dd>{mailThreadRecipientGuide.excludeSummary}</dd>
                          </div>
                          <div>
                            <dt>학습 판단</dt>
                            <dd>{mailThreadRecipientGuide.learningDecisionSummary}</dd>
                          </div>
                          <div>
                            <dt>개인정보</dt>
                            <dd>{mailThreadRecipientGuide.privacyBoundary}</dd>
                          </div>
                        </dl>
                      </section>
                    ) : null}
                    {canRecordFinalActionDecision ? (
                        <div
                          className={styles.finalActionDecisionActions}
                          aria-label={`${item.title} 카드 내부 고쳐달라고 하기 또는 보류하기`}
                        >
                        <div
                          className={styles.finalActionDecisionLead}
                          data-final-decision-flow="run_change_hold_worklog_next_pattern"
                          data-user-decision-labels="run_change_hold_remember"
                        >
                          <strong>{officeDecisionActionLabels}</strong>
                          <small>
                            실행하기는 이 버튼에서 최종 확인 준비로 이어지고, 고쳐달라고 하기와 보류하기는 여기서 기록합니다. 결정 뒤 실행 로그와 업무 기록을 확인한
                            다음 마음에 드는 방식만 다음부터 이렇게로 저장합니다.
                          </small>
                        </div>
                        <dl
                          className={styles.finalActionDecisionRail}
                          aria-label={`${item.title} 고쳐달라고 하기 보류하기 다음 기록`}
                        >
                          <div data-state="run">
                            <dt>실행하기</dt>
                            <dd>
                              <strong>최종 확인으로 이어짐</strong>
                              <small>연결, 수신자/대상, 실행 전 검토가 준비된 뒤에만 실제 실행 후보로 넘어갑니다.</small>
                            </dd>
                          </div>
                          <div data-state="review">
                            <dt>고쳐달라고 하기</dt>
                            <dd>
                              <strong>다시 작성으로 되돌림</strong>
                              <small>외부 실행 없이 담당 업무 비서 기록에 수정 이유를 남깁니다.</small>
                            </dd>
                          </div>
                          <div data-state="held">
                            <dt>보류하기</dt>
                            <dd>
                              <strong>실행 후보 잠금 유지</strong>
                              <small>발송, 등록, 공유, 클릭은 실행하지 않고 승인 카드만 멈춥니다.</small>
                            </dd>
                          </div>
                          <div data-state="log">
                            <dt>업무 기록</dt>
                            <dd>
                              <strong>업무 기록으로 남김</strong>
                              <small>다음 선택지는 다시 미리보기, 연결 확인, 마지막 확인 준비입니다.</small>
                            </dd>
                          </div>
                        </dl>
                        <button
                          type="button"
                          data-final-decision-action="run"
                          onClick={() => onPrepareFinalConfirmation?.(item)}
                          disabled={
                            !onPrepareFinalConfirmation ||
                            preparingFinalActionId === item.id ||
                            recordingMailOpsDecisionId === item.id
                          }
                        >
                          {preparingFinalActionId === item.id ? "준비 중" : "실행하기"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRecordMailOpsDecision?.(item, "change_requested")}
                          disabled={recordingMailOpsDecisionId === item.id}
                        >
                          고쳐달라고 하기
                        </button>
                        <button
                          type="button"
                          onClick={() => onRecordMailOpsDecision?.(item, "held")}
                          disabled={recordingMailOpsDecisionId === item.id}
                        >
                          보류하기
                        </button>
                        <small>고쳐달라고 하기와 보류하기는 외부 실행 없이 업무 기록으로 남깁니다</small>
                        {/* 직접 쓰고 점검한 메일은 AI 가 다시 쓰지 않는다(점검 승인이 AI 본문으로 넘어가지 않게). */}
                        {item.finalAction?.kind === "send_email" && !finalActionAlreadySent && onRedraftMailReply && !isUserComposedMailReviewItem(item) ? (
                          <MailRedraftForm
                            workItemId={item.id}
                            title={item.title}
                            onRedraft={(instruction) => onRedraftMailReply(item, instruction)}
                          />
                        ) : null}
                        <nav
                          className={styles.cardDecisionFollowupActions}
                          aria-label={`${item.title} 결정 후 바로 확인`}
                          data-card-decision-followup-actions="log_remember_next_choice"
                          data-card-decision-visible-priority="decision_done_log_first_remember_next"
                          data-decision-complete-label="결정 후 바로 볼 것"
                          data-card-decision-work-kind={finalActionLabel(item.finalAction?.kind)}
                          data-card-decision-followup-path="decision_log_remember_next"
                          data-log-action="open_office"
                          data-save-action="today_check"
                          data-next-action="workers"
                          data-mobile-safe-width="390"
                        >
                          <span>{finalActionLabel(item.finalAction?.kind)} · 결정 후 바로 볼 것</span>
                          <a href={officeHomeActionHref("open_office")} data-action="log">
                            실행 로그 확인
                          </a>
                          <a href={officeHomeActionHref("today_check")} data-action="remember">
                            다음부터 이렇게 저장 위치
                          </a>
                          <a href={officeHomeActionHref("workers")} data-action="next">
                            다음 작업 맡기기
                          </a>
                        </nav>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {hiddenMemorySearchFinalAction && hiddenMemorySearchFinalActionGuide ? (
            <section
              className={styles.memorySearchFinalActionSource}
              data-state={hiddenMemorySearchFinalActionGuide.state}
              aria-label={`${hiddenMemorySearchFinalAction.title} 접힌 후보 지난 업무 출처와 승인 경계`}
              data-hidden-final-action-memory-proof="visible_summary_before_collapsed_candidates"
            >
              <span>지난 업무 근거</span>
              <div>
                <strong>{hiddenMemorySearchFinalActionGuide.resultKind}</strong>
                <small>{hiddenMemorySearchFinalActionGuide.safetyLabel}</small>
              </div>
              <dl>
                <div>
                  <dt>출처</dt>
                  <dd>{hiddenMemorySearchFinalActionGuide.sourcePath}</dd>
                </div>
                <div>
                  <dt>초안 미리보기</dt>
                  <dd>{hiddenMemorySearchFinalActionGuide.draftPreview}</dd>
                </div>
                <div>
                  <dt>다음 선택</dt>
                  <dd>{hiddenMemorySearchFinalActionGuide.nextUserChoice}</dd>
                </div>
              </dl>
            </section>
          ) : null}
          {hiddenFinalActionCandidates.length ? (
            <details
              className={styles.approvalCandidateMore}
              aria-label="실행 전 확인 나머지 후보"
              data-final-action-more="remaining_cards_collapsed"
              data-final-action-more-default="closed"
            >
              <summary>
                <span>나머지 실행 후보</span>
                <strong>{hiddenFinalActionCandidates.length}개 접힘</strong>
                <small>제목과 잠금 상태만 먼저 봅니다</small>
              </summary>
              <ol className={styles.approvalCandidateMoreList}>
                {hiddenFinalActionCandidates.map((item) => {
                  const separatedFinalActionKind = separatedMailOpsFinalActionKind(item);
                  const separatedFinalAction = separatedMailOpsFinalActionCopy(item);
                  return (
                  <li
                    key={`final-more-${item.id}`}
                    data-state={item.finalAction?.readiness === "ready_for_final_confirmation" ? "ready" : "locked"}
                    data-final-action-work-item-id={item.id}
                    data-mail-card-priority={item.priority ?? ""}
                    data-mailops-final-action-separated-kind={separatedFinalActionKind}
                    data-mailops-final-action-separated-contract="calendar_event_and_mail_attachment_folder_plan_have_distinct_final_confirmation_cards"
                  >
                    <span>{separatedFinalAction?.label ?? finalActionLabel(item.finalAction?.kind)}</span>
                    <strong>{item.title}</strong>
                    <small>
                      {moreListTriagePrefix(item)}
                      {separatedFinalAction?.title ?? item.finalAction?.label ?? "실행 전 확인"} ·{" "}
                      {item.finalAction?.readiness === "ready_for_final_confirmation" ? "연결 확인" : "연결 필요"}
                    </small>
                    <a href="#final-action-candidates">확인</a>
                  </li>
                  );
                })}
              </ol>
            </details>
          ) : null}
          </>
        ) : (
          <p>승인 문서를 확인하면 실행 후보 카드가 이곳으로 올라옵니다. 외부 실행은 최종 확인 전까지 열리지 않습니다.</p>
        )}
        <footer>
          <span>{finalConfirmation ? "확인 계약 준비됨" : "외부 실행 차단 중"}</span>
          <small>{finalConfirmationMessage || "사용자 마지막 확인 전까지 외부 변경 차단"}</small>
        </footer>
      </section>

      <section className={styles.connectionRecoveryPanel} aria-label="연결 복구와 대체 실행 루트">
        <header>
          <div>
            <span>막혔을 때 다음 선택</span>
            <strong>
              {connectorIssueRecords.length
                ? `${connectorIssueRecords.length}개 연결 복구 필요`
                : externalApprovalCount
                  ? `${externalApprovalCount}개 오피스 승인 대기`
                  : "연결 다음 방법 준비"}
            </strong>
          </div>
          <small>공식 연결이 막혀도 보관함, 내 PC 작업 도우미, 오피스 승인함으로 끊기지 않게 이어갑니다</small>
        </header>
        <ol className={styles.connectionRecoveryRoutes}>
          {connectionRecoveryRoutes.map((route) => (
            <li key={route.id} data-state={route.state}>
              <i />
              <strong>{route.label}</strong>
              <small>{route.detail}</small>
            </li>
          ))}
        </ol>
        {connectionRecoveryHandoff ? (
          <section className={styles.connectionRecoveryHandoff} aria-label="연결 결과에서 온 오피스 확인">
            <div>
              <span>연결 결과에서 이동</span>
              <strong>{connectionRecoveryHandoff.connectorLabel} 확인 중</strong>
              <small>보관함, 내 PC 작업 도우미, 오피스 승인함 순서로 이어집니다.</small>
            </div>
            <ol>
              <li>1. 계정 정보는 채팅 밖 보관함에서 확인</li>
              <li>2. 공식 연결이 막히면 읽기 후보만 준비</li>
              <li>3. 발송, 등록, 공유, 클릭은 최종 확인 전까지 잠금</li>
            </ol>
          </section>
        ) : null}
        {activeRecoveryRecords.length ? (
          <div
            className={styles.connectionRecoverySnapshot}
            aria-label="최근 연결 복구 항목"
            data-connection-recovery-snapshot-disclosure="latest_one_then_more_inside_details"
            data-connection-recovery-visible-count={visibleConnectionRecoveryRecords.length}
            data-connection-recovery-hidden-count={hiddenConnectionRecoveryRecords.length}
          >
            {visibleConnectionRecoveryRecords.map((record) => (
              <article key={`${record.connectorId}:${record.method}:${record.status}`}>
                <span>{record.recovery?.actionLabel ?? "복구"}</span>
                <div>
                  <strong>{connectorLabel(record)}</strong>
                  <small>{record.recovery?.label ?? record.status}</small>
                  <p>{record.recovery?.detail ?? record.userMessage ?? "연결값 또는 권한 확인이 필요합니다."}</p>
                </div>
              </article>
            ))}
            {hiddenConnectionRecoveryRecords.length ? (
              <details
                className={styles.connectionRecoverySnapshotMore}
                aria-label="나머지 연결 복구 항목"
                data-connection-recovery-more="remaining_recovery_records_on_demand"
                data-connection-recovery-more-default="closed"
              >
                <summary>
                  <span>나머지 복구</span>
                  <strong>{hiddenConnectionRecoveryRecords.length}개 접힘</strong>
                  <small>필요할 때만 연결 문제를 펼쳐봅니다</small>
                </summary>
                <div>
                  {hiddenConnectionRecoveryRecords.map((record) => (
                    <article key={`recovery-more-${record.connectorId}:${record.method}:${record.status}`}>
                      <span>{record.recovery?.actionLabel ?? "복구"}</span>
                      <div>
                        <strong>{connectorLabel(record)}</strong>
                        <small>{record.recovery?.label ?? record.status}</small>
                        <p>{record.recovery?.detail ?? record.userMessage ?? "연결값 또는 권한 확인이 필요합니다."}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : (
          <p>외부 계정 정보는 채팅에 남기지 않고 보관함에 저장합니다. 읽기 확인 뒤 발송·등록·클릭은 오피스 승인 카드에서만 열립니다.</p>
        )}
        <nav className={styles.connectionRecoveryActions} aria-label="연결 복구 바로가기">
          <a href={officeSingleSettingHref("connector", "공식 연결 설정만 확인합니다")}>공식 연결 확인</a>
          <a href={officeSingleSettingHref("vault", "계정 보관함 설정만 확인합니다", { externalAccounts: "1" })}>보관함 열기</a>
          <a href={officeSingleSettingHref("computer-use", "내 PC 작업 도우미 설정만 확인합니다")}>내 PC 작업 도우미 확인</a>
        </nav>
      </section>

      {mobileChannelDecisionRowsAll.length ? (
        <section
          className={styles.mobileChannelDecisionRail}
          aria-label="휴대폰 결정 확인 대기"
          data-mobile-channel-decision-rail="phone_decision_filter_one_line_to_final_confirmation"
          data-mobile-channel-decision-count={mobileChannelDecisionRowsAll.length}
          data-mobile-channel-decision-ready-count={mobileChannelDecisionReadyCount}
          data-mobile-channel-decision-review-count={mobileChannelDecisionReviewCount}
          data-mobile-channel-decision-locked-count={mobileChannelDecisionLockedCount}
          data-mobile-channel-decision-active-filter={mobileChannelDecisionFilter}
          data-mobile-channel-decision-final-boundary="phone_decision_records_intent_app_final_confirmation_required"
          data-external-mutation="false"
        >
          <header>
            <div>
              <span>휴대폰 결정</span>
              <strong>{mobileChannelDecisionRowsAll.length}건 확인 대기</strong>
            </div>
            <dl
              className={styles.mobileChannelDecisionHeaderStats}
              aria-label="휴대폰 결정 요약"
              data-mobile-channel-decision-header-compact="counts_only"
            >
              <div>
                <dt>마지막 확인</dt>
                <dd>{mobileChannelDecisionReadyCount}</dd>
              </div>
              <div>
                <dt>수정</dt>
                <dd>{mobileChannelDecisionReviewCount}</dd>
              </div>
              <div>
                <dt>보류</dt>
                <dd>{mobileChannelDecisionLockedCount}</dd>
              </div>
            </dl>
          </header>
          <div
            className={styles.mobileChannelDecisionFilters}
            role="tablist"
            aria-label="휴대폰 결정 필터"
            data-mobile-channel-decision-filters="all_ready_review_locked"
          >
            {mobileChannelDecisionFilterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mobileChannelDecisionFilter === tab.id}
                data-state={mobileChannelDecisionFilter === tab.id ? "active" : "idle"}
                onClick={() => setMobileChannelDecisionFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <strong>{tab.count}</strong>
              </button>
            ))}
          </div>
          <ol>
            {mobileChannelDecisionRows.map((decision) => (
              <li
                key={`mobile-channel-decision-${decision.id}`}
                data-decision={decision.decision}
                data-state={decision.state}
                data-work-item-id={decision.workItemId ?? ""}
                data-target-code={decision.targetCode ?? ""}
                data-final-action-ready={decision.finalAction ? "true" : "false"}
                data-mobile-row-display="one_line_summary_details_collapsed"
                data-mobile-channel-decision-row-compact="target_title_action_only_details_inside"
                data-mobile-channel-decision-row-compact-summary={`${decision.targetCode || decision.channel} · ${decision.oneLineStatus}`}
                data-mobile-channel-decision-virtual-office-bridge={decision.virtualOfficeBridgeLabel}
                data-mobile-channel-decision-reply-contract={decision.virtualOfficeReplyContract}
                data-mobile-channel-decision-event-path={decision.virtualOfficeEventPath}
              >
                <span>{decision.targetCode || decision.channel}</span>
                <div
                  className={styles.mobileChannelDecisionMain}
                  aria-label={`${decision.title} 휴대폰 결정 한 줄 요약`}
                  data-mobile-channel-decision-row-main="one_line_summary_details_collapsed"
                >
                  <strong>{decision.title}</strong>
                  <small>{decision.oneLineStatus}</small>
                </div>
                <button
                  type="button"
                  onClick={() => decision.finalAction && onPrepareFinalConfirmation?.(decision.finalAction)}
                  disabled={!decision.finalAction || !onPrepareFinalConfirmation || preparingFinalActionId === decision.workItemId}
                  data-mobile-channel-decision-action="prepare_final_confirmation"
                >
                  {decision.finalAction ? "마지막 확인" : "승인함 확인"}
                </button>
                <details
                  className={styles.mobileChannelDecisionDetails}
                  aria-label={`${decision.title} 휴대폰 결정 상세`}
                  data-mobile-channel-decision-row-details="route_virtual_office_boundary_collapsed"
                  data-mobile-channel-decision-details-external-mutation="false"
                >
                  <summary>
                    <span>상세 보기</span>
                    <small>{decision.approvalInboxRouteLabel ?? "ModyCrew > 오피스 > 승인함"}</small>
                  </summary>
                  <p>가상오피스 반영: {decision.virtualOfficeBridgeLabel}</p>
                  {decision.mobileReceiveSummary ? <p>휴대폰 수신 유형: {decision.mobileReceiveSummary}</p> : null}
                  <p>{decision.finalExecutionBoundary ?? "휴대폰 답장은 의사 기록만, 실제 실행은 앱 최종 확인 후 진행됩니다."}</p>
                  <small>{"결정 경로: 휴대폰 답장 -> 메신저 결정 기록 -> AI 직원 이벤트 -> 앱 마지막 확인"}</small>
                  {decision.revisionInstruction ? <em>수정 요청: {decision.revisionInstruction}</em> : null}
                  {decision.messagePreview ? <small>{decision.messagePreview}</small> : null}
                </details>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section
        className={styles.channelDecisionPanel}
        aria-label="메신저 결정 인박스"
        data-channel-decision-count={channelDecisions.length}
      >
        <header>
          <div>
            <span>메신저 결정 인박스</span>
            <strong>
              {channelDecisions.length
                ? `${channelDecisions.length}개 결정 반영`
                : "채널 답장 대기"}
            </strong>
          </div>
          <small>실행하기 · 고쳐달라고 하기 · 보류하기 결정은 앱의 마지막 확인으로 모입니다</small>
        </header>
        {channelDecisions.length ? (
          <ol>
            {channelDecisions.slice(0, 5).map((decision) => (
              <li
                key={decision.id}
                data-decision={decision.decision}
                data-channel-decision-target-code={decision.targetCode ?? ""}
                data-channel-decision-route={decision.approvalInboxRouteLabel ?? "ModyCrew > 오피스 > 승인함"}
                data-channel-decision-app-reconfirm={decision.requiresAppReconfirm ? "true" : "false"}
                data-channel-decision-row-compact="decision_title_channel_only_details_inside"
                data-channel-decision-row-compact-summary={`${decision.decisionLabel ?? decisionLabel(decision.decision)} · ${decision.title}`}
                data-channel-decision-external-mutation="false"
              >
                <span>{decision.decisionLabel ?? decisionLabel(decision.decision)}</span>
                <div
                  className={styles.channelDecisionMain}
                  aria-label={`${decision.title} 메신저 결정 한 줄 요약`}
                  data-channel-decision-row-main="one_line_summary_details_collapsed"
                >
                  <strong>{decision.title}</strong>
                  <small>
                    {decision.targetCode ? `${decision.targetCode} · ` : ""}
                    {decision.channel} · {decision.decidedBy} ·{" "}
                    {decision.requiresAppReconfirm ? decision.appReconfirmLabel ?? "앱의 마지막 확인 필요" : "채널 기록 완료"}
                  </small>
                </div>
                <details
                  className={styles.channelDecisionDetails}
                  aria-label={`${decision.title} 메신저 결정 상세`}
                  data-channel-decision-row-details="route_worker_virtual_office_memory_collapsed"
                  data-channel-decision-row-details-external-mutation="false"
                >
                  <summary>
                    <span>상세 보기</span>
                    <small>{decision.approvalInboxRouteLabel ?? "ModyCrew > 오피스 > 승인함"}</small>
                  </summary>
                  <em>{decision.approvalInboxRouteLabel ?? "ModyCrew > 오피스 > 승인함"}</em>
                  <div className={styles.channelDecisionOwner}>
                    <b>담당 AI 팀원 기록</b>
                    <span>
                      {decision.teammateName ?? "업무 비서"} · {decision.channelName ?? "오피스 승인함"}
                    </span>
                    {decision.teamLabel ? <em>{decision.teamLabel}</em> : null}
                    {decision.queueState ? <em>{decision.queueState}</em> : null}
                    {decision.workerEventLabel ? <em>{decision.workerEventLabel}</em> : null}
                  </div>
                  <div
                    className={styles.channelDecisionVirtualOfficeBridge}
                    data-channel-decision-virtual-office-bridge="phone_reply_code_to_worker_event_final_confirmation"
                    data-channel-decision-reply-contract={mobileDecisionReplyContract}
                    data-channel-decision-event-path={mobileDecisionVirtualOfficeEventPath}
                    data-channel-decision-virtual-office-target={decision.targetCode ?? ""}
                    data-channel-decision-virtual-office-external-mutation="false"
                  >
                    <b>가상오피스 반영</b>
                    <span>
                      {decision.targetCode ? `${decision.targetCode} · ` : ""}
                      {decision.workerEventLabel ?? `${decision.channel}에서 ${decision.decisionLabel ?? decisionLabel(decision.decision)} 의사 수신`}
                    </span>
                    <em>{decision.approvalInboxRouteLabel ?? "ModyCrew > 오피스 > 승인함"}</em>
                    <small>{"휴대폰 답장 -> 메신저 결정 기록 -> AI 직원 이벤트 -> 앱 마지막 확인"}</small>
                  </div>
                  {decision.revisionInstruction ? <em>{decision.revisionInstruction}</em> : null}
                  {decision.messagePreview ? <p>{decision.messagePreview}</p> : null}
                  <p>{decision.finalExecutionBoundary ?? "휴대폰 답장은 의사 기록만, 실제 실행은 앱 최종 확인 후 진행됩니다."}</p>
                  <div className={styles.channelDecisionMemoryActions} aria-label="AI 팀원 기억 열기">
                    <button
                      type="button"
                      onClick={() => decision.decisionLogPath && onOpenMemoryFile?.(decision.decisionLogPath)}
                      disabled={!decision.decisionLogPath || !onOpenMemoryFile}
                    >
                      결정 기록 열기
                    </button>
                    <button
                      type="button"
                      onClick={() => decision.workLogPath && onOpenMemoryFile?.(decision.workLogPath)}
                      disabled={!decision.workLogPath || !onOpenMemoryFile}
                    >
                      작업 기록 열기
                    </button>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <div
            className={styles.channelDecisionEmpty}
            data-channel-decision-empty="no_channel_replies_yet"
            data-channel-decision-empty-external-mutation="false"
          >
            <span>대기</span>
            <strong>채널 답장 없음</strong>
            <small>실행하기 · 고쳐달라고 하기 · 보류하기 답장이 들어오면 여기에 쌓입니다.</small>
          </div>
        )}
      </section>
        </div>
      </details>

      <details className={styles.officeDeskFold}>
        <summary>
          <span>데스크 상세 관제</span>
          <small>
            실시간 업무 {liveCards.length}개 · 데스크 {desks.length}개 · 숨김 {hiddenDeskCount}개
          </small>
        </summary>
        <div className={styles.officeDeskFoldBody}>
          <section className={styles.liveQueue} aria-label="지금 보이는 일">
            <header data-live-queue-header-compact="count_status_only">
              <span>실시간 업무</span>
              <strong>{liveCards.length ? `${liveCards.length}개 작업 표시 중` : "진행 중인 실제 작업 없음"}</strong>
            </header>
            {liveCards.length ? (
              <ol>
                {liveCards.map((card) => (
                  <li
                    key={card.id}
                    data-status={card.status}
                    data-live-queue-row-compact="desk_title_status_only_details_inside"
                    data-live-queue-row-compact-summary={`${card.deskLabel} · ${card.title} · ${statusLabel[card.status]}`}
                    data-live-queue-row-external-mutation="false"
                  >
                    <span>{card.deskLabel}</span>
                    <div
                      className={styles.liveQueueMain}
                      aria-label={`${card.title} 실시간 업무 한 줄 요약`}
                      data-live-queue-row-main="one_line_summary_details_collapsed"
                    >
                      <strong>{card.title}</strong>
                      <small>{statusLabel[card.status]}</small>
                    </div>
                    <details
                      className={styles.liveQueueDetails}
                      aria-label={`${card.title} 실시간 업무 상세`}
                      data-live-queue-row-details="trigger_status_collapsed"
                      data-live-queue-row-details-external-mutation="false"
                    >
                      <summary>
                        <span>상세 보기</span>
                        <small>{card.triggerSource}</small>
                      </summary>
                      <p>{statusLabel[card.status]} · {card.triggerSource}</p>
                    </details>
                  </li>
                ))}
              </ol>
            ) : (
              <div
                className={styles.liveQueueEmpty}
                data-live-queue-empty="no_runtime_events_yet"
                data-live-queue-empty-external-mutation="false"
              >
                <span>대기</span>
                <strong>실시간 업무 없음</strong>
                <small>메일, 파일, 승인, 자동화 이벤트가 들어오면 여기에 쌓입니다.</small>
              </div>
            )}
          </section>

          <div className={styles.deskStrip} aria-label="현재 열린 데스크">
            {desks.map((desk) => (
              <article key={desk.id} className={styles.deskSlot} data-desk={desk.id}>
                <DeskGlyph deskId={desk.id} />
                <div>
                  <strong>{desk.shortLabel}</strong>
                  <span>{desk.cards.length ? `${desk.cards.length}개 업무` : "대기"}</span>
                </div>
              </article>
            ))}
          </div>

          <details className={styles.deskDetailsFold}>
            <summary>
              <span>업무실 상세</span>
              <small>{desks.length}개 열림 · {hiddenDeskCount}개 숨김</small>
            </summary>
            <div className={styles.grid}>
              {desks.map((desk) => (
                <article key={desk.id} className={styles.desk} aria-label={desk.label}>
                  <header className={styles.deskHead}>
                    <span className={styles.deskIcon} data-desk={desk.id} aria-hidden="true">
                      <DeskGlyph deskId={desk.id} />
                    </span>
                    <div className={styles.deskTitle}>
                      <strong>{desk.shortLabel}</strong>
                      <small>{desk.description}</small>
                    </div>
                  </header>

                  <dl className={styles.deskStats}>
                    <div>
                      <dt>처리중</dt>
                      <dd>{desk.busy}</dd>
                    </div>
                    <div>
                      <dt>완료</dt>
                      <dd className={styles.statSafe}>{desk.done}</dd>
                    </div>
                    <div>
                      <dt>확인</dt>
                      <dd className={desk.failed > 0 ? styles.statDanger : ""}>{desk.failed}</dd>
                    </div>
                  </dl>

                  {desk.cards.length === 0 ? (
                    <p className={styles.deskEmpty}>대기 중인 업무 없음</p>
                  ) : (
                    <ul className={styles.cardList}>
                      {desk.cards.map((card) => (
                        <li
                          key={card.id}
                          className={styles.card}
                          data-desk-card-compact="status_title_only_details_inside"
                          data-desk-card-compact-summary={`${statusLabel[card.status]} · ${card.title}`}
                          data-desk-card-external-mutation="false"
                        >
                          <div
                            className={styles.cardTop}
                            aria-label={`${card.title} 업무 카드 한 줄 요약`}
                            data-desk-card-main="status_title_details_collapsed"
                          >
                            <span className={`${styles.statusChip} ${styles[`status_${card.status}`]}`}>
                              {statusLabel[card.status]}
                            </span>
                            <strong className={styles.cardTitle}>{card.title}</strong>
                          </div>
                          <details
                            className={styles.cardDetails}
                            aria-label={`${card.title} 업무 카드 상세`}
                            data-desk-card-details="source_progress_next_desk_collapsed"
                            data-desk-card-details-external-mutation="false"
                          >
                            <summary>
                              <span>상세 보기</span>
                              <small>{card.ageMinutes}분 전</small>
                            </summary>
                            <small className={styles.cardSource}>{card.triggerSource}</small>
                            <div
                              className={styles.cardProgress}
                              aria-label={`${card.title} 진행률 ${statusProgress[card.status]}%`}
                            >
                              <i style={{ width: `${statusProgress[card.status]}%` }} />
                            </div>
                            {card.nextDesk ? (
                              <span className={styles.flow}>
                                다음: {deskLabels[card.nextDesk].short}
                              </span>
                            ) : null}
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </details>
        </div>
      </details>
      {hiddenDeskCount > 0 ? (
        <details className={styles.hiddenDesks}>
          <summary>숨겨진 데스크 {hiddenDeskCount}개</summary>
          <p>연결, 자료 학습, 승인 자동화를 켜면 필요한 데스크만 추가됩니다.</p>
        </details>
      ) : null}
    </section>
  );
}

function decisionLabel(decision: string): string {
  if (decision === "approved") return "실행하기";
  if (decision === "change_requested") return "고쳐달라고 하기";
  if (decision === "held") return "보류하기";
  if (decision === "rejected") return "거절하기";
  return "결정";
}

function approvalDecisionLabel(decision: string): string {
  if (decision === "approved") return "실행하기";
  if (decision === "change_requested") return "고쳐달라고 하기";
  if (decision === "rejected") return "거절하기";
  if (decision === "held") return "보류하기";
  return "처리 기록";
}

function delegationNextActionLabel(kind: string): string {
  if (kind === "execution_candidate") return "실행하기 준비";
  if (kind === "revision_request") return "고쳐달라고 하기";
  if (kind === "rejected_archive") return "거절 기록";
  if (kind === "review_hold") return "보류하기";
  return "다음 처리";
}

function delegationDecisionOutcomeDetail(artifact?: LocalMemoryDelegationArtifactRecord | null) {
  const workRecord = artifact?.relativePath ? officeMemoryReferenceLabel(artifact.relativePath) : "AI 팀원 결과 기록";
  const nextAction = artifact?.nextActionLabel || delegationNextActionLabel(artifact?.nextActionKind || "");
  return {
    workRecord,
    nextAction,
    decisionRecord: "결정 기록",
    queueRecord: "오피스 승인함",
  };
}

function DelegationDecisionActionGuide({ label }: { label: string }) {
  return (
    <section
      className={styles.delegationDecisionActionGuide}
      aria-label={`${label} 승인 결정 버튼 안내`}
      data-office-decision-actions="run_change_hold"
      data-delegation-decision-compact-path="result_decide_log_remember"
      data-first-visible-step="결과 확인"
      data-decision-step="실행하기|고쳐달라고 하기|보류하기"
      data-log-step="실행 로그 확인"
      data-save-step="다음부터 이렇게"
      data-execution-log="office_and_worker_log"
      data-next-pattern-save="manual_only"
      data-record-location-summary="approval_decision_queue_log_next_pattern"
      data-visible-records="결정 기록|승인 후보 기록|실행 로그|다음부터 이렇게"
      data-user-choice-required="true"
    >
      <span>지금 순서</span>
      <strong>결과 확인 -&gt; 결정 -&gt; 실행 로그 -&gt; 다음부터 이렇게</strong>
      <small>실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고르면 결정 기록과 실행 로그에 남깁니다. 마음에 드는 방식만 직접 저장합니다.</small>
      <div
        className={styles.delegationDecisionCompactPath}
        aria-label={`${label} 한 줄 처리 순서`}
        data-delegation-compact-path="result_open_decide_log_remember"
        data-visible-order="result|decision|log|remember"
        data-mobile-safe-width="390"
      >
        <b>결과 확인</b>
        <b>승인함 결정</b>
        <b>실행 로그</b>
        <b>다음부터 이렇게</b>
      </div>
      <ol className={styles.delegationDecisionRecordSummary} aria-label={`${label} 결정 기록 위치 한눈에`}>
        <li data-record="decision">
          <span>결정 기록</span>
          <strong>내가 고른 버튼</strong>
        </li>
        <li data-record="queue">
          <span>승인 후보 기록</span>
          <strong>오피스 승인함</strong>
        </li>
        <li data-record="log">
          <span>실행 로그</span>
          <strong>업무 기록</strong>
        </li>
        <li data-record="next">
          <span>다음부터 이렇게</span>
          <strong>직접 저장할 때만</strong>
        </li>
      </ol>
    </section>
  );
}

function DelegationDecisionOutcomeRail({
  artifact,
  label,
}: {
  artifact?: LocalMemoryDelegationArtifactRecord | null;
  label: string;
}) {
  const detail = delegationDecisionOutcomeDetail(artifact);
  return (
    <>
      <DelegationDecisionActionGuide label={label} />
      <ol
        className={styles.delegationDecisionOutcomeRail}
        aria-label={`${label} 결정 후 기록 경로`}
        data-delegation-decision-outcome="approval_decision_queue_execution_log_next_pattern"
        data-decision-record="ApprovalDecisions.md"
        data-action-queue-record="DelegationActionQueue.md"
        data-execution-log-record="office_and_worker_log"
        data-work-pattern-save="manual_next_time_only"
        data-final-action-lock="required_before_external_mutation"
        data-office-decision-language="run_change_hold_remember"
      >
        <li data-state="summary">
          <strong>승인함에서 확인</strong>
          <small>승인함에서 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고르고 마음에 드는 방식만 직접 저장합니다.</small>
        </li>
        <li data-state="decision">
          <strong>결정 기록</strong>
          <small>사용자가 고른 선택을 {detail.decisionRecord}에 남깁니다.</small>
        </li>
        <li data-state="queue">
          <strong>승인함 이어가기</strong>
          <small>다음 실행 후보는 {detail.queueRecord}에서 이어집니다.</small>
        </li>
        <li data-state="log">
          <strong>실행 로그 확인</strong>
          <small>{detail.workRecord} 기준으로 결정 기록과 AI 팀원 업무 기록을 다시 볼 수 있습니다.</small>
        </li>
        <li data-state="next">
          <strong>다음부터 이렇게</strong>
          <small>{detail.nextAction} 기준은 사용자가 저장할 때만 다음 요청에 참고합니다.</small>
        </li>
      </ol>
    </>
  );
}

function finalActionLabel(kind?: string): string {
  if (kind === "send_email") return "메일";
  if (kind === "send_bulk_email") return "대량 메일";
  if (kind === "scenario_review") return "검토";
  if (kind === "create_calendar_event") return "일정";
  if (kind === "connect_mailbox") return "웹메일";
  if (kind === "share_file") return "공유";
  return "실행";
}

function separatedMailOpsFinalActionKind(item: WorkItem): "calendar_event" | "mail_attachment_folder_plan" | "mail_send" | "other" {
  if (item.finalAction?.kind === "create_calendar_event") return "calendar_event";
  if (isMailAttachmentFolderPlanItem(item)) return "mail_attachment_folder_plan";
  if (item.finalAction?.kind === "send_email" || item.finalAction?.kind === "send_bulk_email") return "mail_send";
  return "other";
}

function separatedMailOpsFinalActionCopy(item: WorkItem): { label: string; title: string; detail: string; lockLabel: string } | null {
  const kind = separatedMailOpsFinalActionKind(item);
  if (kind === "calendar_event") {
    return {
      label: "일정 후보",
      title: "캘린더 등록 전 마지막 확인 카드",
      detail: "가능 시간, 참석자, 제목, 알림, 충돌 근거를 확인한 뒤에만 캘린더 등록 후보로 진행합니다.",
      lockLabel: "등록/초대 발송 잠금",
    };
  }
  if (kind === "mail_attachment_folder_plan") {
    return {
      label: "첨부 정리",
      title: "메일 첨부 로컬 사본 정리 최종 확인 카드",
      detail: "내려받은 로컬 사본의 대상 폴더, 충돌, 제외 항목을 확인한 뒤에만 이동/정리 후보로 진행합니다.",
      lockLabel: "이동/삭제/덮어쓰기 잠금",
    };
  }
  return null;
}

function isWebmailFallbackApprovalItem(item: WorkItem): boolean {
  return item.source === "webmail" || Boolean(item.webmailFallback) || item.finalAction?.kind === "connect_mailbox";
}

function webmailFallbackStatusLabel(status?: string): string {
  if (!status) return "확인 대기";
  if (/blocked|needs|missing|expired|login|2fa|auth|unsafe|rejected|unavailable/iu.test(status)) return "확인 필요";
  if (/captured|extracted|ready|work_ready|metadata/iu.test(status)) return "읽기 준비";
  if (/quiet|empty|no_new/iu.test(status)) return "새 업무 없음";
  return "점검 중";
}

function webmailFallbackStatusState(status?: string): FinalActionApprovalReviewItem["state"] {
  if (!status) return "locked";
  if (/blocked|needs|missing|expired|login|2fa|auth|unsafe|rejected|unavailable/iu.test(status)) return "review";
  if (/captured|extracted|ready|work_ready|metadata/iu.test(status)) return "safe";
  return "locked";
}

function buildWebmailFallbackStatusRail(item: WorkItem): FinalActionApprovalReviewItem[] {
  const fallback = item.webmailFallback;
  if (!isWebmailFallbackApprovalItem(item)) return [];
  const messageCount = fallback?.messageCount ?? 0;
  const ignoredItemsCount = fallback?.ignoredItemsCount ?? 0;
  const approvalQueueCount = fallback?.approvalQueueCount ?? 0;
  const attachmentCandidateCount = fallback?.attachmentCandidateCount ?? 0;
  const calendarCandidateCount = fallback?.calendarCandidateCount ?? 0;
  const bodyPreviewAllowedCount = fallback?.bodyPreviewAllowedCount ?? 0;
  const bodyPreviewSkippedBeforeBodyCount = fallback?.bodyPreviewSkippedBeforeBodyCount ?? 0;
  const classificationSummary = fallback?.classificationSummary || `목록 메타데이터 ${messageCount}건 점검`;
  const filterEvidenceLabel = fallback?.filterEvidenceLabel ||
    (ignoredItemsCount > 0
      ? `본문 preview 없이 ${ignoredItemsCount}건 제외`
      : "광고, 뉴스레터, 자동 알림은 본문을 읽기 전에 먼저 제외합니다.");
  const approvalEvidenceLabel = fallback?.approvalEvidenceLabel ||
    (approvalQueueCount > 0
      ? `승인 후보 ${approvalQueueCount}건을 승인함에만 분리`
      : "업무 후보가 생기면 승인함에만 올리고 즉시 실행하지 않습니다.");
  const finalActionLockLabel = fallback?.finalActionLockLabel ||
    "메일 발송, 캘린더 등록, 첨부 이동/삭제는 사용자 마지막 확인 전 잠금";
  const recoveryDetail = fallback?.domRecoveryNextAction || fallback?.domRecoveryReasonLabel ||
    "막힌 지점이 생기면 로그인/2차 인증/목록 화면 전환 같은 다음 조치를 여기서 보여줍니다.";
  return [
    {
      id: "login",
      label: "로그인",
      title: webmailFallbackStatusLabel(fallback?.planStatus || fallback?.status),
      detail: "아이디와 비밀번호 원문은 AI 화면에 올리지 않고 보관함 참조만 사용합니다.",
      state: webmailFallbackStatusState(fallback?.planStatus || fallback?.status),
    },
    {
      id: "screen",
      label: "목록",
      title: webmailFallbackStatusLabel(fallback?.domCaptureStatus),
      detail: messageCount > 0
        ? `${classificationSummary}. 본문과 raw HTML은 저장하지 않습니다.`
        : "브라우저에서 제목, 보낸 사람 라벨, 시간 같은 목록 정보만 읽습니다.",
      state: webmailFallbackStatusState(fallback?.domCaptureStatus),
    },
    {
      id: "recovery",
      label: "복구 안내",
      title: webmailFallbackStatusLabel(fallback?.domRecoveryStatus || fallback?.domCaptureStatus || fallback?.status),
      detail: recoveryDetail,
      state: webmailFallbackStatusState(fallback?.domRecoveryStatus || fallback?.domCaptureStatus || fallback?.status),
    },
    {
      id: "filter",
      label: "광고 제외",
      title: ignoredItemsCount > 0 ? `${ignoredItemsCount}건 제외` : "제외 기준 대기",
      detail: filterEvidenceLabel,
      state: ignoredItemsCount > 0 ? "safe" : messageCount > 0 ? "review" : "locked",
    },
    {
      id: "work",
      label: "업무 후보",
      title: approvalQueueCount > 0 ? `승인 후보 ${approvalQueueCount}건` : webmailFallbackStatusLabel(fallback?.domExtractionStatus || fallback?.status),
      detail: approvalEvidenceLabel,
      state: approvalQueueCount > 0 ? "review" : webmailFallbackStatusState(fallback?.domExtractionStatus || fallback?.status),
    },
    {
      id: "body-preview",
      label: "본문 확인",
      title: bodyPreviewAllowedCount > 0
        ? `업무 후보 ${bodyPreviewAllowedCount}건`
        : bodyPreviewSkippedBeforeBodyCount > 0
          ? "preview 전 제외 완료"
          : "제한 preview 대기",
      detail: bodyPreviewAllowedCount > 0 || bodyPreviewSkippedBeforeBodyCount > 0
        ? `업무 후보만 제한 preview · 광고/스팸 ${bodyPreviewSkippedBeforeBodyCount}건은 preview 전 제외`
        : "본문 원문과 raw HTML은 저장하지 않고, 업무 후보만 제한 preview로 확인합니다.",
      state: bodyPreviewAllowedCount > 0 ? "safe" : bodyPreviewSkippedBeforeBodyCount > 0 ? "safe" : "locked",
    },
    {
      id: "final-lock",
      label: "잠금",
      title: `${calendarCandidateCount}개 일정 · ${attachmentCandidateCount}개 첨부`,
      detail: finalActionLockLabel,
      state: webmailFallbackStatusState(fallback?.domExtractionStatus || fallback?.status),
    },
  ];
}

function mailAttachmentDownloadReviewInfo(item: WorkItem): { title: string; detail: string; lockLabel: string; handoffKind: string } | null {
  const evidence = item.sourceEvidence as WorkItem["sourceEvidence"] & {
    mailAttachmentOrganizer?: {
      contract?: string;
      messageSubject?: string;
      sourceMessageId?: string;
      attachmentCandidateCount?: number;
      downloadedAttachmentCount?: number;
      downloadStatus?: string;
      stagingHandoffKind?: string;
      stagingHandoffContract?: string;
      localCopyOnly?: boolean;
      originalMailMutation?: boolean;
      originalAttachmentDeleted?: boolean;
      externalShareBeforeApproval?: boolean;
    };
  };
  const organizer = evidence?.mailAttachmentOrganizer;
  if (!organizer) return null;
  const isPreDownloadReview =
    organizer.contract === "mail_attachment_download_to_local_folder_plan_approval" ||
    organizer.downloadStatus === "approval_required_before_download";
  if (!isPreDownloadReview) return null;
  const candidateCount = Number(organizer.attachmentCandidateCount ?? 0);
  const downloadedCount = Number(organizer.downloadedAttachmentCount ?? 0);
  const subject = organizer.messageSubject || item.sourceEvidence?.messageSubject || item.title;
  return {
    title: `${candidateCount > 0 ? `${candidateCount}개 후보` : "첨부 후보"} · ${subject}`,
    detail:
      downloadedCount > 0
        ? `로컬 사본 ${downloadedCount}개가 준비됐습니다. 원본 메일/첨부는 유지하고 폴더 정리 승인 카드 전까지 이동/삭제하지 않습니다.`
        : "사용자가 승인하면 첨부를 로컬 임시 폴더에만 내려받고, 내려받은 사본만 폴더 정리 승인 카드로 넘깁니다.",
    lockLabel: "다운로드·이동·삭제·공유는 승인 전 잠금",
    handoffKind: organizer.stagingHandoffKind || "stage_mail_attachments_folder_plan",
  };
}

function externalApprovalLabel(item: WorkItem): string {
  if (isWebmailFallbackApprovalItem(item)) return "웹메일 확인";
  if (item.browserTask?.stagedAction?.label) return "화면 확인";
  if (item.browserTask?.host) return "외부 계정";
  if (item.source === "web_page") return "웹 업무";
  return "보관함";
}

function isFolderPlanApprovalItem(item: WorkItem): boolean {
  const detectedLabels = item.sourceEvidence?.detectedIntentLabels ?? [];
  const approvalLabels = item.sourceEvidence?.approvalCandidateLabels ?? [];
  const text = [
    item.title,
    item.sourceLabel,
    item.senderLabel,
    item.summary,
    item.body,
    item.localFile?.name,
    item.localFile?.sizeLabel,
    item.localFile?.scopeKind,
    item.sourceEvidence?.draftPreview,
    ...detectedLabels,
    ...approvalLabels,
  ]
    .filter(Boolean)
    .join(" ");
  return /folder_plan|folder tidy|folder cleanup|cleanup|tidy|폴더 정리|로컬 폴더 정리|정리 계획|정리 후보/iu.test(text);
}

function isMailAttachmentFolderPlanItem(item: WorkItem): boolean {
  const evidence = item.sourceEvidence as WorkItem["sourceEvidence"] & {
    mailAttachmentOrganizer?: {
      contract?: string;
      messageSubject?: string;
      downloadedAttachmentCount?: number;
    };
  };
  const text = [
    item.title,
    item.sourceLabel,
    item.senderLabel,
    item.summary,
    item.body,
    evidence?.mailAttachmentOrganizer?.contract,
    evidence?.mailAttachmentOrganizer?.messageSubject,
    ...(item.sourceEvidence?.detectedIntentLabels ?? []),
    ...(item.sourceEvidence?.approvalCandidateLabels ?? []),
  ].filter(Boolean).join(" ");
  return /mail_attachment|메일 첨부|첨부 정리|downloaded_mail_attachment/iu.test(text);
}

function mailAttachmentFolderPlanTitle(item: WorkItem): string {
  const evidence = item.sourceEvidence as WorkItem["sourceEvidence"] & {
    mailAttachmentOrganizer?: {
      messageSubject?: string;
      downloadedAttachmentCount?: number;
      connectorId?: string;
      providerId?: string;
    };
  };
  const count = Number(evidence?.mailAttachmentOrganizer?.downloadedAttachmentCount ?? 0);
  const subject = evidence?.mailAttachmentOrganizer?.messageSubject || item.sourceEvidence?.messageSubject || item.title;
  const connectorRaw = evidence?.mailAttachmentOrganizer?.connectorId || evidence?.mailAttachmentOrganizer?.providerId || "메일함";
  const connector = officeUserFacingSourceLabel(connectorRaw);
  return `${connector} · ${count > 0 ? `${count}개 첨부` : "첨부 후보"} · ${subject}`;
}

function mailAutomationNotificationEvidence(item: WorkItem): NonNullable<WorkItem["sourceEvidence"]>["mailAutomationNotificationDraft"] | null {
  return item.sourceEvidence?.mailAutomationNotificationDraft ?? null;
}

function isMailAutomationNotificationItem(item: WorkItem): boolean {
  if (mailAutomationNotificationEvidence(item)) return true;
  const text = [
    item.id,
    item.title,
    item.sourceLabel,
    item.sourceEvidence?.connectorId,
    item.sourceEvidence?.providerId,
    ...(item.sourceEvidence?.detectedIntentLabels ?? []),
    ...(item.sourceEvidence?.approvalCandidateLabels ?? []),
  ].filter(Boolean).join(" ");
  return /mail-automation-notification|mail_automation_runner|메일 자동 점검|알림 초안/iu.test(text);
}

function mailAutomationNotificationSummary(item: WorkItem): string {
  const evidence = mailAutomationNotificationEvidence(item);
  const approvalQueueCount = Number(evidence?.approvalQueueCount ?? 0);
  const ignoredMailCount = Number(evidence?.ignoredMailCount ?? 0);
  const calendarCandidateCount = Number(evidence?.calendarCandidateCount ?? 0);
  const attachmentCandidateCount = Number(evidence?.attachmentCandidateCount ?? 0);
  return [
    approvalQueueCount > 0 ? `승인 후보 ${approvalQueueCount}건` : "승인 후보 없음",
    ignoredMailCount > 0 ? `광고/스팸 제외 ${ignoredMailCount}건` : "",
    calendarCandidateCount > 0 ? `일정 ${calendarCandidateCount}건` : "",
    attachmentCandidateCount > 0 ? `첨부 ${attachmentCandidateCount}건` : "",
  ].filter(Boolean).join(" · ");
}

function mailAutomationNotificationDigestItems(item: WorkItem): string[] {
  const evidence = mailAutomationNotificationEvidence(item);
  if (!evidence) return [];
  return [
    evidence.triageDistributionLabel,
    evidence.importantWorkLabel,
    evidence.learningRuleEvidenceLabel,
    evidence.bodyPreviewPolicy ? "광고/스팸은 본문 전에 제외" : "",
    ...(evidence.learningRuleEvidenceLabels ?? []).slice(0, 2),
    ...(evidence.importantCandidateLabels ?? []).slice(0, 2),
  ].filter((label): label is string => Boolean(label));
}

function mailAutomationNotificationWorkflowItems(
  item: WorkItem,
  externalState: "connected" | "needs_setup",
): Array<{ id: string; label: string; title: string; detail: string; state: string }> {
  const evidence = mailAutomationNotificationEvidence(item);
  const approvalQueueCount = Number(evidence?.approvalQueueCount ?? 0);
  const ignoredMailCount = Number(evidence?.ignoredMailCount ?? 0);
  const learningLabel = evidence?.learningRuleEvidenceLabel || "";
  const filteringDetail = ignoredMailCount > 0
    ? `광고/뉴스레터 ${ignoredMailCount}건은 본문 전에 제외`
    : evidence?.bodyPreviewPolicy ? "광고/스팸은 본문 전에 제외" : "업무 후보만 제한 확인";
  return [
    {
      id: "learning",
      label: "01",
      title: "학습 기준",
      detail: learningLabel || "초기 학습 전에도 기본 제외 기준으로 점검",
      state: learningLabel ? "ready" : "review",
    },
    {
      id: "filtering",
      label: "02",
      title: "필터링",
      detail: filteringDetail,
      state: ignoredMailCount > 0 || evidence?.bodyPreviewPolicy ? "ready" : "review",
    },
    {
      id: "approval",
      label: "03",
      title: "승인함",
      detail: approvalQueueCount > 0 ? `${approvalQueueCount}건을 앱 승인함에 먼저 정지` : "승인 후보가 생기면 앱에 먼저 정지",
      state: approvalQueueCount > 0 ? "approval" : "review",
    },
    {
      id: "notification",
      label: "04",
      title: "알림·답장",
      detail: externalState === "connected"
        ? "사용자가 보낸 알림과 휴대폰 답장만 같은 후보에 기록"
        : "외부 채널 없이도 앱 안에서 처리 가능",
      state: externalState === "connected" ? "ready" : "setup",
    },
    {
      id: "final-lock",
      label: "05",
      title: "최종 확인",
      detail: "발송, 일정 등록, 첨부 이동은 마지막 확인 전 잠금",
      state: "locked",
    },
  ];
}

function mailAutomationNotificationCalendarHandoffItems(
  item: WorkItem,
): Array<{ id: string; title: string; detail: string; state: string }> {
  const evidence = mailAutomationNotificationEvidence(item);
  const calendarCandidateCount = Number(evidence?.calendarCandidateCount ?? 0);
  if (calendarCandidateCount <= 0) return [];
  return [
    {
      id: "meeting-detect",
      title: "미팅 메일",
      detail: `일정 후보 ${calendarCandidateCount}건은 메일 문맥에서 분리합니다.`,
      state: "ready",
    },
    {
      id: "freebusy",
      title: "free/busy 확인",
      detail: "캘린더 연결 뒤 가능한 시간과 충돌 근거만 먼저 확인합니다.",
      state: "review",
    },
    {
      id: "candidate",
      title: "일정 후보",
      detail: "제목, 시간, 참석자, 장소, 알림을 앱 승인함에서 다시 확인합니다.",
      state: "approval",
    },
    {
      id: "final-lock",
      title: "승인 후 등록",
      detail: "최종 확인 전까지 캘린더 등록과 초대 발송은 잠겨 있습니다.",
      state: "locked",
    },
  ];
}

function mailAutomationNotificationAttachmentHandoffItems(
  item: WorkItem,
): Array<{ id: string; title: string; detail: string; state: string }> {
  const evidence = mailAutomationNotificationEvidence(item);
  const attachmentCandidateCount = Number(evidence?.attachmentCandidateCount ?? 0);
  if (attachmentCandidateCount <= 0) return [];
  return [
    {
      id: "download-review",
      title: "다운로드 검토",
      detail: `첨부 후보 ${attachmentCandidateCount}건은 사용자가 확인한 뒤 내려받습니다.`,
      state: "review",
    },
    {
      id: "local-copy",
      title: "로컬 사본만",
      detail: "원본 메일과 원본 첨부는 바꾸지 않고 로컬 사본만 정리 후보로 둡니다.",
      state: "ready",
    },
    {
      id: "folder-plan",
      title: "정리 승인 카드",
      detail: "대상 폴더, 충돌, 제외 항목을 오피스 승인함에서 마지막 확인합니다.",
      state: "approval",
    },
    {
      id: "final-lock",
      title: "이동/삭제 잠금",
      detail: "최종 확인 전까지 이동, 삭제, 덮어쓰기, 외부 공유를 실행하지 않습니다.",
      state: "locked",
    },
  ];
}

function mailAutomationNotificationChannelState(
  connections: NonNullable<Props["messengerConnections"]>,
): {
  externalState: "connected" | "needs_setup";
  externalLabel: string;
  externalDetail: string;
  routeDetail: string;
} {
  const connectedExternal = connections.filter(
    (connection) => connection.connectorId && connection.id !== "app-main-control" && connection.state === "connected",
  );
  if (connectedExternal.length) {
    const labels = connectedExternal.map((connection) => connection.label).slice(0, 3).join(" · ");
    return {
      externalState: "connected",
      externalLabel: "외부 알림 연결됨",
      externalDetail: `${labels} · 사용자가 알림 보내기를 누를 때만 승인 후보 요약을 보냅니다.`,
      routeDetail: "앱 승인함에 먼저 멈춘 뒤 연결 채널로 요약만 보냅니다.",
    };
  }
  return {
    externalState: "needs_setup",
    externalLabel: "외부 알림 연결 필요",
    externalDetail: "Telegram 같은 채널을 연결하지 않아도 앱 승인함에서 먼저 처리할 수 있습니다.",
    routeDetail: "기본 경로는 앱 승인함입니다. 외부 알림은 선택 설정입니다.",
  };
}

function mailAutomationNotificationDecisionPathItems(
  item: WorkItem,
  externalState: "connected" | "needs_setup",
): Array<{ id: string; label: string; title: string; detail: string; state: string }> {
  const evidence = mailAutomationNotificationEvidence(item);
  const approvalQueueCount = Number(evidence?.approvalQueueCount ?? 0);
  const approvalLabel = approvalQueueCount > 0 ? `${approvalQueueCount}건 후보` : "후보 확인";
  const externalReady = externalState === "connected";
  return [
    {
      id: "app-inbox",
      label: "1",
      title: "앱 승인함",
      detail: `${approvalLabel}를 먼저 올리고 광고/스팸은 제외 근거만 남깁니다.`,
      state: "ready",
    },
    {
      id: "phone-reply",
      label: "2",
      title: externalReady ? "휴대폰 답장" : "알림 연결 선택",
      detail: externalReady
        ? "승인 A1 같은 답장은 같은 승인 후보에만 기록됩니다."
        : "연결 전에도 앱 승인함에서 승인, 수정, 보류를 처리할 수 있습니다.",
      state: externalReady ? "ready" : "setup",
    },
    {
      id: "final-confirmation",
      label: "3",
      title: "앱 마지막 확인",
      detail: "수신자, 일정, 첨부를 다시 확인하기 전까지 외부 실행은 잠겨 있습니다.",
      state: "locked",
    },
  ];
}

function mailAutomationNotificationConnectHref(item: WorkItem): string {
  const params = new URLSearchParams({
    preview: "workbench",
    singleSetting: "messenger-channel",
    from: "mail-automation-notification",
    notificationDraft: "mail-automation",
    goal: "메일 자동 점검 앱 알림 초안을 외부 알림 채널로 이어갑니다",
    returnTo: "/office?preview=workbench&view=approval#learned-draft-approval",
  });
  if (item.id) params.set("workItemId", item.id);
  return `/connect?${params.toString()}`;
}

function learnedDraftApprovalLabel(item: WorkItem): string {
  if (isMailAutomationNotificationItem(item)) return "메일 자동 점검";
  if (isMailAttachmentFolderPlanItem(item)) return "메일 첨부 정리";
  if (isFolderPlanApprovalItem(item)) return "폴더 정리";
  if (item.draft?.operationKind === "draft_reply") return "메일 초안";
  if (item.draft?.operationKind === "draft_calendar_event") return "일정 초안";
  if (item.localFile?.extension) return `${item.localFile.extension.toUpperCase()} 초안`;
  return "보고서 초안";
}

function folderPlanDecisionRailItems(item: WorkItem): Array<{ state: string; title: string; detail: string }> {
  const reportLabel = item.localFile?.name || "정리 계획 보고서";
  return [
    {
      state: "apply",
      title: "실행하기",
      detail: "적용 전 제외/충돌 확인을 끝내고 정리 적용 승인 문구를 거친 뒤에만 이동·정리 후보를 실행합니다.",
    },
    {
      state: "hold",
      title: "고쳐달라고 하기 · 보류하기",
      detail: "고쳐달라고 하기는 실행 전 검토로 되돌리고, 보류하면 원본 변경 없이 후보와 보고서만 업무 기록으로 남깁니다.",
    },
    {
      state: "revert",
      title: "되돌리기 안내",
      detail: "적용 기록 파일이 있을 때만 되돌리기 기록 파일을 만들고 되돌립니다.",
    },
    {
      state: "log",
      title: "기록 파일",
      detail: `${reportLabel}, 적용 기록 파일, 되돌리기 기록 파일을 오피스 승인함에서 확인합니다.`,
    },
  ];
}

function learnedDraftFinalGateSteps(item: WorkItem): Array<{ label: string; title: string; detail: string; state: string }> {
  if (isMailAutomationNotificationItem(item)) {
    const evidence = mailAutomationNotificationEvidence(item);
    return [
      {
        label: "1",
        title: "점검 요약",
        detail:
          evidence?.triageDistributionLabel ||
          mailAutomationNotificationSummary(item) ||
          "메일함 자동 점검 결과를 승인함 카드로 먼저 확인합니다.",
        state: "review",
      },
      {
        label: "2",
        title: "알림 후보",
        detail: [
          evidence?.channelSummary || "앱 승인함",
          evidence?.actionLabel || "승인함에서 확인",
          evidence?.importantWorkLabel,
        ].filter(Boolean).join(" · "),
        state: "approval",
      },
      {
        label: "3",
        title: "실행 잠금",
        detail: "메일 발송, 일정 등록, 첨부 이동/삭제는 앱 마지막 확인 전까지 실행하지 않습니다.",
        state: "locked",
      },
    ];
  }
  if (item.draft?.operationKind === "draft_reply") {
    return [
      { label: "1", title: "초안 확인", detail: "본문, 근거, 민감정보를 먼저 확인합니다.", state: "review" },
      { label: "2", title: "메일 발송 마지막 확인 카드", detail: "승인하면 마지막 확인 준비 후보로 이동합니다.", state: "approval" },
      { label: "3", title: "발송 잠금", detail: "수신자, 제목, 본문 검토 전까지 발송하지 않습니다.", state: "locked" },
    ];
  }
  if (item.draft?.operationKind === "draft_calendar_event") {
    return [
      { label: "1", title: "초안 확인", detail: "시간, 참석자, 장소 후보를 먼저 확인합니다.", state: "review" },
      { label: "2", title: "일정 등록 마지막 확인 카드", detail: "승인하면 마지막 확인 준비 후보로 이동합니다.", state: "approval" },
      { label: "3", title: "등록 잠금", detail: "초대 발송과 캘린더 등록은 마지막 확인 전까지 잠급니다.", state: "locked" },
    ];
  }
  return [
    { label: "1", title: "초안 확인", detail: "본문과 출처를 읽고 승인 여부를 고릅니다.", state: "review" },
    { label: "2", title: "승인 결과 카드", detail: "승인하면 로컬 문서 위치와 다시 확인할 항목을 보여줍니다.", state: "approval" },
    { label: "3", title: "저장/공유 잠금", detail: "원본 변경, 제출, 외부 공유는 별도 최종 확인 전까지 잠급니다.", state: "locked" },
  ];
}

function approvedOutputLabel(item: WorkItem): string {
  if (item.approvedOutput?.alternatePaths?.some((output) => output.kind.startsWith("excel_compatible"))) return "Excel 호환";
  if (item.approvedOutput?.alternatePaths?.some((output) => output.kind === "word_compatible_html")) return "Word 호환";
  if (item.approvedOutput?.kind === "approved_draft_markdown") return "Markdown";
  return "문서 결과";
}

function approvedOutputSafetySteps(item: WorkItem): Array<{ label: string; title: string; detail: string; state: string }> {
  const folder = approvedOutputFolderLabel(item.approvedOutput?.folder) || "앱 문서 폴더";
  return [
    { label: "1", title: "로컬 결과 저장", detail: `${folder}에 승인본 위치를 기록했습니다.`, state: "saved" },
    { label: "2", title: "원본 변경 없음", detail: "원본 파일 이동, 삭제, 덮어쓰기는 실행하지 않았습니다.", state: "safe" },
    { label: "3", title: "공유/제출 잠금", detail: "외부 공유, 제출, 발송은 최종 확인 카드 전까지 잠급니다.", state: "locked" },
  ];
}

function approvedOutputFolderLabel(folder?: string): string {
  if (!folder) return "";
  if (folder.includes("memory/work-patterns")) return "지난 업무 기억";
  return folder;
}

function officeMemoryReferenceLabel(path?: string): string {
  const value = String(path ?? "");
  if (!value) return "업무 기록";
  if (/DecisionMemory|DecisionLog/iu.test(value)) return "결정 기록";
  if (/WorkPatternMemory|memory\/work-patterns/iu.test(value)) return "지난 업무 기억";
  if (/PromptMemory|memory\/prompt/iu.test(value)) return "답변 기준 기억";
  if (/CrewSoul|memory\/crew-souls|CrewChannel/iu.test(value)) return "AI 팀원 기억";
  if (/SkillGrowth|SkillBridge|SkillBootstrap|SkillSourceInventory|memory\/growth/iu.test(value)) return "업무 도구 이어쓰기 기록";
  if (/final-actions|audit/iu.test(value)) return "최종 실행 감사 기록";
  if (/DelegationArtifacts|delegation/iu.test(value)) return "AI 팀원 결과 기록";
  return value.includes("memory/") ? "로컬 기억 기록" : value;
}

function officeIdentityFileDisplayLabel(file: LocalMemoryIdentityFile): string {
  const key = `${file.kind} ${file.relativePath} ${file.label}`.toLowerCase();
  if (/crewchannelindex|crew channel index|crewchannel/iu.test(key)) return "AI 팀원 목록";
  if (/crewchannels?blueprint|blueprint/iu.test(key)) return "AI 팀원 기준";
  if (/crewsoul|crew-souls/iu.test(key)) return "AI 팀원 업무 방식";
  if (/promptmemory|prompt memory|prompt/iu.test(key)) return "답변 기준";
  if (/worklog|work log/iu.test(key)) return "작업 기록";
  if (/decisionmemory|decisionlog|approvaldecisions|decision/iu.test(key)) return "결정 기록";
  if (/conversationdigest|conversation/iu.test(key)) return "대화 요약 기억";
  if (/skillgrowth|skillbridge|skillbootstrap|skillsourceinventory|growth|skill/iu.test(key)) return "업무 도구 이어쓰기 기록";
  if (/manifest|restore/iu.test(key)) return "새 PC 이어쓰기 안내";
  return officeMemoryReferenceLabel(file.relativePath);
}

function officeIdentityFileDetailLabel(file: LocalMemoryIdentityFile): string {
  const owner = file.teammateId ? "팀원별" : "앱 전체";
  const state = file.state === "ready" ? "이어쓰기 준비됨" : "앱 프로필 저장 후 생성";
  return `${owner} 기억 · ${state}`;
}

function officeSkillSourceKindLabel(kind?: string): string {
  const normalized = String(kind ?? "").toLowerCase();
  if (/external|route|tool|connector|oauth|account|mail|calendar/u.test(normalized)) return "외부 연결 확인";
  if (/built|builtin|app|default/u.test(normalized)) return "앱 기본 도구";
  if (/memory|folder|profile|local/u.test(normalized)) return "내 PC 기억";
  if (/growth|skill|bridge|custom|crewkit/u.test(normalized)) return "저장한 업무 방식";
  return "업무 도구";
}

function officeSkillRestoreModeLabel(mode?: string): string {
  const normalized = String(mode ?? "").toLowerCase();
  if (/active|auto/u.test(normalized)) return "켜 둔 도구 이어쓰기";
  if (/recommend|candidate/u.test(normalized)) return "추천 후보로 보관";
  if (/folder|memory|rehydrate|read/u.test(normalized)) return "기억 폴더 선택 후 이어쓰기";
  if (/manifest|reference/u.test(normalized)) return "이어쓰기 안내에 기록";
  return "이어쓰기 후보";
}

function officeConnectorIdLabel(connectorId?: string): string {
  const value = String(connectorId ?? "").trim();
  const normalized = value.toLowerCase();
  if (!normalized) return "필요 연결";
  if (/company-mail|mailops|imap|smtp/u.test(normalized)) return "회사 메일";
  if (/gmail|google-mail/u.test(normalized)) return "Gmail";
  if (/outlook.*mail|microsoft.*mail/u.test(normalized)) return "Outlook 메일";
  if (/google-calendar/u.test(normalized)) return "Google 캘린더";
  if (/outlook.*calendar|microsoft.*calendar/u.test(normalized)) return "Outlook 캘린더";
  if (/calendar/u.test(normalized)) return "캘린더";
  if (/google-drive|drive/u.test(normalized)) return "드라이브";
  if (/local-folder|folder-index|document-learning/u.test(normalized)) return "내 PC 폴더";
  if (/computer|desktop|browser/u.test(normalized)) return "내 PC 작업";
  if (/slack/u.test(normalized)) return "Slack";
  if (/teams/u.test(normalized)) return "Teams";
  if (/telegram/u.test(normalized)) return "Telegram";
  if (/discord/u.test(normalized)) return "Discord";
  if (/notion/u.test(normalized)) return "Notion";
  if (/sharepoint/u.test(normalized)) return "SharePoint";
  return value.replace(/[-_]+/gu, " ").replace(/\b\w/gu, (match) => match.toUpperCase());
}

function officeExternalToolHintLabel(hint?: string): string {
  const value = String(hint ?? "").trim();
  const normalized = value.toLowerCase();
  if (!normalized) return "외부 계정 확인";
  if (/spreadsheet|sheet|excel|xlsx|표|정산/u.test(normalized)) return "표/정산 자료";
  if (/presentation|powerpoint|ppt|slide|deck|canva|figma|발표/u.test(normalized)) return "발표자료";
  if (/document|word|docx|hwp|pdf|문서/u.test(normalized)) return "문서 자료";
  if (/analytics|analysis|data|리포트|분석/u.test(normalized)) return "데이터 분석";
  if (/video|render|remotion|영상/u.test(normalized)) return "영상 제작";
  if (/codex|git|python|cli|terminal|repo|개발/u.test(normalized)) return "작업 준비 확인";
  if (/computer|desktop|browser|folder|file|pc/u.test(normalized)) return "내 PC 작업";
  if (/drive|notion|slack|gmail|calendar|mail/u.test(normalized)) return "업무 계정 연결";
  return value;
}

function officeUserFacingSourceLabel(value?: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "업무 카드";
  return raw
    .replace(/custom-imap-mail/giu, "회사 메일")
    .replace(/desktop_control/giu, "내 PC 작업 도우미")
    .replace(/external-account-vault/giu, "계정 보관함")
    .replace(/google-drive/giu, "드라이브")
    .replace(/company-mail/giu, "회사 메일")
    .replace(/oauth_or_smtp/giu, "메일 연결")
    .replace(/OAuth,\s*IMAP/giu, "메일 계정")
    .replace(/\bIMAP\b/giu, "메일 계정")
    .replace(/\bOAuth\b/giu, "계정 연결");
}

function officeSingleSettingHref(singleSetting: string, goal: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    preview: "workbench",
    panel: singleSetting === "computer-use" ? "control" : "connect",
    singleSetting,
    goal,
    from: "office",
    ...extra,
  });
  if (singleSetting === "vault") params.set("externalAccounts", "1");
  if (singleSetting === "computer-use") params.set("computerUse", "1");
  return `/?${params.toString()}`;
}

function dryRunStatusLabel(status?: string): string {
  if (status === "final_action_dry_run_ready") return "실행 전 검토 준비 완료";
  if (status === "final_action_dry_run_needs_input") return "확인값 필요";
  if (status === "final_action_dry_run_blocked") return "연결 필요";
  if (status === "not_final_action") return "실행 후보 아님";
  return "검증 결과";
}

function finalDryRunSafetyCheckLabel(check: string): string {
  if (check === "recipient_confirmed_by_user") return "수신자를 사용자가 직접 확인";
  if (check === "cc_bcc_reviewed_by_user") return "참조/숨은참조/전체발송 여부 확인";
  if (check === "mail_thread_recipient_decision_reviewed") return "메일 스레드 수신자 판단 근거 검토";
  if (check === "office_final_confirmation_required") return "오피스 마지막 확인 전 외부 실행 차단";
  if (check === "recipient_addresses_not_returned_to_renderer") return "수신자 주소 원문 화면 노출 제한";
  if (check === "exclusions_and_duplicates_reviewed") return "제외/중복 대상 검토";
  if (check === "sample_body_reviewed") return "샘플 본문 검토";
  return check.replace(/_/gu, " ");
}

function executionStatusLabel(status?: string): string {
  const dispatch = mailDispatchReviewState(status);
  if (dispatch.label) return dispatch.label;
  if (status === "final_execution_live_adapter_required") return "실제 실행 잠김";
  if (status === "final_execution_confirmation_required") return "최종 조건 부족";
  if (status === "final_execution_provider_dispatched") return "실제 처리 요청 완료";
  if (status === "not_final_action") return "실행 후보 아님";
  return "마지막 확인 결과";
}

function artifactKindLabel(kind: string): string {
  if (kind === "mail") return "메일";
  if (kind === "approval") return "승인";
  return "보고서";
}

function artifactQueueLabel(artifact: LocalMemoryDelegationArtifactRecord): string {
  return metricText(artifact.metrics?.queueLabel);
}

function artifactOutputKind(artifact: LocalMemoryDelegationArtifactRecord): string {
  return metricText(artifact.metrics?.outputKind);
}

function artifactApprovalRequired(artifact: LocalMemoryDelegationArtifactRecord): boolean {
  return artifact.metrics?.approvalRequired === true || artifact.metrics?.approvalRequired === "true";
}

function outputKindLabel(kind: string): string {
  if (kind === "delegated_channel_answer") return "AI 팀원 답변";
  if (kind === "document_draft") return "문서 초안";
  if (kind === "deck_brief") return "PPT 목차";
  if (kind === "video_brief") return "영상 제작";
  if (kind === "toolchain_queue") return "작업 준비";
  if (kind === "knowledge_ingest") return "지식 학습";
  if (kind === "mailops_queue") return "메일 승인";
  if (kind === "folder_plan") return "정리 계획";
  if (kind === "skill_growth") return "업무 도구";
  return kind;
}

function metricText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function DeskGlyph({ deskId }: { deskId: Desk["id"] }) {
  return (
    <svg className={styles.glyph} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {deskId === "calendar" ? (
        <>
          <path d="M6 7.5h12M8.5 4.5v4M15.5 4.5v4" />
          <path d="M6.5 5.5h11v14h-11z" />
        </>
      ) : deskId === "document" ? (
        <>
          <path d="M7 4h6l4 4v12H7z" />
          <path d="M13 4v4h4M9.5 12h5M9.5 15h4" />
        </>
      ) : deskId === "approval" || deskId === "guard" ? (
        <path d="M12 3.8 18 6v5.2c0 3.6-2.4 6.8-6 8.4-3.6-1.6-6-4.8-6-8.4V6l6-2.2Z" />
      ) : deskId === "ops" ? (
        <>
          <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
          <path d="M8.2 8.2 6.1 6.1M15.8 15.8l2.1 2.1M15.8 8.2l2.1-2.1M8.2 15.8l-2.1 2.1" />
        </>
      ) : (
        <>
          <path d="M4.5 7h15v10h-15z" />
          <path d="m5 8 7 5 7-5" />
        </>
      )}
    </svg>
  );
}
