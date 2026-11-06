import type { WorkItem } from "./types";

export const HOME_APPROVAL_DECISION_RECEIPT_STORAGE_KEY = "modycrew.homeApprovalDecisionReceipt.v1";
export const HOME_APPROVAL_DECISION_RECEIPT_HISTORY_STORAGE_KEY = "modycrew.homeApprovalDecisionReceiptHistory.v1";
const HOME_APPROVAL_DECISION_RECEIPT_HISTORY_LIMIT = 8;
export const HOME_APPROVAL_DECISION_PROOF_CHAIN_CONTRACT = "approval_decision_receipt_log_memory_next";
export const HOME_APPROVAL_DECISION_MEMORY_SUGGESTION_POLICY = "manual_next_time_only";
export const MAILOPS_APPROVAL_DECISION_SOURCE_EVIDENCE_CONTRACT = "mailops_approval_preview_to_decision_receipt";
const MAILOPS_RUNTIME_EVIDENCE_CONTRACT = "conversation_intent_to_work_automation_approval_to_mail_work_intake_result";
const MAILOPS_APPROVAL_GATE_CONTRACT = "dry_run_receipt_connector_readiness_final_presence";
const MAILOPS_LIVE_READINESS_CONTRACT = "mail_calendar_read_only_live_report_contract";

export type HomeApprovalDecisionReceiptSource =
  | "mailops"
  | "local_file"
  | "folder_plan"
  | "repeat_work"
  | "local_file_pattern"
  | "final_confirmation"
  | "browser_task";

export type HomeApprovalDecisionReceiptStatus = "saved" | "review" | "blocked";

export type HomeApprovalDecisionReceipt = {
  id: string;
  sourceThreadId?: string;
  source: HomeApprovalDecisionReceiptSource;
  label: string;
  title: string;
  detail: string;
  workTitle: string;
  recordPath: string;
  executionLogLabel: string;
  undoLabel: string;
  nextStep: string;
  safetyGate: string;
  status: HomeApprovalDecisionReceiptStatus;
  proofChainContract: typeof HOME_APPROVAL_DECISION_PROOF_CHAIN_CONTRACT;
  sourceEvidenceContract: string;
  runtimeEvidenceContract: string;
  approvalGateContract: string;
  liveReadinessContract: string;
  memorySuggestionPolicy: typeof HOME_APPROVAL_DECISION_MEMORY_SUGGESTION_POLICY;
  externalMutation: false;
  createdAt: number;
};

type CreateHomeApprovalDecisionReceiptInput = {
  sourceThreadId?: string;
  source: HomeApprovalDecisionReceiptSource;
  message: string;
  workItem?: WorkItem | null;
  workTitle?: string;
  decision?: "approved" | "change_requested" | "held" | "draft" | "analyze" | "execute" | "review";
  sourceEvidenceContract?: string;
  runtimeEvidenceContract?: string;
  approvalGateContract?: string;
  liveReadinessContract?: string;
};

export function createHomeApprovalDecisionReceipt(
  input: CreateHomeApprovalDecisionReceiptInput,
): HomeApprovalDecisionReceipt {
  const title = clampReceiptText(input.message || "승인 결정을 기록했습니다.", 180);
  const isRevision = input.decision === "change_requested" || /수정 요청/u.test(title);
  const isHold = input.decision === "held" || /취소|보류/u.test(title);
  const needsReview = /오류|실패|먼저|연결|설치된 데스크톱 앱/u.test(title);
  const status: HomeApprovalDecisionReceiptStatus = isHold ? "blocked" : needsReview || isRevision ? "review" : "saved";
  const evidence = receiptEvidenceContracts(input.source, input);

  return {
    id: `${input.source}-${Date.now()}`,
    ...(input.sourceThreadId ? { sourceThreadId: input.sourceThreadId } : {}),
    source: input.source,
    label: receiptLabel(input.source, input.decision, title),
    title,
    detail: receiptDetail(input.source, title),
    workTitle: clampReceiptText(input.workTitle || input.workItem?.title || input.workItem?.sourceLabel || "최근 승인 후보", 80),
    recordPath: receiptRecordPath(input.source, title),
    executionLogLabel: receiptExecutionLogLabel(input.source, input.decision, title),
    undoLabel: receiptUndoLabel(input.source, input.decision, title),
    nextStep: receiptNextStep(input.source, input.decision, title),
    safetyGate: "외부 발송, 일정 등록, 파일 변경, 클릭은 최종 확인 전까지 잠금",
    status,
    ...evidence,
    createdAt: Date.now(),
  };
}

