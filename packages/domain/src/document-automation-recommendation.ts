import type {
  ModyDocumentLearningCategory,
  ModyDocumentLearningFilePlan,
  ModyDocumentLearningPlan,
} from "./local-document-learning.js";
import {
  findModyWorkPack,
  type ModyWorkPackFeatureId,
  type ModyWorkPackId,
} from "./work-pack.js";

export type ModyDocumentAutomationRecommendation = {
  id: string;
  workPackId: ModyWorkPackId;
  title: string;
  confidence: number;
  reason: string;
  sourceFileIds: string[];
  sourceLabels: string[];
  sourceBinding?: {
    sessionId: string;
    workspaceId: string;
    localStorageRoot: string;
    createdAt: string;
    localIndexRoot: string;
    styleProfileSnapshot: string;
    sources: { id: string; absolutePath: string; contentSha256?: string; fileName: string; category: string; periodLabel: string }[];
  };
  suggestedRuleLabel: string;
  requiredFeatureIds: ModyWorkPackFeatureId[];
  learnedStyleProfileId: string;
  learnedStyleGuidance: string[];
  outputPlan: ModyDocumentAutomationOutputPlan;
  approvalRequired: true;
  startsEnabled: false;
  externalMutation: false;
};

export type ModyDocumentAutomationOutputKind = "report_draft" | "mail_reply_draft" | "calendar_candidate" | "table_review";

export type ModyDocumentAutomationOutputPlan = {
  kind: ModyDocumentAutomationOutputKind;
  label: string;
  formatBasis: "learned_document_style";
  draftTarget: string;
  handoffLabel: string;
  approvalGateLabel: string;
  nextUserAction: string;
};

type RecommendationRule = {
  workPackId: ModyWorkPackId;
  categories: readonly ModyDocumentLearningCategory[];
  keywords: readonly string[];
  suggestedRuleLabel: string;
  reason: string;
  outputPlan: ModyDocumentAutomationOutputPlan;
};

const recommendationRules: readonly RecommendationRule[] = [
  {
    workPackId: "inquiry_response",
    categories: ["customer_inquiry"],
    keywords: ["문의", "상담", "예약", "고객", "faq", "가격", "수강료"],
    suggestedRuleLabel: "문의 자료 기준으로 답장 초안 만들기",
    reason: "상담/문의 자료가 있어 고객 질문을 회사 기준 답변 후보로 바꿀 수 있습니다.",
    outputPlan: {
      kind: "mail_reply_draft",
      label: "메일/메신저 답장 초안",
      formatBasis: "learned_document_style",
      draftTarget: "FAQ·가격표·상담문의 말투를 반영한 답장 후보",
      handoffLabel: "메일 점검",
      approvalGateLabel: "고객 답장 발송 전 승인",
      nextUserAction: "초안을 확인하고 수정 또는 최종 발송 승인을 선택합니다.",
    },
  },
  {
    workPackId: "schedule_coordination",
    categories: ["schedule_rule"],
    keywords: ["일정", "운영 규칙", "휴무", "근무", "상담 가능", "calendar", "schedule"],
    suggestedRuleLabel: "운영 규칙 기준으로 일정 후보 만들기",
    reason: "운영 규칙이나 상담 가능 시간이 있어 미팅/예약 후보를 자동으로 검토할 수 있습니다.",
    outputPlan: {
      kind: "calendar_candidate",
      label: "일정 후보와 안내 문장",
      formatBasis: "learned_document_style",
      draftTarget: "운영 규칙과 기존 안내 문구를 반영한 일정 후보",
      handoffLabel: "Calendar FinalAction",
      approvalGateLabel: "캘린더 등록 전 승인",
      nextUserAction: "가능 시간을 고르고 등록/답장 여부를 최종 승인합니다.",
    },
  },
  {
    workPackId: "report_cleanup",
    categories: ["monthly_report", "settlement_sheet", "form_template", "general_document"],
    keywords: ["보고서", "정산", "거래처", "월별", "인수인계", "양식", "서식", "report"],
    suggestedRuleLabel: "보고서·정산표 기준으로 누락 확인하기",
    reason: "보고서/정산표/양식 자료가 있어 다음 담당자용 요약과 누락 확인 목록을 만들 수 있습니다.",
    outputPlan: {
      kind: "report_draft",
      label: "보고서/인수인계 초안",
      formatBasis: "learned_document_style",
      draftTarget: "월별 보고서·정산표 양식을 반영한 누락 점검 보고서",
      handoffLabel: "보고서 만들기",
      approvalGateLabel: "보고서 공유 전 승인",
      nextUserAction: "초안 형식과 누락 항목을 확인한 뒤 문서화 또는 공유를 승인합니다.",
    },
  },
  {
    workPackId: "inventory_reorder",
    categories: [],
    keywords: ["재고", "발주", "공급처", "안전재고", "입고", "출고", "inventory"],
    suggestedRuleLabel: "재고 기준표를 보고 발주 후보 만들기",
    reason: "재고나 발주 기준으로 보이는 자료가 있어 부족 가능성 점검 후보를 만들 수 있습니다.",
    outputPlan: {
      kind: "table_review",
      label: "표 기반 점검 후보",
      formatBasis: "learned_document_style",
      draftTarget: "기존 발주 기준표 형식을 반영한 부족 가능성 점검표",
      handoffLabel: "운영 점검",
      approvalGateLabel: "발주 요청 전 승인",
      nextUserAction: "부족 후보를 검토하고 발주 요청 여부를 최종 승인합니다.",
    },
  },
  {
    workPackId: "tax_contract_archive",
    categories: ["tax_material", "contract"],
    keywords: [
      "세금계산서",
      "전자세금",
      "현금영수증",
      "홈택스",
      "부가세",
      "원천세",
      "증빙",
      "계약서",
      "날인",
      "서명",
      "tax",
      "invoice",
      "receipt",
      "contract",
    ],
    suggestedRuleLabel: "세금·계약 자료 들어오면 월별 정리표 만들기",
    reason: "세금계산서, 현금영수증, 계약서로 보이는 자료가 있어 제출 전 누락과 위험 문구를 한 번에 점검할 수 있습니다.",
    outputPlan: {
      kind: "table_review",
      label: "세금·계약 정리표",
      formatBasis: "learned_document_style",
      draftTarget: "월별 증빙 묶음, 거래처별 누락 확인표, 계약 위험 체크리스트",
      handoffLabel: "세금·계약 자료 정리",
      approvalGateLabel: "세무사 전달·계약 제출 전 승인",
      nextUserAction: "누락 증빙과 계약 위험 문구를 확인한 뒤 전달, 공유, 제출 여부를 최종 승인합니다.",
    },
  },
];

