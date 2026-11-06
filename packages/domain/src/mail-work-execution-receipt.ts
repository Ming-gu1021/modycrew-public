import type { ModyMailDecisionLearningProfile, ModyMailDecisionWorkPattern } from "./mail-decision-learning.js";
import type { ModyMailRecipientListReview } from "./mail-recipient-list-review.js";
import type { ModyMailWorkPatternAnalysis } from "./mail-work-pattern-analysis.js";
import type { ModyMailWorkScenarioId } from "./mail-work-scenario-taxonomy.js";
import type { ISODateTimeString, ToolActionRequest } from "./types.js";

export type ModyMailWorkExecutionDecision =
  | "drafted"
  | "reviewed"
  | "dry_run_ready"
  | "approved_for_final_confirmation"
  | "held"
  | "cancelled"
  | "blocked";

export type ModyMailWorkExecutionActionKind =
  | "read_mail"
  | "draft_reply"
  | "send_single_email"
  | "send_bulk_email"
  | "schedule_from_mail"
  | "recipient_review"
  | "connection_preflight"
  | "operational_exception_review";

export type ModyMailWorkExecutionReceiptInput = {
  id?: string;
  createdAt?: ISODateTimeString;
  workItemId: string;
  title: string;
  actionKind: ModyMailWorkExecutionActionKind;
  decision: ModyMailWorkExecutionDecision;
  providerLabel?: string;
  connectionLabel?: string;
  scenarioIds?: ModyMailWorkScenarioId[];
  workAnalysis?: Pick<
    ModyMailWorkPatternAnalysis,
    "summary" | "connectionReadinessPlan" | "bulkSendPlan" | "followUpPlan" | "recipientCopyPlan" | "approvalPolicy" | "riskNotes" | "stats"
  >;
  recipientReview?: Pick<
    ModyMailRecipientListReview,
    "sourceLabel" | "rowCount" | "validRecipientCount" | "readyForSampleCount" | "personalizationReviewCount" | "excludedCount" | "duplicateCount" | "missingAddressCount" | "recipientDecisionSummary" | "recipientDecisionMatrix" | "nextReviewFocus" | "dryRunSummary" | "privacyBoundary"
  >;
  learningProfile?: Pick<
    ModyMailDecisionLearningProfile,
    "summary" | "matchedPatternCount" | "learnedDefaultDecisionSummary" | "learningDecisionHints" | "learnedIncludeOverrideLabels" | "learnedExcludeOverrideLabels" | "learnedHoldOverrideLabels" | "privacyBoundary"
  >;
  approvalQueue?: Pick<ToolActionRequest, "id" | "operationKind" | "riskLabel" | "externalMutation" | "requiresApproval" | "userVisibleDescription">[];
  dryRunId?: string;
  auditArtifactPath?: string;
  userDecisionLabel?: string;
  userDecisionReason?: string;
  rollbackBasis?: string;
  nextUserActions?: string[];
};

export type ModyMailWorkExecutionReceipt = {
  id: string;
  createdAt: ISODateTimeString;
  workItemId: string;
  title: string;
  actionKind: ModyMailWorkExecutionActionKind;
  decision: ModyMailWorkExecutionDecision;
  providerLabel: string;
  connectionLabel: string;
  scenarioIds: ModyMailWorkScenarioId[];
  processingSteps: string[];
  recipientDecisionDigest: string[];
  approvalDigest: string[];
  learningDigest: string[];
  auditDigest: string[];
  nextUserActions: string[];
  dryRunId?: string;
  auditArtifactPath?: string;
  rollbackBasis: string;
  externalMutation: false;
  finalUserConfirmationRequired: true;
  rawAddressStored: false;
  rawSecretStored: false;
  rawMailBodyStored: false;
  privacyBoundary: string;
  learningPatternDraft: ModyMailDecisionWorkPattern;
};

