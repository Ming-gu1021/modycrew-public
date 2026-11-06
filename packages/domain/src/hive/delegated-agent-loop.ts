/**
 * 위임받은 직원이 실제로 "일하게" 만드는 반복 루프.
 *
 * 왜 필요한가: 대표가 직원에게 일을 시키면 지금은 이런 일이 벌어진다.
 *
 *   // apps/modycrew-web/app/page.tsx:26854
 *   await withTimeout(bridge.generateAIText({ prompt, teammate, ... }), 24_000)
 *
 * 모델을 **한 번** 부르고 끝이다. 도구도 없고 반복도 없다. 그래서 위임받은
 * 직원은 24초 안에 글 한 편을 쓸 뿐 아무것도 하지 못한다. 정작 메인 비서는
 * 18개 도구로 관찰→판단→재시도를 반복한다(page.tsx:27446). 도구가 없어서가
 * 아니라 **위임 경로만 그 루프에 연결되어 있지 않아서** 생긴 결함이다.
 *
 * 이 모듈은 그 루프를 순수 함수로 옮긴 것이다. 모델 호출과 도구 실행을 밖에서
 * 주입받으므로 브라우저·브리지·Electron 없이 테스트할 수 있고, 웹은 이미 있는
 * 도구 레지스트리(lib/agent-tools.ts)와 프로토콜(lib/agent-loop-protocol.ts)을
 * 그대로 넘기기만 하면 된다. 규약을 두 벌로 만들지 않는다.
 *
 * 설계 출처: Munder Difflin (MIT, Copyright (c) 2026 Chaitanya Giri) 의
 * 오케스트레이션 계층에서 "직원이 스스로 판단하고 막히면 사람에게 묻는다" 는
 * 구조를 참고했다. 코드는 우리 규약(TOOL= 한 줄 프로토콜)에 맞춰 새로 썼다.
 */

/** 루프가 알아야 하는 도구의 최소 형태. 실제 레지스트리 항목이 이 모양을 만족한다. */
export type ModyDelegatedTool = {
  id: string;
  /** 사람이 읽는 이름 — 승인 요청 카드에 그대로 쓰인다. */
  korLabel?: string;
  /** auto = 바로 실행 가능, approval = 사용자 승인이 필요한 도구. */
  permission: "auto" | "approval";
};

/** 승인 / 권한 무시 — 오너 결정(D8). */
export type ModyDelegatedPermissionMode = "approval" | "bypass";

export type ModyDelegatedObservation = {
  toolId: string;
  summary: string;
};

export type ModyDelegatedApprovalRequest = {
  toolId: string;
  label: string;
  args: Record<string, unknown>;
  /** 왜 승인이 필요한지 — 사용자에게 그대로 보여줄 수 있는 한국어 문장. */
  reason: string;
};

export type ModyDelegatedToolCall =
  | { kind: "tool"; toolId: string; args: Record<string, unknown>; raw: string }
  | { kind: "unknown_tool"; toolId: null; raw: string }
  | null;

export type ModyDelegatedLoopPorts = {
  /** 이번 반복에 모델에게 보낼 프롬프트를 만든다. */
  buildPrompt: (input: {
    iteration: number;
    maxIterations: number;
    finalForced: boolean;
    observations: ModyDelegatedObservation[];
  }) => string;
  /** 모델 1회 호출. 실패하면 throw 해도 된다 — 루프가 관찰로 바꿔 이어간다. */
  generate: (prompt: string) => Promise<string>;
  /** 모델 출력에서 도구 호출 한 줄을 읽어낸다. */
  parseToolCall: (outputText: string) => ModyDelegatedToolCall;
  /** 도구 1회 실행. 결과 요약 문자열을 돌려준다. */
  executeTool: (tool: ModyDelegatedTool, args: Record<string, unknown>) => Promise<string>;
  /** 최종 답변에서 규약 줄을 지운다. 없으면 원문을 그대로 쓴다. */
  sanitizeAnswer?: (text: string) => string;
  /** 같은 호출인지 판정하는 열쇠. 없으면 id + 인자 JSON. */
  dedupeKey?: (toolId: string, args: Record<string, unknown>) => string;
  now?: () => number;
};