export function readHomeApprovalDecisionReceipt(): HomeApprovalDecisionReceipt | null {
  if (!canUseStorage()) return null;
  try {
    return normalizeHomeApprovalDecisionReceipt(
      JSON.parse(window.localStorage.getItem(HOME_APPROVAL_DECISION_RECEIPT_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return null;
  }
}

export function readHomeApprovalDecisionReceipts(): HomeApprovalDecisionReceipt[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HOME_APPROVAL_DECISION_RECEIPT_HISTORY_STORAGE_KEY) ?? "[]");
    const history = Array.isArray(parsed)
      ? parsed.map(normalizeHomeApprovalDecisionReceipt).filter((item): item is HomeApprovalDecisionReceipt => Boolean(item))
      : [];
    const latest = readHomeApprovalDecisionReceipt();
    return normalizeReceiptHistory(latest ? [latest, ...history] : history);
  } catch {
    const latest = readHomeApprovalDecisionReceipt();
    return latest ? [latest] : [];
  }
}

export function writeHomeApprovalDecisionReceipt(receipt: HomeApprovalDecisionReceipt): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(HOME_APPROVAL_DECISION_RECEIPT_STORAGE_KEY, JSON.stringify(receipt));
    const current = readHomeApprovalDecisionReceipts();
    const next = normalizeReceiptHistory([receipt, ...current]);
    window.localStorage.setItem(HOME_APPROVAL_DECISION_RECEIPT_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Restricted browser contexts can block localStorage. The office receipt still remains visible in-place.
  }
}

