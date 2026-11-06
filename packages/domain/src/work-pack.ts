export type ModyWorkPackId =
  | "inquiry_response"
  | "schedule_coordination"
  | "report_cleanup"
  | "inventory_reorder"
  | "tax_contract_archive";

export type ModyWorkPackFeatureId =
  | "work_intake"
  | "connector_recommendations"
  | "automation_monitoring"
  | "document_learning"
  | "remote_desktop_relay"
  | "desktop_control"
  | "approval_execution";

export type ModyWorkPackConnectorRequirement = {
  connectorId: string;
  label: string;
  purpose: string;
  setupHref: string;
};

export type ModyWorkPackKnowledgeScope = {
  id: string;
  label: string;
  purpose: string;
  userGrantRequired: true;
};

export type ModyWorkPackAutomationRule = {
  id: string;
  label: string;
  trigger: "mail_received" | "calendar_changed" | "file_added" | "inventory_threshold" | "daily_briefing";
  userVisibleSchedule: string;
  startsEnabled: false;
};

export type ModyWorkPackApprovalRule = {
  id: string;
  label: string;
  appliesTo: string;
  finalUserApprovalRequired: true;
};

export type ModyWorkPackDefinition = {
  id: ModyWorkPackId;
  title: string;
  description: string;
  categoryLabel: string;
  iconName: "mail" | "calendar" | "file" | "bolt";
  starterPrompt: string;
  visibleOutcome: string;
  requiredFeatureIds: ModyWorkPackFeatureId[];
  connectorRequirements: ModyWorkPackConnectorRequirement[];
  knowledgeScopes: ModyWorkPackKnowledgeScope[];
  automationRules: ModyWorkPackAutomationRule[];
  approvalRules: ModyWorkPackApprovalRule[];
  safetyBoundary: string;
};

export type ModyWorkPackInstallPlan = {
  packId: ModyWorkPackId;
  title: string;
  requiredFeatureIds: ModyWorkPackFeatureId[];
  connectorCount: number;
  knowledgeScopeCount: number;
  automationRuleCount: number;
  approvalRuleCount: number;
  nextSteps: string[];
  safetyBoundary: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
};

