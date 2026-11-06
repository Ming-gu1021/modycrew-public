import { createToolActionRequest } from "./policy.js";
import {
  modyPolicyVersion,
  type ISODateTimeString,
  type ModyAuditEntry,
  type ToolActionRequest,
  type ToolRiskLabel,
  type WorkItem,
  type WorkItemSource,
} from "./types.js";

export type ModyConnectedWorkTriggerSourceKind =
  | "mailbox"
  | "business_inquiry"
  | "sales_system"
  | "inventory_system";

export type ModyConnectedWorkTriggerKind =
  | "mail_received"
  | "inquiry_received"
  | "sales_order_changed"
  | "inventory_threshold_changed"
  | "scheduled_check";

export type ModyConnectedWorkTriggerMode = "webhook" | "polling" | "scheduled";

export type ModyConnectedWorkDataSensitivity = "normal" | "customer_contact" | "business_financial";

export type ModyConnectedWorkTriggerDefinition = {
  id: string;
  connectorId: string;
  label: string;
  sourceKind: ModyConnectedWorkTriggerSourceKind;
  triggerKind: ModyConnectedWorkTriggerKind;
  mode: ModyConnectedWorkTriggerMode;
  enabled: boolean;
  cadenceMinutes?: number;
  lastCursor?: string;
};

export type ModyConnectedWorkSignal = {
  id: string;
  triggerId: string;
  occurredAt: ISODateTimeString;
  title: string;
  summary: string;
  cursor: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  dataSensitivity: ModyConnectedWorkDataSensitivity;
  changedFieldLabels?: string[];
};

export type ModyConnectedAiJobStatus =
  | "queued_for_ai"
  | "waiting_for_next_check"
  | "skipped_disabled_trigger";

export type ModyConnectedAiJob = {
  id: string;
  triggerId: string;
  connectorId: string;
  status: ModyConnectedAiJobStatus;
  stagePlan: string[];
  userVisibleSummary: string;
  createdAt: ISODateTimeString;
  signalId?: string;
};

export type ModyConnectedWorkInfoUpdate = {
  id: string;
  triggerId: string;
  connectorId: string;
  status: "updated" | "no_change" | "disabled";
  summary: string;
  updatedAt: ISODateTimeString;
  nextCursor?: string;
  previousCursor?: string;
  changedFieldLabels?: string[];
};

export type ModyConnectedWorkNextCheck = {
  triggerId: string;
  connectorId: string;
  mode: ModyConnectedWorkTriggerMode;
  nextCheckAt: ISODateTimeString;
  userVisibleSchedule: string;
};

export type ModyConnectedWorkTriggerStatus =
  | "ai_jobs_ready"
  | "idle"
  | "needs_connection";

export type ModyConnectedWorkTriggerReport = {
  id: string;
  createdAt: ISODateTimeString;
  status: ModyConnectedWorkTriggerStatus;
  externalMutation: false;
  rawSecretMaterialStored: false;
  triggersChecked: number;
  signalsProcessed: number;
  aiJobs: ModyConnectedAiJob[];
  infoUpdates: ModyConnectedWorkInfoUpdate[];
  nextChecks: ModyConnectedWorkNextCheck[];
  workItems: WorkItem[];
  auditEntries: ModyAuditEntry[];
  actionRequests: ToolActionRequest[];
  userVisibleSummary: string;
  safetyBoundary: string;
};

export type ModyConnectedWorkTriggerRuntimeInput = {
  triggers: ModyConnectedWorkTriggerDefinition[];
  signals?: ModyConnectedWorkSignal[];
  workspaceLabel?: string;
  createdAt?: ISODateTimeString;
  appDeepLinkBase?: string;
};

type RuntimeOptions = {
  now?: () => Date;
};

export class ModyConnectedWorkTriggerRuntime {
  private readonly now: () => Date;

