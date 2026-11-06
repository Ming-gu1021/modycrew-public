import type { ModyProviderId } from "./provider-read-adapter.js";
import type { ModyMailWorkPatternAnalysis } from "./mail-work-pattern-analysis.js";
import type { ModyMailWorkScenarioCoverage } from "./mail-work-scenario-taxonomy.js";
import type { ModyMailRecipientListReview } from "./mail-recipient-list-review.js";
import type { ModyProviderWorkCandidate, ModyProviderWorkIntakeReport } from "./provider-work-intake.js";
import type { ToolActionRequest } from "./types.js";

export type ModyMailOperationsWorkbenchGroupId =
  | "reply_required"
  | "needs_review"
  | "no_reply"
  | "calendar_candidate"
  | "follow_up"
  | "user_composed"
  | "mobile_handoff";

export type ModyMailOperationsChannelId =
  | "gmail_oauth"
  | "outlook_graph"
  | "imap_read"
  | "forwarded_inbox"
  | "mobile_share_or_pwa"
  | "manual_compose";

export type ModyMailOperationsSendAdapterId =
  | "gmail_api_send"
  | "microsoft_graph_send"
  | "smtp_oauth_send"
  | "app_final_confirmation_only";

export type ModyMailOperationsReadiness =
  | "ready"
  | "ready_without_provider"
  | "needs_setup"
  | "needs_final_approval";

export type ModyMailOperationsCapabilityStatus =
  | "ready"
  | "needs_connection"
  | "needs_review"
  | "needs_final_approval";

export type ModyMailOperationsExceptionCoverageId =
  | "attachment_check"
  | "bulk_send"
  | "recipient_decision"
  | "recipient_source"
  | "quote_proposal"
  | "invoice_payment"
  | "contract_legal"
  | "public_tax"
  | "complaint_escalation"
  | "reservation_order"
  | "compliance_unsubscribe"
  | "customer_inquiry"
  | "vendor_procurement"
  | "hr_recruiting"
  | "document_submission"
  | "security_account_alert"
  | "internal_collaboration"
  | "thread_context"
  | "delivery_failure"
  | "out_of_office"
  | "sent_history_audit"
  | "mail_info_digest";

export type ModyMailOperationsExceptionCoverageStatus = "observed" | "standby";

export type ModyMailOperationsBulkSendReviewStatus =
  | "ready_for_review"
  | "needs_recipient_list"
  | "standby";

export type ModyMailOperationsWorkbenchGroup = {
  id: ModyMailOperationsWorkbenchGroupId;
  label: string;
  count: number;
  oneLineLabel: string;
  detailsCollapsed: true;
  externalMutation: false;
  nextAction: string;
};

export type ModyMailOperationsChannelPlan = {
  id: ModyMailOperationsChannelId;
  label: string;
  readiness: ModyMailOperationsReadiness;
  setupLabel: string;
  canReadMail: boolean;
  canReceiveSelectedMail?: boolean;
  canCreateDraft: boolean;
  externalMutation: false;
  mobileSafe: boolean;
};

export type ModyMailOperationsSendAdapterPlan = {
  id: ModyMailOperationsSendAdapterId;
  label: string;
  readiness: ModyMailOperationsReadiness;
  finalApprovalRequired: true;
  canSendBeforeFinalApproval: false;
  externalMutationAfterApproval: boolean;
  setupLabel: string;
};

export type ModyMailOperationsCoverageMatrixRow = {
  id:
    | "inbox_triage"
    | "reply_draft"
    | "review_no_reply"
    | "calendar_follow_up"
    | "user_composed_check"
    | "mobile_review"
    | "bulk_review"
    | "live_send";
  label: string;
  status: ModyMailOperationsCapabilityStatus;
  statusLabel: string;
  oneLineLabel: string;
  detail: string;
  detailsCollapsed: true;
  externalMutation: false;
  primaryChannelId?: ModyMailOperationsChannelId;
  sendAdapterId?: ModyMailOperationsSendAdapterId;
};

export type ModyMailOperationsExceptionCoverageRow = {
  id: ModyMailOperationsExceptionCoverageId;
  label: string;
  count: number;
  status: ModyMailOperationsExceptionCoverageStatus;
  oneLineLabel: string;
  detail: string;
  userAction: string;
  safetyGate: string;
  highRisk: boolean;
  detailsCollapsed: true;
  externalMutation: false;
};

export type ModyMailOperationsBulkSendReviewChecklistRow = {
  id: "recipient_list" | "exclusions" | "sample" | "personalization" | "final_lock";
  label: string;
  count: number;
  state: "ready" | "review" | "locked" | "idle";
  detail: string;
  detailsCollapsed: true;
  externalMutation: false;
};

export type ModyMailOperationsBulkSendReviewPlan = {
  contract: "bulk_mail_review_to_recipient_sample_personalization_final_confirmation";
  rowMode: "one_line_counts_details_inside";
  status: ModyMailOperationsBulkSendReviewStatus;
  sourceLabel: string;
  oneLineLabel: string;
  candidateCount: number;
  sendCandidateCount: number;
  holdCandidateCount: number;
  excludeCandidateCount: number;
  readySampleCount: number;
  personalizationReviewCount: number;
  samplePreviewCount: number;
  checklist: ModyMailOperationsBulkSendReviewChecklistRow[];
  approvalGate: string;
  privacyBoundary: string;
  canSendBeforeFinalApproval: false;
  externalMutation: false;
};

export type ModyMailOperationsWorkbenchPlan = {
  contract: "mail_operations_full_cycle_read_triage_draft_edit_approve_send_log";
  workbenchMode: "one_line_rows_details_inside";
  groups: ModyMailOperationsWorkbenchGroup[];
  channels: ModyMailOperationsChannelPlan[];
  sendAdapters: ModyMailOperationsSendAdapterPlan[];
  mobileHandoff: {
    enabledFilterLabels: string[];
    digestLabel: string;
    boundary: "summary_only_app_final_confirmation_before_send";
    externalMutation: false;
    receiveBridge: {
      contract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation";
      acceptedInputs: Array<"mobile_share_sheet" | "pwa_paste" | "manual_phone_forward">;
      canCreateWorkItemsBeforeProviderSetup: true;
      finalAppConfirmationRequired: true;
      externalMutation: false;
      oneLineLabel: string;
    };
  };
  approvalPolicy: {
    batchReviewRequired: true;
    finalUserPresenceRequired: true;
    externalSendBeforeApproval: false;
    editableBeforeApproval: true;
    noReplyCanBeChangedToReply: true;
  };
  coverageMatrix: ModyMailOperationsCoverageMatrixRow[];
  bulkSendReview: ModyMailOperationsBulkSendReviewPlan;
  exceptionCoverage: {
    contract: "mail_operations_exception_coverage_signal_to_review_gate";
    rowMode: "one_line_signal_details_inside";
    rows: ModyMailOperationsExceptionCoverageRow[];
    observedCount: number;
    highRiskObservedCount: number;
    summary: string;
    externalMutation: false;
  };
  supportedWorkLabels: string[];
  coverageSummary: string;
};

export type ModyMailOperationsWorkbenchInput = {
  analysis?: ModyMailWorkPatternAnalysis;
  scenarioCoverage?: ModyMailWorkScenarioCoverage[];
  connectedProviderIds?: ModyProviderId[];
  userComposedDrafts?: number;
  mobileApprovalCandidateCount?: number;
  mobileSharedMailCount?: number;
  mobileReceiveFilterLabels?: string[];
  recipientListReview?: ModyMailRecipientListReview;
};

export type ModyMailOperationsWorkQueueDecision = "approve" | "revise" | "hold" | "exclude";

export type ModyMailOperationsFinalConfirmationRoute = "included" | "held" | "excluded";

export type ModyMailOperationsWorkQueueSourceKind =
  | "provider_read"
  | "user_composed"
  | "mobile_handoff"
  | "role_command";

export type ModyMailOperationsEditApprovalBridge = {
  contract: "draft_edit_to_approval_candidate_to_final_confirmation";
  sourceKind: ModyMailOperationsWorkQueueSourceKind;
  editSurface: "workbench_inline_editor" | "user_composed_check_desk" | "mobile_review_queue" | "role_command_workbench_queue";
  saveActionLabel: string;
  approvalCandidateAfterEdit: true;
  finalConfirmationRouteAfterApproval: "included";
  externalMutationBeforeFinalApproval: false;
  oneLineLabel: string;
};

