import type { ModyDocumentLearningFilePlan, ModyDocumentLearningPlan } from "./local-document-learning.js";
import type {
  ModyDocumentAutomationOutputKind,
  ModyDocumentAutomationRecommendation,
} from "./document-automation-recommendation.js";

export type ModyLearnedOutputDraftInput = {
  learningPlan: ModyDocumentLearningPlan;
  recommendation: ModyDocumentAutomationRecommendation;
  userInstruction?: string;
  createdAt?: string;
};

export type ModyLearnedOutputDraft = {
  id: string;
  createdAt: string;
  learningSessionId: string;
  recommendationId: string;
  workPackId: ModyDocumentAutomationRecommendation["workPackId"];
  outputKind: ModyDocumentAutomationOutputKind;
  title: string;
  markdown: string;
  sourceFileIds: string[];
  sourceLabels: string[];
  sourceBinding: NonNullable<ModyDocumentAutomationRecommendation["sourceBinding"]>;
  reviewStatus: "needs_review";
  executionAuthority: "none";
  sourceVersionStatus: "unverified";
  learnedStyleProfileId: string;
  learnedStyleGuidance: string[];
  handoffLabel: string;
  approvalGateLabel: string;
  nextUserActions: string[];
  approvalRequiredBeforeExternalMutation: true;
  externalMutation: false;
  rawFileContentStoredInAppDatabase: false;
};

export function createLearnedOutputDraft(input: ModyLearnedOutputDraftInput): ModyLearnedOutputDraft {
  const { learningPlan, recommendation } = input;
  const createdAt = input.createdAt ?? new Date().toISOString();
  // A recommendation may have become stale. Never silently turn a missing or
  // ambiguous source into a name-only citation in a review draft.
  if (!Array.isArray(recommendation.sourceFileIds) || recommendation.sourceFileIds.length === 0
    || new Set(recommendation.sourceFileIds).size !== recommendation.sourceFileIds.length) {
    throw new Error("자료 근거를 확인할 수 없습니다. 선택한 자료를 다시 검토해 주세요.");
  }
  const sourceFiles = recommendation.sourceFileIds.map((id) => {
    const matches = learningPlan.filePlans.filter((file) => file.id === id);
    if (matches.length !== 1) {
      throw new Error("자료 근거가 변경되었거나 중복되었습니다. 선택한 자료를 다시 검토해 주세요.");
    }
    return matches[0]!;
  });
  const binding = recommendation.sourceBinding;
  if (!binding || !binding.sessionId || !binding.workspaceId
    || binding.sessionId !== learningPlan.sessionId || binding.workspaceId !== learningPlan.workspaceId
    || binding.localStorageRoot !== learningPlan.localStorageRoot || binding.createdAt !== learningPlan.createdAt
    || binding.localIndexRoot !== learningPlan.localIndexRoot
    || binding.styleProfileSnapshot !== JSON.stringify(learningPlan.styleProfile)
    || !Array.isArray(binding.sources) || binding.sources.length !== sourceFiles.length
    || binding.sources.some((source, index) => {
      const file = sourceFiles[index];
      return !file || source.id !== file.id || !source.absolutePath || source.absolutePath !== file.absolutePath
        || source.contentSha256 !== file.contentSha256
        || (source.contentSha256 !== undefined && !/^[a-f0-9]{64}$/.test(source.contentSha256))
        || source.fileName !== file.fileName || source.category !== file.category || source.periodLabel !== file.periodLabel;
    })) {
    throw new Error("자료의 학습 범위와 원본 버전을 확인할 수 없습니다. 자료를 다시 선택해 주세요.");
  }
  const sourceLabels = sourceFiles.map((file) => file.fileName);
  const title = `${recommendation.outputPlan.label} - ${recommendation.title}`;
  const userInstruction = input.userInstruction?.trim();
  const markdown = buildMarkdown({
    learningPlan,
    recommendation,
    sourceFiles,
    sourceLabels,
    ...(userInstruction ? { userInstruction } : {}),
    createdAt,
  });

  return {
    id: `learned_draft_${recommendation.workPackId}_${compactDate(createdAt)}`,
    createdAt,
    learningSessionId: learningPlan.sessionId,
    recommendationId: recommendation.id,
    workPackId: recommendation.workPackId,
    outputKind: recommendation.outputPlan.kind,
    title,
    markdown,
    sourceFileIds: sourceFiles.map((file) => file.id),
    sourceLabels,
    sourceBinding: { ...binding, sources: binding.sources.map((source) => ({ ...source })) },
    reviewStatus: "needs_review",
    executionAuthority: "none",
    sourceVersionStatus: "unverified",
    learnedStyleProfileId: recommendation.learnedStyleProfileId,
    learnedStyleGuidance: [...recommendation.learnedStyleGuidance],
    handoffLabel: recommendation.outputPlan.handoffLabel,
    approvalGateLabel: recommendation.outputPlan.approvalGateLabel,
    nextUserActions: [
      recommendation.outputPlan.nextUserAction,
      "초안 문구, 수신자, 일정, 표 값은 사용자가 확인하기 전까지 외부로 보내지 않습니다.",
      `${recommendation.outputPlan.handoffLabel}에서 수정 후 ${recommendation.outputPlan.approvalGateLabel}을 완료합니다.`,
    ],
    approvalRequiredBeforeExternalMutation: true,
    externalMutation: false,
    rawFileContentStoredInAppDatabase: false,
  };
}

