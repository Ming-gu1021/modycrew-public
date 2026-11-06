"use client";

import type { LocalMemoryWorkPattern } from "./desktop-bridge";
import {
  createMemoryPersonalizationSuggestion,
  type MemoryPersonalizationSuggestion,
} from "./memory-personalization-engine";
import {
  WORK_AUTOMATION_APPROVAL_GATE_CONTRACT,
  WORK_AUTOMATION_CONVERSATION_ROUTING_CONTRACT,
  WORK_AUTOMATION_LIVE_READINESS_CONTRACT,
  createWorkAutomationEnginePlan,
  formatWorkAutomationPlanLines,
  type WorkAutomationEnginePlan,
  type WorkAutomationIntent,
} from "./work-automation-engine";
import {
  createApprovalEngineContract,
  formatApprovalEngineLines,
  type ApprovalEngineContract,
  type ApprovalEngineWorkKind,
} from "./approval-engine";

export type ConversationWorkIntent =
  | "mail_automation"
  | "inquiry_reply"
  | "schedule_management"
  | "repeat_automation"
  | "document_draft"
  | "general";

export type ConversationEngineAction = {
  label: string;
  action: string;
  connectorIds?: Array<"mail" | "calendar">;
  recoveryStep: "solution" | "resume";
  recoveryContract: "reason_solution_resume";
  blockedReasonLabel: string;
  resumeAfterSetup: boolean;
};

export type ConversationRuntimeGateId = "ai_runtime" | "desktop_bridge";

export type ConversationGuideStep = {
  id: string;
  title: string;
  detail: string;
  /** 누르면 바로 이동/실행되는 홈 액션 id (page.tsx HomeAction과 동일 문자열) */
  actionId: string;
};

/** 채팅에 보여줄 안내형 가이드 — 개요 한 줄 → 순차 단계 → 첫 단계 권유. 내부 계약 문자열 금지. */
export type ConversationGuide = {
  contract: "chat_next_step_guide_v1";
  intro: string;
  steps: ConversationGuideStep[];
  cta: string;
  primaryActionLabel: string;
};

export type ConversationEngineDecision = {
  intent: ConversationWorkIntent;
  label: string;
  status: "ready" | "blocked";
  detail: string;
  assistantText: string;
  workflowItems: string[];
  actions: ConversationEngineAction[];
  missingConnectionIds: Array<"mail" | "calendar">;
  blockedReasonLabel: string;
  recoveryPlanLabel: string;
  solutionButtonLabel: string;
  resumeActionLabel: string;
  recoveryContract: "reason_solution_resume";
  approvalBoundary: string;
  automationRoutingContract: "conversation_intent_to_work_automation_approval";
  automationPlan: WorkAutomationEnginePlan;
  automationPlanLines: string[];
  approvalContract: ApprovalEngineContract;
  approvalLines: string[];
  approvalGateContract: "dry_run_receipt_connector_readiness_final_presence";
  liveReadinessGateLabel: string;
  candidateCreationContract: "ready_connections_only_or_stop_before_candidate";
  shouldStopBeforeCandidate: boolean;
  missingRuntimeIds: ConversationRuntimeGateId[];
  runtimeGateLabel: string;
  fakeCandidateBlocked: true;
  externalMutation: false;
  guide: ConversationGuide | null;
  memoryPersonalizationSuggestion: MemoryPersonalizationSuggestion | null;
  memoryPersonalizationPolicyLabel: "manual_apply_or_save_only" | "";
  shouldPauseForMemoryChoice: boolean;
};