export type ModyMailOperationsWorkQueueActionPack = {
  contract: "ai_connection_role_work_action_pack_v1";
  visibleMode: "one_line_next_action_details_inside";
  aiConnectionGate: "requires_live_ai_receipt_before_role_execution";
  roleAssignmentGate: "mail_assistant_role_context_required";
  workExecutionGate: "work_queue_candidate_before_final_confirmation";
  primaryAction:
    | "open_draft"
    | "edit_draft"
    | "prepare_final_confirmation"
    | "keep_on_hold"
    | "keep_excluded";
  primaryLabel: string;
  oneLineSummary: string;
  decisionLabel: string;
  sourceLabel: string;
  finalGateLabel: string;
  mobileLabel: string;
  canPrepareFinalConfirmation: boolean;
  canSendBeforeFinalApproval: false;
  externalMutation: false;
  detailChips: string[];
};

export type ModyMailOperationsComposedDraftInput = {
  id?: string;
  to?: string;
  subject?: string;
  bodyPreview?: string;
  attachmentLabel?: string;
};

export type ModyMailOperationsMobileHandoffIntent =
  | "reply_required"
  | "needs_review"
  | "calendar_candidate"
  | "follow_up"
  | "no_reply"
  | "mobile_handoff";

export type ModyMailOperationsMobileHandoffInput = {
  id?: string;
  from?: string;
  subject?: string;
  bodyPreview?: string;
  source?: "mobile_share_sheet" | "pwa_paste" | "manual_phone_forward";
  intent?: ModyMailOperationsMobileHandoffIntent;
  draftReply?: string;
  approvalActionId?: string;
  approvalWorkItemId?: string;
};

export type ModyMailOperationsRoleCommandHandoffInput = {
  id?: string;
  requestedWorkSummary: string;
  roleTitle?: string;
  teammateName?: string;
  aiAnswerSummary?: string;
  candidateLabel?: string;
  approvalActionId?: string;
  approvalWorkItemId?: string;
};

export type ModyMailOperationsWorkQueueRow = {
  id: string;
  sourceKind: ModyMailOperationsWorkQueueSourceKind;
  sourceId: string;
  sourceProviderId?: ModyProviderId;
  category: ModyMailOperationsWorkbenchGroupId;
  title: string;
  oneLineLabel: string;
  detail: string;
  detailsCollapsed: true;
  decision: ModyMailOperationsWorkQueueDecision;
  finalConfirmationRoute: ModyMailOperationsFinalConfirmationRoute;
  approvalPreviewId?: string;
  approvalWorkItemId?: string;
  approvalActionIds: string[];
  draftEditable: true;
  editApprovalBridge: ModyMailOperationsEditApprovalBridge;
  canSendBeforeFinalApproval: false;
  externalMutation: false;
  mobileSummaryEligible: boolean;
  actionPack: ModyMailOperationsWorkQueueActionPack;
  sourceTraceContract: "mail_intake_session_to_preview_to_work_queue_to_final_confirmation";
  sourceTraceLabel: string;
  proofLabels: string[];
};

export type ModyMailOperationsFinalConfirmationQueueRow = {
  id: string;
  sourceRowId: string;
  title: string;
  oneLineLabel: string;
  approvalWorkItemId?: string;
  route: ModyMailOperationsFinalConfirmationRoute;
  readyForLiveSend: boolean;
  finalUserPresenceRequired: true;
  externalMutationBeforeFinalApproval: false;
};

export type ModyMailOperationsWorkQueueInput = {
  workReport?: ModyProviderWorkIntakeReport;
  userComposedDrafts?: ModyMailOperationsComposedDraftInput[];
  mobileHandoffs?: ModyMailOperationsMobileHandoffInput[];
  roleCommandHandoffs?: ModyMailOperationsRoleCommandHandoffInput[];
};

export type ModyMailOperationsWorkQueue = {
  contract: "mailops_work_queue_decision_to_final_execution_gate";
  rowMode: "one_line_rows_details_inside";
  rows: ModyMailOperationsWorkQueueRow[];
  finalConfirmationRows: ModyMailOperationsFinalConfirmationQueueRow[];
  counts: Record<ModyMailOperationsWorkbenchGroupId, number>;
  approvedCount: number;
  reviewCount: number;
  excludedCount: number;
  finalReadyCount: number;
  proofChain: "read_or_compose_to_triage_to_edit_to_approval_to_final_confirmation";
  externalMutation: false;
  canSendBeforeFinalApproval: false;
  summary: string;
};

const defaultMobileFilterLabels = ["승인 대기", "긴급/위험", "일정 후보", "후속 확인", "요약 전달"];

export function createModyMailOperationsWorkbenchPlan(
  input: ModyMailOperationsWorkbenchInput = {},
): ModyMailOperationsWorkbenchPlan {
  const stats = input.analysis?.stats;
  const connectedProviderIds = new Set(input.connectedProviderIds ?? []);
  const replyRequiredCount = stats?.replyCandidates ?? 0;
  const needsReviewCount = stats?.reviewItems ?? 0;
  const noReplyCount = stats?.ignoredItems ?? 0;
  const calendarCandidateCount = stats?.calendarCandidates ?? 0;
  const followUpCount = stats?.followUpSignals ?? 0;
  const userComposedCount = Math.max(0, input.userComposedDrafts ?? 0);
  const mobileApprovalCandidateCount = Math.max(0, input.mobileApprovalCandidateCount ?? 0);
  const mobileSharedMailCount = Math.max(0, input.mobileSharedMailCount ?? 0);
  const mobileHandoffCount = Math.max(
    stats?.mobileReviewHandoffSignals ?? 0,
    mobileApprovalCandidateCount,
    mobileSharedMailCount,
    userComposedCount > 0 ? 1 : 0,
  );
  const exceptionCoverageRows = createExceptionCoverageRows(stats);
  const bulkSendReview = createBulkSendReviewPlan(input.recipientListReview, stats);

  const groups: ModyMailOperationsWorkbenchGroup[] = [
    createGroup(
      "reply_required",
      "답장 보낼 메일",
      replyRequiredCount,
      "초안/수정/승인으로 이동",
    ),
    createGroup(
      "needs_review",
      "수정/확인할 메일",
      needsReviewCount,
      "정보 부족, 위험 표현, 첨부 누락 확인",
    ),
    createGroup(
      "no_reply",
      "답장 안 보낼 메일",
      noReplyCount,
      "공지/광고/자동응답은 업무 잡음으로 접기",
    ),
    createGroup(
      "calendar_candidate",
      "일정 후보 메일",
      calendarCandidateCount,
      "가능 시간, 참석자, 캘린더 등록 후보를 분리",
    ),
    createGroup(
      "follow_up",
      "후속 확인 메일",
      followUpCount,
      "회신 대기, 마감, 리마인드 후보를 보류 큐로 관리",
    ),
    createGroup(
      "user_composed",
      "내가 쓴 메일 점검",
      userComposedCount,
      "수신자, 참조, 본문, 첨부를 발송 전 점검",
    ),
    createGroup(
      "mobile_handoff",
      "휴대폰에서 볼 메일",
      mobileHandoffCount,
      "한 줄 요약과 결정 후보만 보내고 앱에서 마지막 확인",
    ),
  ];

  const channels: ModyMailOperationsChannelPlan[] = [
    {
      id: "gmail_oauth",
      label: "Gmail 공식 연결",
      readiness: connectedProviderIds.has("gmail") ? "ready" : "needs_setup",
      setupLabel: "Google OAuth 동의 후 읽기 전용부터 시작",
      canReadMail: connectedProviderIds.has("gmail"),
      canCreateDraft: true,
      externalMutation: false,
      mobileSafe: true,
    },
    {
      id: "outlook_graph",
      label: "Outlook/Microsoft 365",
      readiness: connectedProviderIds.has("outlook") ? "ready" : "needs_setup",
      setupLabel: "Microsoft Graph 동의 후 받은편지함 읽기",
      canReadMail: connectedProviderIds.has("outlook"),
      canCreateDraft: true,
      externalMutation: false,
      mobileSafe: true,
    },
    {
      id: "imap_read",
      label: "회사/NAVER/Daum IMAP",
      readiness: connectedProviderIds.has("imap_smtp") ? "ready" : "needs_setup",
      setupLabel: "IMAP 서버와 앱 비밀번호로 읽기 전용 점검",
      canReadMail: connectedProviderIds.has("imap_smtp"),
      canCreateDraft: true,
      externalMutation: false,
      mobileSafe: true,
    },
    {
      id: "forwarded_inbox",
      label: "전달용 수신함",
      readiness: "needs_setup",
      setupLabel: "원래 메일 앱에서 업무 메일만 전달하도록 설정",
      canReadMail: false,
      canCreateDraft: true,
      externalMutation: false,
      mobileSafe: true,
    },
    {
      id: "mobile_share_or_pwa",
      label: "휴대폰 알림/PWA",
      readiness: "ready_without_provider",
      setupLabel: "휴대폰에서 선택한 메일을 공유/PWA로 넘기고 승인 대기와 긴급 후보를 한 줄 요약으로 보기",
      canReadMail: false,
      canReceiveSelectedMail: true,
      canCreateDraft: false,
      externalMutation: false,
      mobileSafe: true,
    },
    {
      id: "manual_compose",
      label: "직접 작성 메일",
      readiness: "ready_without_provider",
      setupLabel: "붙여넣거나 작성한 메일을 점검 후 승인 후보로 넘김",
      canReadMail: false,
      canCreateDraft: true,
      externalMutation: false,
      mobileSafe: true,
    },
  ];

  const sendAdapters: ModyMailOperationsSendAdapterPlan[] = [
    createSendAdapter(
      "gmail_api_send",
      "Gmail API 발송",
      connectedProviderIds.has("gmail") ? "needs_final_approval" : "needs_setup",
      "Gmail 쓰기 권한은 발송 직전 최종 확인에서 분리",
    ),
    createSendAdapter(
      "microsoft_graph_send",
      "Microsoft Graph 발송",
      connectedProviderIds.has("outlook") ? "needs_final_approval" : "needs_setup",
      "Outlook 발송 권한은 최종 확인 뒤 실행",
    ),
    createSendAdapter(
      "smtp_oauth_send",
      "SMTP/OAuth 발송",
      connectedProviderIds.has("imap_smtp") ? "needs_final_approval" : "needs_setup",
      "SMTP 서버, 앱 비밀번호, 발송 주소를 최종 확인에서 재점검",
    ),
    createSendAdapter(
      "app_final_confirmation_only",
      "앱 마지막 확인",
      "ready",
      "메일 전송 전 항상 앱 승인함을 거침",
      false,
    ),
  ];

  const supportedWorkLabels = unique([
    ...(input.scenarioCoverage ?? input.analysis?.scenarioCoverage ?? [])
      .filter((item) => item.status !== "needs_setup")
      .map((item) => item.label),
    "답장 보낼 메일 선별",
    "답장 안 보낼 메일 제외",
    "일정 후보 메일 분리",
    "후속 확인 메일 추적",
    "여러 메일 묶음 수정/승인",
    "대량/단체 발송 샘플 검토",
    "수신자/참조/숨은참조 판단",
    "첨부/반송/부재중/수신거부 예외 처리",
    "견적/정산/계약/공공기관 메일 검토 게이트",
    "내가 쓴 메일 발송 전 점검",
    "휴대폰 한 줄 요약과 앱 최종 확인",
  ]);

  return {
    contract: "mail_operations_full_cycle_read_triage_draft_edit_approve_send_log",
    workbenchMode: "one_line_rows_details_inside",
    groups,
    channels,
    sendAdapters,
    mobileHandoff: {
      enabledFilterLabels: input.mobileReceiveFilterLabels?.length
        ? input.mobileReceiveFilterLabels.slice(0, 5)
        : defaultMobileFilterLabels,
      digestLabel:
        mobileHandoffCount > 0
          ? `휴대폰 확인 후보 ${mobileHandoffCount}건`
          : "휴대폰에는 승인/긴급/요약 후보만 보냅니다",
      boundary: "summary_only_app_final_confirmation_before_send",
      externalMutation: false,
      receiveBridge: {
        contract: "selected_phone_mail_to_workbench_draft_approval_final_confirmation",
        acceptedInputs: ["mobile_share_sheet", "pwa_paste", "manual_phone_forward"],
        canCreateWorkItemsBeforeProviderSetup: true,
        finalAppConfirmationRequired: true,
        externalMutation: false,
        oneLineLabel:
          mobileSharedMailCount > 0
            ? `폰에서 가져온 메일 ${mobileSharedMailCount}건을 업무대장으로 분류`
            : "폰에서 선택한 메일은 공유/PWA로 업무대장에 올릴 수 있음",
      },
    },
    approvalPolicy: {
      batchReviewRequired: true,
      finalUserPresenceRequired: true,
      externalSendBeforeApproval: false,
      editableBeforeApproval: true,
      noReplyCanBeChangedToReply: true,
    },
    coverageMatrix: createCoverageMatrix(groups, channels, sendAdapters),
    bulkSendReview,
    exceptionCoverage: createExceptionCoverage(exceptionCoverageRows),
    supportedWorkLabels,
    coverageSummary: createCoverageSummary(groups, sendAdapters, exceptionCoverageRows),
  };
}