  constructor(options: RuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createReport(input: ModyConnectedWorkTriggerRuntimeInput): ModyConnectedWorkTriggerReport {
    const createdAt = input.createdAt ?? this.now().toISOString();
    const signals = input.signals ?? [];
    assertSafeSignals(signals);

    const enabledTriggers = input.triggers.filter((trigger) => trigger.enabled);
    const triggerMap = new Map(input.triggers.map((trigger) => [trigger.id, trigger]));
    const matchedSignals = signals.filter((signal) => triggerMap.get(signal.triggerId)?.enabled);
    const aiJobs = [
      ...matchedSignals.map((signal) => createAiJob(signal, triggerMap.get(signal.triggerId), createdAt)),
      ...input.triggers
        .filter((trigger) => !trigger.enabled)
        .map((trigger) => createDisabledJob(trigger, createdAt)),
    ];
    const infoUpdates = createInfoUpdates(input.triggers, signals, createdAt);
    const nextChecks = enabledTriggers.map((trigger) => createNextCheck(trigger, createdAt));
    const workItems = matchedSignals.map((signal) =>
      createWorkItem({
        signal,
        trigger: triggerMap.get(signal.triggerId),
        createdAt,
        workspaceLabel: input.workspaceLabel ?? "ModyCrew 작업공간",
        ...(input.appDeepLinkBase ? { appDeepLinkBase: input.appDeepLinkBase } : {}),
      }),
    );
    const actionRequests = workItems.flatMap((item) => item.toolActionRequests);
    const auditEntries = createAuditEntries({
      createdAt,
      triggers: input.triggers,
      signals: matchedSignals,
      aiJobs,
    });
    const status = statusFor(input.triggers, matchedSignals);

    return {
      id: `connected_work_trigger_${compactDate(createdAt)}`,
      createdAt,
      status,
      externalMutation: false,
      rawSecretMaterialStored: false,
      triggersChecked: enabledTriggers.length,
      signalsProcessed: matchedSignals.length,
      aiJobs,
      infoUpdates,
      nextChecks,
      workItems,
      auditEntries,
      actionRequests,
      userVisibleSummary: summaryFor(status, enabledTriggers.length, matchedSignals.length, aiJobs.length),
      safetyBoundary:
        "연결 트리거는 메일, 문의, 판매, 재고 시스템을 읽고 AI 작업과 내부 정보 업데이트만 만듭니다. 외부 발송, 주문 변경, 재고 수정은 승인함 최종 확인 전 실행하지 않습니다.",
    };
  }

  renderMarkdown(report: ModyConnectedWorkTriggerReport): string {
    const lines = [
      "# 연결 업무 트리거 보고",
      "",
      `- 상태: ${statusLabel(report.status)}`,
      `- 확인한 트리거: ${report.triggersChecked}개`,
      `- 처리한 신호: ${report.signalsProcessed}개`,
      `- AI 작업: ${report.aiJobs.filter((job) => job.status === "queued_for_ai").length}개`,
      `- 내부 정보 업데이트: ${report.infoUpdates.filter((update) => update.status === "updated").length}개`,
      `- 외부 실행: ${report.externalMutation ? "있음" : "없음"}`,
      "",
      "## AI 작업",
      "",
    ];

    if (report.aiJobs.length === 0) {
      lines.push("- 실행할 AI 작업이 없습니다.");
    } else {
      for (const job of report.aiJobs) {
        lines.push(`- ${job.userVisibleSummary}`);
      }
    }

    lines.push("", "## 다음 체크", "");
    for (const check of report.nextChecks) {
      lines.push(`- ${check.triggerId}: ${check.userVisibleSchedule}`);
    }

    lines.push("", "## 안전 경계", "", report.safetyBoundary, "");
    return `${lines.join("\n")}\n`;
  }
}

function assertSafeSignals(signals: readonly ModyConnectedWorkSignal[]): void {
  for (const signal of signals) {
    if (signal.externalMutation !== false) {
      throw new Error(`연결 트리거는 외부 변경이 포함된 signal을 처리하지 않습니다: ${signal.id}`);
    }
    if (signal.rawSecretMaterialStored !== false) {
      throw new Error(`연결 트리거는 secret 원문이 포함된 signal을 처리하지 않습니다: ${signal.id}`);
    }
  }
}

function createAiJob(
  signal: ModyConnectedWorkSignal,
  trigger: ModyConnectedWorkTriggerDefinition | undefined,
  createdAt: ISODateTimeString,
): ModyConnectedAiJob {
  if (!trigger) {
    return {
      id: `ai_job_unmatched_${signal.id}`,
      triggerId: signal.triggerId,
      connectorId: "unknown",
      signalId: signal.id,
      status: "waiting_for_next_check",
      stagePlan: ["연결 정의 확인"],
      userVisibleSummary: `${signal.title} 신호는 연결 정의 확인 후 처리합니다.`,
      createdAt,
    };
  }

  return {
    id: `ai_job_${signal.id}`,
    triggerId: trigger.id,
    connectorId: trigger.connectorId,
    signalId: signal.id,
    status: "queued_for_ai",
    stagePlan: stagePlanFor(trigger),
    userVisibleSummary: `${trigger.label}에서 ${signal.title} 신호를 받아 AI가 읽기, 정리, 초안/보고 후보를 만듭니다.`,
    createdAt,
  };
}

function createDisabledJob(
  trigger: ModyConnectedWorkTriggerDefinition,
  createdAt: ISODateTimeString,
): ModyConnectedAiJob {
  return {
    id: `ai_job_disabled_${trigger.id}`,
    triggerId: trigger.id,
    connectorId: trigger.connectorId,
    status: "skipped_disabled_trigger",
    stagePlan: ["트리거 꺼짐"],
    userVisibleSummary: `${trigger.label} 트리거가 꺼져 있어 AI 작업을 만들지 않았습니다.`,
    createdAt,
  };
}

function createInfoUpdates(
  triggers: readonly ModyConnectedWorkTriggerDefinition[],
  signals: readonly ModyConnectedWorkSignal[],
  createdAt: ISODateTimeString,
): ModyConnectedWorkInfoUpdate[] {
  return triggers.map((trigger) => {
    const latestSignal = [...signals]
      .filter((signal) => signal.triggerId === trigger.id)
      .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt))[0];

    if (!trigger.enabled) {
      return {
        id: `info_update_disabled_${trigger.id}`,
        triggerId: trigger.id,
        connectorId: trigger.connectorId,
        status: "disabled",
        summary: `${trigger.label} 트리거가 꺼져 있어 정보를 갱신하지 않았습니다.`,
        updatedAt: createdAt,
      };
    }

    if (!latestSignal) {
      return {
        id: `info_update_no_change_${trigger.id}`,
        triggerId: trigger.id,
        connectorId: trigger.connectorId,
        status: "no_change",
        summary: `${trigger.label}에서 새 변경을 찾지 못했습니다.`,
        updatedAt: createdAt,
        ...(trigger.lastCursor ? { previousCursor: trigger.lastCursor } : {}),
      };
    }

    return {
      id: `info_update_${latestSignal.id}`,
      triggerId: trigger.id,
      connectorId: trigger.connectorId,
      status: "updated",
      summary: `${trigger.label} 정보를 ${latestSignal.cursor} 기준으로 갱신했습니다.`,
      updatedAt: createdAt,
      nextCursor: latestSignal.cursor,
      ...(trigger.lastCursor ? { previousCursor: trigger.lastCursor } : {}),
      ...(latestSignal.changedFieldLabels ? { changedFieldLabels: latestSignal.changedFieldLabels } : {}),
    };
  });
}