export function createMailWorkExecutionReceipt(
  input: ModyMailWorkExecutionReceiptInput,
): ModyMailWorkExecutionReceipt {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = safeId(input.id ?? `mail_receipt_${input.workItemId}_${compactDate(createdAt)}`);
  const scenarioIds = uniqueScenarioIds(input.scenarioIds ?? inferScenarioIds(input));
  const processingSteps = createProcessingSteps(input);
  const recipientDecisionDigest = createRecipientDecisionDigest(input.recipientReview);
  const approvalDigest = createApprovalDigest(input);
  const learningDigest = createLearningDigest(input.learningProfile);
  const auditDigest = createAuditDigest(input);
  const nextUserActions = createNextUserActions(input);
  const rollbackBasis = cleanLabel(input.rollbackBasis) || defaultRollbackBasis(input.decision);

  const receipt: ModyMailWorkExecutionReceipt = {
    id,
    createdAt,
    workItemId: safeId(input.workItemId),
    title: cleanLabel(input.title) || "메일 업무 처리 기록",
    actionKind: input.actionKind,
    decision: input.decision,
    providerLabel: cleanLabel(input.providerLabel) || "메일 provider 미지정",
    connectionLabel: cleanLabel(input.connectionLabel) || "필요한 연결만 확인",
    scenarioIds,
    processingSteps,
    recipientDecisionDigest,
    approvalDigest,
    learningDigest,
    auditDigest,
    nextUserActions,
    ...(input.dryRunId ? { dryRunId: safeId(cleanLabel(input.dryRunId)) } : {}),
    ...(input.auditArtifactPath ? { auditArtifactPath: cleanPathLabel(input.auditArtifactPath) } : {}),
    rollbackBasis,
    externalMutation: false,
    finalUserConfirmationRequired: true,
    rawAddressStored: false,
    rawSecretStored: false,
    rawMailBodyStored: false,
    privacyBoundary:
      "메일 처리 영수증은 주소/이름/원문 본문/비밀번호/토큰/2차 인증값을 저장하지 않고, 업무 라벨과 결정 근거만 남깁니다.",
    learningPatternDraft: createLearningPatternDraft({
      id,
      input,
      scenarioIds,
      processingSteps,
      recipientDecisionDigest,
      approvalDigest,
      learningDigest,
      rollbackBasis,
    }),
  };

  return redactReceipt(receipt);
}

function createProcessingSteps(input: ModyMailWorkExecutionReceiptInput): string[] {
  return unique([
    "업무 탭에서 메일 업무를 먼저 선택",
    input.workAnalysis?.summary ? `메일 업무 분석: ${input.workAnalysis.summary}` : "",
    input.workAnalysis?.connectionReadinessPlan
      ? `연결 준비: ${input.workAnalysis.connectionReadinessPlan.approvalGate}`
      : "메일 연결은 필요한 단계에서만 확인",
    input.recipientReview
      ? `수신자 판단: ${input.recipientReview.recipientDecisionSummary}`
      : "",
    input.workAnalysis?.bulkSendPlan?.status === "review_required"
      ? `대량 발송 검토: ${input.workAnalysis.bulkSendPlan.approvalGate}`
      : "",
    input.workAnalysis?.followUpPlan?.status === "review_required"
      ? `후속 추적: ${input.workAnalysis.followUpPlan.nextCheckLabel}`
      : "",
    input.userDecisionLabel ? `사용자 결정: ${input.userDecisionLabel}` : "",
    input.decision === "dry_run_ready" ? "dry-run 검증 완료, 실제 발송은 최종 확인 전까지 잠금" : "",
    input.decision === "approved_for_final_confirmation" ? "오피스 최종 확인 후보로 이동" : "",
    input.decision === "held" || input.decision === "cancelled" ? "실행 없이 보류/취소 결정만 기록" : "",
  ]);
}

function createRecipientDecisionDigest(
  review?: ModyMailWorkExecutionReceiptInput["recipientReview"],
): string[] {
  if (!review) {
    return ["수신자 판단 자료 없음, 발송 대상은 확정하지 않음"];
  }
  return unique([
    `명단 출처: ${review.sourceLabel}`,
    `전체 ${review.rowCount}행, 발송 후보 ${review.validRecipientCount}건`,
    `샘플 가능 ${review.readyForSampleCount}건, 개인화 확인 ${review.personalizationReviewCount}건`,
    `제외 ${review.excludedCount}건, 중복 ${review.duplicateCount}건, 주소 누락 ${review.missingAddressCount}건`,
    ...review.recipientDecisionMatrix.send.slice(0, 4).map((item) => `발송 후보: ${item.label} ${item.count}건`),
    ...review.recipientDecisionMatrix.hold.slice(0, 4).map((item) => `보류: ${item.label} ${item.count}건`),
    ...review.recipientDecisionMatrix.exclude.slice(0, 4).map((item) => `제외: ${item.label} ${item.count}건`),
    `다음 검토: ${review.nextReviewFocus}`,
    `dry-run 기준: ${review.dryRunSummary.blockedReason}`,
  ]);
}