export function createModyMailOperationsWorkQueue(
  input: ModyMailOperationsWorkQueueInput = {},
): ModyMailOperationsWorkQueue {
  const providerRows = (input.workReport?.candidates ?? []).map((candidate, index) =>
    createProviderWorkQueueRow(candidate, input.workReport?.id ?? "mail-intake-session", index),
  );
  const composedRows = (input.userComposedDrafts ?? []).slice(0, 24).map(createComposedWorkQueueRow);
  const mobileRows = (input.mobileHandoffs ?? []).slice(0, 24).map(createMobileHandoffWorkQueueRow);
  const roleCommandRows = (input.roleCommandHandoffs ?? []).slice(0, 24).map(createRoleCommandHandoffWorkQueueRow);
  const rows = [...providerRows, ...composedRows, ...mobileRows, ...roleCommandRows];
  const finalConfirmationRows = rows.map(createFinalConfirmationQueueRow);
  const counts = createWorkQueueCounts(rows);
  const approvedCount = rows.filter((row) => row.decision === "approve").length;
  const reviewCount = rows.filter((row) => row.decision === "revise" || row.decision === "hold").length;
  const excludedCount = rows.filter((row) => row.decision === "exclude").length;
  const finalReadyCount = finalConfirmationRows.filter((row) => row.readyForLiveSend).length;

  return {
    contract: "mailops_work_queue_decision_to_final_execution_gate",
    rowMode: "one_line_rows_details_inside",
    rows,
    finalConfirmationRows,
    counts,
    approvedCount,
    reviewCount,
    excludedCount,
    finalReadyCount,
    proofChain: "read_or_compose_to_triage_to_edit_to_approval_to_final_confirmation",
    externalMutation: false,
    canSendBeforeFinalApproval: false,
    summary: [
      `메일 작업대 ${rows.length}건`,
      `답장 ${counts.reply_required}건`,
      `검토 ${counts.needs_review}건`,
      `제외 ${counts.no_reply}건`,
      `일정 ${counts.calendar_candidate}건`,
      `후속 ${counts.follow_up}건`,
      `작성 ${counts.user_composed}건`,
      `휴대폰 ${counts.mobile_handoff}건`,
      `최종 확인 가능 ${finalReadyCount}건`,
      "외부 발송은 앱 마지막 확인 전까지 없음",
    ].join(" · "),
  };
}

function createProviderWorkQueueRow(
  candidate: ModyProviderWorkCandidate,
  intakeSessionId: string,
  index: number,
): ModyMailOperationsWorkQueueRow {
  const approvalActionIds = candidate.approvalQueue.map((item) => item.id).filter(Boolean);
  const category = categoryForProviderCandidate(candidate);
  const decision = decisionForCategory(category, candidate.approvalQueue);
  const approvalPreviewId = `mailops-preview-${safeQueueId(candidate.id || candidate.sourceId || String(index + 1))}`;
  const approvalWorkItemId = approvalActionIds[0] ?? approvalPreviewId;
  const title = compactQueueText(candidate.title || "메일 업무 후보", 120);
  const detail = compactQueueText(candidate.draftReply || candidate.calendarDraft || candidate.summary || candidate.reportText, 220);
  const sourceTraceLabel = `${intakeSessionId} -> ${approvalPreviewId} -> ${approvalWorkItemId}`;
  const finalConfirmationRoute = finalRouteForDecision(decision, approvalActionIds.length > 0);
  return {
    id: `mailops-work-row-${safeQueueId(candidate.id || candidate.sourceId || String(index + 1))}`,
    sourceKind: "provider_read",
    sourceId: candidate.sourceId,
    sourceProviderId: candidate.sourceProviderId,
    category,
    title,
    oneLineLabel: `${labelForWorkQueueCategory(category)} · ${title} · ${labelForDecision(decision)}`,
    detail,
    detailsCollapsed: true,
    decision,
    finalConfirmationRoute,
    approvalPreviewId,
    approvalWorkItemId,
    approvalActionIds,
    draftEditable: true,
    editApprovalBridge: createEditApprovalBridge("provider_read", labelForWorkQueueCategory(category), "workbench_inline_editor"),
    canSendBeforeFinalApproval: false,
    externalMutation: false,
    mobileSummaryEligible: decision !== "exclude",
    actionPack: createWorkQueueActionPack({
      title,
      category,
      sourceKind: "provider_read",
      decision,
      finalConfirmationRoute,
      approvalActionIds,
      mobileSummaryEligible: decision !== "exclude",
    }),
    sourceTraceContract: "mail_intake_session_to_preview_to_work_queue_to_final_confirmation",
    sourceTraceLabel,
    proofLabels: [
      candidate.classification === "calendar_context" ? "calendar_context" : candidate.classification,
      candidate.shouldCreateWorkItem ? "work_item_candidate" : "no_work_item",
      approvalActionIds.length ? "approval_action_waiting" : "no_external_action",
      "externalMutation:false",
    ],
  };
}

