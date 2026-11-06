"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfficeBoard } from "@/components/OfficeBoard";
import { MailReplyReview } from "@/components/MailReplyReview";
import { mailDispatchReviewState } from "@/lib/mail-dispatch-ui.mjs";
import { TaskBoard } from "@/components/TaskBoard";
import { AuditTimeline } from "@/components/AuditTimeline";
import {
  createDesktopBridge,
  type DesktopBridgeApi,
  type DesktopControlCapabilityId,
  type DesktopControlDispatchResult,
  type DocumentLearningFileRecord,
  type DocumentLearningFolderPlanApplyResult,
  type DocumentLearningFolderPlanPreviewResult,
  type FinalActionDryRunResult,
  type FinalActionExecutionResult,
  type FinalActionKind,
  type FinalConfirmationContract,
  type FinalConfirmationPrepareOptions,
  type ApprovalNotificationResult,
  type ConnectorStatusRecord,
  type LocalMemoryDelegationApprovalDecision,
  type LocalMemoryDelegationArtifactRecord,
  type LocalMemoryCrewSoulBundle,
  type LocalMemoryGrowthSuggestion,
  type LocalMemoryIdentityFile,
  type LocalMemorySkillSource,
  type LocalMemoryWorkDecisionInput,
} from "@/lib/desktop-bridge";
import { useThemeMode } from "@/lib/theme-mode";
import {
  aiTeammateTemplates,
  createAITeammateFromTemplate,
  defaultAITeammateId,
  normalizeAITeammates,
  readAITeammates,
  saveAITeammates,
  type AITeammate,
  type AITeammateTeam,
} from "@/lib/ai-teammates";
import { OfficeScene, type OfficeSceneHireSlot, type OfficeSceneMember } from "@/components/OfficeScene";
import roomPage from "./office-room-page.module.css";
import OfficeDisplaySettings from "@/components/OfficeDisplaySettings";
import { TeammateProfileDrawer } from "@/components/TeammateProfileDrawer";
import type { TeammateSceneStatus } from "@/lib/teammate-appearance";
import {
  defaultMessengerChannels,
  readActiveMessengerChannelIds,
  summarizeMessengerConnections,
} from "@/lib/messaging-channels";
import {
  defaultFolderPlanApprovalOptions,
  folderPlanCollisionPolicyLabel,
  parseFolderPlanExcludedKeywords,
  readFolderPlanApprovalOptionsHandoff,
  type FolderPlanApprovalOptions,
  type FolderPlanCollisionPolicy,
} from "@/lib/folder-plan-approval-options";
import { deskLabels, type AuditEvent, type Desk, type DeskCardStatus } from "@/lib/office";
import {
  FINAL_LIVE_EXECUTION_PHRASE,
  disableFinalLiveExecution,
  enableFinalLiveExecution,
  readFinalExecutionSettings,
  type FinalExecutionSettings,
} from "@/lib/final-execution-settings";
import type { WorkItem } from "@/lib/types";
import {
  activateFeature,
  countActiveFeatures,
  featureCatalog,
  isFeatureActive,
  readFeatureActivationRecords,
  type ModyFeatureActivationRecord,
} from "@/lib/feature-activation";
import { readLocalAutomationRules } from "@/lib/local-automation-rules";
import { findExactMailWorkQueueRecord, findMailSendHoldVeto } from "@/lib/mail-send-approval-intent";
import {
  applyMailCardAssigneeLocally,
  buildMailCardAssigneeOptions,
  selectApprovalCardsForDisplay,
} from "@/lib/mail-card-triage";
import {
  createHomeApprovalDecisionReceipt,
  writeHomeApprovalDecisionReceipt,
  type HomeApprovalDecisionReceiptSource,
} from "@/lib/approval-decision-receipts";
import { officeWorkMotionForEvent, officeWorkMotionExpiry } from "@/lib/office-work-motion";
import {
  readSelectedWorkActionEvents,
  recordSelectedWorkActionEvent,
  type SelectedWorkActionEvent,
} from "@/lib/selected-work-action-events";
import { createMailOpsWorkQueueReviewVirtualOfficeEvent } from "@/lib/virtual-office-events";
import {
  WORK_AUTOMATION_APPROVAL_GATE_CONTRACT,
  WORK_AUTOMATION_MAILOPS_ENGINE_PATH,
  WORK_AUTOMATION_MAILOPS_WORK_QUEUE_PROOF_LABEL,
  WORK_AUTOMATION_WORK_QUEUE_HANDOFF_CONTRACT,
} from "@/lib/work-automation-engine";
import {
  isUserComposedMailApprovalWorkItem,
  mergeUserComposedMailApprovalWorkItems,
  readUserComposedMailApprovalWorkItems,
} from "@/lib/user-composed-mail-approval";
import {
  mergeRoleCommandApprovalWorkItems,
  readRoleCommandApprovalWorkItems,
} from "@/lib/role-command-approval-handoff";
import { navigateInternalPath } from "@/lib/safe-navigation";
import styles from "./page.module.css";

const officeFinalActionFocusStorageKey = "modycrew-office-final-action-focus-v1";
const officeExecutionLogFocusStorageKey = "modycrew-office-execution-log-focus-v1";
const officeChannelQueueFocusStorageKey = "modycrew-office-channel-queue-focus-v1";
const officeLearnedDraftFocusStorageKey = "modycrew-office-learned-draft-focus-v1";
const mailOpsWorkQueueReviewStorageKey = "modycrew-mailops-work-queue-review-v1";
const mailOpsWorkQueueReviewContextContract = "local_review_to_approval_candidate_context";

type MailOpsDecision = "approved" | "change_requested" | "held";
type MailOpsWorkQueueDecision = "approve" | "revise" | "hold" | "exclude";
type MailOpsWorkQueueReviewRecord = {
  itemId: string;
  title: string;
  category: string;
  decision: MailOpsWorkQueueDecision;
  note: string;
  revisedDraft?: string;
  previewId?: string;
  approvalPreviewId?: string;
  approvalWorkItemId?: string;
  decisionReasonSummary?: string;
  sendCheckSummary?: string;
  finalConfirmationRoute?: "included" | "held" | "excluded";
  draftBodySource?: "user_revised_draft" | "review_note" | "approval_preview" | "classification";
  updatedAt: string;
  approvalContext: typeof mailOpsWorkQueueReviewContextContract;
  externalMutation: false;
};
type ConnectionRecoveryHandoff = {
  source: "connect-recovery";
  connectorId: string;
  connectorLabel: string;
};

type OfficeExecutionLogFocus = {
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
};

const liveDesks: Desk[] = (Object.entries(deskLabels) as Array<[Desk["id"], typeof deskLabels[Desk["id"]]]>).map(
  ([id, label]) => ({
    id,
    label: label.label,
    shortLabel: label.short,
    description: label.description,
    busy: 0,
    done: 0,
    failed: 0,
    cards: [],
  }),
);

type ChannelQueueItem = {
  workEvent?: SelectedWorkActionEvent;
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
  };

type ChannelQueueFocus = {
  sourceThreadId: string;
  sourceTeammateId: string;
  sourceTeammateName: string;
  targetTeammateIds: string[];
  targetLabels: string[];
  requestText: string;
  createdAt: number;
};

type LearnedDraftFocus = {
  workItemId: string;
  draftCount: number;
  sourceLabel: string;
  nextUserChoice: string;
  createdAt: number;
};

function createMailAutomationNotificationDispatchReceipt(result: ApprovalNotificationResult) {
  const targetIds = (result.notificationTargetIds ?? []).filter(Boolean).slice(0, 5);
  return {
    status: result.status,
    targetCount: (result.notificationTargetCount ?? targetIds.length) || 1,
    targetIds,
    providerMessageId: result.providerMessageId ? "기록됨" : "없음",
    executionSummary: result.externalMutation ? "승인 후보 알림만 전송 · 메일/일정/파일 실행 없음" : "외부 알림 미전송",
  };
}

function createOfficeMockApprovalNotificationResult(workItem: WorkItem): ApprovalNotificationResult {
  return {
    status: "approval_notification_sent",
    notificationTargetIds: [workItem.id],
    notificationTargetCount: 1,
    decisionReplyContract: "phone_reply_code_to_same_notification_target_then_app_final_confirmation",
    providerId: "telegram",
    connectorId: "telegram-bot",
    providerMessageId: "preview-message-id-redacted",
    mobileReceiveFilterIds: ["approval_waiting", "calendar_candidate", "urgent_risk", "follow_up"],
    mobileReceiveFilterSummary: "승인 대기 / 일정 후보 / 긴급/위험 / 후속 확인",
    userMessage: "미리보기 승인 후보 알림을 보냈습니다.",
    externalMutation: true,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createOfficeMockMailAutomationDecisionWorkItem(workItem: WorkItem): WorkItem {
  const decidedAt = new Date().toISOString();
  return {
    ...workItem,
    status: "approval_pending",
    channelDecision: {
      channel: "Telegram Bot",
      decision: "approved",
      decisionLabel: "승인",
      decidedBy: "휴대폰",
      decidedAt,
      messagePreview: "승인 A1",
      targetCode: "A1",
      targetWorkItemId: workItem.id,
      notificationTargetMatch: true,
      notificationTargetMatchLabel: "A1 알림 코드가 메일 자동 점검 승인 후보와 매칭됨",
      notificationTargetMatchContract: "approval_notification_code_to_same_work_item_final_confirmation",
      approvalInboxRouteLabel: "ModyCrew > 오피스 > 승인함 > 메일 자동 점검",
      appReconfirmLabel: "앱 최종 확인 필요",
      workerEventLabel: "메일 업무 비서가 휴대폰 승인 의사를 기록",
      finalExecutionBoundary: "휴대폰 답장은 의사 기록만, 실제 메일 발송/일정 등록/파일 이동은 앱 최종 확인 후 실행",
      mobileReceiveFilterIds: ["approval_waiting", "calendar_candidate", "urgent_risk", "follow_up"],
      mobileReceiveFilterLabels: ["승인 대기", "일정 후보", "긴급/위험", "후속 확인"],
      mobileReceiveFilterSummary: "승인 대기 / 일정 후보 / 긴급/위험 / 후속 확인",
      mobileReceiveFilterContract: "phone_reply_only_for_notification_target_no_direct_external_execution",
      requiresAppReconfirm: true,
      externalMutation: false,
    },
    finalAction: {
      kind: "send_email",
      label: "메일 자동 점검 답장 마지막 확인",
      requiresFinalUserPresence: true,
      readiness: "ready_for_final_confirmation",
      blockedReason: "휴대폰 답장은 승인 의사 기록입니다. 수신자, 제목, 본문, 첨부를 앱에서 마지막으로 확인하기 전까지 발송하지 않습니다.",
      checklist: ["알림 코드와 승인 후보 매칭 확인", "수신자/제목/본문 확인", "첨부/일정 후보 분리 확인"],
    },
  };
}

function readOfficeMockRuntimeFromLocation(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("preview") === "workbench" && params.get("mockRuntime") === "1";
}

function readOfficeMockFinalConnectionMissing(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("mockFinalConnection") === "missing";
}

function readConnectionRecoveryHandoffFromLocation(): ConnectionRecoveryHandoff | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("source") !== "connect-recovery") return null;
  const connectorId = params.get("connector")?.trim() || "connector";
  return {
    source: "connect-recovery",
    connectorId,
    connectorLabel: officeConnectorLabel(connectorId),
  };
}

