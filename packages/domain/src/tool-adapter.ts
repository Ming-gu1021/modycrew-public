import { ModyApprovalGate } from "./approval-gate.js";
import { ModyAuditLog } from "./audit-log.js";
import {
  createToolActionRequest,
  isExternalMutationKind,
  riskForPermission,
} from "./policy.js";
import { modyPolicyVersion } from "./types.js";
import type {
  ApprovalGateResult,
  ApprovalRecord,
  ModyAuditEntry,
  ToolActionRequest,
  ToolOperationKind,
  ToolPermissionLevel,
  ToolRiskLabel,
} from "./types.js";

export type ModyToolDefinition<Input> = {
  name: string;
  permissionLevel: ToolPermissionLevel;
  operationKind: ToolOperationKind;
  userVisibleDescription: string;
  expectedImpact: string;
  inputSchemaName?: string;
  riskLabel?: ToolRiskLabel;
  sourceAdapterId?: string;
  requiresApproval?: boolean;
  externalMutation?: boolean;
  summarizeInput?: (input: Input) => string;
};

export type ModyToolRunContext = {
  request: ToolActionRequest;
  gate: ApprovalGateResult;
};

export type ModyToolAdapter<Input = unknown, Output = unknown> = {
  definition: ModyToolDefinition<Input>;
  run: (input: Input, context: ModyToolRunContext) => Output | Promise<Output>;
};

export type ModyToolRunStatus = "completed" | "approval_required" | "blocked" | "failed";

export type ModyToolFailureKind =
  | "validation_error"
  | "permission_error"
  | "network_error"
  | "provider_error"
  | "unknown_error";

export type ModyToolFailure = {
  kind: ModyToolFailureKind;
  userMessage: string;
  retryable: boolean;
  technicalMessage?: string;
};

export class ModyToolUserFacingError extends Error {
  readonly failure: ModyToolFailure;

  constructor(failure: ModyToolFailure) {
    super(failure.technicalMessage ?? failure.userMessage);
    this.name = "ModyToolUserFacingError";
    this.failure = failure;
  }
}

export type ModyToolRunResult<Output = unknown> = {
  status: ModyToolRunStatus;
  request: ToolActionRequest;
  gate: ApprovalGateResult;
  userMessage: string;
  output?: Output;
  auditEntries: ModyAuditEntry[];
  failure?: ModyToolFailure;
  error?: unknown;
};

type RunOptions = {
  approval?: ApprovalRecord;
  requestId?: string;
  createdAt?: string;
};

type ModyToolDefinitionSafetyFields = {
  name: string;
  permissionLevel: ToolPermissionLevel;
  operationKind: ToolOperationKind;
  externalMutation?: boolean;
};

export class ModyToolAdapterRegistry {
  private readonly adapters = new Map<string, ModyToolAdapter<unknown, unknown>>();

  constructor(
    private readonly approvalGate = new ModyApprovalGate(),
    private readonly auditLog = new ModyAuditLog(),
  ) {}

  register<Input, Output>(adapter: ModyToolAdapter<Input, Output>): void {
    if (this.adapters.has(adapter.definition.name)) {
      throw new Error(`이미 등록된 도구입니다: ${adapter.definition.name}`);
    }

    this.assertSafeDefinition(adapter.definition);
    this.adapters.set(adapter.definition.name, adapter as ModyToolAdapter<unknown, unknown>);
  }

