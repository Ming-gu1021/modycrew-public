import type {
  ISODateTimeString,
  ModyAuditEntry,
  ModyChannelId,
  ToolActionRequest,
  ToolRiskLabel,
  WorkItem,
  WorkItemStatus,
} from "./types.js";

export type ModyWorkActivityChannelReport = {
  id: string;
  channelId: ModyChannelId;
  text: string;
  createdAt?: ISODateTimeString;
};

export type ModyWorkActivityReportInput = {
  id?: string;
  title?: string;
  workspaceLabel?: string;
  periodLabel?: string;
  periodStart?: ISODateTimeString;
  periodEnd?: ISODateTimeString;
  generatedAt?: ISODateTimeString;
  workItems: WorkItem[];
  auditEntries?: ModyAuditEntry[];
  channelReports?: ModyWorkActivityChannelReport[];
  notes?: string[];
};

export type ModyWorkActivityReportSummary = {
  totalWorkItems: number;
  completedWorkItems: number;
  approvalPendingWorkItems: number;
  blockedWorkItems: number;
  reviewNeededWorkItems: number;
  externalMutationCandidates: number;
  approvalRequiredActions: number;
  blockedActions: number;
  auditEventCount: number;
  channelReportCount: number;
  statusCounts: Record<WorkItemStatus, number>;
  headline: string;
  workMethodSummary: string;
};

export type ModyWorkActivityReportWorkRow = {
  id: string;
  title: string;
  sourceLabel: string;
  status: WorkItemStatus;
  statusLabel: string;
  riskLabel: ToolRiskLabel;
  riskLabelText: string;
  summary: string;
  createdAt: ISODateTimeString;
  updatedAt?: ISODateTimeString;
  actionLabels: string[];
  approvalRequiredActionIds: string[];
  externalMutationActionIds: string[];
};

export type ModyWorkActivityReportActionRow = {
  id: string;
  workItemId: string;
  workItemTitle: string;
  label: string;
  operationKind: ToolActionRequest["operationKind"];
  riskLabel: ToolRiskLabel;
  requiresApproval: boolean;
  externalMutation: boolean;
  statusLabel: string;
};

export type ModyWorkActivityReportTimelineRow = {
  id: string;
  createdAt: ISODateTimeString;
  actor: ModyAuditEntry["actor"] | "report";
  label: string;
  message: string;
};

export type ModyWorkActivityReportPrivacy = {
  rawSecretMaterialIncluded: false;
  redactedFieldsCount: number;
  boundaryMessage: string;
};

export type ModyWorkActivityReport = {
  id: string;
  title: string;
  workspaceLabel: string;
  periodLabel: string;
  generatedAt: ISODateTimeString;
  periodStart?: ISODateTimeString;
  periodEnd?: ISODateTimeString;
  summary: ModyWorkActivityReportSummary;
  workRows: ModyWorkActivityReportWorkRow[];
  actionRows: ModyWorkActivityReportActionRow[];
  timeline: ModyWorkActivityReportTimelineRow[];
  channelReports: ModyWorkActivityChannelReport[];
  nextActions: string[];
  notes: string[];
  privacy: ModyWorkActivityReportPrivacy;
};

const statusLabels: Record<WorkItemStatus, string> = {
  pending: "대기",
  analyzing: "분석 중",
  draft_ready: "초안 준비",
  needs_review: "확인 필요",
  approval_pending: "승인 대기",
  completed: "완료",
  change_requested: "수정 요청",
  held: "보류",
  rejected: "거절",
};

const riskLabels: Record<ToolRiskLabel, string> = {
  low: "일반 업무",
  medium: "확인 필요",
  high: "위험 확인",
  blocked: "실행 차단",
};

const sourceLabels: Record<WorkItem["source"], string> = {
  local_file: "로컬 파일",
  uploaded_file: "업로드 파일",
  email: "메일",
  calendar: "캘린더",
  web_page: "웹 페이지",
  drive_file: "드라이브 파일",
  manual_note: "메모",
  manual_input: "직접 입력",
  messaging_command: "메신저 명령",
  business_system: "회사 시스템",
};

const statuses: WorkItemStatus[] = [
  "pending",
  "analyzing",
  "draft_ready",
  "needs_review",
  "approval_pending",
  "completed",
  "change_requested",
  "held",
  "rejected",
];

type BuilderOptions = {
  now?: () => Date;
};

