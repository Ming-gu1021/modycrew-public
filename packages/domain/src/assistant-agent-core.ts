import { ModyAgentRuntime } from "./agent-runtime.js";
import { modyPolicyVersion } from "./types.js";
import type {
  AgentPlan,
  AgentWorkRequest,
  ISODateTimeString,
  ToolActionRequest,
  ToolPermissionLevel,
  ToolRiskLabel,
} from "./types.js";

export type ModyAssistantAgentIntent =
  | "answer"
  | "connect_ai"
  | "mail_ops"
  | "today_ops"
  | "automation_check"
  | "folder_tidy"
  | "document_learning"
  | "messenger_setup"
  | "toolchain_check"
  | "crewkit_recommendation"
  | "office_queue"
  | "worker_delegation";

export type ModyAssistantToolId =
  | "mody.ai.generate"
  | "mody.ai.connect"
  | "mody.memory.read"
  | "mody.mail.intake"
  | "mody.work.sync"
  | "mody.automation.check"
  | "mody.folder.tidy"
  | "mody.document.learn"
  | "mody.messenger.configure"
  | "mody.toolchain.prepare"
  | "mody.crewkit.recommend"
  | "mody.office.queue"
  | "mody.worker.delegate";

export type ModyAssistantBridgeAction =
  | "generate_ai_text"
  | "connect_ai"
  | "load_memory"
  | "run_mail_intake"
  | "run_work_sync"
  | "run_automation_check"
  | "run_folder_tidy"
  | "open_document_learning"
  | "open_messenger_setup"
  | "prepare_toolchain"
  | "recommend_crewkit"
  | "open_office_queue"
  | "delegate_workers";

export type ModyAssistantAgentToolCall = {
  id: string;
  toolId: ModyAssistantToolId;
  label: string;
  bridgeAction: ModyAssistantBridgeAction;
  permissionLevel: ToolPermissionLevel;
  riskLabel: ToolRiskLabel;
  autoRun: boolean;
  requiresUserConsent: boolean;
  reason: string;
  inputSummary: string;
  expectedObservation: string;
  runtimeRoleContext?: ModyAssistantRuntimeRoleContext;
};

export type ModyAssistantAgentObservation = {
  id: string;
  toolCallId: string;
  status: "queued" | "running" | "completed" | "approval_required" | "blocked" | "failed";
  summary: string;
};

export type ModyAssistantAgentInput = {
  id: string;
  text: string;
  createdAt?: ISODateTimeString;
  threadId?: string;
  teammateId?: string;
  teammateName?: string;
  teammateRoleTitle?: string;
  teammateChannelName?: string;
  aiConnected: boolean;
  desktopReady: boolean;
  memoryReady: boolean;
  activeSkillIds?: string[];
  attachedFileCount?: number;
  recentMessageCount?: number;
};

export type ModyAssistantRuntimeRoleContext = {
  contract: "role_context_to_generation_runtime_v1";
  teammateId: string;
  teammateName: string;
  roleTitle: string;
  channelName: string;
  assignmentContract: "role_assignment_runtime_v1";
  workAutomationContract: "role_assignment_to_work_automation_engine_v1";
  workAutomationCandidateLabel: string;
  workAutomationPipelineLabel: string;
  workAutomationApprovalGateLabel: "dry_run_receipt_connector_readiness_final_presence";
  externalMutationAllowed: false;
};

export type ModyAssistantRoleWorkRoute = {
  contract: "role_assignment_to_work_automation_engine_v1";
  status: "ready" | "blocked";
  candidateLabel: string;
  pipelineLabel: string;
  approvalGateLabel: "dry_run_receipt_connector_readiness_final_presence";
  toolSequence: ModyAssistantBridgeAction[];
  blockedReasonLabel: string;
  externalMutation: false;
  finalUserConfirmationRequired: true;
};

export type ModyAssistantAgentRun = {
  id: string;
  status: "needs_desktop" | "needs_ai_connection" | "planned" | "ready_to_answer";
  policyVersion: typeof modyPolicyVersion;
  intent: ModyAssistantAgentIntent;
  workRequest: AgentWorkRequest;
  plan: AgentPlan;
  toolCalls: ModyAssistantAgentToolCall[];
  observations: ModyAssistantAgentObservation[];
  approvalQueue: ToolActionRequest[];
  timeline: string[];
  auditMessages: string[];
  runtimeRoleContext: ModyAssistantRuntimeRoleContext;
  roleWorkRoute: ModyAssistantRoleWorkRoute;
  responseMode: "ask_for_desktop" | "ask_for_ai_connection" | "run_tools_then_answer" | "answer_with_model";
  chatSummary: string;
};