export function createConversationEngineDecision(input: {
  text: string;
  agentIntent?: string;
  aiConnected: boolean;
  desktopReady: boolean;
  mailReady: boolean;
  calendarReady: boolean;
  workPatterns?: LocalMemoryWorkPattern[];
  teammateId?: string;
}): ConversationEngineDecision {
  const intent = inferConversationWorkIntent(input.text, input.agentIntent);
  const needsScheduleCandidate = hasScheduleCandidateSignal(input.text.toLowerCase());
  const missingRuntimeIds = inferMissingRuntimeGates(intent, input);
  const missingConnectionIds = inferMissingConnections(intent, input);
  const approvalBoundary = approvalBoundaryForIntent(intent);
  const label = labelForIntent(intent);
  const automationPlan = createConversationAutomationPlan(intent, input, needsScheduleCandidate);
  const approvalContract = createConversationApprovalContract(intent, automationPlan, missingConnectionIds);
  const engineContracts = conversationEngineContracts(automationPlan, approvalContract);
  const memoryPersonalizationSuggestion = createMemoryPersonalizationSuggestion({
    text: input.text,
    workPatterns: input.workPatterns ?? [],
    teammateId: input.teammateId,
  });

  if (missingRuntimeIds.length > 0) {
    return createRuntimeBlockedDecision({
      intent,
      label,
      missingRuntimeIds,
      approvalBoundary,
      automationPlan,
      approvalContract,
      engineContracts,
      memoryPersonalizationSuggestion,
    });
  }

  if (missingConnectionIds.length > 0) {
    const connectionLabels = missingConnectionIds
      .map((id) => (id === "mail" ? "메일 연결" : "캘린더 연결"))
      .join(", ");
    const blockedReasonLabel = `${connectionLabels} 전에는 필요한 원문이나 일정 가능 시간을 확인할 수 없습니다.`;
    const resumeActionLabel = resumeActionLabelForIntent(intent);
    const guide = createConnectionBlockedGuide(intent, missingConnectionIds, label);
    return {
      intent,
      label,
      status: "blocked",
      detail: `${connectionLabels}이 필요합니다. 연결 전에는 원문을 읽거나 외부 실행 결과를 만든 것처럼 표시하지 않습니다.`,
      assistantText: [
        `${formatProcessingIntro(label)} 먼저 ${connectionLabels}이 필요합니다.`,
        "메일이나 캘린더를 읽은 척하지 않고, 방금 요청은 그대로 보관해뒀어요. 연결이 끝나면 이어서 처리할게요.",
        ...(missingConnectionIds.includes("mail")
          ? ["연결 화면으로 가지 않아도 돼요. 아래 '채팅으로 메일 연결 진행'을 누르면 제가 여기서 하나씩 물어보며 같이 연결할게요."]
          : []),
      ].join("\n"),
      workflowItems: [
        `이유: ${blockedReasonLabel}`,
        `필요 연결: ${connectionLabels}`,
        "해결 버튼: 필요한 연결 열기",
        `다시 이어가기: ${resumeActionLabel}`,
        "연결 전 원문 읽기/발송/등록 없음",
        ...engineContracts.automationPlanLines,
        ...engineContracts.approvalLines,
        approvalBoundary,
      ],
      actions: actionsForMissingConnections(missingConnectionIds, intent, blockedReasonLabel),
      missingConnectionIds,
      blockedReasonLabel,
      recoveryPlanLabel: "이유 -> 해결 버튼 -> 다시 이어가기",
      solutionButtonLabel: "필요한 연결 열기",
      resumeActionLabel,
      recoveryContract: "reason_solution_resume",
      approvalBoundary,
      ...engineContracts,
      shouldStopBeforeCandidate: true,
      missingRuntimeIds: [],
      runtimeGateLabel: "AI/설치 앱 런타임 확인됨",
      fakeCandidateBlocked: true,
      externalMutation: false,
      guide,
      ...memoryPersonalizationFields(memoryPersonalizationSuggestion),
    };
  }

  return {
    intent,
    label,
    status: "ready",
    detail: `${label} 요청을 실행 전 후보로 정리할 수 있습니다.`,
    assistantText: [
      `${label} 요청을 실행 전 후보로 정리할 수 있습니다.`,
      approvalBoundary,
    ].join("\n"),
    workflowItems: ["필요 연결 확인", "초안/후보 생성 가능", ...engineContracts.automationPlanLines, ...engineContracts.approvalLines, approvalBoundary],
    actions: [],
    missingConnectionIds,
    blockedReasonLabel: "",
    recoveryPlanLabel: "",
    solutionButtonLabel: "",
    resumeActionLabel: "",
    recoveryContract: "reason_solution_resume",
    approvalBoundary,
    ...engineContracts,
    shouldStopBeforeCandidate: false,
    missingRuntimeIds: [],
    runtimeGateLabel: "AI/설치 앱 런타임 확인됨",
    fakeCandidateBlocked: true,
    externalMutation: false,
    guide: null,
    ...memoryPersonalizationFields(memoryPersonalizationSuggestion),
  };
}

