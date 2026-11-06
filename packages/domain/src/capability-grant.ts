/**
 * AI 직원이 어떤 연결과 자료에 어디까지 접근할 수 있는지 표현하는 중앙 권한 계약.
 *
 * 이 파일은 UI의 "연결됨" 표시를 신뢰하지 않습니다. Agent Blueprint와 실제 런타임은
 * 같은 요청 튜플을 만들고, 이 게이트의 fail-closed 판정을 통과한 범위만 사용해야 합니다.
 * 비밀정보 원문은 이 계약에 들어오지 않으며 채팅 입력도 허용하지 않습니다.
 */

export const modyCapabilityGrantPolicyVersion = "modycrew.capability-grant.v2" as const;

export type ModyCapabilityRiskLevel =
  | "l0_discovery"
  | "l1_scoped_read"
  | "l2_isolated_draft"
  | "l3_reversible_change"
  | "l4_external_commit"
  | "l5_never_auto";

export type ModyCapabilityAction =
  | "discover_connection"
  | "read_selected_data"
  | "analyze_selected_data"
  | "create_internal_draft"
  | "prepare_connection"
  | "install_catalog_tool"
  | "stage_external_change"
  | "execute_external_change"
  | "high_risk_execution";

export type ModyCapabilityDataClass =
  | "metadata"
  | "business_content"
  | "personal_data"
  | "financial"
  | "contract"
  | "credential_reference"
  | "public_submission"
  | "payment";

export type ModyCapabilityGrantDuration = "single_run" | "session" | "until_revoked";

export type ModyCatalogToolInstallMode = "bundled" | "portable_user_space" | "project_local";

export type ModyCapabilityResourceScope =
  | {
      kind: "selected_sources";
      resourceIds: string[];
      recursive: false;
    }
  | {
      kind: "connector";
      connectorId: string;
    }
  | {
      kind: "catalog_tool";
      catalogToolId: string;
      installMode: ModyCatalogToolInstallMode;
    }
  | {
      kind: "workspace";
      workspaceId: string;
    };

export type ModyUserOnlyActionKind =
  | "account_authorization"
  | "two_factor_auth"
  | "admin_consent"
  | "os_permission"
  | "credential_capture"
  | "license_or_payment";

export type ModyCapabilityGrantConstraints = {
  selectedScopeOnly: boolean;
  externalMutation: boolean;
  dryRunRequired: boolean;
  finalUserPresenceRequired: boolean;
  approvalMode: "none" | "once" | "per_action" | "never";
  secretEntryAllowedInChat: false;
  catalogToolOnly?: boolean;
  reversible?: boolean;
  undoRequired?: boolean;
  maxItems?: number;
  requestFingerprint?: string;
  userOnlyActionKind?: ModyUserOnlyActionKind;
};

export type ModyCapabilityGrantRequest = {
  grantId: string;
  agentId: string;
  connectorId: string;
  capabilityId: string;
  action: ModyCapabilityAction;
  riskLevel: ModyCapabilityRiskLevel;
  resourceScope: ModyCapabilityResourceScope;
  dataClass: ModyCapabilityDataClass;
  duration: ModyCapabilityGrantDuration;
  constraints: ModyCapabilityGrantConstraints;
  issuedAt: string;
  expiresAt?: string;
};

export type ModyCapabilityGrantStatus =
  | "app_handled"
  | "user_action_required"
  | "approval_required"
  | "blocked";

export type ModyCapabilityGrantDecision = {
  policyVersion: typeof modyCapabilityGrantPolicyVersion;
  request: ModyCapabilityGrantRequest;
  status: ModyCapabilityGrantStatus;
  handledBy: "app" | "user";
  canPrepare: boolean;
  canExecute: boolean;
  requiresApproval: boolean;
  userOnlyActionKind?: ModyUserOnlyActionKind;
  reason: string;
};

const appHandledRiskLevels = new Set<ModyCapabilityRiskLevel>([
  "l0_discovery",
  "l1_scoped_read",
  "l2_isolated_draft",
]);

const safeAppActions = new Set<ModyCapabilityAction>([
  "discover_connection",
  "read_selected_data",
  "analyze_selected_data",
  "create_internal_draft",
  "stage_external_change",
]);