export type ModyAssistantAgentLoopDecision =
  | {
      status: "call_tool";
      toolCall: ModyAssistantAgentToolCall;
      reason: string;
    }
  | {
      status: "final_answer";
      reason: string;
      observationSummary: string;
    }
  | {
      status: "await_user";
      reason: string;
      waitingToolCalls: ModyAssistantAgentToolCall[];
    };

type ModyAssistantAgentCoreOptions = {
  now?: () => Date;
};

export class ModyAssistantAgentCore {
  private readonly now: () => Date;
  private readonly runtime: ModyAgentRuntime;

  constructor(options: ModyAssistantAgentCoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.runtime = new ModyAgentRuntime({ now: this.now });
  }

  run(input: ModyAssistantAgentInput): ModyAssistantAgentRun {
    const createdAt = input.createdAt ?? this.now().toISOString();
    const normalizedText = normalizeUserText(input.text);
    const intent = inferAssistantIntent(normalizedText, input);
    const runtimeRoleContext = createRuntimeRoleContext(input, intent);
    const workRequest = createWorkRequest(input, normalizedText, intent, createdAt, runtimeRoleContext);
    const plan = this.runtime.plan(workRequest);
    const toolCalls = createToolCalls(intent, input, normalizedText, createdAt, runtimeRoleContext);
    const observations = toolCalls.map((toolCall) => createInitialObservation(toolCall));
    const status = statusFor(input, toolCalls);
    const roleWorkRoute = createRoleWorkRoute(runtimeRoleContext, status, toolCalls);
    const responseMode = responseModeFor(status, toolCalls);

    return {
      id: `assistant_agent_run_${input.id}`,
      status,
      policyVersion: modyPolicyVersion,
      intent,
      workRequest,
      plan,
      toolCalls,
      observations,
      approvalQueue: plan.approvalQueue,
      timeline: timelineFor(input, intent, toolCalls, status),
      auditMessages: auditMessagesFor(input, intent, toolCalls, status, runtimeRoleContext, roleWorkRoute),
      runtimeRoleContext,
      roleWorkRoute,
      responseMode,
      chatSummary: chatSummaryFor(intent, toolCalls, status),
    };
  }

  nextLoopDecision(
    run: ModyAssistantAgentRun,
    observations: ModyAssistantAgentObservation[] = run.observations,
  ): ModyAssistantAgentLoopDecision {
    const waitingToolCalls = run.toolCalls.filter((toolCall) => {
      if (!toolCall.requiresUserConsent) return false;
      const observation = findObservationForTool(observations, toolCall.id);
      return observation?.status === "approval_required" || observation?.status === "queued";
    });
    if (waitingToolCalls.length > 0) {
      return {
        status: "await_user",
        reason: "사용자 선택이 필요한 도구가 있어 자동 루프를 멈춥니다.",
        waitingToolCalls,
      };
    }

    const nextToolCall = run.toolCalls.find((toolCall) => {
      if (!toolCall.autoRun || toolCall.bridgeAction === "generate_ai_text") return false;
      const observation = findObservationForTool(observations, toolCall.id);
      return !observation || observation.status === "queued";
    });

    if (nextToolCall) {
      return {
        status: "call_tool",
        toolCall: nextToolCall,
        reason: `${nextToolCall.label} 결과를 관찰한 뒤 다음 판단으로 이어갑니다.`,
      };
    }

    return {
      status: "final_answer",
      reason: "자동 실행 가능한 도구 관찰이 끝났으므로 최종 답변을 생성합니다.",
      observationSummary: observations
        .filter((observation) => observation.status === "completed")
        .map((observation) => observation.summary)
        .join("\n")
        .slice(0, 2_000),
    };
  }

  recordObservation(
    run: ModyAssistantAgentRun,
    observations: ModyAssistantAgentObservation[],
    input: {
      toolCallId: string;
      status: ModyAssistantAgentObservation["status"];
      summary: string;
    },
  ): ModyAssistantAgentObservation[] {
    const existing = observations.find((observation) => observation.toolCallId === input.toolCallId);
    const nextObservation: ModyAssistantAgentObservation = {
      id: existing?.id ?? `${input.toolCallId}:observation`,
      toolCallId: input.toolCallId,
      status: input.status,
      summary: input.summary.slice(0, 2_000),
    };
    const replaced = observations.map((observation) =>
      observation.toolCallId === input.toolCallId ? nextObservation : observation,
    );
    if (replaced.some((observation) => observation.toolCallId === input.toolCallId)) return replaced;
    return [...run.observations.filter((observation) => observation.toolCallId !== input.toolCallId), nextObservation];
  }
}

