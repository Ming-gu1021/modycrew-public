"use client";

import type { TriggerRuleRecord } from "./desktop-bridge";
import type { LocalAutomationRule } from "./local-automation-rules";
import type { WorkItem } from "./types";

export type WorkPackDesktopTriggerRuleInput = Partial<TriggerRuleRecord> & {
  id: string;
};

type ConnectorReadiness = {
  id: string;
  label: string;
  kind: "mail" | "calendar" | "file" | "message" | "inquiry" | "business_system";
  statusLabel: string;
  nextAction: string;
  reason: string;
};

export function createDesktopTriggerRuleFromLocalRule(
  rule: LocalAutomationRule,
): WorkPackDesktopTriggerRuleInput {
  const primaryConnectorId = rule.connectorIds[0] ?? "generic-inquiry-site";
  const triggerKind = inferTriggerKind(rule);
  const sourceKind = inferSourceKind(rule, primaryConnectorId);
  const notificationChannels = rule.notificationChannels ?? {};

  return {
    id: rule.id,
    label: rule.title,
    connectorId: normalizeConnectorId(primaryConnectorId),
    sourceKind,
    triggerKind,
    mode: rule.mode === "polling" ? "polling" : "polling",
    enabled: rule.enabled,
    cadenceMinutes: normalizeCadence(rule.cadenceMinutes),
    notifyPolicy: triggerKind === "scheduled_check" ? "digest_only" : "important_only",
    actionPolicy: triggerKind === "scheduled_check" ? "digest_report" : "queue_ai_review",
    notificationChannels: {
      appInbox: notificationChannels.appInbox !== false,
      os: notificationChannels.os === true,
      telegram: notificationChannels.telegram === true,
    },
    learningProfileSummary: sanitizeLearningEvidenceLabel(rule.latestRunMessage ?? ""),
    learningProfileEvidenceLabels: buildLearningProfileEvidenceLabels(rule),
    learningProfileContract: rule.provenance?.evidenceLabels?.includes("profile_to_5m_polling_to_approval_queue")
      ? "initial_profile_to_secure_mail_polling_rule_goal_output_provenance"
      : "",
    learningProfilePersistPolicy: rule.provenance?.evidenceLabels?.includes("safe_labels_only_user_approved")
      ? "safe_labels_only_user_approved"
      : "",
  };
}