class ReportSanitizer {
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
          return replacement(args[0] ?? "", ...(args.slice(1, -2)));
        }
        return replacement;
      });
    }

    return output;
  }

  sanitizeList(values: readonly string[]): string[] {
    return values.map((value) => this.sanitize(value));
  }
}

export class ModyWorkActivityReportBuilder {
  private readonly now: () => Date;

  constructor(options: BuilderOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createReport(input: ModyWorkActivityReportInput): ModyWorkActivityReport {
    const sanitizer = new ReportSanitizer();
    const generatedAt = input.generatedAt ?? this.now().toISOString();
    const workRows = input.workItems.map((item) => this.createWorkRow(item, sanitizer));
    const actionRows = input.workItems.flatMap((item) => this.createActionRows(item, sanitizer));
    const timeline = this.createTimeline(input.auditEntries ?? [], sanitizer);
    const statusCounts = createStatusCounts(input.workItems);
    const externalMutationCandidates = actionRows.filter((row) => row.externalMutation).length;
    const approvalRequiredActions = actionRows.filter((row) => row.requiresApproval).length;
    const blockedActions = actionRows.filter((row) => row.riskLabel === "blocked").length;
    const completedWorkItems = statusCounts.completed;
    const approvalPendingWorkItems = statusCounts.approval_pending;
    const blockedWorkItems = input.workItems.filter((item) =>
      item.riskLabel === "blocked" ||
      item.toolActionRequests.some((request) => request.riskLabel === "blocked"),
    ).length;
    const reviewNeededWorkItems =
      statusCounts.needs_review +
      statusCounts.change_requested +
      statusCounts.held +
      input.workItems.filter((item) => item.riskLabel === "medium" || item.riskLabel === "high").length;
    const periodLabel = sanitizer.sanitize(input.periodLabel ?? "오늘");
    const title = sanitizer.sanitize(input.title ?? `${periodLabel} 업무 활동 보고서`);
    const workspaceLabel = sanitizer.sanitize(input.workspaceLabel ?? "ModyCrew 작업공간");
    const summary: ModyWorkActivityReportSummary = {
      totalWorkItems: input.workItems.length,
      completedWorkItems,
      approvalPendingWorkItems,
      blockedWorkItems,
      reviewNeededWorkItems,
      externalMutationCandidates,
      approvalRequiredActions,
      blockedActions,
      auditEventCount: input.auditEntries?.length ?? 0,
      channelReportCount: input.channelReports?.length ?? 0,
      statusCounts,
      headline: buildHeadline({
        periodLabel,
        totalWorkItems: input.workItems.length,
        completedWorkItems,
        approvalPendingWorkItems,
        blockedWorkItems,
        externalMutationCandidates,
      }),
      workMethodSummary:
        "입력/연결에서 들어온 일을 읽고 분류한 뒤, 답장·일정·자료 후보를 만들고 승인함과 감사 기록에 남겼습니다.",
    };

    const report: ModyWorkActivityReport = {
      id: input.id ?? `work_activity_report_${generatedAt.replace(/[^0-9]/gu, "")}`,
      title,
      workspaceLabel,
      periodLabel,
      generatedAt,
      summary,
      workRows,
      actionRows,
      timeline,
      channelReports: (input.channelReports ?? []).map((reportItem) => this.createChannelReport(reportItem, sanitizer)),
      nextActions: buildNextActions(summary).map((item) => sanitizer.sanitize(item)),
      notes: sanitizer.sanitizeList(input.notes ?? []),
      privacy: {
        rawSecretMaterialIncluded: false,
        redactedFieldsCount: sanitizer.redactedFieldsCount,
        boundaryMessage: "보고서는 업무 제목, 상태, 승인 경계, 감사 메시지만 포함하고 API key/token/password 원문은 제거합니다.",
      },
    };

    if (input.periodStart) {
      report.periodStart = input.periodStart;
    }

    if (input.periodEnd) {
      report.periodEnd = input.periodEnd;
    }

    return report;
  }

  renderMarkdown(report: ModyWorkActivityReport): string {
    const lines = [
      `# ${report.title}`,
      "",
      `- 작업공간: ${report.workspaceLabel}`,
      `- 기간: ${report.periodLabel}`,
      `- 생성 시각: ${report.generatedAt}`,
      `- 원문 secret 포함: \`${report.privacy.rawSecretMaterialIncluded}\``,
      `- secret 제거 횟수: \`${report.privacy.redactedFieldsCount}\``,
      "",
      "## 요약",
      "",
      report.summary.headline,
      "",
      `- 처리 방식: ${report.summary.workMethodSummary}`,
      `- 전체 업무: ${report.summary.totalWorkItems}건`,
      `- 완료: ${report.summary.completedWorkItems}건`,
      `- 승인 대기: ${report.summary.approvalPendingWorkItems}건`,
      `- 실행 차단: ${report.summary.blockedWorkItems}건`,
      `- 외부 변경 후보: ${report.summary.externalMutationCandidates}건`,
      `- 감사 이벤트: ${report.summary.auditEventCount}건`,
      "",
      "## 업무별 처리",
      "",
    ];

    if (report.workRows.length === 0) {
      lines.push("- 아직 보고할 업무가 없습니다.");
    } else {
      for (const row of report.workRows) {
        lines.push(
          `- ${row.title} / ${row.sourceLabel} / ${row.statusLabel} / ${row.riskLabelText}`,
          `  - 요약: ${row.summary}`,
          `  - 요청 처리: ${row.actionLabels.length > 0 ? row.actionLabels.join(", ") : "기록 없음"}`,
        );
      }
    }

    lines.push("", "## 승인과 실행 경계", "");
    if (report.actionRows.length === 0) {
      lines.push("- 승인 대기 또는 외부 변경 후보가 없습니다.");
    } else {
      for (const action of report.actionRows) {
        lines.push(
          `- ${action.workItemTitle}: ${action.label} / \`${action.operationKind}\` / ${action.statusLabel}`,
        );
      }
    }

    lines.push("", "## 작업 기록", "");
    if (report.timeline.length === 0) {
      lines.push("- 아직 감사 기록이 없습니다.");
    } else {
      for (const item of report.timeline) {
        lines.push(`- ${item.createdAt} · ${item.label}: ${item.message}`);
      }
    }

    lines.push("", "## 다음 조치", "", ...report.nextActions.map((item) => `- ${item}`));

    if (report.notes.length > 0) {
      lines.push("", "## 메모", "", ...report.notes.map((item) => `- ${item}`));
    }

    lines.push(
      "",
      "## 보안 경계",
      "",
      `- ${report.privacy.boundaryMessage}`,
      "- 외부 메일 발송, 캘린더 등록, 파일 공유, 공공기관 제출은 보고서 생성만으로 실행하지 않습니다.",
    );

    return `${lines.join("\n")}\n`;
  }

  private createWorkRow(item: WorkItem, sanitizer: ReportSanitizer): ModyWorkActivityReportWorkRow {
    const actionLabels = item.toolActionRequests.map((request) => sanitizer.sanitize(request.userVisibleDescription));
    const approvalRequiredActionIds = item.toolActionRequests
      .filter((request) => request.requiresApproval)
      .map((request) => request.id);
    const externalMutationActionIds = item.toolActionRequests
      .filter((request) => request.externalMutation)
      .map((request) => request.id);

    const row: ModyWorkActivityReportWorkRow = {
      id: item.id,
      title: sanitizer.sanitize(item.title),
      sourceLabel: sourceLabels[item.source] ?? "업무",
      status: item.status,
      statusLabel: statusLabels[item.status],
      riskLabel: item.riskLabel,
      riskLabelText: riskLabels[item.riskLabel],
      summary: sanitizer.sanitize(item.body),
      createdAt: item.createdAt,
      actionLabels,
      approvalRequiredActionIds,
      externalMutationActionIds,
    };

    if (item.updatedAt) {
      row.updatedAt = item.updatedAt;
    }

    return row;
  }

  private createActionRows(item: WorkItem, sanitizer: ReportSanitizer): ModyWorkActivityReportActionRow[] {
    return item.toolActionRequests
      .filter((request) => request.requiresApproval || request.externalMutation || request.riskLabel !== "low")
      .map((request) => ({
        id: request.id,
        workItemId: item.id,
        workItemTitle: sanitizer.sanitize(item.title),
        label: sanitizer.sanitize(request.userVisibleDescription),
        operationKind: request.operationKind,
        riskLabel: request.riskLabel,
        requiresApproval: request.requiresApproval,
        externalMutation: request.externalMutation,
        statusLabel: statusLabelForAction(request),
      }));
  }

  private createTimeline(entries: readonly ModyAuditEntry[], sanitizer: ReportSanitizer): ModyWorkActivityReportTimelineRow[] {
    return [...entries]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        actor: entry.actor,
        label: auditEventLabel(entry.eventType),
        message: sanitizer.sanitize(entry.message),
      }))
      .slice(-12);
  }

  private createChannelReport(
    report: ModyWorkActivityChannelReport,
    sanitizer: ReportSanitizer,
  ): ModyWorkActivityChannelReport {
    const sanitized: ModyWorkActivityChannelReport = {
      id: report.id,
      channelId: report.channelId,
      text: sanitizer.sanitize(report.text),
    };

    if (report.createdAt) {
      sanitized.createdAt = report.createdAt;
    }

    return sanitized;
  }
}