function createComposedWorkQueueRow(
  draft: ModyMailOperationsComposedDraftInput,
  index: number,
): ModyMailOperationsWorkQueueRow {
  const sourceId = safeQueueId(draft.id || `user-composed-${index + 1}`);
  const title = compactQueueText(draft.subject || "작성 중인 메일", 120);
  const to = compactQueueText(draft.to || "수신자 확인 필요", 80);
  const decision: ModyMailOperationsWorkQueueDecision = "revise";
  const finalConfirmationRoute: ModyMailOperationsFinalConfirmationRoute = "held";
  return {
    id: `mailops-work-row-composed-${sourceId}`,
    sourceKind: "user_composed",
    sourceId,
    category: "user_composed",
    title,
    oneLineLabel: `내가 쓴 메일 점검 · ${title} · 수정 후 승인`,
    detail: compactQueueText(draft.bodyPreview || "본문, 수신자, 첨부, 위험 표현을 발송 전 점검합니다.", 220),
    detailsCollapsed: true,
    decision,
    finalConfirmationRoute,
    approvalActionIds: [],
    draftEditable: true,
    editApprovalBridge: createEditApprovalBridge("user_composed", "내가 쓴 메일", "user_composed_check_desk"),
    canSendBeforeFinalApproval: false,
    externalMutation: false,
    mobileSummaryEligible: true,
    actionPack: createWorkQueueActionPack({
      title,
      category: "user_composed",
      sourceKind: "user_composed",
      decision,
      finalConfirmationRoute,
      approvalActionIds: [],
      mobileSummaryEligible: true,
    }),
    sourceTraceContract: "mail_intake_session_to_preview_to_work_queue_to_final_confirmation",
    sourceTraceLabel: `manual-compose -> composed-review-${sourceId} -> final-confirmation-held`,
    proofLabels: [
      `수신자: ${to}`,
      draft.attachmentLabel ? `첨부: ${compactQueueText(draft.attachmentLabel, 60)}` : "첨부 확인 대기",
      "user_composed_check",
      "externalMutation:false",
    ],
  };
}

function createMobileHandoffWorkQueueRow(
  handoff: ModyMailOperationsMobileHandoffInput,
  index: number,
): ModyMailOperationsWorkQueueRow {
  const sourceId = safeQueueId(handoff.id || `mobile-handoff-${index + 1}`);
  const title = compactQueueText(handoff.subject || "휴대폰에서 선택한 메일", 120);
  const intent = inferMobileHandoffIntent(handoff);
  const category = categoryForMobileHandoffIntent(intent);
  const approvalActionIds = handoff.approvalActionId ? [handoff.approvalActionId] : [];
  const decision = decisionForMobileHandoffCategory(category, approvalActionIds.length > 0);
  const categoryLabel = labelForWorkQueueCategory(category);
  const finalConfirmationRoute = finalRouteForDecision(decision, approvalActionIds.length > 0);
  const detail = compactQueueText(
    handoff.draftReply ||
      handoff.bodyPreview ||
      "휴대폰에서 선택한 메일을 답장/검토 후보로 올립니다.",
    220,
  );
  return {
    id: `mailops-work-row-mobile-${sourceId}`,
    sourceKind: "mobile_handoff",
    sourceId,
    category,
    title,
    oneLineLabel: `휴대폰 메일 · ${categoryLabel} · ${title} · ${labelForDecision(decision)}`,
    detail,
    detailsCollapsed: true,
    decision,
    finalConfirmationRoute,
    ...(handoff.approvalActionId ? { approvalPreviewId: `mailops-preview-mobile-${sourceId}` } : {}),
    ...(handoff.approvalWorkItemId || handoff.approvalActionId
      ? { approvalWorkItemId: handoff.approvalWorkItemId ?? handoff.approvalActionId }
      : {}),
    approvalActionIds,
    draftEditable: true,
    editApprovalBridge: createEditApprovalBridge("mobile_handoff", categoryLabel, "mobile_review_queue"),
    canSendBeforeFinalApproval: false,
    externalMutation: false,
    mobileSummaryEligible: category !== "no_reply",
    actionPack: createWorkQueueActionPack({
      title,
      category,
      sourceKind: "mobile_handoff",
      decision,
      finalConfirmationRoute,
      approvalActionIds,
      mobileSummaryEligible: category !== "no_reply",
    }),
    sourceTraceContract: "mail_intake_session_to_preview_to_work_queue_to_final_confirmation",
    sourceTraceLabel: `${handoff.source ?? "mobile_share_sheet"} -> mobile-workbench-${sourceId} -> ${
      handoff.approvalWorkItemId ?? handoff.approvalActionId ?? "app-final-confirmation"
    }`,
    proofLabels: [
      `발신자: ${compactQueueText(handoff.from || "휴대폰 선택 메일", 80)}`,
      handoff.source ?? "mobile_share_sheet",
      `mobile_intent:${intent}`,
      "selected_phone_mail_to_workbench_draft_approval_final_confirmation",
      approvalActionIds.length ? "approval_action_waiting" : "mobile_review_before_send",
      "externalMutation:false",
    ],
  };
}

function createRoleCommandHandoffWorkQueueRow(
  handoff: ModyMailOperationsRoleCommandHandoffInput,
  index: number,
): ModyMailOperationsWorkQueueRow {
  const sourceId = safeQueueId(handoff.id || `role-command-mail-${index + 1}`);
  const title = compactQueueText(handoff.requestedWorkSummary || "역할에게 맡긴 메일 업무", 120);
  const approvalActionIds = handoff.approvalActionId ? [handoff.approvalActionId] : [];
  const category = categoryForRoleCommandHandoff(handoff);
  const decision: ModyMailOperationsWorkQueueDecision =
    approvalActionIds.length > 0 && (category === "reply_required" || category === "calendar_candidate")
      ? "approve"
      : "revise";
  const categoryLabel = labelForWorkQueueCategory(category);
  const finalConfirmationRoute = finalRouteForDecision(decision, approvalActionIds.length > 0);
  const detail = compactQueueText(
    handoff.aiAnswerSummary ||
      handoff.candidateLabel ||
      "실제 AI 답변으로 만든 메일 업무 후보입니다. 원문, 수신자, 본문, 첨부는 작업대에서 확인합니다.",
    220,
  );
  return {
    id: `mailops-work-row-role-${sourceId}`,
    sourceKind: "role_command",
    sourceId,
    category,
    title,
    oneLineLabel: `AI 역할 명령 · ${categoryLabel} · ${title} · ${labelForDecision(decision)}`,
    detail,
    detailsCollapsed: true,
    decision,
    finalConfirmationRoute,
    ...(handoff.approvalActionId ? { approvalPreviewId: `mailops-preview-role-${sourceId}` } : {}),
    ...(handoff.approvalWorkItemId || handoff.approvalActionId
      ? { approvalWorkItemId: handoff.approvalWorkItemId ?? handoff.approvalActionId }
      : {}),
    approvalActionIds,
    draftEditable: true,
    editApprovalBridge: createEditApprovalBridge("role_command", "AI 역할 명령", "role_command_workbench_queue"),
    canSendBeforeFinalApproval: false,
    externalMutation: false,
    mobileSummaryEligible: true,
    actionPack: createWorkQueueActionPack({
      title,
      category,
      sourceKind: "role_command",
      decision,
      finalConfirmationRoute,
      approvalActionIds,
      mobileSummaryEligible: true,
    }),
    sourceTraceContract: "mail_intake_session_to_preview_to_work_queue_to_final_confirmation",
    sourceTraceLabel: `role-command -> ai-answer-receipt-${sourceId} -> ${
      handoff.approvalWorkItemId ?? handoff.approvalActionId ?? "mailops-workbench-review"
    }`,
    proofLabels: [
      "role_quick_command",
      "ai_answer_receipt_to_mailops_workqueue",
      `역할: ${compactQueueText(handoff.roleTitle || handoff.teammateName || "메일 비서", 80)}`,
      handoff.candidateLabel ? `후보: ${compactQueueText(handoff.candidateLabel, 80)}` : "메일 업무 후보",
      approvalActionIds.length ? "approval_action_waiting" : "role_command_review_before_send",
      "externalMutation:false",
    ],
  };
}