function createNextCheck(
  trigger: ModyConnectedWorkTriggerDefinition,
  createdAt: ISODateTimeString,
): ModyConnectedWorkNextCheck {
  const cadenceMinutes = trigger.cadenceMinutes ?? defaultCadenceMinutes(trigger.mode);
  const nextCheckAt = new Date(new Date(createdAt).getTime() + cadenceMinutes * 60_000).toISOString();
  return {
    triggerId: trigger.id,
    connectorId: trigger.connectorId,
    mode: trigger.mode,
    nextCheckAt,
    userVisibleSchedule: scheduleLabelFor(trigger.mode, cadenceMinutes, nextCheckAt),
  };
}

function createWorkItem(input: {
  signal: ModyConnectedWorkSignal;
  trigger: ModyConnectedWorkTriggerDefinition | undefined;
  createdAt: ISODateTimeString;
  workspaceLabel: string;
  appDeepLinkBase?: string;
}): WorkItem {
  const trigger = input.trigger;
  const source = sourceFor(trigger?.sourceKind);
  const riskLabel = riskLabelFor(input.signal.dataSensitivity, trigger?.sourceKind);
  const readAction = createToolActionRequest({
    id: `trigger_read_${input.signal.id}`,
    toolName: "mody.trigger.read",
    permissionLevel: "read",
    operationKind: "read_data",
    inputSummary: `${trigger?.label ?? "연결"} 신호 읽기`,
    expectedImpact: "연결된 업무 시스템의 새 신호를 읽기 전용으로 확인합니다.",
    userVisibleDescription: "연결 신호 읽기",
    createdAt: input.createdAt,
    externalMutation: false,
    requiresApproval: false,
    ...(trigger?.connectorId ? { sourceAdapterId: trigger.connectorId } : {}),
  });
  const updateAction = createToolActionRequest({
    id: `trigger_update_${input.signal.id}`,
    toolName: "mody.trigger.context.update",
    permissionLevel: "analyze",
    operationKind: "update_internal_context",
    inputSummary: `${input.signal.title} 기준 내부 업무 정보 업데이트`,
    expectedImpact: "앱 내부 업무 상태와 다음 체크 cursor만 갱신합니다.",
    userVisibleDescription: "업무 정보 업데이트",
    createdAt: input.createdAt,
    externalMutation: false,
    requiresApproval: false,
    ...(trigger?.connectorId ? { sourceAdapterId: trigger.connectorId } : {}),
  });
  const aiAction = createToolActionRequest({
    id: `trigger_ai_${input.signal.id}`,
    toolName: "mody.ai.trigger.run",
    permissionLevel: draftLikeTrigger(trigger?.triggerKind) ? "draft" : "analyze",
    operationKind: draftLikeTrigger(trigger?.triggerKind) ? "draft_reply" : "analyze_data",
    inputSummary: `${input.signal.title} AI 처리`,
    expectedImpact: "AI가 요약, 확인 항목, 초안 또는 보고 후보를 만듭니다.",
    userVisibleDescription: draftLikeTrigger(trigger?.triggerKind) ? "AI 초안 생성" : "AI 업무 분석",
    createdAt: input.createdAt,
    externalMutation: false,
    requiresApproval: false,
    ...(trigger?.connectorId ? { sourceAdapterId: trigger.connectorId } : {}),
    metadata: {
      workspaceLabel: input.workspaceLabel,
      signalId: input.signal.id,
      ...(input.appDeepLinkBase ? { appDeepLink: `${input.appDeepLinkBase}/${input.signal.id}` } : {}),
    },
  });

  return {
    id: `work_trigger_${input.signal.id}`,
    title: input.signal.title,
    source,
    body: `${input.signal.summary} AI가 읽고 정리한 뒤 앱 내부 업무 정보만 업데이트합니다.`,
    status: draftLikeTrigger(trigger?.triggerKind) ? "draft_ready" : "needs_review",
    riskLabel,
    riskSignals: riskLabel === "high"
      ? [
          {
            id: `risk_trigger_${input.signal.id}`,
            kind: "external_execution",
            riskLabel: "high",
            reason: "판매/고객 정보 기반 업무는 외부 알림이나 주문 변경으로 이어질 수 있어 승인 경계가 필요합니다.",
          },
        ]
      : [],
    toolActionRequests: [readAction, updateAction, aiAction],
    policyVersion: modyPolicyVersion,
    createdAt: input.createdAt,
  };
}

