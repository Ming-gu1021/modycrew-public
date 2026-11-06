export type SupervisorTeamId =
  | "personal"
  | "operations"
  | "mail"
  | "desktop"
  | "marketing"
  | "development"
  | "finance"
  | "legal"
  | "custom";

export type SupervisorPlanMode =
  | "idle"
  | "answer_here"
  | "dedicated_runtime"
  | "single_specialist"
  | "parallel_specialists";

export type SupervisorRoute = {
  teamId: Exclude<SupervisorTeamId, "personal" | "custom">;
  teamLabel: string;
  roleLabel: string;
  shortLabel: string;
  reason: string;
  outputLabel: string;
  requiredInputLabel: string;
  score: number;
};

export type SupervisorWorkPlan = {
  contract: "modycrew.supervisor.plan.v1";
  requestText: string;
  requestSummary: string;
  mode: SupervisorPlanMode;
  modeLabel: string;
  explicitDelegation: boolean;
  actionable: boolean;
  confidence: "high" | "medium" | "low";
  primaryTeamId: SupervisorTeamId;
  routes: SupervisorRoute[];
  dispatchTeams: SupervisorTeamId[];
  steps: Array<{
    id: "understand" | "dispatch" | "merge" | "approval";
    label: string;
    detail: string;
  }>;
  safetyLabel: string;
};

type SupervisorRouteDefinition = Omit<SupervisorRoute, "score" | "reason"> & {
  patterns: Array<{ pattern: RegExp; weight: number; reason: string }>;
};

const ACTION_PATTERN =
  /정리|분석|확인|찾아|찾기|처리|준비|작성|만들|관리|점검|검토|비교|계획|조사|요약|분류|초안|보내|등록|예약|응답|자동화|모니터|배정|맡겨|시켜|나눠|분배|실행|도와|해줘|해\s*줘|세워|세우|짜\s*줘|구체화|기획해|설계해|고쳐|수정해|써\s*줘|뽑아|부탁/u;
const EXPLICIT_DELEGATION_PATTERN =
  /맡겨|시켜|분배|나눠|나누어|팀별|각\s*팀|전체\s*팀|여러\s*팀|역할별|담당에게|팀에게|직원에게|채널로|병렬|위임|알아서\s*(배정|나눠|맡)/u;
const ALL_TEAM_PATTERN = /각\s*팀|팀별|전체\s*팀|모든\s*팀|전\s*직원/u;
const SIMPLE_QUESTION_PATTERN =
  /^(?:왜|뭐|무엇|어떤|어떻게|설명|알려|가능해|되니|할\s*수\s*있|궁금)/u;

