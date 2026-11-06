import { createToolActionRequest } from "./policy.js";
import {
  modyPolicyVersion,
  type ISODateTimeString,
  type ModyAuditEntry,
  type ToolActionRequest,
  type ToolRiskLabel,
  type WorkItem,
} from "./types.js";

export type ModyBusinessSystemKind = "pos" | "erp" | "inventory_sheet" | "custom_api";

export type ModyInventoryReadStatus =
  | "read_completed"
  | "needs_reconnect"
  | "permission_denied";

export type ModyInventoryShortageSeverity = "watch" | "low" | "critical";

export const modyBusinessSystemInventoryRequiredPermissions = [
  "read_inventory",
  "send_sms",
] as const;

export type ModyInventoryItemSnapshot = {
  id: string;
  name: string;
  onHand: number;
  reorderPoint: number;
  lastUpdatedAt: ISODateTimeString;
  sku?: string;
  locationLabel?: string;
  reserved?: number;
  reorderUnit?: string;
  preferredVendorLabel?: string;
  managerLabel?: string;
  notificationPhoneMasked?: string;
};

export type ModyInventoryReadSnapshot = {
  id: string;
  connectorId: string;
  systemKind: ModyBusinessSystemKind;
  systemLabel: string;
  action: "list_inventory_items";
  status: ModyInventoryReadStatus;
  readAt: ISODateTimeString;
  externalMutation: false;
  rawSecretMaterialStored: false;
  items: ModyInventoryItemSnapshot[];
  auditMessage: string;
  credentialReferenceId?: string;
};

export type ModyInventoryShortage = {
  itemId: string;
  name: string;
  available: number;
  onHand: number;
  reserved: number;
  reorderPoint: number;
  shortageBy: number;
  severity: ModyInventoryShortageSeverity;
  severityLabel: string;
  reason: string;
  lastUpdatedAt: ISODateTimeString;
  sku?: string;
  locationLabel?: string;
  reorderUnit?: string;
  preferredVendorLabel?: string;
  managerLabel?: string;
};

export type ModyInventorySmsDraft = {
  id: string;
  recipientLabel: string;
  shortageItemIds: string[];
  subject: string;
  body: string;
  approvalRequestId: string;
  recipientPhoneMasked?: string;
};

export type ModyBusinessSystemInventoryStatus =
  | "ready_for_review"
  | "quiet"
  | "needs_reconnect";

export type ModyBusinessSystemInventoryPrivacy = {
  rawSecretMaterialIncluded: false;
  redactedFieldsCount: number;
  boundaryMessage: string;
};

export type ModyBusinessSystemInventoryReport = {
  id: string;
  createdAt: ISODateTimeString;
  workspaceLabel: string;
  systemLabel: string;
  systemKind: ModyBusinessSystemKind;
  status: ModyBusinessSystemInventoryStatus;
  externalMutation: false;
  rawSecretMaterialStored: false;
  appFinalConfirmationRequired: true;
  shortageCount: number;
  criticalCount: number;
  shortageItems: ModyInventoryShortage[];
  workItems: WorkItem[];
  approvalQueue: ToolActionRequest[];
  smsDrafts: ModyInventorySmsDraft[];
  auditEntries: ModyAuditEntry[];
  userVisibleSummary: string;
  nextUserActions: string[];
  safetyBoundary: string;
  privacy: ModyBusinessSystemInventoryPrivacy;
};

export type ModyBusinessSystemInventoryWorkflowInput = {
  snapshot: ModyInventoryReadSnapshot;
  workspaceLabel?: string;
  notifyRecipientLabel?: string;
  notifyPhoneMasked?: string;
  appDeepLink?: string;
  createdAt?: ISODateTimeString;
};

type WorkflowOptions = {
  now?: () => Date;
};

class BusinessSystemSanitizer {
  redactedFieldsCount = 0;

  sanitize(value: string): string {
    const patterns: Array<[RegExp, string | ((match: string, ...captures: string[]) => string)]> = [
      [/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[redacted-openai-key]"],
      [/\bAIza[0-9A-Za-z_-]{12,}\b/gu, "[redacted-google-key]"],
      [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu, "[redacted-slack-token]"],
      [/\bbot\d+:[A-Za-z0-9_-]{10,}\b/gu, "[redacted-telegram-token]"],
      [/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/gu, "[redacted-jwt]"],
      [
        /\b(api\s*key|apikey|token|password|secret|비밀번호|토큰|시크릿)\s*[:=]\s*([^\s,;]+)/giu,
        (_match, keyLabel) => `${keyLabel}=[redacted]`,
      ],
    ];

    let output = value;
    for (const [pattern, replacement] of patterns) {
      output = output.replace(pattern, (...args: string[]) => {
        this.redactedFieldsCount += 1;
        if (typeof replacement === "function") {
          return replacement(args[0] ?? "", ...args.slice(1, -2));
        }
        return replacement;
      });
    }

    return output;
  }
}

export class ModyBusinessSystemInventoryWorkflow {
  private readonly now: () => Date;

