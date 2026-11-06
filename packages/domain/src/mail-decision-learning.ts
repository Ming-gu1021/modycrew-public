import type { ModyMailRecipientListReview } from "./mail-recipient-list-review.js";

export type ModyMailDecisionWorkPattern = {
  id?: string;
  sourceKind?: string;
  sourceLabel?: string;
  summary?: string;
  signals?: string[];
  metrics?: Record<string, string | number | boolean>;
};

export type ModyMailDecisionLearningProfile = {
  status: "learning_ready" | "learning_empty";
  matchedPatternCount: number;
  preferredTargetGroupLabels: string[];
  exclusionRuleHints: string[];
  toneHints: string[];
  approvalHabitLabels: string[];
  learningDecisionHints: string[];
  learnedSendMatchLabels: string[];
  learnedReviewCautionLabels: string[];
  learnedIncludeOverrideLabels: string[];
  learnedExcludeOverrideLabels: string[];
  learnedHoldOverrideLabels: string[];
  learnedOverrideSuggestionSummary: string;
  learnedDefaultDecisionMatrix: {
    send: string[];
    hold: string[];
    exclude: string[];
  };
  learnedDefaultDecisionSummary: string;
  summary: string;
  evidenceLabels: string[];
  privacyBoundary: string;
};

export function summarizeMailDecisionLearningPatterns(input: {
  workPatterns?: ModyMailDecisionWorkPattern[];
  recipientReview?: Pick<
    ModyMailRecipientListReview,
    "recommendedTargetGroups" | "exclusionRuleSummary" | "recipientDecisionSummary"
    | "recipientDecisionMatrix"
  >;
}): ModyMailDecisionLearningProfile {
  const patterns = (input.workPatterns ?? [])
    .map(normalizePattern)
    .filter((pattern) => pattern.text && looksMailDecisionPattern(pattern.text))
    .slice(0, 24);

  if (patterns.length === 0) {
    return {
      status: "learning_empty",
      matchedPatternCount: 0,
      preferredTargetGroupLabels: [],
      exclusionRuleHints: [],
      toneHints: [],
      approvalHabitLabels: ["저장된 메일 발송 결정 패턴이 없어 이번 명단의 추천 그룹과 제외 규칙부터 학습합니다."],
      learningDecisionHints: ["이번 명단의 발송/보류/제외 결정표를 첫 학습 기준으로 저장할 수 있습니다."],
      learnedSendMatchLabels: [],
      learnedReviewCautionLabels: ["저장된 대상 그룹 기준 없음"],
      learnedIncludeOverrideLabels: [],
      learnedExcludeOverrideLabels: [],
      learnedHoldOverrideLabels: [],
      learnedOverrideSuggestionSummary: "저장된 명단 수정 요청이 없어 이번 결정 이력을 먼저 학습할 수 있습니다.",
      learnedDefaultDecisionMatrix: { send: [], hold: [], exclude: [] },
      learnedDefaultDecisionSummary: "저장된 수정 기준이 없어 다음 명단 검토의 기본 추천은 원본 결정표에서 시작합니다.",
      summary: "아직 이 사용자에게 맞춘 메일 수신자 결정 학습이 없습니다.",
      evidenceLabels: [],
      privacyBoundary: privacyBoundary(),
    };
  }

  const preferredTargetGroupLabels = unique(
    patterns.flatMap((pattern) => extractTargetGroups(pattern.text)),
  ).slice(0, 6);
  const exclusionRuleHints = unique(
    patterns.flatMap((pattern) => extractLineHints(pattern.text, /(제외|수신거부|중복|누락|opt.?out|unsubscribe)/iu)),
  ).slice(0, 5);
  const toneHints = unique(
    patterns.flatMap((pattern) => extractLineHints(pattern.text, /(말투|톤|문안|짧게|공손|정중|친근|격식)/iu)),
  ).slice(0, 4);
  const approvalHabitLabels = unique(
    patterns.flatMap((pattern) => extractLineHints(pattern.text, /(승인|샘플|dry-run|검토|최종|확인)/iu)),
  ).slice(0, 5);
  const learnedOverrides = createLearnedOverrideSuggestion(patterns.map((pattern) => pattern.text));
  const reviewGroupLabels = (input.recipientReview?.recommendedTargetGroups ?? [])
    .map((group) => group.label)
    .filter(Boolean)
    .slice(0, 4);
  const evidenceLabels = unique([
    ...patterns.map((pattern) => pattern.sourceLabel || pattern.id || "업무 패턴"),
    ...reviewGroupLabels.map((label) => `이번 명단 추천: ${label}`),
  ]).slice(0, 8);
  const learningDecision = createLearningDecisionHints(preferredTargetGroupLabels, input.recipientReview);
  const learnedDefaultDecision = createLearnedDefaultDecision(
    learningDecision.sendMatches,
    learnedOverrides,
  );

  return {
    status: "learning_ready",
    matchedPatternCount: patterns.length,
    preferredTargetGroupLabels,
    exclusionRuleHints: withFallback(
      exclusionRuleHints,
      input.recipientReview?.exclusionRuleSummary?.slice(0, 3) ?? [],
      "이번 명단의 제외/중복/주소 누락 규칙을 기준으로 확인합니다.",
    ),
    toneHints: withFallback(toneHints, [], "저장된 톤 지시가 없어 샘플 문안을 직접 확인합니다."),
    approvalHabitLabels: withFallback(
      approvalHabitLabels,
      [],
      "저장된 승인 습관이 있어도 최종 발송은 사용자 확인 뒤에만 실행합니다.",
    ),
    learningDecisionHints: learningDecision.hints,
    learnedSendMatchLabels: learningDecision.sendMatches,
    learnedReviewCautionLabels: unique([
      ...learningDecision.reviewCautions,
      ...learnedOverrides.excludeLabels.map((label) => `학습 제외 요청 확인: ${label}`),
      ...learnedOverrides.holdLabels.map((label) => `학습 보류 요청 확인: ${label}`),
    ]).slice(0, 6),
    learnedIncludeOverrideLabels: learnedOverrides.includeLabels,
    learnedExcludeOverrideLabels: learnedOverrides.excludeLabels,
    learnedHoldOverrideLabels: learnedOverrides.holdLabels,
    learnedOverrideSuggestionSummary: learnedOverrides.summary,
    learnedDefaultDecisionMatrix: learnedDefaultDecision.matrix,
    learnedDefaultDecisionSummary: learnedDefaultDecision.summary,
    summary: createLearningSummary(patterns.length, preferredTargetGroupLabels, input.recipientReview),
    evidenceLabels,
    privacyBoundary: privacyBoundary(),
  };
}

