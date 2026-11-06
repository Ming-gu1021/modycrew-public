import type { ModyDocumentLearningFilePlan, ModyDocumentLearningPlan } from "./local-document-learning.js";
import { modyTaxBeginnerGuide } from "./tax-management-basics.js";

export type ModyTaxContractArchiveDocumentKind =
  | "tax_invoice"
  | "cash_receipt"
  | "card_or_sales_evidence"
  | "contract_document"
  | "accounting_evidence"
  | "review_needed";

export type ModyTaxContractArchiveReviewStatus = "ready_to_review" | "needs_user_check";

export type ModyTaxContractArchiveItem = {
  id: string;
  fileId: string;
  fileName: string;
  periodLabel: string;
  documentKind: ModyTaxContractArchiveDocumentKind;
  documentKindLabel: string;
  counterpartyLabel: string;
  sourceLabel: string;
  targetFolder: string;
  reviewStatus: ModyTaxContractArchiveReviewStatus;
  riskFlags: string[];
  nextAction: string;
  approvalRequiredBeforeExternalShare: true;
  externalMutation: false;
};

export type ModyTaxContractArchiveMonthlyGroup = {
  id: string;
  periodLabel: string;
  targetFolder: string;
  itemIds: string[];
  taxEvidenceCount: number;
  contractCount: number;
  needsReviewCount: number;
  handoffChecklist: string[];
};

export type ModyTaxContractArchiveView = {
  id: string;
  title: string;
  createdAt: string;
  workPackId: "tax_contract_archive";
  sourceLearningSessionId: string;
  summary: {
    totalItems: number;
    taxEvidenceCount: number;
    cashReceiptCount: number;
    contractCount: number;
    needsReviewCount: number;
    periodCount: number;
    counterpartyCount: number;
  };
  userVisibleColumns: string[];
  items: ModyTaxContractArchiveItem[];
  monthlyGroups: ModyTaxContractArchiveMonthlyGroup[];
  reviewChecklist: string[];
  beginnerGuide: {
    title: string;
    evidenceBuckets: string[];
    monthlyRoutine: string[];
    approvalBoundary: string;
  };
  safetyBoundary: string;
  externalMutation: false;
  rawFileContentStoredInAppDatabase: false;
};

export function createTaxContractArchiveView(learningPlan: ModyDocumentLearningPlan): ModyTaxContractArchiveView {
  const items = learningPlan.filePlans
    .filter(isTaxContractArchiveCandidate)
    .map((file) => createArchiveItem(file));
  const monthlyGroups = createMonthlyGroups(items);
  const counterpartyCount = new Set(items.map((item) => item.counterpartyLabel).filter((label) => label !== "거래처 확인 필요")).size;

  return {
    id: `tax_contract_archive_${compactDate(learningPlan.createdAt)}_${learningPlan.sessionId}`,
    title: "세금·계약 자료 정리함",
    createdAt: learningPlan.createdAt,
    workPackId: "tax_contract_archive",
    sourceLearningSessionId: learningPlan.sessionId,
    summary: {
      totalItems: items.length,
      taxEvidenceCount: items.filter((item) => isTaxEvidenceKind(item.documentKind)).length,
      cashReceiptCount: items.filter((item) => item.documentKind === "cash_receipt").length,
      contractCount: items.filter((item) => item.documentKind === "contract_document").length,
      needsReviewCount: items.filter((item) => item.reviewStatus === "needs_user_check").length,
      periodCount: monthlyGroups.length,
      counterpartyCount,
    },
    userVisibleColumns: ["월", "자료 종류", "거래처", "확인 상태", "다음 행동"],
    items,
    monthlyGroups,
    reviewChecklist: [
      "세금계산서, 현금영수증, 카드/계좌 증빙이 같은 월에 묶였는지 확인",
      "거래처명, 금액, 공급일자, 사업자번호는 원본에서 사용자 확인",
      "계약서는 금액, 기간, 서명/날인, 자동연장, 위약 문구를 제출 전 확인",
      "세무사 전달, 외부 공유, 계약 제출, 전자서명은 오피스 승인함 전까지 실행하지 않음",
    ],
    beginnerGuide: {
      title: modyTaxBeginnerGuide.title,
      evidenceBuckets: unique(modyTaxBeginnerGuide.evidenceGuides.map((guide) => guide.appBucket)),
      monthlyRoutine: modyTaxBeginnerGuide.monthlyRoutine,
      approvalBoundary: modyTaxBeginnerGuide.approvalBoundary,
    },
    safetyBoundary:
      "파일명과 로컬 학습 메타데이터로 정리함 보기만 만들며, 원본 이동·수정·삭제·외부 공유·세무 신고·계약 제출은 실행하지 않습니다.",
    externalMutation: false,
    rawFileContentStoredInAppDatabase: false,
  };
}

function createArchiveItem(file: ModyDocumentLearningFilePlan): ModyTaxContractArchiveItem {
  const documentKind = classifyArchiveDocumentKind(file);
  const riskFlags = createRiskFlags(file, documentKind);
  const needsReview = file.status !== "ready_to_index" || riskFlags.length > 0 || documentKind === "review_needed";

  return {
    id: `tax_contract_item_${file.id}`,
    fileId: file.id,
    fileName: file.fileName,
    periodLabel: file.periodLabel,
    documentKind,
    documentKindLabel: documentKindLabel(documentKind),
    counterpartyLabel: extractCounterpartyLabel(file),
    sourceLabel: `${file.kind.toUpperCase()} · ${categoryLabel(file.category)}`,
    targetFolder: file.targetFolder,
    reviewStatus: needsReview ? "needs_user_check" : "ready_to_review",
    riskFlags,
    nextAction: nextActionFor(documentKind, needsReview),
    approvalRequiredBeforeExternalShare: true,
    externalMutation: false,
  };
}

