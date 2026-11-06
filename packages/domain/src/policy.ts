import type {
  ISODateTimeString,
  ToolActionRequest,
  ToolOperationKind,
  ToolPermissionLevel,
  ToolRiskLabel,
} from "./types.js";

const externalMutationKinds = new Set<ToolOperationKind>([
  "send_email",
  "send_sms_message",
  "create_calendar_event",
  "share_file",
  "submit_public_agency",
  "tax_or_contract_execution",
  "process_payment_or_refund",
  "send_sensitive_personal_data",
  "other_external_mutation",
  "repair_connector",
]);

const mvpBlockedOperationKinds = new Set<ToolOperationKind>([
  "submit_public_agency",
  "tax_or_contract_execution",
  "process_payment_or_refund",
  "send_sensitive_personal_data",
]);

export function isExternalMutationKind(operationKind: ToolOperationKind): boolean {
  return externalMutationKinds.has(operationKind);
}

export function isMvpBlockedOperationKind(operationKind: ToolOperationKind): boolean {
  return mvpBlockedOperationKinds.has(operationKind);
}

export function isExternalMutationRequest(request: Pick<ToolActionRequest, "operationKind" | "externalMutation">): boolean {
  return request.externalMutation || isExternalMutationKind(request.operationKind);
}

export function requiresApprovalForPermission(permissionLevel: ToolPermissionLevel): boolean {
  return (
    permissionLevel === "execute" ||
    permissionLevel === "dangerous_execute" ||
    permissionLevel === "blocked"
  );
}

export function shouldRequireApproval(
  request: Pick<ToolActionRequest, "permissionLevel" | "operationKind" | "externalMutation">,
): boolean {
  return requiresApprovalForPermission(request.permissionLevel) || isExternalMutationRequest(request);
}

export function riskForPermission(permissionLevel: ToolPermissionLevel): ToolRiskLabel {
  if (permissionLevel === "dangerous_execute") return "high";
  if (permissionLevel === "blocked") return "blocked";
  if (permissionLevel === "execute") return "high";
  if (permissionLevel === "stage") return "medium";
  return "low";
}

export function riskForOperationKind(operationKind: ToolOperationKind): ToolRiskLabel {
  if (isMvpBlockedOperationKind(operationKind)) return "high";
  if (isExternalMutationKind(operationKind)) return "high";
  if (operationKind === "stage_approval") return "medium";
  return "low";
}

export function highestRiskLabel(labels: readonly ToolRiskLabel[]): ToolRiskLabel {
  if (labels.includes("blocked")) return "blocked";
  if (labels.includes("high")) return "high";
  if (labels.includes("medium")) return "medium";
  return "low";
}

export function riskForActionRequest(
  request: Pick<ToolActionRequest, "permissionLevel" | "operationKind" | "externalMutation">,
): ToolRiskLabel {
  return highestRiskLabel([
    riskForPermission(request.permissionLevel),
    riskForOperationKind(request.operationKind),
    request.externalMutation ? "high" : "low",
  ]);
}

type CreateToolActionRequestInput = {
  id: string;
  toolName: string;
  permissionLevel: ToolPermissionLevel;
  operationKind: ToolOperationKind;
  inputSummary: string;
  expectedImpact: string;
  userVisibleDescription: string;
  createdAt: ISODateTimeString;
  sourceAdapterId?: string;
  requiresApproval?: boolean;
  externalMutation?: boolean;
  riskLabel?: ToolRiskLabel;
  approvalTargetActionId?: string;
  metadata?: Record<string, unknown>;
};

export function createToolActionRequest(input: CreateToolActionRequestInput): ToolActionRequest {
  const externalMutation = input.externalMutation ?? isExternalMutationKind(input.operationKind);
  const requiresApproval =
    input.requiresApproval ??
    shouldRequireApproval({
      permissionLevel: input.permissionLevel,
      operationKind: input.operationKind,
      externalMutation,
    });

  const request: ToolActionRequest = {
    id: input.id,
    toolName: input.toolName,
    permissionLevel: input.permissionLevel,
    operationKind: input.operationKind,
    inputSummary: input.inputSummary,
    expectedImpact: input.expectedImpact,
    requiresApproval,
    externalMutation,
    riskLabel: highestRiskLabel([
      input.riskLabel ?? "low",
      riskForActionRequest({
        permissionLevel: input.permissionLevel,
        operationKind: input.operationKind,
        externalMutation,
      }),
    ]),
    userVisibleDescription: input.userVisibleDescription,
    createdAt: input.createdAt,
  };

  if (input.sourceAdapterId) {
    request.sourceAdapterId = input.sourceAdapterId;
  }

  if (input.approvalTargetActionId) {
    request.approvalTargetActionId = input.approvalTargetActionId;
  }

  if (input.metadata) {
    request.metadata = input.metadata;
  }

  return request;
}