function buildMarkdown(input: {
  learningPlan: ModyDocumentLearningPlan;
  recommendation: ModyDocumentAutomationRecommendation;
  sourceFiles: readonly ModyDocumentLearningFilePlan[];
  sourceLabels: readonly string[];
  userInstruction?: string;
  createdAt: string;
}): string {
  const { learningPlan, recommendation, sourceFiles, sourceLabels, userInstruction, createdAt } = input;
  const periodLabels = Array.from(new Set(sourceFiles.map((file) => file.periodLabel))).filter(Boolean);
  const sourceSummary = sourceLabels.length > 0 ? sourceLabels.join(", ") : "선택된 자료 메타데이터";
  const instructionLine = userInstruction ? `\n- 사용자 요청: ${userInstruction}` : "";

  return [
    `# ${recommendation.outputPlan.label}`,
    "",
    "## 초안 목적",
    `- 업무팩: ${recommendation.title}`,
    `- 만들 결과: ${recommendation.outputPlan.draftTarget}`,
    `- 작성 시각: ${createdAt}`,
    instructionLine.trim(),
    "",
    "## 학습 형식 기준",
    `- 스타일 프로필: ${learningPlan.styleProfile.name}`,
    `- 프로필 ID: ${recommendation.learnedStyleProfileId}`,
    `- 파일명 규칙: ${learningPlan.styleProfile.namingPattern}`,
    ...recommendation.learnedStyleGuidance.map((line) => `- ${line}`),
    "",
    "## 자료 근거",
    `- 근거 파일: ${sourceSummary}`,
    "- 원본 버전은 확인되지 않았습니다. 원본과 초안을 검토해 주세요. 이 초안에는 실행 권한이 없습니다.",
    `- 기간: ${periodLabels.length > 0 ? periodLabels.join(", ") : "미분류"}`,
    `- 로컬 인덱스: ${learningPlan.localIndexRoot}`,
    "- 원본 본문은 앱 DB에 저장하지 않고 로컬 인덱스/메타데이터만 참조합니다.",
    "",
    "## 초안 본문",
    ...draftBodyLines(recommendation.outputPlan.kind, sourceFiles, sourceLabels),
    "",
    "## 승인 경계",
    `- 외부 실행 잠금: ${recommendation.externalMutation ? "해제됨" : "잠김"}`,
    `- 승인 게이트: ${recommendation.outputPlan.approvalGateLabel}`,
    "- 사용자가 최종 승인하기 전에는 메일 발송, 캘린더 등록, 파일 공유, 발주 요청을 실행하지 않습니다.",
    "",
    "## 다음 행동",
    `- ${recommendation.outputPlan.nextUserAction}`,
    `- ${recommendation.outputPlan.handoffLabel}에서 초안을 열어 수정/승인합니다.`,
  ].filter((line) => line.length > 0).join("\n");
}