function createAuditEntries(input: {
  createdAt: ISODateTimeString;
  triggers: readonly ModyConnectedWorkTriggerDefinition[];
  signals: readonly ModyConnectedWorkSignal[];
  aiJobs: readonly ModyConnectedAiJob[];
}): ModyAuditEntry[] {
  const entries: ModyAuditEntry[] = [
    {
      id: `audit_trigger_check_${compactDate(input.createdAt)}`,
      actor: "agent",
      eventType: "tool_completed",
      message: `연결 트리거 ${input.triggers.filter((trigger) => trigger.enabled).length}개를 확인했습니다.`,
      createdAt: input.createdAt,
      policyVersion: modyPolicyVersion,
      operationKind: "read_data",
      riskLabel: "low",
    },
  ];

  if (input.signals.length > 0) {
    entries.push({
      id: `audit_trigger_ai_${compactDate(input.createdAt)}`,
      actor: "agent",
      eventType: "tool_completed",
      message: `새 신호 ${input.signals.length}건으로 AI 작업 ${input.aiJobs.filter((job) => job.status === "queued_for_ai").length}건을 만들었습니다.`,
      createdAt: input.createdAt,
      policyVersion: modyPolicyVersion,
      operationKind: "update_internal_context",
      riskLabel: "low",
    });
  }

  return entries;
}

