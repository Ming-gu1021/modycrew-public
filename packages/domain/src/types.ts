export type ISODateTimeString = string;

export const modyPolicyVersion = "modycrew.policy.v1" as const;
export type PolicyVersion = typeof modyPolicyVersion;

export const toolPermissionLevels = [
  "read",
  "analyze",
  "draft",
  "stage",
  "execute",
  "dangerous_execute",
  "blocked",
] as const;

export type ToolPermissionLevel = (typeof toolPermissionLevels)[number];

export type ApprovalDecision =
  | "approved"
  | "rejected"
  | "needs_more_context"
  | "expired"
  | "change_requested"
  | "held";

export type ModyChannelId =
  | "email"
  | "gmail"
  | "outlook"
  | "imap_smtp"
  | "telegram"
  | "slack"
  | "discord"
  | "kakao_talk"
  | "kakao_channel"
  | "line"
  | "naver_works"
  | "naver_inquiry"
  | "naver_booking"
  | "kakao_inquiry"
  | "kakao_booking"
  | "google_booking"
  | "company_mail"
  | "public_agency_mail"
  | "teams"
  | "google_chat"
  | "whatsapp"
  | "instagram"
  | "manual_console";

export type ModyChannelCategory =
  | "email"
  | "messenger_bot"
  | "workspace_messenger"
  | "business_channel"
  | "business_inquiry"
  | "booking_platform"
  | "social_dm"
  | "manual_console";

export type ModyChannelTrustLevel =
  | "verified_user"
  | "workspace_member"
  | "business_account_contact"
  | "unverified_contact";

export type ModyChannelMessageDirection = "inbound" | "outbound";

export type ModyChannelMessage = {
  id: string;
  channelId: ModyChannelId;
  category: ModyChannelCategory;
  direction: ModyChannelMessageDirection;
  senderId: string;
  workspaceId?: string;
  threadId?: string;
  text: string;
  receivedAt: ISODateTimeString;
  trustLevel: ModyChannelTrustLevel;
};

export type ModyCommandIntentKind =
  | "summarize_today"
  | "list_pending_approvals"
  | "summarize_calendar"
  | "draft_reply"
  | "draft_calendar_event"
  | "search_documents"
  | "approve_action"
  | "request_change"
  | "hold_action"
  | "reject_action"
  | "open_app"
  | "unknown";

export type ModyCommandIntent = {
  id: string;
  kind: ModyCommandIntentKind;
  channelId: ModyChannelId;
  sourceMessageId: string;
  rawText: string;
  targetWorkItemId?: string;
  targetActionRequestId?: string;
  revisionInstruction?: string;
  query?: string;
  createdAt: ISODateTimeString;
};

export type ModyChannelDecision = {
  id: string;
  intentId: string;
  requestId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  decidedViaChannelId: ModyChannelId;
  decidedAt: ISODateTimeString;
  revisionInstruction?: string;
};

export type ModyChannelSafetyResult = {
  intent: ModyCommandIntent;
  canRecordDecision: boolean;
  canExecuteFromChannel: boolean;
  requiresAppReconfirm: boolean;
  userMessage: string;
};

export type ModyOutboundMessage = {
  id: string;
  channelId: ModyChannelId;
  threadId?: string;
  text: string;
  actionLabels: string[];
  appDeepLink?: string;
  createdAt: ISODateTimeString;
};

export type ToolRiskLabel = "low" | "medium" | "high" | "blocked";

export type KnowledgeSource =
  | "local_file"
  | "uploaded_file"
  | "email"
  | "calendar"
  | "web_page"
  | "drive_file"
  | "manual_note";

export type KnowledgeSourceMetadata = {
  sourceUri?: string;
  originalFileName?: string;
  mimeType?: string;
  connectorName?: string;
  mailboxId?: string;
  messageId?: string;
  calendarEventId?: string;
  webCanonicalUrl?: string;
  fileSizeBytes?: number;
  receivedAt?: ISODateTimeString;
};

export type ToolOperationKind =
  | "read_data"
  | "analyze_data"
  | "update_internal_context"
  | "draft_reply"
  | "draft_calendar_event"
  | "stage_approval"
  | "repair_connector"
  | "send_email"
  | "send_sms_message"
  | "create_calendar_event"
  | "share_file"
  | "submit_public_agency"
  | "tax_or_contract_execution"
  | "process_payment_or_refund"
  | "send_sensitive_personal_data"
  | "other_external_mutation";

export type ToolActionRequest = {
  id: string;
  toolName: string;
  permissionLevel: ToolPermissionLevel;
  operationKind: ToolOperationKind;
  inputSummary: string;
  expectedImpact: string;
  requiresApproval: boolean;
  externalMutation: boolean;
  riskLabel: ToolRiskLabel;
  userVisibleDescription: string;
  createdAt: ISODateTimeString;
  sourceAdapterId?: string;
  approvalTargetActionId?: string;
  metadata?: Record<string, unknown>;
};

export type ApprovalRecord = {
  id: string;
  requestId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  decidedAt: ISODateTimeString;
  reason?: string;
  expiresAt?: ISODateTimeString;
};

export type ApprovalGateStatus =
  | "auto_allowed"
  | "stage_only"
  | "approval_required"
  | "approved_for_execution"
  | "rejected"
  | "needs_more_context"
  | "expired"
  | "blocked";

export type ApprovalGateResult = {
  request: ToolActionRequest;
  status: ApprovalGateStatus;
  canRunTool: boolean;
  canMutateExternalSystem: boolean;
  requiresApproval: boolean;
  userMessage: string;
  auditMessage: string;
};

