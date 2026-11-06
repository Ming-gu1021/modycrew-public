/**
 * 업무 파일 학습 결과 → 맞춤 AI 직원 프로필 초안 합성기.
 *
 * "지정한 업무 파일을 학습하면, 그 사람과 같은 일을 하는 AI 직원 기획을 제안한다"의
 * 핵심 두뇌. 결정형(모델 비의존)이라 같은 학습 결과는 항상 같은 초안을 냅니다.
 *
 * 원칙:
 *  - 웹 레이어 타입을 import 하지 않는다. suggestedTemplateId 는 웹 AITeammateTeam 의
 *    부분집합 문자열 유니언으로 정의하고, 웹 브리지가 1:1 매핑한다.
 *  - 모든 텍스트는 웹 sanitizeAITeammate 캡(name 32 / teamLabel 28 / roleTitle 48 /
 *    channelName 42 / brief 180 / instructions 8×160)에 맞춰 여기서 클램프한다.
 *  - 자동화 추천은 createDocumentAutomationRecommendations 결과를 그대로 싣는다
 *    (전부 startsEnabled:false·승인 필수 — 실행은 사용자 승인 뒤에만).
 */

import type {
  ModyDocumentLearningCategory,
  ModyDocumentLearningPlan,
} from "./local-document-learning.js";
import {
  createDocumentAutomationRecommendations,
  type ModyDocumentAutomationRecommendation,
} from "./document-automation-recommendation.js";
import {
  createAgentBlueprintFromDocumentLearning,
  type ModyAgentBlueprint,
} from "./agent-blueprint.js";

export type ModyTeammateProfileTemplateId =
  | "operations"
  | "mail"
  | "finance"
  | "legal"
  | "desktop"
  | "custom";

export type ModyTeammateProfileDraft = {
  id: string;
  createdAt: string;
  suggestedTemplateId: ModyTeammateProfileTemplateId;
  name: string;
  teamLabel: string;
  roleTitle: string;
  channelName: string;
  brief: string;
  instructions: string[];
  automationRecommendations: ModyDocumentAutomationRecommendation[];
  agentBlueprint?: ModyAgentBlueprint;
  evidence: {
    styleProfileId: string;
    styleProfileName: string;
    reportCadence: string;
    namingPattern: string;
    topCategories: { category: ModyDocumentLearningCategory; label: string; weight: number }[];
    sourceFileLabels: string[];
  };
  approvalRequired: true;
  startsEnabled: false;
  externalMutation: false;
};

export type ModyGeneratedTeammateProfileDraft = ModyTeammateProfileDraft & {
  agentBlueprint: ModyAgentBlueprint;
};

const categoryLabels: Record<ModyDocumentLearningCategory, string> = {
  monthly_report: "보고서",
  settlement_sheet: "정산/매출",
  customer_inquiry: "고객 문의",
  schedule_rule: "일정/운영 규칙",
  tax_material: "세무 자료",
  contract: "계약/발주",
  form_template: "양식/서식",
  general_document: "일반 문서",
};

/** 카테고리 → 템플릿 매핑. 동률은 이 배열의 앞선 항목이 이깁니다(맵 순회 금지). */
const templatePriority: readonly {
  templateId: ModyTeammateProfileTemplateId;
  categories: readonly ModyDocumentLearningCategory[];
  teamLabel: string;
  roleTitle: string;
  nameSeed: string;
  focusLine: string;
}[] = [
  {
    templateId: "finance",
    categories: ["settlement_sheet", "tax_material"],
    teamLabel: "정산·비용",
    roleTitle: "정산·세무 정리 담당",
    nameSeed: "정산 담당",
    focusLine: "정산표·세무 자료를 기준으로 금액 확인과 정리를 먼저 합니다.",
  },
  {
    templateId: "mail",
    categories: ["customer_inquiry", "schedule_rule"],
    teamLabel: "메일·일정",
    roleTitle: "문의 답장·일정 정리 담당",
    nameSeed: "문의 담당",
    focusLine: "문의 자료와 운영 규칙을 기준으로 답장 초안과 일정 후보를 만듭니다.",
  },
  {
    templateId: "legal",
    categories: ["contract"],
    teamLabel: "계약·검토",
    roleTitle: "계약·발주 검토 담당",
    nameSeed: "계약 담당",
    focusLine: "계약·견적·발주 문서를 기준으로 조건 확인과 검토 노트를 만듭니다.",
  },
  {
    templateId: "operations",
    categories: ["form_template", "monthly_report", "general_document"],
    teamLabel: "운영·문서",
    roleTitle: "보고서·양식 운영 담당",
    nameSeed: "운영 담당",
    focusLine: "보고서와 양식 기준을 지키며 반복 문서 작업을 정리합니다.",
  },
];

const caps = {
  name: 32,
  teamLabel: 28,
  roleTitle: 48,
  channelName: 42,
  brief: 180,
  instruction: 160,
  maxInstructions: 8,
} as const;