function stagePlanFor(trigger: ModyConnectedWorkTriggerDefinition): string[] {
  const base = ["연결 신호 읽기", "업무 정보 업데이트", "AI 요약/분류"];
  if (draftLikeTrigger(trigger.triggerKind)) {
    return [...base, "초안 만들기", "승인 필요 실행은 승인함으로 분리"];
  }
  return [...base, "확인 항목 만들기", "다음 체크 예약"];
}

function draftLikeTrigger(triggerKind: ModyConnectedWorkTriggerKind | undefined): boolean {
  return triggerKind === "mail_received" || triggerKind === "inquiry_received";
}

function sourceFor(sourceKind: ModyConnectedWorkTriggerSourceKind | undefined): WorkItemSource {
  if (sourceKind === "mailbox") return "email";
  if (sourceKind === "business_inquiry") return "web_page";
  return "business_system";
}

function riskLabelFor(
  sensitivity: ModyConnectedWorkDataSensitivity,
  sourceKind: ModyConnectedWorkTriggerSourceKind | undefined,
): ToolRiskLabel {
  if (sensitivity === "business_financial") return "high";
  if (sourceKind === "sales_system" || sourceKind === "inventory_system") return "medium";
  if (sensitivity === "customer_contact") return "medium";
  return "low";
}

function statusFor(
  triggers: readonly ModyConnectedWorkTriggerDefinition[],
  signals: readonly ModyConnectedWorkSignal[],
): ModyConnectedWorkTriggerStatus {
  if (triggers.length > 0 && triggers.every((trigger) => !trigger.enabled)) return "needs_connection";
  return signals.length > 0 ? "ai_jobs_ready" : "idle";
}

function summaryFor(
  status: ModyConnectedWorkTriggerStatus,
  triggersChecked: number,
  signalsProcessed: number,
  aiJobs: number,
): string {
  if (status === "needs_connection") {
    return "켜진 트리거가 없어 AI 자동 체크를 시작하지 않았습니다.";
  }
  if (status === "idle") {
    return `연결 트리거 ${triggersChecked}개를 확인했고 새 변경은 없습니다. 다음 체크를 예약했습니다.`;
  }
  return `연결 트리거 ${triggersChecked}개에서 새 신호 ${signalsProcessed}건을 받아 AI 작업 ${aiJobs}건과 내부 정보 업데이트를 만들었습니다.`;
}

function statusLabel(status: ModyConnectedWorkTriggerStatus): string {
  if (status === "ai_jobs_ready") return "AI 작업 준비";
  if (status === "needs_connection") return "연결 필요";
  return "새 변경 없음";
}

function defaultCadenceMinutes(mode: ModyConnectedWorkTriggerMode): number {
  if (mode === "webhook") return 60;
  if (mode === "scheduled") return 30;
  return 10;
}

function scheduleLabelFor(
  mode: ModyConnectedWorkTriggerMode,
  cadenceMinutes: number,
  nextCheckAt: ISODateTimeString,
): string {
  if (mode === "webhook") return `새 알림을 받되 ${cadenceMinutes}분마다 상태를 다시 확인합니다. 다음 확인 ${nextCheckAt}`;
  if (mode === "scheduled") return `${cadenceMinutes}분 간격으로 정해진 업무 체크를 실행합니다. 다음 확인 ${nextCheckAt}`;
  return `${cadenceMinutes}분마다 새 변경을 확인합니다. 다음 확인 ${nextCheckAt}`;
}

function compactDate(value: ISODateTimeString): string {
  return value.replace(/[^0-9]/gu, "");
}