export const modyWorkPackCatalog: ModyWorkPackDefinition[] = [
  {
    id: "inquiry_response",
    title: "문의 응대",
    description: "문의 원문을 읽고 답장 초안과 확인 질문을 만듭니다.",
    categoryLabel: "메일·문의",
    iconName: "mail",
    starterPrompt:
      "학원 상담 문의가 왔습니다. 초등 4학년 수학 보강반 가능 시간, 수강료, 첫 상담 가능 일정을 묻고 있습니다. 친절한 답장 초안과 확인해야 할 질문을 만들어 주세요.",
    visibleOutcome: "답장 초안, 확인 질문, 승인 대기 발송 후보",
    requiredFeatureIds: ["work_intake", "connector_recommendations", "approval_execution"],
    connectorRequirements: [
      {
        connectorId: "gmail",
        label: "Gmail 또는 회사 메일",
        purpose: "새 문의와 이전 대화 맥락을 읽습니다.",
        setupHref: "/connect?intent=%EB%AC%B8%EC%9D%98%20%EC%9D%91%EB%8C%80&connector=gmail",
      },
      {
        connectorId: "business-inquiry",
        label: "홈페이지 문의함",
        purpose: "웹 문의를 같은 업무 카드로 모읍니다.",
        setupHref: "/connect?intent=%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80%20%EB%AC%B8%EC%9D%98&connector=business-inquiry",
      },
    ],
    knowledgeScopes: [
      {
        id: "faq-and-pricing",
        label: "자주 묻는 질문·가격표",
        purpose: "반복 문의 답변을 회사 기준에 맞춥니다.",
        userGrantRequired: true,
      },
    ],
    automationRules: [
      {
        id: "new-inquiry-draft",
        label: "새 문의가 오면 초안 만들기",
        trigger: "mail_received",
        userVisibleSchedule: "새 문의 수신 시",
        startsEnabled: false,
      },
    ],
    approvalRules: [
      {
        id: "send-reply-approval",
        label: "고객 답장 발송 전 승인",
        appliesTo: "이메일·메신저 답장",
        finalUserApprovalRequired: true,
      },
    ],
    safetyBoundary: "문의 내용을 읽고 초안만 만들며, 고객에게 보내는 행위는 승인 전 실행하지 않습니다.",
  },
  {
    id: "schedule_coordination",
    title: "일정 조율",
    description: "일정 후보를 정리하고 승인 전 캘린더 후보로 둡니다.",
    categoryLabel: "캘린더",
    iconName: "calendar",
    starterPrompt:
      "고객이 다음 주 화요일 또는 목요일 오후 상담 예약을 원합니다. 가능한 시간 후보를 정리하고, 확정 전에 고객에게 보낼 안내 문장을 만들어 주세요.",
    visibleOutcome: "가능 시간 후보, 일정 등록 확인 질문, 안내 메일 초안",
    requiredFeatureIds: ["work_intake", "connector_recommendations", "automation_monitoring", "approval_execution"],
    connectorRequirements: [
      {
        connectorId: "google-calendar",
        label: "개인·업무 캘린더",
        purpose: "가능 시간과 충돌 일정을 확인합니다.",
        setupHref: "/connect?intent=%EC%9D%BC%EC%A0%95%20%EC%A1%B0%EC%9C%A8&connector=google-calendar",
      },
      {
        connectorId: "gmail",
        label: "일정 요청 메일",
        purpose: "상대가 보낸 날짜와 시간을 읽습니다.",
        setupHref: "/connect?intent=%EC%9D%BC%EC%A0%95%20%EC%9A%94%EC%B2%AD%20%EB%A9%94%EC%9D%BC&connector=gmail",
      },
    ],
    knowledgeScopes: [
      {
        id: "meeting-rules",
        label: "상담 가능 시간·휴무 규칙",
        purpose: "불가능한 시간을 추천하지 않게 합니다.",
        userGrantRequired: true,
      },
    ],
    automationRules: [
      {
        id: "schedule-request-watch",
        label: "일정 요청 메일 감시",
        trigger: "mail_received",
        userVisibleSchedule: "일정 표현이 있는 메일 수신 시",
        startsEnabled: false,
      },
      {
        id: "daily-schedule-briefing",
        label: "오늘·이번 주 일정 브리핑",
        trigger: "daily_briefing",
        userVisibleSchedule: "매일 아침",
        startsEnabled: false,
      },
    ],
    approvalRules: [
      {
        id: "calendar-create-approval",
        label: "캘린더 등록 전 승인",
        appliesTo: "일정 생성·변경",
        finalUserApprovalRequired: true,
      },
    ],
    safetyBoundary: "가능 시간은 읽기 전용으로 확인하고, 일정 등록과 답장 발송은 승인 전 실행하지 않습니다.",
  },
  {
    id: "report_cleanup",
    title: "보고서 정리",
    description: "문서와 파일 내용을 업무 카드와 보고 초안으로 바꿉니다.",
    categoryLabel: "자료·문서",
    iconName: "file",
    starterPrompt:
      "거래처가 보낸 견적서와 지난달 납품 내역을 비교해야 합니다. 누락 가능성이 있는 항목, 확인해야 할 금액, 보고서에 넣을 요약을 만들어 주세요.",
    visibleOutcome: "파일 요약, 누락 확인 목록, 보고서 초안",
    requiredFeatureIds: ["work_intake", "document_learning", "desktop_control", "approval_execution"],
    connectorRequirements: [
      {
        connectorId: "local-folder",
        label: "업무 폴더",
        purpose: "보고서와 첨부파일을 사용자가 고른 범위에서만 읽습니다.",
        setupHref: "/learn?intent=%EB%B3%B4%EA%B3%A0%EC%84%9C%20%EC%A0%95%EB%A6%AC",
      },
      {
        connectorId: "google-drive",
        label: "Drive 또는 공유 폴더",
        purpose: "공유된 업무 자료를 정리합니다.",
        setupHref: "/connect?intent=%EA%B3%B5%EC%9C%A0%20%EC%9E%90%EB%A3%8C&connector=google-drive",
      },
    ],
    knowledgeScopes: [
      {
        id: "handoff-and-report-format",
        label: "인수인계서·보고서 양식",
        purpose: "회사에서 쓰던 형식으로 결과를 맞춥니다.",
        userGrantRequired: true,
      },
    ],
    automationRules: [
      {
        id: "new-report-file-watch",
        label: "새 업무 파일 들어오면 요약",
        trigger: "file_added",
        userVisibleSchedule: "사용자가 켠 폴더만",
        startsEnabled: false,
      },
    ],
    approvalRules: [
      {
        id: "share-report-approval",
        label: "보고서 공유 전 승인",
        appliesTo: "파일 공유·외부 전달",
        finalUserApprovalRequired: true,
      },
    ],
    safetyBoundary: "사용자가 지정한 폴더와 파일만 읽고, 원본 수정이나 공유는 승인 전 실행하지 않습니다.",
  },
  {
    id: "inventory_reorder",
    title: "재고 발주",
    description: "재고 변화와 발주 기준을 읽고 승인 후보를 만듭니다.",
    categoryLabel: "운영",
    iconName: "bolt",
    starterPrompt:
      "오늘 판매량 기준으로 A상품 재고가 3일 안에 부족할 수 있습니다. 발주 필요 여부, 공급처 확인 문구, 승인 전에 봐야 할 위험 요소를 정리해 주세요.",
    visibleOutcome: "부족 예상, 발주 후보, 공급처 확인 메시지",
    requiredFeatureIds: ["work_intake", "connector_recommendations", "automation_monitoring", "approval_execution"],
    connectorRequirements: [
      {
        connectorId: "inventory-system",
        label: "재고표 또는 판매 시스템",
        purpose: "현재 재고와 최근 판매 변화를 읽습니다.",
        setupHref: "/connect?intent=%EC%9E%AC%EA%B3%A0%20%EB%B0%9C%EC%A3%BC&connector=inventory-system",
      },
      {
        connectorId: "gmail",
        label: "공급처 메일",
        purpose: "발주 확인 문구와 공급처 응답을 관리합니다.",
        setupHref: "/connect?intent=%EA%B3%B5%EA%B8%89%EC%B2%98%20%EB%A9%94%EC%9D%BC&connector=gmail",
      },
    ],
    knowledgeScopes: [
      {
        id: "inventory-thresholds",
        label: "발주 기준표",
        purpose: "품목별 안전재고와 발주 단위를 적용합니다.",
        userGrantRequired: true,
      },
    ],
    automationRules: [
      {
        id: "inventory-threshold-watch",
        label: "부족 가능성 감시",
        trigger: "inventory_threshold",
        userVisibleSchedule: "사용자가 켠 품목만",
        startsEnabled: false,
      },
    ],
    approvalRules: [
      {
        id: "purchase-order-approval",
        label: "발주 요청 전 승인",
        appliesTo: "발주 메일·주문 변경",
        finalUserApprovalRequired: true,
      },
    ],
    safetyBoundary: "재고와 판매 데이터는 읽기 중심으로 확인하고, 주문 변경과 발주 요청은 승인 전 실행하지 않습니다.",
  },
  {
    id: "tax_contract_archive",
    title: "세금·계약 자료 정리",
    description: "세금계산서, 현금영수증, 계약서를 월별·거래처별로 묶고 제출 전 확인표를 만듭니다.",
    categoryLabel: "세무·계약",
    iconName: "file",
    starterPrompt:
      "이번 달 세금계산서, 현금영수증, 카드 매출 정산표, 거래처 계약서를 모았습니다. 월별·거래처별로 정리하고 세무사에게 보내기 전 확인할 누락 항목과 계약 위험 문구를 표로 만들어 주세요.",
    visibleOutcome: "월별 증빙 묶음, 누락 확인표, 세무사 전달 초안, 계약 위험 체크리스트",
    requiredFeatureIds: ["work_intake", "document_learning", "desktop_control", "approval_execution"],
    connectorRequirements: [
      {
        connectorId: "local-folder",
        label: "세금·계약 자료 폴더",
        purpose: "사용자가 고른 폴더 안의 계산서, 영수증, 계약서만 읽습니다.",
        setupHref: "/learn?intent=%EC%84%B8%EA%B8%88%C2%B7%EA%B3%84%EC%95%BD%20%EC%9E%90%EB%A3%8C%20%EC%A0%95%EB%A6%AC",
      },
      {
        connectorId: "google-drive",
        label: "Drive 또는 공유 폴더",
        purpose: "세무사·회계 담당자와 공유한 자료 위치를 읽기 전용으로 확인합니다.",
        setupHref: "/connect?intent=%EC%84%B8%EB%AC%B4%20%EA%B3%B5%EC%9C%A0%20%EC%9E%90%EB%A3%8C&connector=google-drive",
      },
      {
        connectorId: "gmail",
        label: "세무사·거래처 메일",
        purpose: "계산서 재발행, 누락 영수증, 계약 확인 요청 메일을 업무 카드로 모읍니다.",
        setupHref: "/connect?intent=%EC%84%B8%EB%AC%B4%EC%82%AC%20%EA%B1%B0%EB%9E%98%EC%B2%98%20%EB%A9%94%EC%9D%BC&connector=gmail",
      },
    ],
    knowledgeScopes: [
      {
        id: "tax-evidence-format",
        label: "세금계산서·현금영수증 정리 양식",
        purpose: "회사에서 쓰던 증빙 정리표와 월별 제출 형식을 맞춥니다.",
        userGrantRequired: true,
      },
      {
        id: "contract-review-rules",
        label: "계약서·견적서 확인 기준",
        purpose: "금액, 기간, 서명, 위약, 자동연장 같은 위험 문구를 따로 표시합니다.",
        userGrantRequired: true,
      },
      {
        id: "accountant-handoff-checklist",
        label: "세무사 전달 체크리스트",
        purpose: "누락 증빙, 중복 파일, 제출 전 확인 항목을 회사 기준으로 정리합니다.",
        userGrantRequired: true,
      },
    ],
    automationRules: [
      {
        id: "tax-contract-file-watch",
        label: "새 계산서·영수증·계약서 들어오면 정리 후보 만들기",
        trigger: "file_added",
        userVisibleSchedule: "사용자가 켠 세무·계약 폴더만",
        startsEnabled: false,
      },
      {
        id: "tax-contract-mail-watch",
        label: "세무사·거래처 메일에서 증빙 요청 후보 찾기",
        trigger: "mail_received",
        userVisibleSchedule: "세무/계약 표현이 있는 메일 수신 시",
        startsEnabled: false,
      },
    ],
    approvalRules: [
      {
        id: "tax-accountant-share-approval",
        label: "세무사 전달·외부 공유 전 승인",
        appliesTo: "증빙 묶음 공유·메일 발송·파일 제출",
        finalUserApprovalRequired: true,
      },
      {
        id: "contract-submit-sign-approval",
        label: "계약 제출·서명·날인 전 승인",
        appliesTo: "계약서 제출·전자서명·거래처 회신",
        finalUserApprovalRequired: true,
      },
    ],
    safetyBoundary: "세금·계약 자료는 사용자가 고른 범위에서만 읽고 정리표와 초안만 만들며, 세무사 전달, 외부 공유, 제출, 서명은 승인 전 실행하지 않습니다.",
  },
];