function findObservationForTool(
  observations: ModyAssistantAgentObservation[],
  toolCallId: string,
) {
  return observations.find((observation) => observation.toolCallId === toolCallId);
}

function normalizeUserText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function inferAssistantIntent(text: string, input: ModyAssistantAgentInput): ModyAssistantAgentIntent {
  const lower = text.toLowerCase();
  if (!input.aiConnected) return "connect_ai";
  if (isAIRuntimeRecoveryQuestion(lower)) return "toolchain_check";
  if (isMailOpsInformationQuestion(lower)) return "answer";
  // 설명·방법을 묻는 질문(실행 명령이 아닌)은 매크로 카드로 가로채지 말고 모델이 자연스럽게 답하게 합니다.
  // 예: "폴더 정리 어떻게 해?"는 folder_tidy 실행이 아니라 answer(모델 설명)로.
  if (isCapabilityQuestion(lower)) return "answer";
  if (/메일|답장|받은\s*문의|문의.*확인|캘린더|일정 후보|mail|inbox/u.test(lower)) return "mail_ops";
  // "오늘"만으로 업무 의도로 단정하지 않습니다 — "오늘 점심 뭐 먹지?" 같은 일상 대화가
  // 오늘 업무 흐름(업무 카드·승인 버튼)으로 잘못 흘러가는 것을 막습니다.
  if (/오늘\s*(업무|할\s*일|일정|스케줄|문의|메일|보고|브리핑)|지금\s*할\s*일|업무\s*확인|동기화|브리핑/u.test(lower)) {
    return "today_ops";
  }
  if (/자동화|규칙|트리거|반복\s*업무|승인\s*후보/u.test(lower)) return "automation_check";
  if (/폴더|파일\s*정리|중복|삭제\s*후보|dry-run|드라이브/u.test(lower)) return "folder_tidy";
  if (/자료|문서|파일|pdf|엑셀|워드|보고서|양식/u.test(lower) || (input.attachedFileCount ?? 0) > 0) {
    return "document_learning";
  }
  if (/메신저|슬랙|텔레그램|디스코드|카카오|알림|승인\s*채널/u.test(lower)) return "messenger_setup";
  if (/git|깃|node|노드|python|파이썬|환경|설치|도구|toolchain|cli/u.test(lower)) return "toolchain_check";
  if (/스킬|crewkit|크루킷|기능\s*추천|영상|쇼츠|개발|코딩/u.test(lower)) return "crewkit_recommendation";
  if (/승인함|오피스|큐|최종\s*확인/u.test(lower)) return "office_queue";
  if (/위임|팀원|직원|나눠|병렬|역할/u.test(lower)) return "worker_delegation";
  return "answer";
}

function isAIRuntimeRecoveryQuestion(text: string) {
  const mentionsAI = /(ai|모델|답변|대화|채팅|연결|로그인|api|엔진)/iu.test(text);
  const mentionsBrokenRuntime =
    /(안\s*돼|안됨|안\s*되|못\s*해|못\s*움직|멈춤|먹통|무응답|대답\s*없|응답\s*없|실패|오류|막힘|거절|복구|진단|확인)/iu.test(text);
  const mentionsConnectedButBroken =
    /(연결.{0,20}(됐|되었|완료|되어|된\s*거|된거).{0,40}(안\s*돼|못\s*해|응답\s*없|대답\s*없|막힘|거절)|모델.{0,20}(바꿔|변경|선택).{0,40}(안\s*돼|못\s*해|응답\s*없|대답\s*없|막힘|거절))/iu.test(text);
  return (mentionsAI && mentionsBrokenRuntime) || mentionsConnectedButBroken;
}