export class ModyCapabilityGrantGate {
  evaluate(request: ModyCapabilityGrantRequest): ModyCapabilityGrantDecision {
    const invalidReason = validateGrantRequest(request);
    if (invalidReason) return blockedDecision(request, invalidReason);

    if (isExpired(request)) {
      return blockedDecision(request, "권한 요청의 유효 시간이 지나 다시 확인해야 합니다.");
    }

    if (request.riskLevel === "l5_never_auto" || request.action === "high_risk_execution") {
      return blockedDecision(request, "결제·공공 제출·법적 실행 같은 고위험 작업은 자동 권한을 발급하지 않습니다.");
    }

    if (request.dataClass === "payment" || request.dataClass === "public_submission") {
      return blockedDecision(request, "금전 또는 공공 제출 데이터는 이 자동 권한 계약으로 실행할 수 없습니다.");
    }

    if (request.action === "install_catalog_tool") {
      if (
        request.resourceScope.kind !== "catalog_tool" ||
        request.constraints.catalogToolOnly !== true ||
        request.constraints.externalMutation
      ) {
        return blockedDecision(request, "등록된 카탈로그와 사용자 영역 설치 범위를 벗어난 도구 설치 요청입니다.");
      }
      if (
        !request.constraints.finalUserPresenceRequired ||
        request.constraints.approvalMode !== "once" ||
        request.duration !== "single_run" ||
        !request.constraints.requestFingerprint
      ) {
        return blockedDecision(request, "업무 도구 다운로드는 출처·권한·설치 범위를 확인한 1회 사용자 승인이 필요합니다.");
      }
      return {
        policyVersion: modyCapabilityGrantPolicyVersion,
        request,
        status: "approval_required",
        handledBy: "user",
        canPrepare: true,
        canExecute: false,
        requiresApproval: true,
        reason: "등록된 업무 도구라도 다운로드 전에 출처, 요청 권한, 설치 이유를 사용자가 확인해야 합니다.",
      };
    }

    if (request.action === "prepare_connection") {
      if (request.constraints.finalUserPresenceRequired) {
        return {
          policyVersion: modyCapabilityGrantPolicyVersion,
          request,
          status: "user_action_required",
          handledBy: "user",
          canPrepare: true,
          canExecute: false,
          requiresApproval: false,
          userOnlyActionKind: request.constraints.userOnlyActionKind ?? "account_authorization",
          reason: "앱이 연결 방법과 상태 확인을 준비하고, 로그인·동의처럼 본인만 가능한 단계에서만 요청합니다.",
        };
      }
      return appHandledDecision(request, "기존 연결 탐색과 읽기 전용 상태 확인을 앱이 처리할 수 있습니다.");
    }

    if (request.action === "execute_external_change" || request.riskLevel === "l4_external_commit") {
      if (
        !request.constraints.externalMutation ||
        !request.constraints.finalUserPresenceRequired ||
        request.constraints.approvalMode !== "per_action" ||
        request.duration !== "single_run" ||
        !request.constraints.requestFingerprint
      ) {
        return blockedDecision(request, "외부 실행은 정확한 1회 요청 지문과 최종 사용자 승인이 모두 필요합니다.");
      }
      return {
        policyVersion: modyCapabilityGrantPolicyVersion,
        request,
        status: "approval_required",
        handledBy: "user",
        canPrepare: true,
        canExecute: false,
        requiresApproval: true,
        reason: "외부 발송·등록·공유는 내용이 확정된 1회 요청마다 사용자가 승인해야 합니다.",
      };
    }

    if (request.riskLevel === "l3_reversible_change") {
      if (
        request.constraints.externalMutation ||
        request.constraints.reversible !== true ||
        request.constraints.undoRequired !== true
      ) {
        return blockedDecision(request, "되돌리기 증명이 없는 변경은 앱이 자동 처리하지 않습니다.");
      }
      return appHandledDecision(request, "범위가 제한되고 되돌릴 수 있는 내부 변경만 앱이 준비합니다.");
    }

    if (safeAppActions.has(request.action) && appHandledRiskLevels.has(request.riskLevel)) {
      if (request.constraints.externalMutation) {
        return blockedDecision(request, "읽기·분석·초안 권한으로 외부 시스템을 변경할 수 없습니다.");
      }
      return appHandledDecision(request, "선택한 범위의 읽기·분석·초안 작업을 앱이 처리합니다.");
    }

    return blockedDecision(request, "정의되지 않은 권한 조합이라 안전하게 차단했습니다.");
  }
}

function appHandledDecision(
  request: ModyCapabilityGrantRequest,
  reason: string,
): ModyCapabilityGrantDecision {
  return {
    policyVersion: modyCapabilityGrantPolicyVersion,
    request,
    status: "app_handled",
    handledBy: "app",
    canPrepare: true,
    canExecute: true,
    requiresApproval: false,
    reason,
  };
}

function blockedDecision(
  request: ModyCapabilityGrantRequest,
  reason: string,
): ModyCapabilityGrantDecision {
  return {
    policyVersion: modyCapabilityGrantPolicyVersion,
    request,
    status: "blocked",
    handledBy: "user",
    canPrepare: false,
    canExecute: false,
    requiresApproval: true,
    reason,
  };
}

function validateGrantRequest(request: ModyCapabilityGrantRequest): string | undefined {
  if (!request || typeof request !== "object") return "권한 요청 형식이 올바르지 않습니다.";
  if (!request.grantId?.trim() || !request.agentId?.trim() || !request.connectorId?.trim()) {
    return "권한 요청의 직원·연결 식별자가 비어 있습니다.";
  }
  if (!request.capabilityId?.trim() || !request.issuedAt?.trim()) {
    return "권한 요청의 기능 또는 발급 시각이 비어 있습니다.";
  }
  if (!request.constraints || request.constraints.secretEntryAllowedInChat !== false) {
    return "비밀정보를 채팅으로 받으려는 권한 요청은 허용하지 않습니다.";
  }
  if (request.constraints.maxItems !== undefined) {
    if (!Number.isInteger(request.constraints.maxItems) || request.constraints.maxItems < 1 || request.constraints.maxItems > 1_000) {
      return "권한 요청의 처리 개수 범위가 올바르지 않습니다.";
    }
  }
  if (request.resourceScope.kind === "selected_sources") {
    if (!request.constraints.selectedScopeOnly || request.resourceScope.recursive !== false) {
      return "사용자가 고른 자료 범위를 벗어나는 재귀 접근은 허용하지 않습니다.";
    }
    if (request.resourceScope.resourceIds.length === 0 || request.resourceScope.resourceIds.some((id) => !id.trim())) {
      return "선택 자료 권한에는 하나 이상의 안전한 자료 ID가 필요합니다.";
    }
  }
  if (
    request.resourceScope.kind === "connector" &&
    request.resourceScope.connectorId !== request.connectorId
  ) {
    return "권한 요청의 연결 범위와 대상 연결이 일치하지 않습니다.";
  }
  return undefined;
}

function isExpired(request: ModyCapabilityGrantRequest): boolean {
  if (!request.expiresAt) return false;
  const expiresAt = Date.parse(request.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}
