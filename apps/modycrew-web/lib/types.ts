/**
 * ModyCrew Web V2 UI 타입.
 *
 * Phase 1 PoC 단계에서는 도메인 패키지(`packages/domain`)에서 필요한 타입의
 * 부분 집합만 복사해 UI 와 분리합니다. Phase 2 에서 Electron preload API 와
 * 연결되며 `@domain/types` 직접 import 로 교체합니다.
 *
 * 새 필드 추가가 필요하면 먼저 `packages/domain/src/types.ts` 에 정의하고
 * 여기로 가져옵니다. UI 가 도메인 타입의 출처가 되면 안 됩니다.
 */

export type ISODateTimeString = string;

export type ToolRiskLabel = "low" | "medium" | "high" | "blocked";

export type WorkItemStatus =
  | "pending"
  | "analyzing"
  | "draft_ready"
  | "needs_review"
  | "approval_pending"
  | "completed"
  | "change_requested"
  | "held"
  | "rejected";

export type WorkItemSource =
  | "email"
  | "gmail"
  | "outlook"
  | "imap_smtp"
  | "webmail"
  | "mobile_share"
  | "company_mail"
  | "public_agency_mail"
  | "naver_inquiry"
  | "kakao_inquiry"
  | "naver_booking"
  | "kakao_booking"
  | "google_booking"
  | "manual_input"
  | "messaging_command"
  | "business_system"
  | "mailops"
  | "calendar"
  | "web_page"
  | "local_file"
  | "uploaded_file";

export type ToolOperationKind =
  | "read_data"
  | "analyze_data"
  | "draft_reply"
  | "draft_calendar_event"
  | "stage_approval"
  | "scenario_review"
  | "send_email"
  | "send_bulk_email"
  | "send_sms_message"
  | "create_calendar_event"
  | "connect_mailbox"
  | "share_file"
  | "submit_public_agency"
  | "tax_or_contract_execution"
  | "process_payment_or_refund"
  | "send_sensitive_personal_data";

export type RiskSignal = {
  id: string;
  label: string;
  riskLabel: Exclude<ToolRiskLabel, "low">;
  reason: string;
};

export type DraftCandidate = {
  id: string;
  toneLabel: string;
  body: string;
  operationKind: ToolOperationKind;
  requiresApprovalBeforeSend: boolean;
};

export type ScheduleCandidate = {
  id: string;
  label: string;
  startsAt: ISODateTimeString;
  endsAt: ISODateTimeString;
  conflictNote?: string;
};

