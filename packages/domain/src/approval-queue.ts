import { ModyApprovalGate } from "./approval-gate.js";
import { ModyAuditLog } from "./audit-log.js";
import { modyPolicyVersion } from "./types.js";
import type {
  ApprovalDecision,
  ApprovalGateResult,
  ApprovalRecord,
  ISODateTimeString,
  ModyChannelId,
  ModyAuditEntry,
  ToolActionRequest,
  ToolRiskLabel,
} from "./types.js";

export type ModyApprovalQueueSourceKind =
  | "work_item"
  | "connector_repair"
  | "desktop_bridge"
  | "channel_command"
  | "manual_console";

export type ModyApprovalQueueItemStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "change_requested"
  | "held"
  | "app_reconfirm_required"
  | "expired"
  | "blocked";

export type ModyApprovalQueueEnqueueStatus =
  | "queued"
  | "duplicate"
  | "blocked"
  | "not_queueable";

export type ModyApprovalQueueDecisionStatus =
  | "recorded"
  | "not_found"
  | "already_decided"
  | "app_reconfirm_required"
  | "expired"
  | "blocked";

export type ModyApprovalQueueDecisionSource =
  | "app"
  | "channel";

export type ModyApprovalQueueChannelDecision = {
  decision: ApprovalDecision;
  decidedBy: string;
  decidedAt: ISODateTimeString;
  requiresAppReconfirm: true;
  channelId?: ModyChannelId;
};

export type ModyApprovalQueueItem = {
  id: string;
  request: ToolActionRequest;
  sourceKind: ModyApprovalQueueSourceKind;
  sourceId?: string;
  title: string;
  summary: string;
  status: ModyApprovalQueueItemStatus;
  gate: ApprovalGateResult;
  riskLabel: ToolRiskLabel;
  operationKind: ToolActionRequest["operationKind"];
  appFinalConfirmationRequired: true;
  canExecuteFromChannel: false;
  createdAt: ISODateTimeString;
  expiresAt?: ISODateTimeString;
  decision?: ApprovalRecord;
  channelDecision?: ModyApprovalQueueChannelDecision;
};

export type ModyApprovalQueueEnqueueResult = {
  status: ModyApprovalQueueEnqueueStatus;
  auditEntries: ModyAuditEntry[];
  userMessage: string;
  item?: ModyApprovalQueueItem;
};

export type ModyApprovalQueueDecisionResult = {
  status: ModyApprovalQueueDecisionStatus;
  auditEntries: ModyAuditEntry[];
  userMessage: string;
  item?: ModyApprovalQueueItem;
  approval?: ApprovalRecord;
};

export class ModyApprovalQueue {
  readonly #approvalGate: ModyApprovalGate;
  readonly #auditLog: ModyAuditLog;
  readonly #now: () => Date;
  readonly #items = new Map<string, ModyApprovalQueueItem>();

  constructor(options: {
    approvalGate?: ModyApprovalGate;
    auditLog?: ModyAuditLog;
    now?: () => Date;
  } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#approvalGate = options.approvalGate ?? new ModyApprovalGate({ now: this.#now });
    this.#auditLog = options.auditLog ?? (options.now ? new ModyAuditLog(options.now) : new ModyAuditLog());
  }