function clampText(value: string, max: number): string {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

export function createTeammateProfileDraft(
  plan: ModyDocumentLearningPlan,
  options: { workPatternSummaries?: readonly string[]; createdAt?: string } = {},
): ModyGeneratedTeammateProfileDraft {
  const createdAt = String(options.createdAt ?? plan.createdAt ?? new Date().toISOString());

  // 1) 카테고리 가중 집계 — confidence 가중, general_document 는 0.5×(혼합 폴더 지배 방지)
  const weights = new Map<ModyDocumentLearningCategory, number>();
  for (const filePlan of plan.filePlans) {
    const base = Number.isFinite(filePlan.confidence) ? Math.max(0.1, filePlan.confidence) : 0.5;
    const weight = filePlan.category === "general_document" ? base * 0.5 : base;
    weights.set(filePlan.category, (weights.get(filePlan.category) ?? 0) + weight);
  }

  // 2) 템플릿 선택 — 우선순위 배열 순서대로, 담당 카테고리 가중 합이 가장 큰 항목
  const fallbackTemplate = templatePriority[templatePriority.length - 1] as (typeof templatePriority)[number];
  let bestTemplate = fallbackTemplate;
  let bestScore = -1;
  for (const candidate of templatePriority) {
    const score = candidate.categories.reduce(
      (sum, category) => sum + (weights.get(category) ?? 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = candidate;
    }
  }
  // 파일이 전혀 없으면 custom 성격의 운영 기본값 유지(마지막 항목이 operations)

  // 3) 상위 카테고리 근거
  const topCategories = [...weights.entries()]
    .sort((left, right) =>
      right[1] !== left[1]
        ? right[1] - left[1]
        : left[0].localeCompare(right[0], "ko-KR"),
    )
    .slice(0, 3)
    .map(([category, weight]) => ({
      category,
      label: categoryLabels[category],
      weight: Math.round(weight * 100) / 100,
    }));

  // 4) 이름/브리프 — styleProfile 이름과 상위 카테고리로 구성
  const styleName = plan.styleProfile?.name ?? "";
  const topLabels = topCategories.map((entry) => entry.label).slice(0, 2);
  const name = clampText(bestTemplate.nameSeed, caps.name);
  const roleTitle = clampText(bestTemplate.roleTitle, caps.roleTitle);
  const channelName = clampText(`${roleTitle} 채널`, caps.channelName);
  const brief = clampText(
    [
      styleName ? `${styleName} 기반.` : "",
      topLabels.length ? `${topLabels.join("·")} 자료를 중심으로 일합니다.` : "",
      bestTemplate.focusLine,
    ]
      .filter(Boolean)
      .join(" "),
    caps.brief,
  );

  // 5) 지침 — styleProfile 산출 지침(≤4) + 템플릿 포커스 + 패턴 요약(≤2) + 승인 경계(고정)
  const styleInstructions = (plan.styleProfile?.outputGuidance ?? [])
    .slice(0, 4)
    .map((line) => clampText(line, caps.instruction))
    .filter(Boolean);
  const patternInstructions = (options.workPatternSummaries ?? [])
    .slice(0, 2)
    .map((line) => clampText(`이전 방식 참고: ${line}`, caps.instruction))
    .filter(Boolean);
  const instructions = [
    ...styleInstructions,
    clampText(bestTemplate.focusLine, caps.instruction),
    ...patternInstructions,
    "외부 발송, 일정 등록, 파일 변경은 사용자 승인 전에는 실행하지 않습니다.",
  ]
    .filter(Boolean)
    .slice(0, caps.maxInstructions);

  // 6) 자동화 추천 — 기존 매퍼 결과 그대로(전부 기본 꺼짐·승인 필수)
  const automationRecommendations = createDocumentAutomationRecommendations(plan);

  const sourceFileLabels = plan.filePlans
    .slice(0, 5)
    .map((filePlan) => clampText(filePlan.fileName, 80))
    .filter(Boolean);

  const id = `teammate-draft-${plan.sessionId}`;
  const teamLabel = clampText(bestTemplate.teamLabel, caps.teamLabel);
  const agentBlueprint = createAgentBlueprintFromDocumentLearning({
    teammateDraftId: id,
    createdAt,
    identity: {
      name,
      teamLabel,
      roleTitle,
      brief,
      instructions,
    },
    learningPlan: plan,
    recommendations: automationRecommendations,
  });

  return {
    id,
    createdAt,
    suggestedTemplateId: bestTemplate.templateId,
    name,
    teamLabel,
    roleTitle,
    channelName,
    brief,
    instructions,
    automationRecommendations,
    agentBlueprint,
    evidence: {
      styleProfileId: plan.styleProfile?.id ?? "",
      styleProfileName: clampText(styleName, 80),
      reportCadence: plan.styleProfile?.reportCadence ?? "mixed",
      namingPattern: clampText(plan.styleProfile?.namingPattern ?? "", 120),
      topCategories,
      sourceFileLabels,
    },
    approvalRequired: true,
    startsEnabled: false,
    externalMutation: false,
  };
}
