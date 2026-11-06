export type AdaptiveAgentReference = "hermes_agent" | "openclaw";

export type AdaptiveAgentCapabilityId =
  | "agent_memory_loop"
  | "experience_to_skill"
  | "skill_self_improvement"
  | "session_search_recall"
  | "scheduled_work"
  | "multi_channel_gateway"
  | "parallel_work_delegation"
  | "tool_gateway"
  | "model_switching"
  | "approval_guard";

export type AdaptiveAgentCapability = {
  id: AdaptiveAgentCapabilityId;
  label: string;
  userFacingLabel: string;
  enabledByDefault: boolean;
  hiddenUntilNeeded: boolean;
  references: AdaptiveAgentReference[];
  setupSurface: "ai_connection" | "memory" | "work_packs" | "office_approval" | "connectors";
  koreaEasySetup: string[];
  safetyBoundary: string;
  legalBoundary: "clean_room_pattern_only";
};

export type AdaptiveAgentGrowthLoop = {
  id: "mody_adaptive_agent_growth_loop_v1";
  stages: Array<"observe" | "summarize" | "propose_skill" | "ask_user" | "save_pattern" | "reuse" | "improve">;
  defaultAutoExecution: false;
  requiresUserApprovalBeforeExternalMutation: true;
  storesRawSecrets: false;
  visibleToUserAs: string;
};

export type AdaptiveAgentCapabilityManifest = {
  id: "mody_adaptive_agent_capabilities_v1";
  cleanRoomPolicy: {
    codeCopiedFromReferences: false;
    licenseNoticeRequiredOnlyIfCodeImported: true;
    allowedUse: "feature_pattern_reimplementation";
    disallowedUse: "copying_runtime_or_branding";
  };
  defaultFreedomPosture: {
    internalCapabilitiesPreconfigured: true;
    publicUiProgressiveDisclosure: true;
    userSeesBusinessActionsFirst: true;
    externalActionsRequireApproval: true;
    koreanUserSetupFirst: true;
  };
  growthLoop: AdaptiveAgentGrowthLoop;
  capabilities: AdaptiveAgentCapability[];
};