function createWorkQueueActionPack(input: {
  title: string;
  category: ModyMailOperationsWorkbenchGroupId;
  sourceKind: ModyMailOperationsWorkQueueSourceKind;
  decision: ModyMailOperationsWorkQueueDecision;
  finalConfirmationRoute: ModyMailOperationsFinalConfirmationRoute;
  approvalActionIds: string[];
  mobileSummaryEligible: boolean;
}): ModyMailOperationsWorkQueueActionPack {
  const canPrepareFinalConfirmation = input.decision === "approve" && input.finalConfirmationRoute === "included" && input.approvalActionIds.length > 0;
  const primaryAction: ModyMailOperationsWorkQueueActionPack["primaryAction"] =
    canPrepareFinalConfirmation
      ? "prepare_final_confirmation"
      : input.decision === "exclude"
        ? "keep_excluded"
        : input.decision === "hold"
          ? "keep_on_hold"
          : input.sourceKind === "user_composed" || input.decision === "revise"
            ? "edit_draft"
            : "open_draft";
  const sourceLabel =
    input.sourceKind === "user_composed"
      ? "내가 쓴 메일"
      : input.sourceKind === "mobile_handoff"
        ? "휴대폰에서 가져온 메일"
        : input.sourceKind === "role_command"
          ? "AI 역할 명령"
          : "연결된 메일함에서 읽은 메일";
  const primaryLabel =
    primaryAction === "prepare_final_confirmation"
      ? "마지막 확인 준비"
      : primaryAction === "edit_draft"
        ? "초안 수정"
        : primaryAction === "keep_on_hold"
          ? "보류 유지"
          : primaryAction === "keep_excluded"
            ? "안 보냄 유지"
            : "초안 보기";
  const finalGateLabel = canPrepareFinalConfirmation
    ? "최종 확인 가능"
    : input.finalConfirmationRoute === "excluded"
      ? "전송 제외"
      : "최종 확인 전 잠금";
  const mobileLabel = input.mobileSummaryEligible ? "휴대폰 요약 가능" : "휴대폰 요약 제외";
  const categoryLabel = labelForWorkQueueCategory(input.category);

  return {
    contract: "ai_connection_role_work_action_pack_v1",
    visibleMode: "one_line_next_action_details_inside",
    aiConnectionGate: "requires_live_ai_receipt_before_role_execution",
    roleAssignmentGate: "mail_assistant_role_context_required",
    workExecutionGate: "work_queue_candidate_before_final_confirmation",
    primaryAction,
    primaryLabel,
    oneLineSummary: compactQueueText(`${primaryLabel} · ${sourceLabel} · ${categoryLabel} · ${finalGateLabel}`, 140),
    decisionLabel: labelForDecision(input.decision),
    sourceLabel,
    finalGateLabel,
    mobileLabel,
    canPrepareFinalConfirmation,
    canSendBeforeFinalApproval: false,
    externalMutation: false,
    detailChips: [
      `AI 연결 확인 후 역할 실행`,
      `역할: 메일 비서`,
      `업무: ${categoryLabel}`,
      finalGateLabel,
      mobileLabel,
    ],
  };
}

function createFinalConfirmationQueueRow(
  row: ModyMailOperationsWorkQueueRow,
): ModyMailOperationsFinalConfirmationQueueRow {
  const readyForLiveSend = row.decision === "approve" && row.approvalActionIds.length > 0;
  const finalRow: ModyMailOperationsFinalConfirmationQueueRow = {
    id: `mailops-final-${row.id}`,
    sourceRowId: row.id,
    title: row.title,
    oneLineLabel: readyForLiveSend
      ? `${row.title} · 마지막 확인 가능`
      : `${row.title} · ${routeLabel(row.finalConfirmationRoute)}`,
    route: row.finalConfirmationRoute,
    readyForLiveSend,
    finalUserPresenceRequired: true,
    externalMutationBeforeFinalApproval: false,
  };
  if (row.approvalWorkItemId) {
    finalRow.approvalWorkItemId = row.approvalWorkItemId;
  }
  return finalRow;
}

function createEditApprovalBridge(
  sourceKind: ModyMailOperationsWorkQueueSourceKind,
  label: string,
  editSurface: ModyMailOperationsEditApprovalBridge["editSurface"],
): ModyMailOperationsEditApprovalBridge {
  return {
    contract: "draft_edit_to_approval_candidate_to_final_confirmation",
    sourceKind,
    editSurface,
    saveActionLabel: "수정본 저장 후 승인 후보로 넘기기",
    approvalCandidateAfterEdit: true,
    finalConfirmationRouteAfterApproval: "included",
    externalMutationBeforeFinalApproval: false,
    oneLineLabel: `${label} · 수정 저장 -> 승인 후보 -> 마지막 확인 대기`,
  };
}

function categoryForProviderCandidate(candidate: ModyProviderWorkCandidate): ModyMailOperationsWorkbenchGroupId {
  if (candidate.classification === "ignored_noise" || !candidate.shouldCreateWorkItem) return "no_reply";
  if (isCalendarProviderCandidate(candidate)) return "calendar_candidate";
  if (isFollowUpProviderCandidate(candidate)) return "follow_up";
  if (candidate.classification === "needs_review") return "needs_review";
  if (candidate.approvalQueue.length > 0 || candidate.draftReply) return "reply_required";
  return "needs_review";
}

function decisionForCategory(
  category: ModyMailOperationsWorkbenchGroupId,
  approvalQueue: ToolActionRequest[],
): ModyMailOperationsWorkQueueDecision {
  if (category === "no_reply") return "exclude";
  if (category === "needs_review" || category === "mobile_handoff") return "hold";
  if (category === "user_composed") return "revise";
  if (category === "calendar_candidate" || category === "follow_up") {
    return approvalQueue.length > 0 ? "approve" : "hold";
  }
  return approvalQueue.length > 0 ? "approve" : "hold";
}

function inferMobileHandoffIntent(
  handoff: ModyMailOperationsMobileHandoffInput,
): ModyMailOperationsMobileHandoffIntent {
  if (handoff.intent) return handoff.intent;
  const text = [handoff.from, handoff.subject, handoff.bodyPreview, handoff.draftReply]
    .filter(Boolean)
    .join(" ");
  if (/계약|법무|세무|환불|클레임|보안|비밀번호|결제|민감|위험|urgent|risk|complaint|security/u.test(text)) {
    return "needs_review";
  }
  if (/일정|회의|미팅|예약|방문|마감|가능\s*시간|calendar|schedule|meeting|appointment|deadline/u.test(text)) {
    return "calendar_candidate";
  }
  if (/후속|리마인드|재확인|회신\s*대기|follow[- ]?up|followup|remind|pending reply/u.test(text)) {
    return "follow_up";
  }
  if (/뉴스레터|광고|프로모션|공지|자동\s*알림|수신거부|newsletter|promotion|notice|no[- ]?reply/u.test(text)) {
    return "no_reply";
  }
  if (/문의|요청|답장|회신|견적|제안|확인\s*부탁|reply|required|request|quote|inquiry/u.test(text)) {
    return "reply_required";
  }
  return "mobile_handoff";
}

function categoryForMobileHandoffIntent(
  intent: ModyMailOperationsMobileHandoffIntent,
): ModyMailOperationsWorkbenchGroupId {
  if (intent === "reply_required") return "reply_required";
  if (intent === "needs_review") return "needs_review";
  if (intent === "calendar_candidate") return "calendar_candidate";
  if (intent === "follow_up") return "follow_up";
  if (intent === "no_reply") return "no_reply";
  return "mobile_handoff";
}

function categoryForRoleCommandHandoff(
  handoff: ModyMailOperationsRoleCommandHandoffInput,
): ModyMailOperationsWorkbenchGroupId {
  const primarySurface = [
    handoff.requestedWorkSummary,
    handoff.candidateLabel,
  ]
    .filter(Boolean)
    .join(" ");
  const text = [
    handoff.requestedWorkSummary,
    handoff.candidateLabel,
    handoff.aiAnswerSummary,
    handoff.roleTitle,
    handoff.teammateName,
  ]
    .filter(Boolean)
    .join(" ");
  if (/뉴스레터|광고|프로모션|공지|자동\s*알림|수신거부|newsletter|promotion|notice|no[- ]?reply/iu.test(text)) {
    return "no_reply";
  }
  if (/계약|법무|세무|환불|클레임|보안|비밀번호|결제|민감|첨부|위험|urgent|risk|complaint|security/iu.test(primarySurface)) {
    return "needs_review";
  }
  if (/문의|요청|답장|회신|견적|제안|메일|이메일|reply|required|request|quote|inquiry|mail/iu.test(primarySurface)) {
    return "reply_required";
  }
  if (/일정|캘린더|회의|미팅|예약|방문|가능\s*시간|calendar|schedule|meeting|appointment/iu.test(primarySurface)) {
    return "calendar_candidate";
  }
  if (/후속|리마인드|재확인|회신\s*대기|follow[- ]?up|followup|remind|pending reply/iu.test(text)) {
    return "follow_up";
  }
  if (/계약|법무|세무|환불|클레임|보안|비밀번호|결제|민감|첨부|위험|urgent|risk|complaint|security/iu.test(text)) {
    return "needs_review";
  }
  if (/문의|요청|답장|회신|견적|제안|메일|이메일|reply|required|request|quote|inquiry|mail/iu.test(text)) {
    return "reply_required";
  }
  return "needs_review";
}