export type ModyDelegatedLoopInput = {
  tools: ModyDelegatedTool[];
  permissionMode: ModyDelegatedPermissionMode;
  /** 도구를 몇 번까지 쓸 수 있는가. 기본 4. */
  maxIterations?: number;
  /** 이 시간을 넘기면 도구를 멈추고 지금까지의 결과로 답한다. 기본 90초. */
  wallClockMs?: number;
};

export type ModyDelegatedLoopStopReason =
  | "answered"
  | "max_iterations"
  | "wall_clock"
  | "generate_failed";

export type ModyDelegatedLoopResult = {
  answerText: string;
  observations: ModyDelegatedObservation[];
  usedToolIds: string[];
  /** 실행하지 않고 사용자에게 올린 승인 요청. 승인 모드에서 채워진다. */
  approvalRequests: ModyDelegatedApprovalRequest[];
  iterations: number;
  stopReason: ModyDelegatedLoopStopReason;
};

const defaultMaxIterations = 4;
const defaultWallClockMs = 90_000;

/**
 * 권한 무시 모드로도 절대 건너뛸 수 없는 도구.
 *
 * 오너 결정(D8): "외부로 정보가 나가는 메일 전송 같은 것만 반드시 승인."
 * 지금 레지스트리에는 외부로 내보내는 도구가 없지만(메일은 초안까지만 만든다),
 * 나중에 누가 `mail.send` 를 추가했을 때 권한 무시 모드로 조용히 실행되는 사고를
 * 막기 위해 **이름 규칙으로 미리 막아둔다.** 목록에 없는 새 도구가 안전한 쪽으로
 * 틀리는 것이 아니라, 위험한 쪽 이름을 쓰면 자동으로 걸리게 하는 방향이다.
 */
const alwaysApprovalPatterns = [
  /(^|\.)send(_|\.|$)/iu,
  /(^|\.)share(_|\.|$)/iu,
  /(^|\.)submit(_|\.|$)/iu,
  /(^|\.)pay(ment)?(_|\.|$)/iu,
  /(^|\.)delete(_|\.|$)/iu,
  /(^|\.)publish(_|\.|$)/iu,
];

/** 이 도구는 권한 무시 모드에서도 승인을 받아야 하는가. */
export function requiresApprovalRegardlessOfMode(toolId: string): boolean {
  return alwaysApprovalPatterns.some((pattern) => pattern.test(toolId));
}

function defaultDedupeKey(toolId: string, args: Record<string, unknown>): string {
  let serialized = "";
  try {
    serialized = JSON.stringify(args ?? {});
  } catch {
    serialized = "";
  }
  return `${toolId}:${serialized}`;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? "").trim();
  return text || "알 수 없는 오류";
}

/**
 * 위임받은 직원의 한 턴을 끝까지 돌린다.
 *
 * 실패 방향의 원칙: 어떤 단계가 깨져도 **도구를 잘못 실행하는 쪽으로는 틀리지 않는다.**
 * 규약을 벗어난 출력은 전부 "그냥 답변"으로 강등하고, 승인이 필요한 도구는
 * 실행하지 않고 요청만 쌓는다.
 */