const ROUTE_DEFINITIONS: SupervisorRouteDefinition[] = [
  {
    teamId: "operations",
    teamLabel: "운영",
    roleLabel: "운영 담당",
    shortLabel: "운",
    outputLabel: "우선순위와 처리 목록",
    requiredInputLabel: "문의·주문·운영 현황",
    patterns: [
      { pattern: /고객\s*문의|문의|고객|상담|민원|cs|클레임/iu, weight: 4, reason: "고객·문의 업무" },
      { pattern: /운영|주문|배송|예약|재고|매장|업무\s*현황/iu, weight: 3, reason: "운영 현황 정리" },
      { pattern: /우선\s*순위|오늘\s*할\s*일|업무\s*목록|후속\s*조치/iu, weight: 2, reason: "업무 우선순위 판단" },
    ],
  },
  {
    teamId: "mail",
    teamLabel: "메일·일정",
    roleLabel: "메일 업무 담당자",
    shortLabel: "메",
    outputLabel: "메일·일정 승인 후보",
    requiredInputLabel: "메일 또는 캘린더 연결",
    patterns: [
      { pattern: /메일|이메일|답장|회신|받은\s*편지|gmail|outlook|imap|smtp|mail/iu, weight: 5, reason: "메일 읽기·답장 업무" },
                                                                             
      { pattern: /일정|캘린더|미팅|회의(?!\s*(?:록|메모|내용|자료))|약속|예약\s*시간/iu, weight: 4, reason: "일정 조율 업무" },
    ],
  },
  {
    teamId: "desktop",
    teamLabel: "자료·PC",
    roleLabel: "자료 관리 담당",
    shortLabel: "자",
    outputLabel: "자료 요약 또는 실행 전 정리안",
    requiredInputLabel: "사용자가 고른 파일·폴더",
    patterns: [
      { pattern: /바탕\s*화면|다운로드|폴더|파일\s*정리|내\s*pc|컴퓨터|최근\s*파일|desktop|folder/iu, weight: 5, reason: "내 PC·폴더 업무" },
      { pattern: /문서|자료|서류|pdf|한글\s*파일|워드|엑셀|양식/iu, weight: 3, reason: "문서·자료 확인" },
    ],
  },
  {
    teamId: "marketing",
    teamLabel: "마케팅",
    roleLabel: "마케팅 담당",
    shortLabel: "마",
    outputLabel: "콘텐츠 초안과 다음 실험",
    requiredInputLabel: "제품·고객·채널 정보",
    patterns: [
      { pattern: /마케팅|홍보|광고|캠페인|sns|인스타|블로그|콘텐츠|보도자료|브랜드/iu, weight: 5, reason: "홍보·콘텐츠 업무" },
      { pattern: /고객\s*반응|전환|유입|성과\s*지표|성장/iu, weight: 3, reason: "마케팅 성과 판단" },
    ],
  },
  {
    teamId: "development",
    teamLabel: "제품·기술",
    roleLabel: "개발 담당",
    shortLabel: "개",
    outputLabel: "구현안과 검증 결과",
    requiredInputLabel: "요구사항·작업 폴더",
    patterns: [
      { pattern: /개발|코딩|코드|버그|오류|배포|서버|api|데이터베이스|깃허브|github/iu, weight: 5, reason: "개발·기술 업무" },
      { pattern: /제품\s*기능|앱\s*기능|웹\s*사이트|자동화\s*도구/iu, weight: 3, reason: "제품 기능 작업" },
    ],
  },
  {
    teamId: "finance",
    teamLabel: "재무",
    roleLabel: "재무 담당",
    shortLabel: "재",
    outputLabel: "금액 근거와 확인 표",
    requiredInputLabel: "매출·비용·정산 자료",
    patterns: [
      { pattern: /재무|회계|정산|비용|매출|매입|입금|출금|청구|영수증|세금|부가세/iu, weight: 5, reason: "재무·정산 업무" },
      { pattern: /예산|손익|현금\s*흐름|계산|금액/iu, weight: 3, reason: "금액·예산 판단" },
    ],
  },
  {
    teamId: "legal",
    teamLabel: "계약·정책",
    roleLabel: "검토 담당",
    shortLabel: "검",
    outputLabel: "위험 항목과 확인 질문",
    requiredInputLabel: "계약·정책 원문",
    patterns: [
      // '정책'만으로는 계약 검토로 보지 않는다('가격 정책 조사'가 계약 검토자에게 갔다). 개인정보 방침은 '개인 정보'로 잡힌다.
      { pattern: /법무|계약|약관|개인\s*정보|공공기관|협약|서명|법률/iu, weight: 5, reason: "계약·정책 검토" },
      { pattern: /리스크|위험\s*조항|책임|의무|분쟁/iu, weight: 3, reason: "위험 항목 확인" },
    ],
  },
];

const DEFAULT_STEPS: SupervisorWorkPlan["steps"] = [
  { id: "understand", label: "요청 이해", detail: "목표와 필요한 결과를 먼저 정리합니다." },
  { id: "dispatch", label: "담당 배정", detail: "관련 있는 직원에게만 일을 나눕니다." },
  { id: "merge", label: "결과 취합", detail: "직원별 결과를 총괄 담당자가 하나로 모읍니다." },
  { id: "approval", label: "확인·승인", detail: "외부 변경이 있으면 마지막에 사용자에게 확인받습니다." },
];

function compactRequest(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return "업무를 한 문장으로 말하면 총괄 담당자가 적절한 직원에게 나눕니다.";
  return normalized.length > 92 ? `${normalized.slice(0, 91)}…` : normalized;
}

