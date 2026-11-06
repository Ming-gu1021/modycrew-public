import type { ISODateTimeString } from "./types.js";

export type ModyMailLiveE2ERehearsalStatus =
  | "ready_for_live_rehearsal"
  | "needs_mail_connection"
  | "needs_polling_enabled"
  | "needs_live_mail_evidence";

export type ModyMailLiveE2ERehearsalStepState =
  | "ready"
  | "review"
  | "approval"
  | "locked";

export type ModyMailLiveE2ERehearsalStep = {
  id: string;
  label: string;
  title: string;
  detail: string;
  state: ModyMailLiveE2ERehearsalStepState;
  evidenceLabel: string;
};

export type ModyMailLiveE2ERehearsalPlan = {
  contract: "mail_live_e2e_rehearsal_approval_safe";
  status: ModyMailLiveE2ERehearsalStatus;
  createdAt: ISODateTimeString;
  readOnly: true;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  aiCredentialPolicy: "credential_reference_id_only";
  browserSessionPolicy: "browser_session_reference_only_when_imap_unavailable";
  liveReadiness: {
    mailConnectionReady: boolean;
    calendarConnectionReady: boolean;
    securePollingPrepared: boolean;
    newMailEvidenceReady: boolean;
    approvalCandidateReady: boolean;
    calendarDryRunReady: boolean;
    attachmentFolderPlanReady: boolean;
    attachmentDownloadReviewReady: boolean;
    attachmentLocalCopyStaged: boolean;
    attachmentFolderApprovalCardReady: boolean;
    attachmentOriginalPreserved: boolean;
    webmailCredentialReferenceReady: boolean;
    webmailBodyPreviewGateReady: boolean;
    initialProfileLearningReady: boolean;
    approvalNotificationDraftReady: boolean;
    approvalNotificationChannelReady: boolean;
    approvalNotificationDispatchReady: boolean;
    messengerDecisionReplyReady: boolean;
    messengerDecisionTargetMatched: boolean;
    messengerDecisionFinalConfirmationLocked: boolean;
    finalActionDryRunReady: boolean;
    finalActionApprovalGateReady: boolean;
    finalActionAdapterReady: boolean;
    finalActionReadyAfterApproval: boolean;
    finalSendLockedUntilApproval: true;
    attachmentStagingLockedUntilApproval: true;
  };
  steps: ModyMailLiveE2ERehearsalStep[];
  nextOperatorActions: string[];
  approvalGate: string;
  privacyBoundary: string;
  auditMessages: string[];
};