function createRuntimeBlockedDecision(input: {
  intent: ConversationWorkIntent;
  label: string;
  missingRuntimeIds: ConversationRuntimeGateId[];
  approvalBoundary: string;
  automationPlan: WorkAutomationEnginePlan;
  approvalContract: ApprovalEngineContract;
  engineContracts: ConversationEngineContracts;
  memoryPersonalizationSuggestion: MemoryPersonalizationSuggestion | null;
}): ConversationEngineDecision {
  const runtimeLabels = input.missingRuntimeIds.map(runtimeGateLabel).join(", ");
  const aiMissing = input.missingRuntimeIds.includes("ai_runtime");
  const desktopMissing = input.missingRuntimeIds.includes("desktop_bridge");
  const blockedReasonLabel = aiMissing
    ? "실제 AI 답변 연결 전에는 대화 결과나 업무 후보를 만든 것처럼 표시할 수 없습니다."
    : "설치 앱 연결 전에는 메일, 일정, 파일, 실행 로그 같은 로컬 업무 상태를 확인할 수 없습니다.";
  const resumeActionLabel = aiMissing ? "AI 연결 후 방금 요청 이어가기" : "설치 앱 연결 후 방금 요청 이어가기";
  const detail = `${runtimeLabels} 전에는 업무 후보를 만들지 않고 요청을 보관합니다.`;
  const solutionLabel = aiMissing ? "AI 연결 다시 확인" : "설치 앱에서 계속";
  const guide: ConversationGuide = {
    contract: "chat_next_step_guide_v1",
    intro: "연결부터 처리까지 이렇게 진행돼요. 각 단계를 누르면 바로 이동해요.",
    steps: [
      {
        id: "connect",
        title: aiMissing ? "AI 연결" : "설치 앱 연결",
        detail: aiMissing
          ? "로그인 한 번으로 실제 AI 답변을 연결해요. 연결 전에는 답을 지어내지 않아요."
          : "설치 앱을 연결하면 메일, 일정, 파일 같은 실제 업무 상태를 확인할 수 있어요.",
        actionId: "connect_ai",
      },
      {
        id: "resume",
        title: "방금 요청 이어가기",
        detail: "연결이 확인되면 보관해둔 요청을 그대로 이어서 처리해요.",
        actionId: "retry_pending_ai_request",
      },
      {
        id: "review",
        title: "결과 확인 후 실행",
        detail: "업무 후보가 생기면 먼저 보여드리고, 실제 실행은 승인하신 뒤에만 해요.",
        actionId: "open_office",
      },
    ],
    cta: `1번부터 해볼까요? '${solutionLabel}'을 누르면 시작돼요.`,
    primaryActionLabel: solutionLabel,
  };
  return {
    intent: input.intent,
    label: aiMissing ? "AI 대화 연결 필요" : "설치 앱 연결 필요",
    status: "blocked",
    detail,
    assistantText: [
      aiMissing
        ? "이 요청은 실제 AI 대화가 먼저 연결되어야 처리할 수 있습니다."
        : "이 요청은 설치 앱 연결이 확인되어야 실제 업무 상태를 확인할 수 있습니다.",
      "메일·일정·반복 업무 후보를 만든 척하지 않고, 방금 요청을 보관해둘게요.",
      aiMissing ? "AI 연결이 확인되면 그대로 이어서 처리합니다." : "설치 앱 연결이 확인되면 그대로 이어서 처리합니다.",
    ].join("\n"),
    workflowItems: [
      "방금 요청 보관",
      "업무 후보를 만들지 않고 요청을 보관",
      `필요 런타임: ${runtimeLabels}`,
      `이유: ${blockedReasonLabel}`,
      `해결 버튼: ${aiMissing ? "AI 연결 다시 확인" : "설치 앱에서 계속"}`,
      `다시 이어가기: ${resumeActionLabel}`,
      ...input.engineContracts.automationPlanLines,
      ...input.engineContracts.approvalLines,
      input.approvalBoundary,
    ],
    actions: runtimeRecoveryActions(input.missingRuntimeIds, blockedReasonLabel),
    missingConnectionIds: [],
    blockedReasonLabel,
    recoveryPlanLabel: "이유 -> 해결 버튼 -> 다시 이어가기",
    solutionButtonLabel: aiMissing ? "AI 연결 다시 확인" : "설치 앱에서 계속",
    resumeActionLabel,
    recoveryContract: "reason_solution_resume",
    approvalBoundary: input.approvalBoundary,
    ...input.engineContracts,
    shouldStopBeforeCandidate: true,
    missingRuntimeIds: input.missingRuntimeIds,
    runtimeGateLabel: runtimeLabels,
    fakeCandidateBlocked: true,
    externalMutation: false,
    guide,
    ...memoryPersonalizationFields(input.memoryPersonalizationSuggestion),
  };
}