  createActionRequest<Input>(
    toolName: string,
    input: Input,
    options: Pick<RunOptions, "requestId" | "createdAt"> = {},
  ): ToolActionRequest {
    const adapter = this.getAdapter(toolName) as ModyToolAdapter<Input, unknown>;
    const definition = adapter.definition;
    const inputSummary = definition.summarizeInput?.(input) ?? summarizeUnknownInput(input);

    const requestInput: {
      id: string;
      toolName: string;
      permissionLevel: ToolPermissionLevel;
      operationKind: ToolOperationKind;
      inputSummary: string;
      expectedImpact: string;
      userVisibleDescription: string;
      createdAt: string;
      riskLabel: ToolRiskLabel;
      sourceAdapterId?: string;
      requiresApproval?: boolean;
      externalMutation?: boolean;
    } = {
      id: options.requestId ?? `${toolName}:${Date.now().toString(36)}`,
      toolName,
      permissionLevel: definition.permissionLevel,
      operationKind: definition.operationKind,
      inputSummary,
      expectedImpact: definition.expectedImpact,
      userVisibleDescription: definition.userVisibleDescription,
      createdAt: options.createdAt ?? new Date().toISOString(),
      riskLabel: definition.riskLabel ?? riskForPermission(definition.permissionLevel),
    };

    if (definition.sourceAdapterId) {
      requestInput.sourceAdapterId = definition.sourceAdapterId;
    }

    if (definition.requiresApproval !== undefined) {
      requestInput.requiresApproval = definition.requiresApproval;
    }

    if (definition.externalMutation !== undefined) {
      requestInput.externalMutation = definition.externalMutation;
    }

    return createToolActionRequest(requestInput);
  }

  async run<Input, Output = unknown>(
    toolName: string,
    input: Input,
    options: RunOptions = {},
  ): Promise<ModyToolRunResult<Output>> {
    const adapter = this.getAdapter(toolName) as ModyToolAdapter<Input, Output>;
    const request = this.createActionRequest(toolName, input, options);
    const gate = this.approvalGate.evaluate(request, options.approval);
    const auditEntries: ModyAuditEntry[] = [
      this.auditLog.record({
        actor: "agent",
        eventType: "tool_requested",
        requestId: request.id,
        message: request.userVisibleDescription,
        policyVersion: modyPolicyVersion,
        operationKind: request.operationKind,
        riskLabel: request.riskLabel,
        metadata: {
          toolName,
          permissionLevel: request.permissionLevel,
          requiresApproval: request.requiresApproval,
          externalMutation: request.externalMutation,
        },
      }),
    ];

    if (options.approval) {
      auditEntries.push(
        this.auditLog.record({
          actor: "user",
          eventType: "approval_decided",
          requestId: request.id,
          message: formatApprovalDecisionMessage(request, options.approval),
          policyVersion: modyPolicyVersion,
          operationKind: request.operationKind,
          riskLabel: request.riskLabel,
          metadata: {
            approvalId: options.approval.id,
            approvalRequestId: options.approval.requestId,
            decision: options.approval.decision,
            decidedBy: options.approval.decidedBy,
            decidedAt: options.approval.decidedAt,
          },
        }),
      );
    }

    if (!gate.canRunTool) {
      auditEntries.push(
        this.auditLog.record({
          actor: "system",
          eventType: gate.status === "blocked" ? "tool_blocked" : "approval_required",
          requestId: request.id,
          message: gate.auditMessage,
          policyVersion: modyPolicyVersion,
          operationKind: request.operationKind,
          riskLabel: request.riskLabel,
          metadata: {
            status: gate.status,
            permissionLevel: request.permissionLevel,
            requiresApproval: request.requiresApproval,
            externalMutation: request.externalMutation,
          },
        }),
      );

      return {
        status: gate.status === "blocked" ? "blocked" : "approval_required",
        request,
        gate,
        userMessage: gate.userMessage,
        auditEntries,
      };
    }

    if (request.externalMutation && !gate.canMutateExternalSystem) {
      const userMessage = "외부 시스템을 바꾸는 도구는 사용자 승인 확인 없이는 실행하지 않습니다.";
      auditEntries.push(
        this.auditLog.record({
          actor: "system",
          eventType: "tool_blocked",
          requestId: request.id,
          message: userMessage,
          policyVersion: modyPolicyVersion,
          operationKind: request.operationKind,
          riskLabel: request.riskLabel,
          metadata: {
            status: "blocked",
            reason: "external_mutation_without_mutation_permission",
            permissionLevel: request.permissionLevel,
            gateStatus: gate.status,
          },
        }),
      );

      return {
        status: "blocked",
        request,
        gate,
        userMessage,
        auditEntries,
      };
    }

    try {
      const output = await adapter.run(input, { request, gate });
      const userMessage = `${request.userVisibleDescription} 완료했습니다.`;
      auditEntries.push(
        this.auditLog.record({
          actor: "tool",
          eventType: "tool_completed",
          requestId: request.id,
          message: userMessage,
          policyVersion: modyPolicyVersion,
          operationKind: request.operationKind,
          riskLabel: request.riskLabel,
        }),
      );

      return {
        status: "completed",
        request,
        gate,
        userMessage,
        output,
        auditEntries,
      };
    } catch (error) {
      const failure = toToolFailure(error, request);
      auditEntries.push(
        this.auditLog.record({
          actor: "tool",
          eventType: "tool_failed",
          requestId: request.id,
          message: failure.userMessage,
          policyVersion: modyPolicyVersion,
          operationKind: request.operationKind,
          riskLabel: request.riskLabel,
          metadata: {
            failureKind: failure.kind,
            retryable: failure.retryable,
          },
        }),
      );

      return {
        status: "failed",
        request,
        gate,
        userMessage: failure.userMessage,
        auditEntries,
        failure,
        error,
      };
    }
  }

