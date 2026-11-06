"use client";

export type ApprovalEngineWorkKind =
  | "mailops"
  | "schedule"
  | "repeat_work"
  | "document_draft"
  | "folder_tidy"
  | "computer_use";

export type ApprovalEngineUserChoice = "execute" | "request_changes" | "hold";

export type ApprovalEngineFinalExecutionGate = {
  gateContract: "dry_run_receipt_connector_readiness_final_presence";
  label: "실행 전 검토 -> 연결 준비 -> 사용자 최종 확인";
  dryRunRequired: true;
  dryRunReceiptRequired: true;
  connectorReadinessRequired: true;
  finalUserPresenceRequired: true;
  confirmPhraseRequired: "최종 실행 확인";
  providerDispatchBlockedUntilReady: true;
  externalMutationBeforeGate: false;
  externalMutationOnDryRun: false;
};

export type ApprovalEngineContract = {
  workKind: ApprovalEngineWorkKind;
  label: string;
  approvalQueueLabel: "오피스 승인함";
  finalGateLabel: "최종 확인";
  finalExecutionGate: ApprovalEngineFinalExecutionGate;
  userChoices: Array<{
    id: ApprovalEngineUserChoice;
    label: string;
    detail: string;
  }>;
  allowedBeforeApproval: string[];
  lockedBeforeApproval: string[];
  approvalBoundary: string;
  executionLogLabel: string;
  recoveryLabel: string;
  externalMutationBeforeApproval: false;
  finalUserConfirmationRequired: true;
  fakeExecutionBlocked: true;
};

export const APPROVAL_ENGINE_FINAL_BOUNDARY =
  "외부 발송, 일정 등록, 파일 변경, 공유, 삭제는 오피스 승인함의 최종 확인 전까지 실행하지 않습니다.";

export const APPROVAL_ENGINE_MAILOPS_WORK_QUEUE_HANDOFF =
  "mailops_work_queue_decision_to_final_execution_gate";

export const APPROVAL_ENGINE_USER_CHOICES = [
  {
    id: "execute",
    label: "실행하기",
    detail: "후보와 권한을 다시 확인한 뒤 최종 확인에서만 실행합니다.",
  },
  {
    id: "request_changes",
    label: "고쳐달라고 하기",
    detail: "외부 실행 없이 초안이나 후보만 다시 만듭니다.",
  },
  {
    id: "hold",
    label: "보류하기",
    detail: "후보를 멈추고 필요하면 나중에 다시 이어갑니다.",
  },
] satisfies ApprovalEngineContract["userChoices"];

export const APPROVAL_ENGINE_FINAL_EXECUTION_GATE = {
  gateContract: "dry_run_receipt_connector_readiness_final_presence",
  label: "실행 전 검토 -> 연결 준비 -> 사용자 최종 확인",
  dryRunRequired: true,
  dryRunReceiptRequired: true,
  connectorReadinessRequired: true,
  finalUserPresenceRequired: true,
  confirmPhraseRequired: "최종 실행 확인",
  providerDispatchBlockedUntilReady: true,
  externalMutationBeforeGate: false,
  externalMutationOnDryRun: false,
} satisfies ApprovalEngineFinalExecutionGate;

export function createApprovalEngineContract(input: {
  workKind: ApprovalEngineWorkKind;
  label?: string;
  executionLogLabel?: string;
  missingConnectionLabels?: string[];
}): ApprovalEngineContract {
  const label = input.label ?? defaultApprovalLabel(input.workKind);
  const missingConnectionLabels = input.missingConnectionLabels?.filter(Boolean) ?? [];

  return {
    workKind: input.workKind,
    label,
    approvalQueueLabel: "오피스 승인함",
    finalGateLabel: "최종 확인",
    finalExecutionGate: { ...APPROVAL_ENGINE_FINAL_EXECUTION_GATE },
    userChoices: [...APPROVAL_ENGINE_USER_CHOICES],
    allowedBeforeApproval: allowedBeforeApproval(input.workKind),
    lockedBeforeApproval: lockedBeforeApproval(input.workKind),
    approvalBoundary: APPROVAL_ENGINE_FINAL_BOUNDARY,
    executionLogLabel: input.executionLogLabel ?? defaultExecutionLogLabel(input.workKind),
    recoveryLabel: missingConnectionLabels.length
      ? `막힌 이유: ${missingConnectionLabels.join(", ")} 연결 필요 -> 해결 버튼 -> 다시 이어가기`
      : "막히면 이유를 보여주고 해결 버튼 뒤 같은 후보로 다시 이어갑니다.",
    externalMutationBeforeApproval: false,
    finalUserConfirmationRequired: true,
    fakeExecutionBlocked: true,
  };
}

