const generatedKinds = new Set(["generate_text", "generate_text_stream"]);
const defaultMasterTeammateId = "teammate-personal-operator";

export async function prepareAgentOrganizationRuntimeRoute(input = {}, dependencies = {}) {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const roleContext = payload.roleContext && typeof payload.roleContext === "object" ? payload.roleContext : {};
  const profile = input.profile && typeof input.profile === "object" ? input.profile : null;
  const unchanged = { payload, status: "agent_org_runtime_route_skipped", agentRouting: null };
  if (!generatedKinds.has(String(payload.kind ?? "")) || payload.agentRunContext) return unchanged;
  // 업무 비서 대화에서 웹이 이미 맡길 사람을 정한 요청(lib/expert-routing)은 다시 배정하지 않는다.
  // 웹은 한 명이 뚜렷할 때만 전문가에게 맡기고, 아니면 모든 도구를 가진 비서가 직접 처리한다.
  // 예전 업무팩 키워드 배정이 이 결정을 덮어 '사과게임 만들고 실행해봐' 같은 개발 요청이
                                                        
  if (payload.executionContext?.expertRouting?.contract === "modycrew.expert.route.v1") {
    return { ...unchanged, status: "agent_org_runtime_route_web_decided" };
  }
  if (!profile || typeof dependencies.routeRequest !== "function" || typeof dependencies.verifyTarget !== "function") return unchanged;

  const sourceTeammateId = cleanText(roleContext.teammateId, 120);
  const masterTeammateId = cleanText(profile.appSettings?.mainControllerId, 120) || defaultMasterTeammateId;
  if (!sourceTeammateId || sourceTeammateId !== masterTeammateId) return unchanged;

  // 배정은 사용자가 방금 한 말로 정한다. 채팅 프롬프트 앞머리에는 매번 같은 앱 규칙
  // 문장(2천 자 넘음)이 붙는데, 예전에는 그 문장까지 통째로 읽어 '안녕'이든 '부가세 정산'이든
  // 늘 같은 직원에게 배정됐다(실측: 4개 요청 모두 같은 키워드 12개).
  const requestText = cleanText(extractRoutingRequest(payload), 2000);
  if (!requestText) return unchanged;
const allowedTeammateIds = Array.isArray(profile.teammates)
    ? profile.teammates
      .map((candidate) => cleanText(candidate?.id, 120))
      .filter((candidate) => candidate && candidate !== masterTeammateId)
    : [];
  const routeResult = await dependencies.routeRequest({ requestText, allowedTeammateIds });
  const inferredWorkPackCandidates = inferWorkPackCandidates(requestText);
  const learnedAssignment = await resolveApprovedFolderLearningAssignment(
    dependencies,
    inferredWorkPackCandidates,
    allowedTeammateIds,
  );
  const routeResultRouting = routeResult?.routing;
  const usesApprovedFolderLearning = learnedAssignment !== null;
  const routing = usesApprovedFolderLearning
    ? {
        method: "approved-folder-learning",
        reason: approvedFolderLearningReason(learnedAssignment),
        extractedKeywords: cleanList(routeResultRouting?.extractedKeywords, 12, 32),
        primary: { teammateId: learnedAssignment.targetTeammateId },
      }
    : routeResultRouting;
  const targetTeammateId = cleanText(routing?.primary?.teammateId, 120);
  if (
    (!usesApprovedFolderLearning && routeResult?.status !== "agent_org_work_routed") ||
    !targetTeammateId ||
    targetTeammateId === masterTeammateId
  ) {
    return { ...unchanged, agentRouting: publicRouting(routing, "master_fallback") };
  }

  const target = Array.isArray(profile.teammates)
    ? profile.teammates.find((candidate) => cleanText(candidate?.id, 120) === targetTeammateId)
    : null;
  if (!target) return { ...unchanged, status: "agent_org_runtime_target_missing", agentRouting: publicRouting(routing, "target_missing") };

  let verifiedTarget = null;
  const verificationWorkPackCandidates = [
    ...(usesApprovedFolderLearning ? [learnedAssignment.workPackId] : []),
    ...inferredWorkPackCandidates,
  ];
  for (const workPackId of [...new Set(verificationWorkPackCandidates)]) {
    const candidate = await dependencies.verifyTarget({ targetTeammateId, workPackId });
    if (candidate?.verified === true) {
      verifiedTarget = candidate;
      break;
    }
  }
  if (!verifiedTarget) {
    return { ...unchanged, status: "agent_org_runtime_target_unverified", agentRouting: publicRouting(routing, "target_unverified") };
  }

  const routedRoleContext = {
    ...roleContext,
    teammateId: targetTeammateId,
    teammateName: cleanText(target.name, 60),
    teamLabel: cleanText(target.teamLabel, 60),
    roleTitle: cleanText(target.roleTitle, 80),
    channelName: cleanText(target.channelName, 80),
    brief: cleanText(target.brief, 240),
    skillIds: cleanList(target.skillIds, 16, 80),
    instructions: cleanList(target.instructions, 8, 180),
    assignmentContract: "agent_org_runtime_routing_v1",
    assignmentSummary: cleanText(routing.reason, 240),
    assignmentRuntimeLine: usesApprovedFolderLearning
      ? "승인한 폴더에서 확인한 반복 업무와 저장된 역할·성과 근거를 다시 대조해 이 요청을 배치했습니다."
      : "메인 컨트롤이 저장된 역할·성과 근거를 확인해 이 요청을 배치했습니다.",
    assignmentApprovalLine: "외부 발송, 일정 등록, 파일 변경, 결제, 제출은 사용자 최종 승인 전까지 실행하지 않습니다.",
    assignmentMemoryLine: `memory/crew-souls/${targetTeammateId}/CrewSoul.md · WorkLog.md · DecisionLog.md`,
  };
  const agentRouting = publicRouting(routing, "routed", {
    targetTeammateId,
    targetTeammateName: cleanText(target.name, 60),
    roleTitle: cleanText(target.roleTitle, 80),
    workPackId: verifiedTarget.workPackId,
    ...(usesApprovedFolderLearning
      ? {
          assignmentSource: "approved_folder_learning",
          learningEvidenceCount: learnedAssignment.evidenceCount,
          learningConfidence: learnedAssignment.confidence,
          learningReasons: learnedAssignment.reasons,
        }
      : {}),
  });
  return {
    status: "agent_org_runtime_route_applied",
    payload: {
      ...payload,
      roleContext: routedRoleContext,
      executionContext: {
        ...(payload.executionContext && typeof payload.executionContext === "object" ? payload.executionContext : {}),
        source: usesApprovedFolderLearning
          ? "agent_org_approved_folder_learning"
          : "agent_org_auto_routing",
        requestedWorkSummary: cleanText(payload.executionContext?.requestedWorkSummary, 180) || requestText.slice(0, 180),
      },
      agentRunContext: {
        sourceTeammateId,
        targetTeammateId,
        workPackId: verifiedTarget.workPackId,
      },
    },
    agentRouting,
  };
}