function officeConnectorLabel(connectorId: string) {
  if (connectorId === "company-mail") return "회사/그룹웨어 메일";
  if (connectorId === "gmail") return "Gmail";
  if (connectorId === "outlook") return "Outlook";
  if (connectorId === "telegram-bot") return "Telegram Bot";
  if (connectorId === "slack-app") return "Slack";
  return connectorId
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function createOfficeMockConnectorStatuses(): ConnectorStatusRecord[] {
  return [
    {
      connectorId: "company-mail",
      method: "mock_mail",
      category: "mail",
      status: "connected",
      userMessage: "미리보기 회사 메일 연결됨",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    },
    {
      connectorId: "google-calendar",
      method: "mock_calendar",
      category: "calendar",
      status: "connected",
      permissions: { calendarWrite: true },
      userMessage: "미리보기 캘린더 연결됨",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    },
    {
      connectorId: "telegram-bot",
      method: "mock_messenger",
      category: "messenger",
      status: "connected",
      channelTargetId: "personal-approval-chat",
      permissions: { messengerReport: true },
      userMessage: "Telegram Bot 미리보기 승인 알림 채널 연결됨",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    },
  ];
}

function createOfficeMockFinalActionItems(): WorkItem[] {
  return [
    {
      id: "mock-final-send-email-approval",
      title: "거래처 답장 메일 최종 확인",
      source: "email",
      sourceLabel: "메일 점검",
      senderLabel: "거래처 김민수",
      body: "견적서 확인 요청에 대한 답장 후보입니다.",
      summary: "AI가 답장 초안을 준비했습니다. 수신자, 제목, 첨부 여부를 확인한 뒤에만 발송 직전 확인을 열 수 있습니다.",
      status: "approval_pending",
      riskLabel: "high",
      riskSignals: [
        {
          id: "mock-final-send-email-risk",
          label: "외부 발송",
          riskLabel: "high",
          reason: "외부 거래처로 메일이 나가는 작업이라 최종 사용자 확인이 필요합니다.",
        },
      ],
      receivedAt: "2026-06-05T09:10:00.000Z",
      sourceEvidence: {
        connectorId: "company-mail",
        providerId: "mailops",
        mailboxLabel: "회사 메일",
        messageSubject: "견적서 확인 요청",
        senderPreview: "거래처 김민수",
        replyToLabel: "kim@example.com",
        draftPreview: "견적서 검토 감사드립니다. 요청하신 조건 기준으로 회신드립니다.",
        approvalCandidateLabels: ["메일 발송"],
        mailThreadRecipientDecision: {
          replyTargetLabel: "거래처 김민수",
          recipientDecisionSummary: "최근 견적 문의 스레드의 답장 후보 1명을 우선 추천하고, 참조/숨은참조는 사용자 확인으로 남깁니다.",
          sendCandidateLabels: ["답장 후보: 원문 보낸 사람", "업무 맥락: 견적 확인 요청"],
          holdCandidateLabels: ["관련 담당자: 내부 영업 담당자는 참조 여부만 확인"],
          excludeCandidateLabels: ["원문에 포함된 일반 안내 주소는 발송 제외"],
          learningDecisionHints: ["지난 견적 회신은 보낸 사람 직접 답장 후 내부 담당자 참조를 확인"],
          privacyBoundary: "원문 이메일 주소는 근거 카드에 직접 표시하지 않고 마지막 확인 입력칸에서만 사용자가 확인합니다.",
        },
        mailWorkReview: {
          proof: "mail_work_review_to_final_confirmation",
          originalSummary: "거래처가 견적서 확인과 회신 조건을 요청했습니다.",
          draftSummary: "견적 조건 확인 후 정중하게 회신하는 초안이 준비되었습니다.",
          replyMethodLabel: "답장 초안 수정 후 승인 발송",
          sendDecisionReason: "견적 문의 스레드의 원문 보낸 사람에게 답장이 필요합니다.",
          editFocusLabel: "가격 조건, 첨부 견적서 여부, 참조 담당자 포함 여부",
          attachmentSummary: "첨부 필요 여부는 최종 확인에서 사용자가 확인",
          finalApprovalBoundary: "승인된 항목만 오피스 마지막 확인으로 이동하며 실제 발송은 최종 확인 전까지 잠깁니다.",
          privacyBoundary: "원문 이메일 주소는 근거 카드에 직접 표시하지 않고 마지막 확인 입력칸에서만 사용자가 확인합니다.",
          reviewItems: [
            {
              id: "mock-mail-review-original",
              label: "원문 요약",
              state: "ok",
              detail: "견적서 확인 요청",
            },
            {
              id: "mock-mail-review-draft",
              label: "답장 초안",
              state: "needs_review",
              detail: "가격 조건과 첨부 여부 수정 가능",
            },
            {
              id: "mock-mail-review-boundary",
              label: "발송 경계",
              state: "locked",
              detail: "최종 확인 전 외부 발송 없음",
            },
          ],
        },
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-final-send-email-draft",
        toneLabel: "거래처 정중 답장",
        body: "견적서 검토 감사드립니다. 요청하신 조건 기준으로 회신드립니다.",
        operationKind: "draft_reply",
        requiresApprovalBeforeSend: true,
      },
      channelDecision: {
        channel: "Mobile Approval",
        decision: "approved",
        decisionLabel: "승인",
        decidedBy: "휴대폰",
        decidedAt: "2026-06-05T09:12:00.000Z",
        messagePreview: "A1 승인. 견적서 답장 후보를 앱 마지막 확인으로 넘겨줘.",
        targetCode: "A1",
        approvalInboxRouteLabel: "ModyCrew > 오피스 > 메일 마지막 확인",
        appReconfirmLabel: "앱 최종 확인 필요",
        workerEventLabel: "A1 휴대폰 승인 -> 메일 담당자 최종 확인 대기",
        finalExecutionBoundary: "휴대폰 답장은 의사 기록만 남기며, 실제 메일 발송은 앱 최종 확인 후에만 진행됩니다.",
        mobileReceiveFilterIds: ["approved", "mail_final_confirmation"],
        mobileReceiveFilterLabels: ["승인", "메일 마지막 확인"],
        mobileReceiveFilterSummary: "승인 답장만 메일 마지막 확인 후보로 모읍니다.",
        mobileReceiveFilterContract: "phone_reply_code_to_same_notification_target_then_app_final_confirmation",
        requiresAppReconfirm: true,
        externalMutation: false,
      },
      finalAction: {
        kind: "send_email",
        label: "메일 발송",
        requiresFinalUserPresence: true,
        readiness: "ready_for_final_confirmation",
        blockedReason: "발송 전 수신자, 제목, 본문, 첨부 여부 확인이 필요합니다.",
        checklist: ["수신자 확인", "본문 표현 확인", "첨부 여부 확인"],
        mailSendApprovalGate: {
          policy: "work_queue_approve_only",
          requiredDecision: "approve",
          decision: "approve",
          requiredFinalRoute: "included",
          finalRoute: "included",
          sourceContract: "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log",
          externalMutationBeforeGate: false,
        },
      },
      browserTask: {
        targetUrl: "https://mail.example.com/compose",
        host: "mail.example.com",
        requiresFinalUserPresence: true,
        blockedCapabilities: ["send_email"],
        actionPlan: [
          {
            id: "mock-final-send-email-plan",
            label: "메일 발송 버튼 확인",
            capability: "send_email",
            riskLabel: "high",
            requiresFinalUserPresence: true,
            reason: "외부 발송은 앱 최종 확인 이후에도 마지막 확인을 통과해야 합니다.",
          },
        ],
        dryRunRequired: true,
        dryRunPlan: {
          intendedInput: "거래처 답장 초안",
          clickTarget: "메일 발송 버튼",
          expectedResult: "수신자와 본문을 검토한 뒤 발송 직전 상태까지만 확인합니다.",
          cancelPath: "발송하지 않고 초안으로 닫기",
          rollbackGuide: "발송 전에는 초안을 닫아 취소하고, 발송 후에는 감사 기록과 회수 가능 여부를 확인합니다.",
          preflightChecklist: ["수신자 확인", "제목 확인", "본문 확인", "첨부 확인"],
        },
      },
    },
    {
      id: "mock-workpack-send-email-approval",
      title: "업무팩 문의 응대 자동 점검",
      source: "email",
      sourceLabel: "업무팩 메일·일정 점검",
      senderLabel: "학부모 문의",
      body: "상담 일정 문의 메일을 읽고 답장 후보를 만들었습니다.",
      summary: "반복 업무 점검이 문의 메일을 감지했고, 답장 초안은 최종 확인 전까지 발송되지 않습니다.",
      status: "draft_ready",
      riskLabel: "medium",
      riskSignals: [
        {
          id: "mock-workpack-send-email-risk",
          label: "메일 발송",
          riskLabel: "medium",
          reason: "업무팩 자동 점검은 초안과 승인 후보만 만들고 외부 발송은 실행하지 않습니다.",
        },
      ],
      receivedAt: "2026-06-05T09:08:00.000Z",
      sourceEvidence: {
        connectorId: "custom-imap-mail",
        providerId: "mailops",
        mailboxLabel: "회사 메일",
        messageSubject: "상담 일정 문의",
        senderPreview: "학부모 문의",
        draftPreview: "문의 주셔서 감사합니다. 가능한 상담 시간을 확인해 안내드리겠습니다.",
        approvalCandidateLabels: ["반복 업무 점검", "메일 발송"],
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-workpack-send-email-draft",
        toneLabel: "업무팩 답장 초안",
        body: "문의 주셔서 감사합니다. 가능한 상담 시간을 확인해 안내드리겠습니다.",
        operationKind: "send_email",
        requiresApprovalBeforeSend: true,
      },
      finalAction: {
        kind: "send_email",
        label: "메일 발송",
        requiresFinalUserPresence: true,
        readiness: "ready_for_final_confirmation",
        blockedReason: "업무팩은 답장 초안까지만 만들며 실제 발송은 최종 확인 전까지 차단됩니다.",
        checklist: ["수신자와 문의 맥락 확인", "답장 문구와 일정 후보 확인", "발송은 사용자 최종 확인 뒤에만 실행"],
        mailSendApprovalGate: {
          policy: "work_queue_approve_only",
          requiredDecision: "approve",
          decision: "approve",
          requiredFinalRoute: "included",
          finalRoute: "included",
          sourceContract: "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log",
          externalMutationBeforeGate: false,
        },
      },
    },
    {
      id: "mock-workpack-calendar-approval",
      title: "일정 등록 확인: 업무팩 문의 응대 자동 점검",
      source: "calendar",
      sourceLabel: "업무팩 메일·일정 점검",
      senderLabel: "학부모 문의",
      body: "상담 일정 후보를 만들었습니다.",
      summary: "반복 업무 점검이 상담 일정 후보를 만들었고, 캘린더 등록은 사용자가 최종 확인하기 전까지 차단됩니다.",
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [
        {
          id: "mock-workpack-calendar-risk",
          label: "일정 등록",
          riskLabel: "medium",
          reason: "캘린더 등록은 외부 변경이므로 앱 최종 확인 전에는 실행하지 않습니다.",
        },
      ],
      receivedAt: "2026-06-05T09:07:00.000Z",
      sourceEvidence: {
        connectorId: "custom-imap-mail",
        providerId: "calendar",
        mailboxLabel: "회사 메일",
        messageSubject: "상담 일정 문의",
        senderPreview: "학부모 문의",
        calendarCandidateText: "6월 6일 오전 10시 상담",
        calendarTimeRangeLabel: "2026-06-06 10:00-11:00",
        approvalCandidateLabels: ["반복 업무 점검", "일정 등록"],
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-workpack-calendar-draft",
        toneLabel: "업무팩 일정 후보",
        body: "6월 6일 오전 10시 상담 일정을 등록할 수 있습니다.",
        operationKind: "create_calendar_event",
        requiresApprovalBeforeSend: true,
      },
      schedules: [
        {
          id: "mock-workpack-calendar-schedule",
          label: "상담 일정 후보",
          startsAt: "2026-06-06T10:00:00.000+09:00",
          endsAt: "2026-06-06T11:00:00.000+09:00",
          conflictNote: "미리보기 모드에서는 실제 캘린더를 변경하지 않습니다.",
        },
      ],
      finalAction: {
        kind: "create_calendar_event",
        label: "일정 등록",
        requiresFinalUserPresence: true,
        readiness: "adapter_not_connected",
        blockedReason: "캘린더 등록은 읽기/후보 생성과 분리되어 있으며 사용자가 최종 확인하기 전까지 차단됩니다.",
        checklist: ["일정 제목 확인", "시작/종료 시간 확인", "캘린더 등록은 사용자 최종 확인 뒤에만 실행"],
      },
    },
    {
      id: "mock-mail-attachment-folder-plan-approval",
      title: "메일 첨부 정리 승인 대기: 계약서-세금계산서.pdf",
      source: "local_file",
      sourceLabel: "메일 첨부 정리",
      senderLabel: "회사 메일 첨부",
      body: "메일 첨부 로컬 사본을 폴더 정리 후보로 올렸습니다.",
      summary: "원본 메일은 유지하고, 내려받은 로컬 사본의 대상 폴더와 충돌만 최종 확인합니다.",
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [
        {
          id: "mock-mail-attachment-folder-plan-risk",
          label: "첨부 정리",
          riskLabel: "medium",
          reason: "파일 이동/삭제/덮어쓰기는 사용자 최종 확인 전까지 실행하지 않습니다.",
        },
      ],
      receivedAt: "2026-06-05T09:06:50.000Z",
      sourceEvidence: {
        connectorId: "custom-imap-mail",
        providerId: "mailops",
        mailboxLabel: "회사 메일",
        messageSubject: "계약서와 세금계산서 첨부 확인",
        detectedIntentLabels: ["메일 첨부", "첨부 정리"],
        approvalCandidateLabels: ["메일 첨부 정리", "폴더 정리 승인"],
        mailAttachmentOrganizer: {
          contract: "downloaded_mail_attachment_to_folder_plan_approval",
          messageSubject: "계약서와 세금계산서 첨부 확인",
          downloadedAttachmentCount: 1,
          connectorId: "custom-imap-mail",
          providerId: "mailops",
        },
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-mail-attachment-folder-plan-draft",
        toneLabel: "첨부 정리 전 확인",
        body: "정리 후보: 계약서-세금계산서.pdf\n대상: 메일 첨부 보관 폴더\n확인: 동명 파일 충돌, 제외 항목, 원본 메일 유지",
        operationKind: "share_file",
        requiresApprovalBeforeSend: true,
      },
      localFile: {
        path: "C:\\Users\\Example\\Documents\\ModyCrew\\MailAttachments\\계약서-세금계산서.pdf",
        name: "계약서-세금계산서.pdf",
        folder: "ModyCrew\\MailAttachments",
        extension: "pdf",
        sizeLabel: "24KB",
        modifiedAt: "2026-06-05T09:03:00.000Z",
        extractedTextStatus: "ready",
        preview: "메일 첨부 로컬 사본만 정리 후보로 사용합니다. 원본 메일 이동/삭제는 실행하지 않았습니다.",
        scopeKind: "file",
      },
      finalAction: {
        kind: "share_file",
        label: "메일 첨부 정리 최종 확인",
        requiresFinalUserPresence: true,
        readiness: "adapter_not_connected",
        blockedReason: "대상 폴더, 충돌, 제외 항목을 확인하기 전까지 파일 이동/정리를 실행하지 않습니다.",
        checklist: ["대상 폴더 확인", "동명 파일 충돌 확인", "원본 메일 유지 확인"],
      },
    },
    {
      id: "mock-mail-attachment-folder-plan-staged",
      title: "메일 첨부 정리 승인 대기: 견적서-첨부.pdf",
      source: "local_file",
      sourceLabel: "메일 첨부 정리",
      senderLabel: "회사 메일 첨부",
      body: "메일 첨부 로컬 사본을 폴더 정리 승인 카드로 준비했습니다.",
      summary: "메일 원본은 그대로 두고, 내려받은 로컬 사본만 폴더 정리 대상에 올립니다.",
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [
        {
          id: "mock-mail-attachment-folder-plan-staged-risk",
          label: "첨부 정리",
          riskLabel: "medium",
          reason: "다운로드된 로컬 사본만 이동하며, 원본 메일과 원본 첨부는 수정하지 않습니다.",
        },
      ],
      receivedAt: "2026-06-05T09:06:49.000Z",
      sourceEvidence: {
        connectorId: "custom-imap-mail",
        providerId: "mailops",
        mailboxLabel: "회사 메일",
        messageSubject: "견적서 첨부 정리 요청",
        detectedIntentLabels: ["메일 첨부", "첨부 정리"],
        approvalCandidateLabels: ["메일 첨부 정리", "폴더 정리 승인"],
        mailAttachmentOrganizer: {
          contract: "downloaded_mail_attachment_to_folder_plan_approval",
          messageSubject: "견적서 첨부 정리 요청",
          sourceMessageId: "mock-mail-attachment-message-001",
          attachmentCandidateCount: 1,
          downloadedAttachmentCount: 1,
          connectorId: "custom-imap-mail",
          providerId: "mailops",
          downloadStatus: "downloaded_local_copy",
          stagingHandoffKind: "folder_plan_approval",
          originalMailMutation: false,
          externalShareBeforeApproval: false,
        },
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-mail-attachment-folder-plan-staged-draft",
        toneLabel: "첨부 정리 전 확인",
        body: "정리 후보: 견적서-첨부.pdf\n대상: 메일 첨부 보관 폴더\n확인: 동명 파일 충돌, 제외 항목, 원본 메일 유지",
        operationKind: "stage_approval",
        requiresApprovalBeforeSend: true,
      },
      localFile: {
        path: "C:\\Users\\Example\\Documents\\ModyCrew\\MailAttachments\\견적서-첨부.pdf",
        name: "견적서-첨부.pdf",
        folder: "ModyCrew\\MailAttachments",
        extension: "pdf",
        sizeLabel: "18KB",
        modifiedAt: "2026-06-05T09:04:00.000Z",
        extractedTextStatus: "ready",
        preview: "메일 첨부 로컬 사본만 정리 후보로 사용합니다. 원본 메일 이동/삭제는 실행하지 않았습니다.",
        scopeKind: "file",
      },
    },
    {
      id: "mock-share-file-approval",
      title: "정산표 공유 확인: 6월 정산표.xlsx",
      source: "local_file",
      sourceLabel: "문서 학습 · 파일 공유 후보",
      senderLabel: "Documents",
      body: "6월 정산표.xlsx를 회계팀과 공유할 수 있는지 확인하는 후보입니다.",
      summary: "파일 공유 대상, 권한 범위, 민감정보 포함 여부를 확인하기 전까지 실제 공유하지 않습니다.",
      status: "approval_pending",
      riskLabel: "high",
      riskSignals: [
        {
          id: "mock-share-file-risk",
          label: "파일 공유",
          riskLabel: "high",
          reason: "정산표에는 금액과 거래처 정보가 포함될 수 있어 공유 대상과 권한을 최종 확인해야 합니다.",
        },
      ],
      receivedAt: "2026-06-05T09:06:45.000Z",
      sourceEvidence: {
        connectorId: "google-drive",
        providerId: "document_learning",
        approvalCandidateLabels: ["파일 공유", "권한 확인"],
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-share-file-draft",
        toneLabel: "공유 전 확인",
        body: "공유 후보: 6월 정산표.xlsx\n대상: 회계팀\n권한: 보기 전용\n확인: 금액/거래처 정보 포함 여부",
        operationKind: "share_file",
        requiresApprovalBeforeSend: true,
      },
      localFile: {
        path: "C:\\Users\\Example\\Documents\\6월 정산표.xlsx",
        name: "6월 정산표.xlsx",
        folder: "Documents",
        extension: "xlsx",
        sizeLabel: "42KB",
        modifiedAt: "2026-06-05T09:00:00.000Z",
        extractedTextStatus: "ready",
        preview: "공유 후보만 만들었습니다. 실제 파일 공유와 권한 변경은 실행하지 않았습니다.",
      },
      finalAction: {
        kind: "share_file",
        label: "파일 공유",
        requiresFinalUserPresence: true,
        readiness: "adapter_not_connected",
        blockedReason: "파일 공유는 드라이브 연결, 공유 대상, 권한, 민감정보 확인 전까지 차단됩니다.",
        checklist: ["공유 대상 확인", "보기 전용 권한 확인", "민감정보 포함 여부 확인"],
      },
    },
    {
      id: "mock-memory-search-draft-approval",
      title: "지난 업무 초안 승인 요청: 상담 문의 답장",
      source: "manual_input",
      sourceLabel: "지난 업무 찾기 · AI 팀원 승인함",
      senderLabel: "업무 비서",
      body: [
        "검색 종류: 메일 근거",
        "안전 경계: 메일 원문은 읽기 전용, 발송/일정 등록은 승인 후보로만 생성",
        "다음 선택: 메일 근거를 질문에 넣고 승인함에서 확인",
        "출처: 지난 업무 기억",
        "초안: 상담 문의 답장 초안입니다. 가능한 시간과 준비 자료를 안내하되 실제 발송은 오피스 최종 확인 전까지 잠급니다.",
      ].join("\n"),
      summary: "지난 업무 찾기에서 만든 초안을 실행 후보로 올렸습니다. 발송과 일정 등록은 최종 확인 전까지 실행하지 않습니다.",
      status: "approval_pending",
      riskLabel: "high",
      riskSignals: [
        {
          id: "mock-memory-search-draft-risk",
          label: "지난 업무 초안 실행 후보",
          riskLabel: "high",
          reason: "검색한 메일 근거를 바탕으로 외부 발송 후보를 만들 수 있어 최종 사용자 확인이 필요합니다.",
        },
      ],
      receivedAt: "2026-06-05T09:06:40.000Z",
      sourceEvidence: {
        connectorId: "company-mail",
        providerId: "memory_search",
        mailboxLabel: "지난 업무 찾기",
        messageSubject: "상담 문의 답장",
        draftPreview: "가능한 시간과 준비 자료를 안내하는 답장 초안",
        approvalCandidateLabels: ["지난 업무 초안", "메일 발송"],
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-memory-search-draft",
        toneLabel: "지난 업무 초안",
        body: [
          "검색 종류: 메일 근거",
          "안전 경계: 메일 원문은 읽기 전용, 발송/일정 등록은 승인 후보로만 생성",
          "다음 선택: 메일 근거를 질문에 넣고 승인함에서 확인",
          "출처: 지난 업무 기억",
          "초안: 상담 문의 답장 초안입니다. 가능한 시간과 준비 자료를 안내하되 실제 발송은 오피스 최종 확인 전까지 잠급니다.",
        ].join("\n"),
        operationKind: "send_email",
        requiresApprovalBeforeSend: true,
      },
      approvedOutput: {
        path: "memory/work-patterns/WorkPatternMemory.md",
        folder: "memory/work-patterns",
        name: "상담 문의 답장 승인 요청",
        kind: "execution_candidate",
        createdAt: "2026-06-05T09:06:40.000Z",
      },
      finalAction: {
        kind: "send_email",
        label: "메일 발송",
        requiresFinalUserPresence: true,
        readiness: "adapter_not_connected",
        blockedReason: "지난 업무 초안은 메일 연결과 최종 확인 전까지 실제 발송하지 않습니다.",
        checklist: ["지난 업무 근거 확인", "수신자와 답장 문구 확인", "최종 확인 전 발송 차단"],
        mailSendApprovalGate: {
          policy: "work_queue_approve_only",
          requiredDecision: "approve",
          decision: "approve",
          requiredFinalRoute: "included",
          finalRoute: "included",
          sourceContract: "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log",
          externalMutationBeforeGate: false,
        },
      },
    },
    {
      id: "mock-external-browser-approval",
      title: "거래처 포털 화면 확인",
      source: "web_page",
      sourceLabel: "외부 계정 · 내 PC 작업 도우미",
      senderLabel: "partner.example.com",
      body: "거래처 포털의 주문 상태 화면을 읽기 전용으로 확인합니다.",
      summary: "외부 사이트 화면을 읽어 주문 상태 후보를 확인합니다. 클릭, 입력, 제출은 승인 전까지 잠겨 있습니다.",
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [
        {
          id: "mock-external-browser-risk",
          label: "외부 사이트 조작 후보",
          riskLabel: "medium",
          reason: "외부 사이트 화면 확인은 읽기부터 진행하고 클릭·입력은 최종 확인 전까지 차단합니다.",
        },
      ],
      receivedAt: "2026-06-05T09:06:30.000Z",
      sourceEvidence: {
        connectorId: "external-account-vault",
        providerId: "desktop_control",
        approvalCandidateLabels: ["화면 확인", "클릭 후보 잠금"],
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      browserTask: {
        targetUrl: "https://partner.example.com/orders",
        host: "partner.example.com",
        requiresFinalUserPresence: true,
        blockedCapabilities: ["browser_click", "browser_type", "external_submit"],
        actionPlan: [
          {
            id: "mock-external-browser-plan",
            label: "주문 상태 필터 확인",
            capability: "browser_action",
            riskLabel: "medium",
            requiresFinalUserPresence: true,
            reason: "외부 사이트 조작 후보는 화면 증거와 대상 매칭 뒤에도 사용자 확인 전까지 잠깁니다.",
          },
        ],
        dryRunRequired: true,
        dryRunPlan: {
          intendedInput: "주문 상태 조회",
          clickTarget: "주문 상태 필터",
          expectedResult: "거래처 포털 주문 상태 화면을 읽고 변경 없이 후보만 확인합니다.",
          cancelPath: "승인함에서 취소 또는 보류",
          rollbackGuide: "실행 전에는 승인함에서 취소하고, 실행 뒤에는 감사 기록과 사이트 변경 이력을 확인합니다.",
          preflightChecklist: ["사이트 주소 확인", "대상 화면 확인", "클릭·입력 잠금 확인"],
        },
      },
    },
    {
      id: "mock-local-file-approval",
      title: "문서 확인: 6월 정산표.xlsx",
      source: "local_file",
      sourceLabel: "내 컴퓨터 문서",
      senderLabel: "Documents",
      body: "파일명: 6월 정산표.xlsx\n폴더: Documents\n요청: 금액과 누락 항목을 확인해줘",
      summary: "6월 정산표.xlsx 문서를 업무 카드로 올렸습니다. 파일 내용은 아직 읽지 않았고, 분석/초안 전 사용자 확인이 필요합니다.",
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [
        {
          id: "mock-local-file-open-confirm",
          label: "파일 열기 전 확인",
          riskLabel: "medium",
          reason: "로컬 파일 열기와 내용 분석은 사용자가 선택한 뒤 승인 흐름에서 진행합니다.",
        },
      ],
      receivedAt: "2026-06-05T09:06:00.000Z",
      draft: {
        id: "mock-local-file-draft",
        toneLabel: "문서 업무 준비",
        body: "대상 문서: 6월 정산표.xlsx\n다음 단계: 분석하기 또는 초안 만들기를 선택하세요.",
        operationKind: "stage_approval",
        requiresApprovalBeforeSend: true,
      },
      localFile: {
        path: "C:\\Users\\Example\\Documents\\6월 정산표.xlsx",
        name: "6월 정산표.xlsx",
        folder: "Documents",
        extension: "xlsx",
        sizeLabel: "42KB",
        modifiedAt: "2026-06-05T09:00:00.000Z",
        extractedTextStatus: "pending",
        preview: "파일명과 위치만 확인했습니다. 내용 분석은 사용자가 누를 때만 진행합니다.",
      },
    },
    {
      id: "mock-folder-plan-approval",
      title: "폴더 정리 계획 승인: Downloads",
      source: "local_file",
      sourceLabel: "로컬 폴더 정리",
      senderLabel: "Downloads",
      body: [
        "정리 계획: Downloads 폴더 후보",
        "실행 전 검토: 8개 후보",
        "적용 확인 문구: 정리 적용 승인",
        "되돌리기 확인 문구: 정리 되돌리기 승인",
        "적용 전 제외/충돌 확인 필요",
      ].join("\n"),
      summary: "Downloads 폴더 정리 후보를 만들었습니다. 실제 이동과 삭제는 정리 적용 승인 전까지 실행하지 않습니다.",
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [
        {
          id: "mock-folder-plan-risk",
          label: "파일 이동/삭제 전 최종 확인",
          riskLabel: "medium",
          reason: "폴더 정리는 적용 전 제외, 충돌, 되돌리기 기록을 확인해야 합니다.",
        },
      ],
      receivedAt: "2026-06-05T09:05:50.000Z",
      sourceEvidence: {
        providerId: "document_learning",
        draftPreview: "정리 후보 8개를 만들었습니다. 실행하기, 고쳐달라고 하기, 보류하기를 승인함에서 고릅니다.",
        detectedIntentLabels: ["폴더 정리", "실행 전 검토", "승인 필요", "정리 방식 선택", "중복 후보 수동 검토"],
        approvalCandidateLabels: ["정리 계획 승인", "최종 적용 전 확인"],
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-folder-plan-draft",
        toneLabel: "폴더 정리 승인 기준",
        body: "Downloads 폴더 정리 후보입니다. 적용은 정리 적용 승인, 되돌리기는 정리 되돌리기 승인 문구가 필요합니다.",
        operationKind: "stage_approval",
        requiresApprovalBeforeSend: true,
      },
      localFile: {
        path: "C:\\Users\\Example\\Downloads\\modycrew-folder-plan.md",
        name: "Downloads 폴더 정리 계획.md",
        folder: "Downloads",
        extension: "md",
        sizeLabel: "8개 후보",
        modifiedAt: "2026-06-05T09:00:00.000Z",
        extractedTextStatus: "ready",
        preview: "실행 전 검토 후보만 만들었습니다. 파일 이동, 삭제, 덮어쓰기는 아직 실행하지 않았습니다.",
        scopeKind: "folder",
        selectionMode: "user_selected_file_or_folder",
        folderScopePolicy: "selected_folder_only",
        childCountLabel: "8개 후보",
      },
    },
    {
      id: "mock-mobile-mail-reply-approval",
      title: "휴대폰 메일 답장 확인: 거래처 일정 문의",
      source: "mobile_share",
      sourceLabel: "휴대폰 공유 메일",
      senderLabel: "휴대폰에서 선택",
      body: "휴대폰에서 공유한 거래처 일정 문의 메일입니다.",
      summary: "휴대폰에서 고른 메일을 앱 승인함으로 가져왔고, 답장 초안은 마지막 확인 전까지 발송하지 않습니다.",
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [],
      receivedAt: "2026-06-05T09:04:40.000Z",
      sourceEvidence: {
        connectorId: "mobile-share",
        providerId: "mobile_share",
        mailboxLabel: "휴대폰 선택 메일",
        messageSubject: "거래처 일정 문의",
        senderPreview: "거래처 담당자",
        replyToLabel: "partner-mobile@example.com",
        draftPreview: "문의 주셔서 감사합니다. 가능한 일정 후보를 확인해 회신드리겠습니다.",
        messageSnippet: "다음 주 미팅 가능 시간을 확인 부탁드립니다.",
        detectedIntentLabels: ["mobile_share", "reply_required", "approval_required"],
        approvalCandidateLabels: ["휴대폰 메일", "답장 후보", "앱 마지막 확인"],
        mobileReceiveFilterIds: ["approval_waiting", "mobile_share"],
        mobileReceiveFilterLabels: ["승인 대기", "휴대폰 메일"],
        mailWorkReview: {
          proof: "mobile_share_mail_to_workbench_final_confirmation",
          originalSummary: "휴대폰에서 선택한 거래처 일정 문의입니다.",
          draftSummary: "가능한 일정 후보 확인 후 회신하는 초안입니다.",
          replyMethodLabel: "휴대폰 메일 답장 초안 승인 발송",
          sendDecisionReason: "사용자가 휴대폰에서 직접 고른 메일이라 답장 후보로 분류합니다.",
          editFocusLabel: "수신자, 일정 표현, 참조 여부",
          attachmentSummary: "첨부 없음",
          finalApprovalBoundary: "휴대폰 공유 메일도 앱 마지막 확인 전에는 발송하지 않습니다.",
          privacyBoundary: "휴대폰 메일 원문은 요약만 사용하고 주소 원문은 마지막 확인에서만 확인합니다.",
          reviewItems: [
            { id: "mobile-original", label: "원문 요약", state: "ok", detail: "일정 문의" },
            { id: "mobile-draft", label: "답장 초안", state: "needs_review", detail: "가능 시간 확인 필요" },
            { id: "mobile-lock", label: "발송 경계", state: "locked", detail: "앱 마지막 확인 전 발송 없음" },
          ],
        },
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-mobile-mail-reply-draft",
        toneLabel: "휴대폰 메일 답장 초안",
        body: "문의 주셔서 감사합니다. 가능한 일정 후보를 확인해 회신드리겠습니다.",
        operationKind: "send_email",
        requiresApprovalBeforeSend: true,
      },
      finalAction: {
        kind: "send_email",
        label: "메일 발송",
        requiresFinalUserPresence: true,
        readiness: "ready_for_final_confirmation",
        blockedReason: "휴대폰 공유 메일은 앱 마지막 확인 전까지 실제 발송하지 않습니다.",
        checklist: ["휴대폰에서 고른 메일 확인", "수신자 확인", "답장 본문 확인", "최종 확인 전 발송 차단"],
        mailSendApprovalGate: {
          policy: "work_queue_approve_only",
          requiredDecision: "approve",
          decision: "approve",
          requiredFinalRoute: "included",
          finalRoute: "included",
          sourceContract: "mobile_share_to_workbench_candidate_to_final_confirmation",
          externalMutationBeforeGate: false,
        },
      },
    },
    {
      id: "mock-mobile-mail-risk-review",
      title: "휴대폰 메일 보류 확인: 계약 조건 변경",
      source: "mobile_share",
      sourceLabel: "휴대폰 공유 메일",
      senderLabel: "휴대폰에서 선택",
      body: "휴대폰에서 공유한 계약 조건 변경 요청입니다.",
      summary: "계약 조건 변경이 포함되어 자동 발송하지 않고 앱 안에서 보류 검토합니다.",
      status: "approval_pending",
      riskLabel: "high",
      riskSignals: [
        {
          id: "mock-mobile-mail-contract-risk",
          label: "계약 조건",
          riskLabel: "high",
          reason: "계약 조건 변경은 사용자가 검토하기 전 답장을 보내면 안 됩니다.",
        },
      ],
      receivedAt: "2026-06-05T09:04:30.000Z",
      sourceEvidence: {
        connectorId: "mobile-share",
        providerId: "mobile_share",
        mailboxLabel: "휴대폰 선택 메일",
        messageSubject: "계약 조건 변경 요청",
        senderPreview: "거래처 담당자",
        replyToLabel: "contract-mobile@example.com",
        draftPreview: "계약 조건 변경 요청은 내부 확인 후 답변드리겠습니다.",
        messageSnippet: "계약 조건 일부를 변경하고 싶습니다.",
        detectedIntentLabels: ["mobile_share", "contract_review", "approval_required"],
        approvalCandidateLabels: ["휴대폰 메일", "보류 검토", "앱 마지막 확인"],
        mobileReceiveFilterIds: ["urgent_risk", "mobile_share"],
        mobileReceiveFilterLabels: ["긴급/위험", "휴대폰 메일"],
        mailWorkReview: {
          proof: "mobile_share_mail_to_workbench_hold_review",
          originalSummary: "휴대폰에서 선택한 계약 조건 변경 요청입니다.",
          draftSummary: "내부 확인 후 답변하는 보류 초안입니다.",
          replyMethodLabel: "보류 검토 후 필요 시 답장",
          sendDecisionReason: "계약 조건 변경이라 바로 발송하지 않고 검토 대기로 둡니다.",
          editFocusLabel: "계약 범위, 책임 표현, 내부 승인 필요 여부",
          attachmentSummary: "첨부 여부 최종 확인",
          finalApprovalBoundary: "보류 항목은 앱 마지막 확인 전 실제 발송 경로에 넣지 않습니다.",
          privacyBoundary: "휴대폰 메일 원문은 요약만 사용합니다.",
          reviewItems: [
            { id: "mobile-risk-original", label: "원문 요약", state: "needs_review", detail: "계약 조건 변경" },
            { id: "mobile-risk-draft", label: "답장 초안", state: "needs_review", detail: "내부 확인 필요" },
            { id: "mobile-risk-lock", label: "발송 경계", state: "locked", detail: "보류 검토 전 발송 없음" },
          ],
        },
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: "mock-mobile-mail-risk-draft",
        toneLabel: "휴대폰 메일 보류 초안",
        body: "계약 조건 변경 요청은 내부 확인 후 답변드리겠습니다.",
        operationKind: "send_email",
        requiresApprovalBeforeSend: true,
      },
      finalAction: {
        kind: "send_email",
        label: "메일 발송",
        requiresFinalUserPresence: true,
        readiness: "adapter_not_connected",
        blockedReason: "계약 조건 변경 메일은 검토와 최종 확인 전까지 실제 발송하지 않습니다.",
        checklist: ["계약 조건 확인", "내부 승인 여부 확인", "최종 확인 전 발송 차단"],
        mailSendApprovalGate: {
          policy: "work_queue_approve_only",
          requiredDecision: "approve",
          decision: "hold",
          requiredFinalRoute: "included",
          finalRoute: "held",
          sourceContract: "mobile_share_to_workbench_hold_review",
          externalMutationBeforeGate: false,
        },
      },
    },
  ];
}

function mergeOfficeMockRuntimeInboxItems(nextItems: WorkItem[], currentItems: WorkItem[]): WorkItem[] {
  if (!currentItems.length) return nextItems;
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  return nextItems.map((item) => currentById.get(item.id) ?? item);
}

function mergeOfficeUserComposedMailInboxItems(items: WorkItem[] = []): WorkItem[] {
  return mergeRoleCommandApprovalWorkItems(
    mergeUserComposedMailApprovalWorkItems(items, readUserComposedMailApprovalWorkItems()),
    readRoleCommandApprovalWorkItems(),
  );
}

function isMailOpsTeammate(member: AITeammate) {
  return /메일|MailOps|mail/u.test(
    [
      member.id,
      member.name,
      member.channelName,
      member.teamLabel,
      member.roleTitle,
    ].join(" "),
  );
}

const automaticCrewCoreTeams: AITeammateTeam[] = [
  "operations",
  "mail",
  "desktop",
];

function selectAutomaticCrewTeams(
  growthSuggestions: LocalMemoryGrowthSuggestion[],
) {
  const signals = growthSuggestions
    .map((suggestion) =>
      [
        suggestion.title,
        suggestion.reason,
        suggestion.nextAction,
        suggestion.skillLabel,
        ...(suggestion.connectorIds ?? []),
      ].join(" "),
    )
    .join(" ")
    .toLocaleLowerCase("ko-KR");
  const teams = new Set<AITeammateTeam>(automaticCrewCoreTeams);
  if (/정산|세무|회계|재무|invoice|finance/u.test(signals)) teams.add("finance");
  if (/계약|법무|컴플라이언스|legal/u.test(signals)) teams.add("legal");
  if (/홍보|콘텐츠|캠페인|마케팅|marketing/u.test(signals)) teams.add("marketing");
  if (/개발|버그|배포|제품|기술|development/u.test(signals)) teams.add("development");
  return [...teams];
}

function crewCommandLabel(templateId: AITeammateTeam) {
  const labels: Partial<Record<AITeammateTeam, string>> = {
    operations: "문의·우선순위·반복 업무를 정리해",
    mail: "메일·답장 초안·일정 후보를 준비해",
    desktop: "파일·문서 기준을 학습하고 검토안을 만들어",
    finance: "정산·재무 확인 항목을 초안으로 정리해",
    legal: "계약·법무 확인 포인트를 표시해",
    marketing: "콘텐츠·캠페인 초안을 준비해",
    development: "요구사항·버그·검증 계획을 정리해",
  };
  return labels[templateId] ?? "담당 업무를 검토안으로 준비해";
}
// 프로필 폴링 병합 — 같은 팀원은 updatedAt이 새로운 쪽을 남긴다.
// 프로필이 구버전 앱에서 저장돼 필드가 빠졌거나 오래됐어도, 사용자가 방금
// 오피스에서 저장한 외형·성향·이름이 폴링 한 번에 되돌아가는 일을 막는다.
function mergeCrewMembersByUpdatedAt(current: AITeammate[], incoming: AITeammate[]): AITeammate[] {
  if (!current.length) return incoming;
  const currentById = new Map(current.map((member) => [member.id, member]));
  const merged = incoming.map((member) => {
    const local = currentById.get(member.id);
    if (!local) return member;
    return (Number(local.updatedAt) || 0) > (Number(member.updatedAt) || 0) ? local : member;
  });
  const incomingIds = new Set(incoming.map((member) => member.id));
  // 프로필에 아직 없는 로컬 신규 팀원(방금 채용, 저장 전파 지연)은 10분간 유지
  const recentLocalOnly = current.filter(
    (member) => !incomingIds.has(member.id) && Date.now() - (Number(member.updatedAt) || 0) < 10 * 60_000,
  );
  const next = [...merged, ...recentLocalOnly];
  const unchanged =
    next.length === current.length &&
    next.every((member, index) => {
      const existing = current[index];
      return existing === member || (existing.id === member.id && existing.updatedAt === member.updatedAt);
    });
  return unchanged ? current : next;
}

function selectMailOpsEventTeammate(crewMembers: AITeammate[]) {
  return (
    crewMembers.find(isMailOpsTeammate) ??
    crewMembers.find((member) => member.id === defaultAITeammateId) ??
    crewMembers[0]
  );
}

function shouldSkipMailOpsVirtualOfficeEventRecord(
  current: SelectedWorkActionEvent | undefined,
  next: SelectedWorkActionEvent,
) {
  if (!current) return false;
  return (
    current.updatedAt === next.updatedAt &&
    current.detail === next.detail &&
    current.metrics?.mailOpsWorkQueueTotal === next.metrics?.mailOpsWorkQueueTotal &&
    current.metrics?.mailOpsWorkQueueApproveCount === next.metrics?.mailOpsWorkQueueApproveCount &&
    current.metrics?.mailOpsWorkQueueFinalReadyCount === next.metrics?.mailOpsWorkQueueFinalReadyCount &&
    current.metrics?.mailOpsWorkQueueEditedDraftCount === next.metrics?.mailOpsWorkQueueEditedDraftCount &&
    current.metrics?.mailOpsWorkQueueComposedCount === next.metrics?.mailOpsWorkQueueComposedCount &&
    current.metrics?.mailOpsWorkQueueEngineNextFinalTitle === next.metrics?.mailOpsWorkQueueEngineNextFinalTitle
  );
}

function isOfficeFolderPlanApprovalItem(item: WorkItem): boolean {
  const intentLabels = item.sourceEvidence?.detectedIntentLabels ?? [];
  return Boolean(
    item.source === "local_file" &&
      (item.localFile?.scopeKind === "folder" ||
        intentLabels.some((label) => /folder_plan|정리/u.test(label)) ||
        /폴더\s*정리|정리\s*계획/u.test(`${item.title} ${item.summary} ${item.body}`)),
  );
}

function createOfficeMockFinalConfirmation(
  workItem: WorkItem,
  options: { forceConnected?: boolean } = {},
): FinalConfirmationContract {
  const connectionMissing = readOfficeMockFinalConnectionMissing() && !options.forceConnected;
  return {
    id: "mock-final-confirmation-send-email",
    workItemId: workItem.id,
    title: workItem.title,
    actionKind: "send_email",
    actionLabel: "메일 발송 최종 확인",
    readiness: connectionMissing ? "adapter_not_connected" : "ready_for_final_confirmation",
    blockedReason: connectionMissing ? "회사 메일 연결이 필요합니다. 연결 전에는 실제 발송하지 않습니다." : "",
    checklist: ["수신자 확인", "참조/숨은참조 확인", "제목과 본문 확인", "외부 발송은 승인 후에도 마지막으로 재확인"],
    requiredFields: [
      {
        id: "recipient",
        label: "수신자",
        required: true,
        placeholder: "kim@example.com",
      },
      { id: "subject", label: "제목", required: true, placeholder: "메일 제목" },
      { id: "body", label: "보낼 본문", required: false, multiline: true, placeholder: "보낼 내용" },
      { id: "cc", label: "참조", required: false, placeholder: "name@example.com" },
      { id: "bcc", label: "숨은참조", required: false, placeholder: "name@example.com" },
      {
        id: "confirm_summary",
        label: "확인 메모",
        required: true,
        placeholder: "수신자와 본문 확인",
      },
      {
        id: "cc_bcc_reviewed",
        label: "참조/숨은참조 확인",
        required: false,
        placeholder: "참조/숨은참조/전체발송 여부 확인",
      },
    ],
    defaultValues: {
      recipient: "kim@example.com",
      subject: workItem.title,
      body: workItem.draft?.body || workItem.summary,
      confirm_summary: "수신자와 본문 확인",
      cc_bcc_reviewed: "내부 담당자 참조 여부 확인 필요",
    },
    defaultHints: {
      recipient: "발송 추천: 답장 후보 원문 보낸 사람 / 보류 확인: 내부 담당자 참조 여부 / 학습 판단: 견적 회신은 보낸 사람 직접 답장 후 참조 확인",
      confirm_summary: "실행 전 사용자 확인 기록",
      cc_bcc_reviewed: "참조/숨은참조/전체발송 여부는 사용자가 직접 확인합니다.",
    },
    confirmPhrase: "최종 실행 확인",
    finalUserPresence: true,
    externalMutationOnConfirm: true,
    adapterConnected: !connectionMissing,
    finalExecutionGate: {
      gateContract: "dry_run_receipt_connector_readiness_final_presence",
      label: "메일 발송 최종 실행 게이트",
      actionKind: "send_email",
      status: connectionMissing ? "adapter_not_connected" : "awaiting_final_confirmation",
      dryRunRequired: true,
      dryRunReceiptRequired: true,
      connectorReadinessRequired: true,
      finalUserPresenceRequired: true,
      confirmPhraseRequired: "최종 실행 확인",
      providerDispatchBlockedUntilReady: true,
      externalMutationBeforeGate: false,
      externalMutationOnDryRun: false,
      adapterConnected: !connectionMissing,
      requiredConnectorId: "company-mail",
      connectorId: "company-mail",
      connectorStatus: connectionMissing ? "not_connected" : "ready",
      liveAdapterPlanContract: "mail_final_confirmation_to_live_send_adapter_readiness",
      liveAdapterPlanMode: "gmail_outlook_smtp_or_app_final_confirmation_only",
      liveAdapterSelectedId: connectionMissing ? "" : "mock-mail-adapter",
      liveAdapterReadyCount: connectionMissing ? 0 : 1,
      liveAdapterPendingCount: connectionMissing ? 1 : 0,
      liveAdapterDispatchStatus: connectionMissing ? "connector_ready_send_scope_required" : "live_send_adapter_ready",
      liveAdapterExternalMutationOnConfirm: !connectionMissing,
      liveAdapterProofChain: "mock_runtime_final_confirmation_to_live_adapter_ready",
      liveProviderDispatchContract: "approval_gate_dry_run_final_presence_live_adapter_to_provider_dispatch",
      liveProviderDispatchMode: connectionMissing ? "provider_dispatch_blocked" : "final_confirmation_only",
      liveProviderDispatchPreconditions: ["dry_run_receipt", "connector_readiness", "final_user_presence"],
      externalMutationOnlyAfterFinalConfirmation: true,
      mailSendApprovalGateStatus: workItem.finalAction?.mailSendApprovalGate?.decision ?? "not_required",
      mailSendApprovalGatePolicy: workItem.finalAction?.mailSendApprovalGate?.policy ?? "not_required",
    },
    adapter: {
      status: connectionMissing ? "missing" : "connected",
      connected: !connectionMissing,
      requiredConnectorId: "company-mail",
      requiredCategory: "mail",
      requiredMethod: "oauth_or_smtp",
      label: "회사 메일 연결",
      connectLabel: "메일 연결",
      connectHref: "/connect?connector=company-mail",
      connectorId: "company-mail",
      connectorStatus: connectionMissing ? "not_connected" : "ready",
      userMessage: connectionMissing
        ? "메일 연결이 필요합니다. 연결하기 전에는 실제 발송하지 않습니다."
        : "미리보기 모드에서 연결 준비 상태로 표시합니다.",
    },
  };
}

function createOfficeMockFinalDryRun(workItem: WorkItem): FinalActionDryRunResult {
  return {
    status: "final_action_dry_run_ready",
    auditId: "mock-precheck-audit-send-email",
    auditFile: "memory/audit/mock-final-send-email-dry-run.json",
    auditRecorded: true,
    dryRun: {
      id: "mock-dry-run-send-email",
      workItemId: workItem.id,
      actionKind: "send_email",
      actionLabel: "메일 발송",
      mode: "dry_run_only",
      providerAdapter: "mock-mail-adapter",
      connectorId: "company-mail",
      createdAt: "2026-06-05T09:12:00.000Z",
      executionPlan: {
        summary: "메일 수신자, 제목, 본문을 확인하고 실제 발송은 하지 않습니다.",
        operation: "smtp_send_mail",
        provider: "company-mail",
        dryRunOnly: true,
        externalMutation: false,
        safetyChecks: [
          "recipient_confirmed_by_user",
          "cc_bcc_reviewed_by_user",
          "mail_thread_recipient_decision_reviewed",
          "office_final_confirmation_required",
        ],
        recipientDecision: {
          summary: "최근 견적 문의 스레드의 답장 후보 1명을 우선 추천하고, 참조/숨은참조는 사용자 확인으로 남깁니다.",
          sendCandidateLabels: ["답장 후보: 원문 보낸 사람", "업무 맥락: 견적 확인 요청"],
          holdCandidateLabels: ["관련 담당자: 내부 영업 담당자는 참조 여부만 확인"],
          excludeCandidateLabels: ["원문에 포함된 일반 안내 주소는 발송 제외"],
          learningDecisionHints: ["지난 견적 회신은 보낸 사람 직접 답장 후 내부 담당자 참조를 확인"],
          privacyBoundary: "원문 이메일 주소는 근거 카드에 직접 표시하지 않습니다.",
        },
      },
      checkedFields: [
        { id: "recipient", label: "수신자", required: true, valuePreview: "kim@example.com" },
        { id: "confirm_summary", label: "확인 메모", required: true, valuePreview: "수신자와 본문 확인" },
        { id: "cc_bcc_reviewed", label: "참조/숨은참조 확인", required: false, valuePreview: "내부 담당자 참조 여부 확인 필요" },
      ],
      checks: ["외부 발송 작업 확인", "수신자 판단 근거 확인", "참조/숨은참조 확인", "본문 미리보기 확인", "실제 발송은 차단"],
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    },
    userMessage: "미리보기 모드에서 실행 전 검토를 준비했습니다. 실제 메일은 발송하지 않습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createOfficeMockFinalExecution(workItem: WorkItem): FinalActionExecutionResult {
  const auditId = `mock-final-execution-gate-${workItem.id}`;

  return {
    status: "final_execution_live_adapter_required",
    auditId,
    auditFile: "memory/audit/mock-final-execution-gate.json",
    auditRecorded: true,
    missingRequirements: ["liveProviderExecutionEnabled", "providerAdapterConnected"],
    userMessage: "마지막 확인 완료. 실제 메일 발송은 설치 앱에서 연결과 최종 확인이 모두 준비될 때만 진행합니다.",
    finalExecutionReceipt: {
      contract: "office_final_execution_receipt_v1",
      workItemId: workItem.id,
      actionKind: workItem.finalAction?.kind ?? "send_email",
      mutationLabel: workItem.finalAction?.label ?? "메일 발송",
      status: "final_execution_live_adapter_required",
      summary: "mockRuntime에서는 최종 확인 후에도 실제 메일 발송을 잠그고 설치 앱 연결 준비만 기록합니다.",
      dryRunId: "mock-dry-run-send-email",
      auditId,
      auditFile: "memory/audit/mock-final-execution-gate.json",
      externalMutation: false,
      finalSendOrCalendarMutationLocked: true,
      originalMailMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      missingRequirements: ["liveProviderExecutionEnabled", "providerAdapterConnected"],
      gateStatus: "live_adapter_required",
      providerDispatchStatus: "blocked_until_live_adapter_ready",
      proofChain: "mock_runtime_dry_run_final_confirmation_receipt_no_external_mutation",
    },
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createOfficeMockBrowserTaskDispatchResult(
  workItem: WorkItem,
  capability: DesktopControlCapabilityId,
): DesktopControlDispatchResult {
  const now = new Date().toISOString();
  const baseContract = buildBrowserTaskContractForWorkItem(workItem, now);
  if (capability === "attach_browser_screen_evidence") {
    const screenEvidence = {
      capturedAt: now,
      mode: "mock_runtime_read_only",
      sourceKind: "window" as const,
      sourceLabel: "메일 작성 화면",
      sourceCount: 1,
      matchReason: "검증용 업무창 제목과 대상 URL이 일치합니다.",
      targetElementDescription: baseContract.targetElementDescription,
      evidenceSummary: "메일 작성 화면의 발송 직전 대상 영역을 읽기 전용으로 확인했습니다.",
      rawPixelsStored: false as const,
      rawSecretMaterialStored: false as const,
      rawSecretMaterialReturned: false as const,
    };
    const stagedWorkItem = mergeBrowserTaskContract(workItem, {
      ...baseContract,
      readiness: "ready_for_user_confirmation",
      screenEvidenceStatus: "captured",
      screenEvidence,
      blockedReason: "화면 증거는 붙었지만 실제 클릭·입력·발송은 계속 승인 잠금입니다.",
      allowedNextStep: "대상 요소 매칭으로 실행 전 검토 대상과 화면 증거를 비교합니다.",
    });
    return {
      status: "browser_screen_evidence_attached",
      capability,
      userMessage: "화면 증거를 카드에 붙였습니다. 실제 외부 조작은 실행하지 않았습니다.",
      sideEffect: "read_only",
      observedAt: now,
      stagedWorkItem,
      screenEvidence,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (capability === "match_browser_target_element") {
    const targetElementMatch = {
      matchedAt: now,
      status: "matched" as const,
      confidence: "high" as const,
      targetLabel: baseContract.targetElementDescription,
      evidenceSourceLabel: baseContract.screenEvidence?.sourceLabel || "메일 작성 화면",
      matchingMethod: "화면 증거와 실행 전 검토 대상 문구 비교",
      safetyNotes: ["좌표와 원본 화면 이미지는 저장하지 않습니다.", "실제 조작은 제한된 마지막 확인 전까지 잠겨 있습니다."],
      rawCoordinatesStored: false as const,
      rawPixelsStored: false as const,
      rawSecretMaterialStored: false as const,
      rawSecretMaterialReturned: false as const,
    };
    const stagedWorkItem = mergeBrowserTaskContract(workItem, {
      ...baseContract,
      targetElementDescription: targetElementMatch.targetLabel,
      targetElementMatchStatus: "matched",
      targetElementMatch,
      blockedReason: "대상 요소 매칭은 완료됐지만 실제 클릭·입력·발송은 계속 승인 잠금입니다.",
      allowedNextStep: "마지막 확인을 준비해 감사 ID와 확인 문구를 남깁니다.",
    });
    return {
      status: "browser_target_element_matched",
      capability,
      userMessage: "대상 요소 매칭 기록을 남겼습니다. 실제 외부 조작은 실행하지 않았습니다.",
      sideEffect: "read_only",
      observedAt: now,
      stagedWorkItem,
      targetElementMatch,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const auditFile = `memory/audit/mock-browser-task-${capability}.jsonl`;
  const limitedExecutionGate = {
    ...(baseContract.limitedExecutionGate ?? {}),
    preparedAt: baseContract.limitedExecutionGate?.preparedAt || now,
    status: "prepared" as const,
    auditId: baseContract.limitedExecutionGate?.auditId || `mock-browser-gate-${workItem.id}`,
    auditFile,
    auditRecorded: true,
    actionCapability: workItem.browserTask?.actionPlan?.[0]?.capability || "browser_action",
    actionLabel: workItem.browserTask?.actionPlan?.[0]?.label || baseContract.actionLabel,
    targetLabel: baseContract.targetElementDescription,
    intendedInput: workItem.browserTask?.dryRunPlan?.intendedInput || workItem.draft?.body || workItem.title,
    expectedResult: workItem.browserTask?.dryRunPlan?.expectedResult || "사용자 확인 전까지 실행하지 않습니다.",
    confirmationPhrase: baseContract.userConfirmationPhrase,
    requiresFinalUserPresence: true as const,
    liveExecutionEnabled: false,
    dryRunOnly: true,
    rollbackGuide: workItem.browserTask?.dryRunPlan?.rollbackGuide || "실행 전에는 카드 취소로 외부 변경 없이 보류합니다.",
    safetyChecklist: workItem.browserTask?.dryRunPlan?.preflightChecklist || ["대상 확인", "내용 확인", "최종 승인"],
    blockedCapabilities: workItem.browserTask?.blockedCapabilities || ["external_mutation"],
    rawCoordinatesStored: false as const,
    rawPixelsStored: false as const,
    rawSecretMaterialStored: false as const,
    rawSecretMaterialReturned: false as const,
  };

  if (capability === "confirm_browser_limited_execution") {
    const confirmedGate = {
      ...limitedExecutionGate,
      status: "blocked" as const,
      userConfirmedAt: now,
      userConfirmationVerified: true,
      confirmationAuditFile: auditFile,
      confirmationAuditRecorded: true,
      adapterReadiness: "adapter_not_connected" as const,
      executionStatus: "adapter_locked" as const,
      liveExecutionEnabled: false,
      dryRunOnly: true,
      blockedReason: "미리보기 모드에서는 실제 브라우저 클릭·입력을 열지 않습니다.",
    };
    const stagedWorkItem = mergeBrowserTaskContract(workItem, {
      ...baseContract,
      readiness: "limited_execution_confirmed_adapter_locked",
      limitedExecutionGate: confirmedGate,
      blockedReason: "최종 문구는 확인됐지만 실제 클릭·입력·발송은 계속 승인 잠금입니다.",
      allowedNextStep: "실행 요청 점검으로 실제 조작 차단 상태와 감사 경로를 남깁니다.",
    });
    return {
      status: "browser_limited_execution_confirmed_adapter_locked",
      capability,
      userMessage: "최종 확인 문구를 기록했습니다. 실제 외부 조작은 실행하지 않았습니다.",
      sideEffect: "read_only",
      observedAt: now,
      stagedWorkItem,
      limitedExecutionGate: confirmedGate,
      auditFile,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (capability === "request_browser_limited_execution") {
    const attemptedGate = {
      ...limitedExecutionGate,
      status: "blocked" as const,
      userConfirmationVerified: true,
      executionAttemptedAt: now,
      executionAttemptAuditFile: auditFile,
      executionAttemptAuditRecorded: true,
      adapterReadiness: "adapter_not_connected" as const,
      executionStatus: "adapter_locked" as const,
      liveExecutionEnabled: false,
      dryRunOnly: true,
      blockedReason: "미리보기 모드에서는 실제 브라우저 클릭·입력을 열지 않습니다.",
    };
    const stagedWorkItem = mergeBrowserTaskContract(workItem, {
      ...baseContract,
      readiness: "limited_execution_confirmed_adapter_locked",
      limitedExecutionGate: attemptedGate,
      blockedReason: "실행 요청은 감사 경로에 남겼고 실제 클릭·입력·발송은 실행하지 않았습니다.",
      allowedNextStep: "설치 앱에서는 실행 가능 조건과 실행 후 결과 확인을 이어서 점검합니다.",
    });
    return {
      status: "browser_limited_execution_adapter_blocked",
      capability,
      userMessage: "실행 요청을 감사 경로에 남기고 실제 조작은 차단했습니다.",
      sideEffect: "read_only",
      observedAt: now,
      stagedWorkItem,
      limitedExecutionGate: attemptedGate,
      auditFile,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const stagedWorkItem = mergeBrowserTaskContract(workItem, {
    ...baseContract,
    readiness: "limited_execution_ready",
    limitedExecutionGate,
    blockedReason: "마지막 확인과 감사 경로만 준비했고 실제 클릭·입력·발송은 실행하지 않았습니다.",
    allowedNextStep: "설치 앱에서는 최종 문구 확인 뒤에도 실행 안전 조건을 다시 점검합니다.",
  });
  return {
    status: "browser_limited_execution_prepared",
    capability,
    userMessage: "마지막 확인과 감사 기록 경로를 준비했습니다. 실제 외부 조작은 실행하지 않았습니다.",
    sideEffect: "read_only",
    observedAt: now,
    stagedWorkItem,
    limitedExecutionGate,
    auditFile,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function applyBrowserTaskDispatchResultToInbox(
  items: WorkItem[],
  workItemId: string,
  result: DesktopControlDispatchResult,
): WorkItem[] {
  return items.map((item) => {
    if (item.id !== workItemId) return item;
    if (result.stagedWorkItem) return result.stagedWorkItem;
    if (!item.browserTask) return item;
    const nextContract = buildBrowserTaskContractForWorkItem(item, result.observedAt || new Date().toISOString());
    const readiness = readinessForBrowserTaskDispatchResult(result, nextContract.readiness);
    return mergeBrowserTaskContract(item, {
      ...nextContract,
      readiness,
      ...(result.screenEvidence
        ? {
            screenEvidenceStatus: "captured" as const,
            screenEvidence: result.screenEvidence,
          }
        : {}),
      ...(result.targetElementMatch
        ? {
            targetElementMatchStatus: result.targetElementMatch.status,
            targetElementMatch: result.targetElementMatch,
          }
        : {}),
      ...(result.limitedExecutionGate ? { limitedExecutionGate: result.limitedExecutionGate } : {}),
      ...(result.postExecutionEvidence && result.limitedExecutionGate
        ? {
            limitedExecutionGate: {
              ...result.limitedExecutionGate,
              postExecutionEvidence: result.postExecutionEvidence,
            },
          }
        : {}),
    });
  });
}

function createOfficeMockLocalFileDispatchResult(
  workItem: WorkItem,
  capability: DesktopControlCapabilityId,
): DesktopControlDispatchResult {
  const now = new Date().toISOString();
  const fileName = workItem.localFile?.name || "선택 파일";
  const isDraft = capability === "draft_from_local_file";
  const stagedWorkItem: WorkItem = {
    ...workItem,
    title: isDraft ? `보고서 초안: ${fileName}` : `문서 분석: ${fileName}`,
    summary: isDraft
      ? `${fileName} 기준으로 보고서 초안을 만들었습니다. 저장, 공유, 발송은 승인 전까지 잠겨 있습니다.`
      : `${fileName} 내용을 읽고 확인 항목과 위험 신호를 정리했습니다.`,
    status: "draft_ready",
    receivedAt: now,
    draft: {
      id: `${workItem.id}:${isDraft ? "mock-output" : "mock-analysis"}`,
      toneLabel: isDraft ? "문서 보고서 초안" : "문서 분석 결과",
      body: isDraft
        ? [
            `# ${fileName} 보고서 초안`,
            "- 핵심 금액과 일정 확인",
            "- 누락 항목 재검토",
            "- 외부 공유 전 사용자 승인 필요",
          ].join("\n")
        : [
            "확인 항목",
            "1. 금액 합계와 행별 금액 확인",
            "2. 빈 셀과 누락 항목 확인",
            "3. 외부 공유 여부는 승인 전 잠금",
          ].join("\n"),
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    localFile: workItem.localFile
      ? {
          ...workItem.localFile,
          extractedTextStatus: "ready",
          preview: "미리보기 모드에서 파일 내용 일부를 읽은 흐름을 확인했습니다. 실제 원본 파일은 변경하지 않았습니다.",
        }
      : undefined,
  };

  return {
    status: isDraft ? "output_drafted" : "file_analyzed",
    capability,
    userMessage: isDraft
      ? "파일 보고서 초안을 만들었습니다. 실제 파일 저장이나 외부 공유는 실행하지 않았습니다."
      : "파일 분석을 완료했습니다. 실제 파일 변경은 없습니다.",
    sideEffect: "read_only",
    observedAt: now,
    stagedWorkItem,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createOfficeMockFolderPlanPreviewResult(workItem: WorkItem): DocumentLearningFolderPlanPreviewResult {
  return {
    status: "document_learning_folder_plan_previewed",
    planPath: "mock://folder-plan/modycrew-folder-plan.json",
    reportPath: workItem.localFile?.path || "mock://folder-plan/modycrew-folder-plan.md",
    operationCount: 8,
    applySafetyReview: {
      confirmationTextRequired: "정리 적용 승인",
      revertConfirmationTextRequired: "정리 되돌리기 승인",
      defaultOrganizedRoot: "Downloads\\ModyCrew_정리",
      collisionPolicies: [
        {
          id: "rename",
          label: "겹치면 이름 바꾸기",
          detail: "같은 이름이 있으면 덮어쓰지 않고 새 이름을 씁니다.",
          selected: true,
        },
      ],
      exclusionOptions: ["임시 파일 제외", "중복 후보 수동 검토", "충돌 파일 건너뛰기"],
      targetFolderCount: 3,
      duplicateReviewCount: 1,
      operationCount: 8,
      externalMutationBeforeApproval: false,
      originalFilesDeleted: false,
      overwriteAllowed: false,
    },
    operations: [],
    safetyReceipt: {
      phase: "preview",
      operationCount: 8,
      changedCount: 0,
      collisionPolicy: "rename",
      collisionSkipCount: 0,
      userExcludedCount: 0,
      excludedOperationCount: 0,
      excludedPathKeywordCount: 0,
      safetySummary: "원본 삭제와 기존 파일 덮어쓰기는 비활성화되어 있습니다.",
      collisionSummary: "겹치는 대상은 덮어쓰지 않고 새 이름으로 이동하도록 설정했습니다.",
      exclusionSummary: "사용자 제외 기준은 없고 중복 후보는 수동 검토로 남깁니다.",
      rollbackGuide: "적용 전에는 원본 변경이 없고, 적용 후에는 적용 기록이 있을 때만 '정리 되돌리기 승인'으로 되돌립니다.",
      nextUserChoice: "오피스 승인함에서 겹침 처리, 제외 단어를 확인한 뒤 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 선택하세요.",
      originalFilesDeleted: false,
      overwritePerformed: false,
    },
    safetySummary: "원본 삭제와 기존 파일 덮어쓰기는 비활성화되어 있습니다.",
    collisionSummary: "겹치는 대상은 덮어쓰지 않고 새 이름으로 이동하도록 설정했습니다.",
    exclusionSummary: "사용자 제외 기준은 없고 중복 후보는 수동 검토로 남깁니다.",
    rollbackGuide: "적용 전에는 원본 변경이 없고, 적용 후에는 적용 기록이 있을 때만 '정리 되돌리기 승인'으로 되돌립니다.",
    nextUserChoice: "오피스 승인함에서 겹침 처리, 제외 단어를 확인한 뒤 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 선택하세요.",
    userApprovalRequiredBeforeMoveOrDelete: true,
    userMessage: "8개 정리 후보를 실행 전 검토로 확인했습니다. 원본 이동과 삭제는 실행하지 않았습니다.",
    externalMutation: false,
    rawSecretMaterialReturned: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
  };
}

function createOfficeMockFolderPlanApplyResult(
  action: "apply" | "revert",
  manifestPath = "mock://folder-plan/modycrew-folder-apply-manifest.json",
  options: FolderPlanApprovalOptions = defaultFolderPlanApprovalOptions(),
  workItem?: WorkItem,
): DocumentLearningFolderPlanApplyResult {
  if (action === "revert") {
    return {
      status: "document_learning_folder_plan_reverted",
      manifestPath,
      revertManifestPath: "mock://folder-plan/modycrew-folder-revert-manifest.json",
      revertedCount: 1,
      skippedCount: 0,
      userApprovalRequiredBeforeMoveOrDelete: true,
      overwritePerformed: false,
      externalMutation: false,
      rawSecretMaterialReturned: false,
      originalFilesMoved: true,
      originalFilesDeleted: false,
      safetySummary: "원본 삭제와 기존 파일 덮어쓰기는 비활성화되어 있습니다.",
      collisionSummary: "되돌리기 단계에서는 새 충돌 이동을 만들지 않습니다.",
      exclusionSummary: "적용 때 저장된 제외 기준과 적용 기록을 기준으로 확인했습니다.",
      rollbackGuide: "되돌리기는 적용 기록 파일이 있을 때만 '정리 되돌리기 승인' 확인 후 실행합니다.",
      nextUserChoice: "되돌리기 기록을 확인하거나 새 폴더 정리 후보를 다시 만들 수 있습니다.",
      userMessage: "정리 되돌리기 승인을 확인했고 적용 기록 기준으로 1개 파일을 되돌렸습니다.",
    };
  }
  const mailAttachmentOrganizer = workItem?.sourceEvidence?.mailAttachmentOrganizer;
  return {
    status: "document_learning_folder_plan_applied",
    planPath: "mock://folder-plan/modycrew-folder-plan.json",
    manifestPath,
    reportPath: "mock://folder-plan/modycrew-folder-apply-report.md",
    organizedRoot: "Downloads\\ModyCrew_정리",
    collisionPolicy: options.collisionPolicy,
    excludedPathKeywords: parseFolderPlanExcludedKeywords(options.excludedPathKeywords),
    appliedCount: 1,
    skippedCount: options.excludedPathKeywords.trim() ? 3 : 2,
    userApprovalRequiredBeforeMoveOrDelete: true,
    overwritePerformed: false,
    externalMutation: true,
    rawSecretMaterialReturned: false,
    originalFilesMoved: true,
    originalFilesDeleted: false,
    safetySummary: "원본 삭제와 기존 파일 덮어쓰기는 비활성화되어 있습니다.",
    collisionSummary:
      options.collisionPolicy === "skip"
        ? "겹치는 대상은 덮어쓰지 않고 건너뛰도록 설정했습니다."
        : "겹치는 대상은 덮어쓰지 않고 새 이름으로 이동하도록 설정했습니다.",
    exclusionSummary: options.excludedPathKeywords.trim()
      ? "사용자 제외 기준을 적용했고 해당 작업은 이동하지 않습니다."
      : "사용자 제외 기준은 없고 중복 후보는 수동 검토로 남깁니다.",
    rollbackGuide: "되돌리기는 적용 기록 파일이 있을 때만 '정리 되돌리기 승인' 확인 후 실행합니다.",
    nextUserChoice: "적용 기록을 확인한 뒤 필요하면 정리 되돌리기 승인을 선택하세요.",
    ...(mailAttachmentOrganizer
      ? {
          mailAttachmentOrganizerApply: {
            contract: "downloaded_mail_attachment_to_folder_plan_final_apply",
            sourceContract: mailAttachmentOrganizer.contract || "downloaded_mail_attachment_to_folder_plan_approval",
            sourceKind: "mail_attachment_local_copy",
            connectorId: mailAttachmentOrganizer.connectorId,
            providerId: mailAttachmentOrganizer.providerId,
            sourceMessageId: mailAttachmentOrganizer.sourceMessageId,
            messageSubject: mailAttachmentOrganizer.messageSubject || workItem?.sourceEvidence?.messageSubject,
            appliedLocalCopyCount: 1,
            skippedLocalCopyCount: options.excludedPathKeywords.trim() ? 3 : 2,
            originalMailMutation: false,
            originalAttachmentDeleted: false,
            externalShareBeforeApproval: false,
            finalApprovalEvidence: "정리 적용 승인",
          },
        }
      : {}),
    userMessage: "정리 적용 승인을 확인했고 1개 파일을 ModyCrew_정리로 이동했습니다. 삭제/덮어쓰기는 실행하지 않았습니다.",
  };
}

function applyLocalFileDispatchResultToInbox(
  items: WorkItem[],
  workItemId: string,
  result: DesktopControlDispatchResult,
): WorkItem[] {
  return items.map((item) => (item.id === workItemId && result.stagedWorkItem ? result.stagedWorkItem : item));
}

function buildBrowserTaskContractForWorkItem(workItem: WorkItem, now: string) {
  const browserTask = workItem.browserTask;
  const existing = browserTask?.finalPresenceContract;
  return {
    finalUserPresence: true as const,
    readiness: existing?.readiness || "screen_evidence_required" as const,
    host: existing?.host || browserTask?.host || new URL(browserTask?.targetUrl || "https://example.com").host,
    targetUrl: existing?.targetUrl || browserTask?.targetUrl || "",
    actionLabel: existing?.actionLabel || browserTask?.actionPlan?.[0]?.label || browserTask?.stagedAction?.label || workItem.title,
    capability: existing?.capability || browserTask?.actionPlan?.[0]?.capability || "browser_action",
    targetElementDescription:
      existing?.targetElementDescription || browserTask?.dryRunPlan?.clickTarget || browserTask?.actionPlan?.[0]?.label || workItem.title,
    screenEvidenceRequired: existing?.screenEvidenceRequired ?? true,
    screenEvidenceStatus: existing?.screenEvidenceStatus || "not_captured" as const,
    ...(existing?.screenEvidence ? { screenEvidence: existing.screenEvidence } : {}),
    ...(existing?.targetElementMatchStatus ? { targetElementMatchStatus: existing.targetElementMatchStatus } : {}),
    ...(existing?.targetElementMatch ? { targetElementMatch: existing.targetElementMatch } : {}),
    ...(existing?.limitedExecutionGate ? { limitedExecutionGate: existing.limitedExecutionGate } : {}),
    userConfirmationPhrase: existing?.userConfirmationPhrase || "화면 대상 실행 확인",
    blockedReason: existing?.blockedReason || "화면 증거와 최종 사용자 확인 전까지 실제 클릭·입력·발송은 잠겨 있습니다.",
    allowedNextStep: existing?.allowedNextStep || "화면 증거를 붙여 대상 화면을 읽기 전용으로 확인합니다.",
    manualVerificationChecklist: existing?.manualVerificationChecklist || browserTask?.dryRunPlan?.preflightChecklist || ["대상 확인", "내용 확인", "승인 확인"],
  };
}

function mergeBrowserTaskContract(
  workItem: WorkItem,
  contract: NonNullable<NonNullable<WorkItem["browserTask"]>["finalPresenceContract"]>,
): WorkItem {
  return {
    ...workItem,
    status: workItem.status === "completed" ? "needs_review" : workItem.status,
    browserTask: workItem.browserTask
      ? {
          ...workItem.browserTask,
          finalPresenceContract: contract,
        }
      : workItem.browserTask,
  };
}

function readinessForBrowserTaskDispatchResult(
  result: DesktopControlDispatchResult,
  fallback: NonNullable<NonNullable<WorkItem["browserTask"]>["finalPresenceContract"]>["readiness"],
) {
  if (result.status === "browser_screen_evidence_attached") return "ready_for_user_confirmation";
  if (result.status === "browser_limited_execution_prepared") return "limited_execution_ready";
  if (result.status === "browser_limited_execution_confirmed_adapter_locked") return "limited_execution_confirmed_adapter_locked";
  if (result.status === "browser_limited_execution_adapter_blocked") return "limited_execution_confirmed_adapter_locked";
  if (result.status === "browser_limited_execution_executed") return "limited_execution_executed";
  if (result.status === "browser_limited_execution_result_verified") return "limited_execution_result_verified";
  if (result.status === "browser_limited_execution_result_needs_review") return "limited_execution_result_needs_review";
  return fallback;
}

function createMailOpsDecisionRecord(
  workItem: WorkItem,
  decision: MailOpsDecision,
  decidedAt: string,
  revisionInstruction: string,
): LocalMemoryWorkDecisionInput {
  const isGeneralExecutionCandidate = Boolean(workItem.browserTask || workItem.localFile);
  const approvedPreview = isGeneralExecutionCandidate
    ? "사용자가 실행 후보를 승인했고 앱 최종 확인 단계로 넘깁니다."
    : "사용자가 답장/일정 후보를 승인했고 앱 최종 확인 단계로 넘깁니다.";
  const changeRequestedPreview = isGeneralExecutionCandidate
    ? revisionInstruction || "사용자가 실행 후보 수정을 요청했습니다."
    : revisionInstruction || "사용자가 답장/일정 후보 수정을 요청했습니다.";
  const heldPreview = isGeneralExecutionCandidate
    ? "사용자가 실행 후보를 보류했습니다."
    : "사용자가 답장/일정 후보를 보류했습니다.";
  const messagePreview =
    decision === "approved"
      ? approvedPreview
      : decision === "change_requested"
        ? changeRequestedPreview
        : heldPreview;
  const queueReviewLines = formatMailOpsWorkQueueReviewLines(findMailOpsWorkQueueReviewRecordForWorkItem(workItem));
  return {
    id: `${workItem.id}:mailops:${decision}:${decidedAt}`,
    title: workItem.title,
    sourceLabel: workItem.sourceLabel || (isGeneralExecutionCandidate ? "오피스 승인함" : "메일 점검"),
    status: decision === "approved" ? "approval_pending" : decision,
    receivedAt: workItem.receivedAt,
    teammateId: workItem.teammateId || "teammate-ops",
    teammateName: workItem.teammateName || "업무 비서",
    channelDecision: {
      channel: "Mail Assistant Inbox",
      decision,
      decidedBy: "ModyCrew Office",
      decidedAt,
      messagePreview: queueReviewLines.length ? `${messagePreview} ${queueReviewLines.join(" ")}` : messagePreview,
      requiresAppReconfirm: decision === "approved",
      externalMutation: false,
      revisionInstruction: revisionInstruction || undefined,
    },
  };
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

function mailOpsWorkQueueDecisionLabel(decision: MailOpsWorkQueueDecision): string {
  if (decision === "approve") return "승인 대기";
  if (decision === "revise") return "수정 요청";
  if (decision === "hold") return "확인 필요";
  return "답장 안 보냄";
}

function findMailOpsWorkQueueReviewRecordForWorkItem(workItem: WorkItem): MailOpsWorkQueueReviewRecord | null {
  const records = readMailOpsWorkQueueReviewRecords();
  if (!records.length || !workItem.id) return null;
  // 정확히 같은 카드 ID로만 연결합니다(itemId 포함). 제목 '부분 포함' 매칭은 다른 메일의 승인·수정본을
  // 엉뚱한 카드에 붙여 다른 거래처 답장 본문으로 발송될 수 있었습니다. 제목 일치는 보류 거부권으로만 씁니다.
  return findExactMailWorkQueueRecord(records, workItem.id);
}

function formatMailOpsWorkQueueReviewLines(record: MailOpsWorkQueueReviewRecord | null): string[] {
  if (!record) return [];
  const note = record.note ? ` · 수정 메모: ${record.note}` : "";
  const revisedDraft = record.revisedDraft
    ? ` · 수정본 본문: ${record.revisedDraft.replace(/\s+/gu, " ").trim().slice(0, 420)}`
    : "";
  return [
    `업무대장 검토 반영: ${mailOpsWorkQueueDecisionLabel(record.decision)}${note}${revisedDraft}`,
    `검토 컨텍스트 proof: ${record.approvalContext} · 외부 실행 ${record.externalMutation}`,
  ];
}

function mailOpsFinalRouteForDecision(decision: MailOpsWorkQueueDecision): "included" | "held" | "excluded" {
  if (decision === "approve") return "included";
  if (decision === "exclude") return "excluded";
  return "held";
}

function createMailSendApprovalGateFromWorkQueueRecord(
  record: MailOpsWorkQueueReviewRecord,
): NonNullable<FinalConfirmationPrepareOptions["mailSendApprovalGate"]> {
  // 발송 본문이 되는 수정본은 줄바꿈을 지우지 않고, 1200자에서 자르지도 않습니다.
  const revisedDraft = record.revisedDraft?.replace(/\r\n?/gu, "\n").trim().slice(0, 12000);
  const reviewNote = record.note?.replace(/\s+/gu, " ").trim().slice(0, 240);
  return {
    policy: "work_queue_approve_only",
    requiredDecision: "approve",
    decision: record.decision,
    requiredFinalRoute: "included",
    finalRoute: mailOpsFinalRouteForDecision(record.decision),
    sourceContract: "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log",
    ...(revisedDraft ? { revisedDraft } : {}),
    ...(reviewNote ? { reviewNote } : {}),
    ...(record.decisionReasonSummary ? { decisionReasonSummary: record.decisionReasonSummary } : {}),
    ...(record.sendCheckSummary ? { sendCheckSummary: record.sendCheckSummary } : {}),
    ...(record.draftBodySource ? { draftBodySource: record.draftBodySource } : {}),
    externalMutationBeforeGate: false,
  };
}

type FinalConfirmationUserIntent = {
  userInitiated?: boolean;
  /** 지금 인박스에 있는 다른 카드 ID들 — 그 카드를 가리키는 업무대장 기록은 이 카드를 막지 않습니다. */
  otherCardIds?: Iterable<string>;
};

/**
 * 사용자가 카드를 직접 눌렀어도 보내면 안 되는 이유(업무대장·카드에 남은 보류/답장 안 보냄/수정 요청).
 * 없으면 "" — 그 클릭을 이 카드의 발송 승인으로 봅니다.
 */
function mailSendHoldNoticeForWorkItem(workItem: WorkItem, options: FinalConfirmationUserIntent = {}): string {
  if (workItem.finalAction?.kind !== "send_email" || !options.userInitiated) return "";
  return (
    findMailSendHoldVeto({
      card: workItem,
      records: readMailOpsWorkQueueReviewRecords(),
      otherCardIds: options.otherCardIds,
    })?.userMessage ?? ""
  );
}

function createFinalConfirmationPrepareOptionsForWorkItem(
  workItem: WorkItem,
  options: FinalConfirmationUserIntent = {},
): FinalConfirmationPrepareOptions | undefined {
  if (workItem.finalAction?.kind !== "send_email") return undefined;
  const queueReviewRecord = findMailOpsWorkQueueReviewRecordForWorkItem(workItem);
  if (queueReviewRecord) {
    return {
      mailSendApprovalGate: createMailSendApprovalGateFromWorkQueueRecord(queueReviewRecord),
    };
  }
  const cardGate = workItem.finalAction.mailSendApprovalGate;
  // 업무대장(메일 작업대)이나 카드에 남은 '보류·답장 안 보냄·수정 요청'은 클릭 한 번으로 지우지 않습니다.
  const holdVeto = options.userInitiated
    ? findMailSendHoldVeto({ card: workItem, records: readMailOpsWorkQueueReviewRecords(), otherCardIds: options.otherCardIds })
    : null;
  if (holdVeto?.record) {
    // 예전 방식(제목 일치)으로 찾은 기록은 보류 결정만 넘기고 본문 재료로는 쓰지 않습니다.
    const { revisedDraft: _legacyDraft, ...heldGate } = createMailSendApprovalGateFromWorkQueueRecord(
      holdVeto.record as MailOpsWorkQueueReviewRecord,
    );
    return { mailSendApprovalGate: heldGate };
  }
  if (options.userInitiated && !holdVeto) {
    // 사용자가 이 카드에서 직접 '마지막 확인 준비'를 눌렀으면 그 클릭이 곧 이 카드의 승인입니다.
    // (업무대장 기록이 없던 AI 답장 카드가 오피스에서 보낼 수 없던 문제) 수신자·본문 확인과
    // 실행 전 검토·마지막 확인은 그대로 거칩니다. 가림 사본(revisedDraft)은 되돌려 보내지 않습니다.
    return {
      mailSendApprovalGate: {
        policy: cardGate?.policy === "user_composed_check_approve_only" ? "user_composed_check_approve_only" : "work_queue_approve_only",
        requiredDecision: "approve",
        decision: "approve",
        requiredFinalRoute: "included",
        finalRoute: "included",
        sourceContract:
          cardGate?.sourceContract || "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log",
        draftBodySource: "approval_preview",
        ...(cardGate?.reviewNote ? { reviewNote: cardGate.reviewNote } : {}),
        externalMutationBeforeGate: false,
      },
    };
  }
  if (cardGate) {
    const { revisedDraft: _redactedEcho, ...gateWithoutRedactedDraft } = cardGate;
    return {
      mailSendApprovalGate: gateWithoutRedactedDraft,
    };
  }
  return undefined;
}

function isLearnedDraftWorkItem(workItem: WorkItem): boolean {
  return workItem.sourceEvidence?.providerId === "document_learning" && Boolean(workItem.draft) && !workItem.finalAction;
}

function finalActionKindForLearnedDraft(workItem: WorkItem): FinalActionKind | null {
  if (workItem.draft?.operationKind === "draft_reply") return "send_email";
  if (workItem.draft?.operationKind === "draft_calendar_event") return "create_calendar_event";
  return null;
}

function isRepeatWorkApprovalWorkItem(workItem: WorkItem): boolean {
  const approvalLabels = workItem.sourceEvidence?.approvalCandidateLabels?.join(" ") ?? "";
  const text = [
    workItem.title,
    workItem.summary,
    workItem.sourceLabel,
    approvalLabels,
    workItem.sourceEvidence?.providerId,
    workItem.sourceEvidence?.connectorId,
    workItem.scheduleBriefing?.triggerRuleId,
    workItem.scheduleBriefing?.reason,
  ]
    .filter(Boolean)
    .join(" ");
  return /반복\s*업무|업무팩|자동\s*점검|automation|trigger|scheduler|scheduleBriefing|triggerRule/u.test(text);
}

function homeApprovalDecisionSourceForWorkItem(workItem: WorkItem): HomeApprovalDecisionReceiptSource {
  if (isRepeatWorkApprovalWorkItem(workItem)) return "repeat_work";
  if (workItem.browserTask) return "browser_task";
  if (workItem.localFile) return "local_file";
  return "mailops";
}

function createLearnedDraftDecisionRecord(
  workItem: WorkItem,
  decision: MailOpsDecision,
  decidedAt: string,
  revisionInstruction: string,
): LocalMemoryWorkDecisionInput {
  const messagePreview =
    decision === "approved"
      ? "사용자가 자료 학습 초안을 승인했습니다. 메일·일정 초안은 앱 최종 확인 카드로 넘깁니다."
      : decision === "change_requested"
        ? revisionInstruction || "사용자가 자료 학습 초안 수정을 요청했습니다."
        : "사용자가 자료 학습 초안을 보류했습니다.";
  return {
    id: `${workItem.id}:learned-draft:${decision}:${decidedAt}`,
    title: workItem.title,
    sourceLabel: workItem.sourceLabel || "자료 학습",
    status: decision === "approved" ? "approval_pending" : decision,
    receivedAt: workItem.receivedAt,
    teammateId: "teammate-document",
    teammateName: "문서 업무 비서",
    channelDecision: {
      channel: "학습 초안 오피스 승인함",
      decision,
      decidedBy: "ModyCrew Office",
      decidedAt,
      messagePreview,
      requiresAppReconfirm: decision === "approved" && Boolean(finalActionKindForLearnedDraft(workItem)),
      externalMutation: false,
      revisionInstruction: revisionInstruction || undefined,
    },
  };
}

function createUserComposedMailFinalConfirmation(workItem: WorkItem): FinalConfirmationContract {
  const to = workItem.sourceEvidence?.replyToLabel || "수신자 확인 필요";
  const subject = workItem.sourceEvidence?.messageSubject || "제목 확인 필요";
  const attachmentCheck = workItem.finalAction?.checklist.find((item) => /첨부/u.test(item)) || "첨부 확인 필요";
  return {
    id: `user-composed-mail-final-confirmation-${workItem.id}`,
    workItemId: workItem.id,
    title: workItem.title,
    actionKind: "send_email",
    actionLabel: "작성 메일 발송 최종 확인",
    readiness: "adapter_not_connected",
    blockedReason: "작성 메일 점검 후보입니다. 메일 연결과 사용자 최종 확인 전까지 실제 발송하지 않습니다.",
    checklist: [
      `수신자: ${to}`,
      `제목: ${subject}`,
      attachmentCheck,
      "본문 톤, 금지 표현, 누락 정보 확인",
      "사용자 최종 확인 전 외부 발송 없음",
    ],
    requiredFields: [
      {
        id: "recipient",
        label: "수신자",
        required: true,
        placeholder: to,
      },
      {
        id: "subject",
        label: "제목",
        required: true,
        placeholder: subject,
      },
      {
        id: "confirm_summary",
        label: "확인 메모",
        required: true,
        placeholder: "수신자, 제목, 본문, 첨부 확인",
      },
    ],
    defaultValues: {
      recipient: to,
      subject,
      confirm_summary: "작성 메일 점검 결과 확인, 실제 발송은 아직 잠금",
    },
    defaultHints: {
      recipient: "오입력, 참조/숨은참조, 전체 발송 여부는 사용자가 직접 확인합니다.",
      subject: "제목이 업무 맥락과 맞는지 확인합니다.",
      confirm_summary: "수정 요청이 있으면 승인 대신 고쳐달라고 하기를 선택합니다.",
    },
    confirmPhrase: "최종 실행 확인",
    finalUserPresence: true,
    externalMutationOnConfirm: true,
    adapterConnected: false,
    adapter: {
      status: "missing",
      connected: false,
      requiredConnectorId: "company-mail",
      requiredCategory: "mail",
      requiredMethod: "oauth_or_smtp",
      label: "메일 연결",
      connectLabel: "메일 연결",
      connectHref: "/connect?connector=company-mail",
      connectorId: "company-mail",
      connectorStatus: "not_connected",
      userMessage: "메일 연결과 실제 실행 잠금 해제 전에는 발송하지 않습니다.",
    },
  };
}

export default function OfficePage() {
  const { theme, setTheme } = useThemeMode();
  const [featureRecords, setFeatureRecords] = useState<ModyFeatureActivationRecord[]>([]);
  const [enabledRuleCount, setEnabledRuleCount] = useState(0);
  const [activityEvents, setActivityEvents] = useState<SelectedWorkActionEvent[]>([]);
  const [inboxItems, setInboxItems] = useState<WorkItem[]>([]);
  const [crewMembers, setCrewMembers] = useState<AITeammate[]>([]);
  const [sceneSelectedId, setSceneSelectedId] = useState<string>("");
  const [crewOfficeView, setCrewOfficeView] = useState(false);
  const [officeLocationReady, setOfficeLocationReady] = useState(false);
  const [sceneDrawerTeammate, setSceneDrawerTeammate] = useState<AITeammate | null>(null);
  const [sceneDrawerIsNew, setSceneDrawerIsNew] = useState(false);
  // 씬 상태(일하는 중/결과 준비)의 시간 감쇠를 위해 30초마다 현재 시각을 갱신
  const [sceneNowTick, setSceneNowTick] = useState(() => Date.now());
  const sceneBridgeRef = useRef<DesktopBridgeApi | null>(null);
  // 최근 로컬 편집 시각 — 4초 프로필 폴링이 방금 저장한 팀원 변경을 덮어쓰지 않게 보호
  const sceneCrewEditAtRef = useRef(0);
  // 팀원 저장 결과 표시 ("저장됨" / 실패 안내) — 조용히 실패하지 않게 씬 헤더에 보여준다
  const [scenePersistNotice, setScenePersistNotice] = useState("");
  const scenePersistNoticeTimerRef = useRef<number | null>(null);
  const [activeMessengerChannelIds, setActiveMessengerChannelIds] = useState<string[]>(["app-main-control"]);
  const [connectorStatuses, setConnectorStatuses] = useState<ConnectorStatusRecord[]>([]);
  const [growthSuggestions, setGrowthSuggestions] = useState<LocalMemoryGrowthSuggestion[]>([]);
  const [skillSources, setSkillSources] = useState<LocalMemorySkillSource[]>([]);
  const [identityFiles, setIdentityFiles] = useState<LocalMemoryIdentityFile[]>([]);
  const [crewSoulBundle, setCrewSoulBundle] = useState<LocalMemoryCrewSoulBundle | null>(null);
  const [delegationArtifacts, setDelegationArtifacts] = useState<LocalMemoryDelegationArtifactRecord[]>([]);
  const [officeMockRuntimeReady, setOfficeMockRuntimeReady] = useState(false);
  const [finalConfirmation, setFinalConfirmation] = useState<FinalConfirmationContract | null>(null);
  const finalConfirmationRef = useRef<FinalConfirmationContract | null>(null);
  const [finalActionValues, setFinalActionValues] = useState<Record<string, string>>({});
  const [finalDryRun, setFinalDryRun] = useState<FinalActionDryRunResult | null>(null);
  const [finalDryRunWorkItemId, setFinalDryRunWorkItemId] = useState<string | null>(null);
  const [finalExecution, setFinalExecution] = useState<FinalActionExecutionResult | null>(null);
  const [finalExecutionWorkItemId, setFinalExecutionWorkItemId] = useState<string | null>(null);
  const [mailDispatchBlocks, setMailDispatchBlocks] = useState<Record<string, {label:string; message:string}>>({});
  const mailDispatchBlockFor = (item: WorkItem) => {
    if (mailDispatchBlocks[item.id]) return mailDispatchBlocks[item.id];
    const saved = item.mailDispatchStatus;
    const state = mailDispatchReviewState(saved?.status);
    return saved && state.blockRetry ? {label:state.label,message:saved.message} : null;
  };
  const [finalConfirmationMessage, setFinalConfirmationMessage] = useState("");
  // 실제 외부 실행(메일 발송/일정 등록) 잠금 상태 — 기본 잠김, 사용자가 책임 문구로 해제
  const [finalExecutionSettings, setFinalExecutionSettings] = useState<FinalExecutionSettings>(() => ({
    liveProviderExecutionEnabled: false,
    acknowledgedRisks: [],
    rollbackGuide: "",
  }));
  const [liveUnlockOpen, setLiveUnlockOpen] = useState(false);
  const [liveUnlockPhrase, setLiveUnlockPhrase] = useState("");
  useEffect(() => {
    setFinalExecutionSettings(readFinalExecutionSettings());
  }, []);
  const [browserTaskActionMessage, setBrowserTaskActionMessage] = useState("");
  const [mailOpsDecisionMessage, setMailOpsDecisionMessage] = useState("");
  const [localFileActionMessage, setLocalFileActionMessage] = useState("");
  const [localFilePatternMessage, setLocalFilePatternMessage] = useState("");
  const [folderPlanActionMessage, setFolderPlanActionMessage] = useState("");
  const [mailAutomationNotificationMessage, setMailAutomationNotificationMessage] = useState("");
  const [mailAutomationNotificationDispatchReceipt, setMailAutomationNotificationDispatchReceipt] = useState<{
    status: string;
    targetCount: number;
    targetIds: string[];
    providerMessageId: string;
    executionSummary: string;
  } | null>(null);
  const [folderPlanDefaultOptions, setFolderPlanDefaultOptions] = useState<FolderPlanApprovalOptions>(() =>
    readFolderPlanApprovalOptionsHandoff() ?? defaultFolderPlanApprovalOptions(),
  );
  const [folderPlanOptionsByItemId, setFolderPlanOptionsByItemId] = useState<Record<string, FolderPlanApprovalOptions>>({});
  const folderPlanManifestPathsRef = useRef<Record<string, string>>({});
  // The fixed manifest and progress indicator are shared across cards. Keep
  // preview, apply and revert serial within this page; other windows are not locked.
  const folderPlanActionInFlightRef = useRef(false);
  const [memoryOpenMessage, setMemoryOpenMessage] = useState("");
  const [preparingFinalActionId, setPreparingFinalActionId] = useState<string | null>(null);
  const [recordingMailOpsDecisionId, setRecordingMailOpsDecisionId] = useState<string | null>(null);
  const [runningLocalFileActionId, setRunningLocalFileActionId] = useState<string | null>(null);
  const [runningFolderPlanActionId, setRunningFolderPlanActionId] = useState<string | null>(null);
  const [sendingMailAutomationNotificationId, setSendingMailAutomationNotificationId] = useState<string | null>(null);
  const [applyingMailAutomationNotificationDecisionId, setApplyingMailAutomationNotificationDecisionId] = useState<string | null>(null);
  const [savingLocalFilePatternId, setSavingLocalFilePatternId] = useState<string | null>(null);
  const [runningDryRunActionId, setRunningDryRunActionId] = useState<string | null>(null);
  const [executingFinalActionId, setExecutingFinalActionId] = useState<string | null>(null);
  const [runningBrowserTaskActionId, setRunningBrowserTaskActionId] = useState<string | null>(null);
  const [consumedFocusWorkItemId, setConsumedFocusWorkItemId] = useState("");
  const [channelQueueFocus, setChannelQueueFocus] = useState<ChannelQueueFocus | null>(null);
  const [learnedDraftFocus, setLearnedDraftFocus] = useState<LearnedDraftFocus | null>(() => readOfficeLearnedDraftFocus());
  const [executionLogFocus, setExecutionLogFocus] = useState<OfficeExecutionLogFocus | null>(() => readOfficeExecutionLogFocus());
  const [connectionRecoveryHandoff, setConnectionRecoveryHandoff] = useState<ConnectionRecoveryHandoff | null>(null);
  useEffect(() => {
    finalConfirmationRef.current = finalConfirmation;
  }, [finalConfirmation]);

  const recordHomeApprovalDecisionReceipt = (
    source: HomeApprovalDecisionReceiptSource,
    message: string,
    workItem?: WorkItem | null,
    decision?: "approved" | "change_requested" | "held" | "draft" | "analyze" | "execute" | "review",
  ) => {
    const receipt = createHomeApprovalDecisionReceipt({
      source,
      message,
      workItem,
      decision,
    });
    writeHomeApprovalDecisionReceipt(receipt);
    const bridge = createDesktopBridge();
    if (bridge.isAvailable) {
      void bridge.recordHomeApprovalDecisionReceipt({
        receipt,
        ...(workItem?.teammateId
          ? { teammateId: workItem.teammateId, teammateName: workItem.teammateName }
          : source === "mailops"
            ? { teammateId: "teammate-ops", teammateName: "업무 비서" }
            : {}),
      }).catch(() => undefined);
    }
  };

  const commitMailOpsDecisionMessage = (
    message: string,
    workItem: WorkItem,
    decision: "approved" | "change_requested" | "held" | "review",
  ) => {
    const queueReviewLines = formatMailOpsWorkQueueReviewLines(findMailOpsWorkQueueReviewRecordForWorkItem(workItem));
    const messageWithReview = queueReviewLines.length ? `${message} ${queueReviewLines.join(" ")}` : message;
    setMailOpsDecisionMessage(messageWithReview);
    setLocalFileActionMessage("");
    setFolderPlanActionMessage("");
    const isMailOpsFinalAction =
      workItem.finalAction?.kind === "send_email" ||
      workItem.finalAction?.kind === "send_bulk_email" ||
      workItem.finalAction?.kind === "create_calendar_event";
    const source = homeApprovalDecisionSourceForWorkItem(workItem);
    const receiptSource = source === "repeat_work" ? source : isMailOpsFinalAction || source === "mailops" ? "mailops" : source;
    recordHomeApprovalDecisionReceipt(receiptSource, messageWithReview, workItem, decision);
  };

  const commitLocalFileActionMessage = (
    message: string,
    workItem: WorkItem,
    decision: "held" | "draft" | "analyze" | "review",
  ) => {
    setLocalFileActionMessage(message);
    setFolderPlanActionMessage("");
    recordHomeApprovalDecisionReceipt("local_file", message, workItem, decision);
  };

  const commitLocalFilePatternMessage = (message: string, workItem: WorkItem) => {
    setLocalFilePatternMessage(message);
    setFolderPlanActionMessage("");
    recordHomeApprovalDecisionReceipt("local_file_pattern", message, workItem, "approved");
  };

  const commitFolderPlanActionMessage = (
    message: string,
    workItem: WorkItem,
    decision: "approved" | "held" | "review" = "review",
  ) => {
    setFolderPlanActionMessage(message);
    setLocalFileActionMessage("");
    setLocalFilePatternMessage("");
    recordHomeApprovalDecisionReceipt("folder_plan", message, workItem, decision);
  };

  const commitFinalConfirmationMessage = (
    message: string,
    workItem: WorkItem,
    decision: "execute" | "review" = "review",
  ) => {
    const queueReviewLines = formatMailOpsWorkQueueReviewLines(findMailOpsWorkQueueReviewRecordForWorkItem(workItem));
    const messageWithReview = queueReviewLines.length ? `${message} ${queueReviewLines.join(" ")}` : message;
    setFinalConfirmationMessage(messageWithReview);
    const isMailOpsFinalAction =
      workItem.finalAction?.kind === "send_email" ||
      workItem.finalAction?.kind === "send_bulk_email" ||
      workItem.finalAction?.kind === "create_calendar_event";
    const source = homeApprovalDecisionSourceForWorkItem(workItem);
    recordHomeApprovalDecisionReceipt(isMailOpsFinalAction || source === "mailops" ? "mailops" : "final_confirmation", messageWithReview, workItem, decision);
  };

  const recordOfficeRecoveryVirtualOfficeEvent = async (
    workItem: WorkItem,
    input: {
      action: "prepare_final_confirmation" | "rerun_dry_run";
      status: SelectedWorkActionEvent["status"];
      virtualOfficeStatus: "problem_solving" | "approval_pending" | "completed" | "failed";
      detail: string;
      auditId?: string;
      dryRunAuditId?: string;
      gateStatus?: string;
    },
  ) => {
    const focusMatches = Boolean(
      executionLogFocus &&
        (
          (executionLogFocus.workItemId && executionLogFocus.workItemId === workItem.id) ||
          executionLogFocus.auditId === input.auditId ||
          executionLogFocus.dryRunAuditId === input.dryRunAuditId
        ),
    );
    if (!focusMatches) return;
    const now = new Date().toISOString();
    const actionLabel = input.action === "rerun_dry_run" ? "실행 전 검토 다시" : "마지막 확인 다시 준비";
    const queueReviewRecord = findMailOpsWorkQueueReviewRecordForWorkItem(workItem);
    const queueReviewLines = formatMailOpsWorkQueueReviewLines(queueReviewRecord);
    const event: SelectedWorkActionEvent = {
      id: `office-final-recovery-${input.action}-${workItem.id}`,
      workItemId: workItem.id,
      label: `오피스 복구: ${actionLabel}`,
      detail: input.detail,
      status: input.status,
      createdAt: now,
      updatedAt: now,
      evidence: executionLogFocus?.auditId
        ? `officeExecutionLogFocus:${executionLogFocus.auditId}`
        : `finalActionWorkItem:${workItem.id}`,
      kind: "approval_notification",
      sourceLabel: "오피스 실행 차단 복구",
      metrics: {
        teammateId: defaultAITeammateId,
        finalActionWorkItemId: workItem.id,
        finalExecutionGateAuditId: input.auditId ?? executionLogFocus?.auditId ?? "none",
        finalActionAuditId: input.dryRunAuditId ?? executionLogFocus?.dryRunAuditId ?? "none",
        finalExecutionGateStatus: input.gateStatus ?? executionLogFocus?.executionGateStatus ?? "not_checked",
        finalExecutionProofChain: executionLogFocus?.proofChain || "office_execution_log_recovery",
        recoveryAction: input.action,
        recoveryActionLabel: actionLabel,
        recoveryProofChain: "office_execution_log_reason_action_resume",
        virtualOfficeStatus: input.virtualOfficeStatus,
        mailOpsQueueReviewContext: queueReviewRecord?.approvalContext ?? "",
        mailOpsQueueReviewDecision: queueReviewRecord ? mailOpsWorkQueueDecisionLabel(queueReviewRecord.decision) : "",
        mailOpsQueueReviewNote: queueReviewRecord?.note ?? "",
        mailOpsQueueReviewExternalMutation: queueReviewRecord?.externalMutation ?? false,
        externalMutation: false,
        finalExecutionExternalMutation: false,
      },
      auditTrail: [
        "오피스 실행 차단 로그에서 복구 액션 선택",
        `복구 액션: ${actionLabel}`,
        ...queueReviewLines,
        `상태: ${input.virtualOfficeStatus}`,
        `실행 차단 감사 로그: ${input.auditId ?? executionLogFocus?.auditId ?? "none"}`,
        "외부 발송/등록/공유/파일 변경 없음",
      ],
    };
    try {
      const bridge = createDesktopBridge();
      const result = bridge.isAvailable
        ? await bridge.recordSelectedWorkActionEvent(event)
        : { events: recordSelectedWorkActionEvent(event) };
      setActivityEvents(result.events ?? readSelectedWorkActionEvents());
    } catch {
      setActivityEvents(recordSelectedWorkActionEvent(event));
    }
  };

  const handleRecordMailOpsWorkQueueReviewEvent = useCallback(
    async (records: MailOpsWorkQueueReviewRecord[]) => {
      const safeRecords = records.filter((record) => record.externalMutation === false);
      if (!safeRecords.length) return;
      const teammate = selectMailOpsEventTeammate(crewMembers);
      const teammateId = teammate?.id ?? defaultAITeammateId;
      const event = createMailOpsWorkQueueReviewVirtualOfficeEvent({
        teammateId,
        teammateName: teammate?.name ?? "메일 업무 담당자",
        records: safeRecords,
      });
      const currentEvents = readSelectedWorkActionEvents();
      const current = currentEvents.find((candidate) => candidate.id === event.id);
      if (shouldSkipMailOpsVirtualOfficeEventRecord(current, event)) return;
      const localEvents = recordSelectedWorkActionEvent(event);
      setActivityEvents(localEvents);
      try {
        const bridge = createDesktopBridge();
        if (!bridge.isAvailable) return;
        const result = await bridge.recordSelectedWorkActionEvent(event);
        setActivityEvents(result.events?.length ? result.events : readSelectedWorkActionEvents());
      } catch {
        setActivityEvents(readSelectedWorkActionEvents());
      }
    },
    [crewMembers],
  );

  useEffect(() => {
    const sync = () => { setCrewOfficeView(new URLSearchParams(window.location.search).get("officeSpace") === "crew"); setOfficeLocationReady(true); };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    setFeatureRecords(readFeatureActivationRecords());
    setFolderPlanDefaultOptions(readFolderPlanApprovalOptionsHandoff() ?? defaultFolderPlanApprovalOptions());
    setEnabledRuleCount(readLocalAutomationRules().filter((rule) => rule.enabled).length);
    setCrewMembers(readAITeammates());
    setActiveMessengerChannelIds(readActiveMessengerChannelIds());
    setChannelQueueFocus(readOfficeChannelQueueFocus());
    setExecutionLogFocus(readOfficeExecutionLogFocus());
    setConnectionRecoveryHandoff(readConnectionRecoveryHandoffFromLocation());

    let cancelled = false;
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    setOfficeMockRuntimeReady(mockRuntimeReady);
    // 오피스 창은 닫아도 숨겨질 뿐이라 이 폴링이 앱을 쓰는 내내 돌았다. 예전에는 4초마다
    // 무거운 IPC 6개(기억 원장 전체 재검사 60~75ms 포함)를 겹쳐 부르고, 결과가 같아도 매번
    // 새 배열로 화면을 다시 그렸다. 이제 ①창이 안 보이면 건너뛰고 ②한 번에 하나만 돌고
    // ③무거운 기억·프로필·연결 조회는 20초에 한 번만 하며 ④내용이 같으면 state 를 그대로 둔다.
    let inFlight = false;
    let refreshCount = 0;
    let lastInboxRevision: number | null = null;
    const keepIfSame = <T,>(current: T, next: T): T => (JSON.stringify(current) === JSON.stringify(next) ? current : next);
    const refreshActivity = async (options: { full?: boolean } = {}) => {
      if (inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight = true;
      const fullRefresh = options.full === true || refreshCount % 5 === 0;
      refreshCount += 1;
      try {
        const result = bridge.isAvailable
          ? await bridge.readSelectedWorkActionEvents()
          : { events: readSelectedWorkActionEvents() };
        if (!cancelled) setActivityEvents((current) => keepIfSame(current, result.events ?? []));
        // 인박스 변경 번호가 그대로면(바뀐 카드 없음) 수백 KB 목록을 다시 받아 비교하지 않습니다.
        // 무거운 전체 갱신 주기에는 항상 받아서 화면만의 작성 메일 병합도 다시 맞춥니다.
        // 번호는 목록보다 먼저 읽습니다(그 사이 바뀌면 다음 주기에 다시 받으므로 놓치지 않음).
        const inboxRevision =
          bridge.isAvailable && bridge.fetchInboxRevision
            ? await bridge.fetchInboxRevision().catch(() => null)
            : null;
        const inboxUnchanged =
          !fullRefresh && inboxRevision !== null && lastInboxRevision !== null && inboxRevision.revision === lastInboxRevision;
        const inbox = inboxUnchanged
          ? null
          : bridge.isAvailable
            ? await bridge.fetchInbox()
            : mockRuntimeReady
              ? createOfficeMockFinalActionItems()
              : [];
        if (inbox) lastInboxRevision = inboxRevision?.revision ?? null;
        if (inbox && !cancelled) {
          const mergedInbox = mergeOfficeUserComposedMailInboxItems(inbox ?? []);
          setInboxItems((current) =>
            mockRuntimeReady && !bridge.isAvailable
              ? mergeOfficeMockRuntimeInboxItems(mergedInbox, current)
              : keepIfSame(current, mergedInbox),
          );
        }
        if (inbox && !cancelled && mockRuntimeReady && !bridge.isAvailable && !finalConfirmationRef.current) {
          const mockItem = inbox[0];
          if (!mockItem) return;
          const mockConfirmation = createOfficeMockFinalConfirmation(mockItem);
          setFinalConfirmation(mockConfirmation);
          setFinalActionValues(mockConfirmation.defaultValues ?? {});
          setFinalDryRun(createOfficeMockFinalDryRun(mockItem));
          setFinalDryRunWorkItemId(mockItem.id);
          setFinalExecution(null);
          setFinalExecutionWorkItemId(null);
          setFinalConfirmationMessage("미리보기 모드 최종 실행 후보: 실제 외부 발송 없이 승인 전 확인 UI를 검증합니다.");
        }
        if (bridge.isAvailable && fullRefresh) {
          const memory = await bridge.inspectPortableMemory();
          if (!cancelled) setGrowthSuggestions(memory.growthSuggestions ?? []);
          if (!cancelled) setSkillSources(memory.skillSources ?? []);
          if (!cancelled) setIdentityFiles(memory.identityFiles ?? []);
          if (!cancelled) setDelegationArtifacts(memory.delegationArtifacts ?? []);
          const profileResult = await bridge.loadAppProfile();
          if (!cancelled) setCrewSoulBundle(profileResult.crewSoulBundle ?? null);
          if (!cancelled && profileResult.profile?.teammates) {
            // 방금(10초 내) 오피스에서 저장한 변경은 그대로 두고,
            // 그 외에는 updatedAt이 더 새로운 쪽을 남기는 병합 — 프로필이 구버전이어도
            // 사용자가 방금 바꾼 외형/성향/이름을 절대 되돌리지 않는다.
            if (Date.now() - sceneCrewEditAtRef.current > 10_000) {
              const incoming = normalizeAITeammates(profileResult.profile.teammates);
              setCrewMembers((current) => mergeCrewMembersByUpdatedAt(current, incoming));
            }
          }
          const statusResult = await bridge.listConnectorStatuses();
          if (!cancelled) setConnectorStatuses((current) => keepIfSame(current, statusResult.connectors ?? []));
          const artifactList = await bridge.listDelegationArtifacts();
          if (!cancelled) setDelegationArtifacts(artifactList.artifacts ?? memory.delegationArtifacts ?? []);
        } else if (!bridge.isAvailable && mockRuntimeReady) {
          if (!cancelled) setConnectorStatuses(createOfficeMockConnectorStatuses());
        }
      } catch {
        if (!cancelled) setActivityEvents(readSelectedWorkActionEvents());
        if (!cancelled) setInboxItems(mergeOfficeUserComposedMailInboxItems());
        if (!cancelled) setGrowthSuggestions([]);
        if (!cancelled) setIdentityFiles([]);
        if (!cancelled) setCrewSoulBundle(null);
        if (!cancelled) setDelegationArtifacts([]);
        if (!cancelled) setConnectorStatuses(mockRuntimeReady ? createOfficeMockConnectorStatuses() : []);
      } finally {
        inFlight = false;
      }
    };
    void refreshActivity({ full: true });
    const timer = window.setInterval(() => void refreshActivity(), 4000);
    // 다시 보이면 기다리지 않고 바로 최신으로 맞춘다.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshActivity({ full: true });
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => setSceneNowTick(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  // A newly received event must be evaluated against the current time, not the previous periodic tick.
  useEffect(() => setSceneNowTick(Date.now()), [activityEvents]);

  useEffect(() => {
    if (typeof window === "undefined" || !inboxItems.length || preparingFinalActionId) return;
    const focusWorkItemId = readOfficeFinalActionFocus();
    if (!focusWorkItemId || focusWorkItemId === consumedFocusWorkItemId) return;
    const target = inboxItems.find((item) => item.id === focusWorkItemId && item.finalAction);
    if (!target) return;
    setConsumedFocusWorkItemId(focusWorkItemId);
    window.localStorage.removeItem(officeFinalActionFocusStorageKey);
    void handlePrepareFinalConfirmation(target);
  }, [consumedFocusWorkItemId, inboxItems, preparingFinalActionId]);

  const activeFeatureCount = useMemo(() => countActiveFeatures(featureRecords), [featureRecords]);
  const activityDesks = useMemo(
    () => buildDesksFromActivity(activityEvents, inboxItems, delegationArtifacts),
    [activityEvents, inboxItems, delegationArtifacts],
  );
  const visibleDeskIds = useMemo(() => {
    const ids = new Set<Desk["id"]>(["inbox"]);
    if (isFeatureActive(featureRecords, "connector_recommendations")) ids.add("calendar");
    if (isFeatureActive(featureRecords, "document_learning")) ids.add("document");
    if (
      isFeatureActive(featureRecords, "approval_execution") ||
      inboxItems.some((item) => item.status === "approval_pending" || item.channelDecision) ||
      delegationArtifacts.some((artifact) => artifact.artifactKind === "approval")
    ) {
      ids.add("approval");
      ids.add("guard");
    }
    if (delegationArtifacts.some((artifact) => artifact.artifactKind === "report" || artifact.artifactKind === "mail")) {
      ids.add("document");
    }
    if (delegationArtifacts.some((artifact) => artifact.nextActionKind === "revision_request")) {
      ids.add("ops");
    }
    if (delegationArtifacts.some((artifact) => artifact.nextActionKind === "execution_candidate")) {
      ids.add("approval");
      ids.add("guard");
    }
    if (inboxItems.some((item) => item.source === "local_file" || item.sourceEvidence?.providerId === "document_learning")) ids.add("document");
    if (isFeatureActive(featureRecords, "automation_monitoring")) ids.add("ops");
    return ids;
  }, [delegationArtifacts, featureRecords, inboxItems]);
  const visibleDesks = useMemo(
    () =>
      liveDesks
        .map((desk) => activityDesks.get(desk.id) ?? desk)
        .filter(
          (desk) =>
            visibleDeskIds.has(desk.id) ||
            desk.busy > 0 ||
            desk.done > 0 ||
            desk.failed > 0 ||
            desk.cards.length > 0,
      ),
    [activityDesks, visibleDeskIds],
  );
  const hiddenDeskCount = Math.max(0, liveDesks.length - visibleDesks.length);
  const officeProgress = Math.min(
    100,
    Math.round(((activeFeatureCount + (enabledRuleCount > 0 ? 1 : 0)) / (featureCatalog.length + 1)) * 100),
  );
  const nextFeature = featureCatalog.find((feature) => !isFeatureActive(featureRecords, feature.id));
  const auditEvents = useMemo(
    () => [...delegationArtifactsToAudit(delegationArtifacts), ...activityEventsToAudit(activityEvents)].slice(0, 30),
    [activityEvents, delegationArtifacts],
  );
  const showAudit =
    enabledRuleCount > 0 ||
    isFeatureActive(featureRecords, "approval_execution") ||
    auditEvents.length > 0 ||
    delegationArtifacts.length > 0;
  const messengerConnectionSummaries = useMemo(
    () => summarizeMessengerConnections(defaultMessengerChannels, connectorStatuses, activeMessengerChannelIds),
    [activeMessengerChannelIds, connectorStatuses],
  );
  const officeBoardMessengerConnections = useMemo(() => {
    if (!officeMockRuntimeReady) return messengerConnectionSummaries;
    if (
      messengerConnectionSummaries.some(
        (connection) => connection.connectorId === "telegram-bot" && connection.state === "connected",
      )
    ) {
      return messengerConnectionSummaries;
    }
    return [
      ...messengerConnectionSummaries,
      {
        id: "telegram-bot",
        connectorId: "telegram-bot",
        label: "Telegram Bot",
        state: "connected" as const,
        statusLabel: "연결됨",
        detail: "미리보기 승인 알림 채널입니다. 사용자가 알림 보내기를 누를 때만 승인 후보 요약을 보냅니다.",
        targetLabel: "Telegram -> 메신저 결정 인박스 -> 담당 AI 팀원",
      },
    ];
  }, [messengerConnectionSummaries, officeMockRuntimeReady]);
  const activeChannelLabels = useMemo(
    () => {
      const internalLabels = crewMembers.length
        ? crewMembers.map((member) => member.channelName).slice(0, 5)
        : ["앱 메인 컨트롤"];
      const externalLabels = messengerConnectionSummaries
        .filter(
          (summary) =>
            summary.state === "connected" ||
            summary.state === "built_in" ||
            activeMessengerChannelIds.includes(summary.id),
        )
        .map((summary) => summary.label);
      return Array.from(new Set([...internalLabels, ...externalLabels])).slice(0, 8);
    },
    [activeMessengerChannelIds, crewMembers, messengerConnectionSummaries],
  );
  const crewSoulBundleChannelMap = useMemo(() => {
    const entries = crewSoulBundle?.teammateChannels ?? [];
    return new Map(entries.map((channel) => [channel.id, channel]));
  }, [crewSoulBundle]);
  // Collapse updates for the same owned work item before deciding whether a crew is active.
  // A timer only changes the display projection; it never edits the underlying event record.
  const currentActivityEvents = useMemo(
    () => latestOwnedWorkEvents(activityEvents, Math.max(sceneNowTick, Date.now())),
    [activityEvents, sceneNowTick],
  );
  const crewForBoard = useMemo(
    () =>
      crewMembers.map((member, index) => {
        const memberEvents = currentActivityEvents.filter((event) => event.metrics?.teammateId === member.id);
        const latestEvent = memberEvents[0];
        const memberIdentityFiles = identityFiles.filter((file) => file.teammateId === member.id);
        const assignedGrowthCount = growthSuggestions.filter((suggestion) =>
          suggestion.assignedTeammateIds?.includes(member.id),
        ).length;
        const roleMemory = crewSoulBundleChannelMap.get(member.id);
        return {
          id: member.id,
          name: member.name,
          avatarId: member.avatarId,
          templateId: member.templateId,
          channelName: member.channelName,
          teamLabel: member.teamLabel,
          roleTitle: member.roleTitle,
          brief: member.brief,
          personalityPreview: formatTeammatePersonalityPreview(member.instructions),
          crewSoulPath: `memory/crew-souls/${member.id}/CrewSoul.md`,
          workLogPath: `memory/crew-souls/${member.id}/WorkLog.md`,
          decisionLogPath: `memory/crew-souls/${member.id}/DecisionLog.md`,
          promptMemoryPath: `memory/crew-souls/${member.id}/PromptMemory.md`,
          latestDetail: latestEvent?.detail || member.brief,
          latestLearnedSummary:
            roleMemory?.recentWork?.[0]?.summary ||
            roleMemory?.recentDecisions?.[0]?.summary ||
            "",
          active: index === 0 || memberEvents.length > 0,
          running: memberEvents.some((event) => event.status === "running"),
          workCount: memberEvents.length,
          learnedWorkCount: roleMemory?.recentWork?.length ?? 0,
          recentDecisionCount: roleMemory?.recentDecisions?.length ?? 0,
          skillCount: member.skillIds.length,
          identityReadyCount: memberIdentityFiles.filter((file) => file.state === "ready").length,
          identityFileCount: memberIdentityFiles.length,
          assignedGrowthCount,
        };
      }),
    [currentActivityEvents, crewMembers, crewSoulBundleChannelMap, growthSuggestions, identityFiles],
  );
  const automaticCrewTeamIds = useMemo(
    () => selectAutomaticCrewTeams(growthSuggestions),
    [growthSuggestions],
  );
  const crewMaster =
    crewMembers.find((member) => member.id === defaultAITeammateId) ??
    crewMembers.find((member) => member.templateId === "personal") ??
    crewMembers[0] ??
    null;
  const automaticCrewHierarchy = useMemo(
    () =>
      automaticCrewTeamIds.map((templateId) => {
        const template =
          aiTeammateTemplates.find((item) => item.id === templateId) ??
          aiTeammateTemplates[0];
        const teammate =
          crewMembers.find((member) => member.templateId === templateId) ??
          null;
        const growth = growthSuggestions.find((suggestion) => {
          if (teammate && suggestion.assignedTeammateIds?.includes(teammate.id)) {
            return true;
          }
          const signal = [
            suggestion.title,
            suggestion.reason,
            suggestion.nextAction,
            suggestion.skillLabel,
          ]
            .join(" ")
            .toLocaleLowerCase("ko-KR");
          return signal.includes(template.teamLabel.toLocaleLowerCase("ko-KR"));
        });
        return {
          templateId,
          name: teammate?.name ?? template.defaultName,
          teamLabel: teammate?.teamLabel ?? template.teamLabel,
          roleTitle: teammate?.roleTitle ?? template.roleTitle,
          ready: Boolean(teammate),
          command: crewCommandLabel(templateId),
          growthLabel:
            growth?.title ??
            (teammate
              ? "업무 방식·작업 기록을 쌓는 중"
              : "생성 뒤 폴더·메일 근거를 연결"),
        };
      }),
    [automaticCrewTeamIds, crewMembers, growthSuggestions],
  );
  const automaticCrewMissingCount = automaticCrewHierarchy.filter(
    (member) => !member.ready,
  ).length;
  const crewActivityById = useMemo(() => {
    const map = new Map<string, (typeof crewForBoard)[number]>();
    for (const entry of crewForBoard) map.set(entry.id, entry);
    return map;
  }, [crewForBoard]);
  const sceneHireSlots = useMemo<OfficeSceneHireSlot[]>(() => {
    const presentTemplateIds = new Set(crewMembers.map((member) => member.templateId));
    const roleSlots = aiTeammateTemplates
      .filter((template) => template.id !== "personal" && template.id !== "custom")
      .filter((template) => !presentTemplateIds.has(template.id))
      .map((template) => ({
        templateId: template.id,
        teamLabel: template.teamLabel,
        roleTitle: template.roleTitle,
        brief: template.brief,
      }));
    const customTemplate = aiTeammateTemplates.find((template) => template.id === "custom");
    if (customTemplate) {
      roleSlots.push({
        templateId: customTemplate.id,
        teamLabel: customTemplate.teamLabel,
        roleTitle: "직접 만드는 팀원",
        brief: customTemplate.brief,
      });
    }
    return roleSlots;
  }, [crewMembers]);
  const handleSceneSelect = useCallback(
    (teammateId: string) => {
      const member = crewMembers.find((item) => item.id === teammateId);
      if (!member) return;
      setSceneSelectedId(teammateId);
      setMemoryOpenMessage("");
      setSceneDrawerIsNew(false);
      setSceneDrawerTeammate(member);
    },
    [crewMembers],
  );
  const handleSceneHire = useCallback((templateId: AITeammateTeam) => {
    const draft = createAITeammateFromTemplate(templateId);
    setSceneSelectedId("");
    setSceneDrawerIsNew(true);
    setSceneDrawerTeammate(draft);
  }, []);
  const handleScenePickTemplate = useCallback((templateId: AITeammateTeam) => {
    setSceneDrawerTeammate(createAITeammateFromTemplate(templateId));
  }, []);
  const handleSceneCloseDrawer = useCallback(() => {
    setSceneDrawerTeammate(null);
    setSceneDrawerIsNew(false);
  }, []);
  // 팀원 변경을 localStorage와 데스크톱 프로필(있을 때) 양쪽에 저장 —
  // 오피스의 4초 프로필 폴링이 로컬 저장만 된 변경을 되돌리지 않게 하는 핵심.
  const showScenePersistNotice = useCallback((message: string, autoClearMs?: number) => {
    if (scenePersistNoticeTimerRef.current) window.clearTimeout(scenePersistNoticeTimerRef.current);
    setScenePersistNotice(message);
    if (autoClearMs) {
      scenePersistNoticeTimerRef.current = window.setTimeout(() => setScenePersistNotice(""), autoClearMs);
    }
  }, []);
  const persistCrewMembers = useCallback(
    (next: AITeammate[]) => {
      sceneCrewEditAtRef.current = Date.now();
      saveAITeammates(next);
      const bridge = sceneBridgeRef.current ?? (sceneBridgeRef.current = createDesktopBridge());
      if (!bridge.isAvailable) {
        showScenePersistNotice("저장됨", 2500);
        return;
      }
      void (async () => {
        try {
          const current = await bridge.loadAppProfile();
          const profile = current.profile ?? {};
          await bridge.saveAppProfile({
            ...profile,
            version: profile.version ?? 1,
            updatedAt: new Date().toISOString(),
            teammates: next,
          });
          showScenePersistNotice("크루 설정 저장됨", 2500);
        } catch {
          // localStorage에는 저장됨 — 폴더 저장만 실패한 상태를 사용자에게 알린다
          showScenePersistNotice("이 기기에는 저장됨 · 폴더 저장은 다음 저장 때 다시 시도");
        }
      })();
    },
    [showScenePersistNotice],
  );
  const handleAutomaticCrewAssembly = useCallback(() => {
    const existingTemplates = new Set(
      crewMembers.map((member) => member.templateId),
    );
    const created = automaticCrewTeamIds
      .filter((templateId) => !existingTemplates.has(templateId))
      .map((templateId) => ({
        ...createAITeammateFromTemplate(templateId),
        updatedAt: Date.now(),
      }));
    if (!created.length) {
      showScenePersistNotice("현재 학습 근거에 맞는 AI 팀이 이미 준비되어 있습니다.", 3000);
      return;
    }
    const next = normalizeAITeammates([...crewMembers, ...created]);
    setCrewMembers(next);
    persistCrewMembers(next);
    setSceneSelectedId(created[0]?.id ?? "");
    showScenePersistNotice(
      "AI 팀 " + created.length + "명을 자동 구성했습니다. 모든 외부 실행은 계속 승인 대기입니다.",
      4200,
    );
  }, [
    automaticCrewTeamIds,
    crewMembers,
    persistCrewMembers,
    showScenePersistNotice,
  ]);

  const handleSceneSaveTeammate = useCallback(
    (updated: AITeammate) => {
      setCrewMembers((current) => {
        const exists = current.some((item) => item.id === updated.id);
        const next = exists
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : [...current, updated];
        persistCrewMembers(next);
        return next;
      });
      setSceneSelectedId(updated.id);
      setSceneDrawerTeammate(null);
      setSceneDrawerIsNew(false);
    },
    [persistCrewMembers],
  );
  const handleSceneRemoveTeammate = useCallback(
    (teammateId: string) => {
      if (teammateId === defaultAITeammateId) return;
      setCrewMembers((current) => {
        const next = current.filter((item) => item.id !== teammateId);
        persistCrewMembers(next);
        return next;
      });
      setSceneSelectedId("");
      setSceneDrawerTeammate(null);
      setSceneDrawerIsNew(false);
    },
    [persistCrewMembers],
  );
  const handleSceneDelegate = useCallback(
    (teammate: AITeammate) => {
      setSceneDrawerTeammate(null);
      navigateInternalPath(teammate.id === defaultAITeammateId ? "/" : `/?teammate=${encodeURIComponent(teammate.id)}`);
    },
    [],
  );
  const channelWorkSummaries = useMemo(
    () =>
      crewMembers.map((member) => {
        const memberEvents = currentActivityEvents.filter((event) => event.metrics?.teammateId === member.id);
        const memberArtifacts = delegationArtifacts.filter((artifact) => delegationArtifactBelongsToMember(artifact, member));
        const assignedGrowthCount = growthSuggestions.filter((suggestion) =>
          suggestion.assignedTeammateIds?.includes(member.id),
        ).length;
        const runningCount = memberEvents.filter((event) => event.status === "running").length;
        const approvalCount =
          memberEvents.filter((event) => event.status === "needs_desktop").length +
          memberArtifacts.filter((artifact) => delegationArtifactNeedsApproval(artifact)).length;
        const resultCount =
          memberEvents.filter((event) => event.status === "done").length +
          memberArtifacts.filter((artifact) => !delegationArtifactNeedsApproval(artifact)).length;
        const latestEvent = memberEvents[0];
        const latestArtifact = memberArtifacts[0];
        const roleMemory = crewSoulBundleChannelMap.get(member.id);
        const latestLabel = latestEvent?.label || latestArtifact?.title || member.brief;
        const latestQueueLabel = latestArtifact ? delegationArtifactQueueLabel(latestArtifact) : "";
        const latestDetail =
          latestEvent?.detail ||
          latestQueueLabel ||
          latestArtifact?.nextActionLabel ||
          latestArtifact?.relativePath ||
          "아직 새 작업 기록은 없습니다.";

        return {
          id: member.id,
          name: member.name,
          channelName: member.channelName,
          teamLabel: member.teamLabel,
          roleTitle: member.roleTitle,
          brief: member.brief,
          personalityPreview: formatTeammatePersonalityPreview(member.instructions),
          statusLabel:
            runningCount > 0
              ? "작업 중"
              : approvalCount > 0
                ? "승인 대기"
                : resultCount > 0
                  ? "결과 정리"
                  : "대기",
          runningCount,
          approvalCount,
          resultCount,
          growthCount: assignedGrowthCount,
          latestLabel,
          latestDetail,
          latestSource: latestEvent?.sourceLabel || (latestArtifact ? delegationArtifactOutputKindLabel(latestArtifact) : "팀원 업무 방식"),
          learnedWorkCount: roleMemory?.recentWork?.length ?? 0,
          recentDecisionCount: roleMemory?.recentDecisions?.length ?? 0,
          latestLearnedLabel:
            roleMemory?.recentWork?.[0]?.label ||
            roleMemory?.recentDecisions?.[0]?.decision ||
            "",
          latestLearnedSummary:
            roleMemory?.recentWork?.[0]?.summary ||
            roleMemory?.recentDecisions?.[0]?.summary ||
            "",
          crewSoulPath: `memory/crew-souls/${member.id}/CrewSoul.md`,
          workLogPath: `memory/crew-souls/${member.id}/WorkLog.md`,
          decisionLogPath: `memory/crew-souls/${member.id}/DecisionLog.md`,
        };
      }),
    [currentActivityEvents, crewMembers, crewSoulBundleChannelMap, delegationArtifacts, growthSuggestions],
  );
  const channelQueueItems = useMemo(
    () =>
      buildChannelQueueItems({
        crewMembers,
        activityEvents: currentActivityEvents,
        delegationArtifacts,
        growthSuggestions,
        inboxItems,
      }),
    [currentActivityEvents, crewMembers, delegationArtifacts, growthSuggestions, inboxItems],
  );
  // 씬 상태 판별 — "지금" 일하는지가 기준. 오래된 기록으로 영구히 결과 준비/작업 중이 되지 않게
  // 시간 감쇠를 둔다: running 30분·result 15분 이내만 유효, approval은 사용자 결정 전까지 유지.
  const deriveSceneStatus = useCallback(
    (teammateId: string): TeammateSceneStatus => {
      const queueItems = channelQueueItems.filter((item) => item.teammateId === teammateId);
      const within = (iso: string | undefined, minutes: number) => {
        const time = Date.parse(iso ?? "");
        const age = Math.max(sceneNowTick, Date.now()) - time;
        return Number.isFinite(age) && age >= 0 && age < minutes * 60_000;
      };
      if (queueItems.some((item) => item.kind === "running" && within(item.updatedAt, 2))) return "working";
      if (queueItems.some((item) => item.kind === "approval")) return "approval";
      const latest = [...queueItems].filter((item) => item.kind !== "growth").sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
      if (!latest) return "idle";
      if (latest.kind === "error") return "failed";
      if (latest.kind === "unknown" || latest.kind === "running") return "unknown";
      if (latest.kind === "result" && within(latest.updatedAt, 15)) return "done";
      return "idle";
    },
    [channelQueueItems, sceneNowTick],
  );
  const sceneMembers = useMemo<OfficeSceneMember[]>(
    () =>
      crewMembers.map((member) => {
        const entry = crewActivityById.get(member.id);
        const queueItems = channelQueueItems.filter((item) => item.teammateId === member.id);
        const status = deriveSceneStatus(member.id);
        const statusKinds: Record<TeammateSceneStatus, string[]> = {
          working: ["running"], approval: ["approval"], failed: ["error"],
          unknown: ["unknown", "running"], done: ["result"], idle: [], offline: [],
        };
        const topItem = queueItems.filter((item) => statusKinds[status].includes(item.kind)).sort(
          (left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""),
        )[0];
        const lastActivityAt = queueItems.reduce<number | undefined>((acc, item) => {
          const time = Date.parse(item.updatedAt ?? "");
          if (!Number.isFinite(time)) return acc;
          return acc === undefined || time > acc ? time : acc;
        }, undefined);
        return {
          teammate: member,
          status,
          workMotion: status === "working" ? officeWorkMotionForEvent(topItem?.workEvent, member.id, sceneNowTick) : undefined,
          workMotionUntil: officeWorkMotionExpiry(topItem?.workEvent),
          currentTask:
            status === "idle" ? member.brief : topItem?.detail || topItem?.label || entry?.latestDetail || member.brief,
          statusLine: status === "idle" ? "" : topItem?.label || "",
          lastActivityAt,
          workCount: entry?.workCount ?? 0,
          // crewForBoard 가 이미 세어 둔 값들이다. 여기까지 안 넘겨서 화면에 못 나오고
          // 있었다 — 없는 데이터를 새로 만드는 게 아니라 버려지던 것을 잇는다.
          stats: {
            work: entry?.workCount ?? 0,
            skill: entry?.skillCount ?? 0,
            learned: entry?.learnedWorkCount ?? 0,
          },
          isMain: member.id === defaultAITeammateId,
        };
      }),
    [channelQueueItems, crewActivityById, crewMembers, deriveSceneStatus, sceneNowTick],
  );
  const sceneDrawerMember = useMemo(
    () => sceneMembers.find((member) => member.teammate.id === sceneDrawerTeammate?.id) ?? null,
    [sceneDrawerTeammate?.id, sceneMembers],
  );
  const channelDecisionsForBoard = useMemo(
    () =>
      inboxItems
        .filter((item) => item.channelDecision)
        .map((item) => {
          const queueOwner =
            channelQueueItems.find((queueItem) => queueItem.workItemId === item.id) ??
            channelQueueItems.find((queueItem) => queueItem.label === item.title);
          const teammate = queueOwner
            ? crewMembers.find((member) => member.id === queueOwner.teammateId)
            : selectTeammateForInboxItem(item, crewMembers, crewMembers[0]);
          const teammateId = queueOwner?.teammateId ?? teammate?.id;
          return {
            id: `${item.id}:${item.channelDecision?.decidedAt ?? "decision"}`,
            workItemId: item.id,
            title: item.title || "메신저 결정 업무",
            decision: item.channelDecision?.decision ?? "",
            decisionLabel: item.channelDecision?.decisionLabel,
            channel: item.channelDecision?.channel ?? "메신저",
            decidedBy: item.channelDecision?.decidedBy ?? "채널 사용자",
            teammateName: queueOwner?.teammateName ?? teammate?.name ?? "업무 비서",
            channelName: queueOwner?.channelName ?? teammate?.channelName ?? "업무 알림 비서",
            teamLabel: queueOwner?.teamLabel ?? teammate?.teamLabel ?? "MailOps",
            messagePreview: item.channelDecision?.messagePreview,
            targetCode: item.channelDecision?.targetCode,
            approvalInboxRouteLabel: item.channelDecision?.approvalInboxRouteLabel,
            appReconfirmLabel: item.channelDecision?.appReconfirmLabel,
            workerEventLabel: item.channelDecision?.workerEventLabel,
            finalExecutionBoundary: item.channelDecision?.finalExecutionBoundary,
            mobileReceiveFilterSummary: item.channelDecision?.mobileReceiveFilterSummary,
            mobileReceiveFilterContract: item.channelDecision?.mobileReceiveFilterContract,
            requiresAppReconfirm: Boolean(item.channelDecision?.requiresAppReconfirm),
            revisionInstruction: item.channelDecision?.revisionInstruction,
            decisionLogPath: teammateId
              ? `memory/crew-souls/${teammateId}/DecisionLog.md`
              : "memory/decisions/DecisionMemory.md",
            workLogPath: teammateId ? `memory/crew-souls/${teammateId}/WorkLog.md` : undefined,
            queueState: queueOwner?.kind ?? (item.channelDecision?.requiresAppReconfirm ? "approval" : "result"),
          };
        }),
    [channelQueueItems, crewMembers, inboxItems],
  );
  // 실제 실행 후보와 운영 점검을 각각 모아, 반복 안내가 메일 초안을 밀어내지 않게 합니다.
  // 채팅·업무판의 [승인함에서 보기]로 온 카드는 오래된 메일이어도 목록에 꼭 넣는다(맨 위 정렬은 보드가 한다).
  const finalActionCandidates = useMemo(() => {
    const withFinalAction = inboxItems.filter((item) => item.finalAction);
    const visible = [
      ...selectApprovalCardsForDisplay(withFinalAction.filter(item => item.finalAction?.kind !== 'scenario_review')),
      ...selectApprovalCardsForDisplay(withFinalAction.filter(item => item.finalAction?.kind === 'scenario_review')),
    ];
    const focusedId = readOfficeFocusedFinalActionCardId();
    const focused = focusedId && !visible.some((item) => item.id === focusedId)
      ? withFinalAction.find((item) => item.id === focusedId)
      : undefined;
    return focused ? [focused, ...visible] : visible;
  }, [inboxItems]);
  const [changingCardAssigneeId, setChangingCardAssigneeId] = useState<string | null>(null);
  const [cardAssigneeNotice, setCardAssigneeNotice] = useState<{ workItemId: string; message: string } | null>(null);
  const cardAssigneeTeammates = useMemo(
    () => crewMembers.map((member) => ({ id: member.id, name: member.name, roleTitle: member.roleTitle })),
    [crewMembers],
  );
  // 카드의 담당 AI 직원만 바꾼다(표시용). 발송·일정·초안은 그대로다.
  // 저장이 된 뒤에만 화면을 바꾼다 — 저장 못 하면 원래 담당을 그대로 두고 까닭을 카드에 적는다.
  const handleChangeCardAssignee = async (workItem: WorkItem, teammateId: string) => {
    const option = buildMailCardAssigneeOptions(cardAssigneeTeammates, workItem).find((item) => item.id === teammateId);
    if (!option || option.id === workItem.assigneeTeammateId) return;
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable || !bridge.setCardAssignee) {
      setCardAssigneeNotice({ workItemId: workItem.id, message: "담당은 설치된 데스크톱 앱에서 바꿀 수 있어요." });
      return;
    }
    setCardAssigneeNotice(null);
    setChangingCardAssigneeId(workItem.id);
    try {
      const result = await bridge.setCardAssignee(workItem.id, {
        teammateId: option.id,
        name: option.name,
        ...(option.roleTitle ? { roleTitle: option.roleTitle } : {}),
      });
      if (result?.status === "card_assignee_updated") {
        setInboxItems((current) => applyMailCardAssigneeLocally(current, workItem.id, option));
      } else {
        setCardAssigneeNotice({
          workItemId: workItem.id,
          message: result?.userMessage || "담당을 바꾸지 못했어요. 잠시 뒤 다시 골라 주세요.",
        });
        const inbox = await bridge.fetchInbox().catch(() => null);
        if (inbox) setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox));
      }
    } catch {
      setCardAssigneeNotice({ workItemId: workItem.id, message: "담당을 바꾸지 못했어요. 잠시 뒤 다시 골라 주세요." });
      const inbox = await bridge.fetchInbox().catch(() => null);
      if (inbox) setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox));
    } finally {
      setChangingCardAssigneeId(null);
    }
  };
  useEffect(() => {
    if (typeof window === "undefined" || !executionLogFocus || !finalActionCandidates.length) return;
    const selector = executionLogFocus.workItemId
      ? `[data-final-action-work-item-id="${escapeCssAttributeValue(executionLogFocus.workItemId)}"]`
      : `[data-office-execution-log-focus-audit-id="${escapeCssAttributeValue(executionLogFocus.auditId)}"]`;
    const timer = window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(selector);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.focus({ preventScroll: true });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [executionLogFocus, finalActionCandidates]);
  const externalApprovalCandidates = useMemo(
    () =>
      inboxItems
        .filter((item) => item.browserTask && !item.finalAction)
        .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
        .slice(0, 6),
    [inboxItems],
  );
  const learnedDraftApprovalItems = useMemo(
    () =>
      inboxItems
        .filter((item) => {
          const isDocumentLearningDraft = item.sourceEvidence?.providerId === "document_learning";
          const isLocalFileWorkItem = item.source === "local_file" && Boolean(item.localFile);
          const isMailAutomationNotification =
            Boolean(item.sourceEvidence?.mailAutomationNotificationDraft) ||
            item.sourceEvidence?.providerId === "mail_automation_runner" ||
            item.sourceEvidence?.connectorId === "mail-automation-notification";
          if (!isDocumentLearningDraft && !isLocalFileWorkItem && !isMailAutomationNotification) return false;
          if (item.status !== "approval_pending") return false;
          if (item.finalAction || item.browserTask) return false;
          return Boolean(item.draft?.body || item.sourceEvidence?.draftPreview || item.localFile?.preview);
        })
        .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
        .slice(0, 6),
    [inboxItems],
  );
  // 승인함 '처리됨' 탭 표시용: 위와 같은 학습 초안 중 이미 보류·수정 요청·거절한 것. 화면에 보여 주기만 한다.
  const processedLearnedDraftItems = useMemo(
    () =>
      inboxItems
        .filter((item) => {
          const isDocumentLearningDraft = item.sourceEvidence?.providerId === "document_learning";
          const isLocalFileWorkItem = item.source === "local_file" && Boolean(item.localFile);
          const isMailAutomationNotification =
            Boolean(item.sourceEvidence?.mailAutomationNotificationDraft) ||
            item.sourceEvidence?.providerId === "mail_automation_runner" ||
            item.sourceEvidence?.connectorId === "mail-automation-notification";
          if (!isDocumentLearningDraft && !isLocalFileWorkItem && !isMailAutomationNotification) return false;
          if (item.status !== "held" && item.status !== "change_requested" && item.status !== "rejected") return false;
          if (item.finalAction || item.browserTask) return false;
          return Boolean(item.draft?.body || item.sourceEvidence?.draftPreview || item.localFile?.preview);
        })
        .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
        .slice(0, 6),
    [inboxItems],
  );
  useEffect(() => {
    if (typeof window === "undefined" || !learnedDraftFocus || !learnedDraftApprovalItems.length) return;
    const target = learnedDraftApprovalItems.find((item) => item.id === learnedDraftFocus.workItemId);
    if (!target) return;
    window.localStorage.removeItem(officeLearnedDraftFocusStorageKey);
    const timer = window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-learned-draft-id="${escapeCssAttributeValue(learnedDraftFocus.workItemId)}"]`,
      );
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.focus({ preventScroll: true });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [learnedDraftApprovalItems, learnedDraftFocus]);
  const approvedOutputItems = useMemo(
    () =>
      inboxItems
        .filter((item) => Boolean(item.approvedOutput))
        .sort((a, b) => Date.parse(b.approvedOutput?.createdAt ?? b.receivedAt) - Date.parse(a.approvedOutput?.createdAt ?? a.receivedAt))
        .slice(0, 6),
    [inboxItems],
  );

  const handleUnlockNext = () => {
    if (!nextFeature) return;
    setFeatureRecords(activateFeature(nextFeature.id, "AI 오피스에서 기능 추가"));
  };

  const navigateFromCrewOffice = (target: "chat" | "board") => {
    const current = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    if (current.get("preview") === "workbench") {
      params.set("preview", "workbench");
      if (current.get("mockRuntime") === "1") params.set("mockRuntime", "1");
    }
    const query = params.toString();
    navigateInternalPath(`${target === "chat" ? "/" : "/office"}${query ? `?${query}` : ""}`);
  };

  const handleCloseOffice = () => {
    if (typeof window === "undefined") return;
    if (crewOfficeView) { navigateFromCrewOffice("chat"); return; }
    const isDetachedOffice = new URLSearchParams(window.location.search).get("from") === "chat-window";
    if (!isDetachedOffice) {
      navigateInternalPath("/?panel=office");
      return;
    }
    window.opener?.focus?.();
    window.close();
    window.setTimeout(() => {
      if (window.closed) return;
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      navigateInternalPath("/?panel=office", "replace");
    }, 120);
  };

  const handleFocusTodayBoard = () => {
    if (typeof document === "undefined") return;
    const board = document.querySelector<HTMLElement>("[data-office-board='today']");
    board?.scrollTo({ top: 0, behavior: "smooth" });
    board?.focus({ preventScroll: true });
  };

  const handleOpenDelegationArtifact = async (artifact: LocalMemoryDelegationArtifactRecord) => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) return;
    await bridge.openDelegationArtifact({
      artifactId: artifact.id,
      relativePath: artifact.relativePath,
    });
  };

  const handleOpenMemoryFile = async (relativePath: string) => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) {
      setMemoryOpenMessage("설치된 데스크톱 앱에서만 로컬 기억 파일을 열 수 있습니다.");
      return;
    }
    try {
      const result = await bridge.openLocalMemoryFile({ relativePath });
      setMemoryOpenMessage(result.userMessage || `${relativePath} 열기 요청을 보냈습니다.`);
    } catch (error) {
      setMemoryOpenMessage(error instanceof Error ? error.message : "로컬 기억 파일 열기 중 오류가 발생했습니다.");
    }
  };

  const handleOpenApprovedOutput = async (workItem: WorkItem) => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) {
      setMemoryOpenMessage("설치된 데스크톱 앱에서만 승인 문서 폴더를 열 수 있습니다.");
      return;
    }
    try {
      const result = await bridge.openApprovedOutput(workItem.id);
      setMemoryOpenMessage(result.userMessage || `${workItem.approvedOutput?.folder ?? "승인 문서"} 열기 요청을 보냈습니다.`);
    } catch (error) {
      setMemoryOpenMessage(error instanceof Error ? error.message : "승인 문서 폴더 열기 중 오류가 발생했습니다.");
    }
  };

  const handleOpenWorkerCompanion = async () => {
    const bridge = createDesktopBridge();
    const currentParams = new URLSearchParams(window.location.search);
    const shouldOpenAppPreview =
      currentParams.get("preview") === "workbench" || currentParams.get("mockRuntime") === "1";
    const openFallbackCompanionPreview = () => {
      const currentParams = new URLSearchParams(window.location.search);
      const nextParams = new URLSearchParams({
        panel: "workers",
        view: "full",
        workerTab: "employees",
        workerCompanion: "1",
        source: "office-approval",
      });
      const previewMode = currentParams.get("preview");
      const mockRuntime = currentParams.get("mockRuntime");
      if (previewMode) nextParams.set("preview", previewMode);
      if (mockRuntime) nextParams.set("mockRuntime", mockRuntime);
      navigateInternalPath(`/?${nextParams.toString()}`);
    };
    if (!bridge.isAvailable) {
      openFallbackCompanionPreview();
      return;
    }
    try {
      const result = await bridge.openWorkerCompanionWindow({
        sizePreset: "compact",
        positionPreset: "bottom_right",
        motionStyle: "calm",
      });
      if (shouldOpenAppPreview) {
        openFallbackCompanionPreview();
        return;
      }
      setMemoryOpenMessage(result.userMessage || "직원 활동 작은 창을 열었습니다.");
    } catch (error) {
      setMemoryOpenMessage(error instanceof Error ? error.message : "직원 활동 작은 창을 열지 못했습니다.");
    }
  };

  const handleStageApprovedOutputFinalAction = async (workItem: WorkItem) => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) {
      commitFinalConfirmationMessage("설치된 데스크톱 앱에서만 승인 문서 공유/제출 전 확인 카드를 만들 수 있습니다.", workItem);
      return;
    }
    setPreparingFinalActionId(workItem.id);
    try {
      const staged = await bridge.stageFinalAction(workItem.id, "share_file");
      const inbox = await bridge.fetchInbox();
      setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
      commitFinalConfirmationMessage(
        staged.userMessage || "승인 문서를 공유/제출 전 최종 확인 후보로 올렸습니다.",
        staged.stagedWorkItem ?? workItem,
      );
      if (staged.stagedWorkItem) await handlePrepareFinalConfirmation(staged.stagedWorkItem);
    } catch (error) {
      commitFinalConfirmationMessage(
        error instanceof Error ? error.message : "승인 문서 최종 확인 후보 생성 중 오류가 발생했습니다.",
        workItem,
      );
    } finally {
      setPreparingFinalActionId(null);
    }
  };

  const handleStageMailAttachmentFolderPlan = async (workItem: WorkItem) => {
    const bridge = createDesktopBridge();
    const organizer = workItem.sourceEvidence?.mailAttachmentOrganizer;
    if (!bridge.isAvailable) {
      setFolderPlanActionMessage("설치된 데스크톱 앱에서만 메일 첨부를 내려받아 폴더 정리 승인 카드로 넘길 수 있습니다.");
      return;
    }
    if (folderPlanActionInFlightRef.current) {
      setFolderPlanActionMessage("다른 폴더 정리 작업이 진행 중입니다. 결과를 확인한 뒤 다시 선택해 주세요.");
      return;
    }
    folderPlanActionInFlightRef.current = true;
    try {
      // A new plan may refer to different sources than the shared manifest.
      folderPlanManifestPathsRef.current = {};
      setRunningFolderPlanActionId(workItem.id);
      setFolderPlanActionMessage("메일 첨부를 로컬 임시 폴더에 내려받고 정리 승인 카드를 준비하는 중입니다.");
      let downloadResult: Awaited<ReturnType<DesktopBridgeApi["downloadMailAttachmentsToStaging"]>> | null = null;
      let files: DocumentLearningFileRecord[] = [];
      if (organizer?.sourceMessageId || workItem.sourceEvidence?.messageSubject) {
        downloadResult = await bridge.downloadMailAttachmentsToStaging({
          connectorId: organizer?.connectorId || workItem.sourceEvidence?.connectorId,
          providerId: organizer?.providerId || workItem.sourceEvidence?.providerId,
          mailbox: workItem.sourceEvidence?.mailboxLabel,
          messageId: organizer?.sourceMessageId || workItem.sourceEvidence?.messageSubject,
          maxAttachments: 8,
        });
        files = downloadResult.files ?? [];
      }

      if (!files.length) {
        const selection = await bridge.chooseDocumentLearningFiles();
        files = selection.files ?? [];
        if (!files.length) {
          setFolderPlanActionMessage(
            [
              downloadResult?.userMessage ?? selection.userMessage ?? "선택한 첨부 파일이 없습니다.",
              "자동 다운로드가 되지 않으면 메일에서 첨부를 내려받은 뒤 로컬 사본만 선택해 주세요. 원본 메일/첨부 삭제, 이동, 외부 공유는 실행하지 않습니다.",
            ].join(" "),
          );
          return;
        }
      }

      const stageResult = await bridge.stageMailAttachmentFolderPlan({
        localStorageRoot: downloadResult?.downloadRootPath,
        connectorId: organizer?.connectorId || workItem.sourceEvidence?.connectorId,
        providerId: organizer?.providerId || workItem.sourceEvidence?.providerId,
        messageId: organizer?.sourceMessageId,
        messageSubject: organizer?.messageSubject || workItem.sourceEvidence?.messageSubject || workItem.title,
        senderPreview: workItem.sourceEvidence?.senderPreview || workItem.senderLabel,
        mailboxLabel: workItem.sourceEvidence?.mailboxLabel,
        selectedKinds: ["email", "pdf", "excel", "word", "image"],
        files,
        attachments: downloadResult?.attachments,
      });
      const inbox = await bridge.fetchInbox();
      setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
      if (stageResult.stagedWorkItem?.id) {
        setLearnedDraftFocus({
          workItemId: stageResult.stagedWorkItem.id,
          draftCount: stageResult.attachmentCount ?? files.length,
          sourceLabel: "메일 첨부 정리",
          nextUserChoice: "오피스 승인함에서 정리 적용 전 확인",
          createdAt: Date.now(),
        });
      }
      setFolderPlanActionMessage(
        stageResult.status === "mail_attachment_folder_plan_staged"
          ? `${stageResult.attachmentCount ?? files.length}개 첨부 로컬 사본을 폴더 정리 승인 카드로 올렸습니다. 이동/삭제/덮어쓰기는 아직 실행하지 않았습니다.`
          : stageResult.userMessage || "메일 첨부 폴더 정리 승인 카드 준비 결과를 확인해 주세요.",
      );
    } catch (error) {
      setFolderPlanActionMessage(error instanceof Error ? error.message : "메일 첨부 정리 승인 카드 준비 중 오류가 발생했습니다.");
    } finally {
      folderPlanActionInFlightRef.current = false;
      setRunningFolderPlanActionId(null);
    }
  };

  const handleRecordDelegationDecision = async (
    artifact: LocalMemoryDelegationArtifactRecord,
    decision: LocalMemoryDelegationApprovalDecision,
  ) => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) return;
    const note =
      decision === "approved"
        ? "앱 오피스에서 실행 후보로 승인했습니다. 실제 발송·등록 전 최종 실행 확인을 다시 받습니다."
        : decision === "change_requested"
          ? "앱 오피스에서 담당 AI 팀원에게 다시 작업하도록 보냈습니다."
          : "앱 오피스에서 보류했습니다.";
    const result = await bridge.recordDelegationArtifactDecision({
      artifactId: artifact.id,
      decision,
      decidedBy: "ModyCrew Office",
      note,
    });
    if (result.queuedAction) {
      await bridge.stageDelegationActionQueueItem(result.queuedAction);
      const inbox = await bridge.fetchInbox();
      setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
    }
    if (result.artifact) {
      setDelegationArtifacts((artifacts) =>
        artifacts.map((item) => (item.id === result.artifact?.id ? result.artifact : item)),
      );
      return;
    }
    const artifactList = await bridge.listDelegationArtifacts();
    setDelegationArtifacts(artifactList.artifacts ?? []);
  };

  const handlePrepareFinalConfirmation = async (workItem: WorkItem, prepareOptions: { userInitiated?: boolean } = {}) => {
    const block = mailDispatchBlockFor(workItem); if (block) { setFinalConfirmationMessage(block.message); return; }
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
      action: "prepare_final_confirmation",
      status: "running",
      virtualOfficeStatus: "problem_solving",
      detail: `${workItem.title} 마지막 확인을 다시 준비하는 중입니다.`,
    });
    if (isUserComposedMailApprovalWorkItem(workItem)) {
      const confirmation = createUserComposedMailFinalConfirmation(workItem);
      setInboxItems((current) =>
        mergeOfficeUserComposedMailInboxItems(current).map((item) => (item.id === workItem.id ? workItem : item)),
      );
      setFinalConfirmation(confirmation);
      setFinalActionValues(confirmation.defaultValues ?? {});
      setFinalDryRun(null);
      setFinalDryRunWorkItemId(null);
      setFinalExecution(null);
      setFinalExecutionWorkItemId(null);
      commitFinalConfirmationMessage(
        "작성 메일 점검 결과를 마지막 확인 카드로 열었습니다. 메일 연결과 최종 확인 전까지 실제 발송은 계속 잠겨 있습니다.",
        workItem,
      );
      await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
        action: "prepare_final_confirmation",
        status: "done",
        virtualOfficeStatus: "approval_pending",
        detail: `${workItem.title} 작성 메일 점검 후보가 마지막 확인 카드로 연결됐습니다. 외부 발송은 잠겨 있습니다.`,
      });
      return;
    }
    if (!bridge.isAvailable) {
      if (mockRuntimeReady) {
        const recheckingMissingConnection =
          readOfficeMockFinalConnectionMissing() &&
          finalConfirmation?.workItemId === workItem.id &&
          finalConfirmation.adapterConnected === false;
        const mockConfirmation = createOfficeMockFinalConfirmation(workItem, {
          forceConnected: recheckingMissingConnection,
        });
        setFinalConfirmation(mockConfirmation);
        setFinalActionValues(mockConfirmation.defaultValues ?? {});
        setFinalDryRun(createOfficeMockFinalDryRun(workItem));
        setFinalDryRunWorkItemId(workItem.id);
        setFinalExecution(null);
        setFinalExecutionWorkItemId(null);
        commitFinalConfirmationMessage(
          recheckingMissingConnection
            ? "연결 상태를 다시 확인했습니다. 미리보기 모드에서는 회사 메일 연결됨으로 표시하고 실행 전 확인을 계속합니다."
            : "포커스된 최종 실행 후보를 열었습니다. 미리보기 모드에서는 실제 외부 발송 없이 실행 전 확인만 검증합니다.",
          workItem,
        );
        await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
          action: "prepare_final_confirmation",
          status: "done",
          virtualOfficeStatus: "approval_pending",
          detail: `${workItem.title} 마지막 확인 준비가 갱신됐습니다. 실행 전 검토를 다시 진행할 수 있습니다.`,
        });
        return;
      }
      setFinalConfirmation(null);
      commitFinalConfirmationMessage("설치된 데스크톱 앱에서만 최종 확인 계약을 준비할 수 있습니다.", workItem);
      await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
        action: "prepare_final_confirmation",
        status: "needs_desktop",
        virtualOfficeStatus: "failed",
        detail: `${workItem.title} 마지막 확인 재개는 설치 앱 연결이 필요합니다.`,
      });
      return;
    }
    setPreparingFinalActionId(workItem.id);
    try {
      const prepareIntent: FinalConfirmationUserIntent = {
        ...prepareOptions,
        otherCardIds: inboxItems.map((item) => item.id),
      };
      // 작업대에서 보류·답장 안 보냄으로 둔 메일이면, 잠근 이유와 푸는 방법을 그대로 알려 줍니다.
      const holdNotice = mailSendHoldNoticeForWorkItem(workItem, prepareIntent);
      const result = await bridge.prepareFinalConfirmation(
        workItem.id,
        createFinalConfirmationPrepareOptionsForWorkItem(workItem, prepareIntent),
      );
      let connectorRefreshMessage = "";
      try {
        const statusResult = await bridge.listConnectorStatuses();
        const connectors = statusResult.connectors ?? [];
        setConnectorStatuses(connectors);
        connectorRefreshMessage = ` 연결 상태 ${connectors.length}개를 방금 다시 확인했습니다.`;
      } catch {
        connectorRefreshMessage = " 연결 상태 새로고침은 실패했지만 최종 확인 계약은 유지했습니다.";
      }
      setFinalConfirmation(result.confirmation ?? null);
      setFinalActionValues(result.confirmation?.defaultValues ?? {});
      setFinalDryRun(null);
      setFinalDryRunWorkItemId(null);
      setFinalExecution(null);
      setFinalExecutionWorkItemId(null);
      const preparedMessage =
        holdNotice && result.status === "final_confirmation_required"
          ? holdNotice
          : result.userMessage || "최종 확인 항목을 준비했습니다.";
      commitFinalConfirmationMessage(`${preparedMessage}${connectorRefreshMessage}`, workItem);
      await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
        action: "prepare_final_confirmation",
        status: "done",
        virtualOfficeStatus: "approval_pending",
        detail: `${workItem.title} 마지막 확인 준비가 갱신됐습니다. 실행 전 검토를 다시 진행할 수 있습니다.`,
      });
    } catch (error) {
      setFinalConfirmation(null);
      setFinalActionValues({});
      setFinalDryRun(null);
      setFinalDryRunWorkItemId(null);
      setFinalExecution(null);
      setFinalExecutionWorkItemId(null);
      commitFinalConfirmationMessage(
        error instanceof Error ? error.message : "최종 확인 준비 중 오류가 발생했습니다.",
        workItem,
      );
      await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
        action: "prepare_final_confirmation",
        status: "error",
        virtualOfficeStatus: "failed",
        detail: error instanceof Error ? error.message : `${workItem.title} 마지막 확인 준비 중 오류가 발생했습니다.`,
      });
    } finally {
      setPreparingFinalActionId(null);
    }
  };

  const handleChangeFinalActionValue = (fieldId: string, value: string) => {
    setFinalActionValues((current) => ({ ...current, [fieldId]: value, ...('body_reviewed' in current && ['recipient','cc','bcc','subject','body','attachment_selection'].includes(fieldId)?{body_reviewed:''}:{}) }));
    setFinalDryRun(null);
    setFinalDryRunWorkItemId(null);
  };

  const handleRecordMailOpsDecision = async (
    workItem: WorkItem,
    decision: "approved" | "change_requested" | "held",
  ) => {
    const bridge = createDesktopBridge();
    if (isUserComposedMailApprovalWorkItem(workItem)) {
      if (decision === "approved") {
        commitMailOpsDecisionMessage(
          "작성 메일 점검 결과를 승인 후보로 확인했습니다. 메일 연결과 마지막 확인 전까지 실제 발송은 계속 잠겨 있습니다.",
          workItem,
          "approved",
        );
        // 사용자가 방금 이 카드를 직접 승인했으므로 그 결정을 이 카드의 발송 승인으로 넘깁니다.
        await handlePrepareFinalConfirmation(workItem, { userInitiated: true });
        return;
      }
      commitMailOpsDecisionMessage(
        decision === "change_requested"
          ? "작성 메일 수정 요청을 기록했습니다. 수신자, 제목, 본문, 첨부를 고친 뒤 다시 승인 후보로 확인합니다."
          : "작성 메일 발송 후보를 보류했습니다. 외부 발송은 실행하지 않았습니다.",
        workItem,
        decision,
      );
      return;
    }
    if (!bridge.isAvailable) {
      commitMailOpsDecisionMessage(
        "설치된 데스크톱 앱에서만 메일 점검 승인/수정/보류 결정을 저장할 수 있습니다.",
        workItem,
        "review",
      );
      return;
    }
    const decidedAt = new Date().toISOString();
    const revisionInstruction =
      decision === "change_requested"
        ? isLearnedDraftWorkItem(workItem)
          ? "문서 업무 비서에게 학습한 형식, 초안 본문, 실행 후보 종류를 다시 확인하도록 요청했습니다."
          : "메일 점검 담당자에게 초안 표현, 일정 시간, 수신자/참조를 다시 확인하도록 요청했습니다."
        : "";
    setRecordingMailOpsDecisionId(workItem.id);
    setMailOpsDecisionMessage("");
    try {
      if (isLearnedDraftWorkItem(workItem)) {
        await bridge.saveWorkDecisions({
          teammateId: "teammate-document",
          teammateName: "문서 업무 비서",
          source: "학습 초안 오피스 승인함",
          decisions: [createLearnedDraftDecisionRecord(workItem, decision, decidedAt, revisionInstruction)],
        });

        if (decision === "approved") {
          const approvalResult = await bridge.approveDraft(workItem.id);
          const finalActionKind = finalActionKindForLearnedDraft(workItem);
          if (finalActionKind) {
            const staged = await bridge.stageFinalAction(workItem.id, finalActionKind);
            const inbox = await bridge.fetchInbox();
            setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
            commitMailOpsDecisionMessage(
              staged.userMessage || approvalResult.userMessage || "학습 초안을 승인하고 앱 최종 확인 후보로 올렸습니다.",
              workItem,
              "approved",
            );
            if (staged.stagedWorkItem) await handlePrepareFinalConfirmation(staged.stagedWorkItem);
            return;
          }

          const inbox = await bridge.fetchInbox();
          setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
          commitMailOpsDecisionMessage(
            approvalResult.userMessage || "학습 초안을 승인하고 로컬 문서 폴더에 저장했습니다.",
            workItem,
            "approved",
          );
          return;
        }

        if (decision === "change_requested") {
          await bridge.requestChange(workItem.id, revisionInstruction);
        } else {
          await bridge.holdAction(workItem.id);
        }
        const inbox = await bridge.fetchInbox();
        setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
        commitMailOpsDecisionMessage(
          decision === "change_requested"
            ? "학습 초안 수정 요청을 업무 결정 기억과 문서 업무 비서 결정 기록에 저장했습니다."
            : "학습 초안 보류 결정을 업무 결정 기억과 문서 업무 비서 결정 기록에 저장했습니다.",
          workItem,
          decision,
        );
        return;
      }

      if (decision === "approved") {
        await bridge.saveWorkDecisions({
          teammateId: workItem.teammateId || "teammate-ops",
          teammateName: workItem.teammateName || "업무 비서",
          source: "메일 점검 승인함",
          decisions: [createMailOpsDecisionRecord(workItem, decision, decidedAt, revisionInstruction)],
        });
        commitMailOpsDecisionMessage(
          "승인 결정을 업무 결정 기억에 저장했습니다. 이제 최종 확인 계약을 준비합니다.",
          workItem,
          "approved",
        );
        // 사용자가 방금 이 카드를 직접 승인했으므로 그 결정을 이 카드의 발송 승인으로 넘깁니다.
        await handlePrepareFinalConfirmation(workItem, { userInitiated: true });
        return;
      }

      if (decision === "change_requested") {
        await bridge.requestChange(workItem.id, revisionInstruction);
      } else {
        await bridge.holdAction(workItem.id);
      }
      await bridge.saveWorkDecisions({
        teammateId: workItem.teammateId || "teammate-ops",
        teammateName: workItem.teammateName || "업무 비서",
        source: "메일 점검 승인함",
        decisions: [createMailOpsDecisionRecord(workItem, decision, decidedAt, revisionInstruction)],
      });
      const inbox = await bridge.fetchInbox();
      setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
      commitMailOpsDecisionMessage(
        decision === "change_requested"
          ? "수정 요청을 업무 결정 기억과 업무 비서 결정 기록에 저장하고 인박스 상태를 갱신했습니다."
          : "보류 결정을 업무 결정 기억과 업무 비서 결정 기록에 저장하고 인박스 상태를 갱신했습니다.",
        workItem,
        decision,
      );
    } catch (error) {
      commitMailOpsDecisionMessage(
        error instanceof Error ? error.message : "메일 점검 결정을 저장하는 중 오류가 발생했습니다.",
        workItem,
        "review",
      );
    } finally {
      setRecordingMailOpsDecisionId(null);
    }
  };

  // 답장 카드의 '어떻게 고칠까요?' — 적은 지시로 AI 가 초안을 다시 쓴다(보내지 않음). 새 초안을 바로 보여 준다.
  const handleRedraftMailReply = async (workItem: WorkItem, instruction: string, options?: { fromSource?: boolean }) => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) {
      return { ok: false, message: "설치된 데스크톱 앱에서만 AI 에게 다시 쓰게 할 수 있어요." };
    }
    try {
      const result = await bridge.redraftMailReply(workItem.id, instruction, options?.fromSource ? { fromSource: true } : undefined);
      if (result.status !== "mail_redraft_ready") {
        return { ok: false, message: result.userMessage || "다시 쓰지 못했어요. 잠시 뒤 다시 눌러 주세요." };
      }
      // 예전 초안으로 준비한 마지막 확인은 버린다 — 새 초안으로 다시 준비해야 그대로 나간다.
      if (finalConfirmation?.workItemId === workItem.id) {
        setFinalConfirmation(null);
        setFinalDryRun(null);
      }
      const inbox = await bridge.fetchInbox();
      setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
      return { ok: true, message: result.userMessage || "지시대로 다시 썼어요.", draftBody: result.draftBody };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "다시 쓰지 못했어요. 잠시 뒤 다시 눌러 주세요." };
    }
  };

  const handleRunFinalActionDryRun = async (workItem: WorkItem) => {
    const block = mailDispatchBlockFor(workItem); if (block) { setFinalConfirmationMessage(block.message); return; }
    const bridge = createDesktopBridge();
    await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
      action: "rerun_dry_run",
      status: "running",
      virtualOfficeStatus: "problem_solving",
      detail: `${workItem.title} 실행 전 검토를 다시 진행하는 중입니다.`,
    });
    if (!bridge.isAvailable) {
      setFinalDryRun(null);
      commitFinalConfirmationMessage("설치된 데스크톱 앱에서만 최종 실행 전 검토를 할 수 있습니다.", workItem);
      await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
        action: "rerun_dry_run",
        status: "needs_desktop",
        virtualOfficeStatus: "failed",
        detail: `${workItem.title} 실행 전 검토 재개는 설치 앱 연결이 필요합니다.`,
      });
      return;
    }
    setRunningDryRunActionId(workItem.id);
    try {
      const result = await bridge.runFinalActionDryRun(workItem.id, finalActionValues);
      setFinalDryRun(result);
      setFinalDryRunWorkItemId(workItem.id);
      setFinalExecution(null);
      setFinalExecutionWorkItemId(null);
      commitFinalConfirmationMessage(result.userMessage || "실행 전 검토 결과를 준비했습니다.", workItem);
      await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
        action: "rerun_dry_run",
        status: "done",
        virtualOfficeStatus: result.status === "final_action_dry_run_blocked" ? "failed" : "approval_pending",
        detail: result.userMessage || `${workItem.title} 실행 전 검토 결과를 다시 준비했습니다.`,
        dryRunAuditId: result.auditId,
        gateStatus: result.finalExecutionGate?.status,
      });
    } catch (error) {
      setFinalDryRun(null);
      setFinalDryRunWorkItemId(null);
      setFinalExecution(null);
      setFinalExecutionWorkItemId(null);
      commitFinalConfirmationMessage(
        error instanceof Error ? error.message : "실행 전 검토 중 오류가 발생했습니다.",
        workItem,
      );
      await recordOfficeRecoveryVirtualOfficeEvent(workItem, {
        action: "rerun_dry_run",
        status: "error",
        virtualOfficeStatus: "failed",
        detail: error instanceof Error ? error.message : `${workItem.title} 실행 전 검토 중 오류가 발생했습니다.`,
      });
    } finally {
      setRunningDryRunActionId(null);
    }
  };

  const handleExecuteFinalAction = async (workItem: WorkItem) => {
    const block = mailDispatchBlockFor(workItem); if (block) { setFinalConfirmationMessage(block.message); return; }
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    if (!bridge.isAvailable) {
      if (mockRuntimeReady) {
        const result = createOfficeMockFinalExecution(workItem);
        setFinalExecution(result);
        setFinalExecutionWorkItemId(workItem.id);
        commitFinalConfirmationMessage(result.userMessage, workItem, "execute");
        return;
      }
      setFinalExecution(null);
      setFinalExecutionWorkItemId(null);
      commitFinalConfirmationMessage("설치된 데스크톱 앱에서만 마지막 확인을 진행할 수 있습니다.", workItem);
      return;
    }
    const dryRunId = finalDryRunWorkItemId === workItem.id ? finalDryRun?.dryRun?.id : "";
    if (!dryRunId) {
      commitFinalConfirmationMessage("먼저 실행 전 검토를 완료해야 마지막 확인을 진행할 수 있습니다.", workItem);
      return;
    }
    setExecutingFinalActionId(workItem.id);
    try {
      // 실제 외부 실행은 사용자가 오피스에서 책임 문구로 직접 해제했을 때만 켭니다.
      // 잠김 상태에서는 기존처럼 후보/검토까지만 진행됩니다.
      const liveEnabled = finalExecutionSettings.liveProviderExecutionEnabled;
      const result = await bridge.executeFinalAction(workItem.id, {
        finalUserPresence: true,
        confirmPhrase: "최종 실행 확인",
        dryRunId,
        values: finalActionValues,
        liveProviderExecutionEnabled: liveEnabled,
        ...(liveEnabled
          ? {
              advancedLiveExecutionAcknowledged: true,
              advancedLiveExecutionPhrase: FINAL_LIVE_EXECUTION_PHRASE,
              advancedLiveExecutionEnabledAt: finalExecutionSettings.enabledAt,
            }
          : {}),
      });
      setFinalExecution(result);
      setFinalExecutionWorkItemId(workItem.id);
      const dispatchReview = mailDispatchReviewState(result.status);
      commitFinalConfirmationMessage(result.userMessage || "마지막 확인 결과를 준비했습니다.", workItem, dispatchReview.blockRetry ? "review" : "execute");
      if (dispatchReview.blockRetry) setMailDispatchBlocks(current => ({...current,[workItem.id]:{label:dispatchReview.label,message:result.userMessage || '발송 상태를 먼저 확인해 주세요.'}}));
      if (
        dispatchReview.clearReview ||
        result.status === "final_execution_provider_dispatched" ||
        result.status === "final_execution_provider_partial" ||
        result.status === "final_execution_already_sent"
      ) {
        // 보낸 뒤에는 같은 검토로 다시 누를 수 없게 검토 결과를 닫고, 카드 상태('보냈어요')를 바로 다시 받아옵니다.
        setFinalDryRun(null);
        setFinalDryRunWorkItemId(null);
        try {
          const inbox = await bridge.fetchInbox();
          setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
        } catch {
          // 새로고침 실패는 다음 주기 갱신에서 다시 맞춥니다.
        }
      }
    } catch (error) {
      setFinalExecution(null);
      setFinalExecutionWorkItemId(null);
      commitFinalConfirmationMessage(
        error instanceof Error ? error.message : "마지막 확인 중 오류가 발생했습니다.",
        workItem,
      );
    } finally {
      setExecutingFinalActionId(null);
    }
  };

  const handleRunBrowserTaskAction = async (workItem: WorkItem, capability: DesktopControlCapabilityId) => {
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    if (!bridge.isAvailable && !mockRuntimeReady) {
      const message = "설치된 데스크톱 앱에서만 내 PC 작업 도우미 다음 단계를 실행할 수 있습니다.";
      setBrowserTaskActionMessage(message);
      recordHomeApprovalDecisionReceipt("browser_task", message, workItem, "review");
      return;
    }
    const actionId = `${workItem.id}:${capability}`;
    setRunningBrowserTaskActionId(actionId);
    setBrowserTaskActionMessage("");
    try {
      const result =
        mockRuntimeReady && !bridge.isAvailable
          ? createOfficeMockBrowserTaskDispatchResult(workItem, capability)
          : await bridge.requestDesktopControlAction({
              capability,
              featureEnabled: true,
              workItemId: workItem.id,
              target: workItem.browserTask?.targetUrl,
              browserActionId: workItem.browserTask?.stagedAction?.id ?? workItem.browserTask?.actionPlan?.[0]?.id,
              instruction: browserTaskInstructionForCapability(workItem, capability),
            });
      const inbox = bridge.isAvailable ? await bridge.fetchInbox() : null;
      setInboxItems((current) => applyBrowserTaskDispatchResultToInbox(inbox ?? current, workItem.id, result));
      const message = formatBrowserTaskActionResult(result);
      setBrowserTaskActionMessage(message);
      recordHomeApprovalDecisionReceipt("browser_task", message, workItem, "review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "내 PC 작업 도우미 다음 단계 실행 중 오류가 발생했습니다.";
      setBrowserTaskActionMessage(message);
      recordHomeApprovalDecisionReceipt("browser_task", message, workItem, "review");
    } finally {
      setRunningBrowserTaskActionId(null);
    }
  };

  const handleRunLocalFileAction = async (workItem: WorkItem, action: "analyze" | "draft" | "hold") => {
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    if (!workItem.localFile?.path) {
      commitLocalFileActionMessage(
        "파일 경로가 없어 분석이나 초안을 만들 수 없습니다. 다시 파일을 선택해 주세요.",
        workItem,
        "review",
      );
      return;
    }
    if (!bridge.isAvailable && !mockRuntimeReady) {
      commitLocalFileActionMessage(
        "설치된 데스크톱 앱에서만 파일 분석과 초안 만들기를 실행할 수 있습니다.",
        workItem,
        "review",
      );
      return;
    }

    const actionId = `${workItem.id}:${action}`;
    setRunningLocalFileActionId(actionId);
    setLocalFileActionMessage("");
    setLocalFilePatternMessage("");
    try {
      if (action === "hold") {
        if (bridge.isAvailable) {
          await bridge.holdAction(workItem.id);
          const inbox = await bridge.fetchInbox();
          setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
        } else {
          setInboxItems((current) => current.map((item) => (item.id === workItem.id ? { ...item, status: "held" } : item)));
        }
        commitLocalFileActionMessage("파일 작업 후보를 보류했습니다. 원본 파일은 변경하지 않았습니다.", workItem, "held");
        return;
      }

      const capability: DesktopControlCapabilityId =
        action === "analyze" ? "analyze_local_file" : "draft_from_local_file";
      const result =
        mockRuntimeReady && !bridge.isAvailable
          ? createOfficeMockLocalFileDispatchResult(workItem, capability)
          : await bridge.requestDesktopControlAction({
              capability,
              featureEnabled: true,
              target: workItem.localFile.path,
              workItemId: workItem.id,
              outputKind: action === "draft" ? "report" : undefined,
              instruction:
                action === "analyze"
                  ? "선택한 파일을 읽고 확인 항목과 위험 신호를 정리"
                  : "선택한 파일을 바탕으로 보고서 초안을 만들고 실행은 승인 전 잠금",
            });
      const inbox = bridge.isAvailable ? await bridge.fetchInbox() : null;
      setInboxItems((current) => applyLocalFileDispatchResultToInbox(inbox ?? current, workItem.id, result));
      commitLocalFileActionMessage(formatLocalFileActionResult(result), workItem, action === "draft" ? "draft" : "analyze");
    } catch (error) {
      commitLocalFileActionMessage(
        error instanceof Error ? error.message : "파일 작업 다음 단계 실행 중 오류가 발생했습니다.",
        workItem,
        "review",
      );
    } finally {
      setRunningLocalFileActionId(null);
    }
  };

  const folderPlanOptionsByItemIdForBoard = useMemo(() => {
    const next = { ...folderPlanOptionsByItemId };
    for (const item of inboxItems) {
      if (isOfficeFolderPlanApprovalItem(item) && !next[item.id]) {
        next[item.id] = folderPlanDefaultOptions;
      }
    }
    return next;
  }, [folderPlanDefaultOptions, folderPlanOptionsByItemId, inboxItems]);

  const folderPlanOptionsForWorkItem = (workItemId: string): FolderPlanApprovalOptions =>
    folderPlanOptionsByItemIdForBoard[workItemId] ?? folderPlanDefaultOptions ?? defaultFolderPlanApprovalOptions();

  const handleChangeFolderPlanCollisionPolicy = (workItemId: string, policy: FolderPlanCollisionPolicy) => {
    setFolderPlanOptionsByItemId((current) => ({
      ...current,
      [workItemId]: {
        ...defaultFolderPlanApprovalOptions(),
        ...current[workItemId],
        collisionPolicy: policy,
      },
    }));
  };

  const handleChangeFolderPlanExcludedKeywords = (workItemId: string, value: string) => {
    setFolderPlanOptionsByItemId((current) => ({
      ...current,
      [workItemId]: {
        ...defaultFolderPlanApprovalOptions(),
        ...current[workItemId],
        excludedPathKeywords: value,
      },
    }));
  };

  const handleRunFolderPlanAction = async (workItem: WorkItem, action: "preview" | "apply" | "revert") => {
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    const approvalOptions = folderPlanOptionsForWorkItem(workItem.id);
    const excludedPathKeywords = parseFolderPlanExcludedKeywords(approvalOptions.excludedPathKeywords);
    if (!bridge.isAvailable && !mockRuntimeReady) {
      commitFolderPlanActionMessage(
        "설치된 데스크톱 앱에서만 폴더 정리 실행 전 검토와 승인 적용을 진행할 수 있습니다.",
        workItem,
        "review",
      );
      return;
    }

    const serializesFolderPlan = action === "preview" || action === "apply" || action === "revert";
    if (serializesFolderPlan && folderPlanActionInFlightRef.current) {
      commitFolderPlanActionMessage("다른 폴더 정리 작업이 진행 중입니다. 결과를 확인한 뒤 다시 선택해 주세요.", workItem, "review");
      return;
    }
    if (serializesFolderPlan) folderPlanActionInFlightRef.current = true;
    let applyRequestStarted = false;
    let revertRequestStarted = false;
    try {
      const actionId = `${workItem.id}:${action}`;
      setRunningFolderPlanActionId(actionId);
      setFolderPlanActionMessage("");
      setLocalFileActionMessage("");
      if (action === "apply") {
        // Every card uses the same fixed manifest. A new attempt may replace it,
        // so discard all page references, never the file itself.
        folderPlanManifestPathsRef.current = {};
      }
      if (mockRuntimeReady && !bridge.isAvailable) {
        if (action === "preview") {
          const result = createOfficeMockFolderPlanPreviewResult(workItem);
          commitFolderPlanActionMessage(formatFolderPlanPreviewResult(result), workItem, "review");
          return;
        }
        if (action === "apply") {
          const result = createOfficeMockFolderPlanApplyResult("apply", undefined, approvalOptions, workItem);
          if (result.manifestPath) {
            folderPlanManifestPathsRef.current = updateFolderPlanManifestPaths(folderPlanManifestPathsRef.current, workItem.id, result.manifestPath);
          }
          commitFolderPlanActionMessage(formatFolderPlanApplyResult(result), workItem, "approved");
          return;
        }
        const manifestPath = folderPlanManifestPathsRef.current[workItem.id] || "mock://folder-plan/modycrew-folder-apply-manifest.json";
        const result = createOfficeMockFolderPlanApplyResult("revert", manifestPath, approvalOptions, workItem);
        commitFolderPlanActionMessage(formatFolderPlanRevertResult(result), workItem, "approved");
        return;
      }

      if (action === "preview") {
        const result = await bridge.previewDocumentLearningFolderPlan({});
        commitFolderPlanActionMessage(formatFolderPlanPreviewResult(result), workItem, "review");
        return;
      }

      if (action === "apply") {
        const preview = await bridge.previewDocumentLearningFolderPlan({});
        if (preview.status !== "document_learning_folder_plan_previewed") {
          commitFolderPlanActionMessage(formatFolderPlanPreviewResult(preview), workItem, "review");
          return;
        }
        applyRequestStarted = true;
        const result = await bridge.applyDocumentLearningFolderPlan({
          planPath: preview.planPath,
          organizedRoot: preview.applySafetyReview?.defaultOrganizedRoot,
          collisionPolicy: approvalOptions.collisionPolicy,
          excludedPathKeywords,
          confirmationText: "정리 적용 승인",
          finalApproval: true,
        });
        const disposition = folderPlanApplyDisposition(result);
        folderPlanManifestPathsRef.current = updateFolderPlanManifestPaths(folderPlanManifestPathsRef.current, workItem.id, disposition.manifestPath);
        commitFolderPlanActionMessage(formatFolderPlanApplyResult(result), workItem, disposition.decision);
        return;
      }

      const confirmedManifestPath = folderPlanManifestPathsRef.current[workItem.id];
      if (!confirmedManifestPath) {
        commitFolderPlanActionMessage("현재 세션에서 확인된 되돌리기 기록이 없어 자동 되돌리기를 보류했습니다. 파일 위치와 기록을 먼저 확인해 주세요.", workItem, "review");
        return;
      }
      // A revert attempt may move files before returning, making all references
      // to the shared apply manifest stale even if its result is uncertain.
      folderPlanManifestPathsRef.current = {};
      revertRequestStarted = true;
      const result = await bridge.revertDocumentLearningFolderPlan({
        manifestPath: confirmedManifestPath,
        confirmationText: "정리 되돌리기 승인",
        finalApproval: true,
      });
      commitFolderPlanActionMessage(formatFolderPlanRevertResult(result), workItem, folderPlanRevertDecision(result));
    } catch (error) {
      if (action === "apply" && applyRequestStarted) {
        folderPlanManifestPathsRef.current = updateFolderPlanManifestPaths(folderPlanManifestPathsRef.current, workItem.id);
        commitFolderPlanActionMessage(
          "정리 적용 응답을 확인하지 못했습니다. 일부 파일이 이동했을 수 있으니 현재 위치를 확인하고 같은 작업을 다시 실행하지 마세요.",
          workItem,
          "review",
        );
      } else if (action === "revert" && revertRequestStarted) {
        commitFolderPlanActionMessage(
          "정리 되돌리기 응답을 확인하지 못했습니다. 일부 파일이 이미 이동했을 수 있으니 현재 위치를 확인하고 같은 작업을 다시 실행하지 마세요.",
          workItem,
          "review",
        );
      } else {
        commitFolderPlanActionMessage(
          error instanceof Error ? error.message : "폴더 정리 승인 작업 중 오류가 발생했습니다.",
          workItem,
          "review",
        );
      }
    } finally {
      if (serializesFolderPlan) folderPlanActionInFlightRef.current = false;
      setRunningFolderPlanActionId(null);
    }
  };

  const handleSaveLocalFilePattern = async (workItem: WorkItem) => {
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    if (!workItem.localFile) {
      commitLocalFilePatternMessage("저장할 파일 작업 기준을 찾지 못했습니다.", workItem);
      return;
    }
    if (!bridge.isAvailable && !mockRuntimeReady) {
      commitLocalFilePatternMessage("설치된 데스크톱 앱에서만 파일 작업 방식을 지난 업무 기억에 저장할 수 있습니다.", workItem);
      return;
    }

    setSavingLocalFilePatternId(workItem.id);
    setLocalFilePatternMessage("");
    try {
      if (mockRuntimeReady && !bridge.isAvailable) {
        commitLocalFilePatternMessage(
          "파일 작업 방식을 지난 업무 기억에 저장하는 흐름을 확인했습니다. 실제 기억 파일은 변경하지 않았습니다.",
          workItem,
        );
        return;
      }

      const extension = workItem.localFile.extension || "문서";
      const result = await bridge.saveWorkLearning({
        id: `local-file-pattern-${workItem.id}-${Date.now()}`,
        sourceKind: "desktop_control",
        sourceLabel: "파일 작업 다음부터 이렇게",
        teammateId: "teammate-computer-use",
        teammateName: "내 PC 작업 비서",
        summary: `${extension.toUpperCase()} 파일 작업은 먼저 파일 후보와 승인 카드를 만들고, 필요하면 분석하기와 초안 만들기로 보고서 초안을 준비합니다.`,
        signals: [
          `파일 종류: ${extension.toUpperCase()}`,
          "볼 범위: 사용자가 선택한 파일 후보",
          `처리 기준: ${workItem.draft?.toneLabel || "문서 분석/초안"}`,
          "오피스 승인함에서 실행하기, 고쳐달라고 하기, 보류하기 선택",
          "먼저 분석하기로 누락, 금액, 일정, 위험 신호를 확인",
          "초안 만들기는 보고서/답장/표 초안까지만 만들고 저장·공유는 승인 전 잠금",
          "rawFilePathStored=false",
          "파일 저장, 이동, 삭제는 저장한 방식이 있어도 실행 전 다시 확인",
          "원본 파일의 전체 경로와 secret 원문은 업무 패턴에 저장하지 않음",
        ],
        artifactPaths: [
          "memory/work-patterns/WorkPatternMemory.md",
          "memory/prompt/crewkit/DesktopControlPromptMemory.md",
          "memory/crew-souls/teammate-computer-use/PromptMemory.md",
          "memory/crew-souls/teammate-computer-use/WorkLog.md",
        ],
        metrics: {
          sourceWorkItemId: workItem.id,
          workPatternSourceKind: "desktop_control",
          fileExtension: extension,
          extractedTextReady: workItem.localFile.extractedTextStatus === "ready",
          approvalBoundaryKept: true,
          rawFilePathStored: false,
        },
      });
      commitLocalFilePatternMessage(
        result.status === "local_memory_work_learning_saved"
          ? `다음부터 이렇게 저장했습니다. 지난 업무 기억 ${result.workPatternCount ?? 0}건 · 파일 변경은 계속 승인 전 잠금`
          : result.userMessage || "파일 작업 방식을 확인했습니다.",
        workItem,
      );
    } catch (error) {
      commitLocalFilePatternMessage(
        error instanceof Error ? error.message : "파일 작업 방식 저장 중 오류가 발생했습니다.",
        workItem,
      );
    } finally {
      setSavingLocalFilePatternId(null);
    }
  };

  const handleSendMailAutomationNotification = async (workItem: WorkItem) => {
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    if (!bridge.isAvailable && !mockRuntimeReady) {
      setMailAutomationNotificationMessage("설치된 데스크톱 앱에서 Telegram 알림 채널을 연결한 뒤 보낼 수 있습니다.");
      return;
    }

    setSendingMailAutomationNotificationId(workItem.id);
    setMailAutomationNotificationMessage("");
    setMailAutomationNotificationDispatchReceipt(null);
    try {
      const evidence = workItem.sourceEvidence?.mailAutomationNotificationDraft;
      const result = bridge.isAvailable
        ? await bridge.sendApprovalNotification({
            channel: "telegram",
            targetWorkItemId: workItem.id,
            notificationTargetIds: [workItem.id],
            mobileReceiveFilterIds: ["approval_waiting", "calendar_candidate", "urgent_risk", "follow_up"],
            mobileReceiveFilterSummary: "승인 대기 / 일정 후보 / 긴급/위험 / 후속 확인",
            digestCount: Number(evidence?.approvalQueueCount ?? 1) || 1,
            firstTitle: workItem.title,
            sourceLabel: "메일 자동 점검 알림",
          })
        : createOfficeMockApprovalNotificationResult(workItem);
      setMailAutomationNotificationMessage(
        result.externalMutation
          ? `알림을 보냈습니다. 대상 ${result.notificationTargetCount ?? 1}건 · 실제 메일/일정/파일 실행은 계속 잠금입니다.`
          : result.userMessage || `알림을 보내지 못했습니다. 상태: ${result.status}`,
      );
      setMailAutomationNotificationDispatchReceipt(createMailAutomationNotificationDispatchReceipt(result));
    } catch (error) {
      setMailAutomationNotificationMessage(
        error instanceof Error ? error.message : "메일 자동 점검 알림 발송 중 오류가 발생했습니다.",
      );
    } finally {
      setSendingMailAutomationNotificationId(null);
    }
  };

  const handleApplyMailAutomationNotificationDecision = async (workItem: WorkItem) => {
    const bridge = createDesktopBridge();
    const mockRuntimeReady = readOfficeMockRuntimeFromLocation();
    setApplyingMailAutomationNotificationDecisionId(workItem.id);
    setMailAutomationNotificationMessage("");
    try {
      if (bridge.isAvailable) {
        const result = await bridge.applyChannelDecision({
          channel: "telegram",
          messageText: "승인 A1",
          receivedAt: new Date().toISOString(),
        });
        const inbox = await bridge.fetchInbox();
        setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox ?? []));
        setMailAutomationNotificationMessage(
          result.channelDecision?.requiresAppReconfirm
            ? "휴대폰 답장을 같은 승인 후보에 반영했습니다. 아래 휴대폰 결정에서 마지막 확인을 열 수 있습니다."
            : result.userMessage || "휴대폰 답장 확인 결과를 반영했습니다.",
        );
        return;
      }
      if (mockRuntimeReady) {
        const decidedItem = createOfficeMockMailAutomationDecisionWorkItem(workItem);
        setInboxItems((current) =>
          mergeOfficeUserComposedMailInboxItems(current).map((item) => (item.id === workItem.id ? decidedItem : item)),
        );
        setMailAutomationNotificationMessage(
          "미리보기 휴대폰 답장 A1을 같은 승인 후보에 반영했습니다. 아래 휴대폰 결정에서 마지막 확인을 열 수 있습니다.",
        );
        return;
      }
      setMailAutomationNotificationMessage("설치된 데스크톱 앱에서 Telegram 답장 수신을 확인할 수 있습니다.");
    } catch (error) {
      setMailAutomationNotificationMessage(
        error instanceof Error ? error.message : "휴대폰 답장 확인 중 오류가 발생했습니다.",
      );
    } finally {
      setApplyingMailAutomationNotificationDecisionId(null);
    }
  };

  const focusedReply = finalActionCandidates.find(item => item.id === readOfficeFocusedFinalActionCardId() && item.finalAction?.kind === 'send_email');
  return (
    <main className={`${styles.shell} ${roomPage.shell}`} data-theme={theme} data-office-space={crewOfficeView ? "crew" : "work"} data-mail-review-focused={Boolean(!crewOfficeView && focusedReply)} aria-label={crewOfficeView ? "크루 사무실" : "ModyCrew 업무 오피스"}>
      <header
        className={styles.topbar}
        data-office-topbar="today_lock_theme_settings_close_compact"
        data-office-topbar-visible-count="5"
        data-office-topbar-language="ko"
      >
        <div className={styles.brand}>
          <img src="/modycrew-logo-256.png" alt="" />
          <div>
            <strong>ModyCrew</strong>
            <span>{crewOfficeView ? "크루 사무실" : "업무 오피스"}</span>
          </div>
        </div>
        <div className={styles.actions} aria-label="업무 오피스 화면 옵션">
          {crewOfficeView ? <button type="button" onClick={() => navigateFromCrewOffice("board")}>업무판 보기</button> : <>
          <button type="button" onClick={handleFocusTodayBoard} data-office-topbar-action="today">
            오늘
          </button>
          <button
            type="button"
            onClick={() => setLiveUnlockOpen((current) => !current)}
            aria-expanded={liveUnlockOpen}
            title="승인한 발송/등록을 실제로 실행할지 여부"
            aria-label={finalExecutionSettings.liveProviderExecutionEnabled ? "실제 실행 켜짐" : "실제 실행 잠금"}
            data-office-topbar-action="execution-lock"
          >
            {finalExecutionSettings.liveProviderExecutionEnabled ? "실행 켜짐" : "실행 잠금"}
          </button>
          </>}
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
            title={theme === "dark" ? "밝은 화면으로 전환" : "어두운 화면으로 전환"}
            data-theme-toggle-label="korean"
            data-office-topbar-action="theme"
          >
            {theme === "dark" ? "밝게" : "어둡게"}
          </button>
          <OfficeDisplaySettings />
          <button type="button" onClick={handleCloseOffice} data-office-topbar-action="close">
            {crewOfficeView ? "대화로" : "닫기"}
          </button>
        </div>
      </header>
      {liveUnlockOpen ? (
        <section className={styles.liveUnlockPanel} aria-label="실제 실행 잠금 설정">
          <strong>실제 외부 실행 (메일 발송 · 일정 등록)</strong>
          {finalExecutionSettings.liveProviderExecutionEnabled ? (
            <>
              <p>
                지금은 켜져 있습니다. 마지막 확인을 통과한 발송/등록은 연결된 메일·캘린더로 실제 실행됩니다.
                {finalExecutionSettings.rollbackGuide ? ` ${finalExecutionSettings.rollbackGuide}` : ""}
              </p>
              <div className={styles.liveUnlockRow}>
                <button
                  type="button"
                  data-variant="danger"
                  onClick={() => {
                    setFinalExecutionSettings(disableFinalLiveExecution());
                    setLiveUnlockPhrase("");
                  }}
                >
                  실제 실행 끄기 (잠금)
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                기본은 잠김입니다. 잠김 상태에서는 승인해도 실제 발송/등록은 하지 않고 검토까지만 진행합니다.
                실제 실행을 켜려면 아래에 <strong>{FINAL_LIVE_EXECUTION_PHRASE}</strong> 를 그대로 입력하세요.
                외부로 나간 메일과 일정은 되돌릴 수 없습니다.
              </p>
              <div className={styles.liveUnlockRow}>
                <input
                  type="text"
                  value={liveUnlockPhrase}
                  onChange={(event) => setLiveUnlockPhrase(event.target.value)}
                  placeholder={FINAL_LIVE_EXECUTION_PHRASE}
                  aria-label="실제 실행 책임 확인 문구"
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = enableFinalLiveExecution(liveUnlockPhrase);
                    setFinalExecutionSettings(next);
                    if (next.liveProviderExecutionEnabled) {
                      setLiveUnlockPhrase("");
                      setLiveUnlockOpen(false);
                    }
                  }}
                  disabled={liveUnlockPhrase.trim() !== FINAL_LIVE_EXECUTION_PHRASE}
                >
                  실제 실행 켜기
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
      {/* 선택한 메일은 검토 화면으로 바로 열고, 그 외에는 결과 목록을 먼저 표시합니다. */}
      <div className={roomPage.content}>
      {!officeLocationReady ? null : !crewOfficeView && focusedReply ? <MailReplyReview
        key={focusedReply.id}
        item={focusedReply}
        confirmation={finalConfirmation?.workItemId===focusedReply.id?finalConfirmation:null}
        values={finalActionValues}
        dryRun={finalDryRunWorkItemId===focusedReply.id?finalDryRun:null}
        execution={finalExecutionWorkItemId===focusedReply.id?finalExecution:null}
        dispatchBlock={mailDispatchBlockFor(focusedReply)}
        notice={finalConfirmationMessage||mailOpsDecisionMessage}
        busy={[preparingFinalActionId,runningDryRunActionId,executingFinalActionId,recordingMailOpsDecisionId].includes(focusedReply.id)}
        liveEnabled={finalExecutionSettings.liveProviderExecutionEnabled}
        onPrepare={()=>void handlePrepareFinalConfirmation(focusedReply,{userInitiated:true})}
        onChange={handleChangeFinalActionValue}
        onReview={()=>void handleRunFinalActionDryRun(focusedReply)}
        onSend={()=>void handleExecuteFinalAction(focusedReply)}
        onSave={()=>void (async()=>{
          setPreparingFinalActionId(focusedReply.id);
          try {
            const bridge=createDesktopBridge();
            const result=await bridge.stageMailDraft({workItemId:focusedReply.id,body:finalActionValues.body||'',subject:finalActionValues.subject||'',to:finalActionValues.recipient||'',cc:finalActionValues.cc||'',bcc:finalActionValues.bcc||''});
            setFinalConfirmationMessage(result.userMessage||'초안 저장 결과를 확인해 주세요.');
            if(result.status==='mail_draft_card_updated'){
              setFinalDryRun(null);setFinalDryRunWorkItemId(null);
              const inbox=await bridge.fetchInbox();setInboxItems(mergeOfficeUserComposedMailInboxItems(inbox??[]));
            }
          }catch(error){setFinalConfirmationMessage(error instanceof Error?error.message:'초안을 저장하지 못했습니다.');}
          finally{setPreparingFinalActionId(null);}
        })()}
        onHold={()=>void handleRecordMailOpsDecision(focusedReply,'held')}
        onUnlock={()=>{setLiveUnlockOpen(true);document.querySelector('main[aria-label="ModyCrew 업무 오피스"]')?.scrollTo({top:0,behavior:'instant'});}}
        onRedraft={isUserComposedMailApprovalWorkItem(focusedReply)?undefined:instruction=>handleRedraftMailReply(focusedReply,instruction)}
      /> : crewOfficeView ? <section className={roomPage.crewSpace} aria-label="크루 사무실 장면" data-office-scene-primary="true">
        <h1>크루 사무실</h1>
        <p>크루를 선택하면 업무 상태를 확인하고 업무판으로 이동할 수 있어요.</p>
        <OfficeScene members={sceneMembers} hireSlots={sceneHireSlots} selectedId={sceneSelectedId}
          saveNotice={scenePersistNotice} onSelect={handleSceneSelect} onHire={handleSceneHire} />
      </section> : <>
      <div className={`${styles.layout} ${showAudit ? "" : styles.layoutSingle}`}>
        <OfficeBoard
          desks={visibleDesks}
          progressValue={officeProgress}
          activeFeatureCount={activeFeatureCount}
          hiddenDeskCount={hiddenDeskCount}
          enabledRuleCount={enabledRuleCount}
          nextActionLabel={nextFeature ? `${nextFeature.title} 추가` : "필수 기능 준비됨"}
          showVirtualOfficeScene={false}
          crewMembers={crewForBoard}
          onOpenCrewProfile={handleSceneSelect}
          channelWorkSummaries={channelWorkSummaries}
          channelQueueItems={channelQueueItems}
          channelQueueFocus={channelQueueFocus}
          activeChannelLabels={activeChannelLabels}
          messengerConnections={officeBoardMessengerConnections}
          channelDecisions={channelDecisionsForBoard}
          connectorStatuses={connectorStatuses}
          connectionRecoveryHandoff={connectionRecoveryHandoff}
          growthSuggestions={growthSuggestions}
          skillSources={skillSources}
          identityFiles={identityFiles}
          delegationArtifacts={delegationArtifacts}
          learnedDraftApprovalItems={learnedDraftApprovalItems}
          processedLearnedDraftItems={processedLearnedDraftItems}
          focusedLearnedDraftWorkItemId={learnedDraftFocus?.workItemId ?? ""}
          learnedDraftFocusContext={learnedDraftFocus}
          approvedOutputItems={approvedOutputItems}
          externalApprovalCandidates={externalApprovalCandidates}
          finalActionCandidates={finalActionCandidates}
          cardAssigneeTeammates={cardAssigneeTeammates}
          changingCardAssigneeId={changingCardAssigneeId}
          cardAssigneeNotice={cardAssigneeNotice}
          onChangeCardAssignee={handleChangeCardAssignee}
          finalConfirmation={finalConfirmation}
          finalActionValues={finalActionValues}
          finalDryRun={finalDryRun}
          finalDryRunWorkItemId={finalDryRunWorkItemId}
          finalExecution={finalExecution}
          finalExecutionWorkItemId={finalExecutionWorkItemId}
          executionLogFocus={executionLogFocus}
          finalConfirmationMessage={finalConfirmationMessage}
          browserTaskActionMessage={browserTaskActionMessage}
          localFileActionMessage={localFileActionMessage}
          localFilePatternMessage={localFilePatternMessage}
          folderPlanActionMessage={folderPlanActionMessage}
          mailAutomationNotificationMessage={mailAutomationNotificationMessage}
          mailAutomationNotificationDispatchReceipt={mailAutomationNotificationDispatchReceipt}
          folderPlanOptionsByItemId={folderPlanOptionsByItemIdForBoard}
          preparingFinalActionId={preparingFinalActionId}
          runningDryRunActionId={runningDryRunActionId}
          executingFinalActionId={executingFinalActionId}
          runningBrowserTaskActionId={runningBrowserTaskActionId}
          runningLocalFileActionId={runningLocalFileActionId}
          runningFolderPlanActionId={runningFolderPlanActionId}
          sendingMailAutomationNotificationId={sendingMailAutomationNotificationId}
          applyingMailAutomationNotificationDecisionId={applyingMailAutomationNotificationDecisionId}
          savingLocalFilePatternId={savingLocalFilePatternId}
          memoryOpenMessage={memoryOpenMessage}
          onOpenDelegationArtifact={handleOpenDelegationArtifact}
          onOpenMemoryFile={handleOpenMemoryFile}
          onOpenApprovedOutput={handleOpenApprovedOutput}
          onOpenWorkerCompanion={handleOpenWorkerCompanion}
          onStageApprovedOutputFinalAction={handleStageApprovedOutputFinalAction}
          onRecordDelegationDecision={handleRecordDelegationDecision}
          onPrepareFinalConfirmation={(workItem) => handlePrepareFinalConfirmation(workItem, { userInitiated: true })}
          onRecordMailOpsDecision={handleRecordMailOpsDecision}
          onRedraftMailReply={handleRedraftMailReply}
          onRecordMailOpsWorkQueueReviewEvent={handleRecordMailOpsWorkQueueReviewEvent}
          onRunLocalFileAction={handleRunLocalFileAction}
          onRunFolderPlanAction={handleRunFolderPlanAction}
          onStageMailAttachmentFolderPlan={handleStageMailAttachmentFolderPlan}
          onSendMailAutomationNotification={handleSendMailAutomationNotification}
          onApplyMailAutomationNotificationDecision={handleApplyMailAutomationNotificationDecision}
          onChangeFolderPlanCollisionPolicy={handleChangeFolderPlanCollisionPolicy}
          onChangeFolderPlanExcludedKeywords={handleChangeFolderPlanExcludedKeywords}
          onSaveLocalFilePattern={handleSaveLocalFilePattern}
          onChangeFinalActionValue={handleChangeFinalActionValue}
          onRunFinalActionDryRun={handleRunFinalActionDryRun}
          onExecuteFinalAction={handleExecuteFinalAction}
          onRunBrowserTaskAction={handleRunBrowserTaskAction}
          mailOpsDecisionMessage={mailOpsDecisionMessage}
          recordingMailOpsDecisionId={recordingMailOpsDecisionId}
          forceOpenDetailFold={officeMockRuntimeReady}
          onUnlockNext={nextFeature ? handleUnlockNext : undefined}
        />
      </div>
      {/* 업무 목록은 결과 다음에 표시하며, 보드의 다열 그리드 밖에 둡니다. */}
      <TaskBoard />
      <details className={roomPage.sceneMount} data-office-scene-primary="true"><summary>크루의 일하는 모습</summary>
        <OfficeScene
          members={sceneMembers}
          hireSlots={sceneHireSlots}
          selectedId={sceneSelectedId}
          saveNotice={scenePersistNotice}
          onSelect={handleSceneSelect}
          onHire={handleSceneHire}
        />
      </details>
      <details className={roomPage.crewSetup}>
        <summary>크루 구성</summary>
      <section
        className={styles.commandHierarchy}
        aria-label="크루 자동 구성과 메인 크루 명령 흐름"
        data-auto-crew="learning_evidence_to_local_role_setup"
        data-auto-crew-missing={automaticCrewMissingCount}
        data-auto-crew-external-mutation="false"
      >
        <header>
          <div>
            <span>크루 자동 구성</span>
            <strong>한 번 누르면 현재 업무 근거에 맞는 크루만 준비합니다</strong>
            <small>크루 추가는 로컬 역할·기억만 준비합니다. 메일 발송, 일정 등록, 파일 변경, 도구 설치는 각각 별도 승인입니다.</small>
          </div>
          <button
            type="button"
            onClick={handleAutomaticCrewAssembly}
            disabled={automaticCrewMissingCount === 0}
          >
            {automaticCrewMissingCount
              ? "필요한 크루 " + automaticCrewMissingCount + "명 자동 구성"
              : "현재 크루 구성 확인"}
          </button>
        </header>
        <div className={styles.commandHierarchyTree}>
          <article className={styles.commandMasterCard}>
            <span>메인 크루</span>
            <strong>{crewMaster?.name ?? "메인 컨트롤"}</strong>
            <small>{crewMaster?.roleTitle ?? "사용자 요청을 받고 역할별로 분배"}</small>
            <b>요청 정리 → 역할 분배 → 결과 취합</b>
          </article>
          <ol>
            {automaticCrewHierarchy.map((member) => (
              <li
                key={member.templateId}
                data-state={member.ready ? "ready" : "planned"}
              >
                <span className={styles.commandHierarchyArrow} aria-hidden="true">↓</span>
                <button
                  type="button"
                  disabled={!member.ready}
                  onClick={() => {
                    const teammate = crewMembers.find(
                      (item) => item.templateId === member.templateId,
                    );
                    if (teammate) handleSceneSelect(teammate.id);
                  }}
                >
                  <span>{member.teamLabel}</span>
                  <strong>{member.name}</strong>
                  <small>{member.roleTitle}</small>
                </button>
                <div>
                  <span>명령</span>
                  <strong>{crewMaster?.name ?? "메인 컨트롤"}: “{member.command}”</strong>
                  <small>성장: {member.growthLabel}</small>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <footer>
          <span>성장과 안전</span>
          <strong>크루별 업무 방식·작업 기록·결정 기록은 분리하고, 메인 크루가 다음 역할과 도구 성장을 제안합니다.</strong>
          <small>결과는 오피스 승인함으로 모이며 사용자의 최종 확인 전에는 외부로 실행되지 않습니다.</small>
        </footer>
      </section>
      </details>
      {showAudit ? <details className={roomPage.auditFold}><summary>최근 처리 기록 {auditEvents.length}건</summary><AuditTimeline events={auditEvents} /></details> : null}
      </>}
      </div>
      <TeammateProfileDrawer
        open={Boolean(sceneDrawerTeammate)}
        teammate={sceneDrawerTeammate}
        isNew={sceneDrawerIsNew}
        status={sceneDrawerMember?.status ?? "idle"}
        currentTask={sceneDrawerMember?.currentTask ?? sceneDrawerTeammate?.brief ?? ""}
        workCount={sceneDrawerMember?.workCount ?? 0}
        isMain={sceneDrawerTeammate?.id === defaultAITeammateId}
        templates={aiTeammateTemplates}
        onPickTemplate={handleScenePickTemplate}
        onClose={handleSceneCloseDrawer}
        onSave={handleSceneSaveTeammate}
        onRemove={handleSceneRemoveTeammate}
        onDelegate={handleSceneDelegate}
        resultContent={crewOfficeView && sceneDrawerTeammate && !sceneDrawerIsNew ? <section className={roomPage.crewResults} aria-label="크루 업무 결과 확인">
          <strong>업무 결과 확인</strong>
          <p>결과는 현재 저장소의 업무판에서 확인해 주세요.</p>
          <button type="button" onClick={() => navigateFromCrewOffice("board")}>업무판에서 확인</button>
        </section> : undefined}
      />
    </main>
  );
}

function browserTaskInstructionForCapability(workItem: WorkItem, capability: DesktopControlCapabilityId): string {
  const targetLabel =
    workItem.browserTask?.finalPresenceContract?.targetElementDescription ||
    workItem.browserTask?.dryRunPlan?.clickTarget ||
    workItem.browserTask?.stagedAction?.label ||
    workItem.title;
  const confirmationPhrase =
    workItem.browserTask?.finalPresenceContract?.limitedExecutionGate?.confirmationPhrase || "화면 대상 실행 확인";
  const instructions: Partial<Record<DesktopControlCapabilityId, string>> = {
    plan_browser_actions: `${targetLabel} 화면에서 다음 행동 후보를 읽기 전용으로 계획합니다.`,
    attach_browser_screen_evidence: `${targetLabel} 대상 화면 증거를 읽기 전용으로 붙입니다.`,
    match_browser_target_element: `${targetLabel} 대상 요소와 화면 증거를 비교합니다.`,
    prepare_browser_limited_execution: `${targetLabel} 마지막 확인을 준비하고 감사 기록을 남깁니다.`,
    confirm_browser_limited_execution: confirmationPhrase,
    request_browser_limited_execution: confirmationPhrase,
    verify_browser_limited_execution_result: `${targetLabel} 결과 화면을 읽기 전용으로 확인합니다.`,
  };
  return instructions[capability] ?? `${targetLabel} 작업을 읽기 전용으로 점검합니다.`;
}

function browserTaskCapabilityLabel(capability: DesktopControlCapabilityId): string {
  const labels: Partial<Record<DesktopControlCapabilityId, string>> = {
    plan_browser_actions: "작업 계획",
    attach_browser_screen_evidence: "화면 증거",
    match_browser_target_element: "대상 매칭",
    prepare_browser_limited_execution: "마지막 확인",
    confirm_browser_limited_execution: "최종 문구",
    request_browser_limited_execution: "실행 요청",
    verify_browser_limited_execution_result: "결과 확인",
  };
  return labels[capability] ?? "내 PC 작업 도우미";
}

function formatBrowserTaskActionResult(result: DesktopControlDispatchResult): string {
  const label = browserTaskCapabilityLabel(result.capability);
  const message = result.userMessage || `${label} 결과를 준비했습니다.`;
  return result.auditFile ? `${message} 감사 기록: 내 PC 작업 감사 기록` : message;
}

function formatLocalFileActionResult(result: DesktopControlDispatchResult): string {
  if (result.status === "file_analyzed") {
    return `${result.userMessage} 원본 파일 변경, 저장, 이동, 삭제는 실행하지 않았습니다.`;
  }
  if (result.status === "output_drafted") {
    return `${result.userMessage} 초안만 만들었고 외부 공유와 파일 저장은 승인 전까지 잠겨 있습니다.`;
  }
  return result.userMessage || "파일 작업 결과를 준비했습니다. 원본 파일은 변경하지 않았습니다.";
}

function formatFolderPlanPreviewResult(result: DocumentLearningFolderPlanPreviewResult): string {
  const operationCount = result.operationCount ?? result.applySafetyReview?.operationCount ?? 0;
  const duplicateCount = result.applySafetyReview?.duplicateReviewCount ?? 0;
  const reviewLabel = operationCount ? `${operationCount}개 후보` : "정리 후보";
  const safetySummary = result.safetySummary || "원본 변경 없음";
  const nextUserChoice = result.nextUserChoice || "적용 전 제외/충돌 확인 필요";
  return `${result.userMessage || `${reviewLabel}를 실행 전 검토로 확인했습니다.`} ${nextUserChoice} · 중복 수동 검토 ${duplicateCount}개 · ${safetySummary}`;
}

function folderPlanApplyDisposition(result: DocumentLearningFolderPlanApplyResult) {
  const completed = result.status === "document_learning_folder_plan_applied";
  return { decision: completed ? "approved" as const : "review" as const, manifestPath: completed ? result.manifestPath : undefined };
}

function updateFolderPlanManifestPaths(current: Record<string, string>, workItemId: string, confirmedPath?: string) {
  const next = { ...current };
  if (confirmedPath) next[workItemId] = confirmedPath;
  else delete next[workItemId];
  return next;
}

function formatFolderPlanApplyResult(result: DocumentLearningFolderPlanApplyResult): string {
  if (["document_learning_folder_plan_apply_record_unconfirmed", "document_learning_folder_plan_apply_outcome_unknown"].includes(result.status)) {
    return `${result.userMessage || "파일 이동 결과 또는 기록 저장을 확인하지 못했습니다."} 현재 파일 위치를 확인하고 같은 작업을 다시 실행하지 마세요. 자동 되돌리기는 보장되지 않습니다.`;
  }
  if (/needs_approval/u.test(result.status)) {
    return result.userMessage || "정리 적용은 정리 적용 승인 후에만 실행합니다.";
  }
  if (result.status !== "document_learning_folder_plan_applied") {
    return result.userMessage || "정리 적용을 완료하지 못했습니다. 파일 위치와 기록을 확인해 주세요.";
  }
  const excludedKeywords = result.excludedPathKeywords?.length ? result.excludedPathKeywords.join(", ") : "없음";
  const collisionSummary = result.collisionSummary || `충돌 처리: ${folderPlanCollisionPolicyLabel(result.collisionPolicy)}`;
  const rollbackGuide = result.rollbackGuide || "되돌리기는 적용 기록 파일과 정리 되돌리기 승인 후에만 실행합니다.";
  const mailAttachmentApply = result.mailAttachmentOrganizerApply
      ? [
          `메일 첨부 로컬 사본 적용 영수증: ${result.mailAttachmentOrganizerApply.contract}`,
          `적용 로컬 사본 ${result.mailAttachmentOrganizerApply.appliedLocalCopyCount ?? result.appliedCount ?? 0}개`,
          `로컬 사본만 적용: ${String(result.mailAttachmentOrganizerApply.localCopyOnly ?? true)}`,
          "메일 원본 변경 없음",
          "원본 첨부 삭제 없음",
          `외부 공유 생성: ${String(result.mailAttachmentOrganizerApply.originalShareCreated ?? false)}`,
        ].join(" · ")
    : "";
  return [
    result.userMessage || "정리 적용 결과를 준비했습니다.",
    `적용 기록 파일: ${result.manifestPath ? "저장됨" : "확인 필요"}`,
    collisionSummary,
    `제외 단어: ${excludedKeywords}`,
    rollbackGuide,
    "삭제/덮어쓰기 없음",
    mailAttachmentApply,
  ].filter(Boolean).join(" · ");
}

function folderPlanRevertDecision(result: DocumentLearningFolderPlanApplyResult) {
  return result.status === "document_learning_folder_plan_reverted" && result.skippedCount === 0 ? "approved" as const : "review" as const;
}

function formatFolderPlanRevertResult(result: DocumentLearningFolderPlanApplyResult): string {
  if (/needs_approval|missing|cancelled/u.test(result.status)) {
    return result.userMessage || "정리 되돌리기는 적용 기록 파일과 정리 되돌리기 승인 후에만 실행합니다.";
  }
  if (result.status !== "document_learning_folder_plan_reverted") {
    return `${result.userMessage || "되돌리기 결과를 확인하지 못했습니다."} 일부 파일이 이미 이동했을 수 있으니 현재 위치를 확인하고 같은 작업을 다시 실행하지 마세요.`;
  }
  const nextUserChoice = result.nextUserChoice || "되돌리기 기록을 확인할 수 있습니다.";
  const skippedCount = result.skippedCount;
  const skippedNotice = typeof skippedCount === "number" && Number.isInteger(skippedCount) && skippedCount >= 0
    ? skippedCount > 0 ? `${skippedCount}개는 되돌리지 못해 확인이 필요합니다.` : ""
    : "되돌리지 못한 파일 수를 확인할 수 없어 전체 결과 확인이 필요합니다.";
  return [result.userMessage || "정리 되돌리기 결과를 준비했습니다.", skippedNotice, `되돌리기 기록 파일: ${result.revertManifestPath ? "저장됨" : "확인 필요"}`, nextUserChoice].filter(Boolean).join(" · ");
}

function buildDesksFromActivity(
  events: SelectedWorkActionEvent[],
  inboxItems: WorkItem[] = [],
  delegationArtifacts: LocalMemoryDelegationArtifactRecord[] = [],
) {
  const deskMap = new Map<Desk["id"], Desk>();
  for (const artifact of delegationArtifacts.slice(0, 18)) {
    const deskId = deskIdForDelegationArtifact(artifact);
    const current = deskMap.get(deskId) ?? createDesk(deskId);
    const status = deskCardStatusForDelegationArtifact(artifact);
    const queueLabel = delegationArtifactQueueLabel(artifact);
    current.cards.push({
      id: `delegation-${artifact.id}`,
      title: queueLabel
        ? `${queueLabel} · ${artifact.title || artifactKindTitle(artifact.artifactKind)}`
        : artifact.title || artifactKindTitle(artifact.artifactKind),
      status,
      triggerSource: [
        "AI 팀원 결과 기록",
        delegationArtifactOutputKindLabel(artifact),
        artifact.teammateName,
        artifact.rows?.length ? `${artifact.rows.length}개 채널` : "",
      ].filter(Boolean).join(" · "),
      ageMinutes: ageMinutes(artifact.createdAt),
      nextDesk: status === "draft_ready" || status === "approval_pending" ? "approval" : undefined,
    });
    if (status === "approval_pending" || status === "draft_ready") current.busy += 1;
    else if (status === "completed") current.done += 1;
    else if (status === "failed") current.failed += 1;
    deskMap.set(deskId, current);
  }
  for (const event of events.slice(0, 18)) {
    const deskId = deskIdForActivity(event);
    const current = deskMap.get(deskId) ?? createDesk(deskId);
    const status = deskCardStatusForActivity(event);
    current.cards.push({
      id: event.id,
      title: event.label || "작업",
      status,
      triggerSource: event.sourceLabel || event.kind || "업무 이벤트",
      ageMinutes: ageMinutes(event.createdAt),
      nextDesk: status === "approval_pending" ? "approval" : undefined,
    });
    if (event.status === "running") current.busy += 1;
    else if (event.status === "done") current.done += 1;
    else current.failed += event.status === "error" ? 1 : 0;
    deskMap.set(deskId, current);
  }
  for (const item of inboxItems.slice(0, 18)) {
    const deskId = deskIdForWorkItem(item);
    const current = deskMap.get(deskId) ?? createDesk(deskId);
    const status = deskCardStatusForWorkItem(item);
    current.cards.push({
      id: `inbox-${item.id}`,
      title: item.title || "승인 대기 업무",
      status,
      triggerSource: [item.sourceLabel, item.senderLabel].filter(Boolean).join(" · ") || "인박스 업무",
      ageMinutes: ageMinutes(item.receivedAt),
      nextDesk: item.status === "approval_pending" && deskId !== "approval" ? "approval" : undefined,
    });
    if (status === "analyzing") current.busy += 1;
    else if (status === "completed") current.done += 1;
    else if (status === "failed") current.failed += 1;
    deskMap.set(deskId, current);
  }
  return deskMap;
}

function deskIdForDelegationArtifact(artifact: LocalMemoryDelegationArtifactRecord): Desk["id"] {
  if (artifact.artifactKind === "approval") return "approval";
  if (artifact.artifactKind === "mail") return "inbox";
  return "document";
}

function deskCardStatusForDelegationArtifact(artifact: LocalMemoryDelegationArtifactRecord): DeskCardStatus {
  if (artifact.nextActionKind === "execution_candidate") return "approval_pending";
  if (artifact.nextActionKind === "revision_request") return "analyzing";
  if (artifact.approvalDecision === "approved") return "completed";
  if (artifact.approvalDecision === "change_requested" || artifact.approvalDecision === "held" || artifact.approvalDecision === "rejected") {
    return "blocked";
  }
  if (artifact.artifactKind === "approval") return "approval_pending";
  if (artifact.artifactKind === "mail") return "draft_ready";
  if (artifact.artifactKind === "report") return "draft_ready";
  return "completed";
}

function artifactKindTitle(kind: string): string {
  if (kind === "approval") return "승인 요청 결과";
  if (kind === "mail") return "메일 초안";
  return "보고서 초안";
}

function delegationArtifactQueueLabel(artifact: LocalMemoryDelegationArtifactRecord): string {
  return sanitizeMetricText(artifact.metrics?.queueLabel);
}

function delegationArtifactOutputKind(artifact: LocalMemoryDelegationArtifactRecord): string {
  return sanitizeMetricText(artifact.metrics?.outputKind);
}

function delegationArtifactApprovalRequired(artifact: LocalMemoryDelegationArtifactRecord): boolean {
  return artifact.metrics?.approvalRequired === true || artifact.metrics?.approvalRequired === "true";
}

function delegationArtifactOutputKindLabel(artifact: LocalMemoryDelegationArtifactRecord): string {
  const outputKind = delegationArtifactOutputKind(artifact);
  if (outputKind === "document_draft") return "문서 초안";
  if (outputKind === "deck_brief") return "PPT 목차";
  if (outputKind === "video_brief") return "영상 제작";
  if (outputKind === "toolchain_queue") return "작업 준비";
  if (outputKind === "knowledge_ingest") return "지식 학습";
  if (outputKind === "mailops_queue") return "메일 승인";
  if (outputKind === "folder_plan") return "정리 계획";
  if (outputKind === "skill_growth") return "기능 개선 기록";
  return "";
}

function sanitizeMetricText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function createDesk(id: Desk["id"]): Desk {
  const label = deskLabels[id];
  return {
    id,
    label: label.label,
    shortLabel: label.short,
    description: label.description,
    busy: 0,
    done: 0,
    failed: 0,
    cards: [],
  };
}

function deskIdForActivity(event: SelectedWorkActionEvent): Desk["id"] {
  if (event.kind === "schedule_briefing") return "calendar";
  if (event.kind === "document_learning") return "document";
  if (event.kind === "approval_notification" || event.kind === "messenger_decision" || event.status === "needs_desktop") return "approval";
  if (event.kind === "desktop_control" || event.kind === "automation" || event.kind === "work_sync") return "ops";
  return "inbox";
}

function deskIdForWorkItem(item: WorkItem): Desk["id"] {
  if (item.status === "approval_pending") return "approval";
  if (item.channelDecision?.requiresAppReconfirm) return "approval";
  if (item.source === "calendar" || item.finalAction?.kind === "create_calendar_event" || item.schedules?.length) return "calendar";
  if (item.source === "local_file" || item.source === "uploaded_file" || item.sourceEvidence?.providerId === "document_learning") return "document";
  if (item.riskLabel === "high" || item.riskSignals.some((signal) => signal.riskLabel === "high")) return "guard";
  if (item.source === "web_page" || item.browserTask) return "ops";
  return "inbox";
}

function deskCardStatusForActivity(event: SelectedWorkActionEvent): DeskCardStatus {
  if (event.status === "running") return "analyzing";
  if (event.status === "done") return "completed";
  if (event.status === "needs_desktop") return "approval_pending";
  if (event.status === "unknown") return "blocked";
  return "failed";
}

function deskCardStatusForWorkItem(item: WorkItem): DeskCardStatus {
  if (item.status === "pending" || item.status === "analyzing") return "analyzing";
  if (item.status === "draft_ready" || item.status === "needs_review") return "draft_ready";
  if (item.status === "approval_pending") return "approval_pending";
  if (item.status === "completed") return "completed";
  if (item.status === "change_requested" || item.status === "held" || item.status === "rejected") return "blocked";
  return "failed";
}

/** 채팅·업무판에서 [승인함에서 보기]로 넘어온 카드 id(자동으로 보내기 단계를 열지는 않는다). */
function readOfficeFocusedFinalActionCardId() {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get("focusFinalActionCard")?.trim() ?? "";
  } catch {
    return "";
  }
}

function readOfficeFinalActionFocus() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const queryFocus = params.get("focusFinalAction")?.trim();
  if (queryFocus) return queryFocus;
  try {
    const raw = window.localStorage.getItem(officeFinalActionFocusStorageKey);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { workItemId?: string; createdAt?: number };
    const tooOld = parsed.createdAt ? Date.now() - parsed.createdAt > 10 * 60 * 1000 : false;
    return tooOld ? "" : parsed.workItemId?.trim() ?? "";
  } catch {
    return "";
  }
}

function readOfficeExecutionLogFocus(): OfficeExecutionLogFocus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(officeExecutionLogFocusStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfficeExecutionLogFocus>;
    const auditId = parsed.auditId?.trim();
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
    const tooOld = createdAt ? Date.now() - createdAt > 10 * 60 * 1000 : true;
    if (!auditId || tooOld) {
      window.localStorage.removeItem(officeExecutionLogFocusStorageKey);
      return null;
    }
    const mailOpsQueueReviewContext = parsed.mailOpsQueueReviewContext?.trim() ?? "";
    const mailOpsQueueReviewDecision = parsed.mailOpsQueueReviewDecision?.trim() ?? "";
    const hasMailOpsQueueReview = Boolean(mailOpsQueueReviewContext || mailOpsQueueReviewDecision);
    return {
      workItemId: parsed.workItemId?.trim() ?? "",
      auditId,
      dryRunAuditId: parsed.dryRunAuditId?.trim() ?? "",
      executionGateStatus: parsed.executionGateStatus?.trim() ?? "",
      proofChain: parsed.proofChain?.trim() ?? "",
      rollbackLabel: parsed.rollbackLabel?.trim() ?? "외부 변경 없음",
      sourceEventId: parsed.sourceEventId?.trim() ?? "",
      mailOpsQueueReviewContext,
      mailOpsQueueReviewDecision,
      mailOpsQueueReviewNote: parsed.mailOpsQueueReviewNote?.trim() ?? "",
      mailOpsWorkQueueAutomationProof:
        parsed.mailOpsWorkQueueAutomationProof?.trim() ||
        (hasMailOpsQueueReview ? WORK_AUTOMATION_MAILOPS_WORK_QUEUE_PROOF_LABEL : ""),
      mailOpsWorkQueueEngineHandoff:
        parsed.mailOpsWorkQueueEngineHandoff?.trim() ||
        (hasMailOpsQueueReview ? WORK_AUTOMATION_WORK_QUEUE_HANDOFF_CONTRACT : ""),
      mailOpsWorkQueueEnginePath:
        parsed.mailOpsWorkQueueEnginePath?.trim() ||
        (hasMailOpsQueueReview ? WORK_AUTOMATION_MAILOPS_ENGINE_PATH : ""),
      mailOpsWorkQueueApprovalGate:
        parsed.mailOpsWorkQueueApprovalGate?.trim() ||
        (hasMailOpsQueueReview ? WORK_AUTOMATION_APPROVAL_GATE_CONTRACT : ""),
      createdAt,
    };
  } catch {
    return null;
  }
}

function readOfficeLearnedDraftFocus(): LearnedDraftFocus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(officeLearnedDraftFocusStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LearnedDraftFocus>;
    const workItemId = parsed.workItemId?.trim();
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
    const tooOld = createdAt ? Date.now() - createdAt > 10 * 60 * 1000 : true;
    if (!workItemId || tooOld) {
      window.localStorage.removeItem(officeLearnedDraftFocusStorageKey);
      return null;
    }
    return {
      workItemId,
      draftCount: typeof parsed.draftCount === "number" ? parsed.draftCount : 0,
      sourceLabel: parsed.sourceLabel?.trim() || "문서 학습 결과",
      nextUserChoice: parsed.nextUserChoice?.trim() || "오피스 승인함 또는 보고서 만들기",
      createdAt,
    };
  } catch {
    return null;
  }
}

function readOfficeChannelQueueFocus(): ChannelQueueFocus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(officeChannelQueueFocusStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChannelQueueFocus>;
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
    const tooOld = createdAt ? Date.now() - createdAt > 10 * 60 * 1000 : true;
    if (tooOld || !Array.isArray(parsed.targetTeammateIds) || !parsed.targetTeammateIds.length) {
      window.localStorage.removeItem(officeChannelQueueFocusStorageKey);
      return null;
    }
    return {
      sourceThreadId: String(parsed.sourceThreadId ?? ""),
      sourceTeammateId: String(parsed.sourceTeammateId ?? ""),
      sourceTeammateName: String(parsed.sourceTeammateName ?? "메인 컨트롤"),
      targetTeammateIds: parsed.targetTeammateIds.map(String).filter(Boolean).slice(0, 12),
      targetLabels: Array.isArray(parsed.targetLabels) ? parsed.targetLabels.map(String).filter(Boolean).slice(0, 12) : [],
      requestText: String(parsed.requestText ?? ""),
      createdAt,
    };
  } catch {
    return null;
  }
}

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/gu, "\\$&");
}

function activityEventsToAudit(events: SelectedWorkActionEvent[]): AuditEvent[] {
  return events.slice(0, 24).map((event) => ({
    id: event.id,
    at: event.updatedAt ?? event.createdAt,
    actor:
      event.kind === "messenger_decision"
        ? "channel"
        : event.status === "needs_desktop"
          ? "user"
          : event.kind === "desktop_control"
            ? "tool"
            : "agent",
    event:
      event.status === "done"
        ? event.kind === "messenger_decision"
          ? "channel_decision_recorded"
          : "tool_completed"
        : event.status === "needs_desktop"
          ? "approval_required"
          : event.status === "error"
            ? "tool_failed"
            : "channel_intent_parsed",
    detail: event.detail || event.label,
    severity: event.status === "error" ? "danger" : event.status === "needs_desktop" ? "warning" : "info",
  }));
}

function delegationArtifactsToAudit(artifacts: LocalMemoryDelegationArtifactRecord[]): AuditEvent[] {
  return artifacts.slice(0, 12).map((artifact) => ({
    id: `artifact-audit-${artifact.id}`,
    at: artifact.decidedAt || artifact.createdAt,
    actor: artifact.approvalDecision ? "user" : "agent",
    event: artifact.approvalDecision
      ? "channel_decision_recorded"
      : artifact.artifactKind === "approval"
        ? "approval_required"
        : "document_ingested",
    detail:
      artifact.approvalDecision
        ? `${artifact.title} · ${approvalDecisionAuditLabel(artifact.approvalDecision)}${artifact.nextActionLabel ? ` · ${artifact.nextActionLabel}` : ""}`
        : artifact.artifactKind === "approval"
          ? `${artifact.title} · 앱 최종 승인 대기`
          : `${artifact.title} · ${artifact.relativePath}`,
    severity: artifact.approvalDecision
      ? artifact.approvalDecision === "approved"
        ? "info"
        : "warning"
      : artifact.artifactKind === "approval" ? "warning" : "info",
  }));
}

function delegationArtifactBelongsToMember(artifact: LocalMemoryDelegationArtifactRecord, member: AITeammate): boolean {
  if (artifact.sourceTeammateId === member.id) return true;
  if (artifact.teammateName && artifact.teammateName === member.name) return true;
  return Boolean(
    artifact.rows?.some(
      (row) =>
        row.teammateId === member.id ||
        row.teammateName === member.name ||
        row.channelName === member.channelName,
    ),
  );
}

function delegationArtifactNeedsApproval(artifact: LocalMemoryDelegationArtifactRecord): boolean {
  if (artifact.nextActionKind === "execution_candidate") return true;
  if (artifact.artifactKind === "approval" && !artifact.approvalDecision) return true;
  return artifact.approvalStatus === "pending";
}

function latestOwnedWorkEvents(events: SelectedWorkActionEvent[], now: number): SelectedWorkActionEvent[] {
  const latest = new Map<string, SelectedWorkActionEvent>();
  const timestamp = (event: SelectedWorkActionEvent) => Date.parse(event.updatedAt ?? event.createdAt);
  const terminalRank = (event: SelectedWorkActionEvent) => event.status === "running" ? 0 : 1;
  for (const original of events) {
    const time = timestamp(original);
    const age = now - time;
    const event = original.status === "running" && (!Number.isFinite(age) || age < 0 || age >= 120_000)
      ? { ...original, status: "unknown" as const, statusProjection: "stale_running" as const }
      : original;
    const owner = typeof event.metrics?.teammateId === "string" ? event.metrics.teammateId : "";
    // ai-teammate:* is a shared crew identifier, not a unique work item.
    const isCrewAlias = event.workItemId.startsWith("ai-teammate:");
    const key = owner && event.workItemId && !isCrewAlias ? `${owner}\u0000${event.workItemId}` : `event\u0000${event.id}`;
    const current = latest.get(key);
    const currentTime = current ? timestamp(current) : Number.NEGATIVE_INFINITY;
    // An invalid timestamp is uncertain and must never leave a previous running event displayed as active.
    if (!current || !Number.isFinite(time) || (Number.isFinite(currentTime) &&
      (time > currentTime || (time === currentTime && terminalRank(event) > terminalRank(current))))) latest.set(key, event);
  }
  return [...latest.values()].sort((a, b) => {
    const left = timestamp(a), right = timestamp(b);
    return (Number.isFinite(right) ? right : Number.POSITIVE_INFINITY) - (Number.isFinite(left) ? left : Number.POSITIVE_INFINITY);
  });
}

function buildChannelQueueItems({
  crewMembers,
  activityEvents,
  delegationArtifacts,
  growthSuggestions,
  inboxItems,
}: {
  crewMembers: AITeammate[];
  activityEvents: SelectedWorkActionEvent[];
  delegationArtifacts: LocalMemoryDelegationArtifactRecord[];
  growthSuggestions: LocalMemoryGrowthSuggestion[];
  inboxItems: WorkItem[];
}): ChannelQueueItem[] {
  const fallbackControl = crewMembers[0];
  const eventItems = activityEvents
    .map((event): ChannelQueueItem | null => {
      // Do not assign an event to a worker without an explicit matching owner.
      const teammate = crewMembers.find((member) => member.id === event.metrics?.teammateId);
      if (!teammate) return null;
      return {
        id: `event:${event.id}`,
        workEvent: event,
        teammateId: teammate.id,
        teammateName: teammate.name,
        channelName: teammate.channelName,
        teamLabel: teammate.teamLabel,
        kind: channelQueueKindForEvent(event),
        label: event.label,
        detail: event.detail,
        sourceLabel: event.sourceLabel ?? "작업 이벤트",
        updatedAt: event.updatedAt ?? event.createdAt,
        memoryPath: `memory/crew-souls/${teammate.id}/WorkLog.md`,
        queueLabel: sanitizeMetricText(event.metrics?.queueLabel),
        outputKind: sanitizeMetricText(event.metrics?.outputKind),
        skillId: sanitizeMetricText(event.metrics?.skillId),
        crewKitLabel: sanitizeMetricText(event.metrics?.crewKitLabel),
        approvalRequired: event.metrics?.approvalRequired === true || event.metrics?.approvalRequired === "true",
      };
    })
    .filter(isChannelQueueItem);

  const artifactItems = delegationArtifacts
    .map((artifact): ChannelQueueItem | null => {
      const teammate =
        crewMembers.find((member) => delegationArtifactBelongsToMember(artifact, member)) ?? fallbackControl;
      if (!teammate) return null;
      return {
        id: `artifact:${artifact.id}`,
        teammateId: teammate.id,
        teammateName: teammate.name,
        channelName: teammate.channelName,
        teamLabel: teammate.teamLabel,
        kind: delegationArtifactNeedsApproval(artifact) ? "approval" : "result",
        label: delegationArtifactQueueLabel(artifact) || artifact.title,
        detail: artifact.nextActionLabel ?? artifact.requestText ?? artifact.title ?? artifact.relativePath,
        sourceLabel: ["AI 팀원 결과 기록", delegationArtifactOutputKindLabel(artifact)].filter(Boolean).join(" · "),
        updatedAt: artifact.decidedAt ?? artifact.createdAt,
        memoryPath: artifact.relativePath,
        artifactId: artifact.id,
        queueLabel: delegationArtifactQueueLabel(artifact),
        outputKind: delegationArtifactOutputKind(artifact),
        approvalRequired: delegationArtifactApprovalRequired(artifact),
      };
    })
    .filter(isChannelQueueItem);

  const growthItems = growthSuggestions
    .flatMap((suggestion) => {
      const targetIds = suggestion.assignedTeammateIds?.length
        ? suggestion.assignedTeammateIds
        : fallbackControl
          ? [fallbackControl.id]
          : [];
      return targetIds
        .map((teammateId): ChannelQueueItem | null => {
          const teammate = crewMembers.find((member) => member.id === teammateId) ?? fallbackControl;
          if (!teammate) return null;
          return {
            id: `growth:${suggestion.id}:${teammate.id}`,
            teammateId: teammate.id,
            teammateName: teammate.name,
            channelName: teammate.channelName,
            teamLabel: teammate.teamLabel,
            kind: "growth" as const,
            label: suggestion.title,
            detail: suggestion.nextAction || suggestion.reason,
            sourceLabel: "기능 개선 기록",
            updatedAt: new Date(0).toISOString(),
            memoryPath: "memory/growth/SkillGrowth.md",
          };
        })
        .filter(isChannelQueueItem);
    });

  const inboxItemsForControl = inboxItems
    .filter((item) => item.channelDecision || item.finalAction || item.status === "approval_pending")
    .slice(0, 6)
    .map((item): ChannelQueueItem | null => {
      const teammate = selectTeammateForInboxItem(item, crewMembers, fallbackControl);
      if (!teammate) return null;
      return {
        id: `inbox:${item.id}`,
        teammateId: teammate.id,
        teammateName: teammate.name,
        channelName: teammate.channelName,
        teamLabel: teammate.teamLabel,
        kind: "approval" as const,
        label: item.title,
        detail: item.channelDecision?.messagePreview ?? item.browserTask?.dryRunPlan?.expectedResult ?? item.summary,
        sourceLabel: item.channelDecision
          ? `${item.channelDecision.channel} 결정`
          : item.browserTask
            ? "외부 계정 · 내 PC 작업 도우미 승인"
            : "승인 인박스",
        updatedAt: item.channelDecision?.decidedAt ?? item.receivedAt,
        memoryPath: "memory/delegations/DelegationActionQueue.md",
        workItemId: item.finalAction || item.browserTask ? item.id : undefined,
        queueLabel: item.browserTask ? "외부 계정 승인" : undefined,
        outputKind: item.browserTask ? "computer_use_bridge" : undefined,
        approvalRequired: Boolean(item.browserTask?.requiresFinalUserPresence || item.finalAction),
      };
    })
    .filter(isChannelQueueItem);

  return [...eventItems, ...artifactItems, ...growthItems, ...inboxItemsForControl]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 24);
}

function isChannelQueueItem(value: ChannelQueueItem | null): value is ChannelQueueItem {
  return value !== null;
}

function channelQueueKindForEvent(event: SelectedWorkActionEvent): "running" | "approval" | "result" | "growth" | "error" | "unknown" {
  if (event.status === "running") return "running";
  if (event.status === "needs_desktop") return "approval";
  if (event.status === "error") return "error";
  if (event.status === "unknown") return "unknown";
  if (event.kind === "selected_action" && /CrewKit|성장|추천/u.test(event.label)) return "growth";
  return "result";
}

function formatTeammatePersonalityPreview(instructions: string[] = []) {
  return instructions
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ") || "기본 성향 · 목표와 승인 기준 먼저 확인";
}

function selectTeammateForInboxItem(
  item: WorkItem,
  crewMembers: AITeammate[],
  fallbackControl?: AITeammate,
): AITeammate | undefined {
  if (item.browserTask || item.source === "web_page") {
    return (
      crewMembers.find((member) => member.templateId === "operations") ??
      crewMembers.find((member) => member.templateId === "personal") ??
      fallbackControl
    );
  }
  if (item.source === "email") {
    return crewMembers.find((member) => member.templateId === "operations") ?? fallbackControl;
  }
  if (item.source === "local_file") {
    return (
      crewMembers.find((member) => member.templateId === "finance") ??
      crewMembers.find((member) => member.templateId === "operations") ??
      fallbackControl
    );
  }
  return fallbackControl;
}

function approvalDecisionAuditLabel(decision: string): string {
  if (decision === "approved") return "앱에서 승인됨";
  if (decision === "change_requested") return "수정 요청으로 되돌림";
  if (decision === "rejected") return "거절됨";
  return "보류됨";
}

function ageMinutes(value: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.round((Date.now() - time) / 60_000));
}