export const adaptiveAgentCapabilityManifest: AdaptiveAgentCapabilityManifest = {
  id: "mody_adaptive_agent_capabilities_v1",
  cleanRoomPolicy: {
    codeCopiedFromReferences: false,
    licenseNoticeRequiredOnlyIfCodeImported: true,
    allowedUse: "feature_pattern_reimplementation",
    disallowedUse: "copying_runtime_or_branding",
  },
  defaultFreedomPosture: {
    internalCapabilitiesPreconfigured: true,
    publicUiProgressiveDisclosure: true,
    userSeesBusinessActionsFirst: true,
    externalActionsRequireApproval: true,
    koreanUserSetupFirst: true,
  },
  growthLoop: {
    id: "mody_adaptive_agent_growth_loop_v1",
    stages: ["observe", "summarize", "propose_skill", "ask_user", "save_pattern", "reuse", "improve"],
    defaultAutoExecution: false,
    requiresUserApprovalBeforeExternalMutation: true,
    storesRawSecrets: false,
    visibleToUserAs: "내 업무 방식 학습",
  },
  capabilities: [
    {
      id: "agent_memory_loop",
      label: "Persistent memory and user model",
      userFacingLabel: "내 업무 방식 학습",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent", "openclaw"],
      setupSurface: "memory",
      koreaEasySetup: ["기억 저장 폴더 선택", "업무 방식 저장", "새 PC에서 같은 폴더 복원"],
      safetyBoundary: "사용자가 저장하거나 승인한 요약과 업무 방식만 재사용",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "experience_to_skill",
      label: "Experience to skill proposal",
      userFacingLabel: "다음부터 이렇게",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent"],
      setupSurface: "work_packs",
      koreaEasySetup: ["완료 답변 확인", "다음부터 이렇게 저장", "다음 유사 요청에서 추천"],
      safetyBoundary: "저장은 사용자 버튼으로만 확정하고 자동 실행하지 않음",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "skill_self_improvement",
      label: "Skill improvement loop",
      userFacingLabel: "업무팩 개선",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent"],
      setupSurface: "work_packs",
      koreaEasySetup: ["반복 업무 신호 확인", "개선 후보 제안", "사용자 확인 후 저장"],
      safetyBoundary: "업무팩 변경은 제안으로만 만들고 사용자가 확인해야 반영",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "session_search_recall",
      label: "Session search and recall",
      userFacingLabel: "지난 업무 찾기",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent"],
      setupSurface: "memory",
      koreaEasySetup: ["자료/메일/대화 요약 검색", "읽기 전용 근거 확인", "질문에 넣기"],
      safetyBoundary: "검색 결과는 프롬프트 참고 기준이며 외부 실행 없음",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "scheduled_work",
      label: "Cron and webhook automation",
      userFacingLabel: "반복 업무 만들기",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent", "openclaw"],
      setupSurface: "work_packs",
      koreaEasySetup: ["언제 할지 입력", "무엇을 확인할지 입력", "기본 꺼짐으로 저장"],
      safetyBoundary: "사용자가 켠 규칙만 점검하고 실행은 승인함 전까지 잠금",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "multi_channel_gateway",
      label: "Messaging and work gateway",
      userFacingLabel: "연결된 업무 통로",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent", "openclaw"],
      setupSurface: "connectors",
      koreaEasySetup: ["메일/캘린더/메신저 연결", "승인 알림 채널 선택", "오피스 승인함으로 복귀"],
      safetyBoundary: "외부 채널은 알림/승인 보조이며 단독 실행 경로가 아님",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "parallel_work_delegation",
      label: "Subagent and parallel delegation",
      userFacingLabel: "AI 팀원에게 나눠 맡기기",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent"],
      setupSurface: "work_packs",
      koreaEasySetup: ["담당자 선택", "역할별 결과 취합", "승인함에서 실행 확인"],
      safetyBoundary: "팀원 결과는 초안이며 외부 변경은 오피스 승인 후 실행",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "tool_gateway",
      label: "Tool and MCP gateway",
      userFacingLabel: "사용할 수 있는 업무 도구",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent", "openclaw"],
      setupSurface: "connectors",
      koreaEasySetup: ["필요 도구만 추천", "공식 연결 또는 보관함 선택", "읽기 먼저 확인"],
      safetyBoundary: "외부 도구 실행은 권한과 승인 규칙을 통과해야 함",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "model_switching",
      label: "Model/provider switching",
      userFacingLabel: "AI 답변 모델 선택",
      enabledByDefault: true,
      hiddenUntilNeeded: true,
      references: ["hermes_agent"],
      setupSurface: "ai_connection",
      koreaEasySetup: ["AI 로그인", "모델 선택", "짧게 테스트"],
      safetyBoundary: "비밀값 원문은 표시하지 않고 실제 답변 가능 여부를 테스트로 확인",
      legalBoundary: "clean_room_pattern_only",
    },
    {
      id: "approval_guard",
      label: "Approval and final execution guard",
      userFacingLabel: "승인 전 실행 잠금",
      enabledByDefault: true,
      hiddenUntilNeeded: false,
      references: ["hermes_agent", "openclaw"],
      setupSurface: "office_approval",
      koreaEasySetup: ["미리보기 확인", "승인/수정/보류 선택", "실행 로그 확인"],
      safetyBoundary: "메일 발송, 일정 등록, 파일 변경, 공유, 삭제, 제출은 최종 승인 전 실행 금지",
      legalBoundary: "clean_room_pattern_only",
    },
  ],
};

export function getAdaptiveAgentCapabilityManifest() {
  return adaptiveAgentCapabilityManifest;
}

export function getEnabledAdaptiveAgentCapabilities() {
  return adaptiveAgentCapabilityManifest.capabilities.filter((capability) => capability.enabledByDefault);
}

export function formatAdaptiveAgentSetupChecklist() {
  return adaptiveAgentCapabilityManifest.capabilities.map((capability) => ({
    id: capability.id,
    label: capability.userFacingLabel,
    setupSurface: capability.setupSurface,
    steps: capability.koreaEasySetup,
    boundary: capability.safetyBoundary,
  }));
}