function createApprovalDigest(input: ModyMailWorkExecutionReceiptInput): string[] {
  return unique([
    input.decision === "blocked" ? "현재 상태: 실행 차단" : "",
    input.decision === "reviewed" ? "현재 상태: 사용자 검토 필요" : "",
    input.decision === "dry_run_ready" ? "현재 상태: dry-run 완료, 최종 확인 대기" : "",
    input.decision === "approved_for_final_confirmation" ? "현재 상태: 최종 확인 후보" : "",
    ...(input.approvalQueue ?? []).slice(0, 6).map((item) =>
      `${item.operationKind} · ${item.riskLabel} · ${item.requiresApproval ? "승인 필요" : "자동 허용"} · ${item.externalMutation ? "외부 변경 후보" : "외부 변경 없음"}`,
    ),
    ...(input.workAnalysis?.approvalPolicy ?? []).slice(0, 5),
    ...(input.workAnalysis?.riskNotes ?? []).slice(0, 4),
    "finalUserPresence=true 전에는 외부 발송, 일정 등록, 파일 공유를 실행하지 않음",
  ]);
}

function createLearningDigest(
  profile?: ModyMailWorkExecutionReceiptInput["learningProfile"],
): string[] {
  if (!profile) {
    return [
      "저장된 메일 결정 학습 없음",
      "이번 처리 결과를 발송/보류/제외/승인 습관의 첫 기준으로 저장 가능",
    ];
  }
  return unique([
    profile.summary,
    `저장된 패턴 ${profile.matchedPatternCount}건 참고`,
    profile.learnedDefaultDecisionSummary,
    ...profile.learningDecisionHints.slice(0, 4),
    ...profile.learnedIncludeOverrideLabels.slice(0, 3).map((label) => `학습 포함: ${label}`),
    ...profile.learnedExcludeOverrideLabels.slice(0, 3).map((label) => `학습 제외: ${label}`),
    ...profile.learnedHoldOverrideLabels.slice(0, 3).map((label) => `학습 보류: ${label}`),
  ]);
}

function createAuditDigest(input: ModyMailWorkExecutionReceiptInput): string[] {
  return unique([
    input.auditArtifactPath ? `감사 파일: ${input.auditArtifactPath}` : "감사 파일은 최종 실행 시 생성",
    input.dryRunId ? `dry-run ID: ${input.dryRunId}` : "",
    input.userDecisionReason ? `결정 사유: ${input.userDecisionReason}` : "",
    "처리 이력은 결정 라벨, 검토 단계, 되돌림 기준만 저장",
  ]);
}

function createNextUserActions(input: ModyMailWorkExecutionReceiptInput): string[] {
  return unique([
    ...(input.nextUserActions ?? []),
    input.recipientReview ? "수신자/참조/숨은참조와 제외 대상을 다시 확인" : "",
    input.workAnalysis?.bulkSendPlan?.status === "review_required" ? "샘플 문안과 개인화 값을 확인한 뒤 dry-run 진행" : "",
    input.decision === "dry_run_ready" ? "오피스 최종 확인에서 실제 발송 여부 결정" : "",
    input.decision === "held" ? "보류 사유를 수정한 뒤 새 후보 생성" : "",
    "이번 처리 방식을 지난 업무 기억에 저장할지 선택",
  ]);
}

