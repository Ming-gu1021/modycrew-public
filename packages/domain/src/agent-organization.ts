/**
 * 업무 자동화 에이전트 조직 — 마스터(메인 컨트롤) 1층 + 직원 1층 고정 구조.
 *
 * 원칙:
 *  - 마스터는 처음 만들어진 메인 직원(teammate-personal-operator)이며, 모든 하위
 *    직원의 parentTeammateId 는 항상 마스터다(재귀 조직 금지).
 *  - 직원 스펙은 append-only 버전(AgentSpecVersion)으로만 바뀐다. 수정·삭제 금지,
 *    개선은 새 버전 추가이고 이전 버전은 보존되어 언제든 롤백 가능하다.
 *  - 라우팅 근거는 실측만 쓴다(태그 일치 개수, 과거 성공 횟수). 장식용 신뢰도 산술 금지.
 *  - 여기는 순수 로직만 둔다. 저장(ledger)·승인함 스테이징·채용 실행은 데스크톱/웹 몫.
 */

export const MODY_AGENT_ORG_MASTER_TEAMMATE_ID = "teammate-personal-operator";

export type ModyAgentOrgMemberStatus = "active" | "probation" | "retired";

export type ModyAgentOrgMember = {
  teammateId: string;
  /** 항상 마스터 id — 마스터 1층 + 직원 1층 고정, 직원 밑에 직원을 두지 않는다. */
  parentTeammateId: string;
  roleTitle: string;
  /** 한국어 업무 어휘 능력 태그(예: 메일분류, 정산, 문서요약). 최대 16개. */
  capabilityTags: string[];
  activeSpecVersion: number;
  memberStatus: ModyAgentOrgMemberStatus;
  joinedAt: string;
  retiredAt?: string;
};