function normalizePattern(pattern: ModyMailDecisionWorkPattern) {
  const sourceKind = cleanLabel(pattern.sourceKind);
  const sourceLabel = cleanLabel(pattern.sourceLabel);
  const id = cleanLabel(pattern.id);
  const summary = cleanLabel(pattern.summary);
  const signals = Array.isArray(pattern.signals) ? pattern.signals.map(cleanLabel).filter(Boolean) : [];
  const metricText = pattern.metrics
    ? Object.entries(pattern.metrics)
        .map(([key, value]) => `${cleanLabel(key)}: ${cleanLabel(value)}`)
        .join(" / ")
    : "";
  return {
    id,
    sourceKind,
    sourceLabel,
    text: [sourceKind, sourceLabel, summary, ...signals, metricText].filter(Boolean).join("\n"),
  };
}

function looksMailDecisionPattern(text: string): boolean {
  return /(메일|대량|발송|수신자|명단|고객|학부모|거래처|상담|예약|제외|수신거부|중복|문안|승인|mail|recipient|bulk)/iu.test(text);
}

function extractTargetGroups(text: string): string[] {
  const labels: string[] = [];
  for (const line of text.split(/\n+/u)) {
    if (!/(대상|그룹|고객|학부모|거래처|상담|예약|VIP|segment|recipient)/iu.test(line)) continue;
    const cleaned = cleanLabel(
      line
        .replace(/^(대량\s*)?메일\s*/iu, "")
        .replace(/^(대상|그룹|수신자|segment|recipient)\s*(그룹|추천|후보)?\s*[:：-]?\s*/iu, "")
        .replace(/(우선|추천|발송|후보|확인|대상|그룹|고객)$/iu, ""),
    );
    const normalizedTargetLine = cleaned.replace(/([A-Za-z가-힣0-9]+(?:\s*[A-Za-z가-힣0-9]+)?\s*(?:고객|학부모|거래처|예약))\s*(?:와|과)\s*/gu, "$1, ");
    for (const part of normalizedTargetLine.split(/\s*(?:,|\/|·|;|，)\s*/u)) {
      const label = cleanLabel(part)
        .replace(/\s*\d+\s*(건|명)$/u, "")
        .replace(/^.*?(?=(?:VIP|[가-힣A-Za-z0-9]+\s*(?:고객|학부모|거래처|예약)))/u, "")
        .replace(/\s*(우선|추천|발송|후보|확인|검토|제외|합니다|하고).*$/u, "")
        .trim();
      if (label && !/^(없음|확인 필요|업무 패턴|general)$/iu.test(label)) labels.push(label);
    }
  }
  return labels;
}

