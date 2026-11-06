/**
 * 위임받은 AI 팀원을 "실제로 일하게" 붙이는 얇은 배선.
 *
 * 도메인의 순수 루프(runModyDelegatedAgentTurn)에 이 앱이 이미 갖고 있는 세 가지를
 * 꽂아준다 — 도구 레지스트리(agent-tools), 텍스트 프로토콜(agent-loop-protocol),
 * 그리고 호출부가 넘겨주는 모델 호출 함수. 규약이나 도구 목록을 여기서 새로 만들지
 * 않는다. 메인 비서와 위임 직원이 같은 도구·같은 규약을 쓰게 하는 것이 목적이다.
 *
 * 모델 호출을 주입받는 이유: `createAITextGenerationPayload`, `readPreferredAITextModel`,
 * `withTimeout` 이 전부 page.tsx 안에 있다. 그걸 이 모듈로 끌어오면 page.tsx 를 더
 * 얽히게 만들 뿐이라, 호출 방법은 호출부에 두고 여기서는 "언제 부를지"만 정한다.
 */

import {
  runModyDelegatedAgentTurn,
  type ModyDelegatedApprovalRequest,
  type ModyDelegatedObservation,
  type ModyDelegatedPermissionMode,
  type ModyDelegatedTool,
} from "../../../packages/domain/dist/hive/delegated-agent-loop.js";

import {
  getAgentToolRegistryForWorkPacks,
  type AgentToolBridge,
  type AgentToolContext,
  type AgentToolEntry,
} from "./agent-tools";
import {
  buildAgentLoopProtocolBlock,
  makeToolDedupeKey,
  parseAgentToolCallLine,
  sanitizeAgentAnswerText,
} from "./agent-loop-protocol";
import { withCrewSkillTools } from "./crew-skills";
import { crewSkillRoleIdForTeammate, crewSkillTemplateIdForTeammate } from "./crew-skill-roles";
import {
  formatCrewSkillMatchesForPrompt,
  selectCrewSkillsForTeammate,
} from "../../../packages/domain/dist/crew-skills.js";

export type DelegatedTeammateTurnInput = {
  /** 도구가 실제로 두드릴 데스크톱 브리지. */
  bridge: AgentToolBridge;
  /** 도구 결과를 이 팀원의 것으로 기록하기 위한 식별자. */
  teammateId: string;
  /**
   * 이 팀원이 맡기로 한 업무 종류. 도구 경계의 근거다 — 비우면 공용 도구만 받는다.
   * 호출부가 workPackIdsForTeammate 로 계산해서 넘긴다.
   */
  workPackIds?: readonly string[];
  /** 대표가 시킨 원 요청 — 프로토콜 블록이 메일 응답 힌트를 만들 때 쓴다. */
  requestText: string;
  /** 팀원 정체성·기억·스킬이 이미 들어간 기본 프롬프트(호출부가 조립). */
  basePrompt: string;
  /** 승인 / 권한 무시. 외부로 나가는 도구는 이 값과 무관하게 항상 승인을 받는다. */
  permissionMode: ModyDelegatedPermissionMode;
  /** 프롬프트 1회 → 출력 텍스트. 실패하면 throw 한다. */
  generate: (prompt: string) => Promise<string>;
  /** mail.intake 가 쓰는 페이지 수준 시나리오 포커스. */
  scenarioFocus?: unknown;
  /** 학습 자료 인덱스가 있는 곳. 메인 대화가 보는 것과 같은 값을 넘긴다. */
  localStorageRoot?: string;
  /**
   * 이 위임이 속한 업무 대화 id. 크루 스킬 실행 범위(설계 확인 계획·기록·동시 실행 잠금)와 PC 작업 기록을 대화마다 나눈다.
   * 비우면 같은 직원의 다른 대화와 범위를 함께 쓴다 — 호출부가 대화 id 를 넘겨야 한다.
   */
  threadId?: string;
  maxIterations?: number;
  wallClockMs?: number;
};

export type DelegatedTeammateTurnResult = {
  /**
   * 기존 위임 경로가 기대하는 모양 그대로 돌려준다.
   * 이 값이 `generateAIText` 의 결과 자리에 그대로 들어가므로 산출물 저장·업무 이벤트·
   * 검토 카드 같은 하류 코드를 하나도 고치지 않아도 된다.
   */
  status: "generate_content_loaded" | "generate_content_failed";
  outputText?: string;
  errorMessage?: string;
  usedToolIds: string[];
  observations: ModyDelegatedObservation[];
  approvalRequests: ModyDelegatedApprovalRequest[];
  iterations: number;
};

/** 레지스트리 항목에서 루프가 필요로 하는 최소 정보만 뽑는다. */
function toDelegatedTool(entry: AgentToolEntry): ModyDelegatedTool {
  return { id: entry.id, korLabel: entry.korLabel, permission: entry.permission };
}