function isMailOpsInformationQuestion(text: string) {
  if (!/(메일|이메일|답장|문의|예약|일정|캘린더|imap|smtp|gmail|outlook|회사\s*메일|mail|inbox)/u.test(text)) {
    return false;
  }
  const asksAboutCapability =
    /(\?|？|어떻게|뭐\s*할|무엇을|가능|할\s*수|몇\s*개|한도|제한|지원|범위|방식|설명|알려|왜|되는지|되니|돼|되나|되냐|가능해|가능한가|가능할까)/iu.test(text);
  if (!asksAboutCapability) return false;
  const explicitExecution =
    /(읽어\s*줘|확인해\s*줘|정리해\s*줘|처리해\s*줘|실행해\s*줘|연결해\s*줘|등록해\s*줘|보내\s*줘|만들어\s*줘|올려\s*줘|점검해\s*줘|돌려\s*줘|실행|시작|처리|정리|읽기\s*시작|메일함\s*읽)/iu.test(text);
  return !explicitExecution;
}

// 실행 명령(…해줘/지금 …해/시작해)인지. 명사(정리·실행)만으로는 명령으로 보지 않습니다 —
// "정리해줘"는 명령이지만 "어떻게 정리해?"는 질문이기 때문입니다.
function isExecutionCommand(text: string) {
  return /(해\s*줘|해\s*주세요|해\s*줄래|해\s*봐|해\s*주라|시작해|바로\s*해|지금\s*해|보내\s*줘|보내줘|등록해|올려\s*줘|올려줘|점검해\s*줘|돌려\s*줘|정리해\s*줘|처리해\s*줘|읽어\s*줘|확인해\s*줘|연결해\s*줘|만들어\s*줘|실행해\s*줘)/iu.test(text);
}

// 방법·이유·가능여부를 묻는 '설명 요청' 질문인지. 실행 명령이 섞이면 질문으로 보지 않습니다.
function isCapabilityQuestion(text: string) {
  const asksQuestion =
    /(\?|？|어떻게|어떡|어케|뭐야|뭔가|뭐\s*할|무엇|무슨|가능|할\s*수|몇\s*개|한도|제한|지원|범위|방식|방법|설명|알려|왜|되는지|되니|되나|되냐|가능해|가능한가|가능할까|되나요|되죠|인가요|나요|까요|은가요|는가요|궁금)/iu.test(text);
  return asksQuestion && !isExecutionCommand(text);
}

function createWorkRequest(
  input: ModyAssistantAgentInput,
  text: string,
  intent: ModyAssistantAgentIntent,
  createdAt: ISODateTimeString,
  roleContext: ModyAssistantRuntimeRoleContext,
): AgentWorkRequest {
  const title = `${intentLabel(intent)}: ${text.slice(0, 80) || "사용자 요청"}`;
  return {
    id: input.id,
    title,
    // 담당자를 본문 "글" 이 아니라 구조화된 값으로 넘긴다.
    // 아래 본문의 "담당 비서:" 줄은 사람이 읽는 용도로 남겨둔다 — 기존 문구를 잠근
    // 검증기들이 있어 지우면 깨진다.
    assignee: {
      id: roleContext.teammateId,
      name: roleContext.teammateName,
      roleTitle: roleContext.roleTitle,
      channelName: roleContext.channelName,
    },
    body: [
      `사용자 요청: ${text}`,
      input.threadId ? `대화 ID: ${input.threadId}` : "",
      input.teammateName ? `담당 비서: ${input.teammateName}` : "",
      input.teammateRoleTitle ? `담당 역할: ${input.teammateRoleTitle}` : "",
      input.teammateChannelName ? `담당 채널: ${input.teammateChannelName}` : "",
      `AI 연결: ${input.aiConnected ? "ready" : "required"}`,
      `데스크톱 런타임: ${input.desktopReady ? "ready" : "required"}`,
      `기억: ${input.memoryReady ? "ready" : "not_ready"}`,
    ].filter(Boolean).join("\n"),
    createdAt,
  };
}

