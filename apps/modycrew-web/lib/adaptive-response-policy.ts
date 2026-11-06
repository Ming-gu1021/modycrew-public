export type AdaptiveResponseDepth = "brief" | "balanced" | "detailed";

export const ADAPTIVE_RESPONSE_POLICY_CONTRACT = "contextual_answer_depth_v1" as const;

const explicitBriefPattern =
  /한\s*줄|한줄|짧게|간단히|간략히|요약만|핵심만|결론만|빠르게|불필요한\s*설명\s*없이|길게\s*말하지/u;
const detailedAnswerPattern =
  /자세히|상세히|충분히|구체적|빠짐없이|전체|전문|원문|근거|이유|왜|비교|분석|검토|보고서|계획|전략|단계별|하나씩|예시|설명(?:해|해줘|해\s*줘)|어떻게/u;

export function inferAdaptiveResponseDepth(text: string): AdaptiveResponseDepth {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) return "balanced";
  if (explicitBriefPattern.test(normalized)) return "brief";

  const questionCount = (normalized.match(/[?？]/gu) ?? []).length;
  const lineCount = String(text ?? "").split(/\r?\n/u).filter((line) => line.trim()).length;
  const hasMultipleRequestedParts = /(?:그리고|또한|동시에|각각|첫째|둘째|1\.|2\.|①|②)/u.test(normalized);
  if (
    detailedAnswerPattern.test(normalized) ||
    normalized.length >= 180 ||
    questionCount >= 2 ||
    lineCount >= 3 ||
    hasMultipleRequestedParts
  ) {
    return "detailed";
  }
  return "balanced";
}

export function buildAdaptiveResponsePromptContext(text: string): string {
  const depth = inferAdaptiveResponseDepth(text);
  const depthInstruction =
    depth === "brief"
      ? "사용자가 짧은 답을 명시했습니다. 핵심 결론과 꼭 필요한 다음 행동만 간결하게 답하세요."
      : depth === "detailed"
        ? "복합 질문이나 분석·설명 요청입니다. 몇 줄로 억지로 줄이지 말고, 결론과 근거, 중요한 세부 내용, 필요한 다음 행동을 충분히 설명하세요."
        : "질문을 완전히 해결할 만큼 설명하되, 같은 말이나 무관한 기능 소개를 반복하지 마세요.";

  return [
    `[답변 분량 정책: ${ADAPTIVE_RESPONSE_POLICY_CONTRACT} / ${depth}]`,
    "답변 길이를 고정하지 말고 현재 질문의 난이도, 사용자가 요구한 깊이, 확인된 자료의 양에 맞추세요.",
    depthInstruction,
    "내부 모델명, 런타임 경로, 계약명, 진단값, 설정 구조는 사용자가 직접 묻거나 문제 해결에 꼭 필요한 경우가 아니면 설명하지 마세요.",
    "AI가 실제 자료를 확인했다면 설정 설명보다 확인한 사실, 판단 결과, 작성한 내용부터 보여주세요.",
  ].join("\n");
}