function createMonthlyGroups(items: readonly ModyTaxContractArchiveItem[]): ModyTaxContractArchiveMonthlyGroup[] {
  const grouped = new Map<string, ModyTaxContractArchiveItem[]>();
  for (const item of items) {
    const key = item.periodLabel || "미분류";
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return [...grouped.entries()]
    .map(([periodLabel, groupItems]) => ({
      id: `tax_contract_month_${periodLabel.replace(/[^0-9a-z가-힣_-]/giu, "_") || "unknown"}`,
      periodLabel,
      targetFolder: groupItems[0]?.targetFolder ?? "",
      itemIds: groupItems.map((item) => item.id),
      taxEvidenceCount: groupItems.filter((item) => isTaxEvidenceKind(item.documentKind)).length,
      contractCount: groupItems.filter((item) => item.documentKind === "contract_document").length,
      needsReviewCount: groupItems.filter((item) => item.reviewStatus === "needs_user_check").length,
      handoffChecklist: [
        `${periodLabel} 증빙 ${groupItems.filter((item) => isTaxEvidenceKind(item.documentKind)).length}건`,
        `${periodLabel} 계약 ${groupItems.filter((item) => item.documentKind === "contract_document").length}건`,
        "세무사 전달 전 누락/중복/금액 확인",
      ],
    }))
    .sort((left, right) => right.periodLabel.localeCompare(left.periodLabel, "ko-KR"));
}

function isTaxContractArchiveCandidate(file: ModyDocumentLearningFilePlan): boolean {
  if (file.category === "tax_material" || file.category === "contract") return true;
  return /(세금계산서|전자세금|현금영수증|홈택스|부가세|원천세|증빙|계약서|날인|서명|tax|invoice|receipt|contract)/iu.test(
    `${file.fileName} ${file.absolutePath}`,
  );
}

function classifyArchiveDocumentKind(file: ModyDocumentLearningFilePlan): ModyTaxContractArchiveDocumentKind {
  const text = `${file.fileName} ${file.absolutePath} ${file.tags.join(" ")}`.toLocaleLowerCase("ko-KR");
  if (/현금영수증|cash\s*receipt|receipt/u.test(text)) return "cash_receipt";
  if (/세금계산서|전자세금|invoice/u.test(text)) return "tax_invoice";
  if (/카드|매출|정산|입금|sales|settlement/u.test(text)) return "card_or_sales_evidence";
  if (/계약|계약서|날인|서명|contract|signature/u.test(text)) return "contract_document";
  if (/세무|홈택스|부가세|원천세|증빙|tax/u.test(text)) return "accounting_evidence";
  return "review_needed";
}

function createRiskFlags(
  file: ModyDocumentLearningFilePlan,
  documentKind: ModyTaxContractArchiveDocumentKind,
): string[] {
  const flags = new Set<string>();
  const text = `${file.fileName} ${file.absolutePath}`.toLocaleLowerCase("ko-KR");
  if (file.status !== "ready_to_index") flags.add("읽기 전 검토 필요");
  if (file.periodLabel === "미분류") flags.add("월/귀속기간 확인");
  if (documentKind === "contract_document") flags.add("계약 조건 확인");
  if (/서명|날인|signature|signed/u.test(text)) flags.add("서명/날인 상태 확인");
  if (/환불|위약|자동연장|해지|penalty|renewal/u.test(text)) flags.add("위약/자동연장 문구 확인");
  if (/사업자|vat|부가세|원천세/u.test(text)) flags.add("사업자/세무 항목 확인");
  return [...flags];
}

function nextActionFor(documentKind: ModyTaxContractArchiveDocumentKind, needsReview: boolean): string {
  if (documentKind === "contract_document") return "계약 조건 확인 후 제출/서명 승인";
  if (needsReview) return "누락 정보 확인 후 월별 묶음에 반영";
  if (documentKind === "cash_receipt") return "현금영수증 금액/발행일 확인";
  if (documentKind === "tax_invoice") return "세금계산서 발행일/공급가액 확인";
  return "세무사 전달 전 증빙 포함 여부 확인";
}

function extractCounterpartyLabel(file: ModyDocumentLearningFilePlan): string {
  const baseName = file.fileName.replace(/\.[^.]+$/u, "");
  const candidates = baseName
    .split(/[\s_\-()[\]{}·]+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\d{4}([-.]?\d{2})?$/u.test(part))
    .filter((part) => !/^(세금계산서|전자세금|현금영수증|정리|증빙목록|홈택스|부가세|원천세|계약서|계약|견적서|월별)$/u.test(part));
  return candidates.find((part) => /거래처|주식회사|회사|상사|파트너|[A-Z]{1,4}/u.test(part)) ?? candidates[0] ?? "거래처 확인 필요";
}

function isTaxEvidenceKind(kind: ModyTaxContractArchiveDocumentKind): boolean {
  return kind === "tax_invoice" || kind === "cash_receipt" || kind === "card_or_sales_evidence" || kind === "accounting_evidence";
}

function documentKindLabel(kind: ModyTaxContractArchiveDocumentKind): string {
  const labels: Record<ModyTaxContractArchiveDocumentKind, string> = {
    tax_invoice: "세금계산서",
    cash_receipt: "현금영수증",
    card_or_sales_evidence: "카드/매출 증빙",
    contract_document: "계약서",
    accounting_evidence: "세무 증빙",
    review_needed: "확인 필요 자료",
  };
  return labels[kind];
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

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