function createLearningPatternDraft(input: {
  id: string;
  input: ModyMailWorkExecutionReceiptInput;
  scenarioIds: ModyMailWorkScenarioId[];
  processingSteps: string[];
  recipientDecisionDigest: string[];
  approvalDigest: string[];
  learningDigest: string[];
  rollbackBasis: string;
}): ModyMailDecisionWorkPattern {
  const metrics: Record<string, string | number | boolean> = {
    finalUserConfirmationRequired: true,
    externalMutation: false,
    rawAddressStored: false,
    rawSecretStored: false,
  };
  if (input.input.recipientReview) {
    metrics.rowCount = input.input.recipientReview.rowCount;
    metrics.validRecipientCount = input.input.recipientReview.validRecipientCount;
    metrics.excludedCount = input.input.recipientReview.excludedCount;
    metrics.duplicateCount = input.input.recipientReview.duplicateCount;
    metrics.missingAddressCount = input.input.recipientReview.missingAddressCount;
  }
  if (input.input.workAnalysis?.stats) {
    metrics.bulkMailSignals = input.input.workAnalysis.stats.bulkMailSignals;
    metrics.recipientDecisionSignals = input.input.workAnalysis.stats.recipientDecisionSignals;
  }

  return {
    id: `${input.id}:learning-pattern`,
    sourceKind: "mailops_execution_receipt",
    sourceLabel: cleanLabel(input.input.title) || "메일 업무 처리 영수증",
    summary: unique([
      `결정: ${decisionLabel(input.input.decision)}`,
      `업무 종류: ${input.input.actionKind}`,
      input.input.userDecisionLabel ? `사용자 결정: ${input.input.userDecisionLabel}` : "",
      `되돌림 기준: ${input.rollbackBasis}`,
    ]).join(" / "),
    signals: unique([
      ...input.scenarioIds.map((id) => `시나리오: ${id}`),
      ...input.processingSteps,
      ...input.recipientDecisionDigest,
      ...input.approvalDigest,
      ...input.learningDigest,
    ]).slice(0, 24),
    metrics,
  };
}

function inferScenarioIds(input: ModyMailWorkExecutionReceiptInput): ModyMailWorkScenarioId[] {
  const scenarioIds: ModyMailWorkScenarioId[] = [];
  if (input.actionKind === "connection_preflight") scenarioIds.push("connection_preflight");
  if (input.actionKind === "send_bulk_email") scenarioIds.push("bulk_mail", "recipient_selection");
  if (input.actionKind === "recipient_review") scenarioIds.push("recipient_selection");
  if (input.actionKind === "draft_reply" || input.actionKind === "send_single_email") scenarioIds.push("reply_draft");
  if (input.actionKind === "schedule_from_mail") scenarioIds.push("calendar_coordination");
  if (input.actionKind === "operational_exception_review") {
    scenarioIds.push("delivery_failure_bounce", "out_of_office_auto_reply", "thread_context_reconstruction");
  }
  scenarioIds.push("sent_history_audit", "work_memory_learning", "high_risk_approval");
  return scenarioIds;
}

function defaultRollbackBasis(decision: ModyMailWorkExecutionDecision): string {
  if (decision === "cancelled" || decision === "held" || decision === "blocked") {
    return "외부 실행이 없어 원본 변경 없음, 새 후보를 다시 만들 수 있음";
  }
  if (decision === "dry_run_ready") {
    return "dry-run 감사 기록 기준으로 최종 발송 전까지 중단 가능";
  }
  return "오피스 승인함의 결정 영수증과 감사 파일 기준으로 되돌림 판단";
}

function decisionLabel(decision: ModyMailWorkExecutionDecision): string {
  const labels: Record<ModyMailWorkExecutionDecision, string> = {
    drafted: "초안 생성",
    reviewed: "검토 완료",
    dry_run_ready: "dry-run 준비",
    approved_for_final_confirmation: "최종 확인 후보",
    held: "보류",
    cancelled: "취소",
    blocked: "차단",
  };
  return labels[decision];
}

function redactReceipt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, item) =>
    typeof item === "string" ? cleanLabel(item) : item,
  ) as T;
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(cleanLabel).filter(Boolean)));
}

function uniqueScenarioIds(values: readonly ModyMailWorkScenarioId[]): ModyMailWorkScenarioId[] {
  return Array.from(new Set(values));
}

function cleanPathLabel(value: unknown): string {
  return cleanLabel(String(value ?? "").replace(/\\/g, "/"));
}

function safeId(value: unknown): string {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120) || "mail_receipt";
}

function compactDate(value: string): string {
  return value.replace(/[^0-9a-z]/giu, "").slice(0, 14) || "now";
}

function cleanLabel(value: unknown): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/gu, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/gu, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/gu, "[redacted-key]")
    .replace(/((?:이름|성명|담당자|name|recipient name)\s*)[:=]\s*\S+/giu, "$1=[redacted-name]")
    .replace(/((?:password|passwd|pwd|비밀번호|앱\s*비밀번호|인증코드|otp|token|secret)\s*)[:=]\s*\S+/giu, "$1=[redacted-secret]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}