  constructor(options: WorkflowOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createReport(input: ModyBusinessSystemInventoryWorkflowInput): ModyBusinessSystemInventoryReport {
    assertSafeSnapshot(input.snapshot);
    const sanitizer = new BusinessSystemSanitizer();
    const createdAt = input.createdAt ?? this.now().toISOString();
    const workspaceLabel = sanitizer.sanitize(input.workspaceLabel ?? "ModyCrew 작업공간");
    const systemLabel = sanitizer.sanitize(input.snapshot.systemLabel);
    const shortageItems = createShortages(input.snapshot.items, sanitizer);
    const status = statusFor(input.snapshot, shortageItems);
    const approvalQueue = status === "ready_for_review"
      ? [
          createSmsApprovalRequest({
            input,
            createdAt,
            workspaceLabel,
            systemLabel,
            shortages: shortageItems,
            sanitizer,
          }),
        ]
      : [];
    const smsDrafts = approvalQueue.map((request) =>
      createSmsDraft({
        request,
        input,
        workspaceLabel,
        shortages: shortageItems,
        sanitizer,
      }),
    );
    const workItems = createWorkItems({
      input,
      createdAt,
      workspaceLabel,
      systemLabel,
      status,
      shortages: shortageItems,
      approvalQueue,
      sanitizer,
    });
    const auditEntries = createAuditEntries({
      input,
      createdAt,
      systemLabel,
      status,
      shortages: shortageItems,
      approvalQueue,
      sanitizer,
    });
    const criticalCount = shortageItems.filter((item) => item.severity === "critical").length;

    return {
      id: `business_inventory_${input.snapshot.id}_${compactDate(createdAt)}`,
      createdAt,
      workspaceLabel,
      systemLabel,
      systemKind: input.snapshot.systemKind,
      status,
      externalMutation: false,
      rawSecretMaterialStored: false,
      appFinalConfirmationRequired: true,
      shortageCount: shortageItems.length,
      criticalCount,
      shortageItems,
      workItems,
      approvalQueue,
      smsDrafts,
      auditEntries,
      userVisibleSummary: summaryFor(status, shortageItems.length, criticalCount, systemLabel),
      nextUserActions: nextUserActionsFor(status, shortageItems.length, approvalQueue.length),
      safetyBoundary:
        "회사 시스템은 읽기 전용 snapshot만 사용합니다. 재고 수정, 발주, 문자 발송은 승인함 최종 확인 전 실행하지 않습니다.",
      privacy: {
        rawSecretMaterialIncluded: false,
        redactedFieldsCount: sanitizer.redactedFieldsCount,
        boundaryMessage: "credential 원문과 phone 원문은 보고서/초안에 저장하지 않고 masked label과 reference만 사용합니다.",
      },
    };
  }

  renderMarkdown(report: ModyBusinessSystemInventoryReport): string {
    const lines = [
      `# ${report.workspaceLabel} 회사 시스템 재고 보고`,
      "",
      `- 시스템: ${report.systemLabel}`,
      `- 상태: ${statusLabel(report.status)}`,
      `- 부족 재고: ${report.shortageCount}건`,
      `- 긴급: ${report.criticalCount}건`,
      `- 승인 대기: ${report.approvalQueue.length}건`,
      `- 외부 실행: ${report.externalMutation ? "있음" : "없음"}`,
      "",
      "## 요약",
      "",
      report.userVisibleSummary,
      "",
      "## 부족 재고",
      "",
    ];

    if (report.shortageItems.length === 0) {
      lines.push("- 부족 기준에 걸린 재고가 없습니다.");
    } else {
      for (const item of report.shortageItems) {
        lines.push(
          `- ${item.name}: 가용 ${item.available}${item.reorderUnit ?? "개"} / 기준 ${item.reorderPoint}${item.reorderUnit ?? "개"} (${item.severityLabel})`,
        );
      }
    }

    lines.push("", "## 승인 대기 문자", "");
    if (report.smsDrafts.length === 0) {
      lines.push("- 문자 발송 승인 대기가 없습니다.");
    } else {
      for (const draft of report.smsDrafts) {
        lines.push(`- ${draft.recipientLabel}: ${draft.subject}`);
      }
    }

    lines.push("", "## 안전 경계", "", report.safetyBoundary, "");
    return `${lines.join("\n")}\n`;
  }
}

function assertSafeSnapshot(snapshot: ModyInventoryReadSnapshot): void {
  if (snapshot.externalMutation !== false) {
    throw new Error("재고 workflow는 외부 시스템을 변경한 snapshot을 입력으로 받지 않습니다.");
  }

  if (snapshot.rawSecretMaterialStored !== false) {
    throw new Error("재고 workflow는 credential 원문이 저장된 snapshot을 입력으로 받지 않습니다.");
  }
}

function createShortages(
  items: readonly ModyInventoryItemSnapshot[],
  sanitizer: BusinessSystemSanitizer,
): ModyInventoryShortage[] {
  return items
    .map((item) => {
      const reserved = Math.max(0, item.reserved ?? 0);
      const available = Math.max(0, item.onHand - reserved);
      const shortageBy = Math.max(0, item.reorderPoint - available);
      if (shortageBy <= 0) return undefined;

      const severity = severityFor(available, item.reorderPoint, shortageBy);
      const shortage: ModyInventoryShortage = {
        itemId: item.id,
        name: sanitizer.sanitize(item.name),
        available,
        onHand: item.onHand,
        reserved,
        reorderPoint: item.reorderPoint,
        shortageBy,
        severity,
        severityLabel: severityLabel(severity),
        reason: `${sanitizer.sanitize(item.name)} 가용 수량이 기준보다 ${shortageBy}${item.reorderUnit ?? "개"} 부족합니다.`,
        lastUpdatedAt: item.lastUpdatedAt,
      };

      if (item.sku) shortage.sku = sanitizer.sanitize(item.sku);
      if (item.locationLabel) shortage.locationLabel = sanitizer.sanitize(item.locationLabel);
      if (item.reorderUnit) shortage.reorderUnit = sanitizer.sanitize(item.reorderUnit);
      if (item.preferredVendorLabel) shortage.preferredVendorLabel = sanitizer.sanitize(item.preferredVendorLabel);
      if (item.managerLabel) shortage.managerLabel = sanitizer.sanitize(item.managerLabel);
      return shortage;
    })
    .filter((item): item is ModyInventoryShortage => Boolean(item))
    .sort((first, second) => severityRank(second.severity) - severityRank(first.severity) || second.shortageBy - first.shortageBy);
}

function severityFor(
  available: number,
  reorderPoint: number,
  shortageBy: number,
): ModyInventoryShortageSeverity {
  if (available <= 0 || available <= Math.floor(reorderPoint * 0.5)) return "critical";
  if (shortageBy <= Math.max(2, Math.ceil(reorderPoint * 0.15))) return "watch";
  return "low";
}

function createSmsApprovalRequest(input: {
  input: ModyBusinessSystemInventoryWorkflowInput;
  createdAt: ISODateTimeString;
  workspaceLabel: string;
  systemLabel: string;
  shortages: ModyInventoryShortage[];
  sanitizer: BusinessSystemSanitizer;
}): ToolActionRequest {
  const criticalCount = input.shortages.filter((item) => item.severity === "critical").length;
  const recipientLabel = input.sanitizer.sanitize(input.input.notifyRecipientLabel ?? "운영 담당자");
  const recipientPhoneMasked = maskPhone(input.input.notifyPhoneMasked);
  return createToolActionRequest({
    id: `send_sms_inventory_${input.input.snapshot.id}_${compactDate(input.createdAt)}`,
    toolName: "mody.sms.send",
    permissionLevel: "execute",
    operationKind: "send_sms_message",
    inputSummary: `${input.systemLabel} 부족 재고 ${input.shortages.length}건 확인 문자 초안`,
    expectedImpact: "담당자에게 실제 문자가 발송될 수 있으므로 승인함 최종 확인 전 실행하지 않습니다.",
    userVisibleDescription: "부족 재고 확인 문자 발송",
    createdAt: input.createdAt,
    sourceAdapterId: input.input.snapshot.connectorId,
    metadata: {
      workspaceLabel: input.workspaceLabel,
      systemKind: input.input.snapshot.systemKind,
      shortageCount: input.shortages.length,
      criticalCount,
      recipientLabel,
      ...(recipientPhoneMasked ? { recipientPhoneMasked } : {}),
      ...(input.input.appDeepLink ? { appDeepLink: input.sanitizer.sanitize(input.input.appDeepLink) } : {}),
    },
  });
}

function createSmsDraft(input: {
  request: ToolActionRequest;
  input: ModyBusinessSystemInventoryWorkflowInput;
  workspaceLabel: string;
  shortages: ModyInventoryShortage[];
  sanitizer: BusinessSystemSanitizer;
}): ModyInventorySmsDraft {
  const recipientLabel = input.sanitizer.sanitize(input.input.notifyRecipientLabel ?? "운영 담당자");
  const recipientPhoneMasked = maskPhone(input.input.notifyPhoneMasked);
  const itemLines = input.shortages
    .slice(0, 4)
    .map((item) => `${item.name} 가용 ${item.available}${item.reorderUnit ?? "개"} / 기준 ${item.reorderPoint}${item.reorderUnit ?? "개"}`)
    .join("\n");
  const extraCount = input.shortages.length > 4 ? `\n외 ${input.shortages.length - 4}건은 앱에서 확인해주세요.` : "";
  const draft: ModyInventorySmsDraft = {
    id: `sms_draft_${input.request.id}`,
    recipientLabel,
    shortageItemIds: input.shortages.map((item) => item.itemId),
    subject: `${input.workspaceLabel} 부족 재고 ${input.shortages.length}건 확인`,
    body: `[${input.workspaceLabel}] 부족 재고 확인이 필요합니다.\n${itemLines}${extraCount}\n발주/보충 여부를 앱에서 확인해주세요.`,
    approvalRequestId: input.request.id,
  };

  if (recipientPhoneMasked) {
    draft.recipientPhoneMasked = recipientPhoneMasked;
  }

  return draft;
}

function createWorkItems(input: {
  input: ModyBusinessSystemInventoryWorkflowInput;
  createdAt: ISODateTimeString;
  workspaceLabel: string;
  systemLabel: string;
  status: ModyBusinessSystemInventoryStatus;
  shortages: ModyInventoryShortage[];
  approvalQueue: ToolActionRequest[];
  sanitizer: BusinessSystemSanitizer;
}): WorkItem[] {
  const riskLabel = riskLabelFor(input.status, input.shortages);
  const item: WorkItem = {
    id: `work_inventory_${input.input.snapshot.id}`,
    title: `${input.systemLabel} 재고 체크`,
    source: "business_system",
    body: workBodyFor(input.status, input.shortages.length, input.systemLabel),
    status: workStatusFor(input.status),
    riskLabel,
    riskSignals: riskLabel === "high"
      ? [
          {
            id: "risk_inventory_sms_external",
            kind: "external_execution",
            riskLabel: "high",
            reason: "부족 재고 알림 문자는 외부 수신자에게 실제 발송될 수 있습니다.",
          },
        ]
      : [],
    toolActionRequests: input.approvalQueue,
    policyVersion: modyPolicyVersion,
    createdAt: input.createdAt,
  };

  return [item];
}

function createAuditEntries(input: {
  input: ModyBusinessSystemInventoryWorkflowInput;
  createdAt: ISODateTimeString;
  systemLabel: string;
  status: ModyBusinessSystemInventoryStatus;
  shortages: ModyInventoryShortage[];
  approvalQueue: ToolActionRequest[];
  sanitizer: BusinessSystemSanitizer;
}): ModyAuditEntry[] {
  const readMessage = input.sanitizer.sanitize(input.input.snapshot.auditMessage);
  const entries: ModyAuditEntry[] = [
    {
      id: `audit_inventory_read_${input.input.snapshot.id}`,
      actor: "agent",
      eventType: input.status === "needs_reconnect" ? "tool_failed" : "tool_completed",
      message: readMessage,
      createdAt: input.input.snapshot.readAt,
      policyVersion: modyPolicyVersion,
      operationKind: "read_data",
      riskLabel: input.status === "needs_reconnect" ? "medium" : "low",
    },
    {
      id: `audit_inventory_analyze_${input.input.snapshot.id}`,
      actor: "agent",
      eventType: "tool_completed",
      message: `${input.systemLabel} 재고 ${input.input.snapshot.items.length}개를 읽고 부족 재고 ${input.shortages.length}건을 분류했습니다.`,
      createdAt: input.createdAt,
      policyVersion: modyPolicyVersion,
      operationKind: "analyze_data",
      riskLabel: input.shortages.some((item) => item.severity === "critical") ? "medium" : "low",
    },
  ];

  if (input.approvalQueue[0]) {
    entries.push({
      id: `audit_inventory_sms_${input.input.snapshot.id}`,
      actor: "agent",
      eventType: "approval_required",
      message: "부족 재고 확인 문자를 승인함에 올렸고 실제 문자는 발송하지 않았습니다.",
      createdAt: input.createdAt,
      requestId: input.approvalQueue[0].id,
      policyVersion: modyPolicyVersion,
      operationKind: "send_sms_message",
      riskLabel: "high",
    });
  }

  return entries;
}

function statusFor(
  snapshot: ModyInventoryReadSnapshot,
  shortages: readonly ModyInventoryShortage[],
): ModyBusinessSystemInventoryStatus {
  if (snapshot.status !== "read_completed") return "needs_reconnect";
  return shortages.length > 0 ? "ready_for_review" : "quiet";
}

function workStatusFor(status: ModyBusinessSystemInventoryStatus): WorkItem["status"] {
  if (status === "ready_for_review") return "approval_pending";
  if (status === "needs_reconnect") return "needs_review";
  return "completed";
}

function riskLabelFor(
  status: ModyBusinessSystemInventoryStatus,
  shortages: readonly ModyInventoryShortage[],
): ToolRiskLabel {
  if (status === "ready_for_review") return "high";
  if (status === "needs_reconnect") return "medium";
  if (shortages.length > 0) return "medium";
  return "low";
}

function workBodyFor(
  status: ModyBusinessSystemInventoryStatus,
  shortageCount: number,
  systemLabel: string,
): string {
  if (status === "needs_reconnect") {
    return `${systemLabel} 연결 상태를 먼저 확인해야 합니다. 재고 수정이나 문자 발송은 실행하지 않았습니다.`;
  }
  if (status === "ready_for_review") {
    return `${systemLabel}에서 부족 재고 ${shortageCount}건을 찾아 문자 초안을 승인 대기에 올렸습니다.`;
  }
  return `${systemLabel} 재고를 확인했고 기준 이하 품목은 없습니다.`;
}

function summaryFor(
  status: ModyBusinessSystemInventoryStatus,
  shortageCount: number,
  criticalCount: number,
  systemLabel: string,
): string {
  if (status === "needs_reconnect") {
    return `${systemLabel} 연결 상태 확인이 필요합니다. 앱은 재고 수정과 문자 발송을 하지 않았습니다.`;
  }
  if (status === "quiet") {
    return `${systemLabel} 재고를 확인했고 부족 기준에 걸린 품목이 없습니다.`;
  }
  return `${systemLabel}에서 부족 재고 ${shortageCount}건을 찾았습니다. 긴급 ${criticalCount}건은 문자 초안으로 승인 대기에 올렸습니다.`;
}

function nextUserActionsFor(
  status: ModyBusinessSystemInventoryStatus,
  shortageCount: number,
  approvalCount: number,
): string[] {
  if (status === "needs_reconnect") {
    return ["회사 시스템 연결 상태와 읽기 권한을 다시 확인합니다."];
  }
  if (status === "quiet") {
    return ["다음 재고 점검 시간에 다시 읽기 전용으로 확인합니다."];
  }

  return [
    `부족 재고 ${shortageCount}건의 실제 수량을 확인합니다.`,
    `승인함에서 문자 발송 후보 ${approvalCount}건을 검토합니다.`,
    "발주, 재고 수정, 문자 발송은 최종 확인 후에만 실행합니다.",
  ];
}

function statusLabel(status: ModyBusinessSystemInventoryStatus): string {
  if (status === "ready_for_review") return "검토/승인 필요";
  if (status === "needs_reconnect") return "연결 확인 필요";
  return "이상 없음";
}

function severityLabel(severity: ModyInventoryShortageSeverity): string {
  if (severity === "critical") return "긴급";
  if (severity === "low") return "부족";
  return "관찰";
}

function severityRank(severity: ModyInventoryShortageSeverity): number {
  if (severity === "critical") return 3;
  if (severity === "low") return 2;
  return 1;
}

function maskPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes("*")) return value;
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 4) return "연락처 확인 필요";
  const prefix = digits.length >= 10 ? digits.slice(0, 3) : "전화";
  return `${prefix}-****-${digits.slice(-4)}`;
}

function compactDate(value: ISODateTimeString): string {
  return value.replace(/[^0-9]/gu, "");
}
