"use client";

import type { AITeammateTeam } from "./ai-teammates";

export type AISkillCategory = "memory" | "research" | "automation" | "documents" | "communication" | "safety";

export type AISkillPack = {
  id: string;
  title: string;
  category: AISkillCategory;
  summary: string;
  instructions: string[];
  crewKitLabel?: string;
  installHint?: string;
  triggerKeywords?: string[];
  connectorIds?: string[];
  recommendedTeam?: AITeammateTeam;
  activationSteps?: string[];
  fallbackRoutes?: string[];
  externalToolHints?: string[];
};

export type AISkillRecommendation = {
  skill: AISkillPack;
  score: number;
  reasons: string[];
  nextAction: string;
  recommendedTeam: AITeammateTeam;
  connectorIds: string[];
  activationSteps: string[];
  fallbackRoutes: string[];
  externalToolHints: string[];
};

export type BundledPluginCard = {
  id: string;
  label: string;
  summary: string;
  category: "desktop" | "documents" | "communication" | "knowledge" | "business" | "finance" | "design" | "development";
  defaultEnabled: boolean;
  connectorIds: string[];
  crewKitIds: string[];
  recommendedTeam: AITeammateTeam;
  boundary: "read_first" | "draft_first" | "approval_required";
  fallbackRoutes: string[];
};

const storageKey = "modycrew-ai-skills-v1";
const activeStorageKey = "modycrew-active-ai-skills-v1";

export const defaultCoreAISkillIds = [
  "portable_memory",
  "self_growth_contract",
  "adaptive_agent_runtime",
  "work_pattern_learning",
  "connector_discovery",
  "approval_guard",
  "parallel_team_routing",
  "skill_bridge_orchestrator",
  "computer_use_operator",
];