export type WorkSourceEvidence = {
  messageId?: string;
  rfcMessageId?: string;
  connectorId?: string;
  providerId?: string;
  mailboxLabel?: string;
  messageSubject?: string;
  senderPreview?: string;
  replyToLabel?: string;
  /** 답장 받을 주소를 가린 값(예: k***@customer.co.kr). 원래 주소는 데스크톱 main 안에만 있습니다. */
  replyToAddressMasked?: string;
  /** 원래 메일 제목(답장 제목 "Re: 원제목"의 재료). */
  originalSubject?: string;
  mailThreadLabel?: string;
  draftPreview?: string;
  receivedAt?: ISODateTimeString;
  messageSnippet?: string;
  detectedIntentLabels?: string[];
  approvalCandidateLabels?: string[];
  mobileReceiveFilterIds?: string[];
  mobileReceiveFilterLabels?: string[];
  calendarCandidateText?: string;
  calendarTimeRangeLabel?: string;
  calendarStartsAt?: ISODateTimeString;
  calendarEndsAt?: ISODateTimeString;
  calendarAttendeeLabels?: string[];
  calendarLocationLabel?: string;
  calendarReminderLabel?: string;
  calendarConflictLabel?: string;
  calendarBusyWindowCount?: number;
  scheduleWindowLabel?: string;
  mailAttachmentOrganizer?: {
    contract?: string;
    messageSubject?: string;
    sourceMessageId?: string;
    attachmentCandidateCount?: number;
    downloadedAttachmentCount?: number;
    connectorId?: string;
    providerId?: string;
    downloadStatus?: string;
    stagingHandoffKind?: string;
    stagingHandoffContract?: string;
    localCopyOnly?: boolean;
    originalMailMutation?: boolean;
    originalAttachmentDeleted?: boolean;
    externalShareBeforeApproval?: boolean;
  };
  mailAutomationNotificationDraft?: {
    contract?: string;
    dispatchPolicy?: string;
    channelSummary?: string;
    routeLabel?: string;
    actionLabel?: string;
    approvalQueueCount?: number;
    ignoredMailCount?: number;
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
  mailTriageEvidence?: {
    contract?: string;
    classification?: string;
    classificationReason?: string;
    priorityLabel?: string;
    workKindLabels?: string[];
    distributionLabel?: string;
    importantWorkLabel?: string;
    ignoredNoiseCount?: number;
    businessMailCount?: number;
    needsReviewCount?: number;
    approvalCandidateCount?: number;
    replyDraftCandidateCount?: number;
    calendarDraftCandidateCount?: number;
    attachmentSignalCandidateCount?: number;
    skippedBeforeBodyCount?: number;
    bodyPreviewAllowedCount?: number;
    bodyPreviewPolicy?: string;
    safetyBoundary?: string;
    ignoredCandidateLabels?: string[];
    importantCandidateLabels?: string[];
    externalMutation?: false;
    rawSecretMaterialStored?: false;
    rawSecretMaterialReturned?: false;
  };
  mailWorkBundle?: {
    contract?: string;
    bundleLabel?: string;
    replyDraftReady?: boolean;
    calendarCandidateReady?: boolean;
    calendarBusyWindowCount?: number;
    approvalOperationKinds?: string[];
    finalActionBoundary?: string;
    nextUserAction?: string;
    externalMutation?: false;
  };
  recipientListReview?: {
    sourceLabel?: string;
    sourceType?: string;
    rowCount?: number;
    validRecipientCount?: number;
    readyForSampleCount?: number;
    personalizationReviewCount?: number;
    excludedCount?: number;
    duplicateCount?: number;
    missingAddressCount?: number;
    missingPersonalizationCount?: number;
    targetGroupLabels?: string[];
    recommendedGroupLabels?: string[];
    recipientDecisionMatrix?: {
      send?: string[];
      hold?: string[];
      exclude?: string[];
    };
    exclusionRuleLabels?: string[];
    exclusionReasonLabels?: string[];
    groupSamplePreviewLabels?: string[];
    personalizationGapLabels?: string[];
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
    learningProfileSummary?: string;
    learnedTargetGroupLabels?: string[];
    learnedExclusionRuleHints?: string[];
    learnedToneHints?: string[];
    learnedApprovalHabitLabels?: string[];
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
    learningEvidenceLabels?: string[];
    learningPrivacyBoundary?: string;
    samplePreviewCount?: number;
    dryRunBlockedReason?: string;
    privacyBoundary?: string;
  };
  mailThreadRecipientDecision?: {
    replyTargetLabel?: string;
    recipientDecisionSummary?: string;
    sendCandidateLabels?: string[];
    holdCandidateLabels?: string[];
    excludeCandidateLabels?: string[];
    learningDecisionHints?: string[];
    privacyBoundary?: string;
  };
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
  mailWorkQueueReviewHandoff?: {
    sourceContract?: string;
    decision?: string;
    finalRoute?: string;
    draftBodySource?: string;
    revisedDraftPreview?: string;
    reviewNote?: string;
    sendCheckSummary?: string;
    decisionReasonSummary?: string;
    externalMutationBeforeGate: false;
  };
  userComposedMailReview?: {
    proof?: string;
    oneLineSummary?: string;
    readinessLabel?: string;
    revisionSuggestion?: string;
    revisedDraftPreview?: string;
    finalRouteLabel?: string;
    decisionOptions?: string[];
    mobileReceiveFilterIds?: string[];
    mobileReceiveFilterLabels?: string[];
    approvalGate?: string;
    reviewItems?: Array<{
      id?: string;
      label?: string;
      state?: "ok" | "needs_review" | "missing" | string;
      detail?: string;
    }>;
    sendReviewItems?: Array<{
      id?: string;
      label?: string;
      title?: string;
      state?: "ok" | "needs_review" | "missing" | "locked" | string;
      detail?: string;
    }>;
  };
  scenarioReview?: {
    id?: string;
    label?: string;
    evidenceCount?: number;
    guidance?: string;
    nextAction?: string;
    safetyGate?: string;
    preparedOutput?: string;
    verificationEvidence?: string;
    finalActionBoundary?: string;
  };
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type WorkScheduleBriefing = {
  kind: "weekly" | "deadline" | "meeting" | "date_confirmation";
  triggerRuleId?: string;
  sourceWorkItemIds?: string[];
  anchorCount: number;
  nextCheckAt?: ISODateTimeString;
  nextCheckHintMinutes?: number;
  attentionLevel: "interrupt" | "attention" | "digest";
  reminderLabel?: string;
  reason: string;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type WorkItem = {
  cardOrigin?: "mail_scan" | "user_request" | "ai_suggestion";
  cardDisposition?: {
    kind: "acknowledged" | "ignored" | "deferred" | "restored";
    at: string;
    batchId: string;
    restoredFromBatchId?: string;
    history: { kind: string; at: string; batchId: string }[];
  };
  mailDispatchStatus?: { status: string; message: string };
  /** 설치 앱이 광고·뉴스레터·자동 알림으로 본 메일 카드. '한꺼번에 치우기' 제안에만 쓰고 자동으로 치우지 않는다. */
  looksLikeNoise?: boolean;
  id: string;
  title: string;
  teammateId?: string;
  teammateName?: string;
  source: WorkItemSource;
  sourceLabel: string;
  senderLabel: string;
  body: string;
  summary: string;
  status: WorkItemStatus;
  riskLabel: ToolRiskLabel;
  riskSignals: RiskSignal[];
  receivedAt: ISODateTimeString;
  dueAt?: ISODateTimeString;
  deadlineAt?: ISODateTimeString;
  /** 메일 카드: 먼저 볼 순서(정렬·'급함' 표시용 — 발송·실행과 무관). */
  priority?: "urgent" | "normal" | "low";
  /** 한 줄 이유(예: "Jev: 회신 필요 가능성 높음 · 오늘 마감 언급"). */
  priorityReason?: string;
  /** Jev 판단을 함께 봤는지(jev) 규칙만 썼는지(rule). */
  prioritySource?: "jev" | "rule";
  jevUrgencyScore?: number;
  jevReplyChance?: number;
  /** 메일 업무 종류(견적·정산·일정…) — 담당 제안 근거. */
  mailCategory?: string;
  mailCategorySource?: "jev" | "rule";
  /** 이 카드를 맡은 AI 직원(표시용). 사용자가 카드에서 바꿀 수 있다. */
  assigneeTeammateId?: string;
  assigneeName?: string;
  assigneeRoleTitle?: string;
  assigneeSource?: "jev" | "rule" | "default" | "user";
  assigneeReason?: string;
  sourceEvidence?: WorkSourceEvidence;
  webmailFallback?: {
    status?: string;
    planStatus?: string;
    checkedAt?: ISODateTimeString;
    domCaptureStatus?: string;
    domExtractionStatus?: string;
    domRecoveryStatus?: string;
    domRecoveryReasonLabel?: string;
    domRecoveryNextAction?: string;
    domRecoveryChecklist?: string[];
    messageCount?: number;
    ignoredItemsCount?: number;
    approvalQueueCount?: number;
    attachmentCandidateCount?: number;
    calendarCandidateCount?: number;
    bodyPreviewAllowedCount?: number;
    bodyPreviewSkippedBeforeBodyCount?: number;
    classificationSummary?: string;
    filterEvidenceLabel?: string;
    approvalEvidenceLabel?: string;
    finalActionLockLabel?: string;
    ignoredCandidateLabels?: string[];
    approvalCandidateLabels?: string[];
    externalMutation: false;
    rawSecretMaterialStored: false;
    rawSecretMaterialReturned: false;
  };
  scheduleBriefing?: WorkScheduleBriefing;
  channelDecision?: {
    channel: string;
    decision: string;
    decisionLabel?: string;
    decidedBy: string;
    decidedAt: ISODateTimeString;
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
    externalMutation: false;
    revisionInstruction?: string;
  };
  draft?: DraftCandidate;
  schedules?: ScheduleCandidate[];
  localFile?: {
    path: string;
    name: string;
    folder: string;
    extension: string;
    sizeLabel: string;
    modifiedAt: ISODateTimeString;
    extractedTextStatus: "pending" | "ready" | "failed";
    preview?: string;
    scopeKind?: "file" | "folder";
    selectionMode?: "explicit_path" | "user_selected_file_or_folder";
    folderScopePolicy?: string;
    childCountLabel?: string;
  };
  browserTask?: {
    targetUrl: string;
    host: string;
    requiresFinalUserPresence: boolean;
    blockedCapabilities: string[];
    actionPlan: Array<{
      id: string;
      label: string;
      capability: string;
      riskLabel: ToolRiskLabel;
      requiresFinalUserPresence: boolean;
      reason: string;
    }>;
    stagedAction?: {
      id: string;
      label: string;
      capability: string;
      riskLabel: ToolRiskLabel;
      requiresFinalUserPresence: boolean;
      reason: string;
    };
    sourceWorkItemId?: string;
    dryRunRequired?: boolean;
    dryRunPlan?: {
      intendedInput: string;
      clickTarget: string;
      expectedResult: string;
      cancelPath: string;
      rollbackGuide: string;
      preflightChecklist: string[];
    };
    finalPresenceContract?: {
      finalUserPresence: true;
      readiness:
        | "screen_evidence_required"
        | "read_only_review"
        | "ready_for_user_confirmation"
        | "limited_execution_ready"
        | "limited_execution_confirmed_adapter_locked"
        | "limited_execution_executed"
        | "limited_execution_result_verified"
        | "limited_execution_result_needs_review";
      host: string;
      targetUrl: string;
      actionLabel: string;
      capability: string;
      targetElementDescription: string;
      screenEvidenceRequired: boolean;
      screenEvidenceStatus: "not_captured" | "captured" | "not_required";
      screenEvidence?: {
        capturedAt: string;
        mode: string;
        sourceKind: "window" | "screen" | "unknown";
        sourceLabel: string;
        sourceCount: number;
        matchReason: string;
        targetElementDescription: string;
        evidenceSummary: string;
        rawPixelsStored: false;
        rawSecretMaterialStored: false;
        rawSecretMaterialReturned: false;
      };
      targetElementMatchStatus?: "not_matched" | "matched" | "needs_user_review";
      targetElementMatch?: {
        matchedAt: string;
        status: "not_matched" | "matched" | "needs_user_review";
        confidence: "low" | "medium" | "high";
        targetLabel: string;
        evidenceSourceLabel: string;
        matchingMethod: string;
        safetyNotes: string[];
        rawCoordinatesStored: false;
        rawPixelsStored: false;
        rawSecretMaterialStored: false;
        rawSecretMaterialReturned: false;
      };
      limitedExecutionGate?: {
        preparedAt: string;
        status: "prepared" | "blocked" | "executed";
        auditId: string;
        auditFile: string;
        auditRecorded: boolean;
        confirmationAuditFile?: string;
        confirmationAuditRecorded?: boolean;
        executionAttemptedAt?: string;
        executionAttemptAuditFile?: string;
        executionAttemptAuditRecorded?: boolean;
        executedAt?: string;
        executionAuditFile?: string;
        executionAuditRecorded?: boolean;
        adapterResultSummary?: string;
        postExecutionVerifiedAt?: string;
        postExecutionStatus?: "verified" | "needs_user_review" | "";
        postExecutionAuditFile?: string;
        postExecutionAuditRecorded?: boolean;
        postExecutionEvidence?: {
          verifiedAt: string;
          sourceKind: "window" | "screen" | "unknown";
          sourceLabel: string;
          sourceCount: number;
          matchReason: string;
          targetLabel: string;
          expectedResult: string;
          verificationSummary: string;
          rawCoordinatesStored: false;
          rawPixelsStored: false;
          rawSecretMaterialStored: false;
          rawSecretMaterialReturned: false;
        };
        userVisibleOutcome?: string;
        blockedReason?: string;
        userConfirmedAt?: string;
        userConfirmationVerified?: boolean;
        adapterReadiness?: "adapter_not_connected" | "ready";
        executionStatus?: "not_ready" | "adapter_locked" | "ready" | "executed";
        actionCapability: string;
        actionLabel: string;
        targetLabel: string;
        intendedInput: string;
        expectedResult: string;
        confirmationPhrase: string;
        requiresFinalUserPresence: true;
        liveExecutionEnabled: boolean;
        dryRunOnly: boolean;
        rollbackGuide: string;
        safetyChecklist: string[];
        blockedCapabilities: string[];
        rawCoordinatesStored: false;
        rawPixelsStored: false;
        rawSecretMaterialStored: false;
        rawSecretMaterialReturned: false;
      };
      userConfirmationPhrase: string;
      blockedReason: string;
      allowedNextStep: string;
      manualVerificationChecklist: string[];
    };
  };
  approvedOutput?: {
    path: string;
    folder: string;
    name: string;
    kind: string;
    alternatePaths?: Array<{
      path: string;
      name: string;
      kind: string;
      label: string;
    }>;
    createdAt: ISODateTimeString;
  };
  finalAction?: {
    kind: Extract<ToolOperationKind, "send_email" | "send_bulk_email" | "create_calendar_event" | "connect_mailbox" | "share_file" | "scenario_review">;
    label: string;
    requiresFinalUserPresence: boolean;
    readiness: "adapter_not_connected" | "ready_for_final_confirmation" | "sent";
    blockedReason: string;
    checklist: string[];
    /** 실제로 보낸(등록한) 시각. 있으면 이 카드는 다시 보낼 수 없습니다. */
    sentAt?: ISODateTimeString;
    sentStatus?: "sent" | "partial";
    providerMessageId?: string;
    mailSendApprovalGate?: {
      policy: "work_queue_approve_only" | "user_composed_check_approve_only" | "not_required";
      requiredDecision?: "approve";
      decision?: "approve" | "revise" | "hold" | "exclude" | "missing";
      requiredFinalRoute?: "included";
      finalRoute?: "included" | "held" | "excluded" | "missing";
      sourceContract?: string;
      revisedDraft?: string;
      reviewNote?: string;
      decisionReasonSummary?: string;
      sendCheckSummary?: string;
      draftBodySource?: "user_revised_draft" | "review_note" | "approval_preview" | "classification";
      externalMutationBeforeGate: false;
    };
  };
  scheduleConfirmation?: {
    kind: "date_confirmation";
    sourceWorkItemId: string;
    sourceTitle: string;
    sourceText: string;
    reason: string;
    question: string;
    confirmedAt?: ISODateTimeString;
    confirmedStartsAt?: ISODateTimeString;
    confirmedEndsAt?: ISODateTimeString;
  };
};

export type WorkbenchHeaderMetrics = {
  newToday: number;
  pendingApproval: number;
  riskFlagged: number;
  lastSyncedAt?: ISODateTimeString;
};
