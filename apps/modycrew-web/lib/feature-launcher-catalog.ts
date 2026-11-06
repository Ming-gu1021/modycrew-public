export type FeatureLauncherTier = "small" | "large";
export type FeatureLauncherSurface = "chat_dock" | "workspace_panel" | "single_setting";
export type FeatureLauncherRuntimeStatus = "runtime_connected" | "setup_only";
export type FeatureLauncherQualityStatus = "launch_ready" | "setup_only" | "hidden_until_proven" | "remove_or_rebuild";
export type FeatureLauncherExposureSurface =
  | "home_launcher"
  | "quick_dock"
  | "recent_history"
  | "single_setting"
  | "audit_only";
export type FeatureLauncherEvidenceLevel =
  | "runtime_smoke"
  | "browser_e2e"
  | "contract_guard"
  | "setup_guard"
  | "hidden_guard"
  | "rebuild_guard";
export type FeatureLauncherGoalDisposition =
  | "keep_launch_ready"
  | "keep_setup_only"
  | "hide_absorb_until_proven"
  | "remove_or_rebuild_until_proven";

export type FeatureLauncherCatalogItem = {
  id: string;
  userLabel: string;
  tier: FeatureLauncherTier;
  surface: FeatureLauncherSurface;
  routeRule: "short_chat_action" | "dedicated_workspace" | "single_setting_page";
  visibleInQuickDock: boolean;
  homeAction: string;
  runtimePath: string;
  runtimeProofLabel: string;
  verifyCommand: string;
  safetyGate: string;
  runtimeStatus: FeatureLauncherRuntimeStatus;
  qualityStatus: FeatureLauncherQualityStatus;
  qualityReason: string;
  evidenceLevel: FeatureLauncherEvidenceLevel;
  evidenceSummary: string;
  evidenceFiles?: readonly string[];
  resultBoundary?: string;
  nextUserChoice: string;
  blockedReason: string;
  supportedHomeActions?: readonly string[];
  replacementUserPath?: string;
  replacementFeatureId?: string;
  replacementHomeAction?: string;
};

export type FeatureLauncherReplacementReadiness =
  | {
      ready: true;
      replacement: FeatureLauncherCatalogItem;
      reason: "replacement_launch_ready";
    }
  | {
      ready: false;
      replacement: FeatureLauncherCatalogItem | null;
      reason:
        | "missing_replacement"
        | "replacement_not_found"
        | "replacement_not_launch_ready"
        | "replacement_action_mismatch";
    };

export const defaultChatDockFeatureIds = [
  "feature-mail",
  "feature-document-learning",
  "feature-today",
  "feature-tidy",
  "feature-schedule-prep",
  "feature-repeat-work",
  "feature-draft-report",
] as const;

// 홈 대표 7개: 일반 사용자의 첫 화면에는 검증된 실제 업무 단위만 둔다.
// AI 팀원/업무 오피스 같은 큰 작업실은 필요할 때 열림 영역으로 숨기고, setup_only/흡수/재구축 기능은 직접 올리지 않는다.
export const defaultHomeLauncherFeatureIds = [
  "feature-mail",
  "feature-document-learning",
  "feature-tidy",
  "feature-schedule-prep",
  "feature-draft-report",
  "feature-repeat-work",
  "feature-computer-use",
] as const;

export const openClawHermesClaimFeatureIds = defaultHomeLauncherFeatureIds;