function createConnectionBlockedGuide(
  intent: ConversationWorkIntent,
  missingConnectionIds: Array<"mail" | "calendar">,
  label: string,
): ConversationGuide {
  const mailMissing = missingConnectionIds.includes("mail");
  const calendarMissing = missingConnectionIds.includes("calendar");
  const connectTitle =
    mailMissing && calendarMissing ? "메일·캘린더 연결" : mailMissing ? "메일 연결" : "캘린더 연결";
  const primaryActionLabel = mailMissing ? "메일 연결" : "캘린더 연결";
  const connectDetail = mailMissing
    ? "연결 화면에서 쓰는 메일 계정을 연결해요. 비밀번호는 그 화면에서 직접 입력하고, 채팅에는 적지 않아도 돼요."
    : "연결 화면에서 쓰는 캘린더 계정을 연결해요. 권한 동의는 직접 확인하면 돼요.";
  const resumeDetail = mailMissing
    ? "연결이 확인되면 방금 요청을 그대로 이어서, 받은 메일부터 확인해요."
    : "연결이 확인되면 방금 요청을 그대로 이어서, 일정 가능 시간부터 확인해요.";
  const reviewLead =
    intent === "schedule_management"
      ? "일정 후보를 먼저 보여드려요."
      : mailMissing
        ? "답장 초안을 먼저 보여드려요."
        : "결과 후보를 먼저 보여드려요.";
  const reviewDetail = `${reviewLead} ${approvalBoundaryForIntent(intent)}`;
  const connectActionId = mailMissing ? "mail_connection" : "calendar_connection";
  const resumeActionId = intent === "schedule_management" ? "calendar_connection" : "mailops_check";
  return {
    contract: "chat_next_step_guide_v1",
    intro: `${label}까지 이렇게 진행돼요. 각 단계를 누르면 바로 이동해요.`,
    steps: [
      { id: "connect", title: connectTitle, detail: connectDetail, actionId: connectActionId },
      { id: "resume", title: "요청 이어가기", detail: resumeDetail, actionId: resumeActionId },
      { id: "review", title: "확인 후 승인", detail: reviewDetail, actionId: "open_office" },
    ],
    cta: `1번부터 해볼까요? '${primaryActionLabel}'을 누르면 시작돼요.`,
    primaryActionLabel,
  };
}

function memoryPersonalizationFields(suggestion: MemoryPersonalizationSuggestion | null) {
  return {
    memoryPersonalizationSuggestion: suggestion,
    memoryPersonalizationPolicyLabel: suggestion ? ("manual_apply_or_save_only" as const) : ("" as const),
    shouldPauseForMemoryChoice: suggestion?.shouldPauseForUserChoice === true,
  };
}

type ConversationEngineContracts = Pick<
  ConversationEngineDecision,
  | "automationRoutingContract"
  | "automationPlan"
  | "automationPlanLines"
  | "approvalContract"
  | "approvalLines"
  | "approvalGateContract"
  | "liveReadinessGateLabel"
  | "candidateCreationContract"
>;