function createStatusCounts(workItems: readonly WorkItem[]): Record<WorkItemStatus, number> {
  const counts: Record<WorkItemStatus, number> = {
    pending: 0,
    analyzing: 0,
    draft_ready: 0,
    needs_review: 0,
    approval_pending: 0,
    completed: 0,
    change_requested: 0,
    held: 0,
    rejected: 0,
  };

  for (const item of workItems) {
    counts[item.status] += 1;
  }

  return counts;
}

function statusLabelForAction(request: ToolActionRequest): string {
  if (request.riskLabel === "blocked") return "실행 차단";
  if (request.externalMutation && request.requiresApproval) return "승인 후 실행";
  if (request.requiresApproval) return "승인 필요";
  if (request.externalMutation) return "외부 변경 후보";
  return "자동 기록";
}

function auditEventLabel(eventType: ModyAuditEntry["eventType"]): string {
  if (eventType === "tool_requested") return "작업 요청";
  if (eventType === "tool_blocked") return "실행 차단";
  if (eventType === "approval_required") return "승인 대기";
  if (eventType === "approval_decided") return "승인 결정";
  if (eventType === "tool_completed") return "작업 완료";
  if (eventType === "tool_failed") return "작업 실패";
  if (eventType === "risk_detected") return "위험 감지";
  if (eventType === "document_ingested") return "문서 학습";
  if (eventType === "channel_message_received") return "채널 수신";
  if (eventType === "channel_intent_parsed") return "명령 분석";
  return "채널 결정";
}