export const featureLauncherCatalog = [
  {
    id: "feature-ai-memory",
    userLabel: "자료 분석",
    tier: "small",
    surface: "single_setting",
    routeRule: "single_setting_page",
    visibleInQuickDock: false,
    homeAction: "learn_files",
    runtimePath: "local memory and document learning setup",
    runtimeProofLabel: "자료 선택/기억 위치",
    verifyCommand: "npm run verify:local-memory-learning-sources",
    safetyGate: "원본 변경 없음",
    runtimeStatus: "setup_only",
    qualityStatus: "setup_only",
    qualityReason: "문서 학습 기능의 준비 단계로만 노출",
    evidenceLevel: "setup_guard",
    evidenceSummary: "자료 선택과 기억 위치 준비 단계만 확인",
    nextUserChoice: "문서 학습 또는 기억 위치 확인",
    blockedReason: "읽을 자료 위치나 기억 저장소가 아직 선택되지 않았을 수 있습니다.",
  },
  {
    id: "feature-vault",
    userLabel: "계정 보관함",
    tier: "small",
    surface: "single_setting",
    routeRule: "single_setting_page",
    visibleInQuickDock: false,
    homeAction: "external_accounts",
    runtimePath: "external account vault",
    runtimeProofLabel: "보안 입력",
    verifyCommand: "npm run verify:web-connect-guides",
    safetyGate: "비밀번호 대화 노출 금지",
    runtimeStatus: "setup_only",
    qualityStatus: "setup_only",
    qualityReason: "연결이 필요한 순간에만 필요 설정으로 노출",
    evidenceLevel: "setup_guard",
    evidenceSummary: "보안 입력 필요 설정 경로 확인",
    nextUserChoice: "메일 점검 또는 계정 보관함",
    blockedReason: "계정 보관함에 필요한 메일/일정 정보가 아직 저장되지 않았을 수 있습니다.",
  },
  {
    id: "feature-mail",
    userLabel: "메일 점검",
    tier: "small",
    surface: "single_setting",
    routeRule: "single_setting_page",
    visibleInQuickDock: true,
    homeAction: "mailops_check",
    runtimePath: "MailOps CrewKit -> connector handler -> approval queue",
    runtimeProofLabel: "업무 탭 메일 분석/승인함",
    verifyCommand: "npm run verify:mail-calendar-workflow",
    safetyGate: "발송/일정 등록 전 승인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "메일을 첫 진입 강제로 쓰지 않고 업무 탭의 선택 기능으로 유지",
    evidenceLevel: "runtime_smoke",
    evidenceSummary: "메일 읽기, 업무 방식 학습, 수신자/대량 발송 판단, 승인함 스모크로 확인",
    evidenceFiles: [],
    resultBoundary: "업무 탭에서 메일을 선택한 뒤 메일/일정 실행하기/고쳐달라고 하기/보류하기 카드와 실행 로그로 발송 전 상태 확인",
    nextUserChoice: "업무 탭에서 메일 점검, 계정 보관함, 또는 다른 업무 기능 선택",
    blockedReason: "메일 계정 연결, 2차 인증/앱 비밀번호, 계정 보관함 확인이 아직 남아 있을 수 있습니다.",
    supportedHomeActions: ["mailops_check", "mail_recipient_list_review"],
  },
  {
    id: "feature-document-learning",
    userLabel: "문서 학습",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: true,
    homeAction: "learn_files",
    runtimePath: "document learning desktop handler",
    runtimeProofLabel: "자료/초안 승인 후보",
    verifyCommand: "npm run verify:document-learning-desktop",
    safetyGate: "읽기 먼저, 원본 유지",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "문서 학습 대표 런처로 유지",
    evidenceLevel: "runtime_smoke",
    evidenceSummary: "문서 학습 데스크톱 핸들러 스모크로 자료 요약, 검색 인덱스, learnedOutputDrafts 승인 후보를 확인",
    evidenceFiles: [],
    resultBoundary: "문서 학습 결과 영수증과 초안 승인 후보로 확인",
    nextUserChoice: "자료 선택 또는 기억 위치 확인",
    blockedReason: "읽을 자료 위치를 아직 고르지 않았거나 설치 앱이 자료를 읽을 준비가 필요할 수 있습니다.",
  },
  {
    id: "feature-notify-assistant",
    userLabel: "업무 알림 비서",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: false,
    homeAction: "messenger_channels",
    runtimePath: "messenger decision loop",
    runtimeProofLabel: "앱 승인 채널",
    verifyCommand: "npm run verify:slack-decision-loop",
    safetyGate: "외부 알림 전 채널 확인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "hidden_until_proven",
    qualityReason: "오피스 승인함과 외부 알림 채널로 흡수, 별도 버튼은 중복되어 사용자 노출 후보에서도 제거",
    evidenceLevel: "hidden_guard",
    evidenceSummary: "승인 채널 흐름으로 흡수하고 단독 버튼 숨김",
    nextUserChoice: "오피스 승인함 또는 외부 알림 채널",
    blockedReason: "외부 알림 채널과 승인 대상이 확인되지 않으면 단독 알림 기능처럼 실행하지 않습니다.",
    replacementUserPath: "업무 오피스",
    replacementFeatureId: "feature-office",
    replacementHomeAction: "open_office",
  },
  {
    id: "feature-today",
    userLabel: "오늘 업무",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: true,
    homeAction: "today_check",
    runtimePath: "today ops verification and work schedule briefing",
    runtimeProofLabel: "오늘 브리핑",
    verifyCommand: "npm run verify:chat-feature-routing-browser",
    safetyGate: "요약만, 외부 변경 없음",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "오늘 업무 대표 런처로 유지",
    evidenceLevel: "browser_e2e",
    evidenceSummary: "오늘 업무 채팅 실행 브라우저 검증으로 확인",
    evidenceFiles: [],
    resultBoundary: "오늘 브리핑 카드와 오피스 승인 후보로 확인",
    nextUserChoice: "메일 연결 또는 오늘 오피스 확인",
    blockedReason: "오늘 업무에 쓸 메일, 일정, 오피스 후보가 아직 연결되지 않았을 수 있습니다.",
  },
  {
    id: "feature-tidy",
    userLabel: "폴더 정리",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: true,
    homeAction: "tidy_check",
    runtimePath: "folder selection -> folder plan -> dry-run/apply smoke -> Office approval queue",
    runtimeProofLabel: "정리 후보",
    verifyCommand: "npm run verify:folder-tidy-apply",
    safetyGate: "삭제 잠금, dry-run 먼저",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "폴더 정리 대표 런처로 유지",
    evidenceLevel: "runtime_smoke",
    evidenceSummary: "폴더 정리 dry-run/apply 스모크로 확인",
    evidenceFiles: [],
    resultBoundary: "정리 후보 영수증, 실행 로그, 되돌리기 안내로 확인",
    nextUserChoice: "폴더 선택 또는 오피스 승인함",
    blockedReason: "정리할 폴더 범위와 실행 전 검토가 아직 선택되지 않았을 수 있습니다.",
  },
  {
    id: "feature-schedule-prep",
    userLabel: "일정 준비",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: true,
    homeAction: "calendar_connection",
    runtimePath: "calendar_connection -> OAuth/freebusy read -> create_calendar_event final action gate -> Office approval queue",
    runtimeProofLabel: "일정 후보 승인 카드",
    verifyCommand: "npm run verify:calendar-final-action",
    safetyGate: "캘린더 등록·초대 발송·외부 공유 전 승인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "일정 준비 대표 런처로 유지",
    evidenceLevel: "runtime_smoke",
    evidenceSummary: "캘린더 최종 확인 스모크로 일정 등록 승인 경계 확인",
    evidenceFiles: [],
    resultBoundary: "일정 후보 카드와 등록 전 체크리스트로 확인",
    nextUserChoice: "캘린더 연결 또는 승인함 확인",
    blockedReason: "캘린더 연결이나 일정 근거 확인이 아직 남아 있을 수 있습니다.",
  },
  {
    id: "feature-repeat-work",
    userLabel: "반복 업무 만들기",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: true,
    homeAction: "repeat_work_save_draft",
    runtimePath: "repeat work sentence builder -> local automation draft/rule -> trigger runner -> Office approval queue -> execution log",
    runtimeProofLabel: "문장 빌더와 승인 후보",
    verifyCommand: "npm run verify:repeat-work-builder-browser",
    safetyGate: "기본 꺼짐, 사용자가 켠 규칙만 점검, 실행 전 승인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "반복 업무 대표 런처로 유지",
    evidenceLevel: "browser_e2e",
    evidenceSummary: "문장 빌더, 기본 꺼짐 규칙, 데스크톱 점검 결과, 승인 후보, 실행 로그를 브라우저 검증",
    evidenceFiles: [],
    resultBoundary: "반복 업무 점검 영수증과 실행 로그로 확인",
    nextUserChoice: "반복 후보 저장 또는 필요한 연결",
    blockedReason: "반복 업무 문장 후보가 아직 저장되지 않았거나 사용자가 켠 규칙이 없을 수 있습니다.",
    supportedHomeActions: ["automation_check", "repeat_work_builder", "repeat_work_save_draft"],
  },
  {
    id: "feature-delegation",
    userLabel: "역할 취합",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: false,
    homeAction: "merge_delegation_results",
    runtimePath: "CrewKit delegation artifact queue",
    runtimeProofLabel: "결과 취합",
    verifyCommand: "npm run verify:crewkit-memory",
    safetyGate: "초안/승인 카드로만 전환",
    runtimeStatus: "runtime_connected",
    qualityStatus: "hidden_until_proven",
    qualityReason: "AI 팀원/보고서 초안 흐름으로 흡수, 단독 버튼은 모호하여 사용자 노출 후보에서도 제거",
    evidenceLevel: "hidden_guard",
    evidenceSummary: "AI 팀원/보고서 초안으로 흡수하고 단독 버튼 숨김",
    nextUserChoice: "AI 팀원 또는 보고서 만들기",
    blockedReason: "역할별 결과와 취합 기준이 준비되지 않으면 단독 취합 버튼으로 실행하지 않습니다.",
    replacementUserPath: "AI 팀원",
    replacementFeatureId: "feature-workers",
    replacementHomeAction: "workers",
  },
  {
    id: "feature-draft-report",
    userLabel: "보고서 만들기",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: true,
    homeAction: "delegation_report_draft",
    runtimePath: "learn_files -> learned output artifacts -> report_draft_file approval work item",
    runtimeProofLabel: "보고서 초안 승인 후보",
    verifyCommand: "npm run verify:learned-output-artifacts",
    safetyGate: "DOCX/XLSX/Markdown 저장·공유·제출 전 승인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "보고서 만들기 대표 런처로 유지",
    evidenceLevel: "runtime_smoke",
    evidenceSummary: "학습 결과 스모크로 DOCX/XLSX/Markdown/적용 기록과 보고서 승인 후보 확인",
    evidenceFiles: [],
    resultBoundary: "보고서 초안 승인 카드와 로컬 저장 후보 위치로 확인",
    nextUserChoice: "문서 학습 또는 AI 팀원 결과",
    blockedReason: "보고서에 쓸 자료 범위가 아직 선택되지 않았을 수 있습니다.",
  },
  {
    id: "feature-draft-mail",
    userLabel: "메일 초안",
    tier: "small",
    surface: "chat_dock",
    routeRule: "short_chat_action",
    visibleInQuickDock: false,
    homeAction: "delegation_mail_draft",
    runtimePath: "delegation follow-up mail draft",
    runtimeProofLabel: "메일 초안 승인함",
    verifyCommand: "npm run verify:mailops-crewkit",
    safetyGate: "발송 전 승인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "hidden_until_proven",
    qualityReason: "메일 점검 대표 런처로 흡수, 별도 버튼은 중복되어 사용자 노출 후보에서도 제거",
    evidenceLevel: "hidden_guard",
    evidenceSummary: "메일 점검으로 흡수하고 단독 버튼 숨김",
    nextUserChoice: "메일 점검 또는 오피스 승인함",
    blockedReason: "메일 원문과 발송 승인 경계가 준비되지 않으면 메일 점검으로 흡수합니다.",
    replacementUserPath: "메일 점검",
    replacementFeatureId: "feature-mail",
    replacementHomeAction: "mailops_check",
  },
  {
    id: "feature-messengers",
    userLabel: "외부 알림 채널",
    tier: "large",
    surface: "workspace_panel",
    routeRule: "dedicated_workspace",
    visibleInQuickDock: false,
    homeAction: "messenger_channels",
    runtimePath: "Telegram/Slack/Discord connector handlers",
    runtimeProofLabel: "승인 알림 채널",
    verifyCommand: "npm run verify:messenger-commands",
    safetyGate: "채널 대상 저장 후 전송",
    runtimeStatus: "runtime_connected",
    qualityStatus: "hidden_until_proven",
    qualityReason: "외부 알림 채널은 오피스 승인함의 보조 연결로 흡수하고, 단독 기능처럼 보이면 지원 범위를 과장할 수 있어 사용자 노출 후보에서 제거",
    evidenceLevel: "hidden_guard",
    evidenceSummary: "오피스 승인함과 단일 연결 설정으로 흡수하고 단독 버튼 숨김",
    nextUserChoice: "오피스 승인함 또는 외부 알림 연결",
    blockedReason: "외부 알림 채널 대상이 확인되지 않으면 오피스 승인함의 보조 연결로만 다룹니다.",
    replacementUserPath: "업무 오피스",
    replacementFeatureId: "feature-office",
    replacementHomeAction: "open_office",
  },
  {
    id: "feature-crewkit",
    userLabel: "업무 도구 추천",
    tier: "large",
    surface: "workspace_panel",
    routeRule: "dedicated_workspace",
    visibleInQuickDock: false,
    homeAction: "skill_market",
    runtimePath: "AI skill recommendation and CrewKit memory",
    runtimeProofLabel: "업무 도구 추천",
    verifyCommand: "npm run verify:crewkit-memory",
    safetyGate: "사용자가 켠 도구만 활성",
    runtimeStatus: "runtime_connected",
    qualityStatus: "hidden_until_proven",
    qualityReason: "사용자 UI에는 기술 용어 대신 AI 팀원 작업실의 업무 도구 추천으로 흡수",
    evidenceLevel: "hidden_guard",
    evidenceSummary: "AI 팀원의 업무 도구 추천 흐름으로 흡수하고 기술 버튼 숨김",
    nextUserChoice: "AI 팀원 또는 업무 도구 추천",
    blockedReason: "사용자에게 필요한 업무 단위가 확인되기 전에는 기술형 도구 추천을 단독 실행하지 않습니다.",
    replacementUserPath: "AI 팀원",
    replacementFeatureId: "feature-workers",
    replacementHomeAction: "workers",
  },
  {
    id: "feature-workers",
    userLabel: "AI 팀원",
    tier: "large",
    surface: "workspace_panel",
    routeRule: "dedicated_workspace",
    visibleInQuickDock: false,
    homeAction: "workers",
    runtimePath: "AI teammate role channel orchestration",
    runtimeProofLabel: "AI 팀원",
    verifyCommand: "npm run verify:feature-launcher-quality-browser",
    safetyGate: "팀원별 업무 방식/작업 분리",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "AI 팀원 작업실로 유지",
    evidenceLevel: "browser_e2e",
    evidenceSummary: "AI 팀원 브라우저 검증으로 확인",
    evidenceFiles: [],
    resultBoundary: "AI 팀원 결과 카드와 오피스 승인함 handoff로 확인",
    nextUserChoice: "AI 팀원 만들기 또는 오피스 승인함",
    blockedReason: "AI 팀원이나 맡길 업무 범위가 아직 정해지지 않았을 수 있습니다.",
  },
  {
    id: "feature-office",
    userLabel: "업무 오피스",
    tier: "large",
    surface: "workspace_panel",
    routeRule: "dedicated_workspace",
    visibleInQuickDock: false,
    homeAction: "open_office",
    runtimePath: "OfficeBoard and desktop office window",
    runtimeProofLabel: "진행/승인함",
    verifyCommand: "npm run verify:office-visual-browser",
    safetyGate: "오피스 승인함에서 최종 잠금",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "업무 오피스 대표 작업실로 유지",
    evidenceLevel: "browser_e2e",
    evidenceSummary: "오피스 화면 브라우저 검증으로 진행, 승인함, 모바일 겹침 없음 확인",
    evidenceFiles: [],
    resultBoundary: "진행 상태, 승인함, 감사 기록으로 확인",
    nextUserChoice: "승인함 확인 또는 최근 작업 보기",
    blockedReason: "승인 대기 카드나 진행 중인 업무가 아직 없으면 먼저 업무를 맡겨야 합니다.",
  },
  {
    id: "feature-final-approval",
    userLabel: "최종 확인",
    tier: "large",
    surface: "workspace_panel",
    routeRule: "dedicated_workspace",
    visibleInQuickDock: false,
    homeAction: "delegation_approval_request",
    runtimePath: "Office approval queue and final action confirmation",
    runtimeProofLabel: "최종 확인",
    verifyCommand: "npm run verify:office-final-action-approval-browser",
    safetyGate: "외부 실행 전 사용자 확인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "hidden_until_proven",
    qualityReason: "최종 확인은 업무 오피스 승인함의 하위 안전 단계로 흡수하고, 단독 작업실 기능처럼 노출하지 않음",
    evidenceLevel: "hidden_guard",
    evidenceSummary: "오피스 승인함 최종 확인 흐름으로 흡수하고 단독 버튼 숨김",
    nextUserChoice: "오피스 승인함 또는 미리보기 다시 확인",
    blockedReason: "최종 확인할 승인 후보와 실행 전 미리보기가 아직 준비되지 않았을 수 있습니다.",
    replacementUserPath: "업무 오피스",
    replacementFeatureId: "feature-office",
    replacementHomeAction: "open_office",
  },
  {
    id: "feature-rules",
    userLabel: "기술형 반복 설정",
    tier: "large",
    surface: "workspace_panel",
    routeRule: "dedicated_workspace",
    visibleInQuickDock: false,
    homeAction: "automation_check",
    runtimePath: "local automation rules and trigger runner",
    runtimeProofLabel: "반복 점검",
    verifyCommand: "npm run verify:local-automation-rules",
    safetyGate: "기본 꺼짐, 실행 전 승인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "remove_or_rebuild",
    qualityReason: "기술형 반복 설정은 일반 사용자에게 복잡하고 반복 업무 빌더와 중복되어 단독 런처로는 제거",
    evidenceLevel: "rebuild_guard",
    evidenceSummary: "반복 업무 만들기로 대체하고 단독 런처 제거",
    nextUserChoice: "반복 업무 만들기",
    blockedReason: "기술형 반복 설정은 일반 사용자 흐름에서 제거하고 반복 업무 만들기로 대체합니다.",
    replacementUserPath: "반복 업무 만들기",
    replacementFeatureId: "feature-repeat-work",
    replacementHomeAction: "repeat_work_save_draft",
  },
  {
    id: "feature-computer-use",
    userLabel: "내 PC 작업 도우미",
    tier: "large",
    surface: "single_setting",
    routeRule: "single_setting_page",
    visibleInQuickDock: false,
    homeAction: "computer_use",
    runtimePath: "desktop control bridge safety mode -> list_windows/list_recent_files -> stage_file_work_item/stage_browser_work_item -> Office approval queue/audit log",
    runtimeProofLabel: "창/파일 읽기와 승인 후보",
    verifyCommand: "npm run verify:feature-launcher-quality-browser",
    safetyGate: "읽기 먼저, 파일 변경/클릭/입력 전 승인",
    runtimeStatus: "runtime_connected",
    qualityStatus: "launch_ready",
    qualityReason: "내 PC 작업 대표 런처로 유지",
    evidenceLevel: "browser_e2e",
    evidenceSummary: "설치 앱 점검과 자동 확인으로 창/최근 파일 읽기, 선택 파일/폴더/브라우저 승인 카드, 감사 로그, 되돌리기 안내를 검증",
    evidenceFiles: [],
    resultBoundary: "읽기 후보, 승인 카드, 실행하기/고쳐달라고 하기/보류하기 결정 레일, 감사 로그와 되돌리기 안내로 확인",
    nextUserChoice: "열린 창/최근 파일 읽기 또는 오피스 승인함",
    blockedReason: "볼 창, 최근 파일, 폴더 같은 작업 범위를 아직 고르지 않았을 수 있습니다.",
  },
  {
    id: "feature-memory",
    userLabel: "지난 업무 기억",
    tier: "large",
    surface: "single_setting",
    routeRule: "single_setting_page",
    visibleInQuickDock: false,
    homeAction: "memory_inspect",
    runtimePath: "local memory root and restore smoke",
    runtimeProofLabel: "지난 업무 기억",
    verifyCommand: "npm run verify:local-memory-root-restore",
    safetyGate: "로컬 폴더 기준 복원",
    runtimeStatus: "setup_only",
    qualityStatus: "setup_only",
    qualityReason: "문서 학습과 지난 업무 찾기의 기억 위치 준비 단계로만 노출",
    evidenceLevel: "setup_guard",
    evidenceSummary: "기억 위치와 복원 기준 준비 단계만 확인",
    evidenceFiles: [],
    resultBoundary: "기억 위치 확인 결과와 복원 기준 로그로 확인",
    nextUserChoice: "기억 위치 확인 또는 문서 학습",
    blockedReason: "로컬 기억 위치가 아직 선택되지 않았거나 복원 기준을 확인해야 할 수 있습니다.",
  },
] as const satisfies readonly FeatureLauncherCatalogItem[];