function createConversationAutomationPlan(
  intent: ConversationWorkIntent,
  input: { mailReady: boolean; calendarReady: boolean },
  needsScheduleCandidate: boolean,
) {
  return createWorkAutomationEnginePlan({
    intent: workAutomationIntentForConversation(intent),
    mailReady: input.mailReady,
    calendarReady: input.calendarReady,
    needsScheduleCandidate,
    repeatEnabled: false,
  });
}

function createConversationApprovalContract(
  intent: ConversationWorkIntent,
  automationPlan: WorkAutomationEnginePlan,
  missingConnectionIds: Array<"mail" | "calendar">,
) {
  return createApprovalEngineContract({
    workKind: approvalWorkKindForConversation(intent),
    label: `${labelForIntent(intent)} 승인`,
    executionLogLabel: automationPlan.executionLogLabel,
    missingConnectionLabels: missingConnectionIds.map((id) => (id === "mail" ? "메일" : "캘린더")),
  });
}

function conversationEngineContracts(
  automationPlan: WorkAutomationEnginePlan,
  approvalContract: ApprovalEngineContract,
): ConversationEngineContracts {
  return {
    automationRoutingContract: WORK_AUTOMATION_CONVERSATION_ROUTING_CONTRACT,
    automationPlan,
    automationPlanLines: [
      "대화 라우팅 계약: conversation_intent_to_work_automation_approval",
      ...formatWorkAutomationPlanLines(automationPlan),
    ],
    approvalContract,
    approvalLines: formatApprovalEngineLines(approvalContract),
    approvalGateContract: WORK_AUTOMATION_APPROVAL_GATE_CONTRACT,
    liveReadinessGateLabel: `메일/캘린더 live readiness: ${WORK_AUTOMATION_LIVE_READINESS_CONTRACT}`,
    candidateCreationContract: "ready_connections_only_or_stop_before_candidate",
  };
}

function workAutomationIntentForConversation(intent: ConversationWorkIntent): WorkAutomationIntent {
  if (intent === "schedule_management") return "schedule";
  if (intent === "repeat_automation") return "repeat";
  return "mail_or_inquiry";
}

function approvalWorkKindForConversation(intent: ConversationWorkIntent): ApprovalEngineWorkKind {
  if (intent === "schedule_management") return "schedule";
  if (intent === "repeat_automation") return "repeat_work";
  if (intent === "document_draft") return "document_draft";
  return "mailops";
}

function inferMissingRuntimeGates(
  intent: ConversationWorkIntent,
  input: { aiConnected: boolean; desktopReady: boolean },
) {
  const missing = new Set<ConversationRuntimeGateId>();
  if (!input.aiConnected && intentRequiresAIConversationRuntime(intent)) missing.add("ai_runtime");
  if (!input.desktopReady && intentRequiresDesktopBridge(intent)) missing.add("desktop_bridge");
  return Array.from(missing);
}

function intentRequiresAIConversationRuntime(intent: ConversationWorkIntent) {
  return (
    intent === "mail_automation" ||
    intent === "inquiry_reply" ||
    intent === "schedule_management" ||
    intent === "repeat_automation" ||
    intent === "document_draft" ||
    intent === "general"
  );
}

function intentRequiresDesktopBridge(intent: ConversationWorkIntent) {
  return (
    intent === "mail_automation" ||
    intent === "inquiry_reply" ||
    intent === "schedule_management" ||
    intent === "repeat_automation" ||
    intent === "document_draft"
  );
}

function runtimeGateLabel(id: ConversationRuntimeGateId) {
  if (id === "ai_runtime") return "AI 답변 연결";
  return "설치 앱 연결";
}

function runtimeRecoveryActions(
  missingRuntimeIds: ConversationRuntimeGateId[],
  blockedReasonLabel: string,
): ConversationEngineAction[] {
  const actions: ConversationEngineAction[] = [];
  if (missingRuntimeIds.includes("ai_runtime")) {
    actions.push(createRecoveryAction("AI 연결 다시 확인", "connect_ai", [], blockedReasonLabel));
    actions.push(createRecoveryAction("연결 복구 확인", "prepare_tools", [], blockedReasonLabel));
    actions.push(createRecoveryAction("대체 답변 연결", "external_accounts", [], blockedReasonLabel));
  }
  if (missingRuntimeIds.includes("desktop_bridge")) {
    actions.push(createRecoveryAction("설치 앱에서 계속", "connect_ai", [], blockedReasonLabel));
  }
  actions.push(createRecoveryAction("연결 후 이어가기", "retry_pending_ai_request", [], blockedReasonLabel, true));
  return actions;
}