function extractLineHints(text: string, pattern: RegExp): string[] {
  return text
    .split(/\n+/u)
    .map((line) => cleanLabel(line))
    .filter((line) => pattern.test(line))
    .slice(0, 8);
}

function createLearningSummary(
  matchedPatternCount: number,
  preferredTargetGroupLabels: string[],
  review?: Pick<ModyMailRecipientListReview, "recipientDecisionSummary">,
): string {
  const targetText = preferredTargetGroupLabels.length
    ? `${preferredTargetGroupLabels.slice(0, 3).join(", ")} 같은 대상 그룹을 과거 패턴에서 확인했습니다.`
    : "과거 패턴에서 명확한 대상 그룹명은 아직 부족합니다.";
  const reviewText = review?.recipientDecisionSummary ? `이번 명단 판단: ${review.recipientDecisionSummary}` : "";
  return `저장된 메일 업무 패턴 ${matchedPatternCount}건을 참고합니다. ${targetText}${reviewText ? ` ${reviewText}` : ""}`;
}

function createLearningDecisionHints(
  preferredTargetGroupLabels: string[],
  review?: Pick<ModyMailRecipientListReview, "recommendedTargetGroups" | "recipientDecisionMatrix">,
) {
  const currentSendLabels = (review?.recipientDecisionMatrix?.send ?? [])
    .map((item) => item.label)
    .filter(Boolean);
  const currentHoldLabels = (review?.recipientDecisionMatrix?.hold ?? [])
    .map((item) => item.label)
    .filter(Boolean);
  const currentExcludeLabels = (review?.recipientDecisionMatrix?.exclude ?? [])
    .map((item) => item.label)
    .filter(Boolean);
  const sendMatches = unique(
    currentSendLabels.filter((label) =>
      preferredTargetGroupLabels.some((preferred) => looseIncludes(label, preferred) || looseIncludes(preferred, label)),
    ),
  ).slice(0, 5);
  const missingPreferredTargets = unique(
    preferredTargetGroupLabels.filter((preferred) =>
      currentSendLabels.every((label) => !looseIncludes(label, preferred) && !looseIncludes(preferred, label)),
    ),
  ).slice(0, 5);
  const reviewCautions = unique([
    ...currentHoldLabels.map((label) => `보류 확인: ${label}`),
    ...currentExcludeLabels.map((label) => `제외 유지: ${label}`),
    ...missingPreferredTargets.map((label) => `과거 우선 대상 미포함: ${label}`),
  ]).slice(0, 6);
  const hintCandidates: string[] = [
    sendMatches.length
      ? `과거 발송 패턴과 일치: ${sendMatches.join(", ")}`
      : "현재 추천 그룹은 과거 우선 대상과 직접 일치하지 않습니다.",
    "학습 힌트가 있어도 샘플 문안과 최종 발송은 사용자 승인 뒤에만 실행합니다.",
  ];
  if (missingPreferredTargets.length) {
    hintCandidates.push(`과거 우선 대상 미포함: ${missingPreferredTargets.slice(0, 3).join(", ")}`);
  }
  if (currentHoldLabels.length) {
    hintCandidates.push(`보류 검토 필요: ${currentHoldLabels.slice(0, 3).join(", ")}`);
  }
  if (currentExcludeLabels.length) {
    hintCandidates.push(`제외 유지 확인: ${currentExcludeLabels.slice(0, 3).join(", ")}`);
  }
  const hints = unique(hintCandidates).slice(0, 6);

  return { hints, sendMatches, reviewCautions };
}