  listToolNames(): string[] {
    return [...this.adapters.keys()];
  }

  getAuditEntries(): ModyAuditEntry[] {
    return this.auditLog.list();
  }

  private getAdapter(toolName: string): ModyToolAdapter<unknown, unknown> {
    const adapter = this.adapters.get(toolName);
    if (!adapter) {
      throw new Error(`등록되지 않은 도구입니다: ${toolName}`);
    }

    return adapter;
  }

  private assertSafeDefinition(definition: ModyToolDefinitionSafetyFields): void {
    const mutatesExternalSystem =
      definition.externalMutation === true ||
      isExternalMutationKind(definition.operationKind);

    if (!mutatesExternalSystem) return;

    if (
      definition.permissionLevel === "read" ||
      definition.permissionLevel === "analyze" ||
      definition.permissionLevel === "draft" ||
      definition.permissionLevel === "stage"
    ) {
      throw new Error(
        `외부 시스템 변경 도구는 승인형 실행 권한으로만 등록할 수 있습니다: ${definition.name}`,
      );
    }
  }
}

function summarizeUnknownInput(input: unknown): string {
  if (typeof input === "string") return input.slice(0, 160);

  try {
    return JSON.stringify(input).slice(0, 160);
  } catch {
    return "입력 요약을 만들 수 없습니다.";
  }
}

function formatApprovalDecisionMessage(request: ToolActionRequest, approval: ApprovalRecord): string {
  if (approval.requestId !== request.id) {
    return "승인 기록이 현재 작업과 맞지 않아 다시 확인해야 합니다.";
  }

  if (approval.decision === "approved") {
    return `${request.toolName} 실행을 사용자가 승인했습니다.`;
  }

  if (approval.decision === "rejected") {
    return `${request.toolName} 실행을 사용자가 거절했습니다.`;
  }

  if (approval.decision === "change_requested") {
    return `${request.toolName} 작업에 대해 사용자가 수정을 요청했습니다.`;
  }

  if (approval.decision === "held") {
    return `${request.toolName} 작업을 사용자가 보류했습니다.`;
  }

  if (approval.decision === "expired") {
    return `${request.toolName} 작업의 승인 기록이 만료 상태입니다.`;
  }

  return `${request.toolName} 작업은 추가 확인이 필요합니다.`;
}

