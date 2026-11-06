export type ModyTaxBeginnerEvidenceId =
  | "tax_invoice"
  | "invoice"
  | "cash_receipt"
  | "card_sales_slip"
  | "transaction_statement"
  | "contract"
  | "bank_transfer"
  | "platform_settlement"
  | "payroll_withholding";

export type ModyTaxBeginnerFlowId =
  | "offline_retail"
  | "online_store"
  | "wholesale_b2b"
  | "service_contract"
  | "electronic_payment"
  | "payroll_or_freelancer";

export type ModyTaxBeginnerEvidenceGuide = {
  id: ModyTaxBeginnerEvidenceId;
  label: string;
  plainMeaning: string;
  collectWhen: string;
  appBucket: "매출 증빙" | "매입/비용 증빙" | "계약/거래 근거" | "정산/입금 근거" | "인건비/원천세";
  beginnerCheck: string[];
  automationHint: string;
  caution: string;
};

export type ModyTaxBeginnerFlowGuide = {
  id: ModyTaxBeginnerFlowId;
  label: string;
  plainMeaning: string;
  likelyEvidenceIds: ModyTaxBeginnerEvidenceId[];
  firstAutomation: string;
};

export type ModyTaxBeginnerGuide = {
  title: string;
  purpose: string;
  beginnerRule: string;
  evidenceGuides: ModyTaxBeginnerEvidenceGuide[];
  flowGuides: ModyTaxBeginnerFlowGuide[];
  monthlyRoutine: string[];
  approvalBoundary: string;
  sourceNotes: string[];
};