export function createDocumentAutomationRecommendations(
  learningPlan: ModyDocumentLearningPlan,
): ModyDocumentAutomationRecommendation[] {
  return recommendationRules
    .map((rule) => createRecommendationForRule(learningPlan, rule))
    .filter((item): item is ModyDocumentAutomationRecommendation => Boolean(item))
    .sort((left, right) => right.confidence - left.confidence || left.title.localeCompare(right.title, "ko-KR"))
    .slice(0, 4);
}

function createRecommendationForRule(
  learningPlan: ModyDocumentLearningPlan,
  rule: RecommendationRule,
): ModyDocumentAutomationRecommendation | null {
  const matches = learningPlan.filePlans.filter((file) => matchesRule(file, rule));
  if (matches.length === 0) return null;

  const pack = findModyWorkPack(rule.workPackId);
  if (!pack) return null;

  const averageConfidence =
    matches.reduce((total, file) => total + file.confidence, 0) / Math.max(1, matches.length);
  const categoryBoost = matches.some((file) => rule.categories.includes(file.category)) ? 0.08 : 0;
  const evidenceBoost = Math.min(0.12, matches.length * 0.03);
  const confidence = Math.min(0.98, Number((averageConfidence + categoryBoost + evidenceBoost).toFixed(2)));

  return {
    id: `doc_auto_${rule.workPackId}`,
    workPackId: rule.workPackId,
    title: pack.title,
    confidence,
    reason: rule.reason,
    sourceFileIds: matches.map((file) => file.id),
    sourceLabels: matches.slice(0, 3).map((file) => file.fileName),
    ...(learningPlan.sessionId && learningPlan.workspaceId
      && learningPlan.localStorageRoot && learningPlan.createdAt
      && matches.every((file) => file.absolutePath && (!file.contentSha256 || /^[a-f0-9]{64}$/.test(file.contentSha256)))
      ? { sourceBinding: {
          sessionId: learningPlan.sessionId,
          workspaceId: learningPlan.workspaceId,
          localStorageRoot: learningPlan.localStorageRoot,
          createdAt: learningPlan.createdAt,
          localIndexRoot: learningPlan.localIndexRoot,
          styleProfileSnapshot: JSON.stringify(learningPlan.styleProfile),
          sources: matches.map((file) => ({ id: file.id, absolutePath: file.absolutePath, ...(file.contentSha256 ? { contentSha256: file.contentSha256 } : {}), fileName: file.fileName, category: file.category, periodLabel: file.periodLabel })),
        } }
      : {}),
    suggestedRuleLabel: rule.suggestedRuleLabel,
    requiredFeatureIds: [...pack.requiredFeatureIds],
    learnedStyleProfileId: learningPlan.styleProfile.id,
    learnedStyleGuidance: learningPlan.styleProfile.outputGuidance.slice(0, 4),
    outputPlan: { ...rule.outputPlan },
    approvalRequired: true,
    startsEnabled: false,
    externalMutation: false,
  };
}

function matchesRule(file: ModyDocumentLearningFilePlan, rule: RecommendationRule): boolean {
  if (rule.categories.includes(file.category)) return true;
  const haystack = [file.fileName, file.kind, file.category, file.periodLabel, ...file.tags]
    .join(" ")
    .toLocaleLowerCase("ko-KR");
  return rule.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase("ko-KR")));
}