export function createModyWorkPackInstallPlan(pack: ModyWorkPackDefinition): ModyWorkPackInstallPlan {
  return {
    packId: pack.id,
    title: pack.title,
    requiredFeatureIds: [...pack.requiredFeatureIds],
    connectorCount: pack.connectorRequirements.length,
    knowledgeScopeCount: pack.knowledgeScopes.length,
    automationRuleCount: pack.automationRules.length,
    approvalRuleCount: pack.approvalRules.length,
    nextSteps: [
      `${pack.connectorRequirements.length}개 연결 확인`,
      `${pack.knowledgeScopes.length}개 자료 범위 선택`,
      `${pack.automationRules.length}개 자동 감시 규칙은 사용자가 켤 때까지 대기`,
      `${pack.approvalRules.length}개 승인 규칙 적용`,
    ],
    safetyBoundary: pack.safetyBoundary,
    externalMutation: false,
    rawSecretMaterialStored: false,
  };
}

export function findModyWorkPack(id: string): ModyWorkPackDefinition | undefined {
  return modyWorkPackCatalog.find((pack) => pack.id === id);
}

/** 직원 템플릿 식별자. 웹의 AITeammateTeam 과 같은 목록이다. */
export type ModyTeammateTemplateId =
  | "operations"
  | "mail"
  | "desktop"
  | "marketing"
  | "development"
  | "finance"
  | "legal"
  | "personal"
  | "custom";

