import { ModyConnectorSetupRegistry } from "./connector-setup.js";
import type {
  ModyConnectorAutomationScope,
  ModyConnectorDefinition,
} from "./connector-setup.js";

export type ModyConnectorUseCase =
  | "mail_reply"
  | "schedule_coordination"
  | "messenger_commands"
  | "knowledge_workspace"
  | "design_collaboration"
  | "local_documents"
  | "desktop_assist"
  | "web_research"
  | "local_automation"
  | "line_kakao_policy"
  | "sns_business_channels"
  | "imessage_local_bridge"
  | "business_inquiry_channels"
  | "booking_platforms"
  | "inventory_monitoring";

export type ModyConnectorGuidanceInput = {
  selectedUseCases?: ModyConnectorUseCase[];
  userGoalText?: string;
  connectedConnectorIds?: string[];
};

export type ModyConnectorUseCaseGuide = {
  id: ModyConnectorUseCase;
  label: string;
  userQuestion: string;
  connectorIds: string[];
};

export type ModyConnectorRecommendation = {
  connectorId: string;
  connectorName: string;
  priority: ModyConnectorDefinition["priority"];
  automationScope: ModyConnectorAutomationScope;
  alreadyConnected: boolean;
  setupActionLabel: string;
  reason: string;
  askAiPrompt: string;
  safetyNote: string;
};

export type ModyConnectorGuidancePlan = {
  askAiPlaceholder: string;
  selectedUseCases: ModyConnectorUseCase[];
  useCaseGuides: ModyConnectorUseCaseGuide[];
  recommendations: ModyConnectorRecommendation[];
  nextActionLabel: string;
  safetySummary: string;
};

const useCaseGuides: readonly ModyConnectorUseCaseGuide[] = [
  {
    id: "mail_reply",
    label: "메일/문의 답장",
    userQuestion: "고객 문의를 읽고 답장 초안을 만들고 싶어요.",
    connectorIds: ["gmail-outlook-mail"],
  },
  {
    id: "schedule_coordination",
    label: "일정 조율",
    userQuestion: "예약, 상담, 미팅 요청을 내 일정과 함께 정리하고 가능 시간을 받고 싶어요.",
    connectorIds: ["calendar-google-outlook", "gmail-outlook-mail"],
  },
  {
    id: "messenger_commands",
    label: "메신저 명령",
    userQuestion: "앱을 열지 않고 Slack, Telegram, Discord, NAVER WORKS에서 승인과 수정 요청을 하고 싶어요.",
    connectorIds: ["slack-app", "telegram-bot", "discord-app", "naver-works-bot"],
  },
  {
    id: "knowledge_workspace",
    label: "Notion 업무공간",
    userQuestion: "Notion 문서와 업무 DB를 AI 업무 흐름에 연결하고 싶어요.",
    connectorIds: ["notion-workspace"],
  },
  {
    id: "design_collaboration",
    label: "Figma 디자인 협업",
    userQuestion: "Figma 디자인 파일과 화면 기획을 AI가 확인하게 하고 싶어요.",
    connectorIds: ["figma-design"],
  },
  {
    id: "local_documents",
    label: "컴퓨터 자료 검색",
    userQuestion: "PC에 있는 PDF, 엑셀, 보고서 양식을 찾아서 업무에 연결하고 싶어요.",
    connectorIds: ["local-folder-index", "desktop-bridge"],
  },
  {
    id: "desktop_assist",
    label: "데스크톱 앱 보조",
    userQuestion: "기존 앱과 브라우저 업무 화면 옆에서 AI가 보조하게 하고 싶어요.",
    connectorIds: ["desktop-bridge"],
  },
  {
    id: "web_research",
    label: "웹 조사",
    userQuestion: "업무 자료 조사와 레퍼런스 확인을 AI에게 맡기고 싶어요.",
    connectorIds: ["web-search-mcp"],
  },
  {
    id: "local_automation",
    label: "로컬 자동화",
    userQuestion: "로컬 CLI로 변환, 검증, 파일 처리 작업을 자동화하고 싶어요.",
    connectorIds: ["local-cli-tools"],
  },
  {
    id: "line_kakao_policy",
    label: "LINE/KakaoTalk",
    userQuestion: "LINE, 카카오톡 같은 고객 채널도 연결 가능한지 물어보고 싶어요.",
    connectorIds: ["line-kakao-channel"],
  },
  {
    id: "sns_business_channels",
    label: "SNS/비즈니스 메시징",
    userQuestion: "WhatsApp, Facebook Messenger, Instagram DM, Apple Messages for Business도 연결 가능한지 알고 싶어요.",
    connectorIds: ["social-business-messaging"],
  },
  {
    id: "imessage_local_bridge",
    label: "iMessage/macOS Messages",
    userQuestion: "아이메세지를 내 Mac에서 로컬로 보조할 수 있는지 알고 싶어요.",
    connectorIds: ["imessage-local-macos-bridge"],
  },
  {
    id: "business_inquiry_channels",
    label: "문의 채널",
    userQuestion: "회사메일, 공공기관메일, 네이버/카카오 문의글을 업무 메일처럼 처리하고 싶어요.",
    connectorIds: ["business-inquiry-inbox"],
  },
  {
    id: "booking_platforms",
    label: "예약 채널",
    userQuestion: "네이버예약, 카카오예약, 구글예약에서 예약 가능 날짜와 미팅 가능 시간을 추려 받고 싶어요.",
    connectorIds: ["booking-platform-hub", "calendar-google-outlook"],
  },
  {
    id: "inventory_monitoring",
    label: "재고 체크",
    userQuestion: "회사 시스템 재고를 확인하고 부족하면 문자 발송 후보까지 만들고 싶어요.",
    connectorIds: ["business-system-inventory"],
  },
];

