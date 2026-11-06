/**
 * 모델 주도 반복 루프 — 텍스트 프로토콜 모듈.
 *
 * 네이티브 function-calling 이 검증되지 않은 백엔드에서도 동작하는 자유텍스트 규약:
 *   - 도구가 필요하면 모델이 답변 "첫 줄"에 정확히 `TOOL=<id>|ARGS=<한 줄 JSON>` 만 출력
 *   - 아니면 그 출력 전체가 최종 답변
 *
 * 안전 원칙:
 *   - 판정은 항상 "전문(full text)" 첫 줄 파싱으로 — 스트림 청크 경계에 의존하지 않음
 *   - 스트림 스니퍼는 TOOL 줄이 화면 버블에 보이지 않게 하는 UI 전용 장치
 *   - 규약 밖 출력은 전부 "그냥 답변"으로 강등 (잘못 실행되는 방향의 실패 없음)
 */

import { formatAgentToolsForPrompt, type AgentToolEntry } from "./agent-tools";
import { buildMailToolObservationPrompt } from "./mail-conversation-response";

const toolLinePrefix = "TOOL=";
const toolLinePattern = /^TOOL=([A-Za-z0-9._-]+)(?:\|ARGS=(\{.*\}))?\s*$/u;

export type AgentLoopObservation = {
  toolId: string;
  summary: string;
};

export type AgentToolCallParse =
  | { kind: "tool"; toolId: string; args: Record<string, unknown>; raw: string }
  | { kind: "unknown_tool"; toolId: null; raw: string }
  | null;

/**
 * 반복 프롬프트에 덧붙이는 프로토콜 블록.
 * finalForced=true 면 도구 호출 금지 계약으로 교체합니다(예산 소진 그레이스 호출).
 * extraToolBlock 은 요청에 맞춰 고른 추가 도구 안내(예: 일상 도구 후보)입니다. 비어 있으면 넣지 않습니다.
 */