export function formatApprovalEngineLines(contract: ApprovalEngineContract) {
  return [
    `승인 계약: ${contract.approvalQueueLabel} -> ${contract.finalGateLabel}`,
    `사용자 선택: ${contract.userChoices.map((choice) => choice.label).join(" / ")}`,
    `최종 실행 게이트: ${contract.finalExecutionGate.label}`,
    `최종 실행 계약: ${contract.finalExecutionGate.gateContract}`,
    `필수 조건: dry-run 영수증, 연결 준비, 사용자 현장 확인, "${contract.finalExecutionGate.confirmPhraseRequired}" 문구`,
    contract.approvalBoundary,
    `잠금: ${contract.lockedBeforeApproval.join(", ")}`,
    `허용: ${contract.allowedBeforeApproval.join(", ")}`,
    contract.executionLogLabel,
    contract.recoveryLabel,
  ];
}

export function createApprovalEngineWorkflowItems(contract: ApprovalEngineContract) {
  return [
    `${contract.approvalQueueLabel}: ${contract.userChoices.map((choice) => choice.label).join(" / ")}`,
    ...(contract.workKind === "mailops" ? [`업무대장 결정: ${APPROVAL_ENGINE_MAILOPS_WORK_QUEUE_HANDOFF}`] : []),
    `최종 실행 계약: ${contract.finalExecutionGate.gateContract}`,
    `실행 전 검토: dry-run 영수증과 외부 변경 없음 확인`,
    `연결 준비: provider 연결이 준비되기 전 실제 발송/등록/공유 차단`,
    `${contract.finalGateLabel}: 사용자가 마지막으로 확인`,
    `승인 전 잠금: ${contract.lockedBeforeApproval.join(", ")}`,
    `승인 전 허용: ${contract.allowedBeforeApproval.join(", ")}`,
    contract.executionLogLabel,
  ];
}

function defaultApprovalLabel(workKind: ApprovalEngineWorkKind) {
  if (workKind === "mailops") return "메일/문의 승인";
  if (workKind === "schedule") return "일정 승인";
  if (workKind === "repeat_work") return "반복 업무 승인";
  if (workKind === "document_draft") return "문서 초안 승인";
  if (workKind === "folder_tidy") return "폴더 정리 승인";
  return "내 PC 작업 승인";
}

function defaultExecutionLogLabel(workKind: ApprovalEngineWorkKind) {
  if (workKind === "mailops") return "메일 읽기, 답장 초안, 업무대장 결정, 일정 후보, 승인 결정을 실행 로그에 남깁니다.";
  if (workKind === "schedule") return "가능 시간 후보, 등록 전 확인, 승인 결정을 실행 로그에 남깁니다.";
  if (workKind === "repeat_work") return "반복 점검, 승인 후보, 실행 여부를 실행 로그에 남깁니다.";
  if (workKind === "document_draft") return "자료 범위, 초안 후보, 저장/공유 승인 여부를 실행 로그에 남깁니다.";
  if (workKind === "folder_tidy") return "정리 계획, 제외 항목, 적용/되돌리기 결정을 실행 로그에 남깁니다.";
  return "화면 증거, 작업 후보, 최종 확인 여부를 실행 로그에 남깁니다.";
}

function allowedBeforeApproval(workKind: ApprovalEngineWorkKind) {
  if (workKind === "mailops") return ["읽기 전용 확인", "답장 초안", "업무대장 검토", "수정본/메모 저장", "작성 메일 점검", "일정 후보"];
  if (workKind === "schedule") return ["가능 시간 확인", "일정 후보", "초대 문구 초안"];
  if (workKind === "repeat_work") return ["기본 꺼짐 저장", "점검 후보", "승인 후보"];
  if (workKind === "document_draft") return ["자료 읽기", "문서 초안", "저장 후보"];
  if (workKind === "folder_tidy") return ["폴더 읽기", "정리 계획", "변경 전 미리보기"];
  return ["화면/파일 읽기", "작업 계획", "실행 전 미리보기"];
}

function lockedBeforeApproval(workKind: ApprovalEngineWorkKind) {
  if (workKind === "mailops") return ["메일 발송", "일정 등록", "메일 이동/삭제", "외부 공유"];
  if (workKind === "schedule") return ["캘린더 등록", "초대 발송", "외부 공유"];
  if (workKind === "repeat_work") return ["자동 실행", "외부 발송", "파일 변경", "일정 등록"];
  if (workKind === "document_draft") return ["파일 저장", "외부 공유", "제출"];
  if (workKind === "folder_tidy") return ["파일 이동", "파일 삭제", "이름 변경"];
  return ["클릭", "입력", "제출", "파일 변경"];
}
