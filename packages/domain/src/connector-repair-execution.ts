import { ModyApprovalGate } from "./approval-gate.js";
import { ModyAuditLog } from "./audit-log.js";
import { createToolActionRequest } from "./policy.js";
import { modyPolicyVersion } from "./types.js";
import type {
  ApprovalRecord,
  ApprovalGateResult,
  ISODateTimeString,
  ModyAuditEntry,
  ToolActionRequest,
  ToolRiskLabel,
} from "./types.js";
import type { ModyConnectorRepairTicket } from "./connector-repair.js";
import type { ModyConnectorRepairActionKind } from "./connector-health.js";

export type ModyConnectorRepairExecutionStatus =
  | "blocked_until_ticket_confirmed"
  | "needs_final_user_approval";

export type ModyConnectorRepairExecutionSurface =
  | "provider_oauth"
  | "credential_store"
  | "os_permission"
  | "settings_scope"
  | "health_read"
  | "policy_review";

export type ModyConnectorRepairExecutionPlan = {
  id: string;
  ticketId: string;
  connectorId: string;
  connectorName: string;
  repairAction: ModyConnectorRepairActionKind;
  status: "needs_final_user_approval";
  finalConfirmationRequired: true;
  canRunWithoutFinalApproval: false;
  requiresUserPresence: true;
  executionSurface: ModyConnectorRepairExecutionSurface;
  actionRequest: ToolActionRequest;
  gate: ApprovalGateResult;
  userMessage: string;
  createdAt: ISODateTimeString;
};

export type ModyConnectorRepairExecutionResult = {
  status: ModyConnectorRepairExecutionStatus;
  auditEntries: ModyAuditEntry[];
  userMessage: string;
  plan?: ModyConnectorRepairExecutionPlan;
};

export type ModyConnectorRepairRuntimeStatus =
  | "approval_required"
  | "blocked"
  | "adapter_missing"
  | "completed"
  | "failed";

export type ModyConnectorRepairAdapterInput = {
  plan: ModyConnectorRepairExecutionPlan;
  approval: ApprovalRecord;
};

export type ModyConnectorRepairAdapterOutput = {
  status: "completed";
  userMessage: string;
  providerMutationConfirmed: boolean;
  metadata?: Record<string, unknown>;
};

export type ModyConnectorRepairAdapter = {
  repairAction: ModyConnectorRepairActionKind;
  executionSurface: ModyConnectorRepairExecutionSurface;
  run: (
    input: ModyConnectorRepairAdapterInput,
  ) => ModyConnectorRepairAdapterOutput | Promise<ModyConnectorRepairAdapterOutput>;
};

export type ModyConnectorRepairRuntimeResult = {
  status: ModyConnectorRepairRuntimeStatus;
  plan: ModyConnectorRepairExecutionPlan;
  gate: ApprovalGateResult;
  auditEntries: ModyAuditEntry[];
  userMessage: string;
  output?: ModyConnectorRepairAdapterOutput;
  error?: unknown;
};

export class ModyConnectorRepairExecutionPlanner {
  readonly #auditLog: ModyAuditLog;
  readonly #approvalGate: ModyApprovalGate;
  readonly #now: () => Date;

  constructor(options: {
    auditLog?: ModyAuditLog;
    approvalGate?: ModyApprovalGate;
    now?: () => Date;
  } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#auditLog = options.auditLog ?? (options.now ? new ModyAuditLog(options.now) : new ModyAuditLog());
    this.#approvalGate = options.approvalGate ?? new ModyApprovalGate({ now: this.#now });
  }

  createExecutionPlan(
    ticket: ModyConnectorRepairTicket,
    createdAt = this.#now().toISOString(),
  ): ModyConnectorRepairExecutionResult {
    if (ticket.status !== "confirmed") {
      const auditEntries = [
        this.#auditLog.record({
          requestId: ticket.actionRequest.id,
          actor: "system",
          eventType: "tool_blocked",
          message: `${ticket.connectorName} 수리 실행은 확인된 티켓이 아니어서 차단되었습니다.`,
          createdAt,
          policyVersion: modyPolicyVersion,
          operationKind: ticket.actionRequest.operationKind,
          riskLabel: ticket.actionRequest.riskLabel,
          metadata: {
            ticketId: ticket.id,
            connectorId: ticket.connectorId,
            repairAction: ticket.repairAction,
            ticketStatus: ticket.status,
            reason: "ticket_not_confirmed",
          },
        }),
      ];