function createToolCalls(
  intent: ModyAssistantAgentIntent,
  input: ModyAssistantAgentInput,
  text: string,
  createdAt: ISODateTimeString,
  runtimeRoleContext: ModyAssistantRuntimeRoleContext,
): ModyAssistantAgentToolCall[] {
  if (!input.desktopReady) {
    return [
      toolCall("desktop-required", "mody.ai.connect", "Windows 앱 런타임 확인", "connect_ai", "read", "low", false, true, text, "설치 앱에서 브리지를 다시 확인"),
    ];
  }

  if (!input.aiConnected) {
    return [
      toolCall("ai-connect", "mody.ai.connect", "AI 연결 동의 요청", "connect_ai", "read", "low", false, true, text, "사용자가 연결을 승인하면 OAuth 시작"),
    ];
  }

  const calls: ModyAssistantAgentToolCall[] = [
    toolCall("memory-read", "mody.memory.read", "CrewSoul 기억 읽기", "load_memory", "read", "low", true, false, text, "관련 기억과 업무 맥락 확보"),
  ];

  if (intent === "mail_ops") {
    calls.push(withRuntimeRoleContext(
      toolCall("mail-intake", "mody.mail.intake", "메일/일정 업무 읽기", "run_mail_intake", "read", "low", true, false, text, "메일, 일정 후보, 승인 대기 관찰"),
      runtimeRoleContext,
    ));
  } else if (intent === "today_ops") {
    calls.push(toolCall("work-sync", "mody.work.sync", "오늘 업무 동기화", "run_work_sync", "read", "low", true, false, text, "오늘 처리할 업무 후보 관찰"));
  } else if (intent === "automation_check") {
    calls.push(toolCall("automation-check", "mody.automation.check", "자동화 규칙 점검", "run_automation_check", "read", "low", true, false, text, "켜진 규칙과 승인 후보 관찰"));
  } else if (intent === "folder_tidy") {
    calls.push(toolCall("folder-tidy", "mody.folder.tidy", "폴더 정리 후보 만들기", "run_folder_tidy", "analyze", "medium", false, true, text, "선택한 폴더에서 이동/삭제 없는 후보 생성"));
  } else if (intent === "document_learning") {
    calls.push(toolCall("document-learn", "mody.document.learn", "자료 분석 준비", "open_document_learning", "read", "low", false, true, text, "사용자가 선택한 자료만 읽기"));
  } else if (intent === "messenger_setup") {
    calls.push(toolCall("messenger-setup", "mody.messenger.configure", "알림 채널 연결 안내", "open_messenger_setup", "stage", "medium", false, true, text, "사용자가 원하는 채널만 연결"));
  } else if (intent === "toolchain_check") {
    calls.push(toolCall("toolchain", "mody.toolchain.prepare", "작업 도구 확인", "prepare_toolchain", "read", "low", true, false, text, "Git, Node, Python, rg 준비 상태 관찰"));
  } else if (intent === "crewkit_recommendation") {
    calls.push(toolCall("crewkit", "mody.crewkit.recommend", "필요 기능 추천", "recommend_crewkit", "analyze", "low", false, false, text, "요청에 맞는 기능 하나 추천"));
  } else if (intent === "office_queue") {
    calls.push(toolCall("office-queue", "mody.office.queue", "오피스 승인함 확인", "open_office_queue", "read", "low", false, true, text, "승인 대기와 진행 상태 확인"));
  } else if (intent === "worker_delegation") {
    calls.push(toolCall("worker-delegate", "mody.worker.delegate", "역할별 AI 팀원 위임", "delegate_workers", "stage", "medium", false, true, text, "사용자가 확인한 AI 팀원에게 분배"));
  }

  calls.push(withRuntimeRoleContext(
    toolCall("ai-generate", "mody.ai.generate", "최종 답변 생성", "generate_ai_text", "draft", "low", true, false, text, "역할 기준과 관찰 결과를 반영한 한국어 답변"),
    runtimeRoleContext,
  ));
  return calls.map((call, index) => ({ ...call, id: `${createdAt}:${index + 1}:${call.id}` }));
}

function withRuntimeRoleContext(
  toolCall: ModyAssistantAgentToolCall,
  runtimeRoleContext: ModyAssistantRuntimeRoleContext,
): ModyAssistantAgentToolCall {
  return {
    ...toolCall,
    runtimeRoleContext,
  };
}

function createRuntimeRoleContext(
  input: ModyAssistantAgentInput,
  intent: ModyAssistantAgentIntent,
): ModyAssistantRuntimeRoleContext {
  const workLabels = workAutomationLabelsForIntent(intent);
  return {
    contract: "role_context_to_generation_runtime_v1",
    teammateId: input.teammateId?.trim() || defaultTeammateId(intent),
    teammateName: input.teammateName?.trim() || defaultTeammateName(intent),
    roleTitle: input.teammateRoleTitle?.trim() || defaultRoleTitle(intent),
    channelName: input.teammateChannelName?.trim() || defaultChannelName(intent),
    assignmentContract: "role_assignment_runtime_v1",
    workAutomationContract: "role_assignment_to_work_automation_engine_v1",
    workAutomationCandidateLabel: workLabels.candidateLabel,
    workAutomationPipelineLabel: workLabels.pipelineLabel,
    workAutomationApprovalGateLabel: "dry_run_receipt_connector_readiness_final_presence",
    externalMutationAllowed: false,
  };
}