/**
 * 위임 직원 한 턴을 도구까지 써서 끝까지 돌린다.
 *
 * 기본값이 메인 비서보다 보수적인 이유: 위임은 여러 명이 동시에 돈다. 한 명이
 * 도구를 오래 붙잡으면 나머지가 같이 늦어지므로 반복 4회·75초로 묶는다.
 */
export async function runDelegatedTeammateTurn(
  input: DelegatedTeammateTurnInput,
): Promise<DelegatedTeammateTurnResult> {
  // 맡은 업무 범위에 맞는 도구만 준다. 목록과 실행이 같은 배열을 보므로,
  // 모델이 목록 밖 id 를 불러도 아래 executeTool 에서 걸린다.
  // 크루 스킬 도구(지침 읽기·실제 실행)는 데스크톱 연결이 있는 설치본에서만 더한다.
  const registry = withCrewSkillTools(getAgentToolRegistryForWorkPacks(input.workPackIds), input.bridge);
  const byId = new Map<string, AgentToolEntry>();
  for (const entry of registry) byId.set(entry.id, entry);

  // 위임 요청에 맞는 크루 스킬 절차. 맡은 직원의 스킬을 먼저 보고, 없으면 같은 팀 직무의 스킬로 넓힌다.
  const teammateRef = { id: input.teammateId };
  const crewSkillBlock = formatCrewSkillMatchesForPrompt(
    selectCrewSkillsForTeammate(
      { roleId: crewSkillRoleIdForTeammate(teammateRef), templateId: crewSkillTemplateIdForTeammate(teammateRef) },
      input.requestText,
    ),
  );

  // threadId 는 도구 문맥 타입(agent-tools)에 아직 없어서 넓힌 타입으로 넣는다. 크루 스킬·PC 도구가 contextThreadId 로 읽는다.
  const toolContext: AgentToolContext & { threadId?: string } = {
    teammateId: input.teammateId,
    ...(input.scenarioFocus === undefined ? {} : { scenarioFocus: input.scenarioFocus }),
    // 위임 직원도 메인과 같은 학습 자료 인덱스를 봐야 한다.
    ...(input.localStorageRoot ? { localStorageRoot: input.localStorageRoot } : {}),
    ...(input.threadId ? { threadId: input.threadId.trim().slice(0, 240) } : {}),
  };

  const result = await runModyDelegatedAgentTurn(
    {
      tools: registry.map(toDelegatedTool),
      permissionMode: input.permissionMode,
      maxIterations: input.maxIterations ?? 4,
      wallClockMs: input.wallClockMs ?? 75_000,
    },
    {
      buildPrompt: ({ iteration, maxIterations, finalForced, observations }) =>
        [
          input.basePrompt,
          crewSkillBlock,
          buildAgentLoopProtocolBlock(
            registry,
            observations,
            iteration,
            maxIterations,
            finalForced,
            input.requestText,
          ),
        ]
          .filter(Boolean)
          .join("\n\n"),
      generate: input.generate,
      parseToolCall: (outputText) => parseAgentToolCallLine(outputText),
      sanitizeAnswer: sanitizeAgentAnswerText,
      dedupeKey: makeToolDedupeKey,
      executeTool: async (tool, args) => {
        const entry = byId.get(tool.id);
        if (!entry) return "등록되지 않은 도구라 실행하지 않았습니다.";
        return entry.execute(input.bridge, args, toolContext);
      },
    },
  );

  const answer = (result.answerText ?? "").trim();
  if (!answer) {
    return {
      status: "generate_content_failed",
      errorMessage:
        result.stopReason === "generate_failed"
          ? "AI 연결이 끊겨 팀원 답변을 만들지 못했습니다."
          : "팀원이 답변을 만들지 못했습니다.",
      usedToolIds: result.usedToolIds,
      observations: result.observations,
      approvalRequests: result.approvalRequests,
      iterations: result.iterations,
    };
  }

  return {
    status: "generate_content_loaded",
    outputText: answer,
    usedToolIds: result.usedToolIds,
    observations: result.observations,
    approvalRequests: result.approvalRequests,
    iterations: result.iterations,
  };
}

/**
 * 팀원이 어떤 도구를 썼는지 사람이 읽는 한 줄로 요약한다.
 * 산출물 파일과 검토 카드에 붙여 "무엇을 근거로 이런 답을 냈는지" 보이게 하는 용도다.
 */
export function summarizeDelegatedToolUsage(result: DelegatedTeammateTurnResult): string {
  const parts: string[] = [];
  if (result.usedToolIds.length > 0) {
    parts.push(`사용한 도구: ${result.usedToolIds.join(", ")}`);
  }
  if (result.approvalRequests.length > 0) {
    parts.push(
      `승인 대기: ${result.approvalRequests.map((request) => request.label).join(", ")}`,
    );
  }
  return parts.join(" · ");
}