function decisionForMobileHandoffCategory(
  category: ModyMailOperationsWorkbenchGroupId,
  hasApprovalAction: boolean,
): ModyMailOperationsWorkQueueDecision {
  if (category === "no_reply") return "exclude";
  if (category === "reply_required") return hasApprovalAction ? "approve" : "revise";
  if (category === "calendar_candidate") return hasApprovalAction ? "approve" : "hold";
  if (category === "follow_up") return hasApprovalAction ? "approve" : "hold";
  return "hold";
}

function finalRouteForDecision(
  decision: ModyMailOperationsWorkQueueDecision,
  hasApprovalAction: boolean,
): ModyMailOperationsFinalConfirmationRoute {
  if (decision === "approve" && hasApprovalAction) return "included";
  if (decision === "exclude") return "excluded";
  return "held";
}

function createWorkQueueCounts(rows: ModyMailOperationsWorkQueueRow[]): Record<ModyMailOperationsWorkbenchGroupId, number> {
  return {
    reply_required: rows.filter((row) => row.category === "reply_required").length,
    needs_review: rows.filter((row) => row.category === "needs_review").length,
    no_reply: rows.filter((row) => row.category === "no_reply").length,
    calendar_candidate: rows.filter((row) => row.category === "calendar_candidate").length,
    follow_up: rows.filter((row) => row.category === "follow_up").length,
    user_composed: rows.filter((row) => row.category === "user_composed").length,
    mobile_handoff: rows.filter((row) => row.category === "mobile_handoff").length,
  };
}

function labelForWorkQueueCategory(category: ModyMailOperationsWorkbenchGroupId): string {
  if (category === "reply_required") return "답장 보낼 메일";
  if (category === "needs_review") return "수정/확인할 메일";
  if (category === "no_reply") return "답장 안 보낼 메일";
  if (category === "calendar_candidate") return "일정 후보 메일";
  if (category === "follow_up") return "후속 확인 메일";
  if (category === "user_composed") return "내가 쓴 메일";
  return "휴대폰 메일";
}

function isCalendarProviderCandidate(candidate: ModyProviderWorkCandidate): boolean {
  if (candidate.classification === "calendar_context") return true;
  if (candidate.calendarDraft) return true;
  if (candidate.approvalQueue.some((item) => /calendar|schedule|event/u.test(`${item.operationKind} ${item.toolName}`))) {
    return true;
  }
  if (candidate.draftReply) return false;
  return /일정|캘린더|회의|미팅|예약|방문|마감|calendar|schedule|meeting|deadline/u.test(
    providerCandidateSearchText(candidate),
  );
}

function isFollowUpProviderCandidate(candidate: ModyProviderWorkCandidate): boolean {
  return /후속|리마인드|재확인|회신 대기|다시 확인|follow[- ]?up|followup|remind|pending reply/u.test(
    providerCandidateSearchText(candidate),
  );
}

function providerCandidateSearchText(candidate: ModyProviderWorkCandidate): string {
  return [
    candidate.title,
    candidate.summary,
    candidate.draftReply,
    candidate.calendarDraft,
    candidate.reportText,
    candidate.classification,
  ]
    .filter(Boolean)
    .join(" ");
}

function labelForDecision(decision: ModyMailOperationsWorkQueueDecision): string {
  if (decision === "approve") return "승인 대기";
  if (decision === "revise") return "수정 필요";
  if (decision === "hold") return "확인 필요";
  return "답장 안 보냄";
}

function routeLabel(route: ModyMailOperationsFinalConfirmationRoute): string {
  if (route === "included") return "마지막 확인 후보";
  if (route === "excluded") return "최종 확인 제외";
  return "확인/수정 전 잠금";
}

function createGroup(
  id: ModyMailOperationsWorkbenchGroupId,
  label: string,
  count: number,
  nextAction: string,
): ModyMailOperationsWorkbenchGroup {
  const safeCount = Math.max(0, count);
  return {
    id,
    label,
    count: safeCount,
    oneLineLabel: `${label} ${safeCount}건 · ${nextAction}`,
    detailsCollapsed: true,
    externalMutation: false,
    nextAction,
  };
}

function createSendAdapter(
  id: ModyMailOperationsSendAdapterId,
  label: string,
  readiness: ModyMailOperationsReadiness,
  setupLabel: string,
  externalMutationAfterApproval = true,
): ModyMailOperationsSendAdapterPlan {
  return {
    id,
    label,
    readiness,
    finalApprovalRequired: true,
    canSendBeforeFinalApproval: false,
    externalMutationAfterApproval,
    setupLabel,
  };
}

function createCoverageSummary(
  groups: ModyMailOperationsWorkbenchGroup[],
  sendAdapters: ModyMailOperationsSendAdapterPlan[],
  exceptionRows: ModyMailOperationsExceptionCoverageRow[] = [],
): string {
  const activeGroups = groups.filter((group) => group.count > 0).map((group) => group.label);
  const readyAdapters = sendAdapters.filter((adapter) => adapter.readiness !== "needs_setup").map((adapter) => adapter.label);
  const observedExceptions = exceptionRows.filter((row) => row.status === "observed");
  return [
    activeGroups.length ? `작업대 묶음: ${activeGroups.join(", ")}` : "작업대는 메일 수집 후 한 줄 묶음으로 채워집니다",
    observedExceptions.length
      ? `운영 예외: ${observedExceptions.slice(0, 4).map((row) => row.label).join(", ")}${observedExceptions.length > 4 ? ` 외 ${observedExceptions.length - 4}개` : ""}`
      : "운영 예외는 관찰되면 검토 게이트로 분리합니다",
    readyAdapters.length ? `전송 경로: ${readyAdapters.join(", ")}` : "전송 경로는 연결 뒤 최종 승인에서 열립니다",
    "실제 전송은 항상 앱 마지막 확인 뒤에만 가능합니다",
  ].join(" · ");
}

function createBulkSendReviewPlan(
  review: ModyMailRecipientListReview | undefined,
  stats: ModyMailOperationsWorkbenchInput["analysis"] extends undefined
    ? never
    : NonNullable<ModyMailOperationsWorkbenchInput["analysis"]>["stats"] | undefined,
): ModyMailOperationsBulkSendReviewPlan {
  if (review) {
    const sendCandidateCount = review.recipientDecisionMatrix.send.reduce((total, item) => total + item.count, 0);
    const holdCandidateCount = review.recipientDecisionMatrix.hold.reduce((total, item) => total + item.count, 0);
    const excludeCandidateCount = Math.max(
      review.recipientDecisionMatrix.exclude.reduce((total, item) => total + item.count, 0),
      review.dryRunSummary.wouldExcludeCount,
    );
    const status: ModyMailOperationsBulkSendReviewStatus =
      review.status === "review_required" ? "ready_for_review" : "needs_recipient_list";
    return {
      contract: "bulk_mail_review_to_recipient_sample_personalization_final_confirmation",
      rowMode: "one_line_counts_details_inside",
      status,
      sourceLabel: review.sourceLabel,
      oneLineLabel:
        status === "ready_for_review"
          ? `대량 메일 명단 ${review.rowCount}행 · 샘플 ${review.readyForSampleCount}건 · 제외 ${excludeCandidateCount}건`
          : `대량 메일 명단 ${review.rowCount}행 · 주소 열 확인 필요`,
      candidateCount: review.candidateCount,
      sendCandidateCount,
      holdCandidateCount,
      excludeCandidateCount,
      readySampleCount: review.readyForSampleCount,
      personalizationReviewCount: review.personalizationReviewCount,
      samplePreviewCount: review.samplePreviews.length,
      checklist: createBulkSendChecklistRows({
        candidateCount: review.candidateCount,
        sendCandidateCount,
        holdCandidateCount,
        excludeCandidateCount,
        readySampleCount: review.readyForSampleCount,
        personalizationReviewCount: review.personalizationReviewCount,
        samplePreviewCount: review.samplePreviews.length,
        hasRecipientList: review.status === "review_required",
      }),
      approvalGate: review.approvalGate,
      privacyBoundary: review.privacyBoundary,
      canSendBeforeFinalApproval: false,
      externalMutation: false,
    };
  }

  const signalCount = Math.max(
    stats?.bulkMailSignals ?? 0,
    stats?.recipientSourceSignals ?? 0,
    stats?.recipientDecisionSignals ?? 0,
  );
  const status: ModyMailOperationsBulkSendReviewStatus = signalCount > 0 ? "needs_recipient_list" : "standby";
  return {
    contract: "bulk_mail_review_to_recipient_sample_personalization_final_confirmation",
    rowMode: "one_line_counts_details_inside",
    status,
    sourceLabel: status === "standby" ? "대량 메일 신호 대기" : "명단 파일 검토 필요",
    oneLineLabel:
      status === "standby"
        ? "대량/단체 발송 신호가 생기면 명단 검토부터 시작"
        : `대량/단체 발송 신호 ${signalCount}건 · 명단 선택 후 샘플 검토`,
    candidateCount: signalCount,
    sendCandidateCount: 0,
    holdCandidateCount: signalCount,
    excludeCandidateCount: 0,
    readySampleCount: 0,
    personalizationReviewCount: 0,
    samplePreviewCount: 0,
    checklist: createBulkSendChecklistRows({
      candidateCount: signalCount,
      sendCandidateCount: 0,
      holdCandidateCount: signalCount,
      excludeCandidateCount: 0,
      readySampleCount: 0,
      personalizationReviewCount: 0,
      samplePreviewCount: 0,
      hasRecipientList: false,
    }),
    approvalGate: "명단 파일, 제외 대상, 샘플 문안, 개인화 값을 확인하기 전까지 실제 발송하지 않습니다.",
    privacyBoundary: "대량 메일 명단의 원문 주소는 작업대 요약에 노출하지 않고 집계와 샘플 상태만 보여줍니다.",
    canSendBeforeFinalApproval: false,
    externalMutation: false,
  };
}

