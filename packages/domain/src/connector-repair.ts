import { ModyAuditLog } from "./audit-log.js";
import { createToolActionRequest } from "./policy.js";
import type {
  ISODateTimeString,
  ModyAuditEntry,
  ToolActionRequest,
  ToolRiskLabel,
} from "./types.js";
import type {
  ModyConnectorHealthIssue,
  ModyConnectorHealthReport,
  ModyConnectorRepairActionKind,
} from "./connector-health.js";

export type ModyConnectorRepairTicketStatus =
  | "pending_user_confirmation"
  | "confirmed"
  | "held"
  | "cancelled";

export type ModyConnectorRepairDecision =
  | "confirmed"
  | "held"
  | "cancelled";

export const modyConnectorRepairActions = [
  "connect",
  "grant_permissions",
  "reconnect",
  "rotate_secret",
  "run_health_check",
  "change_scope",
  "view_policy",
] as const satisfies readonly ModyConnectorRepairActionKind[];

export type ModyConnectorRepairTicket = {
  id: string;
  issueId: string;
  connectorId: string;
  connectorName: string;
  repairAction: ModyConnectorRepairActionKind;
  status: ModyConnectorRepairTicketStatus;
  confirmationRequired: true;
  canRunRepairAutomatically: false;
  blocksAutomation: boolean;
  actionRequest: ToolActionRequest;
  userMessage: string;
  createdAt: ISODateTimeString;
  decidedAt?: ISODateTimeString;
  decidedBy?: string;
};

export type ModyConnectorRepairTicketResult = {
  tickets: ModyConnectorRepairTicket[];
  auditEntries: ModyAuditEntry[];
};

export type ModyConnectorRepairDecisionResult = {
  ticket: ModyConnectorRepairTicket;
  auditEntries: ModyAuditEntry[];
  userMessage: string;
};

export class ModyConnectorRepairCenter {
  readonly #auditLog: ModyAuditLog;
  readonly #now: () => Date;

  constructor(options: {
    auditLog?: ModyAuditLog;
    now?: () => Date;
  } = {}) {
    this.#auditLog = options.auditLog ?? (options.now ? new ModyAuditLog(options.now) : new ModyAuditLog());
    this.#now = options.now ?? (() => new Date());
  }

  createRepairTickets(
    report: ModyConnectorHealthReport,
    createdAt = this.#now().toISOString(),
  ): ModyConnectorRepairTicketResult {
    const ticketableIssues = report.issues.filter((issue) => (
      issue.blocksAutomation ||
      issue.severity === "critical" ||
      issue.severity === "action_required"
    ));
    const tickets = ticketableIssues.map((issue) => this.#createTicket(issue, createdAt));
    const auditEntries = tickets.map((ticket) => this.#auditLog.record({
      requestId: ticket.actionRequest.id,
      actor: "system",
      eventType: "approval_required",
      message: `${ticket.connectorName} 수리 확인 카드가 생성되었습니다.`,
      createdAt,
      operationKind: ticket.actionRequest.operationKind,
      riskLabel: ticket.actionRequest.riskLabel,
      metadata: {
        connectorId: ticket.connectorId,
        issueId: ticket.issueId,
        repairAction: ticket.repairAction,
        canRunRepairAutomatically: ticket.canRunRepairAutomatically,
      },
    }));

    return { tickets, auditEntries };
  }

  recordDecision(
    ticket: ModyConnectorRepairTicket,
    decision: ModyConnectorRepairDecision,
    decidedBy: string,
    decidedAt = this.#now().toISOString(),
  ): ModyConnectorRepairDecisionResult {
    const updatedTicket: ModyConnectorRepairTicket = {
      ...ticket,
      status: decision,
      decidedAt,
      decidedBy,
    };
    const auditEntries = [
      this.#auditLog.record({
        requestId: ticket.actionRequest.id,
        actor: "user",
        eventType: "approval_decided",
        message: `${ticket.connectorName} 수리 요청을 ${decisionLabel(decision)} 상태로 기록했습니다.`,
        createdAt: decidedAt,
        operationKind: ticket.actionRequest.operationKind,
        riskLabel: ticket.actionRequest.riskLabel,
        metadata: {
          connectorId: ticket.connectorId,
          issueId: ticket.issueId,
          repairAction: ticket.repairAction,
          decision,
          canRunRepairAutomatically: false,
        },
      }),
    ];

    return {
      ticket: updatedTicket,
      auditEntries,
      userMessage: decision === "confirmed"
        ? "수리 확인은 기록되었지만 실제 재연결, credential 회전, 권한 변경은 별도 사용자 확인 화면 전까지 실행하지 않습니다."
        : "수리 요청을 실행하지 않고 상태만 기록했습니다.",
    };
  }

  #createTicket(
    issue: ModyConnectorHealthIssue,
    createdAt: ISODateTimeString,
  ): ModyConnectorRepairTicket {
    const riskLabel = riskLabelFor(issue);
    const actionRequest = createToolActionRequest({
      id: `repair_${sanitizeId(issue.id)}`,
      toolName: `mody.connector.repair.${issue.repairAction}`,
      permissionLevel: "stage",
      operationKind: "stage_approval",
      inputSummary: `${issue.connectorName} ${issue.repairLabel}`,
      expectedImpact: "실제 재연결, credential 회전, 권한 변경 없이 사용자 확인 카드만 만듭니다.",
      userVisibleDescription: `${issue.connectorName} 연결 수리 확인`,
      riskLabel,
      externalMutation: false,
      createdAt,
      sourceAdapterId: "connector-repair-center",
      metadata: {
        connectorId: issue.connectorId,
        issueId: issue.id,
        repairAction: issue.repairAction,
        blocksAutomation: issue.blocksAutomation,
      },
    });

    return {
      id: `ticket_${sanitizeId(issue.id)}`,
      issueId: issue.id,
      connectorId: issue.connectorId,
      connectorName: issue.connectorName,
      repairAction: issue.repairAction,
      status: "pending_user_confirmation",
      confirmationRequired: true,
      canRunRepairAutomatically: false,
      blocksAutomation: issue.blocksAutomation,
      actionRequest,
      userMessage: `${issue.message} 실제 수리는 사용자 확인 전 실행하지 않습니다.`,
      createdAt,
    };
  }
}

function riskLabelFor(issue: ModyConnectorHealthIssue): ToolRiskLabel {
  if (issue.severity === "critical") return "high";
  if (issue.severity === "action_required" || issue.severity === "warning") return "medium";
  return "low";
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function decisionLabel(decision: ModyConnectorRepairDecision): string {
  if (decision === "confirmed") return "확인";
  if (decision === "held") return "보류";
  return "취소";
}