function inferConversationWorkIntent(text: string, agentIntent = ""): ConversationWorkIntent {
  const normalized = text.toLowerCase();
  // 명사 한 개로 업무 라우팅을 확정하지 않는다. "메일은 일단 패스하고..."처럼
  // 대상을 언급만 한 문장을 연결 매크로가 가로채지 않도록, 대상과 실행 의도가
  // 함께 있고 해당 작업을 제외/보류한 문장이 아닐 때만 업무 게이트를 연다.
  const isMetaOrNegatedWorkRequest =
    /(?:단어|키워드|매크로|예시|가정|설명|왜|어떻게|방법|할\s*수\s*있|가능(?:한가|해|할까|할까요|합니까|한지|여부))|(?:하지\s*마|하지\s*말|안\s*(?:해|할)|말고|빼고|제외|패스|보류|나중)/u.test(normalized);
  if (isMetaOrNegatedWorkRequest) return "general";

  const excludesMailWork =
    /(?:메일|이메일|gmail|outlook|mail|email)(?:\s*(?:확인|작업|처리))?\s*(?:은|는|부터|쪽은)?\s*(?:일단\s*)?(?:패스|제외|빼|말고|하지\s*마|안\s*(?:해|할|봐)|나중|보류)/u.test(normalized);
  const hasMailTarget = /메일|이메일|gmail|outlook|mail|email|메일함/u.test(normalized);
  const hasMailExecution =
    /(?:메일|이메일|메일함|gmail|outlook|mail|email|문의).{0,30}(?:읽|확인|점검|분류|검색|찾|요약|정리|답장|회신|초안|작성|보내|발송|처리|자동화)|(?:읽|확인|점검|분류|검색|찾|요약|정리|답장|회신|초안|작성|보내|발송|처리|자동화).{0,30}(?:메일|이메일|메일함|gmail|outlook|mail|email|문의)/u.test(normalized);
  const hasScheduleExecution =
    /(?:일정|캘린더|calendar|회의|미팅|예약).{0,24}(?:확인|조회|찾|잡|추가|등록|변경|옮|취소|조율|추천|정리)|(?:확인|조회|찾|잡|추가|등록|변경|옮|취소|조율|추천|정리).{0,24}(?:일정|캘린더|calendar|회의|미팅|예약)/u.test(normalized);

  if (!excludesMailWork && /(?:고객\s*)?문의.{0,24}(?:답장|회신|처리|정리)|(?:답장|회신).{0,24}(?:문의|메일|이메일)/u.test(normalized)) return "inquiry_reply";
  if (hasScheduleExecution) return "schedule_management";
  if (!excludesMailWork && hasMailTarget && hasMailExecution) return "mail_automation";
  if (/반복|매일|매주|매월|자동화|automation/u.test(normalized) && /해\s*줘|만들|설정|등록|돌려|실행|점검|확인/u.test(normalized)) return "repeat_automation";
  if (/보고서|문서|자료|초안/u.test(normalized) && /작성|만들|써|정리|요약|검토|읽/u.test(normalized)) return "document_draft";

  // 상위 에이전트가 이미 업무 의도를 판별한 경우에는 본문 표현이 짧거나 생략돼도
  // 같은 연결/승인 경계를 유지한다. 설명·부정 문장은 위에서 일반 대화로 종료한다.
  if (agentIntent === "mail_ops") return "mail_automation";
  if (agentIntent === "automation_check") return "repeat_automation";
  if (agentIntent === "document_learning") return "document_draft";
  return "general";
}
function inferMissingConnections(
  intent: ConversationWorkIntent,
  input: { text: string; mailReady: boolean; calendarReady: boolean },
) {
  const missing = new Set<"mail" | "calendar">();
  const normalized = input.text.toLowerCase();
  const asksForScheduleCandidate = hasScheduleCandidateSignal(normalized);
  if ((intent === "mail_automation" || intent === "inquiry_reply") && !input.mailReady) missing.add("mail");
  if ((intent === "mail_automation" || intent === "inquiry_reply") && asksForScheduleCandidate && !input.calendarReady) {
    missing.add("calendar");
  }
  if (intent === "schedule_management" && !input.calendarReady) missing.add("calendar");
  if (intent === "schedule_management" && /메일|문의|답장|email|mail/u.test(normalized) && !input.mailReady) {
    missing.add("mail");
  }
  return Array.from(missing);
}