function createLearnedOverrideSuggestion(patternTexts: string[]) {
  const includeLabels = unique(patternTexts.flatMap((text) => extractRequestedLabels(text, /(포함|넣|추가|만\s*보내|만\s*발송|include)/iu))).slice(0, 6);
  const excludeLabels = unique(patternTexts.flatMap((text) => extractRequestedLabels(text, /(제외|빼|보내지|발송\s*금지|수신거부|exclude)/iu))).slice(0, 6);
  const holdLabels = unique(patternTexts.flatMap((text) => extractRequestedLabels(text, /(보류|홀드|나중|검토|hold)/iu))).slice(0, 6);
  const summaryParts = [
    includeLabels.length ? `포함 선호 ${includeLabels.join(", ")}` : "",
    excludeLabels.length ? `제외 선호 ${excludeLabels.join(", ")}` : "",
    holdLabels.length ? `보류 선호 ${holdLabels.join(", ")}` : "",
  ].filter(Boolean);
  return {
    includeLabels,
    excludeLabels,
    holdLabels,
    summary: summaryParts.length
      ? `저장된 명단 수정 요청 기준: ${summaryParts.join(" / ")}`
      : "저장된 명단 수정 요청 라벨은 아직 부족합니다.",
  };
}

function createLearnedDefaultDecision(
  sendMatches: string[],
  learnedOverrides: { includeLabels: string[]; excludeLabels: string[]; holdLabels: string[]; summary: string },
) {
  const send = unique([
    ...sendMatches.map((label) => `학습 일치 발송 후보: ${label}`),
    ...learnedOverrides.includeLabels.map((label) => `학습 포함 추천: ${label}`),
  ]).slice(0, 6);
  const exclude = unique(
    learnedOverrides.excludeLabels.map((label) => `학습 제외 추천: ${label}`),
  ).slice(0, 6);
  const hold = unique(
    learnedOverrides.holdLabels.map((label) => `학습 보류 추천: ${label}`),
  ).slice(0, 6);
  const parts = [
    send.length ? `발송 ${send.join(", ")}` : "",
    exclude.length ? `제외 ${exclude.join(", ")}` : "",
    hold.length ? `보류 ${hold.join(", ")}` : "",
  ].filter(Boolean);
  return {
    matrix: { send, hold, exclude },
    summary: parts.length
      ? `다음 명단 검토 기본 추천: ${parts.join(" / ")}. 실제 발송은 사용자 최종 확인 전까지 실행하지 않습니다.`
      : "저장된 수정 기준이 부족해 다음 명단 검토의 기본 추천은 원본 결정표에서 시작합니다.",
  };
}

function extractRequestedLabels(text: string, actionPattern: RegExp): string[] {
  const labels: string[] = [];
  for (const line of text.split(/\n+/u)) {
    if (!actionPattern.test(line)) continue;
    const cleaned = cleanLabel(
      line
        .replace(/^(포함|제외|보류)\s*(요청|선호|기준)?\s*[:：-]?\s*/iu, "")
        .replace(/^(include|exclude|hold)\s*(request|preference)?\s*[:：-]?\s*/iu, ""),
    );
    for (const part of cleaned.split(/\s*(?:,|\/|·|;|，)\s*/u)) {
      const label = cleanLabel(part)
        .replace(/\s*(요청|선호|기준|반영|확인|합니다|하세요).*$/u, "")
        .replace(/\s*\d+\s*(건|명)$/u, "")
        .trim();
      if (label && !/^(없음|추가 없음|현재 추천 기준 유지|기존 기준 유지)$/iu.test(label)) {
        labels.push(label);
      }
    }
  }
  return labels;
}

function looseIncludes(left: string, right: string): boolean {
  const a = cleanLabel(left).replace(/\s+/gu, "");
  const b = cleanLabel(right).replace(/\s+/gu, "");
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function withFallback(values: string[], fallbackValues: string[], fallback: string): string[] {
  const next = unique([...values, ...fallbackValues]).slice(0, 6);
  return next.length ? next : [fallback];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(cleanLabel).filter(Boolean)));
}

function cleanLabel(value: unknown): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/gu, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/gu, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/gu, "[redacted-key]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}

function privacyBoundary(): string {
  return "메일 결정 학습은 저장된 업무 패턴의 라벨과 규칙만 참고하고, 주소/이름/비밀번호/원문 메일은 반환하지 않습니다.";
}