function createBulkSendChecklistRows(input: {
  candidateCount: number;
  sendCandidateCount: number;
  holdCandidateCount: number;
  excludeCandidateCount: number;
  readySampleCount: number;
  personalizationReviewCount: number;
  samplePreviewCount: number;
  hasRecipientList: boolean;
}): ModyMailOperationsBulkSendReviewChecklistRow[] {
  return [
    createBulkSendChecklistRow(
      "recipient_list",
      "명단",
      input.candidateCount,
      input.hasRecipientList ? "ready" : input.candidateCount > 0 ? "review" : "idle",
      input.hasRecipientList ? "명단 행과 주소 열을 확인했습니다." : "명단 파일을 선택한 뒤 주소/그룹/제외 열을 확인합니다.",
    ),
    createBulkSendChecklistRow(
      "exclusions",
      "제외",
      input.excludeCandidateCount,
      input.excludeCandidateCount > 0 ? "review" : input.hasRecipientList ? "ready" : "idle",
      "수신거부, 중복, 주소 누락, 제외 표시를 발송 대상에서 분리합니다.",
    ),
    createBulkSendChecklistRow(
      "sample",
      "샘플",
      input.readySampleCount || input.samplePreviewCount,
      input.readySampleCount > 0 ? "ready" : input.candidateCount > 0 ? "review" : "idle",
      "그룹별 샘플 문안을 먼저 확인하고 실제 전송은 만들지 않습니다.",
    ),
    createBulkSendChecklistRow(
      "personalization",
      "개인화",
      input.personalizationReviewCount,
      input.personalizationReviewCount > 0 ? "review" : input.hasRecipientList ? "ready" : "idle",
      "이름, 회사, 일정, 금액 같은 개인화 값 누락을 샘플에서 확인합니다.",
    ),
    createBulkSendChecklistRow(
      "final_lock",
      "발송 잠금",
      input.sendCandidateCount,
      "locked",
      "발송 후보가 있어도 사용자의 최종 확인 전까지 provider 전송을 실행하지 않습니다.",
    ),
  ];
}

function createBulkSendChecklistRow(
  id: ModyMailOperationsBulkSendReviewChecklistRow["id"],
  label: string,
  count: number,
  state: ModyMailOperationsBulkSendReviewChecklistRow["state"],
  detail: string,
): ModyMailOperationsBulkSendReviewChecklistRow {
  return {
    id,
    label,
    count: Math.max(0, count),
    state,
    detail,
    detailsCollapsed: true,
    externalMutation: false,
  };
}

function createExceptionCoverage(
  rows: ModyMailOperationsExceptionCoverageRow[],
): ModyMailOperationsWorkbenchPlan["exceptionCoverage"] {
  const observedRows = rows.filter((row) => row.status === "observed");
  const highRiskObservedCount = observedRows.filter((row) => row.highRisk).length;
  return {
    contract: "mail_operations_exception_coverage_signal_to_review_gate",
    rowMode: "one_line_signal_details_inside",
    rows,
    observedCount: observedRows.length,
    highRiskObservedCount,
    summary: observedRows.length
      ? `관찰된 운영 예외 ${observedRows.length}개 · 고위험 ${highRiskObservedCount}개 · 모두 검토 게이트로 분리`
      : "운영 예외는 아직 관찰되지 않았지만 신호가 생기면 검토 게이트로 분리합니다",
    externalMutation: false,
  };
}

function createExceptionCoverageRows(
  stats: ModyMailOperationsWorkbenchInput["analysis"] extends undefined
    ? never
    : NonNullable<ModyMailOperationsWorkbenchInput["analysis"]>["stats"] | undefined,
): ModyMailOperationsExceptionCoverageRow[] {
  return [
    createExceptionCoverageRow("attachment_check", "첨부/파일 확인", stats?.attachmentSignals ?? 0, "첨부, 파일명, 누락 여부를 발송 전 점검합니다.", "첨부 있음/없음 확인", "파일 변경과 외부 발송은 최종 확인 전 잠금", false),
    createExceptionCoverageRow("bulk_send", "대량/단체 발송", stats?.bulkMailSignals ?? 0, "여러 수신자에게 보낼 메일은 샘플 검토와 제외 명단 확인을 거칩니다.", "샘플과 제외 대상 확인", "대량 발송은 승인 뒤에도 마지막 확인 필요", true),
    createExceptionCoverageRow("recipient_decision", "수신자/참조 판단", stats?.recipientDecisionSignals ?? 0, "받는 사람, 참조, 숨은참조, 보류 대상을 분리합니다.", "수신자/참조 확정", "수신자 변경은 외부 발송 전 승인 필요", true),
    createExceptionCoverageRow("recipient_source", "명단/첨부 수신자", stats?.recipientSourceSignals ?? 0, "엑셀, CSV, 첨부 명단에서 실제 발송 대상을 검토합니다.", "명단 매칭 확인", "명단 원본 변경 없이 후보만 생성", true),
    createExceptionCoverageRow("quote_proposal", "견적/제안", stats?.quoteProposalSignals ?? 0, "금액, 조건, 첨부, 유효기간을 답장 초안 전에 분리합니다.", "조건/첨부 재확인", "금액 확정 표현은 승인 전 잠금", true),
    createExceptionCoverageRow("invoice_payment", "정산/청구", stats?.invoicePaymentSignals ?? 0, "금액, 증빙, 세금계산서, 입금 상태를 확인합니다.", "금액/증빙 확인", "세무/정산 발송은 고위험 승인", true),
    createExceptionCoverageRow("contract_legal", "계약/법무", stats?.contractLegalSignals ?? 0, "계약 문구와 책임 표현은 자동 답장보다 검토 체크리스트가 우선입니다.", "검토자 확인", "법무 표현은 자동 확정 금지", true),
    createExceptionCoverageRow("public_tax", "공공기관/세무", stats?.publicTaxSignals ?? 0, "제출 기한, 필수 서류, 기관 양식을 고위험 승인으로 잠급니다.", "기한/서류 확인", "제출/발송은 최종 승인 전 금지", true),
    createExceptionCoverageRow("complaint_escalation", "클레임/긴급", stats?.complaintEscalationSignals ?? 0, "금지 표현, 담당자, 응대 우선순위를 먼저 확인합니다.", "담당자/표현 확인", "감정적/법적 표현은 보류", true),
    createExceptionCoverageRow("reservation_order", "예약/주문", stats?.reservationOrderSignals ?? 0, "예약 시간, 변경 가능 여부, 주문 상태를 분리합니다.", "시간/상태 확인", "예약 확정은 최종 확인 필요", false),
    createExceptionCoverageRow("compliance_unsubscribe", "수신거부/준수", stats?.complianceUnsubscribeSignals ?? 0, "수신거부, 마케팅 준수, 제외 규칙을 발송 전 반영합니다.", "제외 규칙 확인", "수신거부 대상 발송 금지", true),
    createExceptionCoverageRow("customer_inquiry", "고객/상담 문의", stats?.customerInquirySignals ?? 0, "문의 범위, 담당자, 답변 가능 정보를 나눕니다.", "답변 범위 확인", "불확실한 답변은 검토 대기", false),
    createExceptionCoverageRow("vendor_procurement", "구매/발주", stats?.vendorProcurementSignals ?? 0, "품목, 수량, 납기, 거래 조건을 확인합니다.", "품목/납기 확인", "발주 확정은 승인 전 금지", true),
    createExceptionCoverageRow("hr_recruiting", "채용/인사", stats?.hrRecruitingSignals ?? 0, "개인정보, 내부 공유 범위, 면접 일정 후보를 분리합니다.", "개인정보/공유 범위 확인", "개인정보 외부 공유 금지", true),
    createExceptionCoverageRow("document_submission", "자료/보고서 제출", stats?.documentSubmissionSignals ?? 0, "제출 파일, 기한, 공유 권한을 함께 확인합니다.", "파일/권한 확인", "파일 공유는 승인 전 금지", true),
    createExceptionCoverageRow("security_account_alert", "보안/계정 알림", stats?.securityAccountAlertSignals ?? 0, "비밀값을 노출하지 않고 공식 화면 확인으로 넘깁니다.", "공식 화면 확인", "비밀번호/토큰은 채팅에 표시 금지", true),
    createExceptionCoverageRow("internal_collaboration", "내부 협업", stats?.internalCollaborationSignals ?? 0, "담당자, 마감, 공유 채널을 다음 행동으로 정합니다.", "담당자/마감 확인", "공유/전달은 승인 전 보류", false),
    createExceptionCoverageRow("thread_context", "스레드/전달 맥락", stats?.threadContextSignals ?? 0, "최신 요청과 이전 약속을 분리해 답장 기준을 정합니다.", "최신 요청 확인", "이전 약속 임의 변경 금지", false),
    createExceptionCoverageRow("delivery_failure", "반송/발송 실패", stats?.deliveryFailureSignals ?? 0, "주소, 첨부 용량, provider 오류를 재발송 전 확인합니다.", "주소/오류 확인", "재발송은 최종 확인 후", true),
    createExceptionCoverageRow("out_of_office", "부재중/자동응답", stats?.outOfOfficeSignals ?? 0, "재시도 시점과 대체 담당자 후보로 나눕니다.", "재시도/대체 담당자 확인", "자동 재발송은 기본 꺼짐", false),
    createExceptionCoverageRow("sent_history_audit", "처리 이력/감사", stats?.sentHistoryAuditSignals ?? 0, "승인 기록, 발송 로그, 되돌림 기준을 남깁니다.", "기록 확인", "로그 없는 외부 실행 금지", true),
    createExceptionCoverageRow("mail_info_digest", "정보 전달/요약", stats?.mailInfoDigestSignals ?? 0, "중요 메일, 확인 필요 정보, 민감정보 제외 기준을 분리합니다.", "요약 범위 확인", "민감정보는 요약에서 제외", false),
  ];
}