function hasScheduleCandidateSignal(normalizedText: string) {
  return /일정|캘린더|calendar|회의|미팅|예약|시간\s*(잡|후보|추천|조율|확인)?/u.test(normalizedText);
}

function formatProcessingIntro(label: string) {
  if (label.endsWith("처리")) return `${label}하려면`;
  if (label.endsWith("자동화")) return `${label}하려면`;
  if (label.endsWith("관리")) return `${label}를 하려면`;
  return `${label}을 처리하려면`;
}

function labelForIntent(intent: ConversationWorkIntent) {
  if (intent === "mail_automation") return "메일 자동화";
  if (intent === "inquiry_reply") return "문의 답장 처리";
  if (intent === "schedule_management") return "일정 관리";
  if (intent === "repeat_automation") return "반복 업무";
  if (intent === "document_draft") return "문서 초안";
  return "업무 요청";
}

function approvalBoundaryForIntent(intent: ConversationWorkIntent) {
  if (intent === "schedule_management") return "캘린더 등록, 초대 발송, 외부 공유는 승인함 마지막 확인 전까지 실행하지 않습니다.";
  if (intent === "mail_automation" || intent === "inquiry_reply") {
    return "메일 발송, 일정 등록, 외부 공유는 승인함 마지막 확인 전까지 실행하지 않습니다.";
  }
  if (intent === "repeat_automation") return "반복 업무는 저장만으로 실행하지 않고 사용자가 켠 뒤에만 점검합니다.";
  if (intent === "document_draft") return "원본 파일 변경, 파일 저장, 외부 공유는 승인함 마지막 확인 전까지 실행하지 않습니다.";
  return "외부 발송, 일정 등록, 파일 변경, 공유, 삭제는 승인 전까지 실행하지 않습니다.";
}

function actionsForMissingConnections(
  missingConnectionIds: Array<"mail" | "calendar">,
  intent: ConversationWorkIntent,
  blockedReasonLabel: string,
): ConversationEngineAction[] {
  const actions: ConversationEngineAction[] = [];
  if (missingConnectionIds.includes("mail")) {
    actions.push(createRecoveryAction("메일 연결", "mail_connection", ["mail"], blockedReasonLabel));
  }
  if (missingConnectionIds.includes("calendar")) {
    actions.push(createRecoveryAction("캘린더 연결", "calendar_connection", ["calendar"], blockedReasonLabel));
  }
  actions.push(createRecoveryAction("계정 보관함", "external_accounts", missingConnectionIds, blockedReasonLabel));
  if (intent === "mail_automation" || intent === "inquiry_reply") {
    actions.push(createRecoveryAction("연결 후 메일 점검", "mailops_check", missingConnectionIds, blockedReasonLabel, true));
  }
  if (intent === "schedule_management") {
    actions.push(createRecoveryAction("연결 후 일정 준비", "calendar_connection", missingConnectionIds, blockedReasonLabel, true));
  }
  return actions;
}

function createRecoveryAction(
  label: string,
  action: string,
  connectorIds: Array<"mail" | "calendar">,
  blockedReasonLabel: string,
  resumeAfterSetup = false,
): ConversationEngineAction {
  return {
    label,
    action,
    connectorIds,
    recoveryStep: resumeAfterSetup ? "resume" : "solution",
    recoveryContract: "reason_solution_resume",
    blockedReasonLabel,
    resumeAfterSetup,
  };
}

function resumeActionLabelForIntent(intent: ConversationWorkIntent) {
  if (intent === "schedule_management") return "연결 후 일정 준비";
  if (intent === "mail_automation" || intent === "inquiry_reply") return "연결 후 메일 점검";
  return "연결 후 다시 이어가기";
}