export function createWorkPackLocalCheckWorkItem(
  rule: LocalAutomationRule,
  createdAt = new Date().toISOString(),
): WorkItem {
  const connectorLabel = rule.connectorLabels.join(", ") || "연결 대기";
  const connectorReadiness = createConnectorReadiness(rule);
  const connectorChecklist = connectorReadiness.map((connector) => connector.statusLabel);
  const connectorStatusLines = connectorReadiness.map(
    (connector) => `${connector.label}: ${connector.statusLabel} · ${connector.nextAction}`,
  );
  return {
    id: `local-automation-work-pack-check-${rule.id}-${compactDate(createdAt)}`,
    title: `${rule.title} 승인 대기 후보`,
    source: "manual_input",
    sourceLabel: "업무팩 점검 결과",
    senderLabel: "ModyCrew",
    body: [
      `${rule.trigger} 기준으로 승인 대기 업무 후보를 만들었습니다.`,
      `필요 연결: ${connectorLabel}`,
      `연결 준비표: ${connectorChecklist.join(" / ")}`,
      `연결별 상태: ${connectorStatusLines.join(" / ")}`,
      `승인 경계: ${rule.approval}`,
      "미리보기에서는 실제 메일/파일/캘린더를 읽지 않고, 설치 앱에서 같은 규칙을 반복 점검 목록으로 넘깁니다.",
    ].join("\n"),
    summary: `${rule.output} · 연결별 상태 ${connectorChecklist.length}개 · 승인 대기 카드 생성`,
    status: "approval_pending",
    riskLabel: "medium",
    riskSignals: [
      ...connectorReadiness.slice(0, 4).map((connector, index) => ({
        id: `${rule.id}:connector-${index + 1}`,
        label: connector.statusLabel,
        riskLabel: "medium" as const,
        reason: connector.reason,
      })),
      {
        id: `${rule.id}:desktop-runtime`,
        label: "설치 앱 점검 필요",
        riskLabel: "medium",
        reason: "실제 업무툴 읽기와 새 업무 생성은 설치된 데스크톱 앱에서만 실행합니다.",
      },
      {
        id: `${rule.id}:approval-boundary`,
        label: "승인 경계 유지",
        riskLabel: "medium",
        reason: rule.approval,
      },
    ],
    receivedAt: createdAt,
    draft: {
      id: `${rule.id}:check-draft`,
      toneLabel: "점검 후보",
      body: [
        `점검 규칙: ${rule.title}`,
        `감지 기준: ${rule.trigger}`,
        `만들 결과: ${rule.output}`,
        `연결 확인: ${connectorChecklist.join(", ")}`,
        ...connectorStatusLines.map((line) => `다음 액션: ${line}`),
        `승인 경계: ${rule.approval}`,
        "외부 발송, 일정 등록, 파일 공유는 승인 전 실행하지 않습니다.",
      ].join("\n"),
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
  };
}

export function createWorkPackRuntimeMessage(rule: LocalAutomationRule, desktopAvailable: boolean) {
  if (desktopAvailable) {
    return `${rule.title} 규칙을 설치 앱의 반복 점검 목록에 저장하고 지금 점검을 실행했습니다.`;
  }
  return `${rule.title} 승인 대기 후보 1건을 만들었습니다. 실제 메일/파일/캘린더 읽기는 설치 앱에서 실행됩니다.`;
}

function createConnectorReadiness(rule: LocalAutomationRule): ConnectorReadiness[] {
  const connectorIds = rule.connectorIds.length ? rule.connectorIds : ["generic-inquiry-site"];
  return connectorIds.map((connectorId, index) =>
    createConnectorReadinessItem(
      connectorId,
      rule.connectorLabels[index] || connectorId.replace(/[-_]/gu, " "),
    ),
  );
}

function buildLearningProfileEvidenceLabels(rule: LocalAutomationRule): string[] {
  const labels = [
    ...(rule.provenance?.evidenceLabels ?? []),
    rule.latestRunMessage ?? "",
  ];
  return [...new Set(labels.map(sanitizeLearningEvidenceLabel).filter(isLearningEvidenceLabel))].slice(0, 8);
}

function sanitizeLearningEvidenceLabel(value: string): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/gu, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/gu, "[redacted-key]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 96);
}

function isLearningEvidenceLabel(label: string): boolean {
  return /initial|profile|learning|학습|tone|말투|noise|광고|뉴스레터|bulk|대량|approval|승인|sample|샘플|safe_labels/iu.test(label);
}