function toToolFailure(error: unknown, request: ToolActionRequest): ModyToolFailure {
  if (error instanceof ModyToolUserFacingError) {
    return error.failure;
  }

  const technicalMessage = technicalMessageFrom(error);
  const kind = inferFailureKind(technicalMessage);
  const retryable = kind === "network_error" || kind === "provider_error" || kind === "unknown_error";
  const failureInput: {
    kind: ModyToolFailureKind;
    retryable: boolean;
    userMessage: string;
    technicalMessage?: string;
  } = {
    kind,
    retryable,
    userMessage: defaultFailureMessageFor(request, kind),
  };

  if (technicalMessage) {
    failureInput.technicalMessage = technicalMessage;
  }

  return createToolFailure(failureInput);
}

function createToolFailure(input: {
  kind: ModyToolFailureKind;
  userMessage: string;
  retryable: boolean;
  technicalMessage?: string;
}): ModyToolFailure {
  const failure: ModyToolFailure = {
    kind: input.kind,
    userMessage: input.userMessage,
    retryable: input.retryable,
  };

  if (input.technicalMessage) {
    failure.technicalMessage = input.technicalMessage;
  }

  return failure;
}

function technicalMessageFrom(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return undefined;
}

function inferFailureKind(technicalMessage: string | undefined): ModyToolFailureKind {
  const message = technicalMessage?.toLowerCase() ?? "";

  if (/validation|invalid|required|schema|필수|형식/.test(message)) return "validation_error";
  if (/auth|permission|forbidden|unauthorized|권한|인증/.test(message)) return "permission_error";
  if (/timeout|network|fetch|econn|etimedout|연결|네트워크/.test(message)) return "network_error";
  if (/provider|smtp|calendar|drive|api|service|서비스/.test(message)) return "provider_error";

  return "unknown_error";
}

function defaultFailureMessageFor(
  request: ToolActionRequest,
  kind: ModyToolFailureKind,
): string {
  const taskLabel = userTaskLabelFor(request);

  if (kind === "validation_error") {
    return `${taskLabel}에 필요한 입력이 부족하거나 형식이 맞지 않아 완료하지 못했습니다. 내용을 확인한 뒤 다시 요청해야 합니다.`;
  }

  if (kind === "permission_error") {
    return `${taskLabel}에 필요한 계정 권한이나 연결 승인이 없어 완료하지 못했습니다. 연결 상태와 승인 범위를 확인해야 합니다.`;
  }

  if (kind === "network_error") {
    return `${taskLabel} 처리 중 외부 서비스 연결이 불안정해 완료 여부를 확인하지 못했습니다. 잠시 후 다시 시도해야 합니다.`;
  }

  if (kind === "provider_error") {
    return `${taskLabel}을 처리하는 외부 서비스에서 문제가 발생해 완료하지 못했습니다. 승인 기록과 서비스 상태를 확인해야 합니다.`;
  }

  return `${taskLabel}을 완료하지 못했습니다. 업무 내용은 유지한 채 원인을 확인한 뒤 다시 시도해야 합니다.`;
}

function userTaskLabelFor(request: ToolActionRequest): string {
  if (request.operationKind === "send_email") return "메일 발송";
  if (request.operationKind === "send_sms_message") return "문자 발송";
  if (request.operationKind === "create_calendar_event") return "일정 등록";
  if (request.operationKind === "share_file") return "파일 공유";
  if (request.operationKind === "repair_connector") return "연결 수리";
  if (request.operationKind === "draft_reply") return "답장 초안 작성";
  if (request.operationKind === "draft_calendar_event") return "일정 후보 초안 작성";
  if (request.operationKind === "read_data") return "업무 원문 읽기";
  if (request.operationKind === "analyze_data") return "업무 내용 분석";
  if (request.operationKind === "update_internal_context") return "업무 정보 업데이트";
  if (request.operationKind === "stage_approval") return "승인 대기 등록";
  return request.userVisibleDescription.replace(/[.。]\s*$/, "");
}