export const modyTaxBeginnerGuide: ModyTaxBeginnerGuide = {
  title: "처음 쓰는 사업자 세금관리 지도",
  purpose: "세무 지식이 없어도 자료를 매출, 매입/비용, 계약, 정산, 인건비 흐름으로 나눠 모으게 돕습니다.",
  beginnerRule:
    "앱은 신고를 대신하지 않고 자료를 정리합니다. 금액, 공제 여부, 세무사 전달, 신고, 계약 제출은 사용자가 확인하고 승인해야 합니다.",
  evidenceGuides: [
    {
      id: "tax_invoice",
      label: "세금계산서",
      plainMeaning: "부가세가 있는 사업자 간 거래의 핵심 증빙입니다.",
      collectWhen: "사업자로 물건이나 서비스를 팔거나 살 때",
      appBucket: "매출 증빙",
      beginnerCheck: ["공급자/공급받는 자", "작성일자", "공급가액", "세액", "품목"],
      automationHint: "전자세금계산서 파일과 홈택스 조회 내역을 월별로 묶습니다.",
      caution: "발행, 수정발행, 신고 반영은 승인 없이 자동 실행하지 않습니다.",
    },
    {
      id: "invoice",
      label: "계산서",
      plainMeaning: "부가세가 붙지 않는 면세 거래 등에서 쓰는 증빙입니다.",
      collectWhen: "면세 품목, 일부 용역, 면세사업자 거래가 있을 때",
      appBucket: "매출 증빙",
      beginnerCheck: ["면세/과세 구분", "거래처", "금액", "품목", "발행일"],
      automationHint: "세금계산서와 구분해서 면세/과세 확인 대상으로 표시합니다.",
      caution: "세금계산서와 이름이 비슷해도 부가세 처리 방식이 다를 수 있습니다.",
    },
    {
      id: "cash_receipt",
      label: "현금영수증",
      plainMeaning: "현금, 계좌이체, 간편결제 현금성 결제의 지출/매출 증빙입니다.",
      collectWhen: "현금으로 팔거나 사고 사업자 지출증빙을 받아야 할 때",
      appBucket: "매입/비용 증빙",
      beginnerCheck: ["소득공제용/지출증빙용", "사업자번호", "금액", "발행일", "가맹점"],
      automationHint: "지출증빙용과 소득공제용을 구분해 잘못 받은 건을 확인 대상으로 올립니다.",
      caution: "사업자 비용으로 쓰려면 발급 유형과 사업자 정보 확인이 필요합니다.",
    },
    {
      id: "card_sales_slip",
      label: "신용카드 매출전표",
      plainMeaning: "카드 결제 매출 또는 사업용 카드 비용의 증빙입니다.",
      collectWhen: "카드 단말기, PG, 배달앱, 사업용 카드 결제가 있을 때",
      appBucket: "정산/입금 근거",
      beginnerCheck: ["매출/매입 구분", "카드사", "승인일", "공급자", "공제/불공제 후보"],
      automationHint: "사업용 카드, 카드 매출, PG 정산 자료를 월별로 대조합니다.",
      caution: "사업과 무관한 지출, 접대성 지출 등은 공제 여부 확인이 필요합니다.",
    },
    {
      id: "transaction_statement",
      label: "거래명세서",
      plainMeaning: "품목, 수량, 단가를 확인하는 거래 내역표입니다.",
      collectWhen: "납품, 도소매, B2B 거래에서 상세 내역을 맞출 때",
      appBucket: "계약/거래 근거",
      beginnerCheck: ["품목", "수량", "단가", "거래일", "세금계산서와 금액 일치 여부"],
      automationHint: "세금계산서와 금액/품목이 맞는지 비교하는 보조 근거로 씁니다.",
      caution: "거래명세서만으로 세무상 적격증빙이 충분하다고 단정하지 않습니다.",
    },
    {
      id: "contract",
      label: "계약서/견적서",
      plainMeaning: "거래 조건, 기간, 금액, 책임 범위를 확인하는 문서입니다.",
      collectWhen: "용역, 납품, 정기 구독, 외주, 임대, B2B 거래를 시작할 때",
      appBucket: "계약/거래 근거",
      beginnerCheck: ["계약 기간", "금액/부가세 포함 여부", "서명/날인", "해지/위약", "자동연장"],
      automationHint: "계약 위험 문구와 세금계산서 발행 기준을 체크리스트로 만듭니다.",
      caution: "계약 제출, 서명, 회신은 최종 승인 전 실행하지 않습니다.",
    },
    {
      id: "bank_transfer",
      label: "계좌이체/입금내역",
      plainMeaning: "실제로 돈이 오간 기록입니다.",
      collectWhen: "현금성 결제, 외상 회수, 공급처 대금 지급이 있을 때",
      appBucket: "정산/입금 근거",
      beginnerCheck: ["입금자/수취인", "일자", "금액", "관련 세금계산서", "미수/미지급 여부"],
      automationHint: "세금계산서, 현금영수증, 거래명세서와 입금액을 대조합니다.",
      caution: "입금내역만으로 매출/비용 처리를 확정하지 않습니다.",
    },
    {
      id: "platform_settlement",
      label: "온라인몰/배달앱/PG 정산서",
      plainMeaning: "플랫폼이 판매액에서 수수료 등을 빼고 입금한 내역입니다.",
      collectWhen: "스마트스토어, 쿠팡, 배달앱, PG, 오픈마켓을 쓸 때",
      appBucket: "정산/입금 근거",
      beginnerCheck: ["총 매출", "수수료", "환불", "정산 입금액", "카드/현금영수증 매출과 중복 여부"],
      automationHint: "플랫폼별 정산서를 매출, 수수료, 환불, 입금액으로 나눕니다.",
      caution: "플랫폼 정산액과 세금 신고 매출액은 다를 수 있어 대조가 필요합니다.",
    },
    {
      id: "payroll_withholding",
      label: "인건비/원천세 자료",
      plainMeaning: "직원 급여, 프리랜서 지급, 원천징수 관련 자료입니다.",
      collectWhen: "직원, 일용직, 프리랜서, 강사, 외주 인건비가 있을 때",
      appBucket: "인건비/원천세",
      beginnerCheck: ["지급 대상", "지급일", "총액", "원천징수", "신고/납부 여부"],
      automationHint: "급여/프리랜서 지급 자료를 원천세 확인 묶음으로 분리합니다.",
      caution: "원천세 신고와 4대보험 판단은 전문가 확인 대상으로 둡니다.",
    },
  ],
  flowGuides: [
    {
      id: "offline_retail",
      label: "오프라인 매장",
      plainMeaning: "카드 단말기, 현금영수증, 계좌입금, 매장 비용이 섞입니다.",
      likelyEvidenceIds: ["card_sales_slip", "cash_receipt", "tax_invoice", "bank_transfer"],
      firstAutomation: "카드 매출, 현금영수증 매출, 입금내역을 월별로 묶고 빠진 증빙을 표시합니다.",
    },
    {
      id: "online_store",
      label: "온라인 판매",
      plainMeaning: "플랫폼 매출, PG 정산, 환불, 수수료, 배송비가 함께 움직입니다.",
      likelyEvidenceIds: ["platform_settlement", "card_sales_slip", "cash_receipt", "tax_invoice"],
      firstAutomation: "플랫폼별 정산서에서 매출, 수수료, 환불, 입금액을 나눠 봅니다.",
    },
    {
      id: "wholesale_b2b",
      label: "도소매/B2B 납품",
      plainMeaning: "거래명세서, 세금계산서, 입금 내역이 서로 맞아야 합니다.",
      likelyEvidenceIds: ["transaction_statement", "tax_invoice", "bank_transfer", "contract"],
      firstAutomation: "거래명세서와 세금계산서 금액/품목 차이를 확인합니다.",
    },
    {
      id: "service_contract",
      label: "서비스/용역 계약",
      plainMeaning: "계약 조건, 세금계산서 발행 시점, 입금 여부가 중요합니다.",
      likelyEvidenceIds: ["contract", "tax_invoice", "bank_transfer"],
      firstAutomation: "계약서 금액/기간/부가세 문구와 세금계산서 발행 여부를 묶습니다.",
    },
    {
      id: "electronic_payment",
      label: "전자결제/PG",
      plainMeaning: "카드, 간편결제, 현금영수증, 수수료, 정산 입금이 나뉩니다.",
      likelyEvidenceIds: ["platform_settlement", "card_sales_slip", "cash_receipt", "bank_transfer"],
      firstAutomation: "PG 정산액과 통장 입금액, 카드/현금영수증 매출을 대조합니다.",
    },
    {
      id: "payroll_or_freelancer",
      label: "직원/프리랜서 지급",
      plainMeaning: "월 지급액, 원천징수, 신고/납부 확인이 필요합니다.",
      likelyEvidenceIds: ["payroll_withholding", "bank_transfer", "contract"],
      firstAutomation: "지급 대상별 금액, 지급일, 원천징수 확인 항목을 만듭니다.",
    },
  ],
  monthlyRoutine: [
    "1. 매출 자료 모으기: 세금계산서, 카드 매출, 현금영수증, 플랫폼 정산서",
    "2. 매입/비용 자료 모으기: 세금계산서, 사업용 카드, 현금영수증, 계좌이체",
    "3. 보조 근거 붙이기: 거래명세서, 계약서, 견적서, 입금내역",
    "4. 대조하기: 월, 거래처, 금액, 부가세, 입금 여부, 환불/취소",
    "5. 승인하기: 세무사 전달, 신고, 계약 제출, 서명은 최종 확인 후 실행",
  ],
  approvalBoundary:
    "ModyCrew는 세금 신고, 수정신고, 납부, 세무사 전달, 계약 제출, 전자서명을 자동 실행하지 않고 승인 후보와 확인표까지만 만듭니다.",
  sourceNotes: [
    "국세청 부가가치세 기본정보: 일반/간이과세자 구분, 과세기간, 신고·납부 흐름",
    "국세청 사업용 신용카드 안내: 사업용 카드 등록, 홈택스 조회, 매입세액 공제 확인/변경",
    "국세청 현금영수증·신용카드 FAQ: 현금영수증 지출증빙, 사업용 카드, 조회 항목",
    "홈택스: 전자세금계산서, 현금영수증, 신용카드 매출/매입 조회入口",
  ],
};

export function getModyTaxBeginnerEvidenceGuide(id: ModyTaxBeginnerEvidenceId): ModyTaxBeginnerEvidenceGuide | undefined {
  return modyTaxBeginnerGuide.evidenceGuides.find((guide) => guide.id === id);
}

export function getModyTaxBeginnerFlowGuide(id: ModyTaxBeginnerFlowId): ModyTaxBeginnerFlowGuide | undefined {
  return modyTaxBeginnerGuide.flowGuides.find((guide) => guide.id === id);
}