/**
 * 템플릿별로 이 직원이 맡을 수 있는 업무 종류.
 *
 * 이 표가 정본이다. 데스크톱의 supportedWorkPackIdsForTeammateTemplate 이 같은 값을
 * 갖고 있어야 하며, tests/domain/teammate-work-pack-authority.test.mjs 가 두 곳이
 * 어긋나면 실패한다. 화면과 실행이 다른 말을 하는 것을 막기 위한 것이다.
 *
 * `personal`(기본 비서)은 사용자의 요청을 가장 먼저 받는 조율자라 전 종류를 본다.
 * `custom`(사용자가 만든 직원)은 고정 목록이 없다 — 만들 때 고른 값을 쓴다.
 */
export const modyTeammateTemplateWorkPackIds: Readonly<
  Record<ModyTeammateTemplateId, readonly ModyWorkPackId[]>
> = {
  operations: [
    "inquiry_response",
    "schedule_coordination",
    "report_cleanup",
    "inventory_reorder",
  ],
  mail: ["inquiry_response", "schedule_coordination"],
  finance: ["report_cleanup", "tax_contract_archive"],
  legal: ["tax_contract_archive"],
  desktop: ["report_cleanup", "inventory_reorder"],
  marketing: ["inquiry_response", "report_cleanup"],
  development: ["report_cleanup"],
  personal: [
    "inquiry_response",
    "schedule_coordination",
    "report_cleanup",
    "inventory_reorder",
    "tax_contract_archive",
  ],
  custom: [],
};

/**
 * 이 직원이 실제로 맡는 업무 종류. 템플릿 기본값과 직원이 따로 받은 범위를 합친다.
 * 정규 목록에 없는 값은 버리고, 정렬해서 돌려준다(호출부가 지문을 만든다).
 */
export function resolveModyTeammateWorkPackIds(input: {
  templateId?: string;
  workPackIds?: readonly string[];
}): ModyWorkPackId[] {
  const template = modyTeammateTemplateWorkPackIds[
    input.templateId as ModyTeammateTemplateId
  ];
  const declared = Array.isArray(input.workPackIds) ? input.workPackIds : [];
  const known = new Set(modyWorkPackCatalog.map((pack) => pack.id));
  return [
    ...new Set(
      [...(template ?? []), ...declared].filter((id): id is ModyWorkPackId =>
        known.has(id as ModyWorkPackId),
      ),
    ),
  ].sort();
}