const catalogById: Map<string, FeatureLauncherCatalogItem> = new Map(featureLauncherCatalog.map((item) => [item.id, item]));
const launchReadyEvidenceLevels: readonly FeatureLauncherEvidenceLevel[] = ["runtime_smoke", "browser_e2e", "contract_guard"];

function hasFeatureLauncherExposureEvidence(item: FeatureLauncherCatalogItem): boolean {
  const hasRequiredContract = [
    item.runtimePath,
    item.runtimeProofLabel,
    item.verifyCommand,
    item.safetyGate,
    item.qualityReason,
    item.evidenceSummary,
    item.nextUserChoice,
    item.blockedReason,
  ].every((value) => value.trim().length > 0);
  if (!hasRequiredContract) return false;
  if (item.qualityStatus === "launch_ready" && (!(item.evidenceFiles?.length ?? 0) || !(item.resultBoundary?.trim().length ?? 0))) return false;
  if (item.qualityStatus === "setup_only") {
    return item.runtimeStatus === "setup_only" && item.evidenceLevel === "setup_guard";
  }
  if (item.qualityStatus === "launch_ready") {
    return item.runtimeStatus === "runtime_connected" && launchReadyEvidenceLevels.includes(item.evidenceLevel);
  }
  return false;
}

export function featureLauncherGoalDisposition(item: FeatureLauncherCatalogItem): FeatureLauncherGoalDisposition {
  if (item.qualityStatus === "launch_ready") return "keep_launch_ready";
  if (item.qualityStatus === "setup_only") return "keep_setup_only";
  if (item.qualityStatus === "hidden_until_proven") return "hide_absorb_until_proven";
  return "remove_or_rebuild_until_proven";
}

