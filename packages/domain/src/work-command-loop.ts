import { ModyAgentRuntime } from "./agent-runtime.js";
import { ModyChannelHub } from "./channel-hub.js";
import { createToolActionRequest } from "./policy.js";
import type {
  AgentPlan,
  ISODateTimeString,
  ModyChannelDecision,
  ModyChannelMessage,
  ModyChannelSafetyResult,
  ModyCommandIntent,
  ModyOutboundMessage,
  ToolActionRequest,
  ToolRiskLabel,
  WorkItem,
  WorkItemStatus,
} from "./types.js";
import { modyPolicyVersion } from "./types.js";

export type ModyWorkCommandLoopStatus =
  | "work_planned"
  | "approval_recorded"
  | "app_reconfirm_required"
  | "blocked"
  | "needs_clarification";

export type ModyWorkCommandLoopInput = {
  message: ModyChannelMessage;
  pendingApprovalRequest?: ToolActionRequest;
  appDeepLinkBase?: string;
};

export type ModyWorkCommandLoopResult = {
  id: string;
  status: ModyWorkCommandLoopStatus;
  intent: ModyCommandIntent;
  safety: ModyChannelSafetyResult;
  workItem: WorkItem;
  agentPlan: AgentPlan;
  approvalQueue: ToolActionRequest[];
  channelDecision?: ModyChannelDecision;
  outboundReport: ModyOutboundMessage;
  timeline: string[];
  auditMessages: string[];
};

type WorkCommandLoopOptions = {
  now?: () => Date;
};

export class ModyWorkCommandLoop {
  private readonly now: () => Date;
  private readonly channelHub: ModyChannelHub;
  private readonly agentRuntime: ModyAgentRuntime;

  constructor(options: WorkCommandLoopOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.channelHub = new ModyChannelHub({ now: this.now });
    this.agentRuntime = new ModyAgentRuntime({ now: this.now });
  }

  process(input: ModyWorkCommandLoopInput): ModyWorkCommandLoopResult {
    const createdAt = this.now().toISOString();
    const intent = this.channelHub.parseIntent(input.message);
    const fallbackRequest = input.pendingApprovalRequest ?? this.createFallbackApprovalRequest(intent, createdAt);
    const safety = this.channelHub.evaluateChannelSafety(intent, fallbackRequest);
    const channelDecision = this.channelHub.createDecision(intent, input.message.senderId, safety);
    const workItem = this.createWorkItem(input.message, intent, fallbackRequest, safety, createdAt);
    const agentPlan = this.agentRuntime.plan({
      id: workItem.id,
      title: workItem.title,
      body: workItem.body,
      createdAt,
    });
    const approvalQueue = mergeApprovalQueue(agentPlan.approvalQueue, fallbackRequest, safety);
    const outboundReport = this.createOutboundReport(intent, safety, approvalQueue, input);
    const status = statusForLoop(intent, safety, channelDecision, agentPlan);

    return {
      id: `work_command_loop_${input.message.id}`,
      status,
      intent,
      safety,
      workItem: {
        ...workItem,
        status: workItemStatusFor(status, approvalQueue.length),
        toolActionRequests: agentPlan.steps.map((step) => step.action),
        riskLabel: highestRisk([workItem.riskLabel, ...agentPlan.steps.map((step) => step.action.riskLabel)]),
      },
      agentPlan,
      approvalQueue,
      ...(channelDecision ? { channelDecision } : {}),
      outboundReport,
      timeline: timelineFor(intent, status, approvalQueue),
      auditMessages: auditMessagesFor(intent, safety, status, approvalQueue),
    };
  }

  private createFallbackApprovalRequest(
    intent: ModyCommandIntent,
    createdAt: ISODateTimeString,
  ): ToolActionRequest | undefined {
    if (!isDecisionIntent(intent.kind)) return undefined;

    const requestId = intent.targetActionRequestId ?? intent.targetWorkItemId;
    if (!requestId) return undefined;

    return createToolActionRequest({
      id: requestId,
      toolName: "mody.pending.external-action",
      permissionLevel: "execute",
      operationKind: "send_email",
      inputSummary: `메신저에서 승인 대상으로 언급된 요청: ${requestId}`,
      expectedImpact: "외부 발송 또는 일정 등록처럼 사용자 계정 밖에 변경을 만들 수 있습니다.",
      userVisibleDescription: "메신저에서 승인 대상으로 언급된 외부 실행 요청",
      createdAt,
      externalMutation: true,
      requiresApproval: true,
    });
  }