export type ModyAuditEntry = {
  id: string;
  requestId?: string;
  actor: "system" | "agent" | "user" | "tool" | "channel";
  eventType:
    | "tool_requested"
    | "tool_blocked"
    | "approval_required"
    | "approval_decided"
    | "tool_completed"
    | "tool_failed"
    | "risk_detected"
    | "document_ingested"
    | "channel_message_received"
    | "channel_intent_parsed"
    | "channel_decision_recorded";
  message: string;
  createdAt: ISODateTimeString;
  policyVersion?: PolicyVersion;
  operationKind?: ToolOperationKind;
  riskLabel?: ToolRiskLabel;
  metadata?: Record<string, unknown>;
};

export type ExtractedTextStatus = "pending" | "ready" | "failed";
export type ProcessingStatus = "not_started" | "pending" | "ready" | "failed";
export type RetentionPolicy = "workspace_default" | "temporary" | "manual_delete_required";

export type IngestedDocument = {
  id: string;
  workspaceId?: string;
  source: KnowledgeSource;
  sourceMetadata: KnowledgeSourceMetadata;
  sourceUri?: string;
  title: string;
  originalFileName?: string;
  contentHash?: string;
  extractedTextStatus: ExtractedTextStatus;
  summaryStatus: ProcessingStatus;
  embeddingStatus: ProcessingStatus;
  retentionPolicy: RetentionPolicy;
  extractionFailure?: KnowledgeExtractionFailure;
  riskSignals?: KnowledgeRiskSignal[];
  riskLabel?: ToolRiskLabel;
  createdAt: ISODateTimeString;
};

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  source: KnowledgeSource;
  sourceTitle: string;
  contentHash?: string;
  text: string;
  order: number;
  tokenEstimate: number;
  riskSignals: KnowledgeRiskSignal[];
  riskLabel: ToolRiskLabel;
};

export type KnowledgeExtractionFailure = {
  reason: string;
  retryable: boolean;
  failedAt?: ISODateTimeString;
};

export type KnowledgeRiskSignal = {
  id: string;
  label: string;
  riskLabel: Exclude<ToolRiskLabel, "low">;
  reason: string;
};

export type RiskSignalKind =
  | "personal_data"
  | "contract"
  | "tax"
  | "public_agency"
  | "payment_or_refund"
  | "legal_responsibility"
  | "medical_or_legal"
  | "external_execution";

export type RiskSignal = {
  id: string;
  kind: RiskSignalKind;
  riskLabel: Exclude<ToolRiskLabel, "low">;
  reason: string;
  evidence?: string;
};

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

export type WorkItemSource = KnowledgeSource | "manual_input" | "messaging_command" | "business_system";

export type WorkItem = {
  id: string;
  title: string;
  source: WorkItemSource;
  body: string;
  status: WorkItemStatus;
  riskLabel: ToolRiskLabel;
  riskSignals: RiskSignal[];
  toolActionRequests: ToolActionRequest[];
  policyVersion: PolicyVersion;
  createdAt: ISODateTimeString;
  updatedAt?: ISODateTimeString;
};

export type KnowledgeRetrievalHit = {
  document: IngestedDocument;
  chunk: KnowledgeChunk;
  score: number;
  matchedTerms: string[];
  citationLabel: string;
};

export type RagCitation = {
  documentId: string;
  chunkId: string;
  label: string;
  source: KnowledgeSource;
  sourceUri?: string;
  originalFileName?: string;
  contentHash?: string;
};

export type RagContext = {
  query: string;
  retrievalMode: "keyword_mvp";
  hits: KnowledgeRetrievalHit[];
  citations: RagCitation[];
  contextText: string;
};

export type IngestedKnowledgeRecord = {
  document: IngestedDocument;
  extractedText?: string;
  summary?: string;
  chunks: KnowledgeChunk[];
  failureReason?: string;
  duplicateOfDocumentId?: string;
};

/**
 * 업무를 실제로 맡는 직원.
 *
 * 이 칸이 없어서 담당자를 본문 문자열에 "담당 비서: 홍길동" 이라고 적어 넘겼고,
 * 계획 단계(agent-runtime.ts)에서 본문을 요약하면서 그대로 버려졌다.
 * 대표가 직원에게 일을 시키려면 지시 대상이 구조화된 값으로 남아야 한다.
 */
export type AgentAssignee = {
  id: string;
  name: string;
  roleTitle?: string;
  channelName?: string;
};

export type AgentWorkRequest = {
  id: string;
  title: string;
  body: string;
  /** 담당 직원. 비어 있으면 아직 배정되지 않은 업무다. */
  assignee?: AgentAssignee;
  createdAt?: ISODateTimeString;
  sourceDocumentIds?: string[];
};

export type AgentPlanStepPhase =
  | "read"
  | "analyze"
  | "draft"
  | "stage_approval"
  | "execute_after_approval"
  | "blocked";

export type AgentPlanStep = {
  id: string;
  label: string;
  phase: AgentPlanStepPhase;
  action: ToolActionRequest;
  gate: ApprovalGateResult;
  canRunNow: boolean;
  userMessage: string;
};

export type AgentPlan = {
  id: string;
  requestId: string;
  title: string;
  /** 이 계획을 수행할 직원. 요청의 담당자가 그대로 따라온다. */
  assignee?: AgentAssignee;
  steps: AgentPlanStep[];
  approvalQueue: ToolActionRequest[];
  blockedActions: ToolActionRequest[];
  requiresApproval: boolean;
  blocked: boolean;
  createdAt: ISODateTimeString;
};