  enqueue(
    request: ToolActionRequest,
    options: {
      sourceKind: ModyApprovalQueueSourceKind;
      sourceId?: string;
      title?: string;
      summary?: string;
      expiresAt?: ISODateTimeString;
      createdAt?: ISODateTimeString;
    },
  ): ModyApprovalQueueEnqueueResult {
    const existing = this.#items.get(request.id);
    if (existing) {
      return {
        status: "duplicate",
        item: existing,
        auditEntries: [],
        userMessage: "이미 승인함에 등록된 요청입니다.",
      };
    }

    const createdAt = options.createdAt ?? this.#now().toISOString();
    const gate = this.#approvalGate.evaluate(request);

    if (gate.status !== "approval_required" && gate.status !== "blocked") {
      return {
        status: "not_queueable",
        auditEntries: [],
        userMessage: "자동 허용 또는 stage 작업은 승인함에 등록하지 않습니다.",
      };
    }

    const itemInput: {
      id: string;
      request: ToolActionRequest;
      sourceKind: ModyApprovalQueueSourceKind;
      sourceId?: string;
      title: string;
      summary: string;
      status: ModyApprovalQueueItemStatus;
      gate: ApprovalGateResult;
      riskLabel: ToolRiskLabel;
      operationKind: ToolActionRequest["operationKind"];
      appFinalConfirmationRequired: true;
      canExecuteFromChannel: false;
      createdAt: ISODateTimeString;
      expiresAt?: ISODateTimeString;
    } = {
      id: `approval_item_${sanitizeId(request.id)}`,
      request,
      sourceKind: options.sourceKind,
      title: options.title ?? request.userVisibleDescription,
      summary: options.summary ?? request.expectedImpact,
      status: gate.status === "blocked" ? "blocked" : "pending",
      gate,
      riskLabel: request.riskLabel,
      operationKind: request.operationKind,
      appFinalConfirmationRequired: true,
      canExecuteFromChannel: false,
      createdAt,
    };

    if (options.sourceId) {
      itemInput.sourceId = options.sourceId;
    }

    if (options.expiresAt) {
      itemInput.expiresAt = options.expiresAt;
    }

    const item = itemInput;
    this.#items.set(request.id, item);

    const eventType = item.status === "blocked" ? "tool_blocked" : "approval_required";
    const auditEntries = [
      this.#auditLog.record({
        requestId: request.id,
        actor: "system",
        eventType,
        message: item.status === "blocked"
          ? `${item.title} 요청은 승인함에 표시되지만 실행은 차단되었습니다.`
          : `${item.title} 요청이 승인함에 등록되었습니다.`,
        createdAt,
        policyVersion: modyPolicyVersion,
        operationKind: request.operationKind,
        riskLabel: request.riskLabel,
        metadata: {
          queueItemId: item.id,
          sourceKind: item.sourceKind,
          sourceId: item.sourceId,
          appFinalConfirmationRequired: true,
          canExecuteFromChannel: false,
          gateStatus: gate.status,
        },
      }),
    ];

    return {
      status: item.status === "blocked" ? "blocked" : "queued",
      item,
      auditEntries,
      userMessage: item.status === "blocked"
        ? "차단된 요청을 승인함에 표시했지만 실행할 수 없습니다."
        : "승인함에 최종 확인 요청을 등록했습니다.",
    };
  }

  recordDecision(
    requestId: string,
    decision: ApprovalDecision,
    decidedBy: string,
    options: {
      decidedAt?: ISODateTimeString;
      reason?: string;
      approvalExpiresAt?: ISODateTimeString;
      decisionSource?: ModyApprovalQueueDecisionSource;
      decidedViaChannelId?: ModyChannelId;
    } = {},
  ): ModyApprovalQueueDecisionResult {
    const item = this.#items.get(requestId);
    if (!item) {
      return {
        status: "not_found",
        auditEntries: [],
        userMessage: "승인함에서 요청을 찾을 수 없습니다.",
      };
    }

    const decidedAt = options.decidedAt ?? this.#now().toISOString();
    const decisionSource = options.decisionSource ?? "app";

    if (item.status === "blocked") {
      const auditEntries = [
        this.#auditLog.record({
          requestId,
          actor: "system",
          eventType: "tool_blocked",
          message: "차단된 요청은 승인 기록이 있어도 실행할 수 없습니다.",
          createdAt: decidedAt,
          policyVersion: modyPolicyVersion,
          operationKind: item.operationKind,
          riskLabel: item.riskLabel,
          metadata: {
            queueItemId: item.id,
            decision,
            reason: "blocked_queue_item",
          },
        }),
      ];

      return {
        status: "blocked",
        item,
        auditEntries,
        userMessage: "정책상 차단된 요청은 승인할 수 없습니다.",
      };
    }

    if (item.status !== "pending" && !(item.status === "app_reconfirm_required" && decisionSource === "app")) {
      return {
        status: "already_decided",
        item,
        auditEntries: [],
        userMessage: "이미 결정된 승인 요청입니다.",
      };
    }

    if (item.expiresAt && new Date(item.expiresAt).getTime() <= new Date(decidedAt).getTime()) {
      item.status = "expired";
      const auditEntries = [
        this.#auditLog.record({
          requestId,
          actor: "system",
          eventType: "approval_decided",
          message: "승인 요청이 만료되어 실행하지 않습니다.",
          createdAt: decidedAt,
          policyVersion: modyPolicyVersion,
          operationKind: item.operationKind,
          riskLabel: item.riskLabel,
          metadata: {
            queueItemId: item.id,
            decision: "expired",
          },
        }),
      ];

      return {
        status: "expired",
        item,
        auditEntries,
        userMessage: "승인 유효 시간이 지나 다시 확인해야 합니다.",
      };
    }

    if (decisionSource === "channel" && decision === "approved" && !item.canExecuteFromChannel) {
      const channelDecisionInput: ModyApprovalQueueChannelDecision = {
        decision,
        decidedBy,
        decidedAt,
        requiresAppReconfirm: true,
      };

      if (options.decidedViaChannelId) {
        channelDecisionInput.channelId = options.decidedViaChannelId;
      }

      item.channelDecision = channelDecisionInput;
      item.status = "app_reconfirm_required";
      const auditEntries = [
        this.#auditLog.record({
          requestId,
          actor: "channel",
          eventType: "channel_decision_recorded",
          message: "채널 승인 의사는 기록했지만 실제 실행은 앱 최종 확인이 필요합니다.",
          createdAt: decidedAt,
          policyVersion: modyPolicyVersion,
          operationKind: item.operationKind,
          riskLabel: item.riskLabel,
          metadata: {
            queueItemId: item.id,
            decision,
            decidedBy,
            decisionSource,
            decidedViaChannelId: options.decidedViaChannelId,
            requiresAppReconfirm: true,
            appFinalConfirmationRequired: true,
            canExecuteFromChannel: false,
          },
        }),
      ];

      return {
        status: "app_reconfirm_required",
        item,
        auditEntries,
        userMessage: "채널 승인 의사는 기록했지만 앱에서 현재 내용을 다시 확인해야 합니다.",
      };
    }

    const approvalInput: {
      id: string;
      requestId: string;
      decision: ApprovalDecision;
      decidedBy: string;
      decidedAt: ISODateTimeString;
      reason?: string;
      expiresAt?: ISODateTimeString;
    } = {
      id: `approval_${sanitizeId(requestId)}_${sanitizeId(decision)}_${Date.parse(decidedAt).toString(36)}`,
      requestId,
      decision,
      decidedBy,
      decidedAt,
    };

    if (options.reason) {
      approvalInput.reason = options.reason;
    }

    if (options.approvalExpiresAt) {
      approvalInput.expiresAt = options.approvalExpiresAt;
    }

    const approval = approvalInput;
    const gate = this.#approvalGate.evaluate(item.request, approval);
    item.decision = approval;
    item.gate = gate;
    item.status = statusForDecision(decision, gate);

    const auditEntries = [
      this.#auditLog.record({
        requestId,
        actor: decisionSource === "channel" ? "channel" : "user",
        eventType: decisionSource === "channel" ? "channel_decision_recorded" : "approval_decided",
        message: decisionMessageFor(item, decision, gate),
        createdAt: decidedAt,
        policyVersion: modyPolicyVersion,
        operationKind: item.operationKind,
        riskLabel: item.riskLabel,
        metadata: {
          queueItemId: item.id,
          decision,
          decidedBy,
          decisionSource,
          decidedViaChannelId: options.decidedViaChannelId,
          gateStatus: gate.status,
          canRunTool: gate.canRunTool,
          canMutateExternalSystem: gate.canMutateExternalSystem,
          appFinalConfirmationRequired: true,
          canExecuteFromChannel: false,
        },
      }),
    ];

    return {
      status: "recorded",
      item,
      approval,
      auditEntries,
      userMessage: gate.userMessage,
    };
  }

  expirePending(now = this.#now().toISOString()): ModyAuditEntry[] {
    const auditEntries: ModyAuditEntry[] = [];

    for (const item of this.#items.values()) {
      if (item.status !== "pending" || !item.expiresAt) continue;
      if (new Date(item.expiresAt).getTime() > new Date(now).getTime()) continue;

      item.status = "expired";
      auditEntries.push(this.#auditLog.record({
        requestId: item.request.id,
        actor: "system",
        eventType: "approval_decided",
        message: `${item.title} 승인 요청이 만료되었습니다.`,
        createdAt: now,
        policyVersion: modyPolicyVersion,
        operationKind: item.operationKind,
        riskLabel: item.riskLabel,
        metadata: {
          queueItemId: item.id,
          decision: "expired",
        },
      }));
    }

    return auditEntries;
  }

  list(status?: ModyApprovalQueueItemStatus): ModyApprovalQueueItem[] {
    const items = [...this.#items.values()];
    return status ? items.filter((item) => item.status === status) : items;
  }
}

function statusForDecision(
  decision: ApprovalDecision,
  gate: ApprovalGateResult,
): ModyApprovalQueueItemStatus {
  if (gate.status === "approved_for_execution") return "approved";
  if (gate.status === "expired") return "expired";
  if (gate.status === "rejected") return "rejected";
  if (decision === "held") return "held";
  if (decision === "change_requested" || decision === "needs_more_context") return "change_requested";
  if (decision === "expired") return "expired";
  return "rejected";
}

function decisionMessageFor(
  item: ModyApprovalQueueItem,
  decision: ApprovalDecision,
  gate: ApprovalGateResult,
): string {
  if (gate.status === "approved_for_execution") {
    return `${item.title} 요청을 사용자가 승인했습니다. 실제 실행은 adapter/runtime 경계를 통과해야 합니다.`;
  }

  if (decision === "held") return `${item.title} 요청을 보류했습니다.`;
  if (decision === "change_requested") return `${item.title} 요청에 수정이 필요합니다.`;
  if (decision === "rejected") return `${item.title} 요청을 거절했습니다.`;
  return gate.auditMessage;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_");
}
