/**
 * Electron preload API 래퍼.
 *
 * - Electron 데스크톱 앱에서 실행될 때는 `window.modyCrewDesktopBridge`,
 *   `window.modyCrewOAuthCallback`, `window.modyCrewAccount` 등 preload 가
 *   주입한 API 를 그대로 호출합니다.
 * - 브라우저 dev / Firebase Hosting 환경에서는 가짜 업무 데이터를 만들지 않고
 *   데스크톱 연결 필요 상태를 돌려줍니다.
 *
 * Phase 2 (`apps/modycrew-desktop` 의 main process 가 `loadFile()` 로
 * `apps/modycrew-web/out/index.html` 을 로드하는 단계) 에서 실제 preload
 * 시그니처와 정확히 일치시킵니다.
 */

import type { ConnectorChatContext } from "./connector-data-context";
import type { WorkSessionWorkspaceCommand, WorkSessionWorkspaceResult } from "../../../packages/domain/dist/work-session-workspace.js";
import { loadBrowserWorkSessionWorkspace, updateBrowserWorkSessionWorkspace } from "./work-session-storage";
import { desktopDocumentRequired, type DocumentProductionPayload, type DocumentProductionResult } from "./document-production";
import { companyDesktopRequired, type CompanyAutomationPayload, type CompanyAutomationResult } from "./company-automation";
import type { DailySkillCatalogResult, DailySkillLookupPayload, DailySkillLookupResult } from "./daily-skills";
import {
  readSelectedWorkActionEvents,
  recordSelectedWorkActionEvent,
  updateSelectedWorkActionEvent,
} from "./selected-work-action-events";
import type { SelectedWorkActionEvent } from "./selected-work-action-events";
import type { WorkItem, WorkbenchHeaderMetrics } from "./types";
import type { HomeApprovalDecisionReceipt } from "./approval-decision-receipts";
import type { TeammateProfileDraftLike } from "./teammate-profile-draft-bridge";
import { openInternalOfficeWindow } from "./safe-navigation";
import {
  ModyMobileSharedMailWorkIntakeRunner,
  type ModyMobileMailShareSource,
  type ModyMobileSharedMailPreview,
} from "../../../packages/domain/dist/mail-mobile-share-intake.js";
import type { ModyProviderWorkIntakeReport } from "../../../packages/domain/dist/provider-work-intake.js";


export type DiscoveredMailServerCandidate = {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapStartTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpStartTls: boolean;
  source: string;
};
type ConnectConnectorPayload = {
  method: string;
  secret?: string;
  scope?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
  imapUser?: string;
  emailAddress?: string;
  confirmDiscoveredServer?: Pick<DiscoveredMailServerCandidate, "imapHost" | "imapPort">;
  siteUrl?: string;
  siteLabel?: string;
  siteUserId?: string;
  appPath?: string;
  channelTargetId?: string;
  warningAcknowledged?: boolean;
};

export type ConnectConnectorResult = {
  status: string;
  userMessage?: string;
  errorMessage?: string;
  authorizationUrl?: string;
  callbackUrl?: string;
  externalUrlOpened?: boolean;
  mailServerDiscovery?: {
    domain: string;
    provider: string;
    candidates: DiscoveredMailServerCandidate[];
  };
  workAnalysis?: MailWorkAnalysis;
  stagedWorkItem?: WorkItem;
  fallbackStageStatus?: string;
  siteUrl?: string;
  siteHost?: string;
  siteLabel?: string;
  appPath?: string;
  credentialReferenceId?: string;
  credentialStorage?: "os_keychain" | "enterprise_vault" | "external_mcp_config" | "local_env_reference" | string;
  aiSecretReadable?: false;
  recovery?: ConnectorStatusRecord["recovery"];
  externalMutation?: false;
  rawSecretMaterialStored?: false;
  rawSecretMaterialReturned?: false;
};