const keywordUseCaseMap: ReadonlyArray<{
  useCase: ModyConnectorUseCase;
  keywords: readonly string[];
}> = [
  { useCase: "mail_reply", keywords: ["메일", "mail", "gmail", "outlook", "문의", "답장", "고객"] },
  { useCase: "schedule_coordination", keywords: ["일정", "예약", "미팅", "캘린더", "calendar", "상담", "가능 시간", "가능한 날짜"] },
  { useCase: "messenger_commands", keywords: ["메신저", "slack", "telegram", "discord", "디스코드", "naver works", "승인", "수정 요청"] },
  { useCase: "knowledge_workspace", keywords: ["notion", "노션", "문서 db", "업무 db", "회의록", "위키"] },
  { useCase: "design_collaboration", keywords: ["figma", "피그마", "디자인", "화면 기획", "컴포넌트", "handoff"] },
  { useCase: "local_documents", keywords: ["파일", "문서", "pdf", "엑셀", "보고서", "자료", "폴더"] },
  { useCase: "desktop_assist", keywords: ["데스크톱", "pc", "컴퓨터", "브리지", "기존 앱", "브라우저"] },
  { useCase: "web_research", keywords: ["웹", "조사", "검색", "레퍼런스", "자료 조사"] },
  { useCase: "local_automation", keywords: ["cli", "변환", "검증", "로컬 자동화"] },
  { useCase: "line_kakao_policy", keywords: ["line", "카카오", "kakao", "카카오톡"] },
  { useCase: "sns_business_channels", keywords: ["whatsapp", "왓츠앱", "facebook", "페이스북", "instagram", "인스타", "sns"] },
  { useCase: "imessage_local_bridge", keywords: ["imessage", "아이메세지", "아이메시지", "messages", "apple messages"] },
  { useCase: "business_inquiry_channels", keywords: ["회사 전용", "공공기관", "네이버 문의", "카카오 문의", "다음", "문의글", "업장"] },
  { useCase: "booking_platforms", keywords: ["네이버 예약", "카카오 예약", "구글 예약", "예약 시스템", "예약 가능한", "미팅 가능한"] },
  { useCase: "inventory_monitoring", keywords: ["재고", "부족", "발주", "pos", "erp", "inventory", "stock", "문자", "sms"] },
];

export class ModyConnectorGuidancePlanner {
  constructor(private readonly registry = new ModyConnectorSetupRegistry()) {}

  listUseCaseGuides(): ModyConnectorUseCaseGuide[] {
    return [...useCaseGuides];
  }