export function canClaimOpenClawHermesGradeCapability(id: string): boolean {
  const item = getFeatureLauncherCatalogItem(id);
  return Boolean(
    item &&
      openClawHermesClaimFeatureIds.includes(id as (typeof openClawHermesClaimFeatureIds)[number]) &&
      featureLauncherGoalDisposition(item) === "keep_launch_ready" &&
      hasFeatureLauncherExposureEvidence(item) &&
      item.runtimeStatus === "runtime_connected" &&
      item.evidenceFiles?.length &&
      item.resultBoundary?.trim(),
  );
}

export function getFeatureLauncherCatalogItem(id: string): FeatureLauncherCatalogItem | null {
  return catalogById.get(id) ?? null;
}

export function isQuickDockFeature(id: string): boolean {
  return shouldExposeFeatureLauncherItem(id, "quick_dock");
}

export function getRuntimeConnectedFeatureLauncherItems(): readonly FeatureLauncherCatalogItem[] {
  return featureLauncherCatalog.filter(
    (item) =>
      item.runtimeStatus === "runtime_connected" &&
      item.qualityStatus === "launch_ready" &&
      hasFeatureLauncherExposureEvidence(item),
  );
}

export function isLaunchReadyFeature(id: string): boolean {
  const item = getFeatureLauncherCatalogItem(id);
  return Boolean(item && item.qualityStatus === "launch_ready" && hasFeatureLauncherExposureEvidence(item));
}