function draftBodyLines(
  kind: ModyDocumentAutomationOutputKind,
  sourceFiles: readonly ModyDocumentLearningFilePlan[],
  sourceLabels: readonly string[],
): string[] {
  const primarySource = sourceLabels[0] ?? "선택 자료";
  const categoryLabels = Array.from(new Set(sourceFiles.map((file) => categoryLabel(file.category))));
  const periodLabel = sourceFiles.find((file) => file.periodLabel !== "미분류")?.periodLabel ?? "최근";

  if (kind === "mail_reply_draft") {
    return [
      `제목: ${periodLabel} 문의 답변드립니다`,
      "",
      "안녕하세요.",
      `${primarySource} 기준으로 확인한 내용은 아래와 같습니다.`,
      "",
      "1. 문의 요지: 고객 요청을 상담/운영 기준에 맞춰 정리합니다.",
      "2. 답변 후보: 가격, 일정, 준비물, 다음 절차를 짧게 안내합니다.",
      "3. 확인 필요: 실제 수신자, 금액, 예약 가능 시간은 발송 전 사용자가 확인합니다.",
      "",
      "감사합니다.",
      "ModyCrew 업무 비서 초안",
    ];
  }

  if (kind === "calendar_candidate") {
    return [
      `일정 후보: ${periodLabel} 운영 규칙 기준`,
      "- 후보 1: 업무 가능 시간대 중 가장 빠른 시간",
      "- 후보 2: 담당자 확인이 필요한 예비 시간",
      "- 안내 문장: 가능하신 시간을 선택해 주시면 최종 확정 후 캘린더에 등록하겠습니다.",
      "- 확인 필요: 참석자, 장소/링크, 반복 여부, 알림 시간",
    ];
  }

  if (kind === "table_review") {
    const hasTaxOrContractEvidence = sourceFiles.some((file) => file.category === "tax_material" || file.category === "contract");
    if (hasTaxOrContractEvidence) {
      return [
        `정리 기준: ${categoryLabels.join(", ") || "세무·계약 자료"}`,
        "",
        "| 구분 | 자료 근거 | 정리 후보 | 사용자 확인 |",
        "| --- | --- | --- | --- |",
        `| 월별 증빙 | ${primarySource} | 세금계산서·현금영수증·카드/계좌 증빙 묶음 | 세무사 전달 전 승인 |`,
        "| 거래처/계약 | 계약서·견적서 파일명과 기간 | 금액, 기간, 서명/날인, 자동연장 문구 확인 | 제출·서명 전 승인 |",
        "| 누락 점검 | 같은 기간 자료 목록 | 누락 가능 증빙, 중복 파일, 확인 필요 거래처 표시 | 담당자 확인 |",
      ];
    }
    return [
      `표 점검 기준: ${categoryLabels.join(", ") || "기존 표 양식"}`,
      "",
      "| 항목 | 현재 근거 | 점검 후보 | 사용자 확인 |",
      "| --- | --- | --- | --- |",
      `| ${primarySource} | 로컬 학습 자료 | 부족/누락 가능성 검토 | 발주/수정 전 승인 |`,
      "| 추가 항목 | 같은 기간 표 형식 | 값 비교 필요 | 담당자 확인 |",
    ];
  }

  return [
    `보고서 제목: ${periodLabel} 업무 정리 초안`,
    "",
    "### 1. 요약",
    `${primarySource} 외 ${Math.max(0, sourceLabels.length - 1)}개 자료를 기준으로 이번 기간의 핵심 업무를 정리합니다.`,
    "",
    "### 2. 주요 내용",
    `- 자료 유형: ${categoryLabels.join(", ") || "일반 문서"}`,
    "- 완료된 일: 파일명과 기간 기준으로 확인된 업무를 요약합니다.",
    "- 다음 해야 할 일: 누락 점검, 담당자 확인, 승인 대기 항목을 분리합니다.",
    "",
    "### 3. 확인 필요",
    "- 숫자, 금액, 외부 공유 대상은 사용자가 최종 확인합니다.",
    "- 공유 또는 발송은 승인 게이트 통과 후에만 진행합니다.",
  ];
}

function categoryLabel(category: ModyDocumentLearningFilePlan["category"]): string {
  const labels: Record<ModyDocumentLearningFilePlan["category"], string> = {
    monthly_report: "월별 보고서",
    settlement_sheet: "정산표",
    customer_inquiry: "상담/문의",
    schedule_rule: "운영 일정 규칙",
    tax_material: "세무 자료",
    contract: "계약/견적",
    form_template: "양식/서식",
    general_document: "일반 문서",
  };
  return labels[category];
}

function compactDate(value: string): string {
  return value.replace(/[^0-9a-z]/giu, "").slice(0, 14) || "now";
}