export const defaultBundledPluginCards: BundledPluginCard[] = [
  {
    id: "plugin-computer-use",
    label: "내 PC 작업 도우미",
    summary: "Windows 앱, 열린 창, 최근 파일을 읽기 중심으로 확인하고 실행 후보는 오피스 승인함에 올립니다.",
    category: "desktop",
    defaultEnabled: true,
    connectorIds: ["desktop-bridge"],
    crewKitIds: ["computer_use_operator"],
    recommendedTeam: "desktop",
    boundary: "approval_required",
    fallbackRoutes: ["공식 연결", "계정 보관함", "앱 위치", "내 PC 작업 도우미 읽기"],
  },
  {
    id: "plugin-chrome",
    label: "Chrome",
    summary: "브라우저 화면 확인, 사이트 읽기, 링크 점검을 내 PC 작업 도우미와 연결합니다.",
    category: "desktop",
    defaultEnabled: true,
    connectorIds: ["desktop-bridge"],
    crewKitIds: ["computer_use_operator", "connector_discovery"],
    recommendedTeam: "desktop",
    boundary: "approval_required",
    fallbackRoutes: ["사이트 링크 저장", "계정 보관함", "읽기 전용 화면 확인"],
  },
  {
    id: "plugin-spreadsheets",
    label: "표/정산 자료",
    summary: "Excel, Google Sheets, 정산표, 운영표를 읽고 보고서/정리 후보로 연결합니다.",
    category: "documents",
    defaultEnabled: true,
    connectorIds: ["google-drive", "local-folder-index"],
    crewKitIds: ["document_writer", "workspace_knowledge"],
    recommendedTeam: "finance",
    boundary: "draft_first",
    fallbackRoutes: ["로컬 Excel 읽기", "Google Drive 연결", "CSV 내보내기"],
  },
  {
    id: "plugin-presentations",
    label: "발표자료",
    summary: "PPT, 제안서, 발표자료 초안을 자료 근거와 함께 만듭니다.",
    category: "documents",
    defaultEnabled: true,
    connectorIds: ["local-folder-index", "google-drive"],
    crewKitIds: ["presentation_deck", "document_writer"],
    recommendedTeam: "marketing",
    boundary: "draft_first",
    fallbackRoutes: ["PPTX 생성", "Canva/Figma 연결", "기존 발표자료 학습"],
  },
  {
    id: "plugin-github",
    label: "개발 업무",
    summary: "코딩 요청, 수정 기록, 검증 결과, 배포 전 확인을 담당자 채널과 작업 도우미 기능으로 연결합니다.",
    category: "development",
    defaultEnabled: true,
    connectorIds: ["github", "local-cli-tools"],
    crewKitIds: ["codex_cli_workbench"],
    recommendedTeam: "development",
    boundary: "approval_required",
    fallbackRoutes: ["개발 계정 연결", "개발 업무 확인", "작업 폴더 상태 확인"],
  },
  {
    id: "plugin-slack",
    label: "Slack",
    summary: "Slack 메시지를 읽고 승인, 회신 초안, 업무 알림을 AI 팀원 흐름으로 라우팅합니다.",
    category: "communication",
    defaultEnabled: true,
    connectorIds: ["slack-app"],
    crewKitIds: ["workspace_knowledge", "connector_discovery"],
    recommendedTeam: "operations",
    boundary: "approval_required",
    fallbackRoutes: ["Slack 계정 연결", "메신저 연결", "메신저 승인함"],
  },
  {
    id: "plugin-gmail",
    label: "Gmail",
    summary: "메일함을 읽고 답장 초안, 일정 후보, 업무 분류를 메일 점검 승인 흐름으로 보냅니다.",
    category: "communication",
    defaultEnabled: true,
    connectorIds: ["gmail"],
    crewKitIds: ["mail_calendar_operator"],
    recommendedTeam: "mail",
    boundary: "approval_required",
    fallbackRoutes: ["Gmail 계정 연결", "회사 메일 읽기", "계정 보관함"],
  },
  {
    id: "plugin-google-calendar",
    label: "Google Calendar",
    summary: "일정, 가능한 시간, 미팅 후보를 읽고 등록은 최종 승인 뒤로 둡니다.",
    category: "communication",
    defaultEnabled: true,
    connectorIds: ["google-calendar"],
    crewKitIds: ["mail_calendar_operator"],
    recommendedTeam: "mail",
    boundary: "approval_required",
    fallbackRoutes: ["Google 계정 연결", "캘린더 읽기", "일정 등록 최종 확인"],
  },
  {
    id: "plugin-google-drive",
    label: "Google Drive",
    summary: "Docs, Sheets, Slides 자료를 선택 범위 안에서 읽고 회사 지식으로 정리합니다.",
    category: "knowledge",
    defaultEnabled: true,
    connectorIds: ["google-drive"],
    crewKitIds: ["workspace_knowledge", "document_writer"],
    recommendedTeam: "personal",
    boundary: "read_first",
    fallbackRoutes: ["Drive 계정 연결", "로컬 다운로드 폴더", "출처별 샘플링"],
  },
  {
    id: "plugin-notion",
    label: "Notion",
    summary: "스펙, 회의록, 리서치 문서를 읽고 업무 지식과 실행 계획으로 바꿉니다.",
    category: "knowledge",
    defaultEnabled: true,
    connectorIds: ["notion-workspace"],
    crewKitIds: ["workspace_knowledge", "document_writer"],
    recommendedTeam: "personal",
    boundary: "read_first",
    fallbackRoutes: ["Notion 계정 연결", "페이지 링크", "로컬 내보내기"],
  },
  {
    id: "plugin-data-analytics",
    label: "데이터 분석",
    summary: "표, 지표, 운영 데이터를 분석해 오피스 의사결정 카드와 보고서로 만듭니다.",
    category: "business",
    defaultEnabled: true,
    connectorIds: ["google-drive", "local-folder-index"],
    crewKitIds: ["workspace_knowledge", "document_writer"],
    recommendedTeam: "finance",
    boundary: "draft_first",
    fallbackRoutes: ["CSV/Excel", "Google Sheets", "분석 보고서 초안"],
  },
  {
    id: "plugin-product-design",
    label: "제품 디자인",
    summary: "아이디어, 화면 흐름, 프로토타입 검토를 마케팅/개발 AI 팀원과 연결합니다.",
    category: "design",
    defaultEnabled: true,
    connectorIds: ["figma-design"],
    crewKitIds: ["presentation_deck", "workspace_knowledge"],
    recommendedTeam: "marketing",
    boundary: "draft_first",
    fallbackRoutes: ["Figma", "Canva", "화면 캡처 기반 리뷰"],
  },
  {
    id: "plugin-sales",
    label: "영업 업무",
    summary: "고객 문의, 미팅 준비, 후속 메일, 영업 흐름 정리를 메일 점검과 문서 작성으로 연결합니다.",
    category: "business",
    defaultEnabled: true,
    connectorIds: ["gmail", "google-calendar", "slack-app"],
    crewKitIds: ["mail_calendar_operator", "document_writer"],
    recommendedTeam: "mail",
    boundary: "approval_required",
    fallbackRoutes: ["메일/캘린더", "CRM 링크", "오피스 승인함"],
  },
  {
    id: "plugin-investing",
    label: "투자 리서치",
    summary: "상장사 리서치, 자료 요약, 투자 메모 초안을 근거 중심으로 준비합니다.",
    category: "finance",
    defaultEnabled: true,
    connectorIds: ["google-drive", "local-folder-index"],
    crewKitIds: ["workspace_knowledge", "document_writer"],
    recommendedTeam: "finance",
    boundary: "draft_first",
    fallbackRoutes: ["자료 링크", "로컬 리서치 폴더", "투자 메모 초안"],
  },
  {
    id: "plugin-teams",
    label: "Teams",
    summary: "Teams 대화와 회의 후속 업무를 메신저 승인, 메일, 일정 흐름으로 연결합니다.",
    category: "communication",
    defaultEnabled: false,
    connectorIds: ["teams"],
    crewKitIds: ["connector_discovery", "mail_calendar_operator"],
    recommendedTeam: "mail",
    boundary: "approval_required",
    fallbackRoutes: ["Microsoft 계정 연결", "회의록 파일", "수동 승인 카드"],
  },
  {
    id: "plugin-sharepoint",
    label: "SharePoint",
    summary: "회사 문서 저장소를 선택 범위 안에서 읽고 업무 지식으로 가져옵니다.",
    category: "knowledge",
    defaultEnabled: false,
    connectorIds: ["sharepoint"],
    crewKitIds: ["workspace_knowledge"],
    recommendedTeam: "personal",
    boundary: "read_first",
    fallbackRoutes: ["Microsoft 계정 연결", "로컬 동기화 폴더", "문서 범위 선택"],
  },
  {
    id: "plugin-outlook-email",
    label: "Outlook Email",
    summary: "Outlook 메일과 Microsoft 365 업무 후보를 메일 점검 승인 흐름으로 연결합니다.",
    category: "communication",
    defaultEnabled: false,
    connectorIds: ["outlook-mail", "outlook-calendar"],
    crewKitIds: ["mail_calendar_operator"],
    recommendedTeam: "mail",
    boundary: "approval_required",
    fallbackRoutes: ["Microsoft 계정 연결", "회사 관리자 승인", "회사 메일 읽기"],
  },
];