function normalizeReceiptHistory(receipts: HomeApprovalDecisionReceipt[]): HomeApprovalDecisionReceipt[] {
  const seen = new Set<string>();
  const normalized: HomeApprovalDecisionReceipt[] = [];
  for (const receipt of receipts) {
    const key = `${receipt.source}:${receipt.createdAt}:${receipt.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(receipt);
  }
  return normalized
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, HOME_APPROVAL_DECISION_RECEIPT_HISTORY_LIMIT);
}

function normalizeHomeApprovalDecisionReceipt(value: unknown): HomeApprovalDecisionReceipt | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as Partial<HomeApprovalDecisionReceipt>;
  if (!receipt.id || !receipt.title || !receipt.createdAt) return null;
  const source = normalizeReceiptSource(receipt.source);
  const evidence = receiptEvidenceContracts(source, receipt);
  return {
    id: String(receipt.id),
    ...(typeof receipt.sourceThreadId === "string" && receipt.sourceThreadId.trim() ? { sourceThreadId: receipt.sourceThreadId } : {}),
    source,
    label: clampReceiptText(receipt.label || "결정 기록", 40),
    title: clampReceiptText(receipt.title, 180),
    detail: clampReceiptText(receipt.detail || "앱 승인함에서 결정과 실행 경계를 확인했습니다.", 140),
    workTitle: clampReceiptText(receipt.workTitle || "최근 승인 후보", 80),
    recordPath: clampReceiptText(receipt.recordPath || "오피스 승인함 · 결정 기록", 120),
    executionLogLabel: clampReceiptText(
      receipt.executionLogLabel || receiptExecutionLogLabel(source, undefined, receipt.title),
      140,
    ),
    undoLabel: clampReceiptText(
      receipt.undoLabel || receiptUndoLabel(source, undefined, receipt.title),
      140,
    ),
    nextStep: clampReceiptText(receipt.nextStep || "오피스 승인함에서 계속 확인합니다.", 140),
    safetyGate: clampReceiptText(receipt.safetyGate || "최종 확인 전까지 외부 실행 잠금", 120),
    status: receipt.status === "blocked" || receipt.status === "review" ? receipt.status : "saved",
    ...evidence,
    createdAt: Number(receipt.createdAt) || Date.now(),
  };
}

/** Historical decisions remain in the approval history, without taking over unrelated conversations. */
export function isConversationApprovalReceipt(receipt: HomeApprovalDecisionReceipt | null, threadId: string, now = Date.now()) {
  return Boolean(receipt && threadId && receipt.sourceThreadId === threadId &&
    Number.isFinite(receipt.createdAt) && receipt.createdAt <= now && now - receipt.createdAt < 24 * 60 * 60 * 1000);
}

function receiptEvidenceContracts(
  source: HomeApprovalDecisionReceiptSource,
  input: Partial<CreateHomeApprovalDecisionReceiptInput> | Partial<HomeApprovalDecisionReceipt>,
): Pick<
  HomeApprovalDecisionReceipt,
  | "proofChainContract"
  | "sourceEvidenceContract"
  | "runtimeEvidenceContract"
  | "approvalGateContract"
  | "liveReadinessContract"
  | "memorySuggestionPolicy"
  | "externalMutation"
> {
  return {
    proofChainContract: HOME_APPROVAL_DECISION_PROOF_CHAIN_CONTRACT,
    sourceEvidenceContract: clampReceiptText(
      input.sourceEvidenceContract ||
        (source === "mailops" ? MAILOPS_APPROVAL_DECISION_SOURCE_EVIDENCE_CONTRACT : "home_approval_decision_receipt"),
      120,
    ),
    runtimeEvidenceContract: clampReceiptText(
      input.runtimeEvidenceContract ||
        (source === "mailops" ? MAILOPS_RUNTIME_EVIDENCE_CONTRACT : "home_approval_decision_receipt_runtime"),
      140,
    ),
    approvalGateContract: clampReceiptText(
      input.approvalGateContract ||
        (source === "mailops" ? MAILOPS_APPROVAL_GATE_CONTRACT : "external_mutation_requires_user_final_confirmation"),
      120,
    ),
    liveReadinessContract: clampReceiptText(
      input.liveReadinessContract || (source === "mailops" ? MAILOPS_LIVE_READINESS_CONTRACT : "local_decision_receipt_ready"),
      120,
    ),
    memorySuggestionPolicy: HOME_APPROVAL_DECISION_MEMORY_SUGGESTION_POLICY,
    externalMutation: false,
  };
}

function receiptLabel(
  source: HomeApprovalDecisionReceiptSource,
  decision: CreateHomeApprovalDecisionReceiptInput["decision"],
  message: string,
): string {
  if (decision === "change_requested" || /수정 요청|고쳐달라고/u.test(message)) return "고쳐달라고 하기";
  if (decision === "held" || /취소|보류/u.test(message)) return "보류하기";
  if (/오류|실패|먼저|연결|설치된 데스크톱 앱/u.test(message)) return "확인 필요";
  if (source === "local_file_pattern") return "방식 저장";
  if (source === "local_file" && decision === "draft") return "초안 준비";
  if (source === "local_file" && decision === "analyze") return "분석 완료";
  if (source === "final_confirmation") return "최종 확인";
  if (decision === "review") return "검토 기록";
  return "실행하기 기록";
}

function receiptDetail(source: HomeApprovalDecisionReceiptSource, message: string): string {
  if (/원본 파일/u.test(message)) return "원본 파일은 변경하지 않고 승인함 기록만 갱신했습니다.";
  if (source === "local_file") return "선택한 파일 범위 안에서 분석 또는 초안 후보만 처리했습니다.";
  if (source === "folder_plan") return "선택한 폴더 범위 안에서 정리 후보, 적용, 되돌리기 기록만 처리했습니다.";
  if (source === "repeat_work") return "반복 업무 점검 결과를 승인 후보로 확인하고, 실행 전 최종 확인 전까지 외부 실행을 잠급니다.";
  if (source === "local_file_pattern") return "다음 유사 요청에서 추천할 수 있는 업무 방식을 저장했습니다.";
  if (source === "final_confirmation") return "마지막 확인 상태를 앱 승인함에 남겼습니다.";
  if (source === "browser_task") return "화면 조작 후보는 증거와 최종 확인 전까지 실행하지 않습니다.";
  return "결정은 앱 승인함 기록에 남기고 외부 실행은 최종 확인 전까지 막습니다.";
}

function receiptRecordPath(source: HomeApprovalDecisionReceiptSource, message: string): string {
  if (source === "local_file") return "학습 초안 오피스 승인함 · 로컬 파일 작업 기록";
  if (source === "folder_plan") return "오피스 승인함 · 폴더 정리 적용/되돌리기 기록";
  if (source === "repeat_work") return "오피스 승인함 · 반복 업무 실행/보류/수정 기록";
  if (source === "local_file_pattern") return "memory/work-patterns/WorkPatternMemory.md";
  if (source === "final_confirmation") return "memory/audit/final-actions";
  if (source === "browser_task") return "내 PC 작업 도우미 감사 기록";
  if (/DecisionMemory|DecisionLog/u.test(message)) {
    return "memory/decisions/DecisionMemory.md · memory/crew-souls/*/DecisionLog.md";
  }
  return "오피스 승인함 · 결정 기록";
}

function receiptExecutionLogLabel(
  source: HomeApprovalDecisionReceiptSource,
  decision: CreateHomeApprovalDecisionReceiptInput["decision"],
  message: string,
): string {
  if (decision === "held" || /취소|보류/u.test(message)) return "보류하기 결정만 기록, 외부 실행 로그 없음";
  if (decision === "change_requested" || /수정 요청|고쳐달라고/u.test(message)) return "고쳐달라고 하기 기록, 실제 실행 로그 없음";
  if (source === "local_file") return "학습 초안 오피스 승인함 · 로컬 파일 작업 기록";
  if (source === "folder_plan") return "오피스 승인함 · 폴더 정리 적용/되돌리기 기록";
  if (source === "repeat_work") return "오피스 승인함 · 반복 업무 실행/보류/수정 기록";
  if (source === "local_file_pattern") return "업무 방식 기억 기록, 외부 실행 로그 없음";
  if (source === "final_confirmation") return "memory/audit/final-actions";
  if (source === "browser_task") return "내 PC 작업 도우미 감사 기록";
  return "오피스 승인함 · 결정 기록";
}

function receiptUndoLabel(
  source: HomeApprovalDecisionReceiptSource,
  decision: CreateHomeApprovalDecisionReceiptInput["decision"],
  message: string,
): string {
  if (decision === "held" || /취소|보류/u.test(message)) return "보류한 후보라 원본 변경 없음, 필요하면 새 후보 생성";
  if (decision === "change_requested" || /수정 요청|고쳐달라고/u.test(message)) return "고쳐달라고 하기는 외부 실행 없이 다시 작성으로 되돌림";
  if (source === "local_file") return "파일 저장/이동/삭제 전이라 원본 변경 없음";
  if (source === "folder_plan") return "실행 전 검토는 원본 변경 없음, 적용 뒤에는 정리 되돌리기 승인과 기록 파일 기준 확인";
  if (source === "repeat_work") return "실행 전이면 취소 가능, 실행 뒤에는 반복 업무 실행 로그와 감사 기록 기준 확인";
  if (source === "local_file_pattern") return "저장한 방식은 지난 업무 기억에서 수정 또는 삭제 가능";
  if (source === "final_confirmation") return "최종 실행 전이면 취소 가능, 실행 뒤에는 감사 기록 기준 확인";
  if (source === "browser_task") return "클릭/입력 전이면 변경 없음, 실행 뒤에는 감사 기록 기준 확인";
  return "발송/등록 전이면 취소 가능, 실행 뒤에는 서비스 기록과 감사 기록 기준 확인";
}

function receiptNextStep(
  source: HomeApprovalDecisionReceiptSource,
  decision: CreateHomeApprovalDecisionReceiptInput["decision"],
  message: string,
): string {
  if (decision === "change_requested" || /수정 요청|고쳐달라고/u.test(message)) return "담당 AI 팀원이 고친 초안을 다시 확인합니다.";
  if (decision === "held" || /취소|보류/u.test(message)) return "필요하면 자료를 다시 선택하거나 새 후보를 만듭니다.";
  if (/오류|실패|먼저|연결|설치된 데스크톱 앱/u.test(message)) return "오피스 승인함에서 연결 상태와 실행 전 검토를 다시 확인합니다.";
  if (source === "folder_plan") return "제외/충돌 기준을 확인한 뒤 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다.";
  if (source === "repeat_work") return "반복 업무 승인 후보에서 실행하기, 고쳐달라고 하기, 보류하기, 업무 기록 중 하나를 고릅니다.";
  if (source === "local_file_pattern") return "다음 요청에서 추천되면 이번 방식으로 적용합니다.";
  if (source === "local_file") return "초안 내용을 확인한 뒤 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다.";
  return "오피스 승인함에서 최종 확인과 실행 전 검토를 이어갑니다.";
}

function normalizeReceiptSource(value: unknown): HomeApprovalDecisionReceiptSource {
  return value === "local_file" ||
    value === "folder_plan" ||
    value === "repeat_work" ||
    value === "local_file_pattern" ||
    value === "final_confirmation" ||
    value === "browser_task"
    ? value
    : "mailops";
}

function clampReceiptText(value: unknown, maxLength: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}