  private createWorkItem(
    message: ModyChannelMessage,
    intent: ModyCommandIntent,
    fallbackRequest: ToolActionRequest | undefined,
    safety: ModyChannelSafetyResult,
    createdAt: ISODateTimeString,
  ): WorkItem {
    const title = titleForIntent(intent, fallbackRequest);

    return {
      id: `work_command_${message.id}`,
      title,
      source: "messaging_command",
      body: bodyForIntent(intent, message, fallbackRequest),
      status: safety.requiresAppReconfirm ? "approval_pending" : "draft_ready",
      riskLabel: fallbackRequest?.riskLabel ?? (safety.requiresAppReconfirm ? "medium" : "low"),
      riskSignals: [],
      toolActionRequests: fallbackRequest ? [fallbackRequest] : [],
      policyVersion: modyPolicyVersion,
      createdAt,
    };
  }

  private createOutboundReport(
    intent: ModyCommandIntent,
    safety: ModyChannelSafetyResult,
    approvalQueue: ToolActionRequest[],
    input: ModyWorkCommandLoopInput,
  ): ModyOutboundMessage {
    const appDeepLink = input.appDeepLinkBase
      ? `${input.appDeepLinkBase.replace(/\/$/, "")}/${encodeURIComponent(intent.id)}`
      : undefined;
    const baseReport = this.channelHub.createOutboundMessage(intent, safety, {
      ...(input.message.threadId ? { threadId: input.message.threadId } : {}),
      ...(appDeepLink ? { appDeepLink } : {}),
    });

    return {
      ...baseReport,
      text: reportTextFor(intent, safety, approvalQueue),
      actionLabels: actionLabelsForLoop(intent, safety, approvalQueue),
    };
  }
}

function isDecisionIntent(kind: ModyCommandIntent["kind"]): boolean {
  return (
    kind === "approve_action" ||
    kind === "request_change" ||
    kind === "hold_action" ||
    kind === "reject_action"
  );
}

function titleForIntent(intent: ModyCommandIntent, fallbackRequest?: ToolActionRequest): string {
  if (intent.kind === "summarize_today") return "메신저 요청: 오늘 업무 보고";
  if (intent.kind === "list_pending_approvals") return "메신저 요청: 승인 대기 확인";
  if (intent.kind === "summarize_calendar") return "메신저 요청: 가능 시간 요약";
  if (intent.kind === "draft_calendar_event") return "메신저 요청: 일정 후보 작성";
  if (intent.kind === "search_documents") return `메신저 요청: 문서 찾기${intent.query ? ` - ${intent.query}` : ""}`;
  if (intent.kind === "draft_reply") return "메신저 요청: 답장 초안 작성";
  if (isDecisionIntent(intent.kind)) {
    return `메신저 승인 의사 기록: ${fallbackRequest?.userVisibleDescription ?? "대상 확인 필요"}`;
  }
  return "메신저 요청: 앱에서 확인 필요";
}

function bodyForIntent(
  intent: ModyCommandIntent,
  message: ModyChannelMessage,
  fallbackRequest?: ToolActionRequest,
): string {
  const prefix = `메신저 ${message.channelId}에서 받은 명령: ${message.text}`;

  if (intent.kind === "draft_calendar_event") {
    return `${prefix}\n내 일정과 예약 요청을 비교해 일정 후보를 만들고, 확정 가능한 항목은 캘린더 등록 승인 대기 카드로 분리합니다.`;
  }

  if (intent.kind === "summarize_calendar") {
    return `${prefix}\n내 캘린더를 읽어 가능한 시간과 충돌 일정을 요약합니다. 일정 등록은 하지 않습니다.`;
  }

  if (intent.kind === "search_documents") {
    return `${prefix}\n컴퓨터 자료와 업무 문서에서 관련 문서를 검색하고 출처를 붙여 요약합니다.`;
  }

  if (intent.kind === "list_pending_approvals") {
    return `${prefix}\n승인함의 외부 발송, 일정 등록, 파일 공유 대기 항목을 요약합니다.`;
  }

  if (isDecisionIntent(intent.kind)) {
    return `${prefix}\n대상 요청 ${
      fallbackRequest?.id ?? "미확인"
    }에 대한 채널 의사를 기록합니다. 실제 외부 실행은 앱 최종 확인이 필요합니다.`;
  }

  return `${prefix}\n요청을 업무 인박스 항목으로 바꾸고 필요한 초안과 다음 조치를 정리합니다.`;
}

function mergeApprovalQueue(
  runtimeQueue: ToolActionRequest[],
  fallbackRequest: ToolActionRequest | undefined,
  safety: ModyChannelSafetyResult,
): ToolActionRequest[] {
  const queue = [...runtimeQueue];
  if (fallbackRequest && safety.requiresAppReconfirm && !queue.some((request) => request.id === fallbackRequest.id)) {
    queue.push(fallbackRequest);
  }
  return queue;
}