  createPlan(input: ModyConnectorGuidanceInput = {}): ModyConnectorGuidancePlan {
    const selectedUseCases = normalizeUseCases(input);
    const connectedConnectorIds = new Set(input.connectedConnectorIds ?? []);
    const definitions = new Map(this.registry.listDefinitions().map((definition) => [definition.id, definition]));
    const connectorIds = unique(
      selectedUseCases.flatMap((useCase) =>
        useCaseGuides.find((guide) => guide.id === useCase)?.connectorIds ?? [],
      ),
    );
    const recommendations = connectorIds
      .map((connectorId) => definitions.get(connectorId))
      .filter((definition): definition is ModyConnectorDefinition => Boolean(definition))
      .map((definition) => recommendationFor(definition, selectedUseCases, connectedConnectorIds));

    return {
      askAiPlaceholder: "예: 고객 문의 답장과 일정 조율을 AI에게 맡기려면 뭘 연결해야 해?",
      selectedUseCases,
      useCaseGuides: this.listUseCaseGuides(),
      recommendations,
      nextActionLabel: recommendations.some((item) => !item.alreadyConnected)
        ? "추천 연결을 설정에서 확인"
        : "연결 상태 점검",
      safetySummary: "AI는 어떤 툴을 연결할지 추천하고 설정 화면으로 안내하지만, OAuth 동의, bot token, OS 권한, 폴더 선택은 사용자가 직접 확인합니다.",
    };
  }
}

function normalizeUseCases(input: ModyConnectorGuidanceInput): ModyConnectorUseCase[] {
  if (input.selectedUseCases && input.selectedUseCases.length > 0) {
    return unique(input.selectedUseCases);
  }

  const inferred = inferUseCases(input.userGoalText ?? "");
  return inferred.length > 0
    ? inferred
    : ["mail_reply", "schedule_coordination", "local_documents"];
}

function inferUseCases(text: string): ModyConnectorUseCase[] {
  const normalized = text.toLocaleLowerCase("ko-KR");
  const matched = keywordUseCaseMap
    .filter((entry) => entry.keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase("ko-KR"))))
    .map((entry) => entry.useCase);

  return unique(matched);
}

function recommendationFor(
  definition: ModyConnectorDefinition,
  selectedUseCases: ModyConnectorUseCase[],
  connectedConnectorIds: Set<string>,
): ModyConnectorRecommendation {
  const matchedGuide = useCaseGuides.find((guide) =>
    selectedUseCases.includes(guide.id) && guide.connectorIds.includes(definition.id),
  );
  const alreadyConnected = connectedConnectorIds.has(definition.id);

  return {
    connectorId: definition.id,
    connectorName: definition.name,
    priority: definition.priority,
    automationScope: automationScopeFor(definition),
    alreadyConnected,
    setupActionLabel: alreadyConnected ? "상태 점검" : actionLabelFor(definition),
    reason: matchedGuide
      ? `${matchedGuide.label}을 하려면 ${definition.name} 연결이 필요합니다.`
      : definition.userValue,
    askAiPrompt: `AI에게 물어보기: "${matchedGuide?.userQuestion ?? `${definition.name}을 어떻게 연결해야 해?`}"`,
    safetyNote: safetyNoteFor(definition),
  };
}

function automationScopeFor(definition: ModyConnectorDefinition): ModyConnectorAutomationScope {
  if (definition.priority === "research") return "off";
  if (definition.permissions.some((permission) => [
    "send_external",
    "write_calendar",
    "write_files",
    "desktop_control",
    "cli_execution",
    "write_booking_hold",
    "write_inventory",
    "send_sms",
  ].includes(permission))) {
    return "approval_required_execution";
  }
  if (definition.permissions.includes("send_draft")) return "draft_only";
  return "read_only";
}

function actionLabelFor(definition: ModyConnectorDefinition): string {
  if (definition.priority === "research") return "정책 확인";
  if (definition.kind === "local_folder") return "폴더 선택";
  if (definition.kind === "desktop_bridge") return "브리지 연결";
  if (definition.kind === "mcp_server") return "MCP 점검";
  if (definition.kind === "cli_tool") return "CLI 점검";
  return "연결하기";
}

function safetyNoteFor(definition: ModyConnectorDefinition): string {
  if (definition.priority === "research") {
    return "공식 정책 확인 전까지 자동 실행에 연결하지 않습니다.";
  }
  if (definition.riskLabel === "high") {
    return "외부 발송, 일정 등록, 문자 발송, 재고 수정, 파일 쓰기, OS 조작은 승인 후 실행 범위로만 켭니다.";
  }
  return "읽기와 초안 중심으로 먼저 연결하고, 실행 권한은 별도로 확인합니다.";
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