export function createMailLiveE2ERehearsalPlan(input: {
  connectedProviderIds?: string[];
  securePollingPrepared?: boolean;
  newMailSignalCount?: number;
  duplicateMailSuppressedCount?: number;
  messageCount?: number;
  ignoredItemsCount?: number;
  approvalQueueCount?: number;
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
  profileReady?: boolean;
  calendarCandidateCount?: number;
  calendarFreeBusyChecked?: boolean;
  calendarBusyWindowCount?: number;
  calendarDryRunReportPath?: string;
  finalActionDryRunReady?: boolean;
  finalActionApprovalGateReady?: boolean;
  finalActionAdapterReady?: boolean;
  finalActionReadinessReportPath?: string;
  webmailDomCaptureStatus?: string;
  webmailDomExtractionStatus?: string;
  webmailDomRowCount?: number;
  webmailDomExtractedCount?: number;
  webmailCredentialReferenceCount?: number;
  webmailCredentialReferenceIds?: string[];
  webmailCredentialReferencePolicy?: string;
  webmailAiSecretReadable?: boolean;
  webmailBodyPreviewAllowedCount?: number;
  webmailBodyPreviewSkippedBeforeBodyCount?: number;
  approvalNotificationDraftReady?: boolean;
  approvalNotificationChannelReady?: boolean;
  approvalNotificationSent?: boolean;
  approvalNotificationTargetCount?: number;
  approvalNotificationProviderMessageId?: string;
  messengerDecisionReplyReceived?: boolean;
  messengerDecisionTargetMatched?: boolean;
  messengerDecisionTargetCode?: string;
  messengerDecisionTargetWorkItemId?: string;
  messengerDecisionFinalConfirmationLocked?: boolean;
  messengerDecisionEvidenceSource?: string;
  createdAt?: ISODateTimeString;
}): ModyMailLiveE2ERehearsalPlan {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const providerIds = new Set((input.connectedProviderIds ?? []).map((id) => id.toLowerCase()));
  const mailConnectionReady = [...providerIds].some((id) => /gmail|outlook|imap|smtp|webmail|mail/u.test(id));
  const calendarConnectionReady = [...providerIds].some((id) => /calendar|google-calendar|outlook-calendar/u.test(id));
  const securePollingPrepared = input.securePollingPrepared === true;
  const newMailSignalCount = safeCount(input.newMailSignalCount);
  const messageCount = safeCount(input.messageCount);
  const ignoredItemsCount = safeCount(input.ignoredItemsCount);
  const approvalQueueCount = safeCount(input.approvalQueueCount);
  const attachmentCandidateCount = safeCount(input.attachmentCandidateCount);
  const stagedMailAttachmentCount = safeCount(input.stagedMailAttachmentCount);
  const attachmentFolderPlanReady =
    input.attachmentFolderPlanStaged === true ||
    stagedMailAttachmentCount > 0 ||
    Boolean(input.attachmentFolderPlanPath && input.attachmentFolderPlanPath.trim());
  const attachmentDownloadReviewReady =
    input.attachmentDownloadReviewReady === true ||
    input.attachmentOrganizerStatus === "ready_for_download_review" ||
    attachmentCandidateCount > 0;
  const attachmentLocalCopyStaged =
    input.attachmentLocalCopyStaged === true ||
    stagedMailAttachmentCount > 0 ||
    Boolean(input.attachmentFolderPlanPath && input.attachmentFolderPlanPath.trim());
  const attachmentFolderApprovalCardReady =
    input.attachmentFolderApprovalCardReady === true ||
    input.attachmentFolderPlanStaged === true ||
    (attachmentLocalCopyStaged && attachmentFolderPlanReady);
  const attachmentOriginalPreserved = input.attachmentOriginalPreserved !== false;
  const duplicateMailSuppressedCount = safeCount(input.duplicateMailSuppressedCount);
  const calendarCandidateCount = safeCount(input.calendarCandidateCount);
  const calendarBusyWindowCount = safeCount(input.calendarBusyWindowCount);
  const approvalCandidateReady = approvalQueueCount > 0;
  const calendarDryRunReady =
    input.calendarFreeBusyChecked === true ||
    calendarBusyWindowCount > 0 ||
    Boolean(input.calendarDryRunReportPath && input.calendarDryRunReportPath.trim());
  const finalActionDryRunReady =
    input.finalActionDryRunReady === true ||
    Boolean(input.finalActionReadinessReportPath && input.finalActionReadinessReportPath.trim());
  const finalActionApprovalGateReady = input.finalActionApprovalGateReady === true;
  const finalActionAdapterReady = input.finalActionAdapterReady === true;
  const finalActionReadyAfterApproval =
    approvalCandidateReady &&
    finalActionDryRunReady &&
    finalActionApprovalGateReady &&
    finalActionAdapterReady;
  const webmailFallbackInUse = [...providerIds].some((id) => /webmail/u.test(id));
  const webmailCredentialReferenceIds = Array.isArray(input.webmailCredentialReferenceIds)
    ? input.webmailCredentialReferenceIds.map((id) => String(id ?? "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const webmailCredentialReferenceCount = Math.max(
    safeCount(input.webmailCredentialReferenceCount),
    webmailCredentialReferenceIds.length,
  );
  const webmailCredentialReferenceReady =
    !webmailFallbackInUse ||
    (webmailCredentialReferenceCount > 0 && input.webmailAiSecretReadable !== true);
  const webmailDomRowCount = safeCount(input.webmailDomRowCount);
  const webmailDomExtractedCount = safeCount(input.webmailDomExtractedCount);
  const webmailBodyPreviewAllowedCount = safeCount(input.webmailBodyPreviewAllowedCount);
  const webmailBodyPreviewSkippedBeforeBodyCount = safeCount(input.webmailBodyPreviewSkippedBeforeBodyCount);
  const webmailDomCaptureReady =
    input.webmailDomCaptureStatus === "webmail_dom_rows_captured" && webmailDomRowCount > 0;
  const webmailDomExtractionReady =
    input.webmailDomExtractionStatus === "metadata_extracted" && webmailDomExtractedCount > 0;
  const webmailBodyPreviewGateReady =
    webmailDomExtractionReady &&
    (webmailBodyPreviewAllowedCount > 0 || webmailBodyPreviewSkippedBeforeBodyCount > 0);
  const approvalNotificationTargetCount = safeCount(input.approvalNotificationTargetCount);
  const approvalNotificationDraftReady =
    input.approvalNotificationDraftReady === true || approvalCandidateReady;
  const approvalNotificationChannelReady = input.approvalNotificationChannelReady === true;
  const approvalNotificationDispatchReady =
    input.approvalNotificationSent === true ||
    approvalNotificationTargetCount > 0 ||
    Boolean(input.approvalNotificationProviderMessageId && input.approvalNotificationProviderMessageId.trim());
  const messengerDecisionReplyReady = input.messengerDecisionReplyReceived === true;
  const messengerDecisionTargetMatched =
    input.messengerDecisionTargetMatched === true ||
    Boolean(input.messengerDecisionTargetCode && input.messengerDecisionTargetCode.trim()) ||
    Boolean(input.messengerDecisionTargetWorkItemId && input.messengerDecisionTargetWorkItemId.trim());
  const messengerDecisionFinalConfirmationLocked =
    input.messengerDecisionFinalConfirmationLocked === true ||
    (messengerDecisionReplyReady && messengerDecisionTargetMatched);
  const newMailEvidenceReady = newMailSignalCount > 0 || messageCount > 0;
  const initialProfileLearningReady = input.profileReady === true;
  const status: ModyMailLiveE2ERehearsalStatus = !mailConnectionReady
    ? "needs_mail_connection"
    : !securePollingPrepared
      ? "needs_polling_enabled"
      : !newMailEvidenceReady
        ? "needs_live_mail_evidence"
        : "ready_for_live_rehearsal";

  const steps: ModyMailLiveE2ERehearsalStep[] = [
    {
      id: "connection",
      label: "연결",
      title: mailConnectionReady ? "메일 읽기 연결 준비" : "메일 연결 필요",
      detail: calendarConnectionReady
        ? "메일과 캘린더 연결을 함께 확인했습니다."
        : "미팅 후보까지 확인하려면 캘린더 연결을 추가로 확인합니다.",
      state: mailConnectionReady ? "ready" : "review",
      evidenceLabel: mailConnectionReady ? "credentialReferenceId only" : "connect_mailbox_before_live_rehearsal",
    },
    {
      id: "polling",
      label: "5분",
      title: securePollingPrepared ? "5분 점검 규칙 준비" : "자동 점검 켜기 전",
      detail: "켜진 규칙만 데스크톱 점검기에 동기화하고, 중복 커서는 다음 실행에서 제외합니다.",
      state: securePollingPrepared ? "ready" : "review",
      evidenceLabel: `new ${newMailSignalCount} / duplicate ${duplicateMailSuppressedCount}`,
    },
    {
      id: "webmail-credential-reference",
      label: "보관",
      title: webmailCredentialReferenceReady ? "웹메일 보관함 참조 준비" : "웹메일 보관함 참조 증거 필요",
      detail: webmailCredentialReferenceReady
        ? "웹메일 로그인 비밀번호는 원문 없이 OS 보관함 참조 ID로만 자동 점검기에 전달됩니다."
        : "웹메일 fallback을 쓰려면 비밀번호 원문 대신 credentialReferenceId 또는 browserSessionReferenceId 증거가 필요합니다.",
      state: webmailCredentialReferenceReady ? "ready" : webmailFallbackInUse ? "review" : "locked",
      evidenceLabel: `${webmailCredentialReferenceCount} refs / aiSecretReadable=${input.webmailAiSecretReadable === true}`,
    },
    {
      id: "webmail-dom",
      label: "웹메일",
      title: webmailDomCaptureReady ? "웹메일 목록 DOM 캡처 증거" : "웹메일 DOM 캡처 대기",
      detail: webmailDomExtractionReady
        ? "브라우저 세션 참조로 목록 행을 읽고 raw HTML/body 없이 메타데이터로 추출했습니다."
        : "IMAP이 막힌 회사 메일은 로그인된 웹메일 창의 목록 행만 읽어 증거를 남깁니다.",
      state: webmailDomExtractionReady ? "ready" : webmailDomCaptureReady ? "review" : "locked",
      evidenceLabel: `${webmailDomRowCount} rows / ${webmailDomExtractedCount} extracted`,
    },
    {
      id: "webmail-preview-gate",
      label: "본문",
      title: webmailBodyPreviewGateReady ? "웹메일 제한 preview 선별" : "웹메일 preview 증거 대기",
      detail: webmailBodyPreviewGateReady
        ? "업무 후보만 제한 preview로 넘기고 광고/스팸성 항목은 본문 preview 전에 제외했습니다."
        : "웹메일 fallback은 raw body를 저장하지 않고 업무 후보에 한해 제한 preview 증거만 남깁니다.",
      state: webmailBodyPreviewGateReady ? "ready" : webmailDomExtractionReady ? "review" : "locked",
      evidenceLabel: `${webmailBodyPreviewAllowedCount} preview / ${webmailBodyPreviewSkippedBeforeBodyCount} skipped`,
    },
    {
      id: "triage",
      label: "분류",
      title: newMailEvidenceReady ? "실제 메일 후보 분류" : "테스트 메일 대기",
      detail: ignoredItemsCount > 0
        ? "광고, 뉴스레터, 자동 알림은 본문을 깊게 읽기 전에 제외했습니다."
        : "업무 메일과 광고 메일을 각각 보내면 분류 증거가 더 선명해집니다.",
      state: newMailEvidenceReady ? "ready" : "review",
      evidenceLabel: `${messageCount} read / ${ignoredItemsCount} skipped`,
    },
    {
      id: "initial-profile-learning",
      label: "학습",
      title: initialProfileLearningReady ? "초기 메일함 프로필 준비" : "초기 메일함 프로필 대기",
      detail: initialProfileLearningReady
        ? "초기 메일에서 말투, 광고 제외, 대량 메일, 일정 선호, 승인 습관을 비밀값 없이 저장 후보로 요약했습니다."
        : "메일 증거가 쌓이면 말투와 대량 발송 기준을 원문 주소/비밀번호 없이 학습 후보로 만듭니다.",
      state: initialProfileLearningReady ? "ready" : newMailEvidenceReady ? "review" : "locked",
      evidenceLabel: initialProfileLearningReady
        ? "initial_mail_profile_learning_secret_blind"
        : "tone_noise_bulk_approval_profile_waiting",
    },
    {
      id: "approval",
      label: "승인",
      title: approvalCandidateReady ? "오피스 승인함 후보 준비" : "승인 후보 대기",
      detail: calendarCandidateCount > 0
        ? "일정 후보도 승인함에서 확인한 뒤 캘린더 등록으로 넘어갑니다."
        : "답장, 일정, 첨부 후보는 승인함에서 실행하기 전까지 잠깁니다.",
      state: approvalCandidateReady ? "approval" : "locked",
      evidenceLabel: `${approvalQueueCount} approval candidates`,
    },
    {
      id: "approval-notification",
      label: "알림",
      title: approvalNotificationDispatchReady
        ? "승인 후보 외부 알림 전송 증거"
        : approvalNotificationChannelReady ? "승인 후보 알림 채널 준비" : "승인 후보 알림 채널 대기",
      detail: approvalNotificationDispatchReady
        ? "사용자 클릭으로 연결된 알림 채널에 승인 후보 요약만 보냈고 메일 발송/일정 등록/첨부 이동은 계속 잠갔습니다."
        : approvalNotificationChannelReady
          ? "알림 초안과 채널은 준비됐고, 외부 알림은 사용자가 버튼을 눌렀을 때만 보냅니다."
          : "앱 승인함이 기본 경로이며, Telegram 같은 외부 알림은 사용자가 채널을 연결한 뒤 버튼을 눌러야 보냅니다.",
      state: approvalNotificationDispatchReady ? "ready" : approvalNotificationChannelReady ? "approval" : approvalCandidateReady ? "review" : "locked",
      evidenceLabel:
        `draft=${approvalNotificationDraftReady} / channel=${approvalNotificationChannelReady} / sent=${approvalNotificationDispatchReady} / targets=${approvalNotificationTargetCount}`,
    },
    {
      id: "messenger-decision",
      label: "답장",
      title: messengerDecisionReplyReady
        ? "휴대폰 답장 승인 후보 매칭"
        : approvalNotificationDispatchReady ? "휴대폰 답장 매칭 대기" : "알림 전송 후 답장 대기",
      detail: messengerDecisionFinalConfirmationLocked
        ? "휴대폰 답장은 같은 승인 후보에 의사만 기록했고 실제 발송/일정/파일 실행은 앱 최종 확인 전까지 잠갔습니다."
        : "Telegram 같은 채널 답장은 대상 코드를 같은 승인 후보로 매칭한 뒤 앱 최종 확인 카드로 돌려보냅니다.",
      state: messengerDecisionFinalConfirmationLocked
        ? "ready"
        : messengerDecisionReplyReady
          ? "approval"
          : approvalNotificationDispatchReady ? "review" : "locked",
      evidenceLabel:
        `reply=${messengerDecisionReplyReady} / target=${messengerDecisionTargetMatched} / finalLock=${messengerDecisionFinalConfirmationLocked}`,
    },
    {
      id: "calendar-dry-run",
      label: "일정",
      title: calendarDryRunReady
        ? "캘린더 freeBusy dry-run 확인"
        : calendarCandidateCount > 0 ? "일정 후보 dry-run 필요" : "일정 후보 없음",
      detail: calendarDryRunReady
        ? "캘린더는 freeBusy 읽기 전용으로만 확인했고 일정 등록/초대 발송은 승인 전까지 잠급니다."
        : "미팅 후보가 있으면 캘린더 freeBusy를 먼저 읽어 충돌 시간과 등록 전 확인 카드를 만듭니다.",
      state: calendarDryRunReady ? "ready" : calendarCandidateCount > 0 ? "approval" : "locked",
      evidenceLabel: `${calendarCandidateCount} calendar candidates / ${calendarBusyWindowCount} busy windows`,
    },
    {
      id: "final-action-readiness",
      label: "실행",
      title: finalActionReadyAfterApproval
        ? "승인 후 실행 준비 확인"
        : approvalCandidateReady ? "승인 후 실행 준비 필요" : "실행 후보 없음",
      detail: finalActionReadyAfterApproval
        ? "답장/일정 후보가 dry-run, 사용자 최종 확인 문구, provider dispatch 어댑터 경계를 모두 통과할 준비가 됐습니다."
        : "실제 발송과 일정 등록은 dry-run 결과와 사용자의 마지막 확인 문구가 맞아야 provider 어댑터로 넘어갑니다.",
      state: finalActionReadyAfterApproval ? "ready" : approvalCandidateReady ? "approval" : "locked",
      evidenceLabel:
        `dryRun=${finalActionDryRunReady} / gate=${finalActionApprovalGateReady} / adapter=${finalActionAdapterReady}`,
    },
    {
      id: "final-send",
      label: "전송",
      title: "최종 확인 전 발송 잠금",
      detail: "실제 메일 발송과 캘린더 등록은 dry-run과 사용자 마지막 확인이 모두 끝난 뒤에만 실행합니다.",
      state: "locked",
      evidenceLabel: "dry_run_then_user_final_confirm_then_live_adapter",
    },
    {
      id: "attachment",
      label: "첨부",
      title: attachmentFolderApprovalCardReady
        ? "첨부 로컬 사본 정리 승인 카드 준비"
        : attachmentDownloadReviewReady ? "첨부 다운로드 검토 대기" : "첨부 변경 없음",
      detail: attachmentFolderApprovalCardReady
        ? "다운로드한 로컬 사본만 폴더 정리 승인 카드로 넘겼고 원본 메일/첨부, 삭제, 덮어쓰기, 외부 공유는 계속 잠갔습니다."
        : attachmentDownloadReviewReady
          ? "중요 첨부 후보를 감지했지만 다운로드 후보 확인과 로컬 사본 정리 승인 카드가 먼저 필요합니다."
          : "첨부 다운로드, 이동, 삭제, 덮어쓰기, 외부 공유는 폴더 정리 승인 카드 전까지 실행하지 않습니다.",
      state: attachmentFolderApprovalCardReady ? "ready" : attachmentDownloadReviewReady ? "approval" : "locked",
      evidenceLabel:
        `${attachmentCandidateCount} candidates / ${stagedMailAttachmentCount} staged / approvalCard=${attachmentFolderApprovalCardReady}`,
    },
  ];

  return {
    contract: "mail_live_e2e_rehearsal_approval_safe",
    status,
    createdAt,
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    aiCredentialPolicy: "credential_reference_id_only",
    browserSessionPolicy: "browser_session_reference_only_when_imap_unavailable",
    liveReadiness: {
      mailConnectionReady,
      calendarConnectionReady,
      securePollingPrepared,
      newMailEvidenceReady,
      approvalCandidateReady,
      calendarDryRunReady,
      attachmentFolderPlanReady,
      attachmentDownloadReviewReady,
      attachmentLocalCopyStaged,
      attachmentFolderApprovalCardReady,
      attachmentOriginalPreserved,
      webmailCredentialReferenceReady,
      webmailBodyPreviewGateReady,
      initialProfileLearningReady,
      approvalNotificationDraftReady,
      approvalNotificationChannelReady,
      approvalNotificationDispatchReady,
      messengerDecisionReplyReady,
      messengerDecisionTargetMatched,
      messengerDecisionFinalConfirmationLocked,
      finalActionDryRunReady,
      finalActionApprovalGateReady,
      finalActionAdapterReady,
      finalActionReadyAfterApproval,
      finalSendLockedUntilApproval: true,
      attachmentStagingLockedUntilApproval: true,
    },
    steps,
    nextOperatorActions: nextActionsForStatus(status, calendarConnectionReady, approvalCandidateReady),
    approvalGate: "실제 발송, 캘린더 등록, 첨부 다운로드/이동은 사용자 마지막 확인 전까지 실행하지 않습니다.",
    privacyBoundary:
      "라이브 리허설은 credentialReferenceId와 browserSessionReferenceId만 추적하며 비밀번호, 2차 인증값, 원문 주소, 토큰을 AI 입력이나 리포트에 남기지 않습니다.",
    auditMessages: [
      `status=${status}`,
      `mailConnectionReady=${mailConnectionReady}`,
      `securePollingPrepared=${securePollingPrepared}`,
      `newMailEvidenceReady=${newMailEvidenceReady}`,
      `calendarDryRunReady=${calendarDryRunReady}`,
      `finalActionReadyAfterApproval=${finalActionReadyAfterApproval}`,
      `approvalNotificationDispatchReady=${approvalNotificationDispatchReady}`,
      `messengerDecisionFinalConfirmationLocked=${messengerDecisionFinalConfirmationLocked}`,
      `attachmentFolderApprovalCardReady=${attachmentFolderApprovalCardReady}`,
      `webmailCredentialReferenceReady=${webmailCredentialReferenceReady}`,
      `webmailDomCaptureReady=${webmailDomCaptureReady}`,
      `webmailDomExtractionReady=${webmailDomExtractionReady}`,
      `webmailBodyPreviewGateReady=${webmailBodyPreviewGateReady}`,
      `initialProfileLearningReady=${initialProfileLearningReady}`,
      initialProfileLearningReady ? "initial_mail_profile_learning_secret_blind 프로필이 준비됐습니다." : "초기 학습 프로필은 실제 메일 증거가 쌓인 뒤 준비됩니다.",
    ],
  };
}

function nextActionsForStatus(
  status: ModyMailLiveE2ERehearsalStatus,
  calendarConnectionReady: boolean,
  approvalCandidateReady: boolean,
): string[] {
  if (status === "needs_mail_connection") {
    return ["회사/일반 메일 또는 웹메일 연결을 먼저 확인합니다.", "IMAP이 없으면 회사 웹메일 브라우저 세션 참조로 읽기 후보를 준비합니다."];
  }
  if (status === "needs_polling_enabled") {
    return ["메일 5분 자동 점검 규칙을 사용자가 직접 켭니다.", "켜진 규칙만 데스크톱 점검기에 동기화합니다."];
  }
  if (status === "needs_live_mail_evidence") {
    return ["테스트 업무 메일 1건과 광고/뉴스레터성 메일 1건을 보냅니다.", "반복 업무 점검을 실행해 새 메일과 중복 제외 수를 확인합니다."];
  }
  return [
    approvalCandidateReady ? "오피스 승인함에서 답장/일정 후보를 검토합니다." : "업무 메일을 하나 더 보내 승인 후보 생성을 확인합니다.",
    calendarConnectionReady ? "캘린더 후보가 있으면 마지막 확인 전까지 dry-run으로만 봅니다." : "미팅 자동화를 검증하려면 캘린더 연결을 추가합니다.",
    "최종 전송은 dry-run과 사용자 마지막 확인 뒤에만 실행합니다.",
  ];
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