export type ConnectorStatusRecord = {
  accountId?: string;
  connectorId: string;
  method: string;
  category?: string;
  status: string;
  lastCheckedAt?: string;
  secretFingerprint?: string;
  permissions?: {
    calendarWrite?: boolean;
    messengerReport?: boolean;
  };
  recovery?: {
    kind: "ready" | "install_required" | "permission_required" | "credential_failed" | "connection_required";
    label: string;
    detail: string;
    actionLabel: string;
    fallbackRoutes?: string[];
    fallbackConnectorIds?: string[];
    safeNextActions?: string[];
  };
  emailAddress?: string;
  siteUrl?: string;
  siteHost?: string;
  siteLabel?: string;
  appPath?: string;
  credentialReferenceId?: string;
  credentialStorage?: "os_keychain" | "enterprise_vault" | "external_mcp_config" | "local_env_reference" | string;
  aiSecretReadable?: false;
  channelTargetId?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ConnectorStatusListResult = {
  status: string;
  connectors: ConnectorStatusRecord[];
  userMessage?: string;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

/** 메일 서버 자동 찾기 결과 — 자격정보를 담지 않습니다. */
export type MailServerDiscoveryResult = {
  status: string;
  userMessage?: string;
  email?: string;
  domain?: string;
  providerKind?: "known_provider" | "google_workspace" | "microsoft365" | "self_hosted" | "unknown";
  knownProviderId?: string;
  oauthRecommended?: boolean;
  imapHost?: string;
  imapPort?: number;
  secure?: boolean;
  matchSource?: string;
  notes?: string[];
  attempts?: Array<{ host: string; port: number; result: string }>;
  /** 자동으로 못 찾았을 때 학교·회사 IT 담당자에게 보낼 문의 문장 */
  helpRequest?: { subject: string; body: string; checklist: string[] };
  externalMutation?: boolean;
  rawSecretMaterialStored?: boolean;
};

export type ProviderOAuthPreflightItem = {
  id: "google_oauth_app" | "microsoft_oauth_app" | string;
  label: string;
  status: string;
  clientIdConfigured: boolean;
  requiredEnv: string[];
  optionalEnv: string[];
  redirectUris: string[];
  readOnlyScopes: string[];
  writeScopesRequireFinalApproval: string[];
  registrationChecklist?: string[];
  userMessage: string;
  nextStep: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ProviderOAuthPreflightResult = {
  status: "ready_for_oauth_preflight" | "desktop_required" | string;
  summary: {
    total: number;
    readyForAuthorization: number;
    missingClientId: number;
    needsAppRegistration: number;
    externalMutationAllowed: false;
    rawSecretMaterialReturned: false;
  };
  items: ProviderOAuthPreflightItem[];
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

/** 통합 메일함 한 줄. 본문 원문은 담지 않고 목록에 필요한 것만 온다. */
export type MailLedgerRow = {
  messageId: string;
  accountId: string;
  subject: string;
  from: string;
  receivedAt: string;
  preview: string;
  threadId?: string;
  rfcMessageId?: string;
  hasAttachments?: boolean;
  isRead?: boolean;
  replyCandidate?: boolean;
  scheduleCandidate?: boolean;
  /** 메일함 분류. 없으면(이전 원장) 기본함으로 본다. */
  category?: "primary" | "receipt" | "notification" | "promotion" | "social" | "spam";
  receiptCandidate?: boolean;
  labels?: string[];
};

export type MailLedgerPage = {
  status: string;
  messages: MailLedgerRow[];
  totalCount: number;
  accountIds: string[];
};

/**
 * AI가 쓴 메일 초안을 승인함 '보낼까요?' 카드로 올릴 때 넘기는 값(보내지 않음).
 * 받는 사람(to)은 사용자가 직접 적은 주소만 넘긴다. 답장이면 메시지 id 만 넘기고,
 * 원래 메일의 주소·제목은 데스크톱(main)이 찾아 카드에만 담는다.
 */
export type MailDraftStagePayload = {
  /** Existing reply edited by the user; saving never sends and invalidates prior review. */
  workItemId?: string;
  body: string;
  subject?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  replyToMessageId?: string;
  connectorId?: string;
  threadId?: string;
  taskId?: string;
  teammateId?: string;
  teammateName?: string;
};

export type MailDraftStageResult = {
  status: string;
  workItemId?: string;
  userMessage?: string;
  recipientReady?: boolean;
  replyThreaded?: boolean;
  addedCount?: number;
  updatedCount?: number;
  /** 사용자가 이미 정한 카드(보냄·보내지 않음·보류·직접 고침)는 그대로 두고 새 카드로 올렸을 때 그 카드 id. */
  keptDecidedCardId?: string;
  externalMutation?: boolean;
};

/** '고쳐 달라고 하기' 지시로 AI가 다시 쓴 답장 초안(화면용 가린 사본). */
export type MailRedraftResult = {
  status: string;
  workItemId?: string;
  draftBody?: string;
  /** 원문 기반 다시 쓰기에서 읽은 원문 종류: 이전 대화 또는 저장된 미리보기. */
  sourceMode?: "conversation" | "preview";
  userMessage?: string;
  externalMutation?: boolean;
};
/** 원문 기반 다시 쓰기: 지금 초안을 고치는 대신 원래 메일을 읽고(설치 앱 안에서) 계정의 말투·서명으로 새로 쓴다. */
export type MailRedraftOptions = { fromSource?: boolean };

/** 메일 답장 서명(명함)·말투. 기본값 + 메일 계정(연결 id)별 설정. 이 PC 앱 데이터에만 저장한다. */
export type MailWritingDefaultMode = "name" | "custom" | "none";
export type MailWritingAccountMode = "inherit" | "custom" | "none";
export type MailWritingProfile = {
  version: 2;
  defaults: { signatureMode: MailWritingDefaultMode; signature: string; tone: string };
  accounts: Record<string, { signatureMode: MailWritingAccountMode; signature: string; tone: string }>;
  updatedAt: string;
};
export type MailWritingProfilePayload =
  | { kind: "writing_profile_load" }
  | { kind: "writing_profile_save"; accountKey?: string; signatureMode: MailWritingDefaultMode | MailWritingAccountMode; signature: string; tone: string }
  | { kind: "writing_profile_learn_tone"; sample: string };
export type MailWritingProfileResult = { status: string; userMessage?: string; profile?: MailWritingProfile; tone?: string; externalMutation?: false };

export type MailWorkIntakeResult = {
  status: string;
  connectorId?: string;
  providerId?: string;
  teammateId?: string;
  teammateName?: string;
  scenarioFocus?: MailWorkScenarioFocus | null;
  /** generateDrafts opt-in 시 자동 초안 생성 요약(생성/차단 건수, 감사 메시지). */
  draftGeneration?: {
    attempted: number;
    generated: number;
    blocked: number;
    aiUnavailable: boolean;
    auditMessages: string[];
  };
  messageCount?: number;
  createdWorkItemsCount?: number;
  approvalQueueCount?: number;
  calendarBusyWindowCount?: number;
  ignoredItemsCount?: number;
  reviewItemsCount?: number;
  addedInboxItemsCount?: number;
  approvalPreviews?: MailWorkApprovalPreview[];
  review?: MailRecipientListReview;
  sourceLabel?: string;
  sourceType?: string;
  rowCount?: number;
  validRecipientCount?: number;
  readyForSampleCount?: number;
  personalizationReviewCount?: number;
  excludedCount?: number;
  duplicateCount?: number;
  missingAddressCount?: number;
  userMessage?: string;
  errorMessage?: string;
  connectionRecovery?: MailWorkConnectionRecovery | null;
  workAnalysis?: MailWorkAnalysis;
  initialLearningProfile?: MailInitialLearningProfile;
  attachmentOrganizerPlan?: MailAttachmentOrganizerPlan;
  learningStatus?: string;
  learningUserMessage?: string;
  workPatternCount?: number;
  addedWorkPatternCount?: number;
  workPatternLedgerPath?: string;
  mailWorkExecutionReceipt?: MailWorkExecutionReceipt;
  workReport?: ModyProviderWorkIntakeReport;
  auditMessages?: string[];
  activityEvent?: SelectedWorkActionEvent;
  activityAuditFile?: string;
  liveRehearsalReportPath?: string;
  liveRehearsalReportJsonPath?: string;
  liveRehearsalReportSummary?: string;
  liveRehearsalEvidenceChecklist?: string[];
  triggerRunnerEvidenceSource?: string;
  triggerRunnerTriggeredBy?: string;
  secureMailPollingRuleCount?: number;
  mailAutomationRunCount?: number;
  mailAutomationLastRunAt?: string;
  mailAutomationEvidenceWindow?: string;
  mailAutomationNotice?: string;
  mailLearningRuleEvidenceLabel?: string;
  mailLearningRuleEvidenceLabels?: string[];
  mailLearningRuleEvidenceContract?: string;
  mailLearningRuleSafePersistPolicy?: string;
  mailAutomationNotificationDraft?: MailAutomationNotificationDraft;
  mailAutomationNotificationInboxItemId?: string;
  mailAutomationNotificationInboxStatus?: string;
  readOnly?: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  appMayPersistSecret?: false;
};

export type MailLiveE2ERehearsalResult = {
  status: string;
  mode?: string;
  createdAt?: string;
  plan?: {
    status?: string;
    liveReadiness?: {
      mailConnectionReady?: boolean;
      calendarConnectionReady?: boolean;
      securePollingPrepared?: boolean;
      newMailEvidenceReady?: boolean;
      approvalCandidateReady?: boolean;
      approvalNotificationDraftReady?: boolean;
      approvalNotificationChannelReady?: boolean;
      approvalNotificationDispatchReady?: boolean;
      messengerDecisionReplyReady?: boolean;
      messengerDecisionTargetMatched?: boolean;
      messengerDecisionFinalConfirmationLocked?: boolean;
      calendarDryRunReady?: boolean;
      attachmentFolderPlanReady?: boolean;
      attachmentDownloadReviewReady?: boolean;
      attachmentLocalCopyStaged?: boolean;
      attachmentFolderApprovalCardReady?: boolean;
      attachmentOriginalPreserved?: boolean;
      webmailCredentialReferenceReady?: boolean;
      webmailBodyPreviewGateReady?: boolean;
      initialProfileLearningReady?: boolean;
      finalActionDryRunReady?: boolean;
      finalActionApprovalGateReady?: boolean;
      finalActionAdapterReady?: boolean;
      finalActionReadyAfterApproval?: boolean;
      finalSendLockedUntilApproval?: boolean;
      attachmentStagingLockedUntilApproval?: boolean;
    };
    steps?: Array<{
      id: string;
      label: string;
      title: string;
      state: string;
      evidenceLabel: string;
    }>;
    nextOperatorActions?: string[];
  };
  mailReadStatus?: string;
  messageCount?: number;
  ignoredItemsCount?: number;
  approvalQueueCount?: number;
  calendarCandidateCount?: number;
  calendarFreeBusyChecked?: boolean;
  calendarBusyWindowCount?: number;
  calendarDryRunReportPath?: string;
  finalActionDryRunReady?: boolean;
  finalActionApprovalGateReady?: boolean;
  finalActionAdapterReady?: boolean;
  finalActionReadyAfterApproval?: boolean;
  finalActionReadinessReportPath?: string;
  attachmentCandidateCount?: number;
  attachmentFolderPlanStaged?: boolean;
  stagedMailAttachmentCount?: number;
  attachmentFolderPlanPath?: string;
  attachmentDownloadReviewReady?: boolean;
  attachmentOrganizerStatus?: string;
  attachmentStagingHandoffKind?: string;
  attachmentStagingHandoffContract?: string;
  attachmentLocalCopyStaged?: boolean;
  attachmentFolderApprovalCardReady?: boolean;
  attachmentOriginalPreserved?: boolean;
  webmailDomCaptureStatus?: string;
  webmailDomExtractionStatus?: string;
  webmailDomRowCount?: number;
  webmailDomExtractedCount?: number;
  webmailCredentialReferenceCount?: number;
  webmailCredentialReferenceIds?: string[];
  webmailCredentialReferencePolicy?: string;
  webmailAiSecretReadable?: false;
  webmailBodyPreviewAllowedCount?: number;
  webmailBodyPreviewSkippedBeforeBodyCount?: number;
  securePollingRuleEnabled?: boolean;
  triggerRunnerEvidenceSource?: string;
  triggerRunnerTriggeredBy?: string;
  secureMailPollingRuleCount?: number;
  mailAutomationRunCount?: number;
  mailAutomationLastRunAt?: string;
  mailAutomationEvidenceWindow?: string;
  mailAutomationNotice?: string;
  mailLearningRuleEvidenceLabel?: string;
  mailLearningRuleEvidenceLabels?: string[];
  mailLearningRuleEvidenceContract?: string;
  mailLearningRuleSafePersistPolicy?: string;
  mailAutomationNotificationDraft?: MailAutomationNotificationDraft;
  mailAutomationNotificationInboxItemId?: string;
  mailAutomationNotificationInboxStatus?: string;
  approvalNotificationDraftReady?: boolean;
  approvalNotificationChannelReady?: boolean;
  approvalNotificationSent?: boolean;
  approvalNotificationTargetCount?: number;
  approvalNotificationTargetIds?: string[];
  approvalNotificationProviderMessageId?: string;
  approvalNotificationEvidenceSource?: string;
  approvalNotificationEventId?: string;
  messengerDecisionReplyReceived?: boolean;
  messengerDecisionTargetMatched?: boolean;
  messengerDecisionTargetCode?: string;
  messengerDecisionTargetWorkItemId?: string;
  messengerDecisionDecisionLabel?: string;
  messengerDecisionFinalConfirmationLocked?: boolean;
  messengerDecisionEvidenceSource?: string;
  messengerDecisionNotificationTargetMatched?: boolean;
  messengerDecisionMatchEvidenceSource?: string;
  messengerDecisionEventId?: string;
  manualEvidence?: {
    evidenceSource?: string;
    ignoredKeys?: string[];
  };
  manualEvidenceSecretBoundary?: {
    status?: string;
    ignoredKeys?: string[];
    policy?: string;
  };
  manualEvidenceImportPath?: string;
  manualEvidenceImportFileName?: string;
  manualEvidenceTemplatePath?: string;
  manualEvidenceTemplateCommand?: string;
  manualEvidenceGuidePath?: string;
  approvalSafetyContract?: string;
  secretHandlingContract?: string;
  liveRehearsalReportPath?: string;
  liveRehearsalReportJsonPath?: string;
  liveRehearsalReportSummary?: string;
  liveRehearsalEvidenceChecklist?: string[];
  liveRehearsalOperatorEvidence?: Array<{
    id: string;
    label: string;
    status: "ready" | "review" | "approval" | "locked";
    detail: string;
  }>;
  operatorSeedPack?: Array<{
    id: string;
    label: string;
    required: boolean;
    subject: string;
    body: string;
    expectedEvidence: string;
  }>;
  strictReadiness?: {
    status: "strict_ready" | "strict_blocked" | string;
    command: string;
    evidenceTemplatePath?: string;
    evidenceTemplateCommand?: string;
    evidenceGuidePath?: string;
    evidenceTemplateFieldContract?: string;
    evidenceTemplateFields?: Array<{
      id: string;
      label: string;
      keys: string[];
      safeValueHint?: string;
      operatorProof?: string;
    }>;
    missingRequired: string[];
    requiredEvidenceInputs: string[];
    evidenceSteps?: Array<{
      id: string;
      label: string;
      status: "ready" | "missing" | "review" | string;
      evidence: string;
      nextAction: string;
    }>;
    nextAction: string;
  };
  liveCompletion?: {
    status: "ready_for_live_operator_proof" | "needs_live_operator_evidence" | string;
    readyCount: number;
    totalCount: number;
    missingRequired: string[];
    checklist: Array<{
      id: string;
      label: string;
      required: boolean;
      status: "ready" | "review" | "missing" | string;
      evidence: string;
      nextAction: string;
    }>;
  };
  userMessage?: string;
  auditMessages?: string[];
  activityEvent?: SelectedWorkActionEvent;
  activityAuditFile?: string;
  readOnly?: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  appMayPersistSecret?: false;
  finalSendLockedUntilApproval?: true;
  attachmentStagingLockedUntilApproval?: true;
};

export type MailAttachmentDownloadResult = {
  status: string;
  providerId?: string;
  connectorId?: string;
  action?: "download_message_attachments_to_local_staging" | string;
  uid?: number;
  mailbox?: string;
  downloadRootPath?: string;
  attachmentCount: number;
  attachments?: Array<{
    id: string;
    uid?: number;
    filename: string;
    contentType?: string;
    sizeBytes?: number;
    savedPath: string;
  }>;
  files: DocumentLearningFileRecord[];
  readOnly?: true;
  readOnlyMailboxLock?: true;
  externalMutation: false;
  appMayPersistSecret?: false;
  rawSecretMaterialStored?: false;
  rawSecretMaterialReturned: false;
  rawMessageSourceReturned?: false;
  localFileWrite?: boolean;
  originalMailMutated?: false;
  userMessage?: string;
  errorMessage?: string;
  auditMessages?: string[];
};

export type MailInitialLearningProfile = {
  contract: "initial_mail_profile_learning_secret_blind" | string;
  status: "profile_ready" | "needs_more_mail" | "profile_empty" | string;
  createdAt: string;
  sourceScopes?: string[];
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  aiCredentialPolicy?: "credential_reference_id_only" | string;
  profileSummary: string;
  writingStyleProfile?: {
    toneLabel?: string;
    formatLabel?: string;
    signaturePolicy?: string;
    replyRules?: string[];
  };
  noiseFilterProfile?: {
    skippedBeforeBodyCount?: number;
    reviewMetadataOnlyCount?: number;
    bodyPreviewAllowedCount?: number;
    rules?: string[];
  };
  bulkMailProfile?: {
    status?: "review_required" | "not_detected" | string;
    targetGroups?: string[];
    excludedGroups?: string[];
    personalizationFields?: string[];
    approvalGate?: string;
  };
  scheduleProfile?: {
    status?: "observed" | "not_detected" | string;
    preferenceLabel?: string;
    rules?: string[];
  };
  approvalHabitProfile?: {
    approvalRequiredFor?: string[];
    defaultDecision?: "draft_only_until_user_approval" | string;
    finalActionLock?: "send_calendar_file_external_mutation_locked" | string;
  };
  scanDepthProfile?: {
    sampledMessageCount?: number;
    sourceScopeCount?: number;
    depthLabel?: "broad_initial_scan" | "starter_scan" | "empty_scan" | string;
    recommendedInitialScanLimit?: number;
    metadataFirst?: true;
    rawBodyStored?: false;
    nextScanGuidance?: string[];
  };
  learningMemoryPreview?: string[];
  safeToPersistKeys?: string[];
  privacyBoundary?: string;
};

export type MailAttachmentOrganizerPlan = {
  contract: "mail_attachment_download_to_local_folder_plan_approval" | string;
  status: "ready_for_download_review" | "not_detected" | string;
  createdAt: string;
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  aiCredentialPolicy?: "credential_reference_id_only" | string;
  attachmentCandidateCount?: number;
  candidateSummaries?: Array<{
    id?: string;
    subjectLabel?: string;
    receivedAt?: string;
    mailboxId?: string;
    providerId?: string;
    reasonLabels?: string[];
    targetFolderHint?: string;
    requiresDownloadReview?: true;
  }>;
  downloadPlan?: {
    credentialPolicy?: "credential_reference_id_only" | string;
    downloadRootLabel?: string;
    dedupePolicy?: string;
    allowedFilePolicy?: string;
    localCopyOnly?: true;
    originalMailMutation?: false;
    externalShareBeforeApproval?: false;
  };
  organizePlan?: {
    organizeRootLabel?: string;
    targetFolderHints?: string[];
    classificationRules?: string[];
  };
  stagingHandoff?: {
    kind?: "stage_mail_attachments_folder_plan" | string;
    contract?: "downloaded_mail_attachment_to_folder_plan_approval" | string;
    sourceKind?: "mail_attachment" | string;
    localCopyOnly?: true;
    originalMailMutation?: false;
    originalAttachmentDeleted?: false;
    externalShareBeforeApproval?: false;
    requiredBeforeStage?: string[];
  };
  approvalGate?: string;
  privacyBoundary?: string;
  auditMessages?: string[];
};

export type MobileSharedMailMessageInput = {
  id?: string;
  from?: string;
  subject?: string;
  bodyPreview?: string;
  receivedAt?: string;
  source?: "mobile_share_sheet" | "pwa_paste" | "manual_phone_forward";
  labels?: string[];
  hasAttachments?: boolean;
};

export type MobileMailShareIntakePayload = {
  connectorId?: string;
  reportChannelId?: string;
  messages: MobileSharedMailMessageInput[];
  writingProfile?: {
    toneLabel?: string;
    formatLabel?: string;
    signature?: string;
    calendarPreference?: string;
  };
};

export type MailWorkExecutionReceipt = {
  id: string;
  createdAt: string;
  workItemId: string;
  title: string;
  actionKind: string;
  decision: string;
  providerLabel: string;
  connectionLabel: string;
  scenarioIds?: string[];
  processingSteps?: string[];
  recipientDecisionDigest?: string[];
  approvalDigest?: string[];
  learningDigest?: string[];
  auditDigest?: string[];
  nextUserActions?: string[];
  dryRunId?: string;
  auditArtifactPath?: string;
  rollbackBasis: string;
  externalMutation: false;
  finalUserConfirmationRequired: true;
  rawAddressStored: false;
  rawSecretStored: false;
  rawMailBodyStored: false;
  privacyBoundary: string;
  learningPatternDraft?: {
    id?: string;
    sourceKind?: string;
    sourceLabel?: string;
    summary?: string;
    signals?: string[];
    metrics?: Record<string, string | number | boolean>;
  };
};

export type MailWorkScenarioFocus = {
  id?: string;
  label?: string;
  workGroup?: string;
  nextAction?: string;
  connectionNeed?: string;
  approvalPath?: string;
  learningMemory?: string;
  safetyGate?: string;
  primaryAction?: string;
  source?: string;
};

export type MailWorkConnectionRecovery = {
  kind: "ready" | "install_required" | "permission_required" | "credential_failed" | "connection_required" | string;
  label: string;
  detail: string;
  actionLabel: string;
  diagnosticStage?: string;
  connectorId?: string;
  fallbackRoutes?: string[];
  safeNextActions?: string[];
  errorMessage?: string;
};

export type MailWorkApprovalPreview = {
  id: string;
  workItemId?: string;
  kind: "send_email" | "create_calendar_event" | "share_file" | "draft_reply" | string;
  title: string;
  sourceLabel?: string;
  status?: string;
  countLabel?: string;
  badge?: string;
  draftBody?: string;
  summary?: string;
  timeRangeLabel?: string;
  startsAt?: string;
  endsAt?: string;
  conflictLabel?: string;
  attendeeLabels?: string[];
  reminderLabel?: string;
  finalActionLabel?: string;
  handoffLabel?: string;
  blockedReason?: string;
  preparedOutput?: string;
  verificationEvidence?: string;
  finalActionBoundary?: string;
  checklist?: string[];
  detectedIntentLabels?: string[];
  approvalCandidateLabels?: string[];
  mobileReceiveFilterIds?: Array<"approval_waiting" | "urgent_risk" | "calendar_candidate" | "follow_up" | "digest_only" | string>;
  mobileReceiveFilterLabels?: string[];
  mailWorkReview?: {
    proof?: string;
    workScenarioLabel?: string;
    actionCandidateLabel?: string;
    originalSummary?: string;
    draftSummary?: string;
    replyMethodLabel?: string;
    sendDecisionReason?: string;
    editFocusLabel?: string;
    attachmentSummary?: string;
    finalApprovalBoundary?: string;
    privacyBoundary?: string;
    mobileReceiveFilterIds?: Array<"approval_waiting" | "urgent_risk" | "calendar_candidate" | "follow_up" | "digest_only" | string>;
    mobileReceiveFilterLabels?: string[];
    reviewChecklistLabels?: string[];
    decisionReasonChips?: Array<{
      id?: string;
      label?: string;
      value?: string;
      detail?: string;
      state?: "ready" | "review" | "excluded" | "locked" | string;
    }>;
    reviewItems?: Array<{
      id?: string;
      label?: string;
      state?: "ok" | "needs_review" | "missing" | "locked" | string;
      detail?: string;
    }>;
  };
  requiresFinalUserPresence?: boolean;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type MailRecipientListReview = {
  status: "review_required" | "needs_columns" | "empty" | string;
  sourceLabel: string;
  sourceType: "csv" | "tsv" | "xlsx" | "manual" | string;
  rowCount: number;
  candidateCount: number;
  validRecipientCount: number;
  readyForSampleCount?: number;
  personalizationReviewCount?: number;
  excludedCount: number;
  duplicateCount: number;
  missingAddressCount: number;
  missingPersonalizationCount?: number;
  targetGroups?: Array<{ label: string; count: number }>;
  recommendedTargetGroups?: Array<{ label: string; count: number; reason: string }>;
  recipientDecisionMatrix?: {
    send?: Array<{ label: string; count: number; reason: string }>;
    hold?: Array<{ label: string; count: number; reason: string }>;
    exclude?: Array<{ label: string; count: number; reason: string }>;
  };
  exclusionRuleSummary?: string[];
  exclusionReasonBreakdown?: Array<{ label: string; count: number; reason: string }>;
  groupSamplePreviews?: Array<{
    groupLabel: string;
    validCount: number;
    sampleCount: number;
    readySampleCount: number;
    reviewSampleCount: number;
    personalizationKeys?: string[];
    missingPersonalizationKeys?: string[];
    riskLabels?: string[];
  }>;
  personalizationGapSummary?: string[];
  userDecisionOverride?: {
    requestedAt?: string;
    includeLabels?: string[];
    excludeLabels?: string[];
    holdLabels?: string[];
    effectiveRecipientCount?: number;
    countBasis?: string;
    summary?: string;
    approvalGate?: string;
    source?: "user_request" | "learned_suggestion" | string;
    sourceSummary?: string;
    patchSummary?: string;
    history?: Array<{
      requestedAt?: string;
      summary?: string;
      includeLabels?: string[];
      excludeLabels?: string[];
      holdLabels?: string[];
      effectiveRecipientCount?: number;
      countBasis?: string;
      source?: "user_request" | "learned_suggestion" | string;
      sourceSummary?: string;
      patchSummary?: string;
      action?: "updated" | "reset" | "held" | string;
    }>;
  };
  recipientDecisionSummary?: string;
  nextReviewFocus?: string;
  learningDecisionHints?: string[];
  learnedSendMatchLabels?: string[];
  learnedReviewCautionLabels?: string[];
  learnedIncludeOverrideLabels?: string[];
  learnedExcludeOverrideLabels?: string[];
  learnedHoldOverrideLabels?: string[];
  learnedOverrideSuggestionSummary?: string;
  learnedDefaultDecisionMatrix?: {
    send?: string[];
    hold?: string[];
    exclude?: string[];
  };
  learnedDefaultDecisionSummary?: string;
  samplePreviews?: Array<{
    id: string;
    groupLabel: string;
    personalizationKeys?: string[];
    missingPersonalizationKeys?: string[];
    riskLabels?: string[];
    status: "ready_for_sample" | "needs_review" | string;
  }>;
  dryRunSummary?: {
    wouldSendCount: number;
    wouldExcludeCount: number;
    readyForSampleCount?: number;
    personalizationReviewCount?: number;
    sampleSize: number;
    blockedReason: string;
  };
  checklist?: string[];
  approvalGate?: string;
  privacyBoundary?: string;
};

export type MailWorkAnalysis = {
  summary: string;
  workingStyle: string[];
  improvementSuggestions: string[];
  automationOpportunities: string[];
  replyToneGuidance?: string[];
  scheduleGuidance?: string[];
  connectionPreparation?: string[];
  recipientGuidance?: string[];
  sendingPlanGuidance?: string[];
  learningSignals?: string[];
  scenarioCoverage?: MailWorkScenarioCoverage[];
  connectionReadinessPlan?: MailWorkConnectionReadinessPlan;
  bulkSendPlan?: MailWorkBulkSendPlan;
  followUpPlan?: MailWorkFollowUpPlan;
  recipientSourcePlan?: MailWorkRecipientSourcePlan;
  recipientCopyPlan?: MailWorkRecipientCopyPlan;
  approvalPolicy?: string[];
  riskNotes: string[];
  stats?: {
    totalMessages?: number;
    workItems?: number;
    reviewItems?: number;
    ignoredItems?: number;
    approvalCandidates?: number;
    replyCandidates?: number;
    calendarCandidates?: number;
    attachmentSignals?: number;
    bulkMailSignals?: number;
    recipientDecisionSignals?: number;
    followUpSignals?: number;
    recipientSourceSignals?: number;
    quoteProposalSignals?: number;
    invoicePaymentSignals?: number;
    contractLegalSignals?: number;
    publicTaxSignals?: number;
    complaintEscalationSignals?: number;
    reservationOrderSignals?: number;
    complianceUnsubscribeSignals?: number;
    customerInquirySignals?: number;
    vendorProcurementSignals?: number;
    hrRecruitingSignals?: number;
    documentSubmissionSignals?: number;
    securityAccountAlertSignals?: number;
    internalCollaborationSignals?: number;
  };
  privacyBoundary?: string;
};

export type MailWorkConnectionReadinessPlan = {
  status: "review_required" | "ready_without_new_connection" | string;
  workCaseLabels?: string[];
  providerOptions?: string[];
  vaultInputs?: string[];
  twoFactorChecklist?: string[];
  permissionBoundaries?: string[];
  approvalGate?: string;
  privacyBoundary?: string;
};

export type MailWorkBulkSendPlan = {
  status: "review_required" | "not_detected" | string;
  targetGroups?: string[];
  excludedGroups?: string[];
  personalizationFields?: string[];
  sampleReviewChecklist?: string[];
  approvalGate?: string;
  privacyBoundary?: string;
};

export type MailWorkFollowUpPlan = {
  status: "review_required" | "not_detected" | string;
  waitingSignals?: string[];
  suggestedCadence?: string[];
  nextCheckLabel?: string;
  approvalGate?: string;
  privacyBoundary?: string;
};

export type MailWorkRecipientSourcePlan = {
  status: "review_required" | "not_detected" | string;
  sourceTypes?: string[];
  fileReviewChecklist?: string[];
  matchingRules?: string[];
  approvalGate?: string;
  privacyBoundary?: string;
};

export type MailWorkRecipientCopyPlan = {
  status: "review_required" | "not_detected" | string;
  sendTargetRules?: string[];
  ccReviewRules?: string[];
  bccReviewRules?: string[];
  holdReviewRules?: string[];
  approvalGate?: string;
  privacyBoundary?: string;
};

export type MailWorkScenarioCoverage = {
  id: string;
  label: string;
  purpose: string;
  userDecision: string;
  safetyGate: string;
  learningValue: string;
  status: "observed" | "ready" | "needs_setup" | string;
  evidenceCount: number;
  guidance: string;
  nextAction: string;
};

export type ApprovalNotificationResult = {
  status: string;
  pendingCount?: number;
  notificationTargetIds?: string[];
  notificationTargetCount?: number;
  decisionReplyContract?: string;
  providerId?: string;
  connectorId?: string;
  chatIdPreview?: string;
  providerMessageId?: string;
  mobileReceiveFilterIds?: string[];
  mobileReceiveFilterLabels?: string[];
  mobileReceiveFilterSummary?: string;
  mobileReceiveFilterContract?: string;
  userMessage?: string;
  auditMessages?: string[];
  externalMutation: boolean;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ChannelDecisionResult = {
  status: string;
  decision?: string;
  targetWorkItemId?: string;
  targetTitle?: string;
  targetCode?: string;
  channelDecision?: {
    channel?: string;
    decision?: string;
    decisionLabel?: string;
    decidedBy?: string;
    decidedAt?: string;
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
    mobileReceiveFilterSummary?: string;
    mobileReceiveFilterContract?: string;
    requiresAppReconfirm?: boolean;
    externalMutation?: false;
    revisionInstruction?: string;
  };
  revisionInstruction?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

type SaveAIProviderKeyPayload = {
  secret: string;
  model?: string;
  accountUid?: string;
  syncSource?: "manual_input" | "account_cloud";
  allowChatContent?: boolean;
};

/** 채팅 AI와 분리된, 이 PC 연결 메일의 TypeSafe Jev 분류 보조 설정. */
export type JevMailClassificationMode = "off" | "shadow" | "assist";

export type JevMailClassificationLastRun = {
  mode?: JevMailClassificationMode;
  model?: string;
  evaluated: number;
  failed: number;
  disagreements: number;
  applied: number;
  cacheHits: number;
  totalInputTokens: number;
  latencyMs: number;
  at?: string;
};

export type JevMailClassificationStatus = {
  status: string;
  mode?: JevMailClassificationMode;
  hasKey?: boolean;
  allowContent?: boolean;
  model?: string;
  userMessage?: string;
  lastRun?: JevMailClassificationLastRun | null;
  synthetic?: boolean;
  category?: {
    choice?: string;
    confidence?: number;
    probabilities?: Record<string, number>;
  };
  /** 0~1 사이의 회신 필요 확률. */
  needsReply?: number;
  urgency?: {
    score?: number;
    confidence?: number;
  };
  inputTokens?: number;
  latencyMs?: number;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type SaveJevMailClassificationPayload = {
  /** 빈 문자열은 기존 이 PC 키를 유지한다. 원문은 상태 결과에 포함되지 않는다. */
  secret?: string;
  mode: JevMailClassificationMode;
  allowContent: boolean;
};

type StartAIProviderOAuthOptions = {
  forceReconnect?: boolean;
  model?: string;
};

/** 구독 계정으로 쓰는 AI 의 설치·로그인 상태. API 키가 필요 없는 경로다. */
export type SubscriptionAIRuntime = {
  providerId: string;
  label: string;
  installed: boolean;
  loggedIn: boolean;
  loginHint?: string;
  userMessage?: string;
  /** 고를 수 있는 모델(구독은 '계정 기본 모델' 하나). */
  models?: Array<{ id: string; label: string; hint?: string }>;
  /** CLI 로그인 확인으로 만든 가용성(source: subscription_cli). */
  modelAvailability?: AIModelAvailability;
};

/** 내 PC 에서 찾아낸 모델 목록. 아무것도 없을 때도 왜 없는지를 담아 온다. */
export type LocalAIModelListResult = {
  status: string;
  models: Array<{ id: string; label?: string; sizeLabel?: string }>;
  baseUrl?: string;
  runtimeLabel?: string;
  userMessage?: string;
};

export type AIModelAvailability = {
  state: "available" | "unknown" | "blocked";
  source: "provider_api" | "codex_oauth" | "local_catalog" | "subscription_cli" | "none";
  checkedAt?: string;
  models: Array<{
    id: string;
    label: string;
    availability: "available" | "unknown" | "blocked";
    reason?: string;
    evidence: "catalog" | "response" | "cli_login" | "user_selected";
  }>;
  userMessage: string;
  availabilityIsNotEntitlementProof: true;
};

export type AIProviderModelListResult = {
  status: string;
  provider?: string;
  modelAvailability: AIModelAvailability;
  userMessage?: string;
};

export type AIProviderKeyStatus = {
  status: string;
  provider?: string;
  isActive?: boolean;
  modelAvailability?: AIModelAvailability;
  /** 실제 호출에 쓰일 모델 — 티어 별칭이 구체 id 로 해석된 값. */
  model?: string;
  /** 해석 전 저장값("latest"/"fast" 또는 구체 id). 선택 화면 복원에 쓴다. */
  modelPreference?: string;
  hasLocalKey?: boolean;
  keyFingerprint?: string;
  authMode?: "codex_oauth" | "api_key";
  updatedAt?: string;
  syncSource?: string;
  chatContentAllowed?: boolean;
  accountId?: string;
  email?: string;
  userMessage?: string;
  recommendedCommand?: string;
  loginUrl?: string;
  authorizationUrl?: string;
  callbackUrl?: string;
  state?: string;
  externalUrlOpened?: boolean;
  cliLoginStarted?: boolean;
  diagnosticStage?: string;
  recoveryActions?: string[];
  callbackPort?: number;
  errorMessage?: string;
  rawSecretMaterialStored?: false;
};

export type AgentRoutingReceipt = {
  contract: "agent_org_runtime_routing_v1";
  status: "routed" | "master_fallback" | "target_missing" | "target_unverified";
  method: string;
  reason: string;
  extractedKeywords: string[];
  targetTeammateId?: string;
  targetTeammateName?: string;
  roleTitle?: string;
  workPackId?: string;
  assignmentSource?: "approved_folder_learning";
  learningEvidenceCount?: number;
  learningConfidence?: number;
  learningReasons?: string[];
  externalMutation: false;
};
export type AIResponseUsage = {
  source: 'provider_response' | 'local_response' | 'unavailable';
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  cachedInputTokens: number | null; cacheWriteInputTokens: number | null; reasoningTokens: number | null;
};
export type AIUsageGroup = {
  provider: string; model: string; requests: number; succeeded: number; failed: number;
  cancelled: number; unconfirmed: number; usageReported: number; lastRecordedAt: number;
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  inputTokensRequests: number; outputTokensRequests: number; totalTokensRequests: number;
};
export type AIProviderUsageLimit = {
  provider: string; connected: boolean; status: string; source?: string; checkedAt?: number;
  credits?: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  windows: Array<{ id: string; label: string; usedPercent: number; remainingPercent: number; resetsAt: number | null; active?: boolean; accountWide?: boolean }>;
};
export type AIUsageSummaryResult = {
  providerLimits?: AIProviderUsageLimit[];
  status: string; days?: number; from?: number; checkedAt?: number; scope?: string;
  groups?: AIUsageGroup[]; unsupportedProviders?: string[];
  recordingWarning?: boolean; unreadableRecords?: number; limited?: boolean;
  remaining?: null; providerBillingTotal?: null; estimatedCost?: null;
};
export type AITextGenerationResult = {
  tokenUsage?: AIResponseUsage;
  usageRecording?: { status: string; requestId?: string };
  status: string;
  provider?: string;
  model?: string;
  outputText?: string;
  outputChars?: number;
  promptChars?: number;
  userMessage?: string;
  errorMessage?: string;
  agentRouting?: AgentRoutingReceipt;
  agentRunReceipt?: MainAgentRunReceipt;
  auditMessages?: string[];
  fallbackFrom?: string;
  fallbackReason?: string;
  fallbackAttemptFailures?: string[];
  previousFailureStatus?: string;
  runtime?: string;
  diagnosticStage?: string;
  recommendedCommand?: string;
  recoveryActions?: string[];
  cliRuntimeAttempted?: boolean;
  answerReady?: boolean;
  fallbackUsed?: boolean;
  userNextAction?: string;
  recoverySummary?: string;
  runtimeContext?: AITextRuntimeContextReceipt;
  aiRuntimeRouter?: {
    routeOrder: string[];
    attemptedRoutes: string[];
    finalRoute: string;
    failClosed: boolean;
    recoveryRequired?: boolean;
    recoveryReason?: string;
  };
  aiRuntimeReceipt?: {
    status: string;
    provider: string;
    model: string;
    runtime: string;
    answerReady: boolean;
    fallbackUsed: boolean;
    diagnosticStage: string;
    previousFailureStatus: string;
    userNextAction: string;
    recoverySummary: string;
    routeOrder?: string[];
    attemptedRoutes?: string[];
    finalRoute?: string;
    failClosed?: boolean;
    recoveryRequired?: boolean;
    recoveryReason?: string;
    recoveryPlan?: {
      kind: string;
      actionLabel: string;
      detail: string;
      choices?: string[];
    } | null;
    fallbackAttemptFailures?: Array<{
      route: string;
      status: string;
      label: string;
    }>;
    runtimeContext?: AITextRuntimeContextReceipt;
    canRetryPendingRequest: boolean;
    externalMutation: false;
    rawSecretMaterialReturned: false;
  };
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type AIRuntimeLiveProofItem = {
  id: "role_live" | "mailops_workqueue" | "release_readiness" | "setup_doctor" | string;
  label: string;
  status: string;
  mode?: string;
  provider?: string;
  model?: string;
  reportPath: string;
  answerReady: boolean;
  liveVerified: boolean;
  promptObserved?: boolean;
  contract?: string;
  workContract?: string;
  rowCount?: number;
  finalReadyCount?: number;
  runtimeTrackStatus?: string;
  liveProviderTrackStatus?: string;
  roleRuntimeTrackStatus?: string;
  mailOpsRoleWorkQueueTrackStatus?: string;
  routerSafetyTrackStatus?: string;
  liveReadyGroups?: number;
  latestLiveReports?: number;
  releaseBlockerSummary?: string;
  createdAt?: string;
  updatedAt?: string;
  reportFresh?: boolean;
  reportAgeMs?: number;
  proofExpired?: boolean;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  rawPromptStored: false;
};

export type AIRuntimeLiveProofsResult = {
  status: string;
  proofCount: number;
  verifiedCount: number;
  proofs: AIRuntimeLiveProofItem[];
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type AITextRuntimeRoleContext = {
  contract?: "role_context_to_generation_runtime_v1" | string;
  teammateId?: string;
  teammateName?: string;
  teamLabel?: string;
  roleTitle?: string;
  channelName?: string;
  brief?: string;
  skillIds?: string[];
  instructions?: string[];
  assignmentContract?: "role_assignment_runtime_v1" | string;
  assignmentSummary?: string;
  assignmentRuntimeLine?: string;
  assignmentApprovalLine?: string;
  assignmentMemoryLine?: string;
  workAutomationContract?: "role_assignment_to_work_automation_engine_v1" | string;
  workAutomationOneLineLabel?: string;
  workAutomationCandidateLabel?: string;
  workAutomationPipelineLabel?: string;
  workAutomationApprovalGateLabel?: string;
  workAutomationEvidencePath?: string;
  workAutomationConnectionGateLabel?: string;
  workAutomationConnectionRequiredIds?: string;
  workAutomationCandidateBlockedUntilConnections?: boolean;
  traceId?: string;
  traceContract?: "role_command_to_ai_runtime_receipt_to_virtual_office_event" | string;
  externalMutationAllowed?: false;
};

export type AITextRuntimeExecutionContext = {
  source?: string;
  intent?: string;
  responseMode?: string;
  approvalMode?: string;
  requestedWorkSummary?: string;
  plannedToolSequenceLabel?: string;
  approvalQueueCount?: number;
  workAutomationConnectionGateLabel?: string;
  workAutomationConnectionRequiredIds?: string;
  workAutomationCandidateBlockedUntilConnections?: boolean;
  traceId?: string;
  traceContract?: "role_command_to_ai_runtime_receipt_to_virtual_office_event" | string;
  safetyBoundary?: string;
  externalMutationAllowed?: false;
  /**
   * 업무 비서 대화에서 웹이 이미 맡길 전문가를 정한 요청(lib/expert-routing). 설치 앱은 이 표시가 있으면
   * 예전 업무팩 키워드 배정으로 다시 배정하지 않는다.
   */
  expertRouting?: { contract: "modycrew.expert.route.v1"; decision: "none" | "single" | "multiple" };
};

// Renderer fields are hints only. Main resolves the target/work pack from its
// current profile snapshot and creates the event/artifact IDs itself.
export type MainAgentRunContext = {
  artifactKind?: string;
  sourceTeammateId: string;
  targetTeammateId: string;
  workPackId:
    | "inquiry_response"
    | "schedule_coordination"
    | "report_cleanup"
    | "inventory_reorder"
    | "tax_contract_archive"
    | string;
  sourceKind?: "delegated_channel" | string;
};

export type MainAgentRunReceipt = {
  status: string;
  verified: boolean;
  authorizationId?: string;
  eventId?: string;
  runId?: string;
  artifactId?: string;
  artifactKind?: string;
  sourceTeammateId?: string;
  targetTeammateId?: string;
  workPackId?: string;
  runStatus?: "issued" | "done" | "error";
  idempotent?: boolean;
  rawSecretMaterialReturned?: false;
};

export type AITextGenerationPayload = {
  prompt: string;
  provider?: string;
  model?: string;
  roleContext?: AITextRuntimeRoleContext;
  executionContext?: AITextRuntimeExecutionContext;
  agentRunContext?: MainAgentRunContext;
  /** 스트리밍 답변에만 쓴다. 화면이 정해 두면 cancelAITextStream(streamId) 로 멈출 수 있다. */
  streamId?: string;
};

export type AITextStreamCancelResult = {
  status: "ai_text_stream_cancelled" | "ai_text_stream_not_running" | string;
  streamId?: string;
  cancelled?: boolean;
  userMessage?: string;
  externalMutation?: false;
};

export type AITextRuntimeContextReceipt = {
  contract: "role_context_to_generation_runtime_v1" | string;
  teammateId?: string;
  teammateName?: string;
  roleTitle?: string;
  channelName?: string;
  assignmentContract?: string;
  assignmentSummary?: string;
  assignmentRuntimeLine?: string;
  assignmentApprovalLine?: string;
  assignmentMemoryLine?: string;
  workAutomationContract?: string;
  workAutomationOneLineLabel?: string;
  workAutomationCandidateLabel?: string;
  workAutomationPipelineLabel?: string;
  workAutomationApprovalGateLabel?: string;
  workAutomationEvidencePath?: string;
  workAutomationConnectionGateLabel?: string;
  workAutomationConnectionRequiredIds?: string;
  workAutomationCandidateBlockedUntilConnections?: boolean;
  intent?: string;
  responseMode?: string;
  approvalMode?: string;
  requestedWorkSummary?: string;
  plannedToolSequenceLabel?: string;
  approvalQueueCount?: number;
  source?: string;
  traceId?: string;
  traceContract?: "role_command_to_ai_runtime_receipt_to_virtual_office_event" | string;
  safetyBoundary?: string;
  externalMutationAllowed: false;
};

export type ToolchainToolStatus = {
  id: string;
  label: string;
  status: "ready" | "missing" | "installed_but_unusable" | string;
  source: "path" | "bundled" | "none" | string;
  command?: string;
  detectedVersion?: string;
  purpose?: string;
  userMessage?: string;
  optional?: boolean;
  userFacingLabel?: string;
  version?: string;
  bundledWithApp?: boolean;
  bundledPath?: string;
  reason?: "timeout" | "exit_code" | "not_found" | "blocked" | "spawn_failed" | "killed" | "bundle_missing" | string;
  reasonDetail?: string;
  attempts?: number;
  durationMs?: number;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ToolchainStatusResult = {
  status: "toolchain_ready" | "toolchain_needs_prepare" | "toolchain_prepared" | "toolchain_prepare_recorded" | "desktop_required" | string;
  checkedAt?: string;
  preparedAt?: string;
  toolchainRoot?: string;
  manifestPath?: string;
  readyCount?: number;
  missingCount?: number;
  missingToolIds?: string[];
  tools: ToolchainToolStatus[];
  bundle?: { expected: boolean; bundledReadyToolIds: string[]; pcToolIds: string[]; missingFromBundleToolIds: string[]; unusableBundledToolIds: string[]; filesMissingToolIds: string[] };
  cached?: boolean;
  installPlan?: Array<{
    toolId: string;
    label: string;
    technicalLabel?: string;
    mode: string;
    userMessage: string;
    externalMutation: false;
    redistributionRequired?: boolean;
    fallbackRoute?: string;
    guidedInstall?: {
      kind: string;
      command: string;
      requiresUserApproval: true;
    };
  }>;
  embeddedRuntime?: {
    status: string;
    label: string;
    node?: string;
    electron?: string;
    chrome?: string;
    userMessage?: string;
    externalMutation: false;
  };
  userMessage?: string;
  externalMutation: false;
  globalInstallPerformed?: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type CodexRecoveryInstallResult = {
  status:
    | "codex_install_approval_required"
    | "codex_install_already_ready"
    | "codex_install_npm_missing"
    | "codex_install_completed"
    | "codex_install_failed"
    | "desktop_required"
    | string;
  installMode?: string;
  installCommand?: string;
  requiresUserApproval?: boolean;
  approvedByUser?: boolean;
  fallbackRoute?: string;
  startedAt?: string;
  finishedAt?: string;
  output?: string;
  tool?: ToolchainToolStatus;
  userMessage?: string;
  externalMutation: false;
  localMachineInstallPerformed?: boolean;
  globalInstallPerformed?: boolean;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryStatusResult = {
  status: string;
  root?: string;
  defaultRoot?: string;
  chatThreadsPath?: string;
  appProfilePath?: string;
  portableManifestPath?: string;
  crewSoulBundlePath?: string;
  crewSoulBundleSummaryPath?: string;
  crewChannelBlueprintPath?: string;
  crewChannelBlueprintSummaryPath?: string;
  decisionLedgerPath?: string;
  workPatternLedgerPath?: string;
  learningSourcesPath?: string;
  delegationArtifactLedgerPath?: string;
  crewKitIndexPath?: string;
  skillGrowthPath?: string;
  skillBridgePath?: string;
  selfGrowthContractPath?: string;
  skillSourceInventoryPath?: string;
  skillSourcesPath?: string;
  skillBootstrapPlanPath?: string;
  skillBootstrapPlanSummaryPath?: string;
  promptMemoryPath?: string;
  manifestReady?: boolean;
  crewSoulBundleReady?: boolean;
  crewChannelBlueprintReady?: boolean;
  restoreReady?: boolean;
  threadCount?: number;
  messageCount?: number;
  conversationDigestCount?: number;
  decisionCount?: number;
  workPatternCount?: number;
  workPatterns?: LocalMemoryWorkPattern[];
  learningSourceCount?: number;
  learningSources?: LocalMemoryLearningSource[];
  delegationArtifactCount?: number;
  growthSuggestionCount?: number;
  growthSuggestions?: LocalMemoryGrowthSuggestion[];
  connectorRecoveryMemoryCount?: number;
  connectorRecoveryMemories?: LocalMemoryConnectorRecoveryMemory[];
  skillSourceCount?: number;
  skillSources?: LocalMemorySkillSource[];
  skillBootstrapPlanReady?: boolean;
  skillBootstrapActiveCrewKitCount?: number;
  externalReauthorizationCount?: number;
  skillBootstrapPlan?: LocalMemorySkillBootstrapPlan | null;
  identityFileCount?: number;
  missingIdentityFileCount?: number;
  identityFiles?: LocalMemoryIdentityFile[];
  userMessage?: string;
  errorMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryLearningSource = {
  id: string;
  path: string;
  label: string;
  sourceKind: string;
  source: string;
  status: string;
  fileCount: number;
  skippedCount?: number;
  maxDepth?: number;
  maxFiles?: number;
  selectedAt: string;
  lastScannedAt: string;
  lastSummary?: string;
  externalMutation: false;
  originalFilesMoved?: false;
  originalFilesDeleted?: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryLearningSourcesResult = LocalMemoryStatusResult & {
  learningSourcesPath?: string;
  learningSources: LocalMemoryLearningSource[];
  learningSourceCount: number;
  addedLearningSourceCount?: number;
  removedLearningSourceCount?: number;
};

export type LocalMemoryGrowthSuggestion = {
  id: string;
  kind: string;
  priority: "high" | "normal" | "low" | string;
  skillId: string;
  skillLabel: string;
  title: string;
  reason: string;
  nextAction: string;
  evidencePatternIds?: string[];
  connectorIds?: string[];
  assignedTeammateIds?: string[];
  updatedAt?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryConnectorRecoveryMemory = {
  id: string;
  connectorId: string;
  recoveryKind: string;
  actionLabel: string;
  status?: string;
  method?: string;
  category?: string;
  messengerChannelId?: string;
  summary: string;
  signals: string[];
  updatedAt?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemorySkillSource = {
  id: string;
  label: string;
  sourceKind: string;
  status: string;
  category: string;
  restoreMode: string;
  assignedTeammateIds?: string[];
  connectorIds?: string[];
  externalToolHints?: string[];
  evidence?: string[];
  safetyBoundary?: string;
  updatedAt?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemorySkillBootstrapPlan = {
  schema: string;
  product?: string;
  generatedAt?: string;
  memoryManifestPath?: string;
  restoreMode?: string;
  restoreOrder?: string[];
  activeCrewKits?: Array<{
    id: string;
    label: string;
    category?: string;
    assignedTeammateIds?: string[];
    connectorIds?: string[];
    restoreAction?: string;
    safety?: string;
  }>;
  recommendationCrewKits?: Array<{
    id: string;
    label: string;
    category?: string;
    restoreAction?: string;
  }>;
  teammateChannels?: Array<{
    id: string;
    avatarId?: string;
    name: string;
    channelName: string;
    teamLabel?: string;
    roleTitle?: string;
    skillIds?: string[];
    crewSoulPath?: string;
    promptMemoryPath?: string;
  }>;
  externalReauthorization?: Array<{
    skillId: string;
    label: string;
    connectorIds?: string[];
    externalToolHints?: string[];
    requiredUserStep?: string;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  }>;
  counts?: {
    activeCrewKits?: number;
    recommendationCrewKits?: number;
    teammateChannels?: number;
    externalReauthorization?: number;
    manifestSkillSources?: number;
  };
  safety?: string[];
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryIdentityFile = {
  label: string;
  kind: string;
  relativePath: string;
  state: "ready" | "missing" | string;
  detail?: string;
  teammateId?: string;
  rawSecretMaterialStored?: false;
  rawSecretMaterialReturned?: false;
};

/** 알림을 눌렀을 때 main 이 "이 카드로 옮겨 달라"고 보내는 요청. */
export type DesktopWorkItemFocusPayload = {
  workItemId: string;
  queue: string;
  /** "task" = 업무판의 맡긴 업무. 오래된 preload 는 이 값을 보내지 않는다. */
  kind?: string;
};

/** 승인함(인박스)이 바뀌었다는 신호. 확인을 기다리는 카드 수를 함께 싣는다. */
export type DesktopInboxAttention = {
  revision: number;
  pendingApprovalCount: number;
  /** 메일 원장이 바뀐 경우에만 실린다(자동 최신화·수동 가져오기). */
  mailLedger?: { at: string; addedCount: number; totalCount: number; reason: string; addedInboxItemsCount: number };
};

export function normalizeDesktopInboxAttention(value: unknown): DesktopInboxAttention {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const whole = (input: unknown) => {
    const number = Number(input);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };
  const ledger = record.mailLedger && typeof record.mailLedger === "object" ? (record.mailLedger as Record<string, unknown>) : null;
  return {
    revision: whole(record.revision),
    pendingApprovalCount: whole(record.pendingApprovalCount),
    ...(ledger
      ? { mailLedger: { at: String(ledger.at ?? ""), addedCount: whole(ledger.addedCount), totalCount: whole(ledger.totalCount), reason: String(ledger.reason ?? ""), addedInboxItemsCount: whole(ledger.addedInboxItemsCount) } }
      : {}),
  };
}

export type WorkspaceWindowResult = {
  status:
    | "workspace_window_opened"
    | "workspace_window_focused"
    | "worker_companion_window_opened"
    | "worker_companion_window_focused"
    | "main_window_focused"
    | "desktop_required"
    | string;
  target?: "office" | "workers" | string;
  userMessage?: string;
  displayMode?: "desktop_overlay" | "app_preview" | string;
  route?: string;
  surfaceLabel?: string;
  currentWindow?: "work_status_not_settings" | string;
  visibleWork?: "base_custom_current_work_approval_lock" | string;
  hiddenWork?: "size_position_character_settings_until_support_open" | string;
  finalBoundary?: "approval_before_external_mutation" | string;
  userLanguage?: "working_view_not_small_window_label" | string;
  stateContract?: "current_work_status_approval_lock" | string;
  sizePreset?: "compact" | "standard" | "large" | string;
  positionPreset?: "bottom_right" | "top_right" | "left_dock" | string;
  motionStyle?: "calm" | "lively" | string;
  avatarMode?: "base" | "custom" | string;
  alwaysOnTop?: boolean;
  skipTaskbar?: boolean;
  visibleOnAllWorkspaces?: boolean;
  resizable?: boolean;
  maximizable?: boolean;
  bounds?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type WorkerCompanionWindowOpenOptions = {
  sizePreset?: "compact" | "standard" | "large" | string;
  positionPreset?: "bottom_right" | "top_right" | "left_dock" | string;
  motionStyle?: "calm" | "lively" | string;
  avatarMode?: "base" | "custom" | string;
};

export type ReleaseFieldGuideOpenResult = {
  status:
    | "release_field_guide_opened"
    | "release_field_guide_missing"
    | "release_field_guide_shell_unavailable"
    | "release_field_guide_open_failed"
    | "desktop_required"
    | string;
  path?: string;
  openError?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type FirstUserObservationKitTarget = "scorecard" | "command_template" | "checklist";

export type FirstUserObservationKitOpenResult = {
  status:
    | "first_user_observation_kit_opened"
    | "first_user_observation_kit_missing"
    | "first_user_observation_kit_shell_unavailable"
    | "first_user_observation_kit_open_failed"
    | "desktop_required"
    | string;
  target?: FirstUserObservationKitTarget | string;
  path?: string;
  openError?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ReleaseAIRuntimeLiveKitTarget = "template" | "checklist";

export type ReleaseAIRuntimeLiveKitOpenResult = {
  status:
    | "release_ai_runtime_live_kit_opened"
    | "release_ai_runtime_live_kit_missing"
    | "release_ai_runtime_live_kit_shell_unavailable"
    | "release_ai_runtime_live_kit_open_failed"
    | "desktop_required"
    | string;
  target?: ReleaseAIRuntimeLiveKitTarget | string;
  path?: string;
  openError?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ReleaseLiveSmokeKitTarget = "template" | "checklist" | "scorecard" | "unblock_report";

export type ReleaseLiveSmokeKitOpenResult = {
  status:
    | "release_live_smoke_kit_opened"
    | "release_live_smoke_kit_missing"
    | "release_live_smoke_kit_shell_unavailable"
    | "release_live_smoke_kit_open_failed"
    | "desktop_required"
    | string;
  target?: ReleaseLiveSmokeKitTarget | string;
  path?: string;
  openError?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ReleaseOperatorRunnerKitTarget = "runner" | "guide" | "run_report" | "run_summary";

export type ReleaseOperatorRunnerKitOpenResult = {
  status:
    | "release_operator_runner_kit_opened"
    | "release_operator_runner_kit_missing"
    | "release_operator_runner_kit_shell_unavailable"
    | "release_operator_runner_kit_open_failed"
    | "desktop_required"
    | string;
  target?: ReleaseOperatorRunnerKitTarget | string;
  path?: string;
  openError?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ReleaseUnblockKitTarget =
  | "guide"
  | "runner"
  | "manifest"
  | "status"
  | "ai_report"
  | "live_report"
  | "observation_report";

export type ReleaseUnblockKitOpenResult = {
  status:
    | "release_unblock_kit_opened"
    | "release_unblock_kit_missing"
    | "release_unblock_kit_shell_unavailable"
    | "release_unblock_kit_open_failed"
    | "desktop_required"
    | string;
  target?: ReleaseUnblockKitTarget | string;
  path?: string;
  openError?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryChatThreadsResult<TThread = unknown> = LocalMemoryStatusResult & {
  threads: TThread[];
  chatRootScopeVersion?: 1;
};

export type LocalMemoryAppProfile = {
  version?: number;
  updatedAt?: string;
  teammates?: unknown[];
  skills?: unknown[];
  activeSkillIds?: string[];
  messengerChannels?: unknown[];
  activeMessengerChannelIds?: string[];
  appSettings?: {
    activeTeammateId?: string;
    theme?: string;
    assistantDisplayName?: string;
    userDisplayName?: string;
    userCallName?: string;
    mainControllerId?: string;
    mainControllerName?: string;
    mainControllerChannelName?: string;
  };
};

export type LocalMemoryAppProfileResult = LocalMemoryStatusResult & {
  appProfilePath?: string;
  profile?: LocalMemoryAppProfile | null;
  portableManifest?: LocalMemoryPortableManifest | null;
  crewSoulBundle?: LocalMemoryCrewSoulBundle | null;
  skillBootstrapPlan?: LocalMemorySkillBootstrapPlan | null;
};

export type LocalMemoryCrewSoulBundle = {
  schema?: string;
  product?: string;
  generatedAt?: string;
  purpose?: string;
  restoreMode?: string;
  restoreOrder?: string[];
  appSettings?: {
    activeTeammateId?: string;
    theme?: string;
    assistantDisplayName?: string;
    userDisplayName?: string;
    userCallName?: string;
    mainControllerId?: string;
    mainControllerName?: string;
    mainControllerChannelName?: string;
  };
  teammateChannels?: Array<{
    id: string;
    templateId?: string;
    avatarId?: string;
    name: string;
    teamLabel?: string;
    roleTitle?: string;
    channelName?: string;
    brief?: string;
    skillIds?: string[];
    activeSkillIds?: string[];
    instructions?: string[];
    memoryPaths?: {
      crewSoul?: string;
      promptMemory?: string;
      decisionLog?: string;
      workLog?: string;
    };
    recentWork?: Array<{
      id: string;
      sourceKind?: string;
      label?: string;
      summary?: string;
      learnedAt?: string;
      artifactPaths?: string[];
    }>;
    recentDecisions?: Array<{
      id: string;
      decision?: string;
      summary?: string;
      decidedAt?: string;
    }>;
    restoreRule?: string;
  }>;
  activeCrewKits?: Array<{
    id: string;
    label?: string;
    category?: string;
    connectorIds?: string[];
    assignedTeammateIds?: string[];
    restoreAction?: string;
  }>;
  skillRecommendations?: Array<{
    id: string;
    label?: string;
    recommendedTeam?: string;
    triggerKeywords?: string[];
    restoreAction?: string;
  }>;
  messengerChannels?: Array<{
    id: string;
    label?: string;
    provider?: string;
    restoreAction?: string;
  }>;
  restorePaths?: Record<string, string>;
  counts?: {
    teammates?: number;
    activeCrewKits?: number;
    recommendations?: number;
    messengerChannels?: number;
    manifestIdentityFiles?: number;
  };
  safety?: string[];
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryPortableManifest = {
  schema?: string;
  portableMemory?: boolean;
  product?: string;
  version?: number;
  updatedAt?: string;
  restore?: {
    profilePath?: string;
    chatThreadsPath?: string;
    crewSoulBundlePath?: string;
    crewSoulBundleSummaryPath?: string;
    crewSoulPath?: string;
    crewChannelIndexPath?: string;
    crewChannelBlueprintPath?: string;
    crewChannelBlueprintSummaryPath?: string;
    crewKitIndexPath?: string;
    growthLedgerPath?: string;
    skillGrowthPath?: string;
    skillBridgePath?: string;
    selfGrowthContractPath?: string;
    skillSourceInventoryPath?: string;
    skillSourcesPath?: string;
    skillBootstrapPlanPath?: string;
    skillBootstrapPlanSummaryPath?: string;
    decisionLedgerPath?: string;
    workPatternLedgerPath?: string;
    delegationArtifactLedgerPath?: string;
    delegationApprovalDecisionLedgerPath?: string;
    delegationActionQueueLedgerPath?: string;
    conversationDigestPath?: string;
    promptMemoryPath?: string;
    identityFiles?: LocalMemoryIdentityFile[];
  };
  counts?: {
    teammates?: number;
    skills?: number;
    activeSkills?: number;
    messengerChannels?: number;
    crewKits?: number;
    workDecisions?: number;
    workPatterns?: number;
    delegationArtifacts?: number;
    delegationApprovalDecisions?: number;
    delegationActionQueue?: number;
    conversationDigests?: number;
    growthSuggestions?: number;
    connectorRecoveryMemories?: number;
    skillSources?: number;
    skillBootstrapPlans?: number;
    crewSoulBundles?: number;
    promptMemories?: number;
    identityFiles?: number;
  };
  safety?: string[];
};

export type LocalMemoryPortableInspectionResult = LocalMemoryStatusResult & {
  portableManifest?: LocalMemoryPortableManifest | null;
  restoreChecklist?: Array<{
    id: string;
    label: string;
    state: "ready" | "missing" | "optional" | string;
    detail: string;
  }>;
  teammateCount?: number;
  activeSkillCount?: number;
  crewKitCount?: number;
  activeCrewKitCount?: number;
  decisionCount?: number;
  delegationApprovalDecisionCount?: number;
  delegationActionQueueCount?: number;
  growthSuggestions?: LocalMemoryGrowthSuggestion[];
  delegationArtifacts?: LocalMemoryDelegationArtifactRecord[];
};

export type LocalMemoryWorkspaceSkillCatalogItem = {
  skillId: string;
  title: string;
  version: string;
  publisher: string;
  sourceUrl: string;
  license: string;
  integritySha256: string;
  trust: "verified_catalog" | "publisher_signed" | "unverified" | string;
  installMode: "portable_user_space" | string;
  supportedWorkPackIds: string[];
  requestedCapabilities: string[];
  requestedNetworkHosts: string[];
  requestedFolderScope: "selected_workspace_only" | "none" | string;
};

export type LocalMemoryWorkspaceSkillProposal = {
  id: string;
  skill: LocalMemoryWorkspaceSkillCatalogItem;
  relatedWorkPackIds: string[];
  evidenceCount: number;
  reason: string;
  status: "approval_required" | "blocked_untrusted_source" | string;
  blockedReason?: string;
  userQuestion: string;
  requiresUserApprovalBeforeDownload: true;
  downloadStarted: false;
  installed: false;
  activated: false;
  activationRequiresSeparateUserAction: true;
};

export type LocalMemoryWorkspaceSkillLifecycleRecord = {
  workspaceId: string;
  proposalId: string;
  proposal: LocalMemoryWorkspaceSkillProposal;
  requestFingerprint: string;
  eligibleAgentIds: string[];
  proposedAt: string;
  lastProposedAt: string;
  status: string;
  catalogConflict?: boolean;
  activeTargetAgentId?: string;
  lastInstallFailure?: string;
};

export type LocalMemoryWorkspaceSkillLifecycleResult = {
  status: string;
  workspaceId: string;
  records: LocalMemoryWorkspaceSkillLifecycleRecord[];
  statePath?: string;
  summaryPath?: string;
  recoveryRequired?: boolean;
  writeBlocked?: boolean;
  userMessage: string;
  externalMutation?: false;
};

export type LocalMemoryWorkspaceSkillDecisionResult = {
  status: string;
  workspaceId?: string;
  proposalId?: string;
  skillId?: string;
  downloadStarted?: boolean;
  installed?: boolean;
  activated?: boolean;
  activationRequiresSeparateUserAction?: boolean;
  reconciliationRequired?: boolean;
  consentStatus?: string;
  userMessage: string;
  externalMutation?: boolean;
};
export type LocalMemoryWorkDecisionInput = Pick<
  WorkItem,
  "id" | "title" | "sourceLabel" | "status" | "receivedAt" | "channelDecision"
> & {
  teammateId?: string;
  teammateName?: string;
};

export type LocalMemoryWorkDecisionResult = LocalMemoryStatusResult & {
  decisionLedgerPath?: string;
  decisionCount?: number;
  addedDecisionCount?: number;
};

export type LocalMemoryWorkLearningSourceKind =
  | "mailops"
  | "connector_recovery"
  | "document_learning"
  | "folder_plan"
  | "document_writer"
  | "desktop_control"
  | "channel_delegation"
  | "crewkit_activation"
  | "teammate_memory_update"
  | "teammate_decision_log"
  | "general";

export type LocalMemoryWorkLearningInput = {
  id?: string;
  sourceKind: LocalMemoryWorkLearningSourceKind;
  sourceLabel?: string;
  learnedAt?: string;
  teammateId?: string;
  teammateName?: string;
  summary?: string;
  signals?: string[];
  artifactPaths?: string[];
  metrics?: Record<string, string | number | boolean | undefined>;
};

export type LocalMemoryWorkPattern = Required<Pick<LocalMemoryWorkLearningInput, "id" | "sourceKind" | "sourceLabel" | "learnedAt" | "summary">> &
  Pick<LocalMemoryWorkLearningInput, "teammateId" | "teammateName" | "signals" | "artifactPaths" | "metrics"> & {
    externalMutation: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  };

export type LocalMemoryWorkLearningResult = LocalMemoryStatusResult & {
  workPatternLedgerPath?: string;
  workPatternCount?: number;
  addedWorkPatternCount?: number;
  updatedWorkPatternId?: string;
  removedWorkPatternCount?: number;
  workPatterns?: LocalMemoryWorkPattern[];
};

export type LocalMemoryPromptContextResult = LocalMemoryStatusResult & {
  teammateId?: string;
  sectionCount?: number;
  context?: string;
  contextChars?: number;
};

/** 배운 것 한 줄. 도메인 ModyLesson 과 같은 모양이다. */
export type LearningLesson = {
  id: string;
  kind: "preference" | "fact" | "procedure" | "role";
  scope: "teammate" | "office";
  teammateId: string;
  title: string;
  content: string;
  path: string;
  /** 무엇을 보고 배웠는지. 이게 없으면 저장되지 않는다. */
  evidence: string;
  source: "user" | "observed";
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type LearningLessonEdit = {
  action: "create" | "update" | "delete";
  kind: LearningLesson["kind"];
  scope: LearningLesson["scope"];
  teammateId?: string;
  id?: string;
  title?: string;
  content?: string;
  path?: string;
  evidence?: string;
  source?: LearningLesson["source"];
};

/** 적용 결과. before 를 들고 있어 이 값 하나가 되돌리기 기록이 된다. */
export type AppliedLearningLessonEdit = LearningLessonEdit & {
  id: string;
  before?: LearningLesson;
  after?: LearningLesson;
  applied: boolean;
  error?: string;
};

/**
 * 확인을 기다리는 배움. 앞으로 일하는 방식이 달라지는 것은 바로 적지 않고 물어본다.
 * 승인해야 비로소 장부에 적히고, 그때부터 되돌릴 수 있다.
 */
export type LearningProposal = {
  id: string;
  proposedAt: string;
  /** 왜 물어보는지. 이게 없으면 사용자도 판단할 수 없다. */
  reason: string;
  edit: LearningLessonEdit;
};

/** 업무 카드. 도메인 ModyTask 와 같은 모양이다. */
export type TaskLedgerHumanQuestion = {
  question: string;
  answer?: string;
  askedAt: string;
  answeredAt?: string;
  dismissedAt?: string;
};

export type TaskLedgerTask = {
  id: string;
  title: string;
  description?: string;
  assigneeId?: string;
  assigneeName?: string;
  status: "todo" | "doing" | "blocked" | "done";
  dependsOn: string[];
  priority: number;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  humanQA?: TaskLedgerHumanQuestion[];
  result?: string;
  /** startedAt: 설치 앱이 실행을 시작한 시각(task-execution-handler). 대화의 'N분 N초 동안 작업 중'에 쓴다. */
  execution?: { state: string; dueAt: string; repeat: string; error?: string; startedAt?: string; lastCompletedAt?: string; sourceThreadId?: string; sourceEventId?: string; approvalCardId?: string };
  origin?:
    | { kind: "manual" }
    | { kind: "chat"; threadId?: string }
    | { kind: "mail"; messageId: string; threadId?: string; from?: string }
    | { kind: "calendar"; eventId: string }
    | { kind: "trigger"; triggerId: string };
};

export type TaskLedgerDraft = Partial<TaskLedgerTask> & { id: string; title: string };

export type TaskExecutionInput = {
  origin?: { kind: "chat"; threadId: string } | { kind: "mail"; messageId: string };
  sourceThreadId?: string;
  sourceEventId?: string;
  taskId?: string;
  title?: string;
  requestText?: string;
  basePrompt?: string;
  assigneeId?: string;
  assigneeName?: string;
  generation?: AITextGenerationPayload;
  scheduledFor?: string;
  repeat?: "none" | "daily" | "weekly";
  waitForResult?: boolean;
};
export type TaskExecutionResult = TaskLedgerResult & {
  origin?: TaskLedgerTask["origin"];
  sourceThreadId?: string;
  taskId?: string;
  outputText?: string;
  question?: string;
  errorMessage?: string;
  agentRunReceipt?: MainAgentRunReceipt;
  usedToolIds?: string[];
  observations?: Array<{ toolId: string; summary: string }>;
  approvalRequests?: Array<{ toolId: string; label: string; args: Record<string, unknown>; reason: string }>;
  iterations?: number;
};

export type TaskLedgerResult = {
  status: string;
  root?: string;
  tasks?: TaskLedgerTask[];
  openCount?: number;
  blockedCount?: number;
  createdCount?: number;
  userMessage?: string;
  externalMutation?: boolean;
};

export type LocalMemoryLearningLessonsResult = {
  status: string;
  root?: string;
  teammateId?: string;
  lessons?: LearningLesson[];
  proposals?: LearningProposal[];
  proposedCount?: number;
  applied?: AppliedLearningLessonEdit[];
  appliedCount?: number;
  undoneCount?: number;
  totalCount?: number;
  userMessage?: string;
  externalMutation?: boolean;
};

/** 배경 정리 한 건. 창을 닫아 둔 사이에 AI 가 훑어 정리해 둔 것. */
export type BackgroundDigestEntry = {
  id: string;
  createdAt: string;
  text: string;
  newWorkItemCount?: number;
  pendingApprovalCount?: number;
};

export type BackgroundDigestStatusResult = {
  status: string;
  enabled?: boolean;
  maxRunsPerDay?: number;
  minIntervalMinutes?: number;
  runsToday?: number;
  consecutiveFailures?: number;
  lastRunAt?: string;
  digests?: BackgroundDigestEntry[];
  digestText?: string;
  skipReason?: string;
  userMessage?: string;
  externalMutation?: boolean;
};

export type LocalMemoryDelegationArtifactKind = "report" | "mail" | "approval";
export type LocalMemoryDelegationApprovalDecision =
  | "approved"
  | "change_requested"
  | "held"
  | "rejected";

export type LocalMemoryDelegationArtifactInput = {
  artifactId?: string;
  artifactKind: LocalMemoryDelegationArtifactKind;
  title?: string;
  body: string;
  requestText?: string;
  sourceThreadId?: string;
  sourceTeammateId?: string;
  teammateName?: string;
  createdAt?: string;
  rows?: Array<{
    teammateId?: string;
    teammateName?: string;
    channelName?: string;
    status?: string;
    summary?: string;
    mergedText?: string;
    outputPreview?: string;
    detail?: string;
  }>;
  metrics?: Record<string, string | number | boolean | undefined>;
};

export type LocalMemoryDelegationArtifactResult = LocalMemoryStatusResult & {
  artifactId?: string;
  artifactKind?: LocalMemoryDelegationArtifactKind | string;
  fileName?: string;
  relativePath?: string;
  filePath?: string;
  metadataPath?: string;
  ledgerPath?: string;
  artifactCount?: number;
};

export type LocalMemoryDelegationArtifactRecord = {
  id: string;
  artifactKind: LocalMemoryDelegationArtifactKind | string;
  title: string;
  requestText?: string;
  sourceThreadId?: string;
  sourceTeammateId?: string;
  teammateName?: string;
  createdAt: string;
  relativePath: string;
  folderPath?: string;
  approvalDecision?: LocalMemoryDelegationApprovalDecision | string;
  approvalStatus?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  nextActionKind?: string;
  nextActionStatus?: string;
  nextActionLabel?: string;
  nextActionQueuePath?: string;
  rows?: Array<{
    teammateId?: string;
    teammateName?: string;
    channelName?: string;
    status?: string;
    summary?: string;
  }>;
  metrics?: Record<string, string | number | boolean | undefined>;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryDelegationArtifactDecisionInput = {
  artifactId: string;
  decision: LocalMemoryDelegationApprovalDecision;
  decidedBy?: string;
  note?: string;
  revisionInstruction?: string;
};

export type LocalMemoryDelegationActionQueueRecord = {
  id: string;
  artifactId: string;
  artifactKind?: string;
  artifactTitle?: string;
  actionKind: string;
  status: string;
  label: string;
  createdAt: string;
  decisionId?: string;
  decision?: string;
  note?: string;
  relativePath?: string;
  sourceTeammateId?: string;
  teammateName?: string;
  sourceThreadId?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type LocalMemoryDelegationArtifactDecisionResult = LocalMemoryStatusResult & {
  artifactId?: string;
  decision?: LocalMemoryDelegationApprovalDecision | string;
  approvalStatus?: string;
  decisionLedgerPath?: string;
  globalDecisionLedgerPath?: string;
  decisionCount?: number;
  decisionMemoryCount?: number;
  queueCount?: number;
  artifact?: LocalMemoryDelegationArtifactRecord;
  queuedAction?: LocalMemoryDelegationActionQueueRecord;
};

export type LocalMemoryHomeApprovalDecisionReceiptInput = {
  receipt: HomeApprovalDecisionReceipt;
  teammateId?: string;
  teammateName?: string;
  sourceThreadId?: string;
};

export type LocalMemoryHomeApprovalDecisionReceiptResult = LocalMemoryStatusResult & {
  receipts?: HomeApprovalDecisionReceipt[];
  receiptCount?: number;
  receiptLedgerPath?: string;
  receiptSummaryPath?: string;
  decisionMemoryCount?: number;
};

export type DelegationQueueStageResult = LocalMemoryStatusResult & {
  addedCount?: number;
  updatedCount?: number;
  totalInboxItems?: number;
  stagedWorkItem?: WorkItem;
};

export type LocalMemoryDelegationArtifactListResult = LocalMemoryStatusResult & {
  ledgerPath?: string;
  artifacts: LocalMemoryDelegationArtifactRecord[];
  artifactCount?: number;
};

export type LocalMemoryDelegationArtifactOpenResult = LocalMemoryStatusResult & {
  artifactId?: string;
  artifactKind?: LocalMemoryDelegationArtifactKind | string;
  relativePath?: string;
  filePath?: string;
  errorMessage?: string;
};

export type LocalMemoryFileOpenResult = LocalMemoryStatusResult & {
  relativePath?: string;
  filePath?: string;
  errorMessage?: string;
};

type PublicTriggerRelayStatus = {
  status: string;
  route?: {
    routeId: string;
    workspaceLabel: string;
    personalMode: boolean;
    endpointPath: string;
    deliveryMode: "desktop_pull";
    allowedAdapters: string[];
    deferredAdapters: Array<{
      adapterId: string;
      availability: "provider_verification_needed";
      reason: string;
    }>;
    secretFingerprint: string;
    desktopPullTokenFingerprint: string;
    setupSummary: string;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  };
  queuedEventCount?: number;
  latestPull?: {
    status: string;
    pulledAt: string;
    eventsReturned: number;
    eventsDispatched: number;
  } | null;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type DesktopControlCapabilityId =
  | "read_screen"
  | "list_windows"
  | "open_url"
  | "stage_browser_work_item"
  | "read_webmail_metadata"
  | "plan_browser_actions"
  | "stage_browser_action_candidate"
  | "attach_browser_screen_evidence"
  | "match_browser_target_element"
  | "prepare_browser_limited_execution"
  | "confirm_browser_limited_execution"
  | "request_browser_limited_execution"
  | "verify_browser_limited_execution_result"
  | "open_local_file"
  | "list_recent_files"
  | "choose_local_file"
  | "stage_file_work_item"
  | "analyze_local_file"
  | "draft_from_local_file"
  | "click"
  | "type_text"
  | "send_hotkey"
  | "browser_automation"
  | "write_local_file";

export type DesktopControlCapabilityRecord = {
  id: DesktopControlCapabilityId;
  label: string;
  risk: "low" | "medium" | "high";
  enabled: boolean;
  granted: boolean;
  externalMutation: boolean;
  safetyBoundary: string;
};

export type DesktopControlStatusResult = {
  status: "desktop_control_ready" | "desktop_required" | "desktop_control_disabled";
  mode: "simulated_only" | "native_os_read_only" | "native_os_disabled" | "desktop_required";
  capabilities: DesktopControlCapabilityRecord[];
  userMessage: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type DesktopControlActionPayload = {
  capability: DesktopControlCapabilityId;
  featureEnabled: boolean;
  target?: string;
  instruction?: string;
  workItemId?: string;
  browserActionId?: string;
  outputKind?: "report" | "reply" | "table";
  webmailFallback?: {
    connectorId?: string;
    providerLabel?: string;
    loginUrl?: string;
    accountReferenceId?: string;
    passwordReferenceId?: string;
    browserSessionReferenceId?: string;
    twoFactorMode?: string;
    cadenceMinutes?: number;
    mailboxLabel?: string;
    reportChannelId?: string;
    writingProfile?: {
      toneLabel?: string;
      formatLabel?: string;
      calendarPreference?: string;
      signature?: string;
    };
  };
  webmailMessages?: Array<{
    id?: string;
    messageId?: string;
    from?: string;
    senderPreview?: string;
    subject?: string;
    receivedAt?: string;
    threadId?: string;
    labels?: string[];
    hasAttachments?: boolean;
    snippet?: string;
    metadataSnippet?: string;
  }>;
  webmailDomRows?: Array<{
    id?: string;
    rowId?: string;
    role?: string;
    ariaLabel?: string;
    text?: string;
    textContent?: string;
    cells?: string[];
    hrefs?: string[];
    timeText?: string;
    labels?: string[];
    hasAttachmentIcon?: boolean;
    unread?: boolean;
  }>;
};

export type DesktopControlConfirmation = {
  confirmationId: string;
  capability: DesktopControlCapabilityId;
  target: string;
  label: string;
  expiresAt: string;
  safetyBoundary: string;
};

export type DesktopControlConfirmPayload = {
  confirmationId: string;
  approved: boolean;
};

export type DesktopControlDispatchResult = {
  status:
    | "read_completed"
    | "simulated_completed"
    | "needs_user_confirmation"
    | "confirmed_opened"
    | "browser_work_item_staged"
    | "webmail_metadata_work_ready"
    | "webmail_metadata_quiet"
    | "webmail_metadata_read_blocked"
    | "browser_actions_planned"
    | "browser_action_confirmation_staged"
    | "browser_screen_evidence_attached"
    | "browser_target_element_matched"
    | "target_element_match_blocked"
    | "browser_limited_execution_prepared"
    | "limited_execution_gate_blocked"
    | "browser_limited_execution_confirmed_adapter_locked"
    | "browser_limited_execution_adapter_blocked"
    | "browser_limited_execution_executed"
    | "browser_limited_execution_result_verified"
    | "browser_limited_execution_result_needs_review"
    | "browser_limited_execution_result_verification_blocked"
    | "limited_execution_confirmation_required"
    | "screen_evidence_capture_failed"
    | "work_item_staged"
    | "file_analyzed"
    | "output_drafted"
    | "confirmation_expired"
    | "confirmation_rejected"
    | "target_invalid"
    | "needs_approval"
    | "capability_missing"
    | "desktop_required"
    | "desktop_control_disabled"
    | "blocked";
  capability: DesktopControlCapabilityId;
  userMessage: string;
  sideEffect: "simulated_only" | "read_only" | "external_open" | "clipboard_write" | "dry_run" | "none";
  observedAt?: string;
  observedWindows?: Array<{
    processId: number;
    processName: string;
    title: string;
  }>;
  observedFiles?: Array<{
    path: string;
    name: string;
    folder: string;
    extension: string;
    modifiedAt: string;
    sizeLabel: string;
    score: number;
    matchReason: string;
    rankedByIntent: boolean;
  }>;
  confirmation?: DesktopControlConfirmation;
  openedTarget?: string;
  stagedWorkItem?: WorkItem;
  messageCount?: number;
  createdWorkItemsCount?: number;
  approvalQueueCount?: number;
  ignoredItemsCount?: number;
  reviewItemsCount?: number;
  webmailPlan?: {
    status: string;
    connectorId: string;
    providerLabel: string;
    loginUrl: string;
    mailboxLabel: string;
    cadenceMinutes: number;
    nextUserAction: string;
    canRunWithoutUserPresence: boolean;
    credentialReferenceCount: number;
    browserAutomationContract: string;
    secureIntakeContract: string;
    readOnly: true;
    externalMutation: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
    appMayPersistSecret: false;
    aiMayReadSecret: false;
  };
  webmailDomCaptureProfile?: {
    profileId: string;
    hostKind: string;
    providerLabel: string;
    mailboxLabel: string;
    semanticRowTargets: string[];
    requiredVisibleSignals: string[];
    blockedStateHints: string[];
    nextUserAction: string;
    maxRows: number;
    readOnly: true;
    externalMutation: false;
    rawSelectorStored: false;
    rawPageHtmlStored: false;
    rawBodyStored: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  } | null;
  webmailDomRecoveryGuide?: {
    status: string;
    reasonLabel: string;
    nextUserAction: string;
    checklist: string[];
    readOnly: true;
    externalMutation: false;
    rawSelectorStored: false;
    rawPageHtmlStored: false;
    rawBodyStored: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  } | null;
  webmailDomCapture?: {
    status: string;
    capturedAt: string;
    sourceKind: string;
    sourceLabel: string;
    rowCount: number;
    matchReason: string;
    readOnly: true;
    externalMutation: false;
    rawPageHtmlStored: false;
    rawBodyStored: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  } | null;
  webmailDomExtraction?: {
    status: string;
    extractionContract: string;
    bodyPreviewPolicy?: string;
    rowCount: number;
    extractedCount: number;
    skippedCount: number;
    bodyPreviewAllowedCount?: number;
    bodyPreviewSkippedBeforeBodyCount?: number;
    bodyPreviewMaxChars?: number;
    readOnly: true;
    externalMutation: false;
    rawPageHtmlStored: false;
    rawBodyStored: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  } | null;
  workReport?: ModyProviderWorkIntakeReport;
  bodyPreviewAllowedCount?: number;
  bodyPreviewSkippedBeforeBodyCount?: number;
  webmailBodyPreviewPolicy?: string;
  webmailBodyPreviewMaxChars?: number;
  auditMessages?: string[];
  screenEvidence?: NonNullable<NonNullable<WorkItem["browserTask"]>["finalPresenceContract"]>["screenEvidence"];
  targetElementMatch?: NonNullable<NonNullable<WorkItem["browserTask"]>["finalPresenceContract"]>["targetElementMatch"];
  limitedExecutionGate?: NonNullable<
    NonNullable<WorkItem["browserTask"]>["finalPresenceContract"]
  >["limitedExecutionGate"];
  auditFile?: string;
  rollbackGuide?: string;
  scopeFlow?: "choose_scope_read_preview_approve_log" | string;
  folderScopePolicy?: "selected_file_or_folder_only_no_recursive_mutation" | string;
  previewBeforeApproval?: "required" | string;
  executionLogBoundary?: "office_receipt_or_audit_file" | string;
  rollbackGuideRequired?: boolean;
  adapterResult?: {
    status: "executed" | "blocked";
    adapterRunId: string;
    executedAt: string;
    summary: string;
    userMessage: string;
    sideEffect: "read_only" | "external_open" | "clipboard_write" | "none";
    externalMutation: boolean;
    rawCoordinatesStored: false;
    rawPixelsStored: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  };
  postExecutionEvidence?: NonNullable<
    NonNullable<
      NonNullable<WorkItem["browserTask"]>["finalPresenceContract"]
    >["limitedExecutionGate"]
  >["postExecutionEvidence"];
  analysis?: {
    summary: string;
    checklist: string[];
    extractedCharacterCount: number;
    preview: string;
  };
  outputDraft?: {
    kind: "report" | "reply" | "table";
    label: string;
    summary?: string;
    preview: string;
  };
  actionPlan?: Array<{
    id: string;
    label: string;
    capability: string;
    riskLabel: string;
    requiresFinalUserPresence: boolean;
    reason: string;
  }>;
  inboxResult?: {
    status: string;
    addedCount: number;
    updatedCount?: number;
    totalInboxItems: number;
    userMessage?: string;
    externalMutation: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  };
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type TriggerRuleRecord = {
  id: string;
  label: string;
  connectorId: string;
  sourceKind: string;
  triggerKind: string;
  mode: string;
  enabled: boolean;
  cadenceMinutes: number;
  notifyPolicy: string;
  actionPolicy: string;
  notificationChannels?: {
    appInbox?: boolean;
    os?: boolean;
    telegram?: boolean;
  };
  nextCheckAt?: string | null;
  userVisibleMode?: string;
  userVisibleSchedule?: string;
  safetyBoundary?: string;
  mailAutomationContract?: string;
  bodyPreviewPolicy?: string;
  secretHandlingContract?: string;
  learningProfileSummary?: string;
  learningProfileEvidenceLabels?: string[];
  learningProfileContract?: string;
  learningProfilePersistPolicy?: string;
};

export type TriggerSettingsResult = {
  status: string;
  rules: TriggerRuleRecord[];
  summary?: {
    totalRules?: number;
    enabledRules?: number;
    disabledRules?: number;
    enabledCount?: number;
    eventDrivenCount?: number;
    pollingCount?: number;
    scheduledCount?: number;
    userMessage?: string;
  };
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type TriggerRunnerResult = {
  status: string;
  checkedAt?: string;
  checkedRules?: number;
  createdWorkItemsCount?: number;
  approvalQueueCount?: number;
  report?: {
    status?: string;
    id?: string;
    triggeredBy?: string;
    dueRuleCount?: number;
    signalsProcessed?: number;
    newMailSignalCount?: number;
    duplicateMailSuppressedCount?: number;
    mailPollingContract?: string;
    ignoredMailCount?: number;
    queuedWorkItemsCount?: number;
    approvalQueueCount?: number;
    mailCandidateCount?: number;
    calendarCandidateCount?: number;
    attachmentCandidateCount?: number;
    attachmentStagingStatus?: string;
    attachmentStagingContract?: string;
    scheduleBriefingCount?: number;
    scheduleNotificationCount?: number;
    scheduleNotificationSuppressedCount?: number;
    scheduleNotificationStatuses?: string[];
    scheduleAdaptiveNextChecks?: Array<{
      ruleId: string;
      nextCheckAt: string;
      adaptiveCadenceMinutes: number;
    }>;
    providerReadCount?: number;
    webmailFallbackCheckCount?: number;
    webmailFallbackQueuedCount?: number;
    webmailFallbackBlockedCount?: number;
    webmailFallbackApprovalQueueCount?: number;
    webmailCredentialReferenceCount?: number;
    webmailCredentialReferenceIds?: string[];
    webmailCredentialReferencePolicy?: string;
    webmailAiSecretReadable?: false;
    webmailDomCaptureStatus?: string;
    webmailDomExtractionStatus?: string;
    webmailDomRowCount?: number;
    webmailDomExtractedCount?: number;
    webmailDomRecoveryStatus?: string;
    webmailDomRecoveryReasonLabel?: string;
    webmailDomRecoveryNextAction?: string;
    webmailBodyPreviewAllowedCount?: number;
    webmailBodyPreviewSkippedBeforeBodyCount?: number;
    mailAutomationRunCount?: number;
    mailAutomationLastRunAt?: string;
    mailAutomationEvidenceWindow?: string;
    mailAutomationNotice?: string;
    mailAutomationNotificationDraft?: MailAutomationNotificationDraft;
    mailAutomationNotificationInboxItemId?: string;
    mailAutomationNotificationInboxStatus?: string;
    messengerCommandCount?: number;
    reportPath?: string;
  };
  userMessage?: string;
  externalMutation?: boolean;
  rawSecretMaterialStored?: false;
  rawSecretMaterialReturned?: false;
};

export type MailAutomationNotificationDraft = {
  contract?: string;
  title?: string;
  body?: string;
  routeLabel?: string;
  actionLabel?: string;
  channelSummary?: string;
  dispatchPolicy?: string;
  newMailSignalCount?: number;
  ignoredMailCount?: number;
  approvalQueueCount?: number;
  calendarCandidateCount?: number;
  attachmentCandidateCount?: number;
  triageDistributionLabel?: string;
  importantWorkLabel?: string;
  bodyPreviewPolicy?: string;
  ignoredCandidateLabels?: string[];
  importantCandidateLabels?: string[];
  learningRuleEvidenceLabel?: string;
  learningRuleEvidenceLabels?: string[];
  learningRuleEvidenceContract?: string;
  learningRuleSafePersistPolicy?: string;
  externalMutation?: false;
  rawSecretMaterialStored?: false;
  rawSecretMaterialReturned?: false;
};

export type TriggerRunnerReportOpenResult = {
  status: string;
  reportPath?: string;
  userMessage?: string;
  errorMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type MailLiveE2EReportOpenResult = {
  status: string;
  reportPath?: string;
  userMessage?: string;
  errorMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type WorkSyncResult = {
  status: string;
  checkedAt: string;
  createdWorkItemsCount: number;
  approvalQueueCount: number;
  inboxCount: number;
  messageCount: number;
  relayEventCount: number;
  steps: Array<{
    id: string;
    label: string;
    state: "done" | "needs" | "error";
    detail: string;
  }>;
  metrics?: WorkbenchHeaderMetrics;
  userMessage?: string;
  externalMutation: boolean;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ScheduleNotificationStatusResult = {
  status: string;
  requestedAt?: string;
  os: {
    status: "granted" | "blocked" | "request_required" | "supported" | "not_supported" | "unknown";
    label: string;
    canNotify: boolean;
    userMessage: string;
  };
  telegram: {
    status: "connected" | "needs_connection";
    connected: boolean;
    connectorStatus?: string;
    label: string;
    userMessage: string;
  };
  scheduleRuleCount?: number;
  enabledChannelCount?: number;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type AgentCapabilityRecord = {
  id:
    | "work_intake"
    | "trigger_check"
    | "connectivity_audit"
    | "desktop_control_probe"
    | "desktop_file_chain"
    | "desktop_browser_chain"
    | "crew_channel_bootstrap";
  label: string;
  description: string;
  safetyBoundary: string;
  permissionLevel: string;
};

export type AgentSessionRecord = {
  id: string;
  mode: AgentCapabilityRecord["id"];
  label: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  inputSummary: string;
  outputSummary: string;
  createdWorkItemsCount: number;
  approvalQueueCount: number;
  createdWorkItemIds?: string[];
  auditMessages: string[];
  teammateId?: string;
  teammateName?: string;
  teammateChannelName?: string;
  teammateRoleTitle?: string;
  memoryPaths?: {
    crewSoul?: string;
    promptMemory?: string;
    workLog?: string;
    decisionLog?: string;
  };
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type AgentRuntimeStatus = {
  status: string;
  runtimeLabel: string;
  capabilities: AgentCapabilityRecord[];
  recentSessions: AgentSessionRecord[];
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type AgentSessionResult = {
  status: string;
  session?: AgentSessionRecord;
  result?: unknown;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type DraftApprovalResult = {
  status: string;
  auditId: string;
  outputFile?: string;
  outputFolder?: string;
  userMessage?: string;
  externalMutation?: false;
  rawSecretMaterialStored?: false;
  rawSecretMaterialReturned?: false;
};

export type ApprovedOutputOpenResult = {
  status: string;
  outputFolder?: string;
  errorMessage?: string;
  userMessage: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type FinalActionKind = "send_email" | "send_bulk_email" | "create_calendar_event" | "share_file" | "scenario_review";

export type FinalActionStageResult = {
  status: string;
  addedCount: number;
  totalInboxItems: number;
  stagedWorkItem?: WorkItem;
  userMessage: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type FinalActionAdapterState = {
  status: "connected" | "missing" | "unknown";
  connected: boolean;
  requiredConnectorId: string;
  requiredCategory: string;
  requiredMethod: string;
  label: string;
  connectLabel: string;
  connectHref: string;
  connectorId?: string;
  connectorStatus?: string;
  userMessage: string;
};

export type FinalExecutionGate = {
  gateContract: "dry_run_receipt_connector_readiness_final_presence" | string;
  label: string;
  actionKind: FinalActionKind | string;
  status: string;
  dryRunRequired: boolean;
  dryRunReceiptRequired: boolean;
  connectorReadinessRequired: boolean;
  finalUserPresenceRequired: boolean;
  confirmPhraseRequired: string;
  providerDispatchBlockedUntilReady: boolean;
  externalMutationBeforeGate: false;
  externalMutationOnDryRun: false;
  reviewOnlyExternalMutationBlocked?: boolean;
  adapterConnected: boolean;
  requiredConnectorId?: string;
  connectorId?: string;
  connectorStatus?: string;
  liveAdapterPlanContract?: "mail_final_confirmation_to_live_send_adapter_readiness" | string;
  liveAdapterPlanMode?: "gmail_outlook_smtp_or_app_final_confirmation_only" | string;
  liveAdapterSelectedId?: string;
  liveAdapterReadyCount?: number;
  liveAdapterPendingCount?: number;
  liveAdapterDispatchStatus?:
    | "live_send_adapter_ready"
    | "connector_ready_send_scope_required"
    | "connector_ready_send_adapter_pending"
    | "no_send_connector_ready"
    | string;
  liveAdapterExternalMutationOnConfirm?: boolean;
  liveAdapterProofChain?: string;
  liveAdapterOneLineLabel?: string;
  liveProviderDispatchContract?: "approval_gate_dry_run_final_presence_live_adapter_to_provider_dispatch" | string;
  liveProviderDispatchMode?:
    | "provider_dispatch_allowed_after_final_confirmation"
    | "provider_dispatch_blocked"
    | "final_confirmation_only"
    | string;
  liveProviderDispatchPreconditions?: string[];
  externalMutationOnlyAfterFinalConfirmation?: boolean;
  liveAdapterOptions?: Array<{
    id: string;
    label: string;
    readiness: "ready" | "connector_ready_send_scope_required" | "connector_ready_send_adapter_pending" | "needs_connection" | "standby" | "available" | string;
    connectorId?: string;
    statusLabel?: string;
    requiredScopeLabel?: string;
    requiredScopeValue?: string;
    recoveryActionLabel?: string;
    resumeAfterConnectLabel?: string;
    connectHref?: string;
    dispatchImplementationStatus?: "live_send_adapter_ready" | "send_scope_required" | "send_adapter_planned" | string;
    finalApprovalRequired: boolean;
    dryRunRequired: boolean;
    externalMutationOnlyAfterFinalConfirmation: boolean;
  }>;
  mobileMailIntakeSupported?: boolean;
  mobileMailIntakeBoundary?: string;
  dryRunId?: string;
  missingRequirements?: string[];
  liveProviderExecutionEnabled?: boolean;
  advancedLiveExecutionEnabledAt?: string;
  mailSendApprovalGateStatus?: string;
  mailSendApprovalGatePolicy?: string;
};

export type MailSendApprovalGateHandoff = NonNullable<NonNullable<WorkItem["finalAction"]>["mailSendApprovalGate"]>;

export type FinalExecutionReceipt = {
  contract: "office_final_execution_receipt_v1" | string;
  workItemId: string;
  actionKind: string;
  mutationLabel: string;
  status: string;
  summary: string;
  dryRunId?: string;
  auditId?: string;
  auditFile?: string;
  providerMessageId?: string;
  externalMutation: boolean;
  finalSendOrCalendarMutationLocked: boolean;
  originalMailMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  missingRequirements?: string[];
  gateStatus?: string;
  providerDispatchStatus?: string;
  recoveryActionLabel?: string;
  proofChain?: string;
};

export type FinalConfirmationPrepareOptions = {
  mailSendApprovalGate?: MailSendApprovalGateHandoff;
};

export type ChannelDecisionFinalConfirmationContext = {
  channel: string;
  decision: string;
  decisionLabel?: string;
  decidedBy: string;
  decidedAt: string;
  targetCode?: string;
  targetWorkItemId?: string;
  notificationTargetMatch?: boolean;
  notificationTargetMatchLabel?: string;
  notificationTargetMatchContract?: string;
  summaryLabel: string;
  approvalInboxRouteLabel: string;
  appReconfirmLabel: string;
  workerEventLabel: string;
  finalExecutionBoundary: string;
  mobileReceiveFilterIds?: string[];
  mobileReceiveFilterLabels?: string[];
  mobileReceiveFilterSummary?: string;
  mobileReceiveFilterContract?: string;
  recommendedFinalAction:
    | "prepare_final_confirmation"
    | "revise_before_final_confirmation"
    | "hold_before_execution"
    | "exclude_from_execution";
  state: "ready" | "review" | "locked";
  draftInstruction: string;
  messagePreview?: string;
  revisionInstruction?: string;
  requiresAppReconfirm: boolean;
  externalMutation: false;
};

export type FinalConfirmationContract = {
  attachmentCandidates?: Array<{id:string;key:string;title:string;filename:string;bytes:number;sha256:string}>;
  attachmentNotice?: string;
  id: string;
  workItemId: string;
  title: string;
  actionKind: FinalActionKind;
  actionLabel: string;
  readiness: "adapter_not_connected" | "ready_for_final_confirmation" | "send_scope_required";
  blockedReason: string;
  checklist: string[];
  requiredFields: Array<{
    id: string;
    label: string;
    required: boolean;
    placeholder: string;
    /** 여러 줄 입력(보낼 본문). 줄바꿈이 그대로 발송됩니다. */
    multiline?: boolean;
  }>;
  /** Gmail/Outlook 이 읽기 전용으로 연결돼 있을 때 권한 추가로 이어 주는 안내. */
  sendScopeRecovery?: {
    status: "send_scope_required";
    providerLabel: string;
    connectorId: string;
    actionLabel: string;
    connectHref: string;
    reason: string;
    userMessage: string;
    resumeLabel: string;
    externalMutation: false;
  };
  defaultValues?: Record<string, string>;
  defaultHints?: Record<string, string>;
  channelDecisionContext?: ChannelDecisionFinalConfirmationContext;
  confirmPhrase: string;
  finalUserPresence: true;
  externalMutationOnConfirm: true;
  finalExecutionGate?: FinalExecutionGate;
  adapterConnected: boolean;
  adapter: FinalActionAdapterState;
};

export type InboxRevisionResult = {
  status: "inbox_revision_ready";
  revision: number;
  totalInboxItems: number;
  persistence?: { status: "saved" | "save_failed" | "not_configured" | "not_checked"; pending: boolean };
};

export type InboxSaveResult = {
  status: "inbox_saved" | "inbox_save_unconfirmed";
  persistence: NonNullable<InboxRevisionResult["persistence"]>;
  userMessage: string;
  externalMutation: false;
};

export type FinalConfirmationPrepareResult = {
  status: string;
  confirmation?: FinalConfirmationContract;
  /** 이미 보낸 카드면 true — 다시 보내기를 막습니다. */
  alreadySent?: boolean;
  sentAt?: string;
  userMessage: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type FinalActionDryRunResult = {
  status:
    | "final_action_dry_run_ready"
    | "final_action_dry_run_needs_input"
    | "final_action_dry_run_blocked"
    | "final_action_dry_run_card_changed"
    | "final_action_already_sent"
    | "not_final_action"
    | "desktop_required";
  alreadySent?: boolean;
  auditId?: string;
  auditFile?: string;
  auditRecorded?: boolean;
  adapter?: FinalActionAdapterState;
  missingFieldIds?: string[];
  validationMessages?: string[];
  dryRun?: {
    id: string;
    workItemId: string;
    actionKind: FinalActionKind;
    actionLabel: string;
    mode: "dry_run_only";
    providerAdapter: string;
    connectorId: string;
    createdAt: string;
    executionPlan: {
      summary: string;
      operation: string;
      provider: string;
      dryRunOnly: true;
      externalMutation: false;
      bodySource?: string;
      bodyPreview?: string;
      reviewNote?: string;
      sendCheckSummary?: string;
      safetyChecks?: string[];
      recipientDecision?: {
        summary?: string;
        sendCandidateLabels?: string[];
        holdCandidateLabels?: string[];
        excludeCandidateLabels?: string[];
        learningDecisionHints?: string[];
        privacyBoundary?: string;
      };
    };
    checkedFields: Array<{
      id: string;
      label: string;
      required: boolean;
      valuePreview: string;
    }>;
    checks: string[];
    mailWorkExecutionReceipt?: MailWorkExecutionReceipt;
    externalMutation: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  };
  mailWorkExecutionReceipt?: MailWorkExecutionReceipt;
  finalExecutionGate?: FinalExecutionGate;
  userMessage: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type FinalActionExecutionResult = {
  status:
    | "final_execution_provider_dispatched"
    | "final_execution_provider_partial"
    | "final_execution_review_recorded"
    | "final_execution_live_adapter_required"
    | "final_execution_confirmation_required"
    | "final_execution_already_sent"
    | "final_execution_in_progress"
    | "final_execution_sent_save_failed"
    | "final_execution_partial_save_failed"
    | "final_execution_sent_card_changed"
    | "final_execution_partial_card_changed"
    | "final_execution_sent_audit_failed"
    | "final_execution_partial_audit_failed"
    | "final_execution_journal_already_sent"
    | "final_execution_journal_partial"
    | "final_execution_journal_unavailable"
    | "final_execution_not_sent_save_failed"
    | "final_execution_outcome_unknown"
    | "final_execution_card_changed"
    | "not_final_action"
    | "desktop_required";
  /** 이미 보낸 카드라 다시 보내지 않았으면 true. */
  alreadySent?: boolean;
  sentAt?: string;
  auditId?: string;
  auditFile?: string;
  auditRecorded?: boolean;
  missingRequirements?: string[];
  providerMessageId?: string;
  finalExecutionGate?: FinalExecutionGate;
  finalExecutionReceipt?: FinalExecutionReceipt;
  providerDispatchRecovery?: {
    contract: "provider_dispatch_failure_to_recovery_action_resume_final_confirmation" | string;
    status: string;
    providerLabel: string;
    recoveryKind: string;
    reason: string;
    actionLabel: string;
    connectHref: string;
    resumeLabel: string;
    proofChain: string;
    externalMutation: boolean;
  };
  userMessage: string;
  externalMutation?: boolean;
  externalMutationUnknown?: boolean;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ScheduleTimeConfirmationResult = {
  status:
    | "schedule_time_confirmed"
    | "schedule_time_invalid"
    | "not_schedule_confirmation"
    | "desktop_required";
  addedCount: number;
  totalInboxItems: number;
  stagedWorkItem?: WorkItem;
  userMessage: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type DocumentLearningFileRecord = {
  id: string;
  name?: string;
  path?: string;
  absolutePath: string;
  fileName: string;
  sizeBytes?: number;
  modifiedAt?: string;
  mimeType?: string;
  selected?: boolean;
  sourceFolderPath?: string;
  sourceFolderLabel?: string;
  sourceKind?: "custom" | "desktop" | "documents" | "downloads" | "home" | string;
};

export type DocumentLearningFolderSource = {
  id: string;
  path: string;
  label: string;
  sourceKind: "custom" | "desktop" | "documents" | "downloads" | "home" | string;
  fileCount: number;
  skippedCount?: number;
  maxDepth?: number;
  maxFiles?: number;
};

export type DocumentLearningSupervisorSource = {
  sourceId: string;
  sourceLabel: string;
  status: "active" | "paused" | "needs_reapproval";
  approvedAt?: string;
  lastLearnedAt?: string;
  errorCode?: string;
  watcherErrorCode?: string;
  knownFileCount: number;
  staleFileCount: number;
  lastResult?: {
    status: string;
    learnedCount: number;
    candidateFiles: number;
    staleCount: number;
    skippedCount: number;
  } | null;
};

export type DocumentLearningSupervisorTeammateProposal = {
  sourceId: string;
  draftId: string;
  proposalId: string;
  proposedAt: string;
  draft: TeammateProfileDraftLike;
};

export type DocumentLearningSupervisorSnapshot = {
  status: string;
  stateStatus: string;
  started: boolean;
  sources: DocumentLearningSupervisorSource[];
  nextPendingTeammateProposal?: DocumentLearningSupervisorTeammateProposal | null;
  externalMutation: false;
  rawSecretMaterialReturned: false;
};

export type DocumentLearningSupervisorResult = {
  status: string;
  stateStatus?: string;
  started?: boolean;
  sources?: DocumentLearningSupervisorSource[];
  nextPendingTeammateProposal?: DocumentLearningSupervisorTeammateProposal | null;
  supervisor?: DocumentLearningSupervisorSnapshot;
  sourceId?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialReturned: false;
};
export type DocumentLearningSelectionResult = {
  status: string;
  files: DocumentLearningFileRecord[];
  folders?: DocumentLearningFolderSource[];
  count?: number;
  skippedCount?: number;
  maxFiles?: number;
  maxDepth?: number;
  userMessage?: string;
  externalMutation: false;
  originalFilesMoved?: false;
  originalFilesDeleted?: false;
  rawSecretMaterialReturned: false;
  continuousLearning?: DocumentLearningSupervisorResult;
};

export type DocumentLearningRootResult = {
  status: string;
  localStorageRoot: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialReturned: false;
};

export type DocumentLearningSummary = {
  selectedFiles: number;
  extractedReady: number;
  failed: number;
  chunks: number;
  groups: number;
  searchHits: number;
  databaseUsed: false;
  rawFileContentStoredInAppDatabase: false;
  originalFilesMoved: false;
  originalFilesDeleted: false;
};

export type DocumentLearningSearchResult = {
  id: string;
  title: string;
  path: string;
  kind: string;
  summary: string;
  score?: number;
  matchedTerms?: string[];
  /**
   * 데스크톱이 이미 매겨 둔 갈래. 정리함이 이걸로 묶는다 —
   * 파일 확장자가 아니라 "무슨 자료인가"로 나뉜다.
   */
  materialType?: string;
  retrievalRole?: string;
  completionState?: string;
  referencePriority?: number;
};

export type DocumentAutomationRecommendation = {
  id: string;
  workPackId: string;
  title: string;
  confidence: number;
  reason: string;
  sourceFileIds: string[];
  sourceLabels: string[];
  suggestedRuleLabel: string;
  requiredFeatureIds: string[];
  learnedStyleProfileId?: string;
  learnedStyleGuidance?: string[];
  outputPlan?: {
    kind: "report_draft" | "mail_reply_draft" | "calendar_candidate" | "table_review";
    label: string;
    formatBasis: "learned_document_style";
    draftTarget: string;
    handoffLabel: string;
    approvalGateLabel: string;
    nextUserAction: string;
  };
  approvalRequired: true;
  startsEnabled: false;
  externalMutation: false;
};

export type DocumentLearnedOutputDraft = {
  id: string;
  createdAt: string;
  learningSessionId: string;
  recommendationId: string;
  workPackId: string;
  outputKind: "report_draft" | "mail_reply_draft" | "calendar_candidate" | "table_review";
  title: string;
  markdown: string;
  sourceFileIds: string[];
  sourceLabels: string[];
  learnedStyleProfileId: string;
  learnedStyleGuidance: string[];
  handoffLabel: string;
  approvalGateLabel: string;
  nextUserActions: string[];
  approvalRequiredBeforeExternalMutation: true;
  externalMutation: false;
  rawFileContentStoredInAppDatabase: false;
};

export type DocumentLearningClassifyResult = {
  status: string;
  localStorageRoot?: string;
  localIndexRoot?: string;
  jsonPath?: string;
  reportPath?: string;
  summary?: DocumentLearningSummary;
  extracted?: Array<{
    id: string;
    fileName: string;
    absolutePath: string;
    characterCount: number;
    preview: string;
  }>;
  failures?: Array<{
    id?: string;
    fileName: string;
    absolutePath: string;
    reason: string;
  }>;
  searchHits?: Array<{
    title: string;
    citation: string;
    preview: string;
  }>;
  automationRecommendations?: DocumentAutomationRecommendation[];
  /** 학습 결과로 합성된 맞춤 AI 직원 초안 — 생성은 사용자 승인 카드 이후에만 */
  teammateProfileDraft?: TeammateProfileDraftLike;
  learnedOutputDrafts?: DocumentLearnedOutputDraft[];
  learnedDraftWorkItems?: WorkItem[];
  learnedDraftInboxResult?: {
    status: "learned_output_drafts_staged" | string;
    addedCount: number;
    updatedCount?: number;
    stagedItemIds: string[];
    externalMutation: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  };
  activityEvent?: SelectedWorkActionEvent;
  activityAuditFile?: string;
  userMessage?: string;
  databaseUsed?: false;
  rawFileContentStoredInAppDatabase?: false;
  originalFilesMoved?: false;
  originalFilesDeleted?: false;
  externalMutation: false;
  rawSecretMaterialReturned: false;
};

export type DocumentLearningFolderPlanResult = {
  status: string;
  localStorageRoot?: string;
  localIndexRoot?: string;
  planPath?: string;
  reportPath?: string;
  groups?: Array<{
    id?: string;
    label: string;
    fileIds: string[];
    targetFolder: string;
  }>;
  filePlans?: unknown[];
  automationRecommendations?: DocumentAutomationRecommendation[];
  learnedOutputDrafts?: DocumentLearnedOutputDraft[];
  learnedDraftWorkItems?: WorkItem[];
  learnedDraftInboxResult?: DocumentLearningClassifyResult["learnedDraftInboxResult"];
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialReturned: false;
  originalFilesMoved?: false;
  originalFilesDeleted?: false;
};

export type MailAttachmentFolderPlanPayload = {
  localStorageRoot?: string;
  connectorId?: string;
  providerId?: string;
  messageId?: string;
  messageSubject?: string;
  subject?: string;
  senderPreview?: string;
  from?: string;
  mailboxLabel?: string;
  mailbox?: string;
  selectedKinds?: string[];
  files?: DocumentLearningFileRecord[];
  attachments?: Array<{
    id?: string;
    name?: string;
    fileName?: string;
    absolutePath?: string;
    path?: string;
    dataBase64?: string;
    mimeType?: string;
    sizeBytes?: number;
    modifiedAt?: string;
    selected?: boolean;
  }>;
};

export type MailAttachmentFolderPlanResult = DocumentLearningFolderPlanResult & {
  attachmentCount?: number;
  stagedWorkItem?: WorkItem;
  addedInboxItemsCount?: number;
  mailAttachmentContext?: {
    sourceKind: "mail_attachment" | string;
    connectorId?: string;
    providerId?: string;
    messageId?: string;
    messageSubject?: string;
    senderPreview?: string;
    mailboxLabel?: string;
  };
  preview?: DocumentLearningFolderPlanPreviewResult;
  safetySummary?: string;
  collisionSummary?: string;
  exclusionSummary?: string;
  nextUserChoice?: string;
  userApprovalRequiredBeforeMoveOrDelete?: true;
};

export type DocumentLearningFolderPlanPreviewResult = {
  status: string;
  localStorageRoot?: string;
  localIndexRoot?: string;
  planPath?: string;
  reportPath?: string;
  groups?: DocumentLearningFolderPlanResult["groups"];
  applySafetyReview?: {
    confirmationTextRequired: string;
    revertConfirmationTextRequired: string;
    defaultOrganizedRoot: string;
    collisionPolicies: Array<{
      id: "rename" | "skip" | string;
      label: string;
      detail: string;
      selected?: boolean;
    }>;
    exclusionOptions: string[];
    targetFolderCount: number;
    duplicateReviewCount: number;
    operationCount: number;
    externalMutationBeforeApproval: false;
    originalFilesDeleted: false;
    overwriteAllowed: false;
  };
  operations?: Array<{
    id: string;
    operation: "copy_to_organized_index" | string;
    fileName: string;
    sourcePath: string;
    targetPath: string;
    targetFolder: string;
    status: "dry_run_only" | string;
  }>;
  operationCount?: number;
  stagedWorkItem?: WorkItem;
  inboxResult?: {
    status: string;
    addedCount?: number;
    updatedCount?: number;
    totalInboxItems?: number;
    userMessage?: string;
  };
  addedInboxItemsCount?: number;
  safetyReceipt?: {
    phase: string;
    operationCount: number;
    changedCount: number;
    collisionPolicy: "rename" | "skip" | string;
    collisionSkipCount: number;
    userExcludedCount: number;
    excludedOperationCount: number;
    excludedPathKeywordCount: number;
    safetySummary: string;
    collisionSummary: string;
    exclusionSummary: string;
    rollbackGuide: string;
    nextUserChoice: string;
    originalFilesDeleted: false;
    overwritePerformed: false;
  };
  safetySummary?: string;
  collisionSummary?: string;
  exclusionSummary?: string;
  rollbackGuide?: string;
  nextUserChoice?: string;
  userApprovalRequiredBeforeMoveOrDelete?: true;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialReturned: false;
  originalFilesMoved?: false;
  originalFilesDeleted?: false;
};

export type DocumentLearningFolderPlanApplyResult = {
  status: string;
  localStorageRoot?: string;
  localIndexRoot?: string;
  planPath?: string;
  manifestPath?: string;
  reportPath?: string;
  organizedRoot?: string;
  collisionPolicy?: "rename" | "skip" | string;
  excludedOperationCount?: number;
  excludedPathKeywords?: string[];
  appliedCount?: number;
  skippedCount?: number;
  revertedCount?: number;
  revertManifestPath?: string;
  applied?: unknown[];
  reverted?: unknown[];
  skipped?: unknown[];
  safetyReceipt?: DocumentLearningFolderPlanPreviewResult["safetyReceipt"];
  safetySummary?: string;
  collisionSummary?: string;
  exclusionSummary?: string;
  rollbackGuide?: string;
  nextUserChoice?: string;
  mailAttachmentOrganizerApply?: {
    contract: "downloaded_mail_attachment_to_folder_plan_final_apply" | string;
    sourceContract?: "downloaded_mail_attachment_to_folder_plan_approval" | string;
    sourceKind?: "mail_attachment_local_copy" | string;
    connectorId?: string;
    providerId?: string;
    sourceMessageId?: string;
    messageSubject?: string;
    appliedLocalCopyCount?: number;
    skippedLocalCopyCount?: number;
    localCopyOnly?: true;
    originalMailMutation?: false;
    originalAttachmentDeleted?: false;
    externalShareBeforeApproval?: false;
    originalShareCreated?: false;
    finalApprovalEvidence?: string;
  };
  userMessage?: string;
  userApprovalRequiredBeforeMoveOrDelete?: true;
  overwritePerformed?: false;
  /** null means that a rename was attempted but its outcome could not be confirmed. */
  externalMutation: boolean | null;
  rawSecretMaterialReturned: false;
  originalFilesMoved?: boolean | null;
  unknownMoves?: unknown[];
  recordPersistence?: {
    manifest: "not_attempted" | "unconfirmed" | "completed";
    report: "not_attempted" | "unconfirmed" | "completed";
    receipt: "not_attempted" | "unconfirmed" | "completed";
  };
  originalFilesDeleted?: false;
};

export type DocumentLearningIndexSearchResult = {
  status: string;
  localStorageRoot?: string;
  localIndexRoot?: string;
  jsonPath?: string;
  results: DocumentLearningSearchResult[];
  count?: number;
  totalCount?: number;
  offset?: number;
  hasMore?: boolean;
  query?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialReturned: false;
};

/** 에이전트 조직 ledger 결과 — 구조는 packages/domain agent-organization/agent-proposals 계약을 따른다. */
export type AgentOrgLoadResult = {
  status: string;
  root?: string;
  blueprintPath?: string;
  specVersionsPath?: string;
  proposalsPath?: string;
  performanceLedgerPath?: string;
  blueprint: Record<string, unknown> | null;
  specVersions: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
  performanceRecords: Array<Record<string, unknown>>;
  memberCount?: number;
  specVersionCount?: number;
  proposalCount?: number;
  performanceCount?: number;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type AgentOrgSaveResult = {
  status: string;
  saved?: string[];
  missingKeys?: string[];
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type AgentOrgPerformanceResult = {
  status: string;
  performanceCount?: number;
  userMessage?: string;
  errorMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type AgentOrgProposalStageResult = {
  status: string;
  addedCount?: number;
  totalInboxItems?: number;
  stagedWorkItem?: Record<string, unknown>;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type DocumentLearningOpenResult = {
  status: string;
  localStorageRoot?: string;
  localIndexRoot?: string;
  path?: string;
  userMessage?: string;
  externalMutation: false;
};

export type SelectedWorkActionEventsResult = {
  status: string;
  events: SelectedWorkActionEvent[];
  auditFile?: string;
  userMessage?: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

/** 메일 카드 담당 AI 직원 선택(표시용). */
export type CardAssigneeChoice = {
  teammateId: string;
  name: string;
  roleTitle?: string;
};

export type CardAssigneeUpdateResult = {
  status: string;
  workItemId?: string;
  assigneeTeammateId?: string;
  assigneeName?: string;
  updatedCount?: number;
  userMessage?: string;
  externalMutation: false;
};

/** 보기 전용 Google Drive 목록(팀 공유 자료에 파일 링크를 걸 때). */
export type GoogleDriveFileSummary = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  sizeBytes: number;
  webViewLink: string;
};
export type GoogleDriveFilesPayload = {
  kind?: "status" | "list_files" | "list_recent_files";
  query?: string;
  parentId?: string;
  driveId?: string;
  pageSize?: number;
};
export type GoogleDriveFilesResult = {
  status: string;
  userMessage: string;
  connected?: boolean;
  configured?: boolean;
  files?: GoogleDriveFileSummary[];
  errorCode?: string;
};

export type DesktopBridgeApi = {
  isAvailable: boolean;
  /** 보기 전용 Drive 목록. 영수증 채널과 분리된 창구다. */
  googleDriveFiles: (payload: GoogleDriveFilesPayload) => Promise<GoogleDriveFilesResult>;
  documentProduction: (payload: DocumentProductionPayload) => Promise<DocumentProductionResult>;
  companyAutomation: (payload: CompanyAutomationPayload) => Promise<CompanyAutomationResult>;
  fetchInbox: () => Promise<WorkItem[]>;
  fetchHandledInbox?: () => Promise<WorkItem[]>;
  setInboxCardDisposition?: (request: { workItemIds?: string[]; action: "acknowledged" | "ignored" | "deferred" | "restore" | "restore_batch"; batchId?: string }) => Promise<{ status: string; count: number; batchId: string; externalMutation: false }>;
  /** 일상 도구(날씨·교통·공공 등 공개 정보) 목록. 설치 앱이 지원하지 않으면 desktop_update_required. */
  dailySkillsCatalog?: () => Promise<DailySkillCatalogResult>;
  /** 일상 도구 읽기 전용 조회. 경로·인자 검증과 네트워크는 데스크톱 메인이 맡는다. */
  lookupDailySkill?: (payload: DailySkillLookupPayload) => Promise<DailySkillLookupResult>;
  fetchHeaderMetrics: () => Promise<WorkbenchHeaderMetrics>;
  /** 인박스 변경 번호. 설치 앱이 지원하지 않으면 없음(그때는 매번 fetchInbox). */
  fetchInboxRevision?: () => Promise<InboxRevisionResult>;
  retryInboxSave?: () => Promise<InboxSaveResult>;
  runLocalWorkflow: (text: string) => Promise<LocalWorkflowResult>;
  openLocalWorkflowOutput: () => Promise<LocalWorkflowOpenOutputResult>;
  readSelectedWorkActionEvents: () => Promise<SelectedWorkActionEventsResult>;
  recordSelectedWorkActionEvent: (
    event: SelectedWorkActionEvent,
  ) => Promise<SelectedWorkActionEventsResult>;
  recordReleaseReadinessVirtualOfficeEvent: () => Promise<SelectedWorkActionEventsResult>;
  updateSelectedWorkActionEvent: (
    eventId: string,
    patch: Pick<SelectedWorkActionEvent, "status" | "detail"> &
      Partial<Pick<SelectedWorkActionEvent, "evidence" | "kind" | "sourceLabel" | "metrics" | "auditTrail">>,
  ) => Promise<SelectedWorkActionEventsResult>;
  approveDraft: (workItemId: string) => Promise<DraftApprovalResult>;
  openApprovedOutput: (workItemId: string) => Promise<ApprovedOutputOpenResult>;
  stageFinalAction: (workItemId: string, actionKind: FinalActionKind) => Promise<FinalActionStageResult>;
  prepareFinalConfirmation: (
    workItemId: string,
    options?: FinalConfirmationPrepareOptions,
  ) => Promise<FinalConfirmationPrepareResult>;
  runFinalActionDryRun: (
    workItemId: string,
    values: Record<string, string>,
  ) => Promise<FinalActionDryRunResult>;
  executeFinalAction: (
    workItemId: string,
    confirmation: {
      finalUserPresence: true;
      confirmPhrase: string;
      dryRunId: string;
      values?: Record<string, string>;
      liveProviderExecutionEnabled?: boolean;
      advancedLiveExecutionAcknowledged?: boolean;
      advancedLiveExecutionPhrase?: string;
      advancedLiveExecutionEnabledAt?: string;
    },
  ) => Promise<FinalActionExecutionResult>;
  stageDelegationActionQueueItem: (
    queueItem: LocalMemoryDelegationActionQueueRecord,
  ) => Promise<DelegationQueueStageResult>;
  confirmScheduleTime: (
    workItemId: string,
    values: {
      label?: string;
      startsAt: string;
      endsAt?: string;
    },
  ) => Promise<ScheduleTimeConfirmationResult>;
  requestChange: (workItemId: string, instruction: string) => Promise<{ status: string }>;
  /** AI가 쓴 메일 초안을 승인함 카드로 올린다(업서트, 발송 없음). */
  stageMailDraft: (draft: MailDraftStagePayload) => Promise<MailDraftStageResult>;
  /** 사용자가 적은 지시로 AI가 답장 초안을 다시 쓴다(발송 없음). */
  redraftMailReply: (workItemId: string, instruction: string, options?: MailRedraftOptions) => Promise<MailRedraftResult>;
  holdAction: (workItemId: string) => Promise<{ status: string }>;
  rejectAction: (workItemId: string, reason: string) => Promise<{ status: string }>;
  /** 메일 카드의 담당 AI 직원만 바꾼다(표시용 — 발송·실행과 무관). 설치된 앱에서만 있다. */
  setCardAssignee?: (workItemId: string, assignee: CardAssigneeChoice) => Promise<CardAssigneeUpdateResult>;
  connectConnector: (
    connectorId: string,
    payload: ConnectConnectorPayload,
  ) => Promise<ConnectConnectorResult>;
  listConnectorStatuses: () => Promise<ConnectorStatusListResult>;
  /**
   * 이메일 주소만으로 IMAP 서버를 찾습니다(학교·기관 메일용).
   * 자격정보를 보내지 않고 도메인 정보만 씁니다.
   */
  discoverMailServer: (payload: { email: string }) => Promise<MailServerDiscoveryResult>;
  /** 연결된 메일·캘린더에서 실제로 읽은 내용 (채팅 근거로 쓴다). */
  getConnectorChatContext: () => Promise<ConnectorChatContext>;
  getProviderOAuthPreflight: () => Promise<ProviderOAuthPreflightResult>;
  runMailWorkIntake: (payload?: {
    kind?: "run" | "review_recipient_list" | "run_mobile_share" | "run_live_e2e_rehearsal" | "download_imap_attachments";
    connectorId?: string;
    mailbox?: string;
    limit?: number;
    activityEventId?: string;
    teammateId?: string;
    teammateName?: string;
    scenarioFocus?: MailWorkScenarioFocus;
    /** true면 안전 점검(인젝션 스캔+검증기) 통과 후보에 AI 답장 초안을 준비한다(발송 없음). */
    generateDrafts?: boolean;
    filePath?: string;
    path?: string;
    sourceLabel?: string;
    sourceType?: string;
    rows?: Array<Record<string, unknown>>;
    messages?: MobileSharedMailMessageInput[];
    reportChannelId?: string;
    writingProfile?: MobileMailShareIntakePayload["writingProfile"];
  }) => Promise<MailWorkIntakeResult>;
  /** 통합 메일함 목록 — 원장에 쌓인 메일을 계정 합쳐 최신순으로 읽는다. */
  listMailMessages: (payload?: { accountId?: string; limit?: number; offset?: number }) => Promise<MailLedgerPage>;
  /** 메일 답장 서명(명함)·말투 읽기·저장, 붙여 넣은 예전 메일로 말투 정리(저장은 사용자가 확인한 뒤). */
  mailWritingProfile: (payload: MailWritingProfilePayload) => Promise<MailWritingProfileResult>;
  /** 채팅 도구 mail.search — 최근 메일 메타데이터 읽기 전용 검색(발송/변이 없음). */
  searchMail: (payload: {
    query: string;
    connectorId?: string;
    mailbox?: string;
    limit?: number;
  }) => Promise<{ status: string; userMessage?: string } & Record<string, unknown>>;
  /** 채팅 도구 mail.read — 단건 메타데이터 + 인젝션 스캔 통과 미리보기(읽기 전용). */
  readMail: (payload: {
    messageId: string;
    fullBody?: boolean;
    conversation?: boolean;
    attachmentKey?: string;
    connectorId?: string;
    mailbox?: string;
    limit?: number;
  }) => Promise<{ status: string; userMessage?: string } & Record<string, unknown>>;
  /** 채팅 도구 mail.draft — 초안 텍스트 생성만(저장/발송 없음, 발송은 승인 레일 전용). */
  draftMail: (payload: {
    request: string;
    to?: string;
    subject?: string;
    replyToMessageId?: string;
    connectorId?: string;
    mailbox?: string;
  }) => Promise<{ status: string; userMessage?: string } & Record<string, unknown>>;
  runMailLiveE2ERehearsal: (payload?: {
    connectorId?: string;
    mailbox?: string;
    limit?: number;
    webmailFallbackReady?: boolean;
    writeEvidenceTemplate?: boolean;
    importManualEvidence?: boolean;
    manualEvidencePath?: string;
    manualEvidence?: {
      connectedProviderIds?: string[];
      securePollingPrepared?: boolean;
      securePollingEnabled?: boolean;
      newMailSignalCount?: number;
      messageCount?: number;
      ignoredItemsCount?: number;
      approvalQueueCount?: number;
      attachmentCandidateCount?: number;
      profileReady?: boolean;
      calendarCandidateCount?: number;
      webmailDomCaptureStatus?: string;
      webmailDomExtractionStatus?: string;
      webmailDomRowCount?: number;
      webmailDomExtractedCount?: number;
      webmailBodyPreviewAllowedCount?: number;
      webmailBodyPreviewSkippedBeforeBodyCount?: number;
      approvalNotificationDraftReady?: boolean;
      approvalNotificationChannelReady?: boolean;
      approvalNotificationSent?: boolean;
      approvalNotificationTargetCount?: number;
      approvalNotificationProviderMessageId?: string;
      evidenceSource?: string;
    };
  }) => Promise<MailLiveE2ERehearsalResult>;
  openMailLiveE2EReport: () => Promise<MailLiveE2EReportOpenResult>;
  downloadMailAttachmentsToStaging: (payload?: {
    connectorId?: string;
    providerId?: string;
    mailbox?: string;
    mailboxLabel?: string;
    uid?: number;
    messageUid?: number;
    messageId?: string;
    localStorageRoot?: string;
    downloadRootPath?: string;
    maxAttachments?: number;
    maxBytesPerAttachment?: number;
  }) => Promise<MailAttachmentDownloadResult>;
  runMobileMailShareIntake: (payload: MobileMailShareIntakePayload) => Promise<MailWorkIntakeResult>;
  reviewMailRecipientList: (payload?: {
    filePath?: string;
    path?: string;
    sourceLabel?: string;
    sourceType?: string;
    rows?: Array<Record<string, unknown>>;
  }) => Promise<MailWorkIntakeResult>;
  sendApprovalNotification: (payload?: {
    channel?: "telegram";
    targetWorkItemId?: string;
    targetWorkItemIds?: string[];
    notificationTargetIds?: string[];
    mobileReceiveFilterIds?: string[];
    mobileReceiveFilterSummary?: string;
    digestCount?: number;
    firstTitle?: string;
    sourceLabel?: string;
  }) => Promise<ApprovalNotificationResult>;
  applyChannelDecision: (payload?: {
    channel?: "telegram" | "slack" | string;
    senderId?: string;
    userId?: string;
    messageText?: string;
    text?: string;
    receivedAt?: string;
  }) => Promise<ChannelDecisionResult>;
  saveAIProviderKey: (
    provider: string,
    payload: SaveAIProviderKeyPayload,
  ) => Promise<AIProviderKeyStatus>;
  getJevMailClassificationStatus: () => Promise<JevMailClassificationStatus>;
  saveJevMailClassification: (
    payload: SaveJevMailClassificationPayload,
  ) => Promise<JevMailClassificationStatus>;
  testJevMailClassification: () => Promise<JevMailClassificationStatus>;
  disconnectJevMailClassification: () => Promise<JevMailClassificationStatus>;
  saveAIProviderModel: (
    provider: string,
    payload: { model: string },
  ) => Promise<AIProviderKeyStatus>;
  listAIProviderModels: (provider: string, options?: { forceRefresh?: boolean }) => Promise<AIProviderModelListResult>;
  listLocalAIModels: (payload?: { baseUrl?: string }) => Promise<LocalAIModelListResult>;
  listSubscriptionAIRuntimes: () => Promise<{ runtimes: SubscriptionAIRuntime[] }>;
  startSubscriptionAILogin: (provider: string) => Promise<{ started: boolean; userMessage?: string }>;
  startAIProviderOAuth: (
    provider: string,
    options?: StartAIProviderOAuthOptions,
  ) => Promise<AIProviderKeyStatus>;
  getAIProviderStatus: () => Promise<{ status: string; providers: AIProviderKeyStatus[]; activeProvider?: string }>;
  getAIUsageSummary?: (days: number, includeProviderLimits?: boolean) => Promise<AIUsageSummaryResult>;
  getAIRuntimeLiveProofs: () => Promise<AIRuntimeLiveProofsResult>;
  generateAIText: (payload: AITextGenerationPayload) => Promise<AITextGenerationResult>;
  generateAITextStream?: (
    payload: AITextGenerationPayload,
    onChunk: (delta: string) => void,
  ) => Promise<AITextGenerationResult>;
  /** 진행 중인 스트리밍 답변을 멈춘다(설치 앱이 지원할 때만 있다). */
  cancelAITextStream?: (streamId: string) => Promise<AITextStreamCancelResult>;
  getTriggerSettings: () => Promise<TriggerSettingsResult>;
  updateTriggerRule: (rule: Partial<TriggerRuleRecord> & { id: string }) => Promise<TriggerSettingsResult>;
  getScheduleNotificationStatus: () => Promise<ScheduleNotificationStatusResult>;
  requestScheduleNotificationPermission: () => Promise<ScheduleNotificationStatusResult>;
  runTriggerDueChecks: () => Promise<TriggerRunnerResult>;
  openTriggerRunnerReport: () => Promise<TriggerRunnerReportOpenResult>;
  runUnifiedWorkSync: (payload?: {
    limit?: number;
    suppressExternalNotifications?: boolean;
  }) => Promise<WorkSyncResult>;
  getToolchainStatus: () => Promise<ToolchainStatusResult>;
  prepareToolchain: () => Promise<ToolchainStatusResult>;
  installCodexRecoveryTool: () => Promise<CodexRecoveryInstallResult>;
  getLocalMemoryStatus: () => Promise<LocalMemoryStatusResult>;
  chooseLocalMemoryRoot: () => Promise<LocalMemoryStatusResult>;
  openWorkspaceWindow: (target: "office") => Promise<WorkspaceWindowResult>;
  returnToMainWindow: () => Promise<WorkspaceWindowResult>;
  /** 알림 클릭 → 이미 열린 창 안에서 카드로 이동. 해제 함수를 돌려준다. */
  onFocusWorkItem: (listener: (request: DesktopWorkItemFocusPayload) => void) => () => void;
  /** 창이 막 열릴 때 main 에 맡겨 둔 이동 요청을 가져온다(없으면 null). */
  takePendingWorkItemFocus: () => Promise<DesktopWorkItemFocusPayload | null>;
  onInboxChanged: (listener: (change: DesktopInboxAttention) => void) => () => void;
  getInboxAttention: () => Promise<DesktopInboxAttention>;
  openWorkerCompanionWindow: (options?: WorkerCompanionWindowOpenOptions) => Promise<WorkspaceWindowResult>;
  openReleaseFieldGuide: () => Promise<ReleaseFieldGuideOpenResult>;
  openFirstUserObservationKit: (
    target?: FirstUserObservationKitTarget,
  ) => Promise<FirstUserObservationKitOpenResult>;
  openReleaseAIRuntimeLiveKit: (
    target?: ReleaseAIRuntimeLiveKitTarget,
  ) => Promise<ReleaseAIRuntimeLiveKitOpenResult>;
  openReleaseLiveSmokeKit: (
    target?: ReleaseLiveSmokeKitTarget,
  ) => Promise<ReleaseLiveSmokeKitOpenResult>;
  openReleaseOperatorRunnerKit: (
    target?: ReleaseOperatorRunnerKitTarget,
  ) => Promise<ReleaseOperatorRunnerKitOpenResult>;
  openReleaseUnblockKit: (target?: ReleaseUnblockKitTarget) => Promise<ReleaseUnblockKitOpenResult>;
  loadChatThreads: <TThread = unknown>() => Promise<LocalMemoryChatThreadsResult<TThread>>;
  loadWorkSessionWorkspace: (expectedRoot?: string) => Promise<WorkSessionWorkspaceResult>;
  updateWorkSessionWorkspace: (command: WorkSessionWorkspaceCommand, expectedRoot?: string) => Promise<WorkSessionWorkspaceResult>;
  saveChatThreads: <TThread = unknown>(threads: TThread[], expectedRoot?: string) => Promise<LocalMemoryStatusResult>;
  loadAppProfile: () => Promise<LocalMemoryAppProfileResult>;
  saveAppProfile: (profile: LocalMemoryAppProfile) => Promise<LocalMemoryAppProfileResult>;
  inspectPortableMemory: () => Promise<LocalMemoryPortableInspectionResult>;
  listWorkspaceSkillAcquisitionProposals: (
    workspaceId?: string,
  ) => Promise<LocalMemoryWorkspaceSkillLifecycleResult>;
  confirmWorkspaceSkillDownloadInstall: (payload: {
    workspaceId?: string;
    proposalId: string;
    requestFingerprint: string;
    decisionId: string;
    decision: "approve_once" | "decline";
  }) => Promise<LocalMemoryWorkspaceSkillDecisionResult>;
  confirmWorkspaceSkillActivation: (payload: {
    workspaceId?: string;
    proposalId: string;
    requestFingerprint: string;
    decisionId: string;
    decision: "activate" | "keep_inactive";
    targetAgentId: string;
  }) => Promise<LocalMemoryWorkspaceSkillDecisionResult>;
  saveWorkDecisions: (payload: {
    decisions: LocalMemoryWorkDecisionInput[];
    teammateId?: string;
    teammateName?: string;
    source?: string;
  }) => Promise<LocalMemoryWorkDecisionResult>;
  saveWorkLearning: (payload: LocalMemoryWorkLearningInput & {
    records?: LocalMemoryWorkLearningInput[];
  }) => Promise<LocalMemoryWorkLearningResult>;
  listWorkPatterns: () => Promise<LocalMemoryWorkLearningResult>;
  updateWorkPattern: (payload: {
    id: string;
    patch: Partial<LocalMemoryWorkLearningInput>;
  }) => Promise<LocalMemoryWorkLearningResult>;
  removeWorkPattern: (payload: {
    id: string;
  }) => Promise<LocalMemoryWorkLearningResult>;
  listLearningSources: () => Promise<LocalMemoryLearningSourcesResult>;
  upsertLearningSources: (payload: {
    sources?: Partial<LocalMemoryLearningSource>[];
    folders?: DocumentLearningFolderSource[];
    source?: string;
  }) => Promise<LocalMemoryLearningSourcesResult>;
  removeLearningSource: (payload: {
    id?: string;
    path?: string;
  }) => Promise<LocalMemoryLearningSourcesResult>;
  saveDelegationArtifact: (
    payload: LocalMemoryDelegationArtifactInput,
  ) => Promise<LocalMemoryDelegationArtifactResult>;
  listDelegationArtifacts: () => Promise<LocalMemoryDelegationArtifactListResult>;
  openDelegationArtifact: (payload: {
    artifactId?: string;
    relativePath?: string;
  }) => Promise<LocalMemoryDelegationArtifactOpenResult>;
  openLocalMemoryFile: (payload: {
    relativePath: string;
  }) => Promise<LocalMemoryFileOpenResult>;
  recordDelegationArtifactDecision: (
    payload: LocalMemoryDelegationArtifactDecisionInput,
  ) => Promise<LocalMemoryDelegationArtifactDecisionResult>;
  recordHomeApprovalDecisionReceipt: (
    payload: LocalMemoryHomeApprovalDecisionReceiptInput,
  ) => Promise<LocalMemoryHomeApprovalDecisionReceiptResult>;
  listHomeApprovalDecisionReceipts: () => Promise<LocalMemoryHomeApprovalDecisionReceiptResult>;
  loadLocalMemoryPromptContext: (payload?: {
    teammateId?: string;
    maxChars?: number;
  }) => Promise<LocalMemoryPromptContextResult>;
  loadLearningLessons: (payload?: {
    teammateId?: string;
  }) => Promise<LocalMemoryLearningLessonsResult>;
  applyLearningLessons: (payload: {
    edits: LearningLessonEdit[];
  }) => Promise<LocalMemoryLearningLessonsResult>;
  rollbackLearningLessons: (payload: {
    applied: AppliedLearningLessonEdit[];
  }) => Promise<LocalMemoryLearningLessonsResult>;
  decideLearningProposal: (payload: {
    proposalId: string;
    decision: "approve" | "reject";
  }) => Promise<LocalMemoryLearningLessonsResult>;
  listTasks: () => Promise<TaskLedgerResult>;
  runTask: (payload: TaskExecutionInput) => Promise<TaskExecutionResult>;
  controlTaskExecution: (payload: { taskId: string; action: "pause" | "resume" | "retry" }) => Promise<TaskExecutionResult>;
  upsertTasks: (payload: { tasks: TaskLedgerDraft[] }) => Promise<TaskLedgerResult>;
  answerTaskQuestion: (payload: { taskId: string; answer: string; askedAt?: string }) => Promise<TaskLedgerResult>;
  completeTask: (payload: { taskId: string; result?: string }) => Promise<TaskLedgerResult>;
  loadBackgroundDigestStatus: () => Promise<BackgroundDigestStatusResult>;
  setBackgroundDigestEnabled: (payload: {
    enabled: boolean;
  }) => Promise<BackgroundDigestStatusResult>;
  chooseDocumentLearningFiles: () => Promise<DocumentLearningSelectionResult>;
  importDocumentLearningFiles: (
    files: File[],
    sourceKind?: "paste" | "drop" | "renderer",
  ) => Promise<DocumentLearningSelectionResult>;
  chooseDocumentLearningFolders: (payload?: {
    knownFolder?: "desktop" | "documents" | "downloads" | "home" | "";
    namedFolderHint?: string;
    paths?: string[];
    maxFiles?: number;
    maxDepth?: number;
  }) => Promise<DocumentLearningSelectionResult>;
  chooseDocumentLearningRoot: () => Promise<DocumentLearningRootResult>;
  classifyDocumentLearning: (payload: {
    localStorageRoot?: string;
    selectedKinds?: string[];
    files: DocumentLearningFileRecord[];
    searchQuery?: string;
    activityEventId?: string;
  }) => Promise<DocumentLearningClassifyResult>;
  createDocumentLearningFolderPlan: (payload: {
    localStorageRoot?: string;
    selectedKinds?: string[];
    files: DocumentLearningFileRecord[];
  }) => Promise<DocumentLearningFolderPlanResult>;
  stageMailAttachmentFolderPlan: (
    payload: MailAttachmentFolderPlanPayload,
  ) => Promise<MailAttachmentFolderPlanResult>;
  previewDocumentLearningFolderPlan: (payload: {
    localStorageRoot?: string;
  }) => Promise<DocumentLearningFolderPlanPreviewResult>;
  applyDocumentLearningFolderPlan: (payload: {
    localStorageRoot?: string;
    planPath?: string;
    organizedRoot?: string;
    collisionPolicy?: "rename" | "skip" | string;
    excludedOperationIds?: string[];
    excludedPathKeywords?: string[];
    confirmationText?: string;
    finalApproval?: boolean;
  }) => Promise<DocumentLearningFolderPlanApplyResult>;
  revertDocumentLearningFolderPlan: (payload: {
    localStorageRoot?: string;
    manifestPath?: string;
    confirmationText?: string;
    finalApproval?: boolean;
  }) => Promise<DocumentLearningFolderPlanApplyResult>;
  searchDocumentLearningIndex: (payload: {
    localStorageRoot?: string;
    query: string;
    /** 정리함에서 훑어볼 때 더 많이 가져온다. 생략하면 데스크톱 기본값. */
    limit?: number;
    offset?: number;
  }) => Promise<DocumentLearningIndexSearchResult>;
  openDocumentLearningIndex: (payload: {
    localStorageRoot?: string;
  }) => Promise<DocumentLearningOpenResult>;
  openDocumentLearningFile: (payload: {
    path: string;
  }) => Promise<DocumentLearningOpenResult>;
  getDocumentLearningSupervisorStatus: () => Promise<DocumentLearningSupervisorResult>;
  pauseDocumentLearningSupervisorSource: (sourceId: string) => Promise<DocumentLearningSupervisorResult>;
  resumeDocumentLearningSupervisorSource: (sourceId: string) => Promise<DocumentLearningSupervisorResult>;
  revokeDocumentLearningSupervisorSource: (sourceId: string) => Promise<DocumentLearningSupervisorResult>;
  reconcileDocumentLearningSupervisorSource: (sourceId: string) => Promise<DocumentLearningSupervisorResult>;
  acknowledgeDocumentLearningSupervisorTeammateProposal: (
    sourceId: string,
    draftId: string,
    proposalId: string,
  ) => Promise<DocumentLearningSupervisorResult>;
  revealDocumentLearningPath: (payload: {
    path: string;
  }) => Promise<DocumentLearningOpenResult>;
  loadAgentOrg: () => Promise<AgentOrgLoadResult>;
  saveAgentOrg: (payload: {
    blueprint?: Record<string, unknown>;
    specVersions?: Array<Record<string, unknown>>;
    proposals?: Array<Record<string, unknown>>;
  }) => Promise<AgentOrgSaveResult>;
  recordAgentOrgPerformance: (record: Record<string, unknown>) => Promise<AgentOrgPerformanceResult>;
  stageAgentOrgProposal: (proposalCard: Record<string, unknown>) => Promise<AgentOrgProposalStageResult>;
  getAgentRuntimeStatus: () => Promise<AgentRuntimeStatus>;
  runAgentSession: (payload: {
    mode: AgentCapabilityRecord["id"];
    text?: string;
    teammateId?: string;
    teammateName?: string;
    teammateChannelName?: string;
    teammateRoleTitle?: string;
    teammateTeamLabel?: string;
    teammateTemplateId?: string;
    skillIds?: string[];
    instructions?: string[];
    memoryPaths?: AgentSessionRecord["memoryPaths"];
  }) => Promise<AgentSessionResult>;
  getPublicTriggerRelayStatus: () => Promise<PublicTriggerRelayStatus>;
  pullPublicTriggerRelay: () => Promise<{
    status: string;
    accepted?: boolean;
    eventsPulled?: number;
    eventsDispatched?: number;
    userMessage?: string;
    externalMutation: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  }>;
  getDesktopControlStatus: (payload?: {
    featureEnabled?: boolean;
  }) => Promise<DesktopControlStatusResult>;
  requestDesktopControlAction: (
    payload: DesktopControlActionPayload,
  ) => Promise<DesktopControlDispatchResult>;
  confirmDesktopControlAction: (
    payload: DesktopControlConfirmPayload,
  ) => Promise<DesktopControlDispatchResult>;
};

export type LocalWorkflowResult = {
  status: string;
  userMessage: string;
  outputDir?: string;
  report?: {
    status: string;
    summary: string;
    createdWorkItemsCount: number;
    approvalQueueCount: number;
    calendarArtifactCount: number;
    workItems: WorkItem[];
    auditMessages: string[];
  };
};

export type LocalWorkflowOpenOutputResult = {
  status: string;
  userMessage: string;
  outputDir?: string;
  errorMessage?: string;
};

declare global {
  interface Window {
    modyCrewDesktopBridge?: {
      documentProduction?: (payload: DocumentProductionPayload) => Promise<DocumentProductionResult>;
      dailySkills?: (
        payload: { kind: "catalog" } | ({ kind: "lookup" } & DailySkillLookupPayload),
      ) => Promise<DailySkillCatalogResult | DailySkillLookupResult>;
      companyAutomation?: (payload: CompanyAutomationPayload) => Promise<CompanyAutomationResult>;
      googleDriveFiles?: (payload: GoogleDriveFilesPayload) => Promise<GoogleDriveFilesResult>;
      fetchInbox?: () => Promise<WorkItem[]>;
      fetchHandledInbox?: DesktopBridgeApi["fetchHandledInbox"];
      setInboxCardDisposition?: DesktopBridgeApi["setInboxCardDisposition"];
      fetchHeaderMetrics?: () => Promise<WorkbenchHeaderMetrics>;
      fetchInboxRevision?: () => Promise<InboxRevisionResult>;
      retryInboxSave?: () => Promise<InboxSaveResult>;
      runLocalWorkflow?: (text: string) => Promise<LocalWorkflowResult>;
      openLocalWorkflowOutput?: () => Promise<LocalWorkflowOpenOutputResult>;
      readSelectedWorkActionEvents?: () => Promise<SelectedWorkActionEventsResult>;
      recordSelectedWorkActionEvent?: (
        event: SelectedWorkActionEvent,
      ) => Promise<SelectedWorkActionEventsResult>;
      recordReleaseReadinessVirtualOfficeEvent?: () => Promise<SelectedWorkActionEventsResult>;
      updateSelectedWorkActionEvent?: (
        eventId: string,
        patch: Pick<SelectedWorkActionEvent, "status" | "detail"> &
          Partial<Pick<SelectedWorkActionEvent, "evidence" | "kind" | "sourceLabel" | "metrics" | "auditTrail">>,
      ) => Promise<SelectedWorkActionEventsResult>;
      approveDraft?: (workItemId: string) => Promise<DraftApprovalResult>;
      openApprovedOutput?: (workItemId: string) => Promise<ApprovedOutputOpenResult>;
      stageFinalAction?: (workItemId: string, actionKind: FinalActionKind) => Promise<FinalActionStageResult>;
      prepareFinalConfirmation?: (
        workItemId: string,
        options?: FinalConfirmationPrepareOptions,
      ) => Promise<FinalConfirmationPrepareResult>;
      runFinalActionDryRun?: (
        workItemId: string,
        values: Record<string, string>,
      ) => Promise<FinalActionDryRunResult>;
      executeFinalAction?: (
        workItemId: string,
        confirmation: {
          finalUserPresence: true;
          confirmPhrase: string;
          dryRunId: string;
          values?: Record<string, string>;
          liveProviderExecutionEnabled?: boolean;
          advancedLiveExecutionAcknowledged?: boolean;
          advancedLiveExecutionPhrase?: string;
          advancedLiveExecutionEnabledAt?: string;
        },
      ) => Promise<FinalActionExecutionResult>;
      stageDelegationActionQueueItem?: (
        queueItem: LocalMemoryDelegationActionQueueRecord,
      ) => Promise<DelegationQueueStageResult>;
      confirmScheduleTime?: (
        workItemId: string,
        values: {
          label?: string;
          startsAt: string;
          endsAt?: string;
        },
      ) => Promise<ScheduleTimeConfirmationResult>;
      requestChange?: (workItemId: string, instruction: string) => Promise<{ status: string }>;
      stageMailDraft?: (draft: MailDraftStagePayload) => Promise<MailDraftStageResult>;
      redraftMailReply?: (workItemId: string, instruction: string, options?: MailRedraftOptions) => Promise<MailRedraftResult>;
      holdAction?: (workItemId: string) => Promise<{ status: string }>;
      rejectAction?: (workItemId: string, reason: string) => Promise<{ status: string }>;
      setCardAssignee?: (workItemId: string, assignee: CardAssigneeChoice) => Promise<CardAssigneeUpdateResult>;
      connectConnector?: (
        connectorId: string,
        payload: ConnectConnectorPayload,
      ) => Promise<ConnectConnectorResult>;
      listConnectorStatuses?: () => Promise<ConnectorStatusListResult>;
      discoverMailServer?: (payload: { email: string }) => Promise<MailServerDiscoveryResult>;
        getConnectorChatContext?: () => Promise<ConnectorChatContext>;
      getProviderOAuthPreflight?: () => Promise<ProviderOAuthPreflightResult>;
      /** 메일 답장 서명·말투 전용(writing_profile_* 만 통과). */
      mailWritingProfile?: (payload: MailWritingProfilePayload) => Promise<MailWritingProfileResult>;
      runMailWorkIntake?: (payload?: {
        kind?: "run" | "review_recipient_list" | "run_mobile_share" | "run_live_e2e_rehearsal" | "download_imap_attachments";
        connectorId?: string;
        mailbox?: string;
        limit?: number;
        activityEventId?: string;
        teammateId?: string;
        teammateName?: string;
        scenarioFocus?: MailWorkScenarioFocus;
        generateDrafts?: boolean;
        filePath?: string;
        path?: string;
        sourceLabel?: string;
        sourceType?: string;
        rows?: Array<Record<string, unknown>>;
        messages?: MobileSharedMailMessageInput[];
        reportChannelId?: string;
        writingProfile?: MobileMailShareIntakePayload["writingProfile"];
      }) => Promise<MailWorkIntakeResult>;
      listMailMessages?: (payload?: {
        accountId?: string;
        limit?: number;
        offset?: number;
      }) => Promise<MailLedgerPage>;
      searchMail?: (payload: {
        query: string;
        connectorId?: string;
        mailbox?: string;
        limit?: number;
      }) => Promise<{ status: string; userMessage?: string } & Record<string, unknown>>;
      readMail?: (payload: {
        messageId: string;
        fullBody?: boolean;
        conversation?: boolean;
        attachmentKey?: string;
        connectorId?: string;
        mailbox?: string;
        limit?: number;
      }) => Promise<{ status: string; userMessage?: string } & Record<string, unknown>>;
      draftMail?: (payload: {
        request: string;
        to?: string;
        subject?: string;
        replyToMessageId?: string;
        connectorId?: string;
        mailbox?: string;
      }) => Promise<{ status: string; userMessage?: string } & Record<string, unknown>>;
      runMailLiveE2ERehearsal?: (payload?: {
        connectorId?: string;
        mailbox?: string;
        limit?: number;
        webmailFallbackReady?: boolean;
        writeEvidenceTemplate?: boolean;
        importManualEvidence?: boolean;
        manualEvidencePath?: string;
        manualEvidence?: {
          connectedProviderIds?: string[];
          securePollingPrepared?: boolean;
          securePollingEnabled?: boolean;
          newMailSignalCount?: number;
          messageCount?: number;
          ignoredItemsCount?: number;
          approvalQueueCount?: number;
          attachmentCandidateCount?: number;
          profileReady?: boolean;
          calendarCandidateCount?: number;
          webmailDomCaptureStatus?: string;
          webmailDomExtractionStatus?: string;
          webmailDomRowCount?: number;
          webmailDomExtractedCount?: number;
          webmailBodyPreviewAllowedCount?: number;
          webmailBodyPreviewSkippedBeforeBodyCount?: number;
          approvalNotificationDraftReady?: boolean;
          approvalNotificationChannelReady?: boolean;
          approvalNotificationSent?: boolean;
          approvalNotificationTargetCount?: number;
          approvalNotificationProviderMessageId?: string;
          evidenceSource?: string;
        };
      }) => Promise<MailLiveE2ERehearsalResult>;
      openMailLiveE2EReport?: () => Promise<MailLiveE2EReportOpenResult>;
      downloadMailAttachmentsToStaging?: (payload?: {
        connectorId?: string;
        providerId?: string;
        mailbox?: string;
        mailboxLabel?: string;
        uid?: number;
        messageUid?: number;
        messageId?: string;
        localStorageRoot?: string;
        downloadRootPath?: string;
        maxAttachments?: number;
        maxBytesPerAttachment?: number;
      }) => Promise<MailAttachmentDownloadResult>;
      runMobileMailShareIntake?: (payload: MobileMailShareIntakePayload) => Promise<MailWorkIntakeResult>;
      reviewMailRecipientList?: (payload?: {
        filePath?: string;
        path?: string;
        sourceLabel?: string;
        sourceType?: string;
        rows?: Array<Record<string, unknown>>;
      }) => Promise<MailWorkIntakeResult>;
      sendApprovalNotification?: (payload?: {
        channel?: "telegram";
        targetWorkItemId?: string;
        targetWorkItemIds?: string[];
        notificationTargetIds?: string[];
        mobileReceiveFilterIds?: string[];
        mobileReceiveFilterSummary?: string;
        digestCount?: number;
        firstTitle?: string;
        sourceLabel?: string;
      }) => Promise<ApprovalNotificationResult>;
      applyChannelDecision?: (payload?: {
        channel?: "telegram" | "slack" | string;
        senderId?: string;
        userId?: string;
        messageText?: string;
        text?: string;
        receivedAt?: string;
      }) => Promise<ChannelDecisionResult>;
        saveAIProviderKey?: (
          provider: string,
          payload: SaveAIProviderKeyPayload,
        ) => Promise<AIProviderKeyStatus>;
        getJevMailClassificationStatus?: () => Promise<JevMailClassificationStatus>;
        saveJevMailClassification?: (
          payload: SaveJevMailClassificationPayload,
        ) => Promise<JevMailClassificationStatus>;
        testJevMailClassification?: () => Promise<JevMailClassificationStatus>;
        disconnectJevMailClassification?: () => Promise<JevMailClassificationStatus>;
        saveAIProviderModel?: (
          provider: string,
          payload: { model: string },
        ) => Promise<AIProviderKeyStatus>;
        listAIProviderModels?: (provider: string, options?: { forceRefresh?: boolean }) => Promise<AIProviderModelListResult>;
        listLocalAIModels?: (payload?: { baseUrl?: string }) => Promise<LocalAIModelListResult>;
        listSubscriptionAIRuntimes?: () => Promise<{ runtimes: SubscriptionAIRuntime[] }>;
        startSubscriptionAILogin?: (provider: string) => Promise<{ started: boolean; userMessage?: string }>;
        startAIProviderOAuth?: (
          provider: string,
          options?: StartAIProviderOAuthOptions,
        ) => Promise<AIProviderKeyStatus>;
      getAIUsageSummary?: (days: number, includeProviderLimits?: boolean) => Promise<AIUsageSummaryResult>;
      getAIProviderStatus?: () => Promise<{
        status: string;
        providers: AIProviderKeyStatus[];
        activeProvider?: string;
      }>;
      getAIRuntimeLiveProofs?: () => Promise<AIRuntimeLiveProofsResult>;
      generateAIText?: (payload: AITextGenerationPayload) => Promise<AITextGenerationResult>;
      generateAITextStream?: (
        payload: AITextGenerationPayload,
        onChunk: (delta: string) => void,
      ) => Promise<AITextGenerationResult>;
      cancelAITextStream?: (streamId: string) => Promise<AITextStreamCancelResult>;
      getTriggerSettings?: () => Promise<TriggerSettingsResult>;
      updateTriggerRule?: (
        rule: Partial<TriggerRuleRecord> & { id: string },
      ) => Promise<TriggerSettingsResult>;
      getScheduleNotificationStatus?: () => Promise<ScheduleNotificationStatusResult>;
      requestScheduleNotificationPermission?: () => Promise<ScheduleNotificationStatusResult>;
      runTriggerDueChecks?: () => Promise<TriggerRunnerResult>;
      openTriggerRunnerReport?: () => Promise<TriggerRunnerReportOpenResult>;
      runUnifiedWorkSync?: (payload?: {
        limit?: number;
        suppressExternalNotifications?: boolean;
      }) => Promise<WorkSyncResult>;
      getToolchainStatus?: () => Promise<ToolchainStatusResult>;
      prepareToolchain?: () => Promise<ToolchainStatusResult>;
      installCodexRecoveryTool?: () => Promise<CodexRecoveryInstallResult>;
      getLocalMemoryStatus?: () => Promise<LocalMemoryStatusResult>;
      chooseLocalMemoryRoot?: () => Promise<LocalMemoryStatusResult>;
      openWorkspaceWindow?: (target: "office") => Promise<WorkspaceWindowResult>;
      returnToMainWindow?: () => Promise<WorkspaceWindowResult>;
      onFocusWorkItem?: (listener: (request: DesktopWorkItemFocusPayload) => void) => () => void;
      takePendingWorkItemFocus?: () => Promise<DesktopWorkItemFocusPayload | null>;
      onInboxChanged?: (listener: (change: DesktopInboxAttention) => void) => () => void;
      getInboxAttention?: () => Promise<DesktopInboxAttention>;
      openWorkerCompanionWindow?: (options?: WorkerCompanionWindowOpenOptions) => Promise<WorkspaceWindowResult>;
      openReleaseFieldGuide?: () => Promise<ReleaseFieldGuideOpenResult>;
      openFirstUserObservationKit?: (
        target?: FirstUserObservationKitTarget,
      ) => Promise<FirstUserObservationKitOpenResult>;
      openReleaseAIRuntimeLiveKit?: (
        target?: ReleaseAIRuntimeLiveKitTarget,
      ) => Promise<ReleaseAIRuntimeLiveKitOpenResult>;
      openReleaseLiveSmokeKit?: (
        target?: ReleaseLiveSmokeKitTarget,
      ) => Promise<ReleaseLiveSmokeKitOpenResult>;
      openReleaseOperatorRunnerKit?: (
        target?: ReleaseOperatorRunnerKitTarget,
      ) => Promise<ReleaseOperatorRunnerKitOpenResult>;
      openReleaseUnblockKit?: (target?: ReleaseUnblockKitTarget) => Promise<ReleaseUnblockKitOpenResult>;
      loadChatThreads?: <TThread = unknown>() => Promise<LocalMemoryChatThreadsResult<TThread>>;
      loadWorkSessionWorkspace?: (expectedRoot?: string) => Promise<WorkSessionWorkspaceResult>;
      updateWorkSessionWorkspace?: (command: WorkSessionWorkspaceCommand, expectedRoot?: string) => Promise<WorkSessionWorkspaceResult>;
      saveChatThreads?: <TThread = unknown>(threads: TThread[], expectedRoot?: string) => Promise<LocalMemoryStatusResult>;
      loadAppProfile?: () => Promise<LocalMemoryAppProfileResult>;
      saveAppProfile?: (profile: LocalMemoryAppProfile) => Promise<LocalMemoryAppProfileResult>;
      inspectPortableMemory?: () => Promise<LocalMemoryPortableInspectionResult>;
      listWorkspaceSkillAcquisitionProposals?: (
        workspaceId?: string,
      ) => Promise<LocalMemoryWorkspaceSkillLifecycleResult>;
      confirmWorkspaceSkillDownloadInstall?: (payload: {
        workspaceId?: string;
        proposalId: string;
        requestFingerprint: string;
        decisionId: string;
        decision: "approve_once" | "decline";
      }) => Promise<LocalMemoryWorkspaceSkillDecisionResult>;
      confirmWorkspaceSkillActivation?: (payload: {
        workspaceId?: string;
        proposalId: string;
        requestFingerprint: string;
        decisionId: string;
        decision: "activate" | "keep_inactive";
        targetAgentId: string;
      }) => Promise<LocalMemoryWorkspaceSkillDecisionResult>;
      saveWorkDecisions?: (payload: {
        decisions: LocalMemoryWorkDecisionInput[];
        teammateId?: string;
        teammateName?: string;
        source?: string;
      }) => Promise<LocalMemoryWorkDecisionResult>;
      saveWorkLearning?: (payload: LocalMemoryWorkLearningInput & {
        records?: LocalMemoryWorkLearningInput[];
      }) => Promise<LocalMemoryWorkLearningResult>;
      listWorkPatterns?: () => Promise<LocalMemoryWorkLearningResult>;
      updateWorkPattern?: (payload: {
        id: string;
        patch: Partial<LocalMemoryWorkLearningInput>;
      }) => Promise<LocalMemoryWorkLearningResult>;
      removeWorkPattern?: (payload: {
        id: string;
      }) => Promise<LocalMemoryWorkLearningResult>;
      listLearningSources?: () => Promise<LocalMemoryLearningSourcesResult>;
      upsertLearningSources?: (payload: {
        sources?: Partial<LocalMemoryLearningSource>[];
        folders?: DocumentLearningFolderSource[];
        source?: string;
      }) => Promise<LocalMemoryLearningSourcesResult>;
      removeLearningSource?: (payload: {
        id?: string;
        path?: string;
      }) => Promise<LocalMemoryLearningSourcesResult>;
      saveDelegationArtifact?: (
        payload: LocalMemoryDelegationArtifactInput,
      ) => Promise<LocalMemoryDelegationArtifactResult>;
      listDelegationArtifacts?: () => Promise<LocalMemoryDelegationArtifactListResult>;
      openDelegationArtifact?: (payload: {
        artifactId?: string;
        relativePath?: string;
      }) => Promise<LocalMemoryDelegationArtifactOpenResult>;
      openLocalMemoryFile?: (payload: {
        relativePath: string;
      }) => Promise<LocalMemoryFileOpenResult>;
      recordDelegationArtifactDecision?: (
        payload: LocalMemoryDelegationArtifactDecisionInput,
      ) => Promise<LocalMemoryDelegationArtifactDecisionResult>;
      recordHomeApprovalDecisionReceipt?: (
        payload: LocalMemoryHomeApprovalDecisionReceiptInput,
      ) => Promise<LocalMemoryHomeApprovalDecisionReceiptResult>;
      listHomeApprovalDecisionReceipts?: () => Promise<LocalMemoryHomeApprovalDecisionReceiptResult>;
      loadLocalMemoryPromptContext?: (payload?: {
        teammateId?: string;
        maxChars?: number;
      }) => Promise<LocalMemoryPromptContextResult>;
      loadLearningLessons?: (payload?: {
        teammateId?: string;
      }) => Promise<LocalMemoryLearningLessonsResult>;
      applyLearningLessons?: (payload: {
        edits: LearningLessonEdit[];
      }) => Promise<LocalMemoryLearningLessonsResult>;
      rollbackLearningLessons?: (payload: {
        applied: AppliedLearningLessonEdit[];
      }) => Promise<LocalMemoryLearningLessonsResult>;
      decideLearningProposal?: (payload: {
        proposalId: string;
        decision: "approve" | "reject";
      }) => Promise<LocalMemoryLearningLessonsResult>;
      listTasks?: () => Promise<TaskLedgerResult>;
      runTask?: (payload: TaskExecutionInput) => Promise<TaskExecutionResult>;
      controlTaskExecution?: (payload: { taskId: string; action: "pause" | "resume" | "retry" }) => Promise<TaskExecutionResult>;
      upsertTasks?: (payload: { tasks: TaskLedgerDraft[] }) => Promise<TaskLedgerResult>;
      answerTaskQuestion?: (payload: { taskId: string; answer: string; askedAt?: string }) => Promise<TaskLedgerResult>;
      completeTask?: (payload: { taskId: string; result?: string }) => Promise<TaskLedgerResult>;
      loadBackgroundDigestStatus?: () => Promise<BackgroundDigestStatusResult>;
      setBackgroundDigestEnabled?: (payload: {
        enabled: boolean;
      }) => Promise<BackgroundDigestStatusResult>;
      chooseDocumentLearningFiles?: () => Promise<DocumentLearningSelectionResult>;
      importDocumentLearningFiles?: (
        files: File[],
        sourceKind?: "paste" | "drop" | "renderer",
      ) => Promise<DocumentLearningSelectionResult>;
      chooseDocumentLearningFolders?: (payload?: {
        knownFolder?: "desktop" | "documents" | "downloads" | "home" | "";
        namedFolderHint?: string;
        paths?: string[];
        maxFiles?: number;
        maxDepth?: number;
      }) => Promise<DocumentLearningSelectionResult>;
      chooseDocumentLearningRoot?: () => Promise<DocumentLearningRootResult>;
      classifyDocumentLearning?: (payload: {
        localStorageRoot?: string;
        selectedKinds?: string[];
        files: DocumentLearningFileRecord[];
        searchQuery?: string;
        activityEventId?: string;
      }) => Promise<DocumentLearningClassifyResult>;
      createDocumentLearningFolderPlan?: (payload: {
        localStorageRoot?: string;
        selectedKinds?: string[];
        files: DocumentLearningFileRecord[];
      }) => Promise<DocumentLearningFolderPlanResult>;
      stageMailAttachmentFolderPlan?: (
        payload: MailAttachmentFolderPlanPayload,
      ) => Promise<MailAttachmentFolderPlanResult>;
      previewDocumentLearningFolderPlan?: (payload: {
        localStorageRoot?: string;
      }) => Promise<DocumentLearningFolderPlanPreviewResult>;
      applyDocumentLearningFolderPlan?: (payload: {
        localStorageRoot?: string;
        planPath?: string;
        organizedRoot?: string;
        collisionPolicy?: "rename" | "skip" | string;
        excludedOperationIds?: string[];
        excludedPathKeywords?: string[];
        confirmationText?: string;
        finalApproval?: boolean;
      }) => Promise<DocumentLearningFolderPlanApplyResult>;
      revertDocumentLearningFolderPlan?: (payload: {
        localStorageRoot?: string;
        manifestPath?: string;
        confirmationText?: string;
        finalApproval?: boolean;
      }) => Promise<DocumentLearningFolderPlanApplyResult>;
      searchDocumentLearningIndex?: (payload: {
        localStorageRoot?: string;
        query: string;
        limit?: number;
        offset?: number;
      }) => Promise<DocumentLearningIndexSearchResult>;
      openDocumentLearningIndex?: (payload: {
        localStorageRoot?: string;
      }) => Promise<DocumentLearningOpenResult>;
      openDocumentLearningFile?: (payload: {
        path: string;
      }) => Promise<DocumentLearningOpenResult>;
      getDocumentLearningSupervisorStatus?: () => Promise<DocumentLearningSupervisorResult>;
      pauseDocumentLearningSupervisorSource?: (sourceId: string) => Promise<DocumentLearningSupervisorResult>;
      resumeDocumentLearningSupervisorSource?: (sourceId: string) => Promise<DocumentLearningSupervisorResult>;
      revokeDocumentLearningSupervisorSource?: (sourceId: string) => Promise<DocumentLearningSupervisorResult>;
      reconcileDocumentLearningSupervisorSource?: (sourceId: string) => Promise<DocumentLearningSupervisorResult>;
      acknowledgeDocumentLearningSupervisorTeammateProposal?: (
        sourceId: string,
        draftId: string,
        proposalId: string,
      ) => Promise<DocumentLearningSupervisorResult>;
      revealDocumentLearningPath?: (payload: {
        path: string;
      }) => Promise<DocumentLearningOpenResult>;
      loadAgentOrg?: () => Promise<AgentOrgLoadResult>;
      saveAgentOrg?: (payload: {
        blueprint?: Record<string, unknown>;
        specVersions?: Array<Record<string, unknown>>;
        proposals?: Array<Record<string, unknown>>;
      }) => Promise<AgentOrgSaveResult>;
      recordAgentOrgPerformance?: (record: Record<string, unknown>) => Promise<AgentOrgPerformanceResult>;
      stageAgentOrgProposal?: (proposalCard: Record<string, unknown>) => Promise<AgentOrgProposalStageResult>;
      getAgentRuntimeStatus?: () => Promise<AgentRuntimeStatus>;
      runAgentSession?: (payload: {
        mode: AgentCapabilityRecord["id"];
        text?: string;
        teammateId?: string;
        teammateName?: string;
        teammateChannelName?: string;
        teammateRoleTitle?: string;
        teammateTeamLabel?: string;
        teammateTemplateId?: string;
        skillIds?: string[];
        instructions?: string[];
        memoryPaths?: AgentSessionRecord["memoryPaths"];
      }) => Promise<AgentSessionResult>;
      getPublicTriggerRelayStatus?: () => Promise<PublicTriggerRelayStatus>;
      pullPublicTriggerRelay?: () => Promise<{
        status: string;
        accepted?: boolean;
        eventsPulled?: number;
        eventsDispatched?: number;
        userMessage?: string;
        externalMutation: false;
        rawSecretMaterialStored: false;
        rawSecretMaterialReturned: false;
      }>;
      getDesktopControlStatus?: (payload?: {
        featureEnabled?: boolean;
      }) => Promise<DesktopControlStatusResult>;
      requestDesktopControlAction?: (
        payload: DesktopControlActionPayload,
      ) => Promise<DesktopControlDispatchResult>;
      confirmDesktopControlAction?: (
        payload: DesktopControlConfirmPayload,
      ) => Promise<DesktopControlDispatchResult>;
    };
  }
}

function hasNativeBridge(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = window.modyCrewDesktopBridge;
  return Boolean(
    bridge?.fetchInbox &&
      bridge.fetchHeaderMetrics &&
      bridge.runLocalWorkflow &&
      bridge.getAgentRuntimeStatus &&
      bridge.getDesktopControlStatus &&
      bridge.getTriggerSettings &&
      bridge.getScheduleNotificationStatus &&
      bridge.generateAIText &&
      bridge.runUnifiedWorkSync &&
      bridge.getToolchainStatus &&
      bridge.prepareToolchain &&
      bridge.getLocalMemoryStatus &&
      bridge.loadChatThreads &&
      bridge.saveChatThreads &&
      bridge.loadAppProfile &&
      bridge.saveAppProfile &&
      bridge.inspectPortableMemory &&
      bridge.listWorkspaceSkillAcquisitionProposals &&
      bridge.confirmWorkspaceSkillDownloadInstall &&
      bridge.confirmWorkspaceSkillActivation &&
      bridge.saveWorkDecisions &&
      bridge.saveWorkLearning &&
      bridge.saveDelegationArtifact &&
      bridge.listDelegationArtifacts &&
      bridge.openDelegationArtifact &&
      bridge.openLocalMemoryFile &&
      bridge.recordDelegationArtifactDecision &&
      bridge.stageDelegationActionQueueItem &&
      bridge.loadLocalMemoryPromptContext,
  );
}

const browserMobileMailShareFilterLabels: Record<string, string> = {
  approval_waiting: "승인 대기",
  urgent_risk: "긴급/위험",
  calendar_candidate: "일정 후보",
  follow_up: "후속 확인",
  digest_only: "요약만",
};

function runBrowserMobileMailShareIntake(payload: MobileMailShareIntakePayload): MailWorkIntakeResult {
  const now = new Date().toISOString();
  const messages = normalizeBrowserMobileShareMessages(payload.messages ?? [], now);
  const runner = new ModyMobileSharedMailWorkIntakeRunner({ now: () => new Date(now) });
  const result = runner.run({
    connectorId: payload.connectorId || "browser-phone-share",
    reportChannelId: "manual_console",
    messages,
    writingProfile: {
      toneLabel: payload.writingProfile?.toneLabel || "업무용 정중한 답장",
      formatLabel: payload.writingProfile?.formatLabel || "휴대폰 선택 메일 답장 초안",
      signature: payload.writingProfile?.signature,
      calendarPreference: payload.writingProfile?.calendarPreference || "일정 후보는 앱 최종 확인 전까지 등록하지 않음",
    },
  });
  const approvalPreviews = createBrowserMobileShareApprovalPreviews(result, now);
  const workReport = result.workReport ? sanitizeBrowserMailWorkReportForUi(result.workReport) : undefined;
  const workAnalysis = result.workAnalysis as unknown as MailWorkAnalysis | undefined;
  const response: MailWorkIntakeResult & Record<string, unknown> = {
    status: result.status,
    providerId: result.providerId,
    connectorId: result.connectorId,
    messageCount: result.providerRead?.messages.length ?? messages.length,
    createdWorkItemsCount: workReport?.createdWorkItemsCount ?? 0,
    approvalQueueCount: approvalPreviews.length,
    ignoredItemsCount: workReport?.ignoredItemsCount ?? 0,
    reviewItemsCount: workReport?.reviewItemsCount ?? 0,
    addedInboxItemsCount: approvalPreviews.length,
    approvalPreviews,
    workAnalysis,
    userMessage:
      result.status === "mobile_shared_mail_empty"
        ? result.userMessage
        : `${result.userMessage} 브라우저에서는 사용자가 넘긴 메일만 읽기 전용 후보로 정리했고, 실제 발송/일정 등록은 실행하지 않았습니다.`,
    auditMessages: [
      ...result.auditMessages,
      "browser_mobile_share_local_candidate_only",
      "user_supplied_phone_mail_only_no_mailbox_read",
    ],
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    appMayPersistSecret: false,
  };
  if (workReport) response.workReport = workReport;
  if (approvalPreviews.length > 0) {
    response.mailWorkExecutionReceipt = createBrowserMobileShareExecutionReceipt({
      now,
      connectorId: result.connectorId,
      messageCount: messages.length,
      approvalPreviews,
      workAnalysis,
    });
  }
  return response;
}

function normalizeBrowserMobileShareMessages(
  messages: MobileSharedMailMessageInput[],
  now: string,
): ModyMobileSharedMailPreview[] {
  return messages
    .map((message, index) => {
      const source: ModyMobileMailShareSource =
        message.source === "pwa_paste" || message.source === "manual_phone_forward" ? message.source : "mobile_share_sheet";
      return {
        id: cleanBridgeText(message.id) || `browser-phone-mail-${index + 1}`,
        from: cleanBridgeText(message.from) || "휴대폰에서 선택한 메일",
        subject: cleanBridgeText(message.subject) || "휴대폰에서 선택한 메일",
        bodyPreview: cleanBridgeText(message.bodyPreview),
        receivedAt: cleanBridgeIso(message.receivedAt, now),
        source,
        labels: Array.isArray(message.labels) ? message.labels.map(cleanBridgeText).filter(Boolean).slice(0, 8) : [],
        hasAttachments: Boolean(message.hasAttachments),
      };
    })
    .filter((message) => message.subject || message.bodyPreview);
}

function normalizeWorkerCompanionWindowSizePreset(value: unknown): "compact" | "standard" | "large" {
  return value === "compact" || value === "standard" || value === "large" ? value : "standard";
}

function normalizeWorkerCompanionWindowPositionPreset(value: unknown): "bottom_right" | "top_right" | "left_dock" {
  return value === "top_right" || value === "left_dock" || value === "bottom_right" ? value : "bottom_right";
}

function normalizeWorkerCompanionWindowMotionStyle(value: unknown): "calm" | "lively" {
  return value === "lively" || value === "calm" ? value : "calm";
}

function normalizeWorkerCompanionWindowAvatarMode(value: unknown): "base" | "custom" {
  return value === "custom" || value === "base" ? value : "base";
}

function createBrowserMobileShareApprovalPreviews(
  result: ReturnType<ModyMobileSharedMailWorkIntakeRunner["run"]>,
  now: string,
): MailWorkApprovalPreview[] {
  const candidates = result.workReport?.candidates ?? [];
  const previews = candidates.flatMap((candidate, index) => {
    if (!candidate.shouldCreateWorkItem) return [];
    const text = [
      candidate.title,
      candidate.summary,
      candidate.draftReply,
      candidate.calendarDraft,
      candidate.reportText,
      candidate.classification,
    ]
      .filter(Boolean)
      .join(" ");
    const ids = browserMobileShareFilterIdsForText(text, candidate.calendarDraft ? "create_calendar_event" : "send_email");
    const basePreview = {
      sourceLabel: `휴대폰 선택 메일 · ${result.connectorId}`,
      status: "approval_pending",
      countLabel: "1건",
      summary: candidate.summary,
      mobileReceiveFilterIds: ids,
      mobileReceiveFilterLabels: ids.map((id) => browserMobileMailShareFilterLabels[id]).filter(Boolean),
      requiresFinalUserPresence: true,
      externalMutation: false as const,
      rawSecretMaterialStored: false as const,
      rawSecretMaterialReturned: false as const,
      detectedIntentLabels: [
        candidate.calendarDraft ? "일정 후보" : "",
        /follow|remind|후속|리마인드|재확인|회신 대기/u.test(text) ? "후속 확인" : "",
        "휴대폰 선택 메일",
      ].filter(Boolean),
      approvalCandidateLabels: ["초안 확인", "수정 가능", "앱 최종 확인 전 실행 없음"],
      blockedReason: "휴대폰 선택 메일은 후보만 만들고 앱 최종 확인 전에는 외부 발송/일정 등록을 실행하지 않습니다.",
      checklist: ["답장/일정 필요 여부 확인", "본문과 수신자 확인", "최종 확인 전 외부 실행 없음"],
    };
    const items: MailWorkApprovalPreview[] = [];
    if (candidate.draftReply || candidate.approvalQueue.some((item) => item.operationKind === "send_email")) {
      items.push({
        ...basePreview,
        id: `browser-mobile-share-reply-${safeBridgeId(candidate.id || String(index + 1))}`,
        workItemId: `browser-mobile-share-${safeBridgeId(candidate.id || String(index + 1))}`,
        kind: "send_email",
        title: candidate.title || "휴대폰 선택 메일 답장",
        badge: "답장",
        draftBody: candidate.draftReply || candidate.reportText || candidate.summary,
        finalActionLabel: "메일 발송 최종 확인",
        mailWorkReview: {
          proof: "browser_mobile_share_to_workbench_candidate",
          originalSummary: candidate.summary,
          draftSummary: candidate.draftReply || candidate.summary,
          replyMethodLabel: "초안 수정 후 승인 발송",
          sendDecisionReason: candidate.summary,
          editFocusLabel: "수신자, 제목, 본문, 첨부, 위험 표현",
          finalApprovalBoundary: "앱 최종 확인 전 발송 없음",
          privacyBoundary: "사용자가 공유한 휴대폰 메일 요약만 처리",
          mobileReceiveFilterIds: ids,
          mobileReceiveFilterLabels: ids.map((id) => browserMobileMailShareFilterLabels[id]).filter(Boolean),
        },
      });
    }
    if (candidate.calendarDraft || candidate.approvalQueue.some((item) => item.operationKind === "create_calendar_event")) {
      const calendarIds = browserMobileShareFilterIdsForText(text, "create_calendar_event");
      items.push({
        ...basePreview,
        id: `browser-mobile-share-calendar-${safeBridgeId(candidate.id || String(index + 1))}`,
        workItemId: `browser-mobile-share-calendar-${safeBridgeId(candidate.id || String(index + 1))}`,
        kind: "create_calendar_event",
        title: `일정 등록 확인: ${candidate.title || "휴대폰 선택 메일"}`.slice(0, 160),
        badge: "일정",
        draftBody: candidate.calendarDraft || candidate.summary,
        finalActionLabel: "일정 등록 최종 확인",
        mobileReceiveFilterIds: calendarIds,
        mobileReceiveFilterLabels: calendarIds.map((id) => browserMobileMailShareFilterLabels[id]).filter(Boolean),
        checklist: ["일정 제목 확인", "시간/참석자 확인", "캘린더 등록은 앱 최종 확인 뒤 실행"],
      });
    }
    return items;
  });

  const followUpPlan = result.workAnalysis?.followUpPlan;
  if (followUpPlan?.status === "review_required") {
    previews.push({
      id: `browser-mobile-share-follow-up-${safeBridgeId(now)}`,
      workItemId: "browser-mobile-share-follow-up",
      kind: "follow_up_plan",
      title: "휴대폰 메일 후속 확인 계획",
      sourceLabel: `휴대폰 선택 메일 · ${result.connectorId}`,
      status: "approval_pending",
      countLabel: `${Math.max(result.workAnalysis?.stats?.followUpSignals ?? 0, 1)}건`,
      badge: "후속",
      draftBody: "",
      summary: [
        followUpPlan.nextCheckLabel ? `다음 확인: ${followUpPlan.nextCheckLabel}` : "",
        ...(followUpPlan.waitingSignals ?? []).slice(0, 3),
      ].filter(Boolean).join(" · "),
      finalActionLabel: "후속 확인 계획 검토",
      blockedReason: followUpPlan.approvalGate || "후속 확인은 알림/초안 후보만 만들고 자동 독촉 발송은 하지 않습니다.",
      checklist: ["후속 대상 확인", "다음 확인 시점 확인", "자동 독촉 발송 차단"],
      detectedIntentLabels: ["후속 확인", "회신 대기"],
      approvalCandidateLabels: ["다음 확인 시점", "리마인드 초안", "자동 독촉 차단"],
      mobileReceiveFilterIds: ["follow_up", "approval_waiting"],
      mobileReceiveFilterLabels: ["후속 확인", "승인 대기"],
      requiresFinalUserPresence: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
  }

  return previews.slice(0, 10);
}

function browserMobileShareFilterIdsForText(text: string, kind: string): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  if (kind === "create_calendar_event" || /일정|캘린더|미팅|회의|상담|예약|방문|시간|calendar|schedule|meeting/u.test(text)) {
    add("calendar_candidate");
  }
  if (/follow|remind|후속|리마인드|재확인|회신 대기|답변 대기/u.test(text)) add("follow_up");
  if (/긴급|위험|환불|계약|세무|공공|정산|청구|보안|첨부|파일|urgent|risk|contract|refund|invoice/u.test(text)) {
    add("urgent_risk");
  }
  if (/뉴스레터|광고|요약|공지|digest|summary|newsletter|marketing/u.test(text)) add("digest_only");
  add("approval_waiting");
  return ids;
}

function createBrowserMobileShareExecutionReceipt(input: {
  now: string;
  connectorId: string;
  messageCount: number;
  approvalPreviews: MailWorkApprovalPreview[];
  workAnalysis?: MailWorkAnalysis;
}): MailWorkExecutionReceipt {
  return {
    id: `browser-mobile-share-receipt-${safeBridgeId(input.now)}`,
    createdAt: input.now,
    workItemId: input.approvalPreviews[0]?.workItemId || "browser-mobile-share",
    title: `휴대폰 선택 메일 ${input.messageCount}건 업무대장 후보`,
    actionKind: "mobile_share_workbench_candidate",
    decision: "approval_required",
    providerLabel: "휴대폰 선택 메일",
    connectionLabel: input.connectorId,
    scenarioIds: ["mobile_review_handoff", "reply_draft", "calendar_candidate", "follow_up_tracking"],
    processingSteps: ["사용자 공유 메일만 읽기", "답장/일정/후속 후보 생성", "앱 최종 확인 전 외부 실행 차단"],
    approvalDigest: input.approvalPreviews.map((preview) => `${preview.badge || preview.kind}: ${preview.title}`).slice(0, 6),
    auditDigest: [
      "외부 메일함 읽기 없음",
      "사용자 제공 휴대폰 메일만 처리",
      "발송/일정 등록은 최종 확인 전 실행하지 않음",
    ],
    nextUserActions: ["업무대장 행 확인", "초안 수정", "승인함에서 최종 확인"],
    rollbackBasis: "브라우저 fallback은 외부 변경을 만들지 않아 되돌릴 실행 결과가 없습니다.",
    externalMutation: false,
    finalUserConfirmationRequired: true,
    rawAddressStored: false,
    rawSecretStored: false,
    rawMailBodyStored: false,
    privacyBoundary: "사용자가 공유한 휴대폰 메일 입력만 현재 세션의 후보로 사용합니다.",
    learningPatternDraft: {
      id: "browser-mobile-share-pattern",
      sourceKind: "mailops",
      sourceLabel: "휴대폰 선택 메일",
      summary: input.workAnalysis?.summary || "휴대폰 선택 메일을 업무대장 후보로 정리",
      signals: ["휴대폰 공유", "승인 전 발송 없음", "답장/일정/후속 분류"],
      metrics: {
        messageCount: input.messageCount,
        approvalPreviewCount: input.approvalPreviews.length,
      },
    },
  };
}

function sanitizeBrowserMailWorkReportForUi(report: ModyProviderWorkIntakeReport): ModyProviderWorkIntakeReport {
  return redactBrowserDirectMailPii(report) as ModyProviderWorkIntakeReport;
}

function redactBrowserDirectMailPii(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email-redacted]");
  }
  if (Array.isArray(value)) return value.map(redactBrowserDirectMailPii);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactBrowserDirectMailPii(item)]));
  }
  return value;
}

function cleanBridgeText(value: unknown): string {
  return typeof value === "string" ? value.replaceAll(/\s+/g, " ").trim() : "";
}

function cleanBridgeIso(value: unknown, fallback: string): string {
  const text = cleanBridgeText(value);
  if (text && !Number.isNaN(new Date(text).getTime())) return new Date(text).toISOString();
  return fallback;
}

function safeBridgeId(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 80) || "item";
}

function createDesktopRequiredAIRuntimeLiveProofs(): AIRuntimeLiveProofsResult {
  return {
    status: "desktop_required",
    proofCount: 0,
    verifiedCount: 0,
    proofs: [],
    userMessage: "AI 실기 리포트 확인은 설치된 Windows 앱에서만 가능합니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createDesktopRequiredDocumentLearningSupervisorResult(): DocumentLearningSupervisorResult {
  return {
    status: "desktop_required",
    stateStatus: "unavailable",
    started: false,
    sources: [],
    userMessage: "승인한 폴더의 지속 학습 관리는 설치된 데스크톱 앱에서만 사용할 수 있습니다.",
    externalMutation: false,
    rawSecretMaterialReturned: false,
  };
}

function createDesktopRequiredJevMailClassificationStatus(): JevMailClassificationStatus {
  return {
    status: "desktop_required",
    mode: "off",
    hasKey: false,
    allowContent: false,
    userMessage: "Jev 메일 분류 보조는 설치된 Windows 앱에서 이 PC에만 설정할 수 있습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}
export function createDesktopBridge(): DesktopBridgeApi {
  if (hasNativeBridge()) {
    const native = window.modyCrewDesktopBridge!;
    return {
      isAvailable: true,
      ...(native.getAIUsageSummary ? { getAIUsageSummary: (days: number, includeProviderLimits?: boolean) => native.getAIUsageSummary!(days, includeProviderLimits) } : {}),
      documentProduction: (payload) => native.documentProduction?.(payload) ?? Promise.resolve(desktopDocumentRequired()),
      dailySkillsCatalog: () =>
        native.dailySkills
          ? (native.dailySkills({ kind: "catalog" }) as Promise<DailySkillCatalogResult>)
          : Promise.resolve({ ok: false, status: "desktop_update_required", userMessage: "앱을 최신 버전으로 업데이트하면 일상 도구를 쓸 수 있어요." }),
      lookupDailySkill: (payload) =>
        native.dailySkills
          ? (native.dailySkills({ kind: "lookup", ...payload }) as Promise<DailySkillLookupResult>)
          : Promise.resolve({ ok: false, status: "desktop_update_required", userMessage: "앱을 최신 버전으로 업데이트하면 일상 도구를 쓸 수 있어요." }),
      companyAutomation: (payload) => native.companyAutomation?.(payload) ?? Promise.resolve(companyDesktopRequired()),
      googleDriveFiles: (payload) =>
        native.googleDriveFiles?.(payload) ??
        Promise.resolve({ status: "desktop_update_required", userMessage: "앱을 최신 버전으로 업데이트하면 드라이브 파일을 고를 수 있어요." }),
      fetchInbox: () =>
        native.fetchInbox?.() ?? Promise.reject(new Error("fetchInbox 미구현")),
      ...(native.fetchHandledInbox ? { fetchHandledInbox: () => native.fetchHandledInbox!() } : {}),
      ...(native.setInboxCardDisposition ? { setInboxCardDisposition: (request: Parameters<NonNullable<DesktopBridgeApi["setInboxCardDisposition"]>>[0]) => native.setInboxCardDisposition!(request) } : {}),
      fetchHeaderMetrics: () =>
        native.fetchHeaderMetrics?.() ??
        Promise.reject(new Error("fetchHeaderMetrics 미구현")),
      ...(native.fetchInboxRevision
        ? { fetchInboxRevision: () => native.fetchInboxRevision?.() ?? Promise.reject(new Error("fetchInboxRevision 미구현")) }
        : {}),
      ...(native.retryInboxSave
        ? { retryInboxSave: () => native.retryInboxSave?.() ?? Promise.reject(new Error("retryInboxSave 미구현")) }
        : {}),
      runLocalWorkflow: (text) =>
        native.runLocalWorkflow?.(text) ??
        Promise.reject(new Error("runLocalWorkflow 미구현")),
      openLocalWorkflowOutput: () =>
        native.openLocalWorkflowOutput?.() ??
        Promise.reject(new Error("openLocalWorkflowOutput 미구현")),
      readSelectedWorkActionEvents: () =>
        native.readSelectedWorkActionEvents?.() ??
        Promise.reject(new Error("readSelectedWorkActionEvents 미구현")),
      recordSelectedWorkActionEvent: (event) =>
        native.recordSelectedWorkActionEvent?.(event) ??
        Promise.reject(new Error("recordSelectedWorkActionEvent 미구현")),
      recordReleaseReadinessVirtualOfficeEvent: () =>
        native.recordReleaseReadinessVirtualOfficeEvent?.() ??
        Promise.reject(new Error("recordReleaseReadinessVirtualOfficeEvent 미구현")),
      updateSelectedWorkActionEvent: (eventId, patch) =>
        native.updateSelectedWorkActionEvent?.(eventId, patch) ??
        Promise.reject(new Error("updateSelectedWorkActionEvent 미구현")),
      approveDraft: (id) =>
        native.approveDraft?.(id) ??
        Promise.reject(new Error("approveDraft 미구현")),
      openApprovedOutput: (id) =>
        native.openApprovedOutput?.(id) ??
        Promise.reject(new Error("openApprovedOutput 미구현")),
      stageFinalAction: (id, actionKind) =>
        native.stageFinalAction?.(id, actionKind) ??
        Promise.reject(new Error("stageFinalAction 미구현")),
      prepareFinalConfirmation: (id, options) =>
        native.prepareFinalConfirmation?.(id, options) ??
        Promise.reject(new Error("prepareFinalConfirmation 미구현")),
      runFinalActionDryRun: (id, values) =>
        native.runFinalActionDryRun?.(id, values) ??
        Promise.reject(new Error("runFinalActionDryRun 미구현")),
      executeFinalAction: (id, confirmation) =>
        native.executeFinalAction?.(id, confirmation) ??
        Promise.reject(new Error("executeFinalAction 미구현")),
      stageDelegationActionQueueItem: (queueItem) =>
        native.stageDelegationActionQueueItem?.(queueItem) ??
        Promise.reject(new Error("stageDelegationActionQueueItem 미구현")),
      confirmScheduleTime: (id, values) =>
        native.confirmScheduleTime?.(id, values) ??
        Promise.reject(new Error("confirmScheduleTime 미구현")),
      requestChange: (id, instruction) =>
        native.requestChange?.(id, instruction) ??
        Promise.reject(new Error("requestChange 미구현")),
      // 구형 설치본에는 이 통로가 없다 — 던지지 않고 '최신 앱 필요'로 답한다(채팅 답변이 막히지 않게).
      stageMailDraft: (draft) =>
        native.stageMailDraft?.(draft) ??
        Promise.resolve({
          status: "desktop_update_required",
          userMessage: "승인함에 올리려면 최신 설치 앱이 필요해요.",
          externalMutation: false,
        }),
      redraftMailReply: (id, instruction, options) =>
        native.redraftMailReply?.(id, instruction, options) ??
        Promise.resolve({
          status: "desktop_update_required",
          workItemId: id,
          userMessage: "AI 에게 다시 쓰게 하려면 최신 설치 앱이 필요해요.",
          externalMutation: false,
        }),
      holdAction: (id) =>
        native.holdAction?.(id) ?? Promise.reject(new Error("holdAction 미구현")),
      rejectAction: (id, reason) =>
        native.rejectAction?.(id, reason) ??
        Promise.reject(new Error("rejectAction 미구현")),
      ...(native.setCardAssignee
        ? { setCardAssignee: (id: string, assignee: CardAssigneeChoice) => native.setCardAssignee!(id, assignee) }
        : {}),
      connectConnector: (id, payload) =>
        native.connectConnector?.(id, payload) ??
        Promise.reject(new Error("connectConnector 미구현")),
      discoverMailServer: (payload) =>
        native.discoverMailServer?.(payload) ??
        Promise.reject(new Error("discoverMailServer 미구현")),
      listConnectorStatuses: () =>
        native.listConnectorStatuses?.() ??
        Promise.reject(new Error("listConnectorStatuses 미구현")),
      // 구형 설치본에는 이 통로가 없다. 던지는 대신 빈 맥락을 준다 —
      // 예외가 나면 채팅 답변 전체가 막힌다.
      getConnectorChatContext: () =>
        native.getConnectorChatContext?.() ??
        Promise.resolve({ status: "connector_chat_context_unavailable", mails: [], busyWindows: [] }),
      getProviderOAuthPreflight: () =>
        native.getProviderOAuthPreflight?.() ??
        Promise.reject(new Error("getProviderOAuthPreflight 미구현")),
      runMailWorkIntake: (payload) =>
        native.runMailWorkIntake?.(payload) ??
        Promise.reject(new Error("runMailWorkIntake 미구현")),
      mailWritingProfile: (payload) =>
        native.mailWritingProfile?.(payload) ??
        Promise.resolve({ status: "desktop_update_required", userMessage: "서명·말투 설정은 최신 설치 앱에서 사용할 수 있어요.", externalMutation: false as const }),
      listMailMessages: (payload) =>
        native.listMailMessages?.(payload) ??
        Promise.reject(new Error("listMailMessages 미구현")),
      searchMail: (payload) =>
        native.searchMail?.(payload) ??
        Promise.reject(new Error("searchMail 미구현")),
      readMail: (payload) =>
        native.readMail?.(payload) ??
        Promise.reject(new Error("readMail 미구현")),
      draftMail: (payload) =>
        native.draftMail?.(payload) ??
        Promise.reject(new Error("draftMail 미구현")),
      runMailLiveE2ERehearsal: (payload) =>
        native.runMailLiveE2ERehearsal?.(payload) ??
        native.runMailWorkIntake?.({ kind: "run_live_e2e_rehearsal", ...payload }) ??
        Promise.reject(new Error("runMailLiveE2ERehearsal 미구현")),
      openMailLiveE2EReport: () =>
        native.openMailLiveE2EReport?.() ??
        Promise.reject(new Error("openMailLiveE2EReport 미구현")),
      downloadMailAttachmentsToStaging: (payload) =>
        native.downloadMailAttachmentsToStaging?.(payload) ??
        (native.runMailWorkIntake?.({ kind: "download_imap_attachments", ...payload }) as
          | Promise<MailAttachmentDownloadResult>
          | undefined) ??
        Promise.reject(new Error("downloadMailAttachmentsToStaging 미구현")),
      runMobileMailShareIntake: (payload) =>
        native.runMobileMailShareIntake?.(payload) ??
        native.runMailWorkIntake?.({ kind: "run_mobile_share", ...payload }) ??
        Promise.reject(new Error("runMobileMailShareIntake 미구현")),
      reviewMailRecipientList: (payload) =>
        native.reviewMailRecipientList?.(payload) ??
        native.runMailWorkIntake?.({ kind: "review_recipient_list", ...payload }) ??
        Promise.reject(new Error("reviewMailRecipientList 미구현")),
      sendApprovalNotification: (payload) =>
        native.sendApprovalNotification?.(payload) ??
        Promise.reject(new Error("sendApprovalNotification 미구현")),
      applyChannelDecision: (payload) =>
        native.applyChannelDecision?.(payload) ??
        Promise.reject(new Error("applyChannelDecision 미구현")),
      saveAIProviderKey: (provider, payload) =>
        native.saveAIProviderKey?.(provider, payload) ??
        Promise.reject(new Error("saveAIProviderKey 미구현")),
      getJevMailClassificationStatus: () =>
        native.getJevMailClassificationStatus?.() ??
        Promise.resolve(createDesktopRequiredJevMailClassificationStatus()),
      saveJevMailClassification: (payload) =>
        native.saveJevMailClassification?.(payload) ??
        Promise.resolve(createDesktopRequiredJevMailClassificationStatus()),
      testJevMailClassification: () =>
        native.testJevMailClassification?.() ??
        Promise.resolve(createDesktopRequiredJevMailClassificationStatus()),
      disconnectJevMailClassification: () =>
        native.disconnectJevMailClassification?.() ??
        Promise.resolve(createDesktopRequiredJevMailClassificationStatus()),
      saveAIProviderModel: (provider, payload) =>
        native.saveAIProviderModel?.(provider, payload) ??
        Promise.reject(new Error("saveAIProviderModel 미구현")),
      listAIProviderModels: (provider, options) =>
        native.listAIProviderModels?.(provider, options) ??
        Promise.resolve({ status: "model_catalog_unavailable", provider, modelAvailability: {
          state: "unknown", source: "none", models: [],
          userMessage: "모델 목록을 확인하려면 앱 업데이트가 필요합니다.",
          availabilityIsNotEntitlementProof: true,
        } }),
      // 구형 설치본에는 이 통로가 없다. 던지는 대신 **빈 목록과 이유**를 돌려준다 —
      // 모델 고르는 줄이 예외로 무너지면 채팅 화면 전체가 안 뜬다.
      // 구형 설치본에는 이 통로가 없다. 던지는 대신 빈 목록을 돌려준다 —
      // 모델 줄이 예외로 무너지면 채팅 화면 전체가 안 뜬다.
      listSubscriptionAIRuntimes: () =>
        native.listSubscriptionAIRuntimes?.() ?? Promise.resolve({ runtimes: [] }),
      startSubscriptionAILogin: (provider) =>
        native.startSubscriptionAILogin?.(provider) ??
        Promise.resolve({ started: false, userMessage: "설치된 앱을 업데이트하면 구독 계정으로 연결할 수 있어요." }),
      listLocalAIModels: (payload) =>
        native.listLocalAIModels?.(payload) ??
        Promise.resolve({
          status: "local_model_bridge_missing",
          models: [],
          userMessage: "설치된 앱이 이 기능을 아직 모릅니다. 앱을 업데이트하면 내 PC 안의 모델을 찾을 수 있어요.",
        }),
      startAIProviderOAuth: (provider, options) =>
        native.startAIProviderOAuth?.(provider, options) ??
        Promise.reject(new Error("startAIProviderOAuth 미구현")),
      getAIProviderStatus: () =>
        native.getAIProviderStatus?.() ??
        Promise.reject(new Error("getAIProviderStatus 미구현")),
      getAIRuntimeLiveProofs: () =>
        native.getAIRuntimeLiveProofs?.() ?? Promise.resolve(createDesktopRequiredAIRuntimeLiveProofs()),
      generateAIText: (payload) =>
        native.generateAIText?.(payload) ??
        Promise.reject(new Error("generateAIText 미구현")),
      ...(typeof native.generateAITextStream === "function"
        ? {
            generateAITextStream: (
              payload: AITextGenerationPayload,
              onChunk: (delta: string) => void,
            ) => native.generateAITextStream!(payload, onChunk),
          }
        : {}),
      ...(typeof native.cancelAITextStream === "function"
        ? { cancelAITextStream: (streamId: string) => native.cancelAITextStream!(streamId) }
        : {}),
      getTriggerSettings: () =>
        native.getTriggerSettings?.() ??
        Promise.reject(new Error("getTriggerSettings 미구현")),
      updateTriggerRule: (rule) =>
        native.updateTriggerRule?.(rule) ??
        Promise.reject(new Error("updateTriggerRule 미구현")),
      getScheduleNotificationStatus: () =>
        native.getScheduleNotificationStatus?.() ??
        Promise.reject(new Error("getScheduleNotificationStatus 미구현")),
      requestScheduleNotificationPermission: () =>
        native.requestScheduleNotificationPermission?.() ??
        native.getScheduleNotificationStatus?.() ??
        Promise.reject(new Error("requestScheduleNotificationPermission 미구현")),
      runTriggerDueChecks: () =>
        native.runTriggerDueChecks?.() ??
        Promise.reject(new Error("runTriggerDueChecks 미구현")),
      openTriggerRunnerReport: () =>
        native.openTriggerRunnerReport?.() ??
        Promise.reject(new Error("openTriggerRunnerReport 미구현")),
      runUnifiedWorkSync: (payload) =>
        native.runUnifiedWorkSync?.(payload) ??
        Promise.reject(new Error("runUnifiedWorkSync 미구현")),
      getToolchainStatus: () =>
        native.getToolchainStatus?.() ??
        Promise.reject(new Error("getToolchainStatus 미구현")),
      prepareToolchain: () =>
        native.prepareToolchain?.() ??
        Promise.reject(new Error("prepareToolchain 미구현")),
      installCodexRecoveryTool: () =>
        native.installCodexRecoveryTool?.() ??
        Promise.reject(new Error("installCodexRecoveryTool 미구현")),
      getLocalMemoryStatus: () =>
        native.getLocalMemoryStatus?.() ??
        Promise.reject(new Error("getLocalMemoryStatus 미구현")),
      chooseLocalMemoryRoot: () =>
        native.chooseLocalMemoryRoot?.() ??
        Promise.reject(new Error("chooseLocalMemoryRoot 미구현")),
      openWorkspaceWindow: (target) =>
        native.openWorkspaceWindow?.(target) ??
        Promise.reject(new Error("openWorkspaceWindow 미구현")),
      returnToMainWindow: () =>
        native.returnToMainWindow?.() ??
        Promise.reject(new Error("returnToMainWindow 미구현")),
      // 구독 해제 함수가 아닌 값(오래된 preload·테스트용 가짜 브리지)이 와도 화면이 깨지지 않게 한다.
      onFocusWorkItem: (listener) => {
        const unsubscribe: unknown = native.onFocusWorkItem?.(listener);
        return typeof unsubscribe === "function" ? (unsubscribe as () => void) : () => undefined;
      },
      takePendingWorkItemFocus: async () => (await native.takePendingWorkItemFocus?.()) ?? null,
      onInboxChanged: (listener) => {
        const unsubscribe: unknown = native.onInboxChanged?.((change) => listener(normalizeDesktopInboxAttention(change)));
        return typeof unsubscribe === "function" ? (unsubscribe as () => void) : () => undefined;
      },
      getInboxAttention: async () => normalizeDesktopInboxAttention(await native.getInboxAttention?.()),
      openWorkerCompanionWindow: (options) =>
        native.openWorkerCompanionWindow?.(options) ??
        Promise.reject(new Error("openWorkerCompanionWindow 미구현")),
      openReleaseFieldGuide: () =>
        native.openReleaseFieldGuide?.() ??
        Promise.reject(new Error("openReleaseFieldGuide 미구현")),
      openFirstUserObservationKit: (target) =>
        native.openFirstUserObservationKit?.(target) ??
        Promise.reject(new Error("openFirstUserObservationKit 미구현")),
      openReleaseAIRuntimeLiveKit: (target) =>
        native.openReleaseAIRuntimeLiveKit?.(target) ??
        Promise.reject(new Error("openReleaseAIRuntimeLiveKit 미구현")),
      openReleaseLiveSmokeKit: (target) =>
        native.openReleaseLiveSmokeKit?.(target) ??
        Promise.reject(new Error("openReleaseLiveSmokeKit 미구현")),
      openReleaseOperatorRunnerKit: (target) =>
        native.openReleaseOperatorRunnerKit?.(target) ??
        Promise.reject(new Error("openReleaseOperatorRunnerKit 미구현")),
      openReleaseUnblockKit: (target) =>
        native.openReleaseUnblockKit?.(target) ??
        Promise.reject(new Error("openReleaseUnblockKit 미구현")),
      loadChatThreads: () =>
        native.loadChatThreads?.() ??
        Promise.reject(new Error("loadChatThreads 미구현")),
      loadWorkSessionWorkspace: (expectedRoot) => native.loadWorkSessionWorkspace
        ? native.loadWorkSessionWorkspace(expectedRoot)
        : native.updateWorkSessionWorkspace
          ? Promise.reject(new Error("업무 대화 읽기 연결이 누락되었습니다. 앱을 업데이트해 주세요."))
          : loadBrowserWorkSessionWorkspace(expectedRoot),
      updateWorkSessionWorkspace: (command, expectedRoot) => native.updateWorkSessionWorkspace
        ? native.updateWorkSessionWorkspace(command, expectedRoot)
        : native.loadWorkSessionWorkspace
          ? Promise.reject(new Error("업무 대화 저장 연결이 누락되었습니다. 앱을 업데이트해 주세요."))
          : updateBrowserWorkSessionWorkspace(command, expectedRoot),
      saveChatThreads: (threads, expectedRoot) =>
        native.saveChatThreads?.(threads, expectedRoot) ??
        Promise.reject(new Error("saveChatThreads 미구현")),
      loadAppProfile: () =>
        native.loadAppProfile?.() ??
        Promise.reject(new Error("loadAppProfile 미구현")),
      saveAppProfile: (profile) =>
        native.saveAppProfile?.(profile) ??
        Promise.reject(new Error("saveAppProfile 미구현")),
      inspectPortableMemory: () =>
        native.inspectPortableMemory?.() ??
        Promise.reject(new Error("inspectPortableMemory 미구현")),
      listWorkspaceSkillAcquisitionProposals: (workspaceId) =>
        native.listWorkspaceSkillAcquisitionProposals?.(workspaceId) ??
        Promise.reject(new Error("listWorkspaceSkillAcquisitionProposals 미구현")),
      confirmWorkspaceSkillDownloadInstall: (payload) =>
        native.confirmWorkspaceSkillDownloadInstall?.(payload) ??
        Promise.reject(new Error("confirmWorkspaceSkillDownloadInstall 미구현")),
      confirmWorkspaceSkillActivation: (payload) =>
        native.confirmWorkspaceSkillActivation?.(payload) ??
        Promise.reject(new Error("confirmWorkspaceSkillActivation 미구현")),
      saveWorkDecisions: (payload) =>
        native.saveWorkDecisions?.(payload) ??
        Promise.reject(new Error("saveWorkDecisions 미구현")),
      saveWorkLearning: (payload) =>
        native.saveWorkLearning?.(payload) ??
        Promise.reject(new Error("saveWorkLearning 미구현")),
      listWorkPatterns: () =>
        native.listWorkPatterns?.() ??
        Promise.reject(new Error("listWorkPatterns 미구현")),
      updateWorkPattern: (payload) =>
        native.updateWorkPattern?.(payload) ??
        Promise.reject(new Error("updateWorkPattern 미구현")),
      removeWorkPattern: (payload) =>
        native.removeWorkPattern?.(payload) ??
        Promise.reject(new Error("removeWorkPattern 미구현")),
      listLearningSources: () =>
        native.listLearningSources?.() ??
        Promise.reject(new Error("listLearningSources 미구현")),
      upsertLearningSources: (payload) =>
        native.upsertLearningSources?.(payload) ??
        Promise.reject(new Error("upsertLearningSources 미구현")),
      removeLearningSource: (payload) =>
        native.removeLearningSource?.(payload) ??
        Promise.reject(new Error("removeLearningSource 미구현")),
      saveDelegationArtifact: (payload) =>
        native.saveDelegationArtifact?.(payload) ??
        Promise.reject(new Error("saveDelegationArtifact 미구현")),
      listDelegationArtifacts: () =>
        native.listDelegationArtifacts?.() ??
        Promise.reject(new Error("listDelegationArtifacts 미구현")),
      openDelegationArtifact: (payload) =>
        native.openDelegationArtifact?.(payload) ??
        Promise.reject(new Error("openDelegationArtifact 미구현")),
      openLocalMemoryFile: (payload) =>
        native.openLocalMemoryFile?.(payload) ??
        Promise.reject(new Error("openLocalMemoryFile 미구현")),
      recordDelegationArtifactDecision: (payload) =>
        native.recordDelegationArtifactDecision?.(payload) ??
        Promise.reject(new Error("recordDelegationArtifactDecision 미구현")),
      recordHomeApprovalDecisionReceipt: (payload) =>
        native.recordHomeApprovalDecisionReceipt?.(payload) ??
        Promise.reject(new Error("recordHomeApprovalDecisionReceipt 미구현")),
      listHomeApprovalDecisionReceipts: () =>
        native.listHomeApprovalDecisionReceipts?.() ??
        Promise.reject(new Error("listHomeApprovalDecisionReceipts 미구현")),
      loadLocalMemoryPromptContext: (payload) =>
        native.loadLocalMemoryPromptContext?.(payload) ??
        Promise.reject(new Error("loadLocalMemoryPromptContext 미구현")),
      loadLearningLessons: (payload) =>
        native.loadLearningLessons?.(payload) ??
        Promise.reject(new Error("loadLearningLessons 미구현")),
      applyLearningLessons: (payload) =>
        native.applyLearningLessons?.(payload) ??
        Promise.reject(new Error("applyLearningLessons 미구현")),
      rollbackLearningLessons: (payload) =>
        native.rollbackLearningLessons?.(payload) ??
        Promise.reject(new Error("rollbackLearningLessons 미구현")),
      decideLearningProposal: (payload) =>
        native.decideLearningProposal?.(payload) ??
        Promise.reject(new Error("decideLearningProposal 미구현")),
      listTasks: () => native.listTasks?.() ?? Promise.reject(new Error("listTasks 미구현")),
      runTask: (payload) => native.runTask?.(payload) ?? Promise.reject(new Error("업무 실행은 최신 설치 앱에서 사용할 수 있습니다.")),
      controlTaskExecution: (payload) => native.controlTaskExecution?.(payload) ?? Promise.reject(new Error("업무 실행은 최신 설치 앱에서 사용할 수 있습니다.")),
      upsertTasks: (payload) =>
        native.upsertTasks?.(payload) ?? Promise.reject(new Error("upsertTasks 미구현")),
      answerTaskQuestion: (payload) =>
        native.answerTaskQuestion?.(payload) ?? Promise.reject(new Error("answerTaskQuestion 미구현")),
      completeTask: (payload) =>
        native.completeTask?.(payload) ?? Promise.reject(new Error("completeTask 미구현")),
      loadBackgroundDigestStatus: () =>
        native.loadBackgroundDigestStatus?.() ??
        Promise.reject(new Error("loadBackgroundDigestStatus 미구현")),
      setBackgroundDigestEnabled: (payload) =>
        native.setBackgroundDigestEnabled?.(payload) ??
        Promise.reject(new Error("setBackgroundDigestEnabled 미구현")),
      chooseDocumentLearningFiles: () =>
        native.chooseDocumentLearningFiles?.() ??
        Promise.reject(new Error("chooseDocumentLearningFiles 미구현")),
      importDocumentLearningFiles: (files, sourceKind) =>
        native.importDocumentLearningFiles?.(files, sourceKind) ??
        Promise.reject(new Error("importDocumentLearningFiles 미구현")),
      chooseDocumentLearningFolders: (payload) =>
        native.chooseDocumentLearningFolders?.(payload) ??
        Promise.reject(new Error("chooseDocumentLearningFolders 미구현")),
      chooseDocumentLearningRoot: () =>
        native.chooseDocumentLearningRoot?.() ??
        Promise.reject(new Error("chooseDocumentLearningRoot 미구현")),
      classifyDocumentLearning: (payload) =>
        native.classifyDocumentLearning?.(payload) ??
        Promise.reject(new Error("classifyDocumentLearning 미구현")),
      createDocumentLearningFolderPlan: (payload) =>
        native.createDocumentLearningFolderPlan?.(payload) ??
        Promise.reject(new Error("createDocumentLearningFolderPlan 미구현")),
      stageMailAttachmentFolderPlan: (payload) =>
        native.stageMailAttachmentFolderPlan?.(payload) ??
        Promise.reject(new Error("stageMailAttachmentFolderPlan 미구현")),
      previewDocumentLearningFolderPlan: (payload) =>
        native.previewDocumentLearningFolderPlan?.(payload) ??
        Promise.reject(new Error("previewDocumentLearningFolderPlan 미구현")),
      applyDocumentLearningFolderPlan: (payload) =>
        native.applyDocumentLearningFolderPlan?.(payload) ??
        Promise.reject(new Error("applyDocumentLearningFolderPlan 미구현")),
      revertDocumentLearningFolderPlan: (payload) =>
        native.revertDocumentLearningFolderPlan?.(payload) ??
        Promise.reject(new Error("revertDocumentLearningFolderPlan 미구현")),
      searchDocumentLearningIndex: (payload) =>
        native.searchDocumentLearningIndex?.(payload) ??
        Promise.reject(new Error("searchDocumentLearningIndex 미구현")),
      openDocumentLearningIndex: (payload) =>
        native.openDocumentLearningIndex?.(payload) ??
        Promise.reject(new Error("openDocumentLearningIndex 미구현")),
      openDocumentLearningFile: (payload) =>
        native.openDocumentLearningFile?.(payload) ??
        Promise.reject(new Error("openDocumentLearningFile 미구현")),
      getDocumentLearningSupervisorStatus: () =>
        native.getDocumentLearningSupervisorStatus?.() ??
        Promise.reject(new Error("getDocumentLearningSupervisorStatus 미구현")),
      pauseDocumentLearningSupervisorSource: (sourceId) =>
        native.pauseDocumentLearningSupervisorSource?.(sourceId) ??
        Promise.reject(new Error("pauseDocumentLearningSupervisorSource 미구현")),
      resumeDocumentLearningSupervisorSource: (sourceId) =>
        native.resumeDocumentLearningSupervisorSource?.(sourceId) ??
        Promise.reject(new Error("resumeDocumentLearningSupervisorSource 미구현")),
      revokeDocumentLearningSupervisorSource: (sourceId) =>
        native.revokeDocumentLearningSupervisorSource?.(sourceId) ??
        Promise.reject(new Error("revokeDocumentLearningSupervisorSource 미구현")),
      reconcileDocumentLearningSupervisorSource: (sourceId) =>
        native.reconcileDocumentLearningSupervisorSource?.(sourceId) ??
        Promise.reject(new Error("reconcileDocumentLearningSupervisorSource 미구현")),
      acknowledgeDocumentLearningSupervisorTeammateProposal: (
        sourceId,
        draftId,
        proposalId,
      ) =>
        native.acknowledgeDocumentLearningSupervisorTeammateProposal?.(
          sourceId,
          draftId,
          proposalId,
        ) ??
        Promise.reject(
          new Error("acknowledgeDocumentLearningSupervisorTeammateProposal 미구현"),
        ),
      revealDocumentLearningPath: (payload) =>
        native.revealDocumentLearningPath?.(payload) ??
        Promise.reject(new Error("revealDocumentLearningPath 미구현")),
      loadAgentOrg: () =>
        native.loadAgentOrg?.() ?? Promise.reject(new Error("loadAgentOrg 미구현")),
      saveAgentOrg: (payload) =>
        native.saveAgentOrg?.(payload) ?? Promise.reject(new Error("saveAgentOrg 미구현")),
      recordAgentOrgPerformance: (record) =>
        native.recordAgentOrgPerformance?.(record) ??
        Promise.reject(new Error("recordAgentOrgPerformance 미구현")),
      stageAgentOrgProposal: (proposalCard) =>
        native.stageAgentOrgProposal?.(proposalCard) ??
        Promise.reject(new Error("stageAgentOrgProposal 미구현")),
      getAgentRuntimeStatus: () =>
        native.getAgentRuntimeStatus?.() ??
        Promise.reject(new Error("getAgentRuntimeStatus 미구현")),
      runAgentSession: (payload) =>
        native.runAgentSession?.(payload) ??
        Promise.reject(new Error("runAgentSession 미구현")),
      getPublicTriggerRelayStatus: () =>
        native.getPublicTriggerRelayStatus?.() ??
        Promise.reject(new Error("getPublicTriggerRelayStatus 미구현")),
      pullPublicTriggerRelay: () =>
        native.pullPublicTriggerRelay?.() ??
        Promise.reject(new Error("pullPublicTriggerRelay 미구현")),
      getDesktopControlStatus: (payload) =>
        native.getDesktopControlStatus?.(payload) ??
        Promise.reject(new Error("getDesktopControlStatus 미구현")),
      requestDesktopControlAction: (payload) =>
        native.requestDesktopControlAction?.(payload) ??
        Promise.reject(new Error("requestDesktopControlAction 미구현")),
      confirmDesktopControlAction: (payload) =>
        native.confirmDesktopControlAction?.(payload) ??
        Promise.reject(new Error("confirmDesktopControlAction 미구현")),
    };
  }

  // 브라우저 fallback — 실제 데스크톱 IPC가 없으면 가짜 업무 데이터를 만들지 않습니다.
  let browserFallbackTriggerRules: TriggerRuleRecord[] = [];
  return {
    isAvailable: false,
    documentProduction: async () => desktopDocumentRequired(),
    dailySkillsCatalog: async () => ({ ok: false, status: "desktop_required", userMessage: "일상 도구는 설치된 ModyCrew 앱에서 쓸 수 있어요." }),
    lookupDailySkill: async () => ({ ok: false, status: "desktop_required", userMessage: "일상 도구는 설치된 ModyCrew 앱에서 쓸 수 있어요." }),
    companyAutomation: async () => companyDesktopRequired(),
    googleDriveFiles: async () => ({ status: "desktop_required", userMessage: "드라이브 파일 연결은 설치된 ModyCrew 앱에서 할 수 있어요." }),
    async fetchInbox() {
      return [];
    },
    async fetchHeaderMetrics() {
      return {
        newToday: 0,
        pendingApproval: 0,
        riskFlagged: 0,
      };
    },
    async runLocalWorkflow() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서 실제 로컬 업무 처리를 실행할 수 있습니다.",
      };
    },
    async openLocalWorkflowOutput() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서 결과 폴더를 열 수 있습니다.",
      };
    },
    async readSelectedWorkActionEvents() {
      return createBrowserSelectedWorkActionEventsResult(
        "selected_work_action_events_browser_loaded",
        readSelectedWorkActionEvents(),
      );
    },
    async recordSelectedWorkActionEvent(event) {
      return createBrowserSelectedWorkActionEventsResult(
        "selected_work_action_event_browser_recorded",
        recordSelectedWorkActionEvent(event),
      );
    },
    async recordReleaseReadinessVirtualOfficeEvent() {
      return createBrowserSelectedWorkActionEventsResult(
        "release_readiness_virtual_office_event_desktop_required",
        readSelectedWorkActionEvents(),
        {
          userMessage:
            "릴리즈 readiness 이벤트 파일을 앱 감사 로그로 가져오려면 설치된 데스크톱 앱이 필요합니다.",
        },
      );
    },
    async updateSelectedWorkActionEvent(eventId, patch) {
      return createBrowserSelectedWorkActionEventsResult(
        "selected_work_action_event_browser_updated",
        updateSelectedWorkActionEvent(eventId, patch),
      );
    },
    async approveDraft() {
      throw new Error("설치된 데스크톱 앱에서만 승인 기록을 남길 수 있습니다.");
    },
    async openApprovedOutput() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 승인 문서 저장 위치를 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async stageFinalAction() {
      return {
        status: "desktop_required",
        addedCount: 0,
        totalInboxItems: 0,
        userMessage: "설치된 데스크톱 앱에서만 최종 실행 후보 카드를 만들 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async prepareFinalConfirmation() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 최종 확인 화면을 준비할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async runFinalActionDryRun() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 실제 실행 전 미리보기를 확인할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async executeFinalAction() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 마지막 확인을 진행할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async stageDelegationActionQueueItem() {
      return {
        status: "desktop_required",
        addedCount: 0,
        totalInboxItems: 0,
        userMessage: "설치된 데스크톱 앱에서만 승인 이후 큐를 업무 카드로 올릴 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async confirmScheduleTime() {
      return {
        status: "desktop_required",
        addedCount: 0,
        totalInboxItems: 0,
        userMessage: "설치된 데스크톱 앱에서만 날짜 확인 카드를 캘린더 후보로 바꿀 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async requestChange() {
      throw new Error("설치된 데스크톱 앱에서만 수정 요청을 남길 수 있습니다.");
    },
    async stageMailDraft() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 메일 초안을 승인함에 올릴 수 있어요.",
        externalMutation: false,
      };
    },
    async redraftMailReply(workItemId) {
      return {
        status: "desktop_required",
        workItemId,
        userMessage: "설치된 데스크톱 앱에서만 AI 에게 초안을 다시 쓰게 할 수 있어요.",
        externalMutation: false,
      };
    },
    async holdAction() {
      throw new Error("설치된 데스크톱 앱에서만 보류 처리할 수 있습니다.");
    },
    async rejectAction() {
      throw new Error("설치된 데스크톱 앱에서만 거절 처리할 수 있습니다.");
    },
    async discoverMailServer() {
      // 서버 자동 찾기는 DNS 조회와 포트 확인이 필요해 설치된 앱에서만 실행됩니다.
      return {
        status: "desktop_required",
        userMessage:
          "메일 서버 자동 찾기는 설치된 데스크톱 앱에서만 실행됩니다. 브라우저 미리보기에서는 조회하지 않습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
      } satisfies MailServerDiscoveryResult;
    },
    async connectConnector() {
      return {
        status: "desktop_required",
        userMessage: "실제 도구 연결은 설치된 데스크톱 앱에서만 실행됩니다.",
      };
    },
    async listConnectorStatuses() {
      return {
        status: "desktop_required",
        connectors: [],
        userMessage: "설치된 데스크톱 앱에서 이 PC의 연결 상태를 불러올 수 있습니다.",
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    // 브라우저에는 연결된 메일·캘린더가 없다. 빈 맥락을 준다.
    async getConnectorChatContext() {
      return { status: "desktop_required", mails: [], busyWindows: [] };
    },
    async getProviderOAuthPreflight() {
      return {
        status: "desktop_required",
        summary: {
          total: 0,
          readyForAuthorization: 0,
          missingClientId: 0,
          needsAppRegistration: 0,
          externalMutationAllowed: false,
          rawSecretMaterialReturned: false,
        },
        items: [],
        userMessage: "설치된 앱에서 Google/Microsoft 계정 연결 준비 상태를 확인할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async runMailWorkIntake() {
      return {
        status: "desktop_required",
        messageCount: 0,
        createdWorkItemsCount: 0,
        approvalQueueCount: 0,
        addedInboxItemsCount: 0,
        userMessage: "설치된 데스크톱 앱에서만 연결된 메일함을 읽고 일정/답장 후보를 만들 수 있습니다.",
        readOnly: true,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        appMayPersistSecret: false,
      };
    },
    async mailWritingProfile() {
      return { status: "desktop_required", userMessage: "서명·말투 설정은 설치된 ModyCrew 앱에서 사용할 수 있어요.", externalMutation: false as const };
    },
    async listMailMessages() {
      return {
        status: "desktop_required",
        messages: [],
        totalCount: 0,
        accountIds: [],
      };
    },
    async searchMail() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 연결된 메일함을 검색할 수 있습니다.",
      };
    },
    async readMail() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 메일 미리보기를 확인할 수 있습니다.",
      };
    },
    async draftMail() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 메일 초안을 만들 수 있습니다.",
      };
    },
    async runMailLiveE2ERehearsal(payload) {
      if (payload?.writeEvidenceTemplate === true) {
        return {
          status: "desktop_required",
          mode: "browser_preview",
          manualEvidenceTemplatePath: "설치 앱의 사용자 데이터 폴더/mail-live-e2e/mail-live-e2e-manual-evidence.example.json",
          manualEvidenceTemplateCommand: "npm run run:mail-live-e2e-rehearsal -- --write-evidence-template",
          manualEvidenceGuidePath: "설치 앱의 사용자 데이터 폴더/mail-live-e2e/mail-live-e2e-manual-evidence-guide.md",
          messageCount: 0,
          ignoredItemsCount: 0,
          approvalQueueCount: 0,
          attachmentCandidateCount: 0,
          securePollingRuleEnabled: false,
          userMessage: "설치된 Windows 앱에서 메일 live 수동 증거 템플릿을 만들 수 있습니다.",
          auditMessages: [
            "브라우저 미리보기에서는 로컬 사용자 데이터 폴더에 파일을 쓰지 않습니다.",
            "템플릿에는 비밀번호, 2차 인증값, 토큰, 원문 HTML을 넣지 않습니다.",
          ],
          readOnly: true,
          externalMutation: false,
          rawSecretMaterialStored: false,
          rawSecretMaterialReturned: false,
          appMayPersistSecret: false,
          finalSendLockedUntilApproval: true,
          attachmentStagingLockedUntilApproval: true,
        };
      }
      if (payload?.importManualEvidence === true || payload?.manualEvidencePath) {
        return {
          status: "desktop_required",
          mode: "browser_preview",
          manualEvidenceImportFileName: payload?.manualEvidencePath ? "선택한 JSON" : undefined,
          messageCount: 0,
          ignoredItemsCount: 0,
          approvalQueueCount: 0,
          attachmentCandidateCount: 0,
          securePollingRuleEnabled: false,
          userMessage: "설치된 Windows 앱에서 수동 증거 JSON 파일을 선택해 live 리허설에 반영할 수 있습니다.",
          auditMessages: [
            "브라우저 미리보기에서는 로컬 JSON 파일 선택을 열지 않습니다.",
            "수동 증거 import는 허용된 숫자/상태 키만 읽고 비밀번호, 토큰, 원문 HTML 값은 반영하지 않습니다.",
          ],
          readOnly: true,
          externalMutation: false,
          rawSecretMaterialStored: false,
          rawSecretMaterialReturned: false,
          appMayPersistSecret: false,
          finalSendLockedUntilApproval: true,
          attachmentStagingLockedUntilApproval: true,
        };
      }
      return {
        status: "desktop_required",
        mode: "browser_preview",
        messageCount: 0,
        ignoredItemsCount: 0,
        approvalQueueCount: 0,
        attachmentCandidateCount: 0,
        securePollingRuleEnabled: false,
        liveRehearsalReportSummary: "설치 앱에서 실행하면 로컬 리허설 리포트가 생성됩니다.",
        liveRehearsalEvidenceChecklist: [
          "설치 앱 연결 확인 필요",
          "메일/웹메일 연결 확인 필요",
          "외부 발송, 일정 등록, 첨부 이동은 실행하지 않음",
        ],
        userMessage: "설치된 데스크톱 앱에서만 실제 메일 live 리허설을 실행할 수 있습니다.",
        auditMessages: [
          "브라우저 미리보기에서는 메일함, 캘린더, 로컬 5분 점검 상태를 읽지 않습니다.",
          "외부 발송, 일정 등록, 첨부 이동은 실행하지 않았습니다.",
        ],
        readOnly: true,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        appMayPersistSecret: false,
        finalSendLockedUntilApproval: true,
        attachmentStagingLockedUntilApproval: true,
      };
    },
    async openMailLiveE2EReport() {
      return {
        status: "desktop_required",
        reportPath: "",
        userMessage: "설치된 Windows 앱에서 메일 live 리허설 리포트를 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async downloadMailAttachmentsToStaging() {
      return {
        status: "desktop_required",
        providerId: "imap_smtp",
        action: "download_message_attachments_to_local_staging",
        attachmentCount: 0,
        attachments: [],
        files: [],
        readOnly: true,
        readOnlyMailboxLock: true,
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        rawMessageSourceReturned: false,
        localFileWrite: false,
        originalMailMutated: false,
        userMessage: "메일 첨부 자동 임시저장은 설치된 Windows 앱에서만 실행됩니다.",
        auditMessages: ["Browser fallback did not connect to IMAP or write files"],
      };
    },
    async runMobileMailShareIntake(payload) {
      return runBrowserMobileMailShareIntake(payload);
    },
    async reviewMailRecipientList() {
      return {
        status: "desktop_required",
        addedInboxItemsCount: 0,
        approvalPreviews: [],
        userMessage: "설치된 데스크톱 앱에서만 로컬 CSV/XLSX 명단을 읽고 발송 후보를 검토할 수 있습니다.",
        readOnly: true,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        appMayPersistSecret: false,
      };
    },
    async sendApprovalNotification() {
      return {
        status: "desktop_required",
        pendingCount: 0,
        userMessage: "Telegram 승인 알림은 설치된 데스크톱 앱에서만 보낼 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async applyChannelDecision(payload) {
      return {
        status: "desktop_required",
        decision: "",
        targetWorkItemId: "",
        targetCode: "",
        userMessage: `휴대폰 답장 결정 반영은 설치된 데스크톱 앱에서 처리됩니다. 예: ${payload?.messageText || payload?.text || "승인 A1"}`,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async saveAIProviderKey(provider) {
      return {
        status: `browser_cloud_only:${provider}`,
        provider,
        hasLocalKey: false,
        rawSecretMaterialStored: false,
      };
    },
    async getJevMailClassificationStatus() {
      return createDesktopRequiredJevMailClassificationStatus();
    },
    async saveJevMailClassification() {
      return createDesktopRequiredJevMailClassificationStatus();
    },
    async testJevMailClassification() {
      return createDesktopRequiredJevMailClassificationStatus();
    },
    async disconnectJevMailClassification() {
      return createDesktopRequiredJevMailClassificationStatus();
    },
    async startAIProviderOAuth(provider) {
      return {
        status: "desktop_required",
        provider,
        authMode: provider === "codex_oauth" ? "codex_oauth" : "api_key",
        hasLocalKey: false,
        loginUrl: provider === "codex_oauth" ? "https://auth.openai.com/oauth/authorize" : undefined,
        externalUrlOpened: false,
        cliLoginStarted: false,
        userMessage:
          provider === "codex_oauth"
            ? "AI 브라우저 로그인과 되돌아오기 주소 확인은 설치된 Windows 앱에서만 실행됩니다."
            : "AI 로그인 감지는 설치된 앱에서 사용할 수 있습니다.",
        rawSecretMaterialStored: false,
      };
    },
    async saveAIProviderModel(provider, payload) {
      return {
        status: "desktop_required",
        provider,
        model: payload.model,
        hasLocalKey: false,
        userMessage: "AI 모델 선택은 설치된 Windows 앱 안에서 저장됩니다.",
        rawSecretMaterialStored: false,
      };
    },
    // 브라우저에는 로컬 모델을 찾을 방법이 없다. 빈 목록에 **이유**를 담아 준다 —
    // 그냥 비면 사용자는 "내 PC 에 아무것도 없나?" 로 잘못 읽는다.
    // 브라우저에서는 이 PC 의 앱을 볼 수 없다.
    async listSubscriptionAIRuntimes() {
      return { runtimes: [] };
    },
    async startSubscriptionAILogin() {
      return { started: false, userMessage: "구독 계정 연결은 설치된 Windows 앱에서 됩니다." };
    },
    async listLocalAIModels() {
      return {
        status: "desktop_required",
        models: [],
        userMessage: "내 PC 안의 모델은 설치된 Windows 앱에서 찾을 수 있습니다.",
      };
    },
    async listAIProviderModels(provider) {
      return { status: "desktop_required", provider, modelAvailability: {
        state: "unknown", source: "none", models: [],
        userMessage: "모델 목록은 설치된 앱에서 연결한 계정으로 확인해 주세요.",
        availabilityIsNotEntitlementProof: true,
      } };
    },
    async getAIProviderStatus() {
      return { status: "browser_cloud_only", providers: [] };
    },
    async getAIRuntimeLiveProofs() {
      return createDesktopRequiredAIRuntimeLiveProofs();
    },
    async generateAIText(payload) {
      const model = typeof payload?.model === "string" ? payload.model : "";
      const aiRuntimeRouter = {
        routeOrder: ["codex_oauth", "codex_cli", "openai_api", "gemini_api", "setup_recovery"],
        attemptedRoutes: ["setup_recovery"],
        finalRoute: "setup_recovery",
        failClosed: true,
        recoveryRequired: true,
        recoveryReason: "desktop_required",
      };
      const userNextAction = "설치된 Windows 앱을 열고 AI 연결을 확인한 뒤 방금 요청을 이어서 처리하세요.";
      const recoverySummary = "설치 앱 연결이 없어 실제 AI 답변 생성이 막혔습니다.";
      return {
        status: "desktop_required",
        userMessage: "실제 AI 답변 생성은 설치된 Windows 앱에서만 실행됩니다.",
        answerReady: false,
        fallbackUsed: false,
        userNextAction,
        recoverySummary,
        diagnosticStage: "desktop_bridge_missing",
        aiRuntimeRouter,
        aiRuntimeReceipt: {
          status: "desktop_required",
          provider: "",
          model,
          runtime: "browser_fallback",
          answerReady: false,
          fallbackUsed: false,
          diagnosticStage: "desktop_bridge_missing",
          previousFailureStatus: "",
          userNextAction,
          recoverySummary,
          routeOrder: aiRuntimeRouter.routeOrder,
          attemptedRoutes: aiRuntimeRouter.attemptedRoutes,
          finalRoute: aiRuntimeRouter.finalRoute,
          failClosed: aiRuntimeRouter.failClosed,
          recoveryRequired: aiRuntimeRouter.recoveryRequired,
          recoveryReason: aiRuntimeRouter.recoveryReason,
          recoveryPlan: {
            kind: "install_required",
            actionLabel: "설치 앱에서 계속",
            detail: "브라우저 단독 화면에서는 실제 AI 답변 생성 IPC를 사용할 수 없습니다.",
            choices: ["설치 앱에서 계속", "AI 연결 확인", "방금 요청 이어서 처리"],
          },
          fallbackAttemptFailures: [],
          canRetryPendingRequest: true,
          externalMutation: false,
          rawSecretMaterialReturned: false,
        },
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async getTriggerSettings() {
      return {
        status: "desktop_required",
        rules: browserFallbackTriggerRules,
        summary: {
          totalRules: browserFallbackTriggerRules.length,
          enabledRules: browserFallbackTriggerRules.filter((rule) => rule.enabled).length,
          disabledRules: browserFallbackTriggerRules.filter((rule) => !rule.enabled).length,
          enabledCount: browserFallbackTriggerRules.filter((rule) => rule.enabled).length,
          eventDrivenCount: 0,
          pollingCount: browserFallbackTriggerRules.filter((rule) => rule.enabled && rule.mode === "polling").length,
          scheduledCount: browserFallbackTriggerRules.filter((rule) => rule.enabled && rule.mode === "scheduled").length,
        },
        userMessage: "설치된 데스크톱 앱에서 반복 업무 상태를 불러올 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async updateTriggerRule(rule) {
      browserFallbackTriggerRules = browserFallbackTriggerRules.map((candidate) =>
        candidate.id === rule.id ? { ...candidate, ...rule } : candidate,
      );
      return {
        status: "desktop_required",
        rules: browserFallbackTriggerRules,
        userMessage: "설치된 데스크톱 앱에서만 실제 반복 업무를 바꿀 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async getScheduleNotificationStatus() {
      const enabledChannelCount = browserFallbackTriggerRules.reduce(
        (total, rule) =>
          total +
          (rule.notificationChannels?.os === true ? 1 : 0) +
          (rule.notificationChannels?.telegram === true ? 1 : 0),
        0,
      );
      return {
        status: "desktop_required",
        os: {
          status: "unknown",
          label: "설치 앱에서 확인",
          canNotify: false,
          userMessage: "브라우저 미리보기에서는 OS 알림 권한을 확인할 수 없습니다.",
        },
        telegram: {
          status: "needs_connection",
          connected: false,
          connectorStatus: "desktop_required",
          label: "Telegram 연결 필요",
          userMessage: "설치 앱에서 Telegram Bot token과 chat_id를 연결하면 일정 알림을 받을 수 있습니다.",
        },
        scheduleRuleCount: browserFallbackTriggerRules.filter((rule) =>
          scheduleFallbackRuleIds.has(rule.id),
        ).length,
        enabledChannelCount,
        userMessage: "설치된 데스크톱 앱에서 실제 알림 상태를 확인할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async requestScheduleNotificationPermission() {
      return {
        status: "desktop_required",
        os: {
          status: "unknown",
          label: "설치 앱에서 알림 켜기",
          canNotify: false,
          userMessage: "브라우저 미리보기에서는 OS 알림 권한 팝업을 띄울 수 없습니다. 설치된 데스크톱 앱에서 알림 켜기를 눌러 주세요.",
        },
        telegram: {
          status: "needs_connection",
          connected: false,
          connectorStatus: "desktop_required",
          label: "Telegram 연결 필요",
          userMessage: "설치 앱에서 Telegram Bot token과 chat_id를 연결하면 일정 알림을 받을 수 있습니다.",
        },
        scheduleRuleCount: browserFallbackTriggerRules.filter((rule) =>
          scheduleFallbackRuleIds.has(rule.id),
        ).length,
        enabledChannelCount: browserFallbackTriggerRules.reduce(
          (total, rule) =>
            total +
            (rule.notificationChannels?.os === true ? 1 : 0) +
            (rule.notificationChannels?.telegram === true ? 1 : 0),
          0,
        ),
        userMessage: "OS 알림 권한 요청은 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async runTriggerDueChecks() {
      return {
        status: "desktop_required",
        checkedRules: 0,
        createdWorkItemsCount: 0,
        approvalQueueCount: 0,
        userMessage: "설치된 데스크톱 앱에서만 연결된 업무툴을 점검할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openTriggerRunnerReport() {
      return {
        status: "desktop_required",
        reportPath: "",
        userMessage: "설치된 Windows 앱에서 최신 반복 업무 실행 로그를 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async runUnifiedWorkSync() {
      return {
        status: "desktop_required",
        checkedAt: new Date().toISOString(),
        createdWorkItemsCount: 0,
        approvalQueueCount: 0,
        inboxCount: 0,
        messageCount: 0,
        relayEventCount: 0,
        steps: [
          {
            id: "desktop",
            label: "데스크톱 앱",
            state: "needs",
            detail: "설치된 데스크톱 앱에서 메일, 일정, 메신저, 다른 PC 요청을 한 번에 확인할 수 있습니다.",
          },
        ],
        metrics: {
          newToday: 0,
          pendingApproval: 0,
          riskFlagged: 0,
        },
        userMessage: "설치된 데스크톱 앱에서 오늘 업무 한번에 확인을 실행할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async getToolchainStatus() {
      return {
        status: "desktop_required",
        tools: [],
        readyCount: 0,
        missingCount: 0,
        userMessage: "Git, Node.js, Python 같은 기본 업무 도구 확인은 설치된 Windows 앱에서만 실행됩니다.",
        externalMutation: false,
        globalInstallPerformed: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async prepareToolchain() {
      return {
        status: "desktop_required",
        tools: [],
        readyCount: 0,
        missingCount: 0,
        userMessage: "기본 업무 도구 준비는 설치된 Windows 앱 안에서만 실행됩니다.",
        externalMutation: false,
        globalInstallPerformed: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async installCodexRecoveryTool() {
      return {
        status: "desktop_required",
        userMessage: "AI 연결 복구 도구 설치는 설치된 Windows 앱 안에서만 실행됩니다.",
        externalMutation: false,
        localMachineInstallPerformed: false,
        globalInstallPerformed: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async getLocalMemoryStatus() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        chatThreadsPath: "",
        threadCount: 0,
        messageCount: 0,
        connectorRecoveryMemoryCount: 0,
        connectorRecoveryMemories: [],
        userMessage: "설치된 데스크톱 앱에서만 로컬 기억 저장소를 사용할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async chooseLocalMemoryRoot() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        chatThreadsPath: "",
        threadCount: 0,
        messageCount: 0,
        userMessage: "저장 위치 선택은 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openWorkspaceWindow(target) {
      if (typeof window !== "undefined" && target === "office") {
        openInternalOfficeWindow();
      }
      return {
        status: "desktop_required",
        target,
        userMessage: "설치된 데스크톱 앱에서는 업무 오피스를 별도 창으로 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async returnToMainWindow() {
      return {
        status: "desktop_required",
        target: "chat",
        userMessage: "브라우저에서는 현재 화면의 대화로 돌아갑니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    onFocusWorkItem() {
      return () => undefined;
    },
    async takePendingWorkItemFocus() {
      return null;
    },
    onInboxChanged() {
      return () => undefined;
    },
    async getInboxAttention() {
      return { revision: 0, pendingApprovalCount: 0 };
    },
    async openWorkerCompanionWindow(options) {
      return {
        status: "desktop_required",
        target: "workers",
        userMessage: "직원 일하는 모습은 설치된 데스크톱 앱에서 바탕화면 위에 띄울 수 있습니다. 지금은 앱 안 미리보기로 보여줍니다.",
        displayMode: "app_preview",
        route: "workerCompanion=1",
        surfaceLabel: "직원 일하는 모습",
        currentWindow: "work_status_not_settings",
        visibleWork: "base_custom_current_work_approval_lock",
        hiddenWork: "size_position_character_settings_until_support_open",
        finalBoundary: "approval_before_external_mutation",
        userLanguage: "working_view_not_small_window_label",
        stateContract: "current_work_status_approval_lock",
        sizePreset: normalizeWorkerCompanionWindowSizePreset(options?.sizePreset),
        positionPreset: normalizeWorkerCompanionWindowPositionPreset(options?.positionPreset),
        motionStyle: normalizeWorkerCompanionWindowMotionStyle(options?.motionStyle),
        avatarMode: normalizeWorkerCompanionWindowAvatarMode(options?.avatarMode),
        alwaysOnTop: false,
        skipTaskbar: false,
        visibleOnAllWorkspaces: false,
        resizable: true,
        maximizable: false,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openReleaseFieldGuide() {
      return {
        status: "desktop_required",
        userMessage: "릴리즈 현장 가이드는 설치된 데스크톱 앱에서 로컬 파일로 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openFirstUserObservationKit(target = "scorecard") {
      return {
        status: "desktop_required",
        target,
        userMessage: "첫 사용자 관찰 준비 파일은 설치된 데스크톱 앱에서 로컬 파일로 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openReleaseAIRuntimeLiveKit(target = "template") {
      return {
        status: "desktop_required",
        target,
        userMessage: "AI live 준비 파일은 설치된 데스크톱 앱에서 로컬 파일로 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openReleaseLiveSmokeKit(target = "template") {
      return {
        status: "desktop_required",
        target,
        userMessage: "메일/캘린더 live smoke 준비 파일은 설치된 데스크톱 앱에서 로컬 파일로 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openReleaseOperatorRunnerKit(target = "runner") {
      return {
        status: "desktop_required",
        target,
        userMessage: "운영자 runner 파일은 설치된 데스크톱 앱에서 로컬 파일로 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openReleaseUnblockKit(target = "guide") {
      return {
        status: "desktop_required",
        target,
        userMessage: "릴리즈 언블록 kit 파일은 설치된 데스크톱 앱에서 로컬 파일로 열 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async loadChatThreads() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        chatThreadsPath: "",
        threadCount: 0,
        messageCount: 0,
        threads: [],
        userMessage: "설치된 데스크톱 앱에서만 로컬 대화 기억을 불러올 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    loadWorkSessionWorkspace: loadBrowserWorkSessionWorkspace,
    updateWorkSessionWorkspace: updateBrowserWorkSessionWorkspace,
    async saveChatThreads() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        chatThreadsPath: "",
        threadCount: 0,
        messageCount: 0,
        userMessage: "설치된 데스크톱 앱에서만 로컬 대화 기억을 저장할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async loadAppProfile() {
      const profile = readBrowserAppProfile();
      return {
        status: "browser_local_app_profile_loaded",
        root: "",
        defaultRoot: "",
        chatThreadsPath: "",
        appProfilePath: "localStorage:modycrew-app-profile-v1",
        threadCount: 0,
        messageCount: 0,
        profile,
        userMessage: profile
          ? "브라우저 임시 앱 프로필을 불러왔습니다. 설치 앱에서는 선택한 로컬 폴더로 복원됩니다."
          : "아직 저장된 브라우저 임시 앱 프로필이 없습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async saveAppProfile(profile) {
      writeBrowserAppProfile(profile);
      return {
        status: "browser_local_app_profile_saved",
        root: "",
        defaultRoot: "",
        chatThreadsPath: "",
        appProfilePath: "localStorage:modycrew-app-profile-v1",
        threadCount: 0,
        messageCount: 0,
        profile,
        userMessage: "브라우저 임시 앱 프로필에 저장했습니다. 설치 앱에서는 선택한 로컬 폴더에 저장됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async inspectPortableMemory() {
      const profile = readBrowserAppProfile();
      const teammateCount = Array.isArray(profile?.teammates) ? profile.teammates.length : 0;
      const activeSkillCount = Array.isArray(profile?.activeSkillIds) ? profile.activeSkillIds.length : 0;
      const skillCount = Array.isArray(profile?.skills) ? profile.skills.length : 0;
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        chatThreadsPath: "",
        appProfilePath: "localStorage:modycrew-app-profile-v1",
        portableManifestPath: "",
        crewSoulBundlePath: "",
        crewSoulBundleSummaryPath: "",
        crewSoulBundleReady: false,
        restoreReady: false,
        teammateCount,
        activeSkillCount,
        crewKitCount: skillCount,
        activeCrewKitCount: activeSkillCount,
        growthSuggestionCount: 0,
        growthSuggestions: [],
        connectorRecoveryMemoryCount: 0,
        connectorRecoveryMemories: [],
        skillSourceCount: 0,
        skillSources: [],
        identityFileCount: 0,
        missingIdentityFileCount: 1,
        identityFiles: [
          {
            label: "AI 팀원 업무 방식 파일",
            kind: "desktop_required",
            relativePath: "memory/CrewSoul.md",
            state: "missing",
            detail: "실제 AI 팀원 업무 방식 파일 진단은 설치된 데스크톱 앱에서만 실행됩니다.",
            rawSecretMaterialStored: false,
            rawSecretMaterialReturned: false,
          },
          {
            label: "AI 팀원 복원 묶음",
            kind: "desktop_required",
            relativePath: "memory/CrewSoulBundle.json",
            state: "missing",
            detail: "AI 팀원, 역할, 필요 기능 복원 묶음은 설치된 데스크톱 앱에서 생성됩니다.",
            rawSecretMaterialStored: false,
            rawSecretMaterialReturned: false,
          },
        ],
        threadCount: 0,
        messageCount: 0,
        restoreChecklist: [
          {
            id: "desktop",
            label: "Windows 설치 앱",
            state: "missing",
            detail: "포터블 기억 폴더 진단은 설치된 데스크톱 앱에서만 실행됩니다.",
          },
        ],
        userMessage: "설치된 데스크톱 앱에서만 포터블 기억 저장소를 진단할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async listWorkspaceSkillAcquisitionProposals(workspaceId = "local_desktop") {
      return {
        status: "desktop_required",
        workspaceId,
        records: [],
        userMessage: "검증된 새 업무 도구 제안은 설치된 Windows 앱에서 확인할 수 있습니다.",
        externalMutation: false,
      };
    },
    async confirmWorkspaceSkillDownloadInstall(payload) {
      return {
        status: "desktop_required",
        workspaceId: payload.workspaceId ?? "local_desktop",
        proposalId: payload.proposalId,
        downloadStarted: false,
        installed: false,
        activated: false,
        userMessage: "업무 도구 다운로드 승인은 설치된 Windows 앱의 확인 창에서만 받을 수 있습니다.",
        externalMutation: false,
      };
    },
    async confirmWorkspaceSkillActivation(payload) {
      return {
        status: "desktop_required",
        workspaceId: payload.workspaceId ?? "local_desktop",
        proposalId: payload.proposalId,
        downloadStarted: false,
        installed: false,
        activated: false,
        userMessage: "업무 도구 사용 시작은 설치된 Windows 앱의 별도 확인 창에서만 받을 수 있습니다.",
        externalMutation: false,
      };
    },
    async saveWorkDecisions(payload) {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        decisionLedgerPath: "",
        decisionCount: Array.isArray(payload?.decisions) ? payload.decisions.length : 0,
        addedDecisionCount: 0,
        userMessage: "업무 결정 기억 저장은 설치된 데스크톱 앱에서만 로컬 폴더에 저장됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async saveWorkLearning(payload) {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        workPatternLedgerPath: "",
        workPatternCount: Array.isArray(payload?.records) ? payload.records.length : payload?.summary ? 1 : 0,
        addedWorkPatternCount: 0,
        userMessage: "업무 패턴 기억 저장은 설치된 데스크톱 앱에서만 로컬 폴더에 저장됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async listWorkPatterns() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        workPatternLedgerPath: "",
        workPatterns: [],
        workPatternCount: 0,
        userMessage: "저장한 업무 방식 관리는 설치된 데스크톱 앱의 로컬 기억 저장소에서 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async updateWorkPattern() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        workPatternLedgerPath: "",
        workPatterns: [],
        workPatternCount: 0,
        updatedWorkPatternId: "",
        userMessage: "저장한 업무 방식 수정은 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async removeWorkPattern() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        workPatternLedgerPath: "",
        workPatterns: [],
        workPatternCount: 0,
        removedWorkPatternCount: 0,
        userMessage: "저장한 업무 방식 삭제는 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async listLearningSources() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        learningSourcesPath: "",
        learningSources: [],
        learningSourceCount: 0,
        userMessage: "업무 자료 출처 관리는 설치된 데스크톱 앱의 로컬 기억 저장소에서 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async upsertLearningSources() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        learningSourcesPath: "",
        learningSources: [],
        learningSourceCount: 0,
        addedLearningSourceCount: 0,
        userMessage: "업무 자료 출처 저장은 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async removeLearningSource() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        learningSourcesPath: "",
        learningSources: [],
        learningSourceCount: 0,
        removedLearningSourceCount: 0,
        userMessage: "업무 자료 출처 삭제는 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async saveDelegationArtifact(payload) {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        artifactId: payload?.artifactId ?? "",
        artifactKind: payload?.artifactKind ?? "report",
        relativePath: "",
        filePath: "",
        metadataPath: "",
        ledgerPath: "",
        artifactCount: 0,
        delegationArtifactCount: 0,
        userMessage: "AI 팀원 결과 저장은 설치된 데스크톱 앱에서만 로컬 기억 폴더에 저장됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async listDelegationArtifacts() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        ledgerPath: "",
        artifacts: [],
        artifactCount: 0,
        delegationArtifactCount: 0,
        userMessage: "AI 팀원 결과 목록은 설치된 데스크톱 앱에서만 로컬 기억 폴더에서 불러옵니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openDelegationArtifact() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        relativePath: "",
        filePath: "",
        userMessage: "AI 팀원 결과 열기는 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openLocalMemoryFile(payload) {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        relativePath: payload?.relativePath ?? "",
        filePath: "",
        userMessage: "로컬 기억 파일 열기는 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async recordDelegationArtifactDecision(payload) {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        artifactId: payload?.artifactId ?? "",
        decision: payload?.decision ?? "held",
        approvalStatus: "",
        decisionCount: 0,
        userMessage: "승인 요청 처리 기록은 설치된 데스크톱 앱에서만 로컬 기억 폴더에 저장됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async recordHomeApprovalDecisionReceipt(payload) {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        receipts: payload?.receipt ? [payload.receipt] : [],
        receiptCount: payload?.receipt ? 1 : 0,
        userMessage: "최근 승인 결정 기록 저장은 설치된 데스크톱 앱에서만 로컬 기억 폴더에 저장됩니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async listHomeApprovalDecisionReceipts() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        receipts: [],
        receiptCount: 0,
        userMessage: "최근 승인 결정 기록 조회는 설치된 데스크톱 앱에서만 로컬 기억 폴더에서 불러옵니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async loadLocalMemoryPromptContext() {
      return {
        status: "desktop_required",
        root: "",
        defaultRoot: "",
        context: "",
        contextChars: 0,
        sectionCount: 0,
        userMessage: "설치된 데스크톱 앱에서만 CrewSoul과 DecisionMemory를 실제 답변 컨텍스트로 불러올 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async loadLearningLessons() {
      return {
        status: "desktop_required",
        lessons: [],
        totalCount: 0,
        userMessage: "설치된 데스크톱 앱에서만 지금까지 배운 것을 볼 수 있습니다.",
        externalMutation: false,
      };
    },
    async applyLearningLessons() {
      return {
        status: "desktop_required",
        lessons: [],
        applied: [],
        appliedCount: 0,
        userMessage: "설치된 데스크톱 앱에서만 배운 것을 저장할 수 있습니다.",
        externalMutation: false,
      };
    },
    async rollbackLearningLessons() {
      return {
        status: "desktop_required",
        lessons: [],
        applied: [],
        undoneCount: 0,
        userMessage: "설치된 데스크톱 앱에서만 배운 것을 되돌릴 수 있습니다.",
        externalMutation: false,
      };
    },
    async decideLearningProposal() {
      return {
        status: "desktop_required",
        lessons: [],
        applied: [],
        proposals: [],
        userMessage: "설치된 데스크톱 앱에서만 확인할 수 있습니다.",
        externalMutation: false,
      };
    },
    async listTasks() {
      return { status: "desktop_required", tasks: [], openCount: 0, blockedCount: 0, userMessage: "업무 원장은 설치된 데스크톱 앱에서만 볼 수 있습니다.", externalMutation: false };
    },
    async runTask() {
      return { status: "desktop_required", userMessage: "업무 실행은 설치된 데스크톱 앱에서 사용할 수 있습니다.", externalMutation: false };
    },
    async controlTaskExecution() {
      return { status: "desktop_required", userMessage: "업무 실행은 설치된 데스크톱 앱에서 사용할 수 있습니다.", externalMutation: false };
    },
    async upsertTasks() {
      return { status: "desktop_required", tasks: [], userMessage: "업무 원장은 설치된 데스크톱 앱에서만 쓸 수 있습니다.", externalMutation: false };
    },
    async answerTaskQuestion() {
      return { status: "desktop_required", tasks: [], userMessage: "설치된 데스크톱 앱에서만 답할 수 있습니다.", externalMutation: false };
    },
    async completeTask() {
      return { status: "desktop_required", tasks: [], userMessage: "설치된 데스크톱 앱에서만 끝낼 수 있습니다.", externalMutation: false };
    },
    async loadBackgroundDigestStatus() {
      return {
        status: "desktop_required",
        enabled: false,
        digests: [],
        userMessage: "배경 정리는 설치된 데스크톱 앱에서만 동작합니다.",
        externalMutation: false,
      };
    },
    async setBackgroundDigestEnabled() {
      return {
        status: "desktop_required",
        enabled: false,
        digests: [],
        userMessage: "배경 정리는 설치된 데스크톱 앱에서만 켤 수 있습니다.",
        externalMutation: false,
      };
    },
    async chooseDocumentLearningFiles() {
      return {
        status: "desktop_required",
        files: [],
        count: 0,
        userMessage: "컴퓨터 안의 업무 자료 선택은 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialReturned: false,
      };
    },
    async importDocumentLearningFiles() {
      return {
        status: "desktop_required",
        files: [],
        count: 0,
        skippedCount: 0,
        userMessage: "파일 끌어오기와 붙여넣기는 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        originalFilesMoved: false,
        originalFilesDeleted: false,
        rawSecretMaterialReturned: false,
      };
    },
    async chooseDocumentLearningFolders() {
      return {
        status: "desktop_required",
        files: [],
        folders: [],
        count: 0,
        skippedCount: 0,
        userMessage: "폴더나 드라이브 범위 선택은 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        originalFilesMoved: false,
        originalFilesDeleted: false,
        rawSecretMaterialReturned: false,
      };
    },
    async chooseDocumentLearningRoot() {
      return {
        status: "desktop_required",
        localStorageRoot: "",
        userMessage: "자료 검색 저장 위치 선택은 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialReturned: false,
      };
    },
    async classifyDocumentLearning() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 선택한 파일을 읽고 업무 기억으로 만들 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialReturned: false,
      };
    },
    async createDocumentLearningFolderPlan() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 로컬 폴더 정리 계획을 만들 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialReturned: false,
        originalFilesMoved: false,
        originalFilesDeleted: false,
      };
    },
    async stageMailAttachmentFolderPlan() {
      return {
        status: "desktop_required",
        attachmentCount: 0,
        addedInboxItemsCount: 0,
        userMessage: "메일 첨부 다운로드와 폴더 정리 후보 생성은 설치된 데스크톱 앱에서만 실행됩니다.",
        externalMutation: false,
        rawSecretMaterialReturned: false,
        originalFilesMoved: false,
        originalFilesDeleted: false,
        userApprovalRequiredBeforeMoveOrDelete: true,
      };
    },
    async previewDocumentLearningFolderPlan() {
      return {
        status: "desktop_required",
        operations: [],
        operationCount: 0,
        userMessage: "설치된 데스크톱 앱에서만 로컬 폴더 정리 계획의 실행 전 미리보기를 확인할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialReturned: false,
        originalFilesMoved: false,
        originalFilesDeleted: false,
      };
    },
    async applyDocumentLearningFolderPlan() {
      return {
        status: "desktop_required",
        appliedCount: 0,
        skippedCount: 0,
        userMessage: "실제 폴더 정리 적용은 설치된 데스크톱 앱에서 승인 후에만 실행됩니다.",
        userApprovalRequiredBeforeMoveOrDelete: true,
        externalMutation: false,
        rawSecretMaterialReturned: false,
        originalFilesMoved: false,
        originalFilesDeleted: false,
        overwritePerformed: false,
      };
    },
    async revertDocumentLearningFolderPlan() {
      return {
        status: "desktop_required",
        revertedCount: 0,
        skippedCount: 0,
        userMessage: "폴더 정리 되돌리기는 설치된 데스크톱 앱에서 승인 후에만 실행됩니다.",
        userApprovalRequiredBeforeMoveOrDelete: true,
        externalMutation: false,
        rawSecretMaterialReturned: false,
        originalFilesMoved: false,
        originalFilesDeleted: false,
        overwritePerformed: false,
      };
    },
    async searchDocumentLearningIndex() {
      return {
        status: "desktop_required",
        results: [],
        count: 0,
        userMessage: "설치된 데스크톱 앱에서만 로컬 업무 기억을 검색할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialReturned: false,
      };
    },
    async openDocumentLearningIndex() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 자료 검색 폴더를 열 수 있습니다.",
        externalMutation: false,
      };
    },
    async openDocumentLearningFile() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 로컬 파일을 열 수 있습니다.",
        externalMutation: false,
      };
    },
    async getDocumentLearningSupervisorStatus() {
      return createDesktopRequiredDocumentLearningSupervisorResult();
    },
    async pauseDocumentLearningSupervisorSource() {
      return createDesktopRequiredDocumentLearningSupervisorResult();
    },
    async resumeDocumentLearningSupervisorSource() {
      return createDesktopRequiredDocumentLearningSupervisorResult();
    },
    async revokeDocumentLearningSupervisorSource() {
      return createDesktopRequiredDocumentLearningSupervisorResult();
    },
    async reconcileDocumentLearningSupervisorSource() {
      return createDesktopRequiredDocumentLearningSupervisorResult();
    },
    async acknowledgeDocumentLearningSupervisorTeammateProposal() {
      return createDesktopRequiredDocumentLearningSupervisorResult();
    },
    async revealDocumentLearningPath() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 파일 위치(폴더)를 열 수 있습니다.",
        externalMutation: false,
      };
    },
    async loadAgentOrg() {
      return {
        status: "desktop_required",
        blueprint: null,
        specVersions: [],
        proposals: [],
        performanceRecords: [],
        userMessage: "설치된 데스크톱 앱에서만 에이전트 조직을 불러올 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async saveAgentOrg() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 에이전트 조직을 저장할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async recordAgentOrgPerformance() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 직원 성과를 기록할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async stageAgentOrgProposal() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 조직 제안을 승인함에 올릴 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async getAgentRuntimeStatus() {
      return {
        status: "desktop_required",
        runtimeLabel: "ModyCrew 자동화 실행 센터",
        capabilities: [],
        recentSessions: [],
        userMessage: "설치된 데스크톱 앱에서 자동화 실행 센터를 사용할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async runAgentSession() {
      return {
        status: "desktop_required",
        userMessage: "설치된 데스크톱 앱에서만 실제 업무 자동화를 실행할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async getPublicTriggerRelayStatus() {
      return {
        status: "desktop_required",
        queuedEventCount: 0,
        userMessage: "개인용 공개 릴레이 상태와 desktop pull은 설치된 데스크톱 앱에서 확인합니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async pullPublicTriggerRelay() {
      return {
        status: "desktop_required",
        accepted: false,
        eventsPulled: 0,
        eventsDispatched: 0,
        userMessage: "설치된 데스크톱 앱에서만 공개 릴레이 이벤트를 pull할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async getDesktopControlStatus() {
      return {
        status: "desktop_required",
        mode: "desktop_required",
        capabilities: [],
        userMessage: "컴퓨터 조작은 설치된 데스크톱 앱에서만 안전 모드로 준비할 수 있습니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async requestDesktopControlAction(payload) {
      return {
        status: "desktop_required",
        capability: payload.capability,
        userMessage: "설치된 데스크톱 앱에서만 컴퓨터 조작 요청을 보낼 수 있습니다.",
        sideEffect: "none",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
    async confirmDesktopControlAction() {
      return {
        status: "desktop_required",
        capability: "open_url",
        userMessage: "설치된 데스크톱 앱에서만 열기 확인을 실행할 수 있습니다.",
        sideEffect: "none",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    },
  };
}

function createBrowserSelectedWorkActionEventsResult(
  status: string,
  events: SelectedWorkActionEvent[],
  extra: Partial<Pick<SelectedWorkActionEventsResult, "userMessage">> = {},
): SelectedWorkActionEventsResult {
  return {
    status,
    events,
    userMessage:
      extra.userMessage ??
      "브라우저 미리보기에서는 이 화면의 실행 기록만 저장합니다. 설치 앱에서는 PC 로컬 감사 로그에 같이 남습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

const scheduleFallbackRuleIds = new Set([
  "daily-weekly-schedule-briefing",
  "urgent-deadline-watch",
  "meeting-reminder-watch",
]);

const browserAppProfileStorageKey = "modycrew-app-profile-v1";

function readBrowserAppProfile(): LocalMemoryAppProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(browserAppProfileStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as LocalMemoryAppProfile
      : null;
  } catch {
    return null;
  }
}

function writeBrowserAppProfile(profile: LocalMemoryAppProfile) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    browserAppProfileStorageKey,
    JSON.stringify({
      ...profile,
      version: profile.version ?? 1,
      updatedAt: new Date().toISOString(),
    }),
  );
}