function statusForLoop(
  intent: ModyCommandIntent,
  safety: ModyChannelSafetyResult,
  channelDecision: ModyChannelDecision | undefined,
  agentPlan: AgentPlan,
): ModyWorkCommandLoopStatus {
  if (!safety.canRecordDecision && safety.requiresAppReconfirm) return "blocked";
  if (channelDecision && safety.requiresAppReconfirm) return "app_reconfirm_required";
  if (channelDecision) return "approval_recorded";
  if (agentPlan.blocked) return "blocked";
  if (intent.kind === "unknown") return "needs_clarification";
  return "work_planned";
}

function workItemStatusFor(status: ModyWorkCommandLoopStatus, approvalQueueLength: number): WorkItemStatus {
  if (status === "blocked") return "needs_review";
  if (status === "needs_clarification") return "needs_review";
  if (status === "app_reconfirm_required" || approvalQueueLength > 0) return "approval_pending";
  if (status === "approval_recorded") return "approval_pending";
  return "draft_ready";
}

function highestRisk(labels: ToolRiskLabel[]): ToolRiskLabel {
  if (labels.includes("blocked")) return "blocked";
  if (labels.includes("high")) return "high";
  if (labels.includes("medium")) return "medium";
  return "low";
}

function reportTextFor(
  intent: ModyCommandIntent,
  safety: ModyChannelSafetyResult,
  approvalQueue: ToolActionRequest[],
): string {
  if (intent.kind === "draft_calendar_event") {
    return "일정 후보를 만들고 승인 대기 카드로 분리했습니다. 캘린더 등록은 앱에서 최종 확인하면 진행합니다.";
  }

  if (intent.kind === "search_documents") {
    return "관련 문서를 찾는 작업 후보를 만들었습니다. 검색 결과는 앱에서 출처와 함께 확인합니다.";
  }

  if (intent.kind === "list_pending_approvals") {
    return "승인 대기 항목을 요약했습니다. 외부 발송, 일정 등록, 파일 공유는 앱에서 다시 확인합니다.";
  }

  if (isDecisionIntent(intent.kind)) {
    if (!safety.canRecordDecision) {
      return "고위험 작업은 메신저 승인만으로 기록하거나 실행할 수 없습니다. 앱에서 차단 사유를 확인해야 합니다.";
    }

    return approvalQueue.length > 0
      ? "승인 의사는 기록했지만 외부 실행은 앱 최종 확인이 필요합니다."
      : "채널에서 받은 결정을 기록했습니다. 필요한 경우 앱에서 상세 내용을 확인합니다.";
  }

  return "메신저 명령을 업무 후보로 바꿨습니다. 필요한 초안과 다음 조치는 앱에서 확인합니다.";
}

function actionLabelsForLoop(
  intent: ModyCommandIntent,
  safety: ModyChannelSafetyResult,
  approvalQueue: ToolActionRequest[],
): string[] {
  if (!safety.canRecordDecision && safety.requiresAppReconfirm) {
    return ["앱에서 차단 사유 보기", "담당자에게 넘기기"];
  }

  if (approvalQueue.length > 0 || safety.requiresAppReconfirm) {
    return ["앱에서 최종 확인", "수정 요청", "보류"];
  }

  if (intent.kind === "search_documents") return ["문서 결과 보기", "다시 검색"];
  if (intent.kind === "summarize_today") return ["오늘 업무 보기", "승인함 보기"];
  return ["앱에서 보기"];
}

function timelineFor(
  intent: ModyCommandIntent,
  status: ModyWorkCommandLoopStatus,
  approvalQueue: ToolActionRequest[],
): string[] {
  const timeline = [
    "메신저 명령 수신",
    `의도 분류: ${intent.kind}`,
    "업무 인박스 후보 생성",
  ];

  if (approvalQueue.length > 0) {
    timeline.push(`승인 대기 ${approvalQueue.length}건 분리`);
  }

  timeline.push(status === "blocked" ? "앱에서 차단 사유 확인" : "메신저 보고 초안 생성");
  return timeline;
}

function auditMessagesFor(
  intent: ModyCommandIntent,
  safety: ModyChannelSafetyResult,
  status: ModyWorkCommandLoopStatus,
  approvalQueue: ToolActionRequest[],
): string[] {
  return [
    `메신저 명령을 ${intent.kind} 의도로 해석했습니다.`,
    safety.userMessage,
    `외부 실행 가능 여부: ${safety.canExecuteFromChannel ? "가능" : "불가"}`,
    `승인 대기 분리: ${approvalQueue.length}건`,
    `루프 상태: ${status}`,
  ];
}