function scoreDefinition(text: string, definition: SupervisorRouteDefinition) {
  let score = 0;
  const reasons: string[] = [];
  for (const item of definition.patterns) {
    if (!item.pattern.test(text)) continue;
    score += item.weight;
    if (!reasons.includes(item.reason)) reasons.push(item.reason);
  }
  return { score, reason: reasons.join(" · ") };
}

function routeFromDefinition(definition: SupervisorRouteDefinition, score: number, reason: string): SupervisorRoute {
  const { patterns: _patterns, ...route } = definition;
  return { ...route, score, reason: reason || "요청 내용과 역할이 맞음" };
}

function modeLabelFor(mode: SupervisorPlanMode, routeCount: number) {
  if (mode === "idle") return "업무 대기";
  if (mode === "answer_here") return "총괄이 바로 답변";
  if (mode === "dedicated_runtime") return "전담 업무 흐름 연결";
  if (mode === "parallel_specialists") return `${routeCount}명 함께 처리`;
  return "담당 직원 자동 배정";
}

export function createSupervisorWorkPlan(
  value: string,
  options: { currentTeamId?: SupervisorTeamId; maxRoutes?: number } = {},
): SupervisorWorkPlan {
  const requestText = String(value ?? "").replace(/\s+/gu, " ").trim();
  const explicitDelegation = EXPLICIT_DELEGATION_PATTERN.test(requestText);
  const actionable = ACTION_PATTERN.test(requestText) || explicitDelegation;
  const allTeamsRequested = ALL_TEAM_PATTERN.test(requestText);
  const maxRoutes = Math.max(1, Math.min(7, options.maxRoutes ?? 4));

  const scored = ROUTE_DEFINITIONS.map((definition) => {
    const result = scoreDefinition(requestText, definition);
    return { definition, ...result };
  })
    .filter((item) => allTeamsRequested || item.score > 0)
    .map((item) => routeFromDefinition(item.definition, allTeamsRequested ? Math.max(1, item.score) : item.score, item.reason))
    .sort((a, b) => b.score - a.score)
    .slice(0, allTeamsRequested ? 7 : maxRoutes);

  const routes = requestText ? scored : [];
  const primaryTeamId: SupervisorTeamId = routes[0]?.teamId ?? "personal";
  const simpleQuestion = SIMPLE_QUESTION_PATTERN.test(requestText) && !explicitDelegation && !ACTION_PATTERN.test(requestText);
  const dedicatedRuntime =
    !explicitDelegation && routes.length === 1 && (routes[0].teamId === "mail" || routes[0].teamId === "desktop");

  let mode: SupervisorPlanMode = "idle";
  if (requestText) {
    if (!actionable || simpleQuestion || routes.length === 0) mode = "answer_here";
    else if (dedicatedRuntime) mode = "dedicated_runtime";
    else if (routes.length > 1) mode = "parallel_specialists";
    else mode = "single_specialist";
  }

  const dispatchTeams =
    mode === "single_specialist" || mode === "parallel_specialists"
      ? routes
          .map((route) => route.teamId as SupervisorTeamId)
          .filter((teamId) => teamId !== options.currentTeamId)
      : [];
  const confidence: SupervisorWorkPlan["confidence"] =
    explicitDelegation || routes[0]?.score >= 5 ? "high" : routes.length ? "medium" : "low";

  return {
    contract: "modycrew.supervisor.plan.v1",
    requestText,
    requestSummary: compactRequest(requestText),
    mode,
    modeLabel: modeLabelFor(mode, routes.length),
    explicitDelegation,
    actionable,
    confidence,
    primaryTeamId,
    routes,
    dispatchTeams,
    steps: DEFAULT_STEPS,
    safetyLabel: "외부 발송·일정 등록·파일 변경·결제·제출은 사용자 확인 전 실행하지 않습니다.",
  };
}

export function supervisorTeamLabel(teamId: SupervisorTeamId) {
  if (teamId === "personal") return "총괄 담당자";
  if (teamId === "custom") return "사용자 지정 직원";
  return ROUTE_DEFINITIONS.find((item) => item.teamId === teamId)?.roleLabel ?? "담당 직원";
}