export function getLaunchReadyFeatureLauncherItems(): readonly FeatureLauncherCatalogItem[] {
  return featureLauncherCatalog.filter((item) => item.qualityStatus === "launch_ready" && hasFeatureLauncherExposureEvidence(item));
}

export function shouldExposeFeatureLauncherItem(id: string, surface: FeatureLauncherExposureSurface): boolean {
  const item = getFeatureLauncherCatalogItem(id);
  if (!item) return false;
  if (surface === "audit_only") return true;
  if (item.qualityStatus === "hidden_until_proven" || item.qualityStatus === "remove_or_rebuild") return false;
  if (!hasFeatureLauncherExposureEvidence(item)) return false;
  if (surface === "single_setting") return item.qualityStatus === "launch_ready" || item.qualityStatus === "setup_only";
  if (item.qualityStatus !== "launch_ready") return false;
  if (surface === "home_launcher") return defaultHomeLauncherFeatureIds.includes(id as (typeof defaultHomeLauncherFeatureIds)[number]);
  if (surface === "quick_dock") return item.visibleInQuickDock === true && item.tier === "small";
  if (surface === "recent_history") return item.visibleInQuickDock === true && item.tier === "small";
  return false;
}

export function getUserVisibleFeatureLauncherItems(
  surface: FeatureLauncherExposureSurface = "home_launcher",
): readonly FeatureLauncherCatalogItem[] {
  return featureLauncherCatalog.filter((item) => shouldExposeFeatureLauncherItem(item.id, surface));
}