async function resolveApprovedFolderLearningAssignment(
  dependencies,
  workPackCandidates,
  allowedTeammateIds,
) {
  if (typeof dependencies.resolveLearnedAssignment !== "function") return null;
  const allowed = new Set(cleanList(allowedTeammateIds, 40, 120));
  for (const workPackId of [...new Set(workPackCandidates)]) {
    let candidate;
    try {
      candidate = await dependencies.resolveLearnedAssignment({
        workspaceId: "local_desktop",
        workPackId,
        allowedTeammateIds: [...allowed],
      });
    } catch {
      continue;
    }
    const targetTeammateId = cleanText(candidate?.targetTeammateId, 120);
    const candidateWorkPackId = cleanText(candidate?.workPackId, 80);
    if (
      candidate?.eligible !== true ||
      candidate?.autoDispatch !== false ||
      candidateWorkPackId !== workPackId ||
      !targetTeammateId ||
      !allowed.has(targetTeammateId)
    ) {
      continue;
    }
    return {
      targetTeammateId,
      workPackId,
      confidence: Math.min(1, Math.max(0, Number(candidate.confidence) || 0)),
      evidenceCount: Math.max(0, Number(candidate.evidenceCount) || 0),
      reasons: cleanList(candidate.reasons, 3, 180),
    };
  }
  return null;
}

function approvedFolderLearningReason(assignment) {
  const evidence = Math.max(0, Number(assignment?.evidenceCount) || 0);
  const detail = cleanList(assignment?.reasons, 1, 180)[0] || "현재 역할 범위와 일치했습니다.";
  return cleanText(`승인된 폴더의 ${evidence}개 근거를 현재 역할·성과와 대조했습니다. ${detail}`, 240);
}
const currentUserRequestMarker = "[현재 사용자 요청]";

// 채팅 생성 프롬프트(page.tsx buildChatGenerationPrompt)는 섹션을 빈 줄로 잇고,
                                               
// 표식이 없는 프롬프트(위임·배경 실행 등)는 예전처럼 전체를 쓴다.
export function extractRoutingRequest(payload = {}) {
  const explicit = typeof payload.routingRequestText === "string" ? payload.routingRequestText.trim() : "";
  if (explicit) return explicit;
  const prompt = String(payload.prompt ?? "");
  const markerIndex = prompt.lastIndexOf(currentUserRequestMarker);
  if (markerIndex < 0) return prompt;
  const afterMarker = prompt.slice(markerIndex + currentUserRequestMarker.length).replace(/^\s+/u, "");
  const nextSectionIndex = afterMarker.search(/\n\s*\n\s*\[/u);
  const request = (nextSectionIndex >= 0 ? afterMarker.slice(0, nextSectionIndex) : afterMarker).trim();
  return request || prompt;
}

export function inferWorkPackCandidates(requestText) {
  const text = cleanText(requestText, 2000).toLocaleLowerCase("ko-KR");
  if (/세금|부가세|세무|계약|법무|약관|신고|공공기관/u.test(text)) return ["tax_contract_archive", "report_cleanup"];
  if (/폴더|파일|디렉터리|드라이브|다운로드|문서함|folder|file|directory|drive|download/u.test(text)) {
    return ["report_cleanup", "inventory_reorder"];
  }
  if (/재고|발주|입고|출고|inventory/u.test(text)) return ["inventory_reorder", "report_cleanup"];
  if (/일정|회의|캘린더|예약|schedule|calendar/u.test(text)) return ["schedule_coordination", "inquiry_response"];
  if (/보고서|정산|비용|청구|문서|자료|report/u.test(text)) return ["report_cleanup", "inquiry_response"];
  return ["inquiry_response", "report_cleanup"];
}

function publicRouting(routing, status, extra = {}) {
  if (!routing || typeof routing !== "object") return null;
  return {
    contract: "agent_org_runtime_routing_v1",
    status,
    method: cleanText(routing.method, 48),
    reason: cleanText(routing.reason, 240),
    extractedKeywords: cleanList(routing.extractedKeywords, 12, 32),
    ...extra,
    externalMutation: false,
  };
}

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function cleanList(value, maxItems, maxLength) {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
}