      return {
        status: "blocked_until_ticket_confirmed",
        auditEntries,
        userMessage: "수리 실행은 확인된 티켓에서만 최종 승인 요청으로 만들 수 있습니다.",
      };
    }

    const executionSurface = executionSurfaceFor(ticket.repairAction);
    const actionRequest = createToolActionRequest({
      id: `execute_${sanitizeId(ticket.id)}`,
      toolName: `mody.connector.repair.execute.${ticket.repairAction}`,
      permissionLevel: "execute",
      operationKind: "repair_connector",
      inputSummary: `${ticket.connectorName} ${executionLabelFor(ticket.repairAction)}`,
      expectedImpact: expectedImpactFor(ticket.repairAction),
      userVisibleDescription: `${ticket.connectorName} 연결 수리 최종 확인`,
      riskLabel: riskLabelFor(ticket.repairAction),
      requiresApproval: true,
      externalMutation: true,
      createdAt,
      sourceAdapterId: "connector-repair-execution-planner",
      approvalTargetActionId: ticket.actionRequest.id,
      metadata: {
        ticketId: ticket.id,
        connectorId: ticket.connectorId,
        repairAction: ticket.repairAction,
        executionSurface,
        finalConfirmationRequired: true,
        canRunWithoutFinalApproval: false,
        requiresUserPresence: true,
      },
    });
    const gate = this.#approvalGate.evaluate(actionRequest);
    const plan: ModyConnectorRepairExecutionPlan = {
      id: `repair_execution_${sanitizeId(ticket.id)}`,
      ticketId: ticket.id,
      connectorId: ticket.connectorId,
      connectorName: ticket.connectorName,
      repairAction: ticket.repairAction,
      status: "needs_final_user_approval",
      finalConfirmationRequired: true,
      canRunWithoutFinalApproval: false,
      requiresUserPresence: true,
      executionSurface,
      actionRequest,
      gate,
      userMessage: "실제 연결 수리는 최종 사용자 승인 전까지 실행하지 않습니다.",
      createdAt,
    };
    const auditEntries = [
      this.#auditLog.record({
        requestId: actionRequest.id,
        actor: "system",
        eventType: "tool_requested",
        message: `${ticket.connectorName} 실제 수리 실행 계획이 생성되었습니다.`,
        createdAt,
        policyVersion: modyPolicyVersion,
        operationKind: actionRequest.operationKind,
        riskLabel: actionRequest.riskLabel,
        metadata: {
          ticketId: ticket.id,
          connectorId: ticket.connectorId,
          repairAction: ticket.repairAction,
          executionSurface,
        },
      }),
      this.#auditLog.record({
        requestId: actionRequest.id,
        actor: "system",
        eventType: "approval_required",
        message: "실제 provider 재연결, credential 회전, 권한 변경은 최종 사용자 승인 전까지 실행하지 않습니다.",
        createdAt,
        policyVersion: modyPolicyVersion,
        operationKind: actionRequest.operationKind,
        riskLabel: actionRequest.riskLabel,
        metadata: {
          gateStatus: gate.status,
          finalConfirmationRequired: true,
          canRunWithoutFinalApproval: false,
          requiresUserPresence: true,
        },
      }),
    ];

    return {
      status: "needs_final_user_approval",
      plan,
      auditEntries,
      userMessage: plan.userMessage,
    };
  }
}

export class ModyConnectorRepairRuntime {
  readonly #auditLog: ModyAuditLog;
  readonly #approvalGate: ModyApprovalGate;
  readonly #now: () => Date;
  readonly #adapters = new Map<string, ModyConnectorRepairAdapter>();

  constructor(options: {
    auditLog?: ModyAuditLog;
    approvalGate?: ModyApprovalGate;
    now?: () => Date;
  } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#auditLog = options.auditLog ?? (options.now ? new ModyAuditLog(options.now) : new ModyAuditLog());
    this.#approvalGate = options.approvalGate ?? new ModyApprovalGate({ now: this.#now });
  }