function createRoleWorkRoute(
  runtimeRoleContext: ModyAssistantRuntimeRoleContext,
  status: ModyAssistantAgentRun["status"],
  toolCalls: ModyAssistantAgentToolCall[],
): ModyAssistantRoleWorkRoute {
  const blockedReasonLabel =
    status === "needs_ai_connection"
      ? "AI 연결 전에는 역할 기반 답변이나 업무 후보를 만든 척하지 않습니다."
      : status === "needs_desktop"
        ? "설치 앱 연결 전에는 로컬 업무 상태를 읽은 척하지 않습니다."
        : "";
  return {
    contract: runtimeRoleContext.workAutomationContract,
    status: blockedReasonLabel ? "blocked" : "ready",
    candidateLabel: runtimeRoleContext.workAutomationCandidateLabel,
    pipelineLabel: runtimeRoleContext.workAutomationPipelineLabel,
    approvalGateLabel: runtimeRoleContext.workAutomationApprovalGateLabel,
    toolSequence: toolCalls.map((tool) => tool.bridgeAction),
    blockedReasonLabel,
    externalMutation: false,
    finalUserConfirmationRequired: true,
  };
}

function toolCall(
  id: string,
  toolId: ModyAssistantToolId,
  label: string,
  bridgeAction: ModyAssistantBridgeAction,
  permissionLevel: ToolPermissionLevel,
  riskLabel: ToolRiskLabel,
  autoRun: boolean,
  requiresUserConsent: boolean,
  inputSummary: string,
  expectedObservation: string,
): ModyAssistantAgentToolCall {
  return {
    id,
    toolId,
    label,
    bridgeAction,
    permissionLevel,
    riskLabel,
    autoRun,
    requiresUserConsent,
    reason: requiresUserConsent ? "사용자 선택이 필요한 단계입니다." : "대화 안에서 바로 관찰 가능한 단계입니다.",
    inputSummary: inputSummary.slice(0, 180),
    expectedObservation,
  };
}

function createInitialObservation(toolCall: ModyAssistantAgentToolCall): ModyAssistantAgentObservation {
  return {
    id: `${toolCall.id}:observation`,
    toolCallId: toolCall.id,
    status: toolCall.requiresUserConsent ? "approval_required" : "queued",
    summary: toolCall.expectedObservation,
  };
}

function statusFor(
  input: ModyAssistantAgentInput,
  toolCalls: ModyAssistantAgentToolCall[],
): ModyAssistantAgentRun["status"] {
  if (!input.desktopReady) return "needs_desktop";
  if (!input.aiConnected) return "needs_ai_connection";
  if (toolCalls.some((tool) => tool.requiresUserConsent)) return "planned";
  return "ready_to_answer";
}

function responseModeFor(
  status: ModyAssistantAgentRun["status"],
  toolCalls: ModyAssistantAgentToolCall[],
): ModyAssistantAgentRun["responseMode"] {
  if (status === "needs_desktop") return "ask_for_desktop";
  if (status === "needs_ai_connection") return "ask_for_ai_connection";
  if (toolCalls.some((tool) => tool.autoRun && tool.bridgeAction !== "generate_ai_text")) return "run_tools_then_answer";
  return "answer_with_model";
}

function timelineFor(
  input: ModyAssistantAgentInput,
  intent: ModyAssistantAgentIntent,
  toolCalls: ModyAssistantAgentToolCall[],
  status: ModyAssistantAgentRun["status"],
): string[] {
  return [
    `intent=${intent}`,
    `desktop=${input.desktopReady ? "ready" : "required"}`,
    `ai=${input.aiConnected ? "ready" : "required"}`,
    `status=${status}`,
    ...toolCalls.map((tool) => `${tool.bridgeAction}:${tool.autoRun ? "auto" : "consent"}`),
  ];
}