export function buildAgentLoopProtocolBlock(
  tools: AgentToolEntry[],
  observations: AgentLoopObservation[],
  iteration: number,
  maxIterations: number,
  finalForced: boolean,
  requestText = "",
  extraToolBlock = "",
): string {
  const observationBlock = observations.length
    ? [
        "[지금까지의 도구 결과]",
        ...observations.map(
          (observation, index) => `[도구 결과 ${index + 1}: ${observation.toolId}] ${observation.summary}`,
        ),
      ].join("\n")
    : "";
  const mailResponseBlock = buildMailToolObservationPrompt(observations, requestText);
  const usedDailyLookup = observations.some((observation) => observation.toolId === "daily.lookup");
  const dailySourceRule = usedDailyLookup
    ? "일상 도구 조회 결과를 쓸 때는 답변 끝에 출처와 조회 시각을 한 줄로 알려 주세요. 조회에 실패한 값은 추측하지 마세요."
    : "";

  if (finalForced) {
    return [
      "[도구 사용 종료]",
      "이번 턴에는 더 이상 도구를 호출할 수 없습니다. 지금까지의 도구 결과만으로 사용자에게 최종 답변을 작성하세요.",
      "TOOL= 로 시작하는 줄은 출력하지 마세요.",
      dailySourceRule,
      mailResponseBlock,
      observationBlock,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "[사용 가능한 도구]",
    formatAgentToolsForPrompt(tools),
    "[도구 사용 규칙]",
    [
      `지금은 ${maxIterations}번 중 ${iteration}번째 판단입니다.`,
      "사용자 요청을 처리하는 데 도구 확인이 필요하면, 답변의 첫 줄에 정확히 다음 형식 한 줄만 출력하고 멈추세요:",
      "TOOL=<도구 id>|ARGS=<한 줄 JSON>",
      '예: TOOL=docs.search|ARGS={"query":"계약서"} / 인자가 없으면 TOOL=work.sync 처럼 ARGS 를 생략하세요.',
      "같은 도구를 같은 인자로 두 번 호출하지 마세요. 이미 [도구 결과] 에 있는 정보는 다시 조회하지 마세요.",
      "권한이 approval 인 도구는 앱이 바로 실행하지 않고 사용자에게 승인 버튼으로 제안합니다.",
      "도구가 필요 없거나 정보가 충분하면 TOOL 줄 없이 보통처럼 한국어로 최종 답변하세요.",
      "잡담, 인사, 단순 질문에는 도구를 호출하지 마세요.",
    ].join("\n"),
    extraToolBlock && tools.some((tool) => tool.id === "daily.lookup") ? extraToolBlock : "",
    dailySourceRule,
    mailResponseBlock,
    observationBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 선행 코드펜스/공백을 제거한 첫 비공백 줄을 얻습니다. */
function firstMeaningfulLine(outputText: string): string {
  const lines = String(outputText ?? "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // ``` 또는 ```text 같은 펜스 시작 줄은 건너뜀
    if (/^`{3,}[a-zA-Z]*$/u.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}

/**
 * 전문 첫 줄 기준 도구 호출 파싱.
 *  - 등록 여부는 호출부(findAgentTool)가 판정하므로 여기서는 형식만 봅니다.
 *  - 형식 불일치 → null (최종 답변)
 */
export function parseAgentToolCallLine(outputText: string): AgentToolCallParse {
  const line = firstMeaningfulLine(outputText);
  if (!line.startsWith(toolLinePrefix)) return null;
  const match = toolLinePattern.exec(line);
  if (!match) {
    // TOOL= 로 시작했지만 형식이 깨짐 — 실행하지 않고 교정 관찰 대상으로 표시
    return { kind: "unknown_tool", toolId: null, raw: line };
  }
  const toolId = match[1];
  let args: Record<string, unknown> = {};
  if (match[2]) {
    try {
      const parsed = JSON.parse(match[2]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = {};
    }
  }
  return { kind: "tool", toolId, args, raw: line };
}

/** 최종 답변에서 TOOL 프로토콜 줄을 제거합니다(규약 위반 안전망). */
export function sanitizeAgentAnswerText(text: string): string {
  return String(text ?? "")
    .split("\n")
    .filter((line) => !line.trim().startsWith(toolLinePrefix))
    .join("\n")
    .trim();
}

/** 도구 중복 호출 방지 키 — 인자 키 정렬 canonical JSON */
export function makeToolDedupeKey(toolId: string, args: Record<string, unknown>): string {
  const sortedKeys = Object.keys(args ?? {}).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of sortedKeys) canonical[key] = args[key];
  return `${toolId}::${JSON.stringify(canonical)}`;
}

export type ToolPrefixSniffer = {
  /** 스트림 델타 수신 — TOOL 줄 가능성이 있는 동안 보류, 아니면 flush */
  onDelta: (delta: string) => void;
  /** 스트림 정상 종료 — 미판정 잔여 버퍼 flush 여부 결정 */
  finish: () => { suppressed: boolean };
  /** 반복 종료(타임아웃 포함) — 이후 도착하는 델타 전부 무시 */
  settle: () => void;
};

/**
 * UI 전용 prefix 스니퍼 — 누적 버퍼가 "TOOL=" 의 prefix 일 수 있는 동안만 보류하고,
 * 불일치가 확정되는 즉시 전부 flush 합니다(일반 한국어 답변은 첫 델타에서 바로 렌더).
 * 제어 판정은 전문 파싱이 담당하므로 이 장치는 화면 노출 억제만 책임집니다.
 */
export function createToolPrefixSniffer(flush: (delta: string) => void): ToolPrefixSniffer {
  let buffer = "";
  let decided = false;
  let suppressing = false;
  let settled = false;

  const couldStillBeToolLine = (candidate: string): boolean => {
    // 선행 공백/펜스 허용 — 정규화 후 비교
    const normalized = candidate.replace(/^\s*(?:`{3,}[a-zA-Z]*\s*)?/u, "");
    if (!normalized) return true; // 아직 판단 불가
    const probe = normalized.slice(0, toolLinePrefix.length);
    return toolLinePrefix.startsWith(probe) || normalized.startsWith(toolLinePrefix);
  };

  return {
    onDelta(delta: string) {
      if (settled || !delta) return;
      if (decided) {
        if (!suppressing) flush(delta);
        return;
      }
      buffer += delta;
      const normalized = buffer.replace(/^\s*(?:`{3,}[a-zA-Z]*\s*)?/u, "");
      if (normalized.startsWith(toolLinePrefix)) {
        decided = true;
        suppressing = true;
        return;
      }
      if (!couldStillBeToolLine(buffer)) {
        decided = true;
        suppressing = false;
        flush(buffer);
        buffer = "";
      }
      // 아직 prefix 가능성이 남아 있으면 계속 보류
    },
    finish() {
      if (settled) return { suppressed: suppressing };
      if (!decided && buffer) {
        // 짧은 미판정 버퍼("TOO" 등)는 일반 텍스트로 간주해 flush
        flush(buffer);
        buffer = "";
      }
      return { suppressed: suppressing };
    },
    settle() {
      settled = true;
    },
  };
}