  registerAdapter(adapter: ModyConnectorRepairAdapter): void {
    const key = adapterKey(adapter.repairAction, adapter.executionSurface);
    if (this.#adapters.has(key)) {
      throw new Error(`이미 등록된 연결 수리 adapter입니다: ${key}`);
    }

    this.#adapters.set(key, adapter);
  }

  async run(
    plan: ModyConnectorRepairExecutionPlan,
    options: {
      approval?: ApprovalRecord;
      executedAt?: ISODateTimeString;
    } = {},
  ): Promise<ModyConnectorRepairRuntimeResult> {
    const executedAt = options.executedAt ?? this.#now().toISOString();
    const invalidReason = invalidPlanReason(plan);
    const gate = this.#approvalGate.evaluate(plan.actionRequest, options.approval);

    if (invalidReason) {
      return {
        status: "blocked",
        plan,
        gate,
        auditEntries: [
          this.#auditLog.record({
            requestId: plan.actionRequest.id,
            actor: "system",
            eventType: "tool_blocked",
            message: "연결 수리 실행 계획이 안전 계약과 맞지 않아 차단되었습니다.",
            createdAt: executedAt,
            policyVersion: modyPolicyVersion,
            operationKind: plan.actionRequest.operationKind,
            riskLabel: plan.actionRequest.riskLabel,
            metadata: {
              planId: plan.id,
              ticketId: plan.ticketId,
              connectorId: plan.connectorId,
              repairAction: plan.repairAction,
              reason: invalidReason,
            },
          }),
        ],
        userMessage: "연결 수리 실행 계획이 안전 계약과 맞지 않아 실행하지 않았습니다.",
      };
    }

    if (
      !options.approval ||
      gate.status !== "approved_for_execution" ||
      !gate.canRunTool ||
      !gate.canMutateExternalSystem
    ) {
      const status = gate.status === "blocked" ? "blocked" : "approval_required";
      return {
        status,
        plan,
        gate,
        auditEntries: [
          this.#auditLog.record({
            requestId: plan.actionRequest.id,
            actor: "system",
            eventType: status === "blocked" ? "tool_blocked" : "approval_required",
            message: gate.auditMessage,
            createdAt: executedAt,
            policyVersion: modyPolicyVersion,
            operationKind: plan.actionRequest.operationKind,
            riskLabel: plan.actionRequest.riskLabel,
            metadata: {
              planId: plan.id,
              ticketId: plan.ticketId,
              connectorId: plan.connectorId,
              repairAction: plan.repairAction,
              gateStatus: gate.status,
              adapterSkippedWithoutApproval: true,
            },
          }),
        ],
        userMessage: gate.userMessage,
      };
    }

    const adapter = this.#adapters.get(adapterKey(plan.repairAction, plan.executionSurface));
    if (!adapter) {
      return {
        status: "adapter_missing",
        plan,
        gate,
        auditEntries: [
          this.#auditLog.record({
            requestId: plan.actionRequest.id,
            actor: "system",
            eventType: "tool_failed",
            message: `${plan.connectorName} 수리 adapter가 등록되지 않아 실행하지 않았습니다.`,
            createdAt: executedAt,
            policyVersion: modyPolicyVersion,
            operationKind: plan.actionRequest.operationKind,
            riskLabel: plan.actionRequest.riskLabel,
            metadata: {
              planId: plan.id,
              ticketId: plan.ticketId,
              connectorId: plan.connectorId,
              repairAction: plan.repairAction,
              executionSurface: plan.executionSurface,
              reason: "adapter_missing",
            },
          }),
        ],
        userMessage: "이 연결 수리를 처리할 adapter가 아직 등록되지 않았습니다.",
      };
    }

    try {
      const output = await adapter.run({
        plan,
        approval: options.approval,
      });

      return {
        status: "completed",
        plan,
        gate,
        output,
        auditEntries: [
          this.#auditLog.record({
            requestId: plan.actionRequest.id,
            actor: "tool",
            eventType: "tool_completed",
            message: output.userMessage,
            createdAt: executedAt,
            policyVersion: modyPolicyVersion,
            operationKind: plan.actionRequest.operationKind,
            riskLabel: plan.actionRequest.riskLabel,
            metadata: {
              planId: plan.id,
              ticketId: plan.ticketId,
              connectorId: plan.connectorId,
              repairAction: plan.repairAction,
              executionSurface: plan.executionSurface,
              providerMutationConfirmed: output.providerMutationConfirmed,
              adapterResultMetadata: output.metadata ?? {},
            },
          }),
        ],
        userMessage: output.userMessage,
      };
    } catch (error) {
      return {
        status: "failed",
        plan,
        gate,
        auditEntries: [
          this.#auditLog.record({
            requestId: plan.actionRequest.id,
            actor: "tool",
            eventType: "tool_failed",
            message: `${plan.connectorName} 수리 adapter 실행 중 오류가 발생했습니다.`,
            createdAt: executedAt,
            policyVersion: modyPolicyVersion,
            operationKind: plan.actionRequest.operationKind,
            riskLabel: plan.actionRequest.riskLabel,
            metadata: {
              planId: plan.id,
              ticketId: plan.ticketId,
              connectorId: plan.connectorId,
              repairAction: plan.repairAction,
              executionSurface: plan.executionSurface,
              technicalMessage: technicalMessageFrom(error),
            },
          }),
        ],
        userMessage: "연결 수리를 완료하지 못했습니다. 승인 기록과 adapter 상태를 확인해야 합니다.",
        error,
      };
    }
  }
}