function auditMessagesFor(
  input: ModyAssistantAgentInput,
  intent: ModyAssistantAgentIntent,
  toolCalls: ModyAssistantAgentToolCall[],
  status: ModyAssistantAgentRun["status"],
  runtimeRoleContext: ModyAssistantRuntimeRoleContext,
  roleWorkRoute: ModyAssistantRoleWorkRoute,
): string[] {
  return [
    `ModyAssistantAgentCore classified chat request as ${intent}.`,
    `Runtime status=${status}; desktopReady=${input.desktopReady}; aiConnected=${input.aiConnected}.`,
    `Registered ${toolCalls.length} tool calls with approval-aware consent boundaries.`,
    `Runtime role=${runtimeRoleContext.teammateName}/${runtimeRoleContext.roleTitle}; contract=${runtimeRoleContext.contract}.`,
    `Role work route=${roleWorkRoute.contract}; status=${roleWorkRoute.status}; approval=${roleWorkRoute.approvalGateLabel}.`,
    "External mutation tools are not auto-run by the chat agent core.",
  ];
}

function chatSummaryFor(
  intent: ModyAssistantAgentIntent,
  toolCalls: ModyAssistantAgentToolCall[],
  status: ModyAssistantAgentRun["status"],
) {
  if (status === "needs_desktop") return "설치 앱 런타임이 필요합니다.";
  if (status === "needs_ai_connection") return "AI 연결 동의가 필요합니다.";
  const consentCount = toolCalls.filter((tool) => tool.requiresUserConsent).length;
  if (consentCount) return `${intentLabel(intent)}을 위해 ${consentCount}개 단계는 사용자 선택 후 진행합니다.`;
  return `${intentLabel(intent)}을 대화 안에서 바로 처리합니다.`;
}

function intentLabel(intent: ModyAssistantAgentIntent) {
  const labels: Record<ModyAssistantAgentIntent, string> = {
    answer: "일반 답변",
    connect_ai: "AI 연결",
    mail_ops: "메일 업무",
    today_ops: "오늘 업무",
    automation_check: "자동화 점검",
    folder_tidy: "폴더 정리",
    document_learning: "자료 분석",
    messenger_setup: "알림 채널",
    toolchain_check: "작업 도구",
    crewkit_recommendation: "필요 기능 추천",
    office_queue: "오피스 승인함",
    worker_delegation: "AI 팀원 위임",
  };
  return labels[intent];
}

function defaultTeammateId(intent: ModyAssistantAgentIntent) {
  if (intent === "mail_ops") return "mailops-assistant";
  if (intent === "automation_check") return "automation-assistant";
  if (intent === "document_learning") return "document-assistant";
  return "general-assistant";
}

function defaultTeammateName(intent: ModyAssistantAgentIntent) {
  if (intent === "mail_ops") return "메일 업무 담당자";
  if (intent === "automation_check") return "자동화 담당자";
  if (intent === "document_learning") return "문서 담당자";
  return "업무 비서";
}

function defaultRoleTitle(intent: ModyAssistantAgentIntent) {
  if (intent === "mail_ops") return "문의 선별과 답장 초안";
  if (intent === "automation_check") return "반복 업무 점검";
  if (intent === "document_learning") return "자료 분석과 문서 초안";
  return "업무 요청 정리";
}

function defaultChannelName(intent: ModyAssistantAgentIntent) {
  if (intent === "mail_ops") return "메일 업무실";
  if (intent === "automation_check") return "자동화 업무실";
  if (intent === "document_learning") return "문서 업무실";
  return "기본 업무실";
}

function workAutomationLabelsForIntent(intent: ModyAssistantAgentIntent) {
  if (intent === "mail_ops") {
    return {
      candidateLabel: "메일/문의 확인 -> 답장 초안 -> 일정 후보",
      pipelineLabel: "메일/문의 확인 -> 답장 초안 -> 일정 후보 -> 승인함 -> 실행 로그",
    };
  }
  if (intent === "automation_check") {
    return {
      candidateLabel: "반복 규칙 확인 -> 점검 후보 -> 승인 후보",
      pipelineLabel: "기본 꺼짐 저장 -> 사용자가 켠 규칙 점검 -> 승인함 -> 실행 로그",
    };
  }
  if (intent === "document_learning") {
    return {
      candidateLabel: "자료 읽기 -> 문서/보고서 초안 -> 승인함",
      pipelineLabel: "자료 범위 확인 -> 초안 후보 -> 승인함 -> 실행 로그",
    };
  }
  return {
    candidateLabel: "대화 의도 판단 -> 필요한 업무 후보 선택",
    pipelineLabel: "요청 분류 -> 역할 배정 -> 후보 생성 -> 승인함",
  };
}