export function sanitizeRecentFeatureLauncherIds(ids: readonly unknown[], limit = 6): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    if (seen.has(id)) continue;
    if (!shouldExposeFeatureLauncherItem(id, "recent_history")) continue;
    seen.add(id);
    clean.push(id);
    if (clean.length >= limit) break;
  }
  return clean;
}

export function isRemoveOrRebuildFeature(id: string): boolean {
  return getFeatureLauncherCatalogItem(id)?.qualityStatus === "remove_or_rebuild";
}

export function validateFeatureLauncherReplacement(input: {
  replacementFeatureId?: string;
  replacementHomeAction?: string;
}): FeatureLauncherReplacementReadiness {
  if (!input.replacementFeatureId || !input.replacementHomeAction) {
    return { ready: false, replacement: null, reason: "missing_replacement" };
  }

  const replacement = getFeatureLauncherCatalogItem(input.replacementFeatureId);
  if (!replacement) {
    return { ready: false, replacement: null, reason: "replacement_not_found" };
  }
  if (!isLaunchReadyFeature(input.replacementFeatureId)) {
    return { ready: false, replacement, reason: "replacement_not_launch_ready" };
  }
  if (
    replacement.homeAction !== input.replacementHomeAction &&
    !replacement.supportedHomeActions?.includes(input.replacementHomeAction)
  ) {
    return { ready: false, replacement, reason: "replacement_action_mismatch" };
  }

  return { ready: true, replacement, reason: "replacement_launch_ready" };
}

