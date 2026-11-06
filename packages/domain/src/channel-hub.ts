import type {
  ApprovalDecision,
  ModyChannelDecision,
  ModyChannelMessage,
  ModyChannelSafetyResult,
  ModyCommandIntent,
  ModyCommandIntentKind,
  ModyOutboundMessage,
  ToolActionRequest,
} from "./types.js";
import { isMvpBlockedOperationKind, isExternalMutationRequest } from "./policy.js";

type ChannelHubOptions = {
  now?: () => Date;
};

export class ModyChannelHub {
  private readonly now: () => Date;

  constructor(options: ChannelHubOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  parseIntent(message: ModyChannelMessage): ModyCommandIntent {
    const rawText = normalizeCommandText(message.text);
    const intentKind = classifyIntent(rawText);
    const targetWorkItemId = extractWorkItemId(rawText);
    const targetActionRequestId = extractActionRequestId(rawText);
    const revisionInstruction = intentKind === "request_change" ? extractRevisionInstruction(rawText) : undefined;
    const query = intentKind === "search_documents" ? extractSearchQuery(rawText) : undefined;
    const intent: ModyCommandIntent = {
      id: `intent_${message.id}`,
      kind: intentKind,
      channelId: message.channelId,
      sourceMessageId: message.id,
      rawText: message.text,
      createdAt: this.now().toISOString(),
    };

    if (targetWorkItemId) intent.targetWorkItemId = targetWorkItemId;
    if (targetActionRequestId) intent.targetActionRequestId = targetActionRequestId;
    if (revisionInstruction) intent.revisionInstruction = revisionInstruction;
    if (query) intent.query = query;

    return intent;
  }

  evaluateChannelSafety(intent: ModyCommandIntent, request?: ToolActionRequest): ModyChannelSafetyResult {
    if (intent.kind === "draft_calendar_event") {
      return {
        intent,
        canRecordDecision: true,
        canExecuteFromChannel: false,
        requiresAppReconfirm: true,
        userMessage: "메신저에서 일정 후보를 요청할 수 있습니다. 실제 캘린더 등록은 앱에서 최종 확인합니다.",
      };
    }

    if (!isDecisionIntent(intent.kind)) {
      return {
        intent,
        canRecordDecision: true,
        canExecuteFromChannel: false,
        requiresAppReconfirm: false,
        userMessage: "이 채널에서 업무 요약, 문서 검색, 초안 요청을 처리할 수 있습니다.",
      };
    }

    if (!request) {
      return {
        intent,
        canRecordDecision: false,
        canExecuteFromChannel: false,
        requiresAppReconfirm: true,
        userMessage: "대상 승인 요청을 찾을 수 없어 앱에서 다시 확인해야 합니다.",
      };
    }

    if (isMvpBlockedOperationKind(request.operationKind) || request.permissionLevel === "dangerous_execute") {
      return {
        intent,
        canRecordDecision: intent.kind !== "approve_action",
        canExecuteFromChannel: false,
        requiresAppReconfirm: true,
        userMessage: "고위험 업무는 메신저 승인만으로 실행할 수 없습니다. 앱에서 차단 사유를 확인해야 합니다.",
      };
    }

    if (isExternalMutationRequest(request)) {
      return {
        intent,
        canRecordDecision: true,
        canExecuteFromChannel: false,
        requiresAppReconfirm: true,
        userMessage: "승인 의사는 기록하지만 외부 발송, 일정 등록, 파일 공유 실행은 앱에서 최종 확인합니다.",
      };
    }

    return {
      intent,
      canRecordDecision: true,
      canExecuteFromChannel: false,
      requiresAppReconfirm: false,
      userMessage: "채널 대화에서 결정을 기록할 수 있습니다.",
    };
  }

  createDecision(
    intent: ModyCommandIntent,
    decidedBy: string,
    safety?: ModyChannelSafetyResult,
  ): ModyChannelDecision | undefined {
    if (safety && !safety.canRecordDecision) return undefined;

    const decision = approvalDecisionForIntent(intent.kind);
    const requestId = intent.targetActionRequestId ?? intent.targetWorkItemId;
    if (!decision || !requestId) return undefined;

    const channelDecision: ModyChannelDecision = {
      id: `channel_decision_${intent.id}`,
      intentId: intent.id,
      requestId,
      decision,
      decidedBy,
      decidedViaChannelId: intent.channelId,
      decidedAt: this.now().toISOString(),
    };

    if (intent.revisionInstruction) {
      channelDecision.revisionInstruction = intent.revisionInstruction;
    }

    return channelDecision;
  }

  createOutboundMessage(
    intent: ModyCommandIntent,
    safety: ModyChannelSafetyResult,
    options: { threadId?: string; appDeepLink?: string } = {},
  ): ModyOutboundMessage {
    const message: ModyOutboundMessage = {
      id: `outbound_${intent.id}`,
      channelId: intent.channelId,
      text: safety.userMessage,
      actionLabels: actionLabelsForIntent(intent, safety),
      createdAt: this.now().toISOString(),
    };

    if (options.threadId) message.threadId = options.threadId;
    if (options.appDeepLink) message.appDeepLink = options.appDeepLink;

    return message;
  }
}

function normalizeCommandText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function classifyIntent(text: string): ModyCommandIntentKind {
  if (/^(\/)?오늘업무|오늘\s*업무|오늘\s*보고|보고서\s*오늘/i.test(text)) return "summarize_today";
  if (/^(\/)?승인대기|승인\s*대기|확인할\s*것/i.test(text)) return "list_pending_approvals";
  if (/^(?:\/)?(?:일정\s*후보|예약\s*후보|미팅\s*후보|캘린더\s*후보)/i.test(text)) return "draft_calendar_event";
  if (/^(\/)?일정\s*요약|이번\s*주\s*일정|내\s*일정|가능\s*시간|예약\s*가능|미팅\s*가능/i.test(text)) return "summarize_calendar";
  if (/^(\/)?문서찾기|문서\s*찾기|검색/i.test(text)) return "search_documents";
  if (/날짜\s*추려|시간\s*추려/i.test(text)) return "draft_calendar_event";
  if (/^(\/)?답장초안|답장\s*초안|초안/i.test(text)) return "draft_reply";
  if (/^(\/)?승인\b|^승인\s+/i.test(text)) return "approve_action";
  if (/^(\/)?수정|다시\s*써|고쳐|톤을|더\s*정중/i.test(text)) return "request_change";
  if (/^(\/)?보류\b|잠시\s*보류/i.test(text)) return "hold_action";
  if (/^(\/)?거절\b|반려/i.test(text)) return "reject_action";
  if (/앱\s*열기|자세히\s*보기/i.test(text)) return "open_app";
  return "unknown";
}

function extractWorkItemId(text: string): string | undefined {
  return text.match(/\b(M-\d+|work[_-][\w-]+)\b/i)?.[1];
}

function extractActionRequestId(text: string): string | undefined {
  return text.match(/\b(action[_-][\w-]+|send[_-]\d+|calendar[_-]\d+|share[_-]\d+)\b/i)?.[1];
}

function extractRevisionInstruction(text: string): string | undefined {
  return text.replace(/^(\/)?(수정|다시\s*써|고쳐)\s*/i, "").trim() || undefined;
}

function extractSearchQuery(text: string): string | undefined {
  return text.replace(/^(\/)?(문서찾기|문서\s*찾기|검색)\s*/i, "").trim() || undefined;
}

function isDecisionIntent(kind: ModyCommandIntentKind): boolean {
  return (
    kind === "approve_action" ||
    kind === "request_change" ||
    kind === "hold_action" ||
    kind === "reject_action"
  );
}

function approvalDecisionForIntent(kind: ModyCommandIntentKind): ApprovalDecision | undefined {
  if (kind === "approve_action") return "approved";
  if (kind === "request_change") return "change_requested";
  if (kind === "hold_action") return "held";
  if (kind === "reject_action") return "rejected";
  return undefined;
}

function actionLabelsForIntent(intent: ModyCommandIntent, safety: ModyChannelSafetyResult): string[] {
  if (safety.requiresAppReconfirm) {
    return ["앱에서 최종 확인", "수정 요청", "보류"];
  }

  if (intent.kind === "list_pending_approvals") {
    return ["승인 목록 보기", "앱 열기"];
  }

  if (intent.kind === "search_documents") {
    return ["관련 문서 보기", "앱 열기"];
  }

  if (intent.kind === "summarize_calendar" || intent.kind === "draft_calendar_event") {
    return ["가능 시간 보기", "앱에서 일정 확인"];
  }

  return ["앱 열기"];
}