export async function runModyDelegatedAgentTurn(
  input: ModyDelegatedLoopInput,
  ports: ModyDelegatedLoopPorts,
): Promise<ModyDelegatedLoopResult> {
  const maxIterations = Math.max(1, input.maxIterations ?? defaultMaxIterations);
  const wallClockMs = Math.max(1_000, input.wallClockMs ?? defaultWallClockMs);
  const now = ports.now ?? (() => Date.now());
  const dedupeKeyOf = ports.dedupeKey ?? defaultDedupeKey;
  const sanitize = ports.sanitizeAnswer ?? ((text: string) => text);

  const toolsById = new Map<string, ModyDelegatedTool>();
  for (const tool of input.tools) toolsById.set(tool.id, tool);

  const observations: ModyDelegatedObservation[] = [];
  const usedToolIds: string[] = [];
  const approvalRequests: ModyDelegatedApprovalRequest[] = [];
  const seenCalls = new Set<string>();
  const startedAt = now();

  let iterations = 0;

  // 마지막 한 번은 "도구 없이 답만 쓰는" 유예 호출이다. 그래야 도구 예산이
  // 떨어졌을 때 답변 없이 끝나지 않는다.
  for (let iteration = 1; iteration <= maxIterations + 1; iteration += 1) {
    iterations = iteration;
    const outOfBudget = iteration > maxIterations;
    const outOfTime = now() - startedAt > wallClockMs;
    const finalForced = outOfBudget || outOfTime;

    const prompt = ports.buildPrompt({
      iteration,
      maxIterations,
      finalForced,
      observations: [...observations],
    });

    let outputText = "";
    try {
      outputText = await ports.generate(prompt);
    } catch (error) {
      // 모델 호출이 죽으면 지금까지 모은 관찰이라도 들고 끝낸다.
      return {
        answerText: "",
        observations,
        usedToolIds,
        approvalRequests,
        iterations,
        stopReason: "generate_failed",
      };
    }

    if (finalForced) {
      return {
        answerText: sanitize(outputText),
        observations,
        usedToolIds,
        approvalRequests,
        iterations,
        stopReason: outOfTime && !outOfBudget ? "wall_clock" : "max_iterations",
      };
    }

    const parsed = ports.parseToolCall(outputText);

    if (!parsed) {
      return {
        answerText: sanitize(outputText),
        observations,
        usedToolIds,
        approvalRequests,
        iterations,
        stopReason: "answered",
      };
    }

    if (parsed.kind === "unknown_tool") {
      observations.push({
        toolId: "(형식 오류)",
        summary: `도구 호출 형식이 규약과 달라 실행하지 않았습니다: ${parsed.raw}`,
      });
      continue;
    }

    const tool = toolsById.get(parsed.toolId);
    if (!tool) {
      observations.push({
        toolId: parsed.toolId,
        summary: "등록되지 않은 도구라 실행하지 않았습니다. 다른 방법을 찾으세요.",
      });
      continue;
    }

    const key = dedupeKeyOf(tool.id, parsed.args);
    if (seenCalls.has(key)) {
      observations.push({
        toolId: tool.id,
        summary: "같은 인자로 이미 호출한 도구입니다. 앞의 결과를 그대로 쓰세요.",
      });
      continue;
    }
    seenCalls.add(key);

    const mustAsk = requiresApprovalRegardlessOfMode(tool.id);
    const needsApproval =
      mustAsk || (tool.permission === "approval" && input.permissionMode === "approval");

    if (needsApproval) {
      const label = tool.korLabel ?? tool.id;
      const reason = mustAsk
        ? "외부로 나가는 작업이라 권한 무시 모드에서도 사용자 승인을 받습니다."
        : "사용자 승인이 필요한 도구입니다.";
      approvalRequests.push({ toolId: tool.id, label, args: parsed.args, reason });
      observations.push({
        toolId: tool.id,
        summary: `${label}은(는) 승인이 필요해 실행하지 않고 승인함에 올렸습니다. 승인 전까지는 이 결과를 가정하지 마세요.`,
      });
      continue;
    }

    let summary = "";
    try {
      summary = await ports.executeTool(tool, parsed.args);
    } catch (error) {
      observations.push({
        toolId: tool.id,
        summary: `도구 실행이 실패했습니다: ${errorText(error)}`,
      });
      continue;
    }

    usedToolIds.push(tool.id);
    observations.push({ toolId: tool.id, summary: summary || "(결과 없음)" });
  }

  // 도달할 수 없는 경로(유예 호출이 항상 반환한다)지만 타입을 위해 남긴다.
  return {
    answerText: "",
    observations,
    usedToolIds,
    approvalRequests,
    iterations,
    stopReason: "max_iterations",
  };
}