function createExceptionCoverageRow(
  id: ModyMailOperationsExceptionCoverageId,
  label: string,
  count: number,
  detail: string,
  userAction: string,
  safetyGate: string,
  highRisk: boolean,
): ModyMailOperationsExceptionCoverageRow {
  const safeCount = Math.max(0, count);
  const status: ModyMailOperationsExceptionCoverageStatus = safeCount > 0 ? "observed" : "standby";
  return {
    id,
    label,
    count: safeCount,
    status,
    oneLineLabel: `${label} · ${safeCount > 0 ? `${safeCount}건 관찰` : "대기"}`,
    detail,
    userAction,
    safetyGate,
    highRisk,
    detailsCollapsed: true,
    externalMutation: false,
  };
}

function createCoverageMatrix(
  groups: ModyMailOperationsWorkbenchGroup[],
  channels: ModyMailOperationsChannelPlan[],
  sendAdapters: ModyMailOperationsSendAdapterPlan[],
): ModyMailOperationsCoverageMatrixRow[] {
  const groupCount = (id: ModyMailOperationsWorkbenchGroupId) => groups.find((group) => group.id === id)?.count ?? 0;
  const readyReadChannel = channels.find((channel) => channel.canReadMail && channel.readiness === "ready");
  const mobileChannel = channels.find((channel) => channel.id === "mobile_share_or_pwa");
  const manualChannel = channels.find((channel) => channel.id === "manual_compose");
  const readySendAdapter = sendAdapters.find((adapter) => adapter.readiness === "needs_final_approval");

  return [
    createCoverageMatrixRow({
      id: "inbox_triage",
      label: "받은 메일 선별",
      status: readyReadChannel ? "ready" : "needs_connection",
      statusLabel: readyReadChannel ? "읽기 가능" : "연결 필요",
      detail: "Gmail, Outlook, 회사/일반 메일을 읽기 전용으로 확인한 뒤 답장/검토/제외 후보로 나눕니다.",
      primaryChannelId: readyReadChannel?.id ?? "gmail_oauth",
    }),
    createCoverageMatrixRow({
      id: "reply_draft",
      label: "답장 초안/수정",
      status: groupCount("reply_required") > 0 ? "ready" : "needs_review",
      statusLabel: groupCount("reply_required") > 0 ? `${groupCount("reply_required")}건 대기` : "후보 없음",
      detail: "답장 보낼 메일만 초안을 만들고, 사용자가 수정한 뒤 승인 후보로 넘깁니다.",
    }),
    createCoverageMatrixRow({
      id: "review_no_reply",
      label: "답장 안 보낼 메일",
      status: groupCount("no_reply") > 0 ? "ready" : "needs_review",
      statusLabel: groupCount("no_reply") > 0 ? `${groupCount("no_reply")}건 제외` : "분류 대기",
      detail: "광고, 자동 알림, 뉴스레터는 접고 필요하면 사용자가 답장 후보로 되돌릴 수 있습니다.",
    }),
    createCoverageMatrixRow({
      id: "calendar_follow_up",
      label: "일정/후속 확인",
      status: groupCount("calendar_candidate") + groupCount("follow_up") > 0 ? "ready" : "needs_review",
      statusLabel: `${groupCount("calendar_candidate")}일정 · ${groupCount("follow_up")}후속`,
      detail: "일정 후보와 회신 대기 메일을 분리하지만 캘린더 등록과 자동 독촉은 마지막 확인 전까지 잠급니다.",
    }),
    createCoverageMatrixRow({
      id: "user_composed_check",
      label: "내가 쓴 메일 점검",
      status: manualChannel ? "ready" : "needs_review",
      statusLabel: groupCount("user_composed") > 0 ? `${groupCount("user_composed")}건 점검` : "바로 사용",
      detail: "사용자가 직접 쓴 메일의 수신자, 본문, 첨부, 위험 표현을 발송 전 점검합니다.",
      ...(manualChannel ? { primaryChannelId: manualChannel.id } : {}),
    }),
    createCoverageMatrixRow({
      id: "mobile_review",
      label: "휴대폰 검토",
      status: mobileChannel ? "ready" : "needs_connection",
      statusLabel: groupCount("mobile_handoff") > 0 ? `${groupCount("mobile_handoff")}건` : "공유/PWA",
      detail: "휴대폰에서 선택한 메일을 앱 작업대에 올리고 한 줄 요약, 수정, 승인, 보류만 처리합니다.",
      ...(mobileChannel ? { primaryChannelId: mobileChannel.id } : {}),
    }),
    createCoverageMatrixRow({
      id: "bulk_review",
      label: "여러 메일 일괄 처리",
      status: groups.some((group) => group.count > 1) ? "ready" : "needs_review",
      statusLabel: groups.some((group) => group.count > 1) ? "묶음 가능" : "선택 후 가능",
      detail: "여러 메일을 선택해 답장 보냄, 수정/확인, 답장 안 보냄으로 나누되 외부 실행은 만들지 않습니다.",
    }),
    createCoverageMatrixRow({
      id: "live_send",
      label: "승인 후 전송",
      status: readySendAdapter ? "needs_final_approval" : "needs_connection",
      statusLabel: readySendAdapter ? "최종 확인 필요" : "발송 권한 필요",
      detail: "Gmail API, Microsoft Graph, SMTP는 승인된 행만 마지막 확인 뒤 실행합니다.",
      sendAdapterId: readySendAdapter?.id ?? "app_final_confirmation_only",
    }),
  ];
}

function createCoverageMatrixRow(
  input: Omit<ModyMailOperationsCoverageMatrixRow, "oneLineLabel" | "detailsCollapsed" | "externalMutation">,
): ModyMailOperationsCoverageMatrixRow {
  return {
    ...input,
    oneLineLabel: `${input.label} · ${input.statusLabel}`,
    detailsCollapsed: true,
    externalMutation: false,
  };
}

function compactQueueText(value: string | undefined, maxLength: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function safeQueueId(value: string): string {
  return String(value || "mail")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣_-]+/giu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "mail";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