export type ModyAgentOrgBlueprint = {
  contract: "agent_org_blueprint_v1";
  version: number;
  updatedAt: string;
  masterTeammateId: string;
  members: ModyAgentOrgMember[];
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ModyAgentSpecVersionStatus = "active" | "superseded" | "rolled_back";

export type ModyAgentSpecFields = {
  name: string;
  roleTitle: string;
  brief: string;
  channelName: string;
  skillIds: string[];
  instructions: string[];
  capabilityTags: string[];
};

export type ModyAgentSpecVersion = ModyAgentSpecFields & {
  contract: "agent_spec_version_v1";
  teammateId: string;
  /** 1부터 단조 증가. 레코드 자체는 불변(append-only)이며 상태만 전이된다. */
  specVersion: number;
  sourceProposalId: string | null;
  createdAt: string;
  versionStatus: ModyAgentSpecVersionStatus;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ModyAgentRoutingMethod = "capability-tags" | "learned-overlap" | "master-fallback";

export type ModyAgentRoutingCandidate = {
  teammateId: string;
  roleTitle: string;
  matchedTags: string[];
  matchedTagCount: number;
  pastSuccessCount: number;
};

export type ModyAgentRoutingDecision = {
  contract: "agent_routing_decision_v1";
  requestText: string;
  extractedKeywords: string[];
  method: ModyAgentRoutingMethod;
  primary: ModyAgentRoutingCandidate | null;
  alternatives: ModyAgentRoutingCandidate[];
  /** 사용자 노출용 한국어 근거 — 실측 수치만 사용한다. */
  reason: string;
};

export type ModyCapabilityGapRecommendation = "use_existing" | "propose_new_agent" | "master_fallback";

export type ModyCapabilityGapReport = {
  contract: "capability_gap_report_v1";
  requestText: string;
  extractedKeywords: string[];
  bestMatch: ModyAgentRoutingCandidate | null;
  missingTags: string[];
  recommendation: ModyCapabilityGapRecommendation;
};

export type ModyAgentDelegationArtifactKind = "mail" | "approval" | "report";

export type ModyAgentDelegationPlanStep = {
  order: number;
  /** 기존 직원이면 teammateId, 신규 채용이 필요한 단계면 null + proposalRef. */
  teammateId: string | null;
  proposalRef: string | null;
  taskSummary: string;
  expectedArtifactKind: ModyAgentDelegationArtifactKind;
};

export type ModyAgentDelegationPlan = {
  contract: "delegation_plan_v1";
  planId: string;
  requestText: string;
  steps: ModyAgentDelegationPlanStep[];
  /** 다단계 위임은 실행 전 반드시 승인 카드를 거친다 — 리터럴 고정. */
  requiresApproval: true;
  createdAt: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

const maxCapabilityTags = 16;
const maxCapabilityTagLength = 24;
const maxExtractedKeywords = 12;

const keywordStopwords = new Set([
  "그리고", "그래서", "하지만", "그런데", "저는", "제가", "우리", "오늘", "지금", "그냥",
  "관련", "부탁", "해줘", "해주세요", "주세요", "해봐", "좀", "이거", "저거", "그거",
  "어떻게", "있는", "있어", "없는", "해야", "합니다", "입니다", "위해", "대해", "대한",
]);

function clampText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function sanitizeCapabilityTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags ?? []) {
    const tag = clampText(raw, maxCapabilityTagLength);
    // 1글자 태그는 사실상 모든 요청에 과매칭되므로 키워드와 동일하게 2글자 이상만 허용.
    if (tag.length < 2 || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= maxCapabilityTags) break;
  }
  return result;
}

export function sanitizeAgentSpecFields(fields: Partial<ModyAgentSpecFields>): ModyAgentSpecFields {
  return {
    name: clampText(fields.name, 32),
    roleTitle: clampText(fields.roleTitle, 48),
    brief: clampText(fields.brief, 180),
    channelName: clampText(fields.channelName, 42),
    skillIds: (fields.skillIds ?? []).map((id) => clampText(id, 60)).filter(Boolean).slice(0, 16),
    instructions: (fields.instructions ?? []).map((line) => clampText(line, 160)).filter(Boolean).slice(0, 8),
    capabilityTags: sanitizeCapabilityTags(fields.capabilityTags),
  };
}

export function createAgentOrgBlueprint(input: {
  masterTeammateId?: string;
  createdAt?: string;
} = {}): ModyAgentOrgBlueprint {
  return {
    contract: "agent_org_blueprint_v1",
    version: 1,
    updatedAt: input.createdAt ?? new Date().toISOString(),
    masterTeammateId: clampText(input.masterTeammateId, 120) || MODY_AGENT_ORG_MASTER_TEAMMATE_ID,
    members: [],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

export function addAgentOrgMember(
  blueprint: ModyAgentOrgBlueprint,
  member: {
    teammateId: string;
    roleTitle: string;
    capabilityTags: string[];
    activeSpecVersion?: number;
    memberStatus?: ModyAgentOrgMemberStatus;
    joinedAt?: string;
  },
): ModyAgentOrgBlueprint {
  const teammateId = clampText(member.teammateId, 120);
  if (!teammateId) throw new Error("직원 id 없이 조직에 추가할 수 없습니다.");
  if (teammateId === blueprint.masterTeammateId) {
    throw new Error("마스터는 조직 멤버 목록에 다시 추가하지 않습니다.");
  }
  if (blueprint.members.some((existing) => existing.teammateId === teammateId)) {
    throw new Error("이미 조직에 있는 직원입니다.");
  }
  const joinedAt = member.joinedAt ?? new Date().toISOString();
  const nextMember: ModyAgentOrgMember = {
    teammateId,
    parentTeammateId: blueprint.masterTeammateId,
    roleTitle: clampText(member.roleTitle, 48) || "AI 직원",
    capabilityTags: sanitizeCapabilityTags(member.capabilityTags),
    activeSpecVersion: Math.max(1, Math.floor(member.activeSpecVersion ?? 1)),
    memberStatus: member.memberStatus ?? "probation",
    joinedAt,
  };
  return {
    ...blueprint,
    version: blueprint.version + 1,
    updatedAt: joinedAt,
    members: [...blueprint.members, nextMember],
  };
}

export function retireAgentOrgMember(
  blueprint: ModyAgentOrgBlueprint,
  teammateId: string,
  retiredAt?: string,
): ModyAgentOrgBlueprint {
  const target = blueprint.members.find((member) => member.teammateId === teammateId);
  if (!target) throw new Error("조직에 없는 직원은 퇴사 처리할 수 없습니다.");
  if (target.memberStatus === "retired") return blueprint;
  const at = retiredAt ?? new Date().toISOString();
  return {
    ...blueprint,
    version: blueprint.version + 1,
    updatedAt: at,
    members: blueprint.members.map((member) =>
      member.teammateId === teammateId
        ? { ...member, memberStatus: "retired", retiredAt: at }
        : member,
    ),
  };
}

/** 한국어 업무 요청에서 매칭용 키워드를 추출한다. 한글/영문/숫자 토큰 기반, 불용어 제외. */
export function extractWorkKeywords(text: string): string[] {
  const tokens = String(text ?? "")
    .toLocaleLowerCase("ko-KR")
    .split(/[^0-9a-z가-힣]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !keywordStopwords.has(token));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
    if (result.length >= maxExtractedKeywords) break;
  }
  return result;
}

function matchTagsAgainstKeywords(tags: readonly string[], keywords: readonly string[]): string[] {
  return tags.filter((tag) => {
    const normalized = tag.toLocaleLowerCase("ko-KR");
    // 과거 ledger에 남아 있을 수 있는 1글자 태그도 방어한다(과매칭 차단).
    if (normalized.length < 2) return false;
    return keywords.some((keyword) => keyword.includes(normalized) || normalized.includes(keyword));
  });
}

function successCountFor(
  records: readonly ModyAgentPerformanceRecordLike[],
  teammateId: string,
): number {
  return records.filter((record) => record.teammateId === teammateId && record.outcome === "success").length;
}

/** 성과 레코드 중 라우팅 학습에 쓰는 최소 형태(전체 타입은 agent-proposals 모듈). */
export type ModyAgentPerformanceRecordLike = {
  teammateId: string;
  outcome: string;
  keywords?: readonly string[];
};

function compareCandidates(left: ModyAgentRoutingCandidate, right: ModyAgentRoutingCandidate): number {
  return (
    right.matchedTagCount - left.matchedTagCount ||
    right.pastSuccessCount - left.pastSuccessCount ||
    left.teammateId.localeCompare(right.teammateId)
  );
}

/**
 * 작업 → 직원 라우팅 3단 사다리:
 *  ① 능력 태그 매칭 → ② 과거 성공 이력 키워드 겹침(성공 건만, 수습 직원 제외) → ③ 마스터 직접 수행.
 * 항상 결정적(같은 입력 → 같은 결과)이며, reason 에는 실측 수치만 쓴다.
 */
export function routeWorkRequest(input: {
  requestText: string;
  blueprint: ModyAgentOrgBlueprint;
  performanceRecords?: readonly ModyAgentPerformanceRecordLike[];
}): ModyAgentRoutingDecision {
  const requestText = clampText(input.requestText, 500);
  const keywords = extractWorkKeywords(requestText);
  const records = input.performanceRecords ?? [];
  const workingMembers = input.blueprint.members.filter((member) => member.memberStatus !== "retired");

  const candidates: ModyAgentRoutingCandidate[] = workingMembers
    .map((member) => {
      const matchedTags = matchTagsAgainstKeywords(member.capabilityTags, keywords);
      return {
        teammateId: member.teammateId,
        roleTitle: member.roleTitle,
        matchedTags,
        matchedTagCount: matchedTags.length,
        pastSuccessCount: successCountFor(records, member.teammateId),
      };
    })
    .sort(compareCandidates);

  const tagMatched = candidates.filter((candidate) => candidate.matchedTagCount > 0);
  const tagPrimary = tagMatched.length > 0 ? tagMatched[0] : undefined;
  if (tagPrimary) {
    const primary = tagPrimary;
    return {
      contract: "agent_routing_decision_v1",
      requestText,
      extractedKeywords: keywords,
      method: "capability-tags",
      primary,
      alternatives: tagMatched.slice(1, 4),
      reason: `'${primary.matchedTags.join("', '")}' 담당 태그 ${primary.matchedTagCount}개가 일치해 ${primary.roleTitle}에게 배정했어요.`,
    };
  }

  // 학습 폴백: 수습(probation) 직원의 기록은 공유 라우팅 학습에 반영하지 않는다.
  const activeMemberIds = new Set(
    workingMembers.filter((member) => member.memberStatus === "active").map((member) => member.teammateId),
  );
  let learned: { candidate: ModyAgentRoutingCandidate; overlap: number } | null = null;
  for (const candidate of candidates) {
    if (!activeMemberIds.has(candidate.teammateId)) continue;
    const successKeywords = new Set(
      records
        .filter((record) => record.teammateId === candidate.teammateId && record.outcome === "success")
        .flatMap((record) => [...(record.keywords ?? [])]),
    );
    const overlap = keywords.filter((keyword) => successKeywords.has(keyword)).length;
    if (overlap >= 2 && (!learned || overlap > learned.overlap)) {
      learned = { candidate, overlap };
    }
  }
  if (learned) {
    return {
      contract: "agent_routing_decision_v1",
      requestText,
      extractedKeywords: keywords,
      method: "learned-overlap",
      primary: learned.candidate,
      alternatives: [],
      reason: `비슷한 업무를 성공한 기록(키워드 ${learned.overlap}개 겹침, 성공 ${learned.candidate.pastSuccessCount}회)이 있어 ${learned.candidate.roleTitle}에게 배정했어요.`,
    };
  }

  return {
    contract: "agent_routing_decision_v1",
    requestText,
    extractedKeywords: keywords,
    method: "master-fallback",
    primary: null,
    alternatives: candidates.slice(0, 3),
    reason: "맡길 담당 직원이 없어 메인 컨트롤이 직접 처리합니다.",
  };
}

/**
 * 능력 공백 리포트 — 담당 직원 부재를 감지해 "새 직원 채용 제안"으로 이을지 판단한다.
 * 새 직원 제안은 (a) 태그가 하나도 안 맞고 (b) 요청이 실질 업무(키워드 2개 이상)일 때만 권고한다.
 */
export function buildCapabilityGapReport(input: {
  requestText: string;
  blueprint: ModyAgentOrgBlueprint;
  performanceRecords?: readonly ModyAgentPerformanceRecordLike[];
}): ModyCapabilityGapReport {
  const decision = routeWorkRequest(input);
  const bestMatch = decision.primary ?? decision.alternatives[0] ?? null;
  const matchedSet = new Set((bestMatch?.matchedTags ?? []).map((tag) => tag.toLocaleLowerCase("ko-KR")));
  const missingTags = decision.extractedKeywords.filter(
    (keyword) => ![...matchedSet].some((tag) => keyword.includes(tag) || tag.includes(keyword)),
  );

  let recommendation: ModyCapabilityGapRecommendation;
  if (decision.method !== "master-fallback") {
    recommendation = "use_existing";
  } else if (decision.extractedKeywords.length >= 2) {
    recommendation = "propose_new_agent";
  } else {
    recommendation = "master_fallback";
  }

  return {
    contract: "capability_gap_report_v1",
    requestText: decision.requestText,
    extractedKeywords: decision.extractedKeywords,
    bestMatch,
    missingTags,
    recommendation,
  };
}

/**
 * 스펙 버전 변경(개선 적용/롤백)을 조직 blueprint 에 반영한다 — 이 동기화가 없으면
 * 개선으로 추가된 담당 태그가 라우팅에 반영되지 않아, 방금 개선한 직원이 있는데도
 * 중복 채용 제안이 만들어진다. 적용/롤백 직후 반드시 호출한다.
 */
export function syncAgentOrgMemberSpec(
  blueprint: ModyAgentOrgBlueprint,
  specVersion: ModyAgentSpecVersion,
  at?: string,
): ModyAgentOrgBlueprint {
  const member = blueprint.members.find((candidate) => candidate.teammateId === specVersion.teammateId);
  if (!member) throw new Error("조직에 없는 직원의 스펙은 동기화할 수 없습니다.");
  const updatedAt = at ?? new Date().toISOString();
  return {
    ...blueprint,
    version: blueprint.version + 1,
    updatedAt,
    members: blueprint.members.map((candidate) =>
      candidate.teammateId === specVersion.teammateId
        ? {
            ...candidate,
            roleTitle: clampText(specVersion.roleTitle, 48) || candidate.roleTitle,
            capabilityTags: sanitizeCapabilityTags(specVersion.capabilityTags),
            activeSpecVersion: specVersion.specVersion,
          }
        : candidate,
    ),
  };
}

/** 직원의 현재 활성 스펙 버전을 찾는다(없으면 null). */
export function findActiveAgentSpecVersion(
  versions: readonly ModyAgentSpecVersion[],
  teammateId: string,
): ModyAgentSpecVersion | null {
  return (
    versions.find(
      (version) => version.teammateId === teammateId && version.versionStatus === "active",
    ) ?? null
  );
}

/**
 * 스펙 버전 추가 — append-only. 다음 버전 번호는 함수가 계산하고,
 * 기존 활성 버전은 superseded 로 전이된다(레코드 삭제·수정 없음).
 */
export function appendAgentSpecVersion(input: {
  versions: readonly ModyAgentSpecVersion[];
  teammateId: string;
  fields: Partial<ModyAgentSpecFields>;
  sourceProposalId?: string | null;
  createdAt?: string;
}): { versions: ModyAgentSpecVersion[]; appended: ModyAgentSpecVersion } {
  const teammateId = clampText(input.teammateId, 120);
  if (!teammateId) throw new Error("직원 id 없이 스펙 버전을 만들 수 없습니다.");
  const existing = input.versions.filter((version) => version.teammateId === teammateId);
  const nextVersionNumber = existing.reduce((max, version) => Math.max(max, version.specVersion), 0) + 1;
  const appended: ModyAgentSpecVersion = {
    contract: "agent_spec_version_v1",
    teammateId,
    specVersion: nextVersionNumber,
    ...sanitizeAgentSpecFields(input.fields),
    sourceProposalId: input.sourceProposalId ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    versionStatus: "active",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  const versions = input.versions.map((version) =>
    version.teammateId === teammateId && version.versionStatus === "active"
      ? { ...version, versionStatus: "superseded" as const }
      : version,
  );
  return { versions: [...versions, appended], appended };
}

/**
 * 스펙 롤백 — 과거 superseded 버전을 다시 활성화한다. 현재 활성 버전은 rolled_back 으로
 * 전이되어 "이 버전은 사용자 결정으로 되돌려졌다"가 기록에 남는다.
 */
export function rollbackAgentSpecVersion(input: {
  versions: readonly ModyAgentSpecVersion[];
  teammateId: string;
  toSpecVersion: number;
}): { versions: ModyAgentSpecVersion[]; restored: ModyAgentSpecVersion } {
  const target = input.versions.find(
    (version) => version.teammateId === input.teammateId && version.specVersion === input.toSpecVersion,
  );
  if (!target) throw new Error("되돌릴 스펙 버전이 없습니다.");
  if (target.versionStatus === "active") {
    throw new Error("이미 활성 상태인 버전으로는 되돌릴 수 없습니다.");
  }
  const versions = input.versions.map((version) => {
    if (version.teammateId !== input.teammateId) return version;
    if (version.specVersion === input.toSpecVersion) {
      return { ...version, versionStatus: "active" as const };
    }
    if (version.versionStatus === "active") {
      return { ...version, versionStatus: "rolled_back" as const };
    }
    return version;
  });
  const restored = versions.find(
    (version) => version.teammateId === input.teammateId && version.specVersion === input.toSpecVersion,
  ) as ModyAgentSpecVersion;
  return { versions, restored };
}

let delegationPlanSequence = 0;

export function createDelegationPlan(input: {
  requestText: string;
  steps: Array<Partial<ModyAgentDelegationPlanStep>>;
  createdAt?: string;
}): ModyAgentDelegationPlan {
  const steps = (input.steps ?? [])
    .map((step, index) => ({
      order: index + 1,
      teammateId: step.teammateId ? clampText(step.teammateId, 120) : null,
      proposalRef: step.proposalRef ? clampText(step.proposalRef, 120) : null,
      taskSummary: clampText(step.taskSummary, 240),
      expectedArtifactKind: (["mail", "approval", "report"] as const).includes(
        step.expectedArtifactKind as ModyAgentDelegationArtifactKind,
      )
        ? (step.expectedArtifactKind as ModyAgentDelegationArtifactKind)
        : "report",
    }))
    .filter((step) => step.taskSummary);
  if (steps.length === 0) throw new Error("위임 계획에는 단계가 1개 이상 필요합니다.");
  for (const step of steps) {
    if (!step.teammateId && !step.proposalRef) {
      throw new Error("각 단계는 담당 직원 또는 채용 제안 참조 중 하나가 필요합니다.");
    }
  }
  delegationPlanSequence += 1;
  return {
    contract: "delegation_plan_v1",
    // 프로세스 재시작 후에도 과거 영속 기록과 충돌하지 않도록 시간+난수 엔트로피를 섞는다.
    planId: `delegation-plan-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-${delegationPlanSequence}`,
    requestText: clampText(input.requestText, 500),
    steps,
    requiresApproval: true,
    createdAt: input.createdAt ?? new Date().toISOString(),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}
