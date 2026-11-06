const sourceKindUserFacingLabels = {
  mailops: "메일/일정 운영",
  connector_recovery: "연결 복구",
  document_learning: "자료 학습",
  folder_plan: "폴더 정리",
  document_writer: "문서 작성",
  desktop_control: "내 PC 작업",
  channel_delegation: "AI 팀원 위임",
  crewkit_activation: "업무 도구 활성화",
  teammate_memory_update: "AI 팀원 업무 방식 업데이트",
  teammate_decision_log: "AI 팀원 결정 기록",
  workspace_knowledge: "회사 지식 연결",
};

export function userFacingSourceKindLabel(kind, fallback = "업무 학습") {
  return sourceKindUserFacingLabels[String(kind ?? "")] ?? fallback;
}

export function userFacingWorkspaceKnowledgeSourceLabel() {
  return "회사 자료 학습";
}

export function userFacingFolderPlanLabel() {
  return userFacingSourceKindLabel("folder_plan");
}

export function userFacingFolderPlanApprovalRecordLabel() {
  return `${userFacingFolderPlanLabel()} 승인 기록`;
}

export function userFacingMailOpsLabel() {
  return userFacingSourceKindLabel("mailops");
}

export function userFacingApprovedDocumentExportLabel() {
  return "ModyCrew 문서 작성 승인 결과";
}

export function userFacingGrowthCandidateTitle() {
  return "업무 도구 개선 후보";
}

export function userFacingGrowthCandidateNextAction() {
  return "사용자 확인 뒤 업무 도구 목록에 반영합니다.";
}

export function userFacingLocalProfileLoadedMessage(hasProfile) {
  return hasProfile
    ? "저장된 ModyCrew 앱 프로필을 불러왔습니다. 같은 폴더를 새 PC에서 선택하면 AI 팀원, 업무 도구, 대화 기억, 외부 재승인 순서를 이어받습니다."
    : "아직 저장된 ModyCrew 앱 프로필이 없습니다.";
}

export function userFacingLocalProfileSavedMessage() {
  return "AI 팀원, 업무 도구, 앱 설정을 포터블 로컬 기억 저장소에 저장했습니다.";
}

export function userFacingWorkLearningSavedMessage(count) {
  return Number(count) > 0
    ? `업무 학습 ${Number(count)}건을 지난 업무 기억에 저장했습니다.`
    : "저장할 새 업무 학습은 없지만 지난 업무 기억을 확인했습니다.";
}
