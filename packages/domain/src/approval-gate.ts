import {
  isMvpBlockedOperationKind,
  isExternalMutationRequest,
  shouldRequireApproval,
} from "./policy.js";
import type {
  ApprovalGateResult,
  ApprovalRecord,
  ToolActionRequest,
} from "./types.js";

type ApprovalGateOptions = {
  now?: () => Date;
};

export class ModyApprovalGate {
  readonly now: () => Date;

  constructor(options: ApprovalGateOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  evaluate(request: ToolActionRequest, approval?: ApprovalRecord): ApprovalGateResult {
    const normalizedRequest = {
      ...request,
      requiresApproval: request.requiresApproval || shouldRequireApproval(request),
    };

    if (
      normalizedRequest.permissionLevel === "dangerous_execute" ||
      normalizedRequest.permissionLevel === "blocked" ||
      isMvpBlockedOperationKind(normalizedRequest.operationKind)
    ) {
      return {
        request: normalizedRequest,
        status: "blocked",
        canRunTool: false,
        canMutateExternalSystem: false,
        requiresApproval: true,
        userMessage: "세무, 계약, 공공기관, 금전, 민감정보 같은 고위험 실행은 MVP에서 실행할 수 없습니다.",
        auditMessage: `${normalizedRequest.toolName} 요청이 승인 정책에 의해 차단되었습니다.`,
      };
    }

    if (approval) {
      return this.evaluateDecision(normalizedRequest, approval);
    }

    if (normalizedRequest.requiresApproval || isExternalMutationRequest(normalizedRequest)) {
      return {
        request: normalizedRequest,
        status: "approval_required",
        canRunTool: false,
        canMutateExternalSystem: false,
        requiresApproval: true,
        userMessage: "외부 발송, 일정 등록, 파일 공유 같은 실행은 사용자 승인 전까지 대기합니다.",
        auditMessage: `${normalizedRequest.toolName} 실행이 사용자 승인 대기 상태가 되었습니다.`,
      };
    }

    if (normalizedRequest.permissionLevel === "stage") {
      return {
        request: normalizedRequest,
        status: "stage_only",
        canRunTool: true,
        canMutateExternalSystem: false,
        requiresApproval: false,
        userMessage: "승인 대기 작업을 만들 수 있지만 외부 시스템은 변경하지 않습니다.",
        auditMessage: `${normalizedRequest.toolName} 승인 대기 준비 작업이 허용되었습니다.`,
      };
    }

    return {
      request: normalizedRequest,
      status: "auto_allowed",
      canRunTool: true,
      canMutateExternalSystem: false,
      requiresApproval: false,
      userMessage: "읽기, 분석, 초안 작성은 자동으로 처리할 수 있습니다.",
      auditMessage: `${normalizedRequest.toolName} 작업이 자동 허용되었습니다.`,
    };
  }

  private evaluateDecision(request: ToolActionRequest, approval: ApprovalRecord): ApprovalGateResult {
    if (approval.requestId !== request.id) {
      return {
        request,
        status: "needs_more_context",
        canRunTool: false,
        canMutateExternalSystem: false,
        requiresApproval: true,
        userMessage: "승인 기록이 현재 작업과 맞지 않아 다시 확인해야 합니다.",
        auditMessage: `${request.toolName} 승인 기록이 요청 ID와 맞지 않았습니다.`,
      };
    }

    if (approval.decision === "expired" || this.isExpired(approval)) {
      return {
        request,
        status: "expired",
        canRunTool: false,
        canMutateExternalSystem: false,
        requiresApproval: true,
        userMessage: "승인 유효 시간이 지나 다시 확인해야 합니다.",
        auditMessage: `${request.toolName} 승인이 만료되었습니다.`,
      };
    }

    if (approval.decision === "approved") {
      return {
        request,
        status: "approved_for_execution",
        canRunTool: true,
        canMutateExternalSystem: isExternalMutationRequest(request),
        requiresApproval: true,
        userMessage: "사용자 승인으로 실행할 수 있습니다.",
        auditMessage: `${request.toolName} 작업이 사용자 승인 후 실행 가능 상태가 되었습니다.`,
      };
    }

    if (approval.decision === "rejected") {
      return {
        request,
        status: "rejected",
        canRunTool: false,
        canMutateExternalSystem: false,
        requiresApproval: true,
        userMessage: "사용자가 이 실행을 거절했습니다.",
        auditMessage: `${request.toolName} 작업이 사용자에 의해 거절되었습니다.`,
      };
    }

    return {
      request,
      status: "needs_more_context",
      canRunTool: false,
      canMutateExternalSystem: false,
      requiresApproval: true,
      userMessage: "수정 요청, 보류, 추가 확인 상태라 아직 실행하지 않습니다.",
      auditMessage: `${request.toolName} 작업이 추가 확인 상태로 남았습니다.`,
    };
  }

  private isExpired(approval: ApprovalRecord): boolean {
    if (!approval.expiresAt) return false;
    return new Date(approval.expiresAt).getTime() <= this.now().getTime();
  }
}