function createConnectorReadinessItem(connectorId: string, label: string): ConnectorReadiness {
  const kind = inferConnectorKind(connectorId, label);
  if (kind === "mail") {
    return {
      id: connectorId,
      label,
      kind,
      statusLabel: "메일 연결 필요",
      nextAction: "메일함 읽기 권한을 연결하면 문의/요청 메일을 실제로 가져옵니다.",
      reason: "메일 연결이 준비되면 설치 앱에서 새 메일을 읽고 답장 후보와 승인 대기 업무를 만들 수 있습니다.",
    };
  }
  if (kind === "calendar") {
    return {
      id: connectorId,
      label,
      kind,
      statusLabel: "캘린더 연결 필요",
      nextAction: "캘린더 읽기 권한을 연결하면 일정 충돌과 가능한 시간을 확인합니다.",
      reason: "캘린더 연결이 준비되면 기존 일정과 미팅 후보를 비교하고 등록 전 승인 후보를 만들 수 있습니다.",
    };
  }
  if (kind === "file") {
    return {
      id: connectorId,
      label,
      kind,
      statusLabel: "자료 폴더 연결 필요",
      nextAction: "로컬 폴더나 Drive 범위를 고르면 보고서/정산표/문서를 읽어 점검합니다.",
      reason: "자료 접근 범위가 준비되면 지정한 파일 안에서만 누락, 금액, 문서 초안 후보를 만들 수 있습니다.",
    };
  }
  if (kind === "message") {
    return {
      id: connectorId,
      label,
      kind,
      statusLabel: "메신저 연결 필요",
      nextAction: "Telegram/Slack 같은 알림 채널을 연결하면 승인 요청과 결과를 받을 수 있습니다.",
      reason: "메신저 연결이 준비되면 중요한 승인 대기와 일정 알림을 사용자가 고른 채널로 보낼 수 있습니다.",
    };
  }
  if (kind === "business_system") {
    return {
      id: connectorId,
      label,
      kind,
      statusLabel: "업무시스템 연결 필요",
      nextAction: "재고, 주문, 예약 같은 업무시스템 연결 범위를 먼저 확인합니다.",
      reason: "업무시스템 연결이 준비되면 주문, 재고, 예약 신호를 읽고 승인 전 업무 후보로 올릴 수 있습니다.",
    };
  }
  return {
    id: connectorId,
    label,
    kind,
    statusLabel: "문의 채널 연결 필요",
    nextAction: "홈페이지 문의, 폼, 공개 webhook을 연결하면 새 요청을 업무 카드로 바꿉니다.",
    reason: "문의 채널이 준비되면 새 문의를 감지하고 답장 초안과 담당자 확인 항목을 만들 수 있습니다.",
  };
}

function inferConnectorKind(
  connectorId: string,
  label: string,
): ConnectorReadiness["kind"] {
  const text = `${connectorId} ${label}`.toLowerCase();
  if (/gmail|mail|imap|outlook|메일/u.test(text)) return "mail";
  if (/calendar|캘린더|일정/u.test(text)) return "calendar";
  if (/folder|drive|file|document|pdf|excel|word|파일|문서|자료/u.test(text)) return "file";
  if (/telegram|slack|discord|kakao|line|messenger|메신저|알림/u.test(text)) return "message";
  if (/inventory|order|sales|pos|erp|crm|booking|재고|주문|예약|업무시스템/u.test(text)) {
    return "business_system";
  }
  return "inquiry";
}

function inferTriggerKind(rule: LocalAutomationRule) {
  const text = `${rule.title} ${rule.trigger} ${rule.output} ${rule.connectorIds.join(" ")}`.toLowerCase();
  if (/메일\s*자동|새\s*메일|메일함\s*메타데이터|mail\s*(arrived|received)|inbox/u.test(text)) {
    return "mail_arrived";
  }
  if (text.includes("일정") || text.includes("calendar") || text.includes("briefing") || text.includes("브리핑")) {
    return "scheduled_check";
  }
  if (text.includes("재고") || text.includes("inventory")) {
    return "inventory_low";
  }
  if (text.includes("메일") || text.includes("gmail") || text.includes("mail")) {
    return "mail_arrived";
  }
  return "inquiry_arrived";
}

function inferSourceKind(rule: LocalAutomationRule, connectorId: string) {
  const text = `${rule.title} ${rule.trigger} ${connectorId} ${rule.connectorIds.join(" ")}`.toLowerCase();
  if (text.includes("gmail") || text.includes("mail") || text.includes("imap")) return "mailbox";
  if (text.includes("calendar") || text.includes("일정")) return "work_schedule";
  if (text.includes("inventory") || text.includes("재고")) return "inventory_system";
  if (text.includes("sales") || text.includes("order") || text.includes("주문")) return "sales_system";
  return "business_inquiry";
}

function normalizeConnectorId(value: string) {
  return /^[a-z0-9][a-z0-9._-]{1,80}$/i.test(value) ? value : "generic-inquiry-site";
}

function normalizeCadence(value: number) {
  if ([5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].includes(value)) return value;
  return 30;
}

function compactDate(value: string) {
  return value.replace(/[^0-9]/gu, "").slice(0, 14);
}