function executionSurfaceFor(repairAction: ModyConnectorRepairActionKind): ModyConnectorRepairExecutionSurface {
  if (repairAction === "connect" || repairAction === "reconnect") return "provider_oauth";
  if (repairAction === "rotate_secret") return "credential_store";
  if (repairAction === "grant_permissions") return "os_permission";
  if (repairAction === "change_scope") return "settings_scope";
  if (repairAction === "run_health_check") return "health_read";
  return "policy_review";
}

function executionLabelFor(repairAction: ModyConnectorRepairActionKind): string {
  if (repairAction === "connect") return "연결";
  if (repairAction === "reconnect") return "재연결";
  if (repairAction === "rotate_secret") return "credential 회전";
  if (repairAction === "grant_permissions") return "권한 허용";
  if (repairAction === "change_scope") return "자동화 범위 변경";
  if (repairAction === "run_health_check") return "상태 재점검";
  return "정책 확인";
}

function expectedImpactFor(repairAction: ModyConnectorRepairActionKind): string {
  if (repairAction === "run_health_check") {
    return "외부 상태를 다시 읽을 수 있지만 connector 설정이나 provider 권한은 변경하지 않습니다.";
  }

  if (repairAction === "view_policy") {
    return "정책 확인 화면을 열 수 있지만 token, secret, provider 설정은 변경하지 않습니다.";
  }

  return "provider 재동의, credential 회전, OS 권한 또는 자동화 범위가 바뀔 수 있으므로 최종 사용자 승인이 필요합니다.";
}

function riskLabelFor(repairAction: ModyConnectorRepairActionKind): ToolRiskLabel {
  if (repairAction === "run_health_check" || repairAction === "view_policy") return "medium";
  return "high";
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function adapterKey(
  repairAction: ModyConnectorRepairActionKind,
  executionSurface: ModyConnectorRepairExecutionSurface,
): string {
  return `${repairAction}:${executionSurface}`;
}

function invalidPlanReason(plan: ModyConnectorRepairExecutionPlan): string | undefined {
  if (plan.status !== "needs_final_user_approval") return "status_not_final_approval";
  if (!plan.finalConfirmationRequired) return "final_confirmation_not_required";
  if (plan.canRunWithoutFinalApproval) return "can_run_without_final_approval";
  if (!plan.requiresUserPresence) return "user_presence_not_required";
  if (plan.actionRequest.operationKind !== "repair_connector") return "operation_kind_not_repair_connector";
  if (plan.actionRequest.permissionLevel !== "execute") return "permission_level_not_execute";
  if (!plan.actionRequest.externalMutation) return "external_mutation_not_declared";
  if (!plan.actionRequest.requiresApproval) return "approval_not_required";
  return undefined;
}

function technicalMessageFrom(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return undefined;
}