export const defaultAISkillPacks: AISkillPack[] = [
  {
    id: "portable_memory",
    title: "휴대용 기억",
    category: "memory",
    summary: "대화, 팀원, 업무 지침을 로컬 폴더에 저장해 다른 PC에서도 복원합니다.",
    instructions: [
      "중요한 설정은 로컬 기억 저장소에 사람이 읽을 수 있는 요약과 JSON 원본을 함께 남깁니다.",
      "컴퓨터가 바뀌면 같은 폴더를 기억 저장소로 선택해 팀원과 대화 맥락을 복원합니다.",
    ],
    recommendedTeam: "desktop",
    activationSteps: ["기억 저장 폴더 선택", "AI 팀원 업무 방식과 답변 기억 생성", "복원 진단 실행"],
    fallbackRoutes: ["기억 폴더를 직접 선택", "기존 ModyCrew_Local_Data 폴더 가져오기"],
  },
  {
    id: "self_growth_contract",
    title: "도구 추천 기준",
    crewKitLabel: "업무 도구 추천",
    category: "memory",
    summary: "반복 업무에서 필요한 업무 도구를 추천하고 사용자가 켠 도구만 다음 답변과 새 PC 이어쓰기에 반영합니다.",
    installHint: "스스로 성장, 기능 발전, 기억 복원, 새 PC 이전 요청이 나오면 이 계약을 먼저 설명하고 진단합니다.",
    triggerKeywords: ["스스로", "성장", "기능 발전", "복원", "새 pc", "새 컴퓨터", "기억 폴더", "skillgrowth"],
    instructions: [
      "AI가 임의로 앱을 바꾸지 않고 관찰, 추천, 사용자 확인, 활성화, 로컬 장부 기록 순서로만 기능을 늘립니다.",
      "활성화한 기능, 담당 AI 팀원, 외부 기능 후보는 기능 목록과 개선 기록에 남깁니다.",
      "비밀번호, 로그인 승인 원문, 직접 연결 키 원문은 저장하지 않고 새 PC에서는 보관함, 공식 로그인, 내 PC 작업 도우미 권한을 다시 승인합니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["반복 업무 신호 확인", "업무 도구와 외부 연결 추천", "사용자 확인 후 활성화", "이어쓰기 장부 저장"],
    fallbackRoutes: ["앱 기본 업무 도구", "외부 연결 후보", "계정 보관함", "내 PC 읽기 모드"],
    externalToolHints: ["외부 연결", "로컬 도구", "내 PC 읽기 모드"],
  },
  {
    id: "adaptive_agent_runtime",
    title: "스스로 개선하는 업무 비서 기반",
    crewKitLabel: "내 업무 방식 학습",
    category: "memory",
    summary: "지난 업무, 저장한 방식, 연결 상태, 업무팩 결과를 바탕으로 다음 처리 방식을 제안하고 사용자가 확인한 것만 저장합니다.",
    installHint: "에이전트, 기억, 스스로 발전, 업무팩 개선, 자동화 자유도 요청이 나오면 이 기반을 내부 기본값으로 유지합니다.",
    triggerKeywords: ["에이전트", "기억", "스스로", "발전", "자기개선", "업무팩", "자유도", "헤르메스", "오픈클로"],
    connectorIds: ["desktop-bridge", "local-folder-index", "public-trigger-relay"],
    instructions: [
      "사용자에게는 쉬운 업무 기능만 보여주고 내부에서는 기억, 업무팩, 도구, 승인 경계를 함께 준비합니다.",
      "완료된 업무에서 반복 신호를 찾되 저장과 개선 반영은 사용자가 누른 뒤에만 확정합니다.",
      "외부 발송, 일정 등록, 파일 변경, 제출, 공유, 삭제는 오피스 승인함 전까지 실행하지 않습니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["기억 저장 폴더 확인", "업무 방식 신호 관찰", "업무팩 개선 후보 만들기", "사용자 확인 후 저장"],
    fallbackRoutes: ["기본 업무 도구", "기억 폴더 선택", "연결된 업무 통로", "오피스 승인함"],
    externalToolHints: ["내 업무 방식 학습", "반복 업무 만들기", "AI 팀원", "승인 전 실행 잠금"],
  },
  {
    id: "work_pattern_learning",
    title: "업무 패턴 학습",
    category: "memory",
    summary: "반복 요청과 파일 흐름에서 사용자의 일하는 방식을 정리합니다.",
    instructions: [
      "반복되는 요청, 자주 쓰는 파일, 승인 기준을 발견하면 반복 업무 후보로 제안합니다.",
      "자동 실행은 하지 않고 먼저 사용자가 이해할 수 있는 규칙 설명을 만듭니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["업무 결과 저장", "반복 신호 추출", "기능 개선 제안 생성"],
  },
  {
    id: "connector_discovery",
    title: "필요 연결 탐색",
    category: "communication",
    summary: "업무 요청에 필요한 메일, 캘린더, 메신저, 외부 사이트 연결을 분리합니다.",
    instructions: [
      "사용자 요청에서 필요한 외부 연결과 아직 없는 연결을 구분합니다.",
      "아이디와 비밀번호는 채팅 대신 외부 계정 보관함으로 안내합니다.",
    ],
    recommendedTeam: "mail",
    activationSteps: ["필요 연결 식별", "연결 가이드 열기", "보관함 또는 공식 로그인으로 저장"],
    fallbackRoutes: ["공식 연결", "외부 계정 보관함", "사이트 링크와 내 PC 읽기 모드"],
  },
  {
    id: "document_context",
    title: "자료 맥락화",
    category: "documents",
    summary: "파일과 폴더를 업무 맥락으로 요약하고 팀원별로 필요한 근거를 붙입니다.",
    instructions: [
      "첨부 파일은 사용자가 분석을 요청했을 때만 내용을 판단합니다.",
      "파일 요약은 원본 경로, 판단 근거, 확인 필요 항목을 분리합니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["파일/폴더 선택", "형식과 미리보기 추출", "출처별 요약 저장"],
    fallbackRoutes: ["로컬 파일 선택", "여러 폴더 인덱싱", "읽기 실패 파일은 추후 수동 연결"],
  },
  {
    id: "approval_guard",
    title: "승인 보호",
    category: "safety",
    summary: "발송, 등록, 삭제, 결제, 제출 같은 외부 변경을 사용자 승인 뒤로 미룹니다.",
    instructions: [
      "외부 발송, 일정 등록, 파일 삭제, 결제, 제출은 최종 승인 전 실행하지 않습니다.",
      "승인 전에는 초안, 후보, 점검 결과까지만 만듭니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["위험 작업 감지", "승인 후보 카드 생성", "최종 확인 뒤 실행"],
  },
  {
    id: "parallel_team_routing",
    title: "팀원 분배",
    category: "automation",
    summary: "요청을 운영, 메일, 바탕화면, 마케팅, 개발, 재무, 법무 팀원에게 나눌 수 있게 정리합니다.",
    instructions: [
      "한 요청 안에 여러 성격의 일이 있으면 팀원별로 분리할 수 있는 실행 계획을 제안합니다.",
      "각 팀원 채널의 대화와 실행 기록을 섞지 않습니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["역할 분류", "필요 AI 팀원 생성", "업무 기록과 팀원 업무 방식 분리 저장"],
  },
  {
    id: "skill_bridge_orchestrator",
    title: "기능 연결",
    crewKitLabel: "업무 도구 추천",
    category: "automation",
    summary: "앱 기본 업무 도구와 외부 연결 후보, 내 PC 작업 도우미 후보를 연결해 업무 흐름을 단계적으로 확장합니다.",
    installHint: "사용자가 새 기능, 외부 도구, 자동화 확장을 원하면 먼저 추천하고 필요한 권한만 열어줍니다.",
    triggerKeywords: ["스킬", "성장", "기능", "외부 기능", "플러그인", "mcp", "cli", "computer use", "컴퓨터 유즈", "도구"],
    connectorIds: ["desktop-bridge", "local-cli-tools", "public-trigger-relay"],
    instructions: [
      "새 기능은 관찰, 추천, 사용자 확인, 활성화, 로컬 장부 기록 순서로만 켭니다.",
      "외부 기능이 공식 연결로 막히면 계정 보관함, 앱 위치, 사이트 링크, 내 PC 작업 도우미 읽기 후보를 제안합니다.",
      "활성화한 업무 도구와 담당 AI 팀원, 필요한 연결은 도구 목록과 개선 기록에 남겨 새 PC에서 이어받게 합니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["요청 분석", "업무 도구와 외부 연결 후보 제안", "사용자 확인 후 활성화", "도구 개선 기록에 저장"],
    fallbackRoutes: ["공식 연결", "외부 연결 후보", "앱 위치", "사이트 링크", "내 PC 작업 도우미"],
    externalToolHints: ["외부 연결", "로컬 도구", "내 PC 읽기 모드"],
  },
  {
    id: "computer_use_operator",
    title: "컴퓨터 사용",
    crewKitLabel: "내 PC 작업 도우미",
    category: "automation",
    summary: "공식 연결이 막히는 Windows 앱, 브라우저, 최근 파일을 읽기 중심으로 관찰하고 실행 후보를 오피스 승인함에 올립니다.",
    installHint: "사용자가 앱 화면, 브라우저, 외부 사이트, 최근 파일, 자동 조작을 말하면 안전 모드로 추천합니다.",
    triggerKeywords: ["computer use", "컴퓨터 유즈", "컴퓨터 사용", "화면", "브라우저", "외부 사이트", "윈도우 앱", "최근 파일"],
    connectorIds: ["desktop-bridge"],
    instructions: [
      "기본은 관찰과 읽기이며, 클릭·입력·발송·삭제 같은 쓰기 작업은 오피스 최종 승인 전 실행하지 않습니다.",
      "공식 연결이 막히면 계정 보관함의 사이트 링크와 앱 위치를 참고해 내 PC 작업 도우미 읽기 후보로 넘깁니다.",
      "관찰 결과는 지난 업무 기억과 승인 후보 기록에 남겨 다음 대화와 업무 오피스에서 이어봅니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["안전 모드 확인", "열린 창/최근 파일 읽기", "업무 카드 후보 생성", "오피스 승인함 확인"],
    fallbackRoutes: ["공식 연결", "계정 보관함", "앱 위치", "사이트 링크", "내 PC 읽기 모드"],
    externalToolHints: ["내 PC 작업 도우미"],
  },
  {
    id: "document_writer",
    title: "문서 작성",
    crewKitLabel: "문서 작성 기능",
    category: "documents",
    summary: "Word, Excel, 보고서, 업무 메일 초안을 사용자가 일하던 형식에 맞춰 작성합니다.",
    installHint: "보고서, 워드, 엑셀, 메일 초안 요청이 나오면 추천합니다. 자료 학습과 함께 쓰면 형식 재현 정확도가 올라갑니다.",
    triggerKeywords: ["보고서", "워드", "word", "한글", "hwp", "엑셀", "excel", "메일쓰기", "답장", "문서"],
    connectorIds: ["local-folder-index", "gmail", "company-mail"],
    instructions: [
      "문서 작성 전 기존 양식, 반복 표현, 표 구조를 먼저 찾고 형식 기준으로 요약합니다.",
      "완성 문서는 초안으로 만들고 외부 발송이나 제출은 승인 전 실행하지 않습니다.",
    ],
    recommendedTeam: "desktop",
    activationSteps: ["기존 문서/보고서 양식 선택", "문체와 표 구조 학습", "초안 작성", "사용자 검토"],
    fallbackRoutes: ["로컬 문서 추출", "Word/Excel 생성", "메일 초안으로 넘기기"],
    externalToolHints: ["Documents", "Spreadsheets"],
  },
  {
    id: "presentation_deck",
    title: "PPT 제작",
    crewKitLabel: "발표 자료 기능",
    category: "documents",
    summary: "PPT 발표자료와 제안서 구성을 자료 근거와 함께 만듭니다.",
    installHint: "PPT, 발표, 제안서, IR, 강의자료 요청이 나오면 추천합니다.",
    triggerKeywords: ["ppt", "powerpoint", "발표", "제안서", "ir", "슬라이드", "강의자료"],
    instructions: [
      "슬라이드는 제목, 핵심 메시지, 근거 자료, 시각화 후보를 분리해 제안합니다.",
      "사용자의 기존 발표자료를 학습한 경우 같은 톤과 목차 리듬을 우선합니다.",
    ],
    recommendedTeam: "marketing",
    activationSteps: ["자료/목적 확인", "목차와 메시지 구성", "슬라이드 초안 생성", "검토 후 내보내기"],
    fallbackRoutes: ["PPTX 생성", "Canva/Figma 연결", "기존 발표자료 학습"],
    externalToolHints: ["Presentations", "Canva", "Figma"],
  },
  {
    id: "remotion_video",
    title: "영상 제작",
    crewKitLabel: "영상 제작 기능",
    category: "documents",
    summary: "Remotion 기반 영상, 쇼츠, 설명 영상 제작 워크플로를 제안합니다.",
    installHint: "영상, 쇼츠, 릴스, 애니메이션, 렌더링 요청이 나오면 Remotion/영상 제작 흐름을 추천합니다.",
    triggerKeywords: ["영상", "쇼츠", "릴스", "애니메이션", "remotion", "렌더", "동영상"],
    instructions: [
      "영상 요청은 스크립트, 장면 구성, 자막, 에셋, 렌더 검증으로 나눕니다.",
      "외부 게시나 업로드는 사용자 승인 뒤로 미룹니다.",
    ],
    recommendedTeam: "marketing",
    activationSteps: ["스크립트 작성", "장면/자막 구조화", "Remotion 프로젝트 준비", "렌더 검증"],
    fallbackRoutes: ["Remotion", "로컬 렌더", "업로드 전 승인"],
    externalToolHints: ["Remotion"],
  },
  {
    id: "codex_cli_workbench",
    title: "코딩 자동화",
    crewKitLabel: "작업 도우미 기능",
    category: "automation",
    summary: "코드 수정, 검증, 배포 전 확인 같은 개발 업무를 업무 채널에 연결합니다.",
    installHint: "코딩, 버그 수정, 배포, 작업 준비 요청이 나오면 추천합니다.",
    triggerKeywords: ["코딩", "개발", "버그", "git", "깃", "cli", "배포", "테스트", "코덱스"],
    connectorIds: ["local-cli-tools", "desktop-bridge"],
    instructions: [
      "코딩 작업은 변경 파일, 검증 명령, 위험도를 기록하고 사용자가 원하면 설치 도구를 준비합니다.",
      "삭제, 배포, 자격 증명 변경은 사용자 확인 전 실행하지 않습니다.",
    ],
    recommendedTeam: "development",
    activationSteps: ["작업 폴더 확인", "실행 준비 상태 점검", "변경과 검증 기록", "배포 전 확인"],
    fallbackRoutes: ["AI 답변 연결", "작업 도우미 준비", "작업 폴더 확인"],
    externalToolHints: ["작업 도우미", "작업 폴더", "검증 준비"],
  },
  {
    id: "mail_calendar_operator",
    title: "메일·일정 운영",
    crewKitLabel: "메일/일정 운영",
    category: "communication",
    summary: "메일함을 읽고 업무 분류, 답장 초안, 일정 후보, 승인 요청 흐름을 만듭니다.",
    installHint: "메일, 문의, 일정, 예약, 캘린더 자동화 요청이 나오면 추천합니다.",
    triggerKeywords: ["메일", "문의", "답장", "일정", "캘린더", "예약", "imap", "smtp"],
    connectorIds: ["gmail", "outlook-mail", "company-mail", "google-calendar", "outlook-calendar"],
    instructions: [
      "메일은 광고, 공지, 업무, 답장 필요, 일정 후보로 나눠 사용자에게 요약합니다.",
      "발송과 일정 등록은 메인 채널 또는 메신저 승인 뒤에도 앱 최종 확인을 거칩니다.",
    ],
    recommendedTeam: "operations",
    activationSteps: ["메일 연결", "메일함 1차 분석", "답장/일정 후보 생성", "메신저 또는 앱에서 승인"],
    fallbackRoutes: ["Gmail/Outlook 동의 연결", "회사 메일 연결", "사이트 링크와 보관함 계정", "내 PC 읽기 모드"],
    externalToolHints: ["Gmail", "Google Calendar", "Outlook"],
  },
  {
    id: "folder_organizer",
    title: "폴더 정리",
    crewKitLabel: "폴더 정리",
    category: "automation",
    summary: "중복 파일, 프로젝트별 폴더, 날짜별 정리 후보를 만들고 삭제는 승인 뒤로 둡니다.",
    installHint: "폴더 정리, 중복 파일 삭제, 프로젝트 분류 요청이 나오면 추천합니다.",
    triggerKeywords: ["폴더", "정리", "중복", "삭제", "분류", "바탕화면", "다운로드"],
    connectorIds: ["local-folder-index", "desktop-bridge"],
    instructions: [
      "정리 전 현재 구조를 읽고 프로젝트별, 날짜별, 파일종류별 후보안을 비교합니다.",
      "파일 이동과 삭제는 실행 후보만 만들고 사용자 승인 전 원본을 바꾸지 않습니다.",
    ],
    recommendedTeam: "operations",
    activationSteps: ["폴더/드라이브 선택", "중복/프로젝트/날짜 후보 분석", "실행 전 검토", "최종 승인 후 이동/삭제"],
    fallbackRoutes: ["로컬 폴더 선택", "여러 폴더 인덱싱", "삭제 전 실행 전 검토"],
  },
  {
    id: "workspace_knowledge",
    title: "회사 지식 연결",
    crewKitLabel: "자료 학습",
    category: "research",
    summary: "Google Sheets, Slack, Notion, 로컬 폴더의 업무 지식을 선택 연결해 학습합니다.",
    installHint: "회사 자료, 노션, 슬랙, 구글시트, 업무 지식 학습 요청이 나오면 추천합니다.",
    triggerKeywords: ["노션", "notion", "슬랙", "slack", "구글시트", "google sheets", "회사 자료", "지식", "학습"],
    connectorIds: ["notion-workspace", "slack-app", "google-drive", "local-folder-index"],
    instructions: [
      "초기 학습은 사용자가 선택한 범위에서만 읽고 출처별 요약, 반복 업무, 보안 경계를 분리합니다.",
      "대량 자료는 한 번에 결론내리지 않고 인덱스, 샘플링, 검증 질문 순서로 진행합니다.",
    ],
    recommendedTeam: "personal",
    activationSteps: ["연결할 출처 선택", "인덱스와 샘플 요약", "반복 업무/보안 경계 추출", "팀원 업무 방식과 지난 업무 기억에 저장"],
    fallbackRoutes: ["Google Drive/Sheets", "Slack", "Notion", "로컬 폴더"],
    externalToolHints: ["Google Drive", "Slack", "Notion"],
  },
];

export function readAISkillPacks(): AISkillPack[] {
  if (typeof window === "undefined") return defaultAISkillPacks;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return normalizeAISkillPacks(parsed);
  } catch {
    return defaultAISkillPacks;
  }
}

export function saveAISkillPacks(skills: AISkillPack[]) {
  if (typeof window === "undefined") return;
  const custom = skills.filter((skill) => !defaultAISkillPacks.some((item) => item.id === skill.id));
  window.localStorage.setItem(storageKey, JSON.stringify(custom));
}

export function readActiveAISkillIds(): string[] {
  if (typeof window === "undefined") return defaultActiveAISkillIds();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(activeStorageKey) ?? "[]");
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultActiveAISkillIds();
    const validIds = new Set(readAISkillPacks().map((skill) => skill.id));
    return normalizeActiveAISkillIds(parsed.map(String).filter((id) => validIds.has(id)).slice(0, 24));
  } catch {
    return defaultActiveAISkillIds();
  }
}

export function saveActiveAISkillIds(skillIds: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(activeStorageKey, JSON.stringify(normalizeActiveAISkillIds(skillIds)));
}

export function buildAISkillPromptContext(skills: AISkillPack[], activeSkillIds: string[]) {
  const active = skills.filter((skill) => activeSkillIds.includes(skill.id));
  if (!active.length) return "";
  // 스킬당 한 줄(제목: 요약)만 주입합니다. 전체 지침 본문을 모두 넣으면 프롬프트가
  // 카탈로그처럼 비대해져 모델이 기능 나열로 답하는 원인이 됩니다. 상세 행동 지침은
  // 답변 규칙과 핵심 지침(modyAssistantInstructions)이 담당합니다.
  return [
    "[활성 스킬]",
    ...active.map((skill) => `- ${skill.title}: ${skill.summary}`),
  ].join("\n");
}

export function normalizeAISkillPacks(value: unknown): AISkillPack[] {
  const custom = Array.isArray(value) ? value.map(sanitizeSkillPack).filter(Boolean) as AISkillPack[] : [];
  return mergeSkillPacks(defaultAISkillPacks, custom);
}

export function normalizeActiveAISkillIds(skillIds: unknown): string[] {
  const source = Array.isArray(skillIds) ? skillIds : [];
  const normalized = source.map((id) => sanitizeId(id)).filter(Boolean).slice(0, 40);
  if (!normalized.length) return defaultActiveAISkillIds();
  const defaultIds = defaultAISkillPacks.map((skill) => skill.id);
  const legacyAllDefaultActive =
    normalized.length >= defaultIds.length && defaultIds.every((id) => normalized.includes(id));
  return legacyAllDefaultActive ? defaultActiveAISkillIds() : normalized;
}

export function defaultActiveAISkillIds() {
  const validIds = new Set(defaultAISkillPacks.map((skill) => skill.id));
  return defaultCoreAISkillIds.filter((id) => validIds.has(id));
}

export function recommendAISkillPacks(text: string, skills: AISkillPack[] = defaultAISkillPacks) {
  return recommendAISkillPacksDetailed(text, skills).map((item) => item.skill);
}

export function recommendAISkillPacksDetailed(
  text: string,
  skills: AISkillPack[] = defaultAISkillPacks,
  activeSkillIds: string[] = [],
): AISkillRecommendation[] {
  const lower = text.toLowerCase();
  const active = new Set(activeSkillIds);
  return skills
    .map((skill) => {
      const matchedKeywords = (skill.triggerKeywords ?? []).filter((keyword) =>
        lower.includes(keyword.toLowerCase()),
      );
      const intentScore = scoreSkillIntent(lower, skill);
      const score = matchedKeywords.length * 3 + intentScore + (active.has(skill.id) ? -4 : 0);
      const visibleMatchedKeywords = matchedKeywords
        .map((keyword) => userFacingSkillText(keyword))
        .filter(Boolean)
        .filter((keyword, index, list) => list.indexOf(keyword) === index);
      const reasons = [
        visibleMatchedKeywords.length ? `요청 안의 신호: ${visibleMatchedKeywords.slice(0, 4).join(", ")}` : "",
        intentScore > 0 ? categoryReason(skill.category) : "",
        skill.installHint ? userFacingSkillText(skill.installHint) : "",
      ].filter(Boolean).slice(0, 3);
      return {
        skill,
        score,
        reasons,
        nextAction: createSkillNextAction(skill),
        recommendedTeam: skill.recommendedTeam ?? teamForSkill(skill),
        connectorIds: [...(skill.connectorIds ?? [])],
        activationSteps: (skill.activationSteps ?? defaultActivationSteps(skill)).map((step) => userFacingSkillText(step)),
        fallbackRoutes: (skill.fallbackRoutes ?? defaultFallbackRoutes(skill)).map((route) => userFacingSkillText(route)),
        externalToolHints: (skill.externalToolHints ?? []).map((hint) => userFacingSkillText(hint)),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

export function mergeSkillPacks(base: AISkillPack[], incoming: AISkillPack[]) {
  const byId = new Map<string, AISkillPack>();
  for (const skill of [...base, ...incoming]) byId.set(skill.id, skill);
  return [...byId.values()];
}

function sanitizeSkillPack(value: unknown): AISkillPack | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AISkillPack>;
  const id = sanitizeId(item.id);
  if (!id) return null;
  return {
    id,
    title: sanitizeText(item.title, "사용자 스킬", 48),
    category: sanitizeCategory(item.category),
    summary: sanitizeText(item.summary, "사용자가 추가한 업무 스킬입니다.", 180),
    instructions: Array.isArray(item.instructions)
      ? item.instructions.map((line) => sanitizeText(line, "", 180)).filter(Boolean).slice(0, 10)
      : [],
    crewKitLabel: item.crewKitLabel ? sanitizeText(item.crewKitLabel, "", 48) : undefined,
    installHint: item.installHint ? sanitizeText(item.installHint, "", 220) : undefined,
    triggerKeywords: Array.isArray(item.triggerKeywords)
      ? item.triggerKeywords.map((line) => sanitizeText(line, "", 40)).filter(Boolean).slice(0, 24)
      : undefined,
    connectorIds: Array.isArray(item.connectorIds)
      ? item.connectorIds.map((line) => sanitizeId(line)).filter(Boolean).slice(0, 12)
      : undefined,
    recommendedTeam: sanitizeTeam(item.recommendedTeam),
    activationSteps: sanitizeTextList(item.activationSteps, 8, 120),
    fallbackRoutes: sanitizeTextList(item.fallbackRoutes, 8, 80),
    externalToolHints: sanitizeTextList(item.externalToolHints, 8, 60),
  };
}

function sanitizeId(value: unknown) {
  return String(value ?? "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
}

function sanitizeCategory(value: unknown): AISkillCategory {
  if (
    value === "memory" ||
    value === "research" ||
    value === "automation" ||
    value === "documents" ||
    value === "communication" ||
    value === "safety"
  ) {
    return value;
  }
  return "automation";
}

function sanitizeTeam(value: unknown): AITeammateTeam | undefined {
  if (
    value === "operations" ||
    value === "mail" ||
    value === "desktop" ||
    value === "marketing" ||
    value === "development" ||
    value === "finance" ||
    value === "legal" ||
    value === "personal"
  ) {
    return value;
  }
  return undefined;
}

function sanitizeTextList(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    ? value.map((line) => sanitizeText(line, "", maxLength)).filter(Boolean).slice(0, maxItems)
    : undefined;
}

function sanitizeText(value: unknown, fallback: string, maxLength: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text || fallback;
}

function scoreSkillIntent(lower: string, skill: AISkillPack) {
  const byCategory: Record<AISkillCategory, RegExp> = {
    memory: /기억|저장|복원|컴퓨터\s*바꿔|d드라이브|드라이브|학습|세팅/u,
    research: /자료|회사|노션|슬랙|시트|지식|검색|분석|학습/u,
    automation: /자동화|반복|정리|코딩|배포|실행|도구|cli|컴퓨터/u,
    documents: /보고서|문서|ppt|제안서|영상|메일\s*초안|워드|엑셀/u,
    communication: /메일|메신저|텔레그램|슬랙|디스코드|일정|캘린더|문의|답장/u,
    safety: /승인|보안|삭제|발송|제출|결제|계약|세무/u,
  };
  return byCategory[skill.category].test(lower) ? 2 : 0;
}

function categoryReason(category: AISkillCategory) {
  const labels: Record<AISkillCategory, string> = {
    memory: "기억/복원 흐름이 필요한 요청입니다.",
    research: "회사 자료나 외부 지식 연결이 필요한 요청입니다.",
    automation: "반복 실행이나 로컬 도구 연결이 필요한 요청입니다.",
    documents: "문서/자료 결과가 필요한 요청입니다.",
    communication: "메일, 일정, 메신저 연결이 필요한 요청입니다.",
    safety: "사용자 승인 경계를 먼저 세워야 하는 요청입니다.",
  };
  return labels[category];
}

function createSkillNextAction(skill: AISkillPack) {
  const firstStep = skill.activationSteps?.[0] ?? defaultActivationSteps(skill)[0];
  return `${userFacingSkillLabel(skill)}을 켜고 ${userFacingSkillText(firstStep)}부터 진행합니다.`;
}

function teamForSkill(skill: AISkillPack): AITeammateTeam {
  if (skill.id === "mail_calendar_operator") return "mail";
  if (skill.id === "folder_organizer" || skill.id === "computer_use_operator") return "desktop";
  if (skill.category === "communication") return "operations";
  if (skill.id.includes("video") || skill.id.includes("deck")) return "marketing";
  if (skill.id.includes("codex") || skill.id.includes("cli")) return "development";
  if (skill.category === "safety") return "personal";
  return "personal";
}

function defaultActivationSteps(skill: AISkillPack) {
  return [
    `${userFacingSkillLabel(skill)} 활성화`,
    "필요 연결과 권한 확인",
    "기능 목록과 개선 기록에 저장",
  ];
}

function defaultFallbackRoutes(skill: AISkillPack) {
  if (skill.connectorIds?.length) return ["공식 연결 또는 계정 연결", "외부 계정 보관함", "내 PC 읽기 모드"];
  return ["앱 기본 업무 도구", "로컬 파일/폴더 선택", "사용자 승인 후 실행"];
}

function userFacingSkillLabel(skill: AISkillPack) {
  return userFacingSkillText(skill.crewKitLabel ?? skill.title) || "업무 도구";
}

function userFacingSkillText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\bSelfGrowth\b/giu, "업무 도구 추천")
    .replace(/\bSkillBridge\b/giu, "업무 도구 추천")
    .replace(/\bSkillGrowth\b/giu, "기능 개선 기록")
    .replace(/\bCrewKitIndex\b/giu, "기능 목록")
    .replace(/\bConversationDigest\b/giu, "대화 요약 기억")
    .replace(/\bPromptMemory\b/giu, "답변 기준 기억")
    .replace(/\bCrewSoul\b/giu, "AI 팀원 기억")
    .replace(/\bdry-run\b/giu, "실행 전 검토")
    .replace(/\bCrewKit\b/giu, "업무 도구")
    .replace(/\bCodex OAuth\b/giu, "AI 답변 연결")
    .replace(/\bCodex\b/giu, "작업 도우미")
    .replace(/\bOAuth\b/giu, "계정 연결")
    .replace(/\bmcp\b/giu, "외부 기능 연결")
    .replace(/\bCLI\b/giu, "작업 준비")
    .replace(/\bcomputer use\b/giu, "내 PC 작업")
    .replace(/컴퓨터\s*유즈/gu, "내 PC 작업")
    .replace(/플러그인/gu, "외부 기능")
    .replace(/\bskill file\b/giu, "기능 파일")
    .trim();
}