export function getRemoveOrRebuildFeatureLauncherItems(): readonly FeatureLauncherCatalogItem[] {
  return featureLauncherCatalog.filter((item) => item.qualityStatus === "remove_or_rebuild");
}

export function getQualityGateFeatureLauncherItems(): readonly FeatureLauncherCatalogItem[] {
  return featureLauncherCatalog
    .filter((item) => item.qualityStatus === "remove_or_rebuild" || item.qualityStatus === "hidden_until_proven")
    .sort((left, right) => {
      if (left.qualityStatus === right.qualityStatus) return left.userLabel.localeCompare(right.userLabel, "ko");
      return left.qualityStatus === "remove_or_rebuild" ? -1 : 1;
    });
}

export function getProgressiveDisclosureFeatureLauncherItems(): readonly FeatureLauncherCatalogItem[] {
  return featureLauncherCatalog
    .filter(
      (item) =>
        item.qualityStatus === "launch_ready" &&
        hasFeatureLauncherExposureEvidence(item) &&
        !shouldExposeFeatureLauncherItem(item.id, "home_launcher") &&
        (item.tier === "large" || item.surface !== "chat_dock"),
    )
    .sort((left, right) => {
      if (left.tier === right.tier) return left.userLabel.localeCompare(right.userLabel, "ko");
      return left.tier === "large" ? -1 : 1;
    });
}

export function featureLauncherTierCounts() {
  return getLaunchReadyFeatureLauncherItems().reduce(
    (counts, item) => {
      counts[item.tier] += 1;
      return counts;
    },
    { small: 0, large: 0 },
  );
}