function buildHeadline(input: {
  periodLabel: string;
  totalWorkItems: number;
  completedWorkItems: number;
  approvalPendingWorkItems: number;
  blockedWorkItems: number;
  externalMutationCandidates: number;
}): string {
  if (input.totalWorkItems === 0) {
    return `${input.periodLabel} ModyCrew로 처리한 업무가 아직 없습니다. 업무를 넣으면 처리 방식과 승인 경계가 보고서로 정리됩니다.`;
  }

  return [
    `${input.periodLabel} ModyCrew로 업무 ${input.totalWorkItems}건을 처리했습니다.`,
    `완료 ${input.completedWorkItems}건, 승인 대기 ${input.approvalPendingWorkItems}건, 실행 차단 ${input.blockedWorkItems}건입니다.`,
    `외부 변경 후보 ${input.externalMutationCandidates}건은 보고서에 남기되 자동 실행하지 않았습니다.`,
  ].join(" ");
}

function buildNextActions(summary: ModyWorkActivityReportSummary): string[] {
  if (summary.totalWorkItems === 0) {
    return ["메일, 문의, 예약 요청을 넣으면 다음 보고서에서 처리 내역을 확인합니다."];
  }

  const nextActions: string[] = [];

  if (summary.approvalPendingWorkItems > 0) {
    nextActions.push(`승인함에서 ${summary.approvalPendingWorkItems}건의 답장/일정 후보를 확인합니다.`);
  }

  if (summary.blockedWorkItems > 0 || summary.blockedActions > 0) {
    nextActions.push("실행 차단 업무는 공공기관, 세무, 계약, 개인정보 위험 사유를 먼저 확인합니다.");
  }

  if (summary.reviewNeededWorkItems > 0) {
    nextActions.push("확인 필요 업무는 원문과 관련 문서를 검토한 뒤 수정 요청 또는 보류로 정리합니다.");
  }

  if (summary.completedWorkItems > 0) {
    nextActions.push("완료된 업무는 주간/월간 운영 보고서의 처리 근거로 재사용합니다.");
  }

  return nextActions;
}
