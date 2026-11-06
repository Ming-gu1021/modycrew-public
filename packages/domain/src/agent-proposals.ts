/**
 * 에이전트 조직 제안 수명주기 + 성과 기록.
 *
 * 원칙:
 *  - 채용·개선·퇴사·다단계 위임은 전부 "제안"이다. 이 모듈에는 제안을 실행(채용/스펙 교체)
 *    으로 바로 잇는 경로가 없고, 승인(approved) 상태를 거친 뒤에만 apply 함수가 동작한다.
 *  - 개선 제안은 baseSpecVersion 낙관적 잠금 — 제안 사이에 스펙이 바뀌면 적용을 거부하고
 *    재제안하게 한다(기존 자동화 보호).
 *  - refused(권한 없음/연결 필요/능력 없음)는 에러가 아니라 1급 정상 결과값이다.
 *  - 성과 학습은 success 확인 건만 라우팅에 반영한다. 기록은 500건 캡.
 */

import {
  appendAgentSpecVersion,
  findActiveAgentSpecVersion,
  sanitizeAgentSpecFields,
  type ModyAgentDelegationPlan,
  type ModyAgentSpecFields,
  type ModyAgentSpecVersion,
  type ModyCapabilityGapReport,
} from "./agent-organization.js";

export type ModyAgentProposalKind = "create_agent" | "improve_agent" | "retire_agent" | "delegation_plan";

export type ModyAgentProposalStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "held"
  | "applied"
  | "rolled_back";

export type ModyAgentPerformanceOutcome = "success" | "failure" | "refused";

export type ModyAgentRefusedReason =
  | "no_capability"
  | "needs_connection"
  | "needs_user_approval"
  | "input_rejected";

export type ModyAgentPerformanceRecord = {
  teammateId: string;
  taskKind: string;
  outcome: ModyAgentPerformanceOutcome;
  refusedReason?: ModyAgentRefusedReason;
  keywords: string[];
  sourceThreadId?: string;
  recordedAt: string;
};

export type ModyAgentPerformanceSummary = {
  teammateId: string;
  successCount: number;
  failureCount: number;
  refusedCount: number;
  recentFailedTaskKinds: string[];
};

export type ModyAgentSpecProposal = {
  contract: "agent_spec_proposal_v1";
  proposalId: string;
  kind: ModyAgentProposalKind;
  targetTeammateId?: string;
  /** improve 제안 필수 — 적용 시 현재 활성 버전과 일치해야 하는 낙관적 잠금. */
  baseSpecVersion?: number;
  /** 한국어 한 문단 — 무엇이 왜 필요한지. */
  pitch: string;
  reasonEvidence: {
    missingCapabilities: string[];
    matchedTagCount?: number;
    performanceSummary?: ModyAgentPerformanceSummary;
  };
  draftSpec?: ModyAgentSpecFields;
  delegationPlan?: ModyAgentDelegationPlan;
  /** improve 제안 필수 — 영향받는 기존 자동화/업무팩 id 목록(없으면 빈 배열 명시). */
  affectedAutomationIds?: string[];
  proposalStatus: ModyAgentProposalStatus;
  createdAt: string;
  decidedAt?: string;
  appliedAt?: string;
  userMessage: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

const performanceLedgerCap = 500;

let proposalSequence = 0;

function clampText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function nextProposalId(kind: ModyAgentProposalKind): string {
  proposalSequence += 1;
  // 제안은 디스크에 영속되고 승인함 카드 id(agent-org-proposal-<id>)로도 파생되므로,
  // 프로세스 재시작 시 순번이 0부터 다시 시작해도 과거 제안·카드와 충돌하지 않게
  // 시간+난수 엔트로피를 섞는다(충돌 시 미결정 카드가 소리 없이 교체되는 사고 방지).
  return `agent-proposal-${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-${proposalSequence}`;
}

/**
 * 새 직원 채용 제안 — "기존 직원으론 안 되는 이유"(부족 능력)가 비어 있으면 만들 수 없다.
 * 마스터가 스펙 초안(draftSpec)을 스스로 구성해 붙이고, 승인 즉시 기존 채용 경로로
 * 입사시킬 수 있는 형태(AITeammate 필드 미러)여야 한다.
 */
export function createAgentCreationProposal(input: {
  gapReport: ModyCapabilityGapReport;
  draftSpec: Partial<ModyAgentSpecFields>;
  createdAt?: string;
}): ModyAgentSpecProposal {
  const missing = input.gapReport.missingTags.filter(Boolean);
  if (input.gapReport.recommendation !== "propose_new_agent" || missing.length === 0) {
    throw new Error("부족 능력이 확인되지 않으면 채용 제안을 만들 수 없습니다.");
  }
  const draftSpec = sanitizeAgentSpecFields(input.draftSpec);
  if (!draftSpec.roleTitle) {
    throw new Error("채용 제안에는 역할 이름이 필요합니다.");
  }
  return {
    contract: "agent_spec_proposal_v1",
    proposalId: nextProposalId("create_agent"),
    kind: "create_agent",
    pitch: clampText(
      `'${input.gapReport.requestText.slice(0, 80)}' 요청을 맡을 직원이 없어요. '${missing.slice(0, 3).join("', '")}' 업무를 담당할 ${draftSpec.roleTitle} 채용을 제안합니다.`,
      360,
    ),
    reasonEvidence: {
      missingCapabilities: missing,
      matchedTagCount: input.gapReport.bestMatch?.matchedTagCount ?? 0,
    },
    draftSpec,
    proposalStatus: "proposed",
    createdAt: input.createdAt ?? new Date().toISOString(),
    userMessage: `새 직원(${draftSpec.roleTitle}) 채용 제안을 만들었어요. 승인 전에는 아무 직원도 생성되지 않습니다.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/**
 * 직원 개선 제안 — 실측 성과 근거 + 현재 스펙 버전(낙관적 잠금) + 영향받는 자동화 목록 필수.
 */
export function createAgentImprovementProposal(input: {
  targetTeammateId: string;
  baseSpecVersion: number;
  performanceSummary: ModyAgentPerformanceSummary;
  draftSpec: Partial<ModyAgentSpecFields>;
  affectedAutomationIds: string[];
  createdAt?: string;
}): ModyAgentSpecProposal {
  const targetTeammateId = clampText(input.targetTeammateId, 120);
  if (!targetTeammateId) throw new Error("개선 대상 직원 id가 필요합니다.");
  if (!Number.isInteger(input.baseSpecVersion) || input.baseSpecVersion < 1) {
    throw new Error("개선 제안에는 기준 스펙 버전이 필요합니다.");
  }
  if (!Array.isArray(input.affectedAutomationIds)) {
    throw new Error("영향받는 자동화 목록(없으면 빈 배열)을 명시해야 합니다.");
  }
  const summary = input.performanceSummary;
  const draftSpec = sanitizeAgentSpecFields(input.draftSpec);
  return {
    contract: "agent_spec_proposal_v1",
    proposalId: nextProposalId("improve_agent"),
    kind: "improve_agent",
    targetTeammateId,
    baseSpecVersion: input.baseSpecVersion,
    pitch: clampText(
      `최근 성공 ${summary.successCount}회 · 실패 ${summary.failureCount}회 기록을 근거로 업무 지침 개선을 제안합니다. 승인 전에는 바뀌지 않고, 적용 후에도 이전 버전으로 되돌릴 수 있어요.`,
      360,
    ),
    reasonEvidence: {
      missingCapabilities: [],
      performanceSummary: summary,
    },
    draftSpec,
    affectedAutomationIds: input.affectedAutomationIds.map((id) => clampText(id, 120)).filter(Boolean),
    proposalStatus: "proposed",
    createdAt: input.createdAt ?? new Date().toISOString(),
    userMessage: "직원 개선 제안을 만들었어요. 승인해야만 적용되고, 언제든 이전 버전으로 되돌릴 수 있습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

export function createDelegationPlanProposal(input: {
  plan: ModyAgentDelegationPlan;
  createdAt?: string;
}): ModyAgentSpecProposal {
  return {
    contract: "agent_spec_proposal_v1",
    proposalId: nextProposalId("delegation_plan"),
    kind: "delegation_plan",
    pitch: clampText(
      `여러 직원이 나눠 처리할 위임 계획(${input.plan.steps.length}단계)입니다. 승인해야 실행됩니다.`,
      360,
    ),
    reasonEvidence: { missingCapabilities: [] },
    delegationPlan: input.plan,
    proposalStatus: "proposed",
    createdAt: input.createdAt ?? new Date().toISOString(),
    userMessage: `위임 계획 ${input.plan.steps.length}단계를 승인 대기로 올렸어요.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

export function createAgentRetirementProposal(input: {
  targetTeammateId: string;
  performanceSummary: ModyAgentPerformanceSummary;
  handoverNote: string;
  createdAt?: string;
}): ModyAgentSpecProposal {
  const targetTeammateId = clampText(input.targetTeammateId, 120);
  if (!targetTeammateId) throw new Error("퇴사 대상 직원 id가 필요합니다.");
  return {
    contract: "agent_spec_proposal_v1",
    proposalId: nextProposalId("retire_agent"),
    kind: "retire_agent",
    targetTeammateId,
    pitch: clampText(
      `최근 성공 ${input.performanceSummary.successCount}회 · 실패 ${input.performanceSummary.failureCount}회 기록을 근거로 퇴사를 제안합니다. 기록은 보존되고, 담당 업무는 ${clampText(input.handoverNote, 120) || "메인 컨트롤"}이 이어받습니다.`,
      360,
    ),
    reasonEvidence: {
      missingCapabilities: [],
      performanceSummary: input.performanceSummary,
    },
    proposalStatus: "proposed",
    createdAt: input.createdAt ?? new Date().toISOString(),
    userMessage: "직원 퇴사 제안을 만들었어요. 승인 전에는 아무것도 바뀌지 않습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

const legalDecisionTransitions: Record<string, ModyAgentProposalStatus[]> = {
  proposed: ["approved", "rejected", "held"],
  held: ["proposed"],
  approved: ["applied"],
  applied: ["rolled_back"],
};

function assertTransition(from: ModyAgentProposalStatus, to: ModyAgentProposalStatus) {
  if (!(legalDecisionTransitions[from] ?? []).includes(to)) {
    throw new Error(`제안 상태를 ${from}에서 ${to}로 바꿀 수 없습니다.`);
  }
}

/** 사용자 결정(승인/거절/보류) — proposed 상태에서만 가능. */
export function decideAgentProposal(
  proposal: ModyAgentSpecProposal,
  decision: "approved" | "rejected" | "held",
  decidedAt?: string,
): ModyAgentSpecProposal {
  assertTransition(proposal.proposalStatus, decision);
  return {
    ...proposal,
    proposalStatus: decision,
    decidedAt: decidedAt ?? new Date().toISOString(),
  };
}

/** 보류된 제안 재상정. */
export function reopenHeldAgentProposal(
  proposal: ModyAgentSpecProposal,
  at?: string,
): ModyAgentSpecProposal {
  assertTransition(proposal.proposalStatus, "proposed");
  return { ...proposal, proposalStatus: "proposed", decidedAt: at ?? new Date().toISOString() };
}

export type ModyAgentProposalApplyResult =
  | {
      status: "agent_proposal_applied";
      proposal: ModyAgentSpecProposal;
      versions: ModyAgentSpecVersion[];
      appliedVersion: ModyAgentSpecVersion;
      userMessage: string;
      externalMutation: false;
    }
  | {
      status: "agent_proposal_apply_conflict";
      proposal: ModyAgentSpecProposal;
      versions: ModyAgentSpecVersion[];
      conflictReason: string;
      userMessage: string;
      externalMutation: false;
    };

/**
 * 승인된 채용 제안 적용 — 새 직원의 스펙 v1 을 만든다. 실제 직원 생성(채널·저장)은
 * 웹의 기존 채용 경로가 이 결과를 받아 수행한다.
 */
export function applyApprovedCreateAgentProposal(input: {
  proposal: ModyAgentSpecProposal;
  versions: readonly ModyAgentSpecVersion[];
  newTeammateId: string;
  appliedAt?: string;
}): ModyAgentProposalApplyResult {
  const { proposal } = input;
  assertTransition(proposal.proposalStatus, "applied");
  if (proposal.kind !== "create_agent" || !proposal.draftSpec) {
    throw new Error("채용 제안이 아니면 채용 적용을 할 수 없습니다.");
  }
  // 채용 적용은 반드시 "새" 직원 id 여야 한다. 기존 직원 id 를 넘기면 개선 경로의
  // 낙관적 잠금·영향 자동화 고지를 모두 우회한 스펙 교체가 되므로 충돌로 거부한다.
  const normalizedNewTeammateId = clampText(input.newTeammateId, 120);
  if (input.versions.some((version) => version.teammateId === normalizedNewTeammateId)) {
    return {
      status: "agent_proposal_apply_conflict",
      proposal,
      versions: [...input.versions],
      conflictReason: "이미 스펙 기록이 있는 직원 id로는 채용을 적용할 수 없습니다.",
      userMessage: "이미 존재하는 직원과 겹쳐 채용을 적용하지 않았어요. 새 직원 id로 다시 시도해야 합니다.",
      externalMutation: false,
    };
  }
  const appliedAt = input.appliedAt ?? new Date().toISOString();
  const { versions, appended } = appendAgentSpecVersion({
    versions: input.versions,
    teammateId: normalizedNewTeammateId,
    fields: proposal.draftSpec,
    sourceProposalId: proposal.proposalId,
    createdAt: appliedAt,
  });
  return {
    status: "agent_proposal_applied",
    proposal: { ...proposal, proposalStatus: "applied", appliedAt },
    versions,
    appliedVersion: appended,
    userMessage: `${appended.roleTitle} 채용이 승인되어 수습으로 합류합니다.`,
    externalMutation: false,
  };
}

/**
 * 승인된 개선 제안 적용 — baseSpecVersion 낙관적 잠금. 제안 이후 스펙이 바뀌었으면
 * 적용을 거부하고 충돌 상태를 반환한다(자동 적용 금지, 재제안 유도).
 */
export function applyApprovedImproveAgentProposal(input: {
  proposal: ModyAgentSpecProposal;
  versions: readonly ModyAgentSpecVersion[];
  appliedAt?: string;
}): ModyAgentProposalApplyResult {
  const { proposal } = input;
  assertTransition(proposal.proposalStatus, "applied");
  if (proposal.kind !== "improve_agent" || !proposal.targetTeammateId || !proposal.draftSpec) {
    throw new Error("개선 제안이 아니면 개선 적용을 할 수 없습니다.");
  }
  const active = findActiveAgentSpecVersion(input.versions, proposal.targetTeammateId);
  if (!active || active.specVersion !== proposal.baseSpecVersion) {
    return {
      status: "agent_proposal_apply_conflict",
      proposal,
      versions: [...input.versions],
      conflictReason: `제안 기준 버전(v${proposal.baseSpecVersion})과 현재 활성 버전(v${active?.specVersion ?? "없음"})이 달라 적용하지 않았습니다.`,
      userMessage: "제안 이후 직원 스펙이 바뀌어 적용하지 않았어요. 최신 기준으로 다시 제안할게요.",
      externalMutation: false,
    };
  }
  const appliedAt = input.appliedAt ?? new Date().toISOString();
  // 변경분만 담긴 개선안(예: 지침 한 줄)이 나머지 필드를 빈 값으로 덮어쓰지 않도록
  // 현재 활성 버전과 빈값-보존 병합한다. (draftSpec 은 sanitize 를 거쳐 누락 필드가
  // ""/[] 로 채워져 있으므로, 병합 기준은 "비어 있으면 기존 값 유지"다.)
  const draft = proposal.draftSpec;
  const mergedFields: ModyAgentSpecFields = {
    name: draft.name || active.name,
    roleTitle: draft.roleTitle || active.roleTitle,
    brief: draft.brief || active.brief,
    channelName: draft.channelName || active.channelName,
    skillIds: draft.skillIds.length ? draft.skillIds : active.skillIds,
    instructions: draft.instructions.length ? draft.instructions : active.instructions,
    capabilityTags: draft.capabilityTags.length ? draft.capabilityTags : active.capabilityTags,
  };
  const { versions, appended } = appendAgentSpecVersion({
    versions: input.versions,
    teammateId: proposal.targetTeammateId,
    fields: mergedFields,
    sourceProposalId: proposal.proposalId,
    createdAt: appliedAt,
  });
  return {
    status: "agent_proposal_applied",
    proposal: { ...proposal, proposalStatus: "applied", appliedAt },
    versions,
    appliedVersion: appended,
    userMessage: `${appended.roleTitle} 지침이 v${appended.specVersion}로 개선됐어요. 언제든 이전 버전으로 되돌릴 수 있습니다.`,
    externalMutation: false,
  };
}

/** 성과 기록 — refused 는 사유와 함께 1급 정상값으로 기록한다. 500건 캡(오래된 것부터 제거). */
export function recordAgentPerformance(input: {
  ledger: readonly ModyAgentPerformanceRecord[];
  record: {
    teammateId: string;
    taskKind: string;
    outcome: ModyAgentPerformanceOutcome;
    refusedReason?: ModyAgentRefusedReason;
    keywords?: string[];
    sourceThreadId?: string;
    recordedAt?: string;
  };
}): ModyAgentPerformanceRecord[] {
  const teammateId = clampText(input.record.teammateId, 120);
  if (!teammateId) throw new Error("성과 기록에는 직원 id가 필요합니다.");
  if (!["success", "failure", "refused"].includes(input.record.outcome)) {
    throw new Error("성과 결과값이 올바르지 않습니다.");
  }
  if (input.record.outcome === "refused" && !input.record.refusedReason) {
    throw new Error("거절 기록에는 사유가 필요합니다.");
  }
  const record: ModyAgentPerformanceRecord = {
    teammateId,
    taskKind: clampText(input.record.taskKind, 60) || "general",
    outcome: input.record.outcome,
    ...(input.record.refusedReason ? { refusedReason: input.record.refusedReason } : {}),
    keywords: (input.record.keywords ?? []).map((keyword) => clampText(keyword, 24)).filter(Boolean).slice(0, 12),
    ...(input.record.sourceThreadId ? { sourceThreadId: clampText(input.record.sourceThreadId, 120) } : {}),
    recordedAt: input.record.recordedAt ?? new Date().toISOString(),
  };
  const next = [...input.ledger, record];
  return next.length > performanceLedgerCap ? next.slice(next.length - performanceLedgerCap) : next;
}

export function summarizeAgentPerformance(
  ledger: readonly ModyAgentPerformanceRecord[],
  teammateId: string,
): ModyAgentPerformanceSummary {
  const records = ledger.filter((record) => record.teammateId === teammateId);
  const failures = records.filter((record) => record.outcome === "failure");
  const recentFailedTaskKinds: string[] = [];
  for (let index = failures.length - 1; index >= 0 && recentFailedTaskKinds.length < 4; index -= 1) {
    const reason = failures[index]?.taskKind;
    if (reason && !recentFailedTaskKinds.includes(reason)) recentFailedTaskKinds.push(reason);
  }
  return {
    teammateId,
    successCount: records.filter((record) => record.outcome === "success").length,
    failureCount: failures.length,
    refusedCount: records.filter((record) => record.outcome === "refused").length,
    recentFailedTaskKinds,
  };
}

/**
 * 개선 제안 트리거 판단 — 실측 카운트 기반. 기록이 충분하고(기본 6건 이상)
 * 실패가 성공보다 많을 때만 제안을 권한다. 제안일 뿐 자동 적용 경로는 없다.
 */
export function shouldProposeAgentImprovement(
  summary: ModyAgentPerformanceSummary,
  options: { minRecords?: number } = {},
): { shouldPropose: boolean; reason: string } {
  const minRecords = options.minRecords ?? 6;
  const total = summary.successCount + summary.failureCount;
  if (total < minRecords) {
    return { shouldPropose: false, reason: `기록 ${total}건은 판단하기에 부족합니다(최소 ${minRecords}건).` };
  }
  if (summary.failureCount > summary.successCount) {
    return {
      shouldPropose: true,
      reason: `최근 성공 ${summary.successCount}회보다 실패 ${summary.failureCount}회가 많아 개선 제안이 필요합니다.`,
    };
  }
  return {
    shouldPropose: false,
    reason: `성공 ${summary.successCount}회 · 실패 ${summary.failureCount}회로 안정 범위입니다.`,
  };
}

export type ModyAgentProposalInboxPayload = {
  id: string;
  title: string;
  sourceLabel: string;
  senderLabel: string;
  body: string;
  summary: string;
  status: "approval_pending";
  riskLabel: "medium";
  riskSignals: Array<{ id: string; label: string; riskLabel: "medium"; reason: string }>;
  draft: {
    id: string;
    toneLabel: string;
    body: string;
    operationKind: "stage_approval";
    requiresApprovalBeforeSend: true;
  };
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

const proposalKindLabels: Record<ModyAgentProposalKind, string> = {
  create_agent: "새 직원 채용",
  improve_agent: "직원 지침 개선",
  retire_agent: "직원 퇴사",
  delegation_plan: "위임 계획 승인",
};

/**
 * 승인함 카드 페이로드 — 기존 status/operationKind enum 값만 사용한다(확장 금지).
 * 카드 구분은 sourceLabel 'AI 조직 제안' + 제목 프리픽스로 한다.
 */
export function buildAgentProposalInboxPayload(
  proposal: ModyAgentSpecProposal,
): ModyAgentProposalInboxPayload {
  const kindLabel = proposalKindLabels[proposal.kind];
  const bodyLines = [
    `## 제안 요지`,
    proposal.pitch,
    "",
    `## 근거`,
    proposal.reasonEvidence.missingCapabilities.length
      ? `- 부족한 담당 능력: ${proposal.reasonEvidence.missingCapabilities.join(", ")}`
      : "",
    proposal.reasonEvidence.performanceSummary
      ? `- 실측 기록: 성공 ${proposal.reasonEvidence.performanceSummary.successCount}회 · 실패 ${proposal.reasonEvidence.performanceSummary.failureCount}회 · 거절 ${proposal.reasonEvidence.performanceSummary.refusedCount}회`
      : "",
    proposal.draftSpec
      ? [`## 제안 스펙`, `- 역할: ${proposal.draftSpec.roleTitle}`, `- 담당 태그: ${proposal.draftSpec.capabilityTags.join(", ") || "(없음)"}`, `- 지침 ${proposal.draftSpec.instructions.length}줄`].join("\n")
      : "",
    proposal.delegationPlan
      ? [`## 위임 단계`, ...proposal.delegationPlan.steps.map((step) => `${step.order}. ${step.taskSummary} (${step.expectedArtifactKind})`)].join("\n")
      : "",
    proposal.affectedAutomationIds && proposal.affectedAutomationIds.length
      ? `## 영향받는 자동화\n- ${proposal.affectedAutomationIds.join("\n- ")}\n(적용 후에도 이전 버전으로 되돌릴 수 있습니다)`
      : "",
    "",
    "## 승인 경계",
    "승인 전에는 어떤 직원도 생성·변경·퇴사되지 않고, 어떤 위임도 실행되지 않습니다.",
  ].filter(Boolean);
  return {
    id: `agent-org-proposal-${proposal.proposalId}`,
    title: `[AI 조직 제안] ${kindLabel}${proposal.draftSpec?.roleTitle ? `: ${proposal.draftSpec.roleTitle}` : ""}`.slice(0, 120),
    sourceLabel: "AI 조직 제안",
    senderLabel: "메인 컨트롤 (마스터)",
    body: bodyLines.join("\n").slice(0, 4000),
    summary: proposal.pitch.slice(0, 500),
    status: "approval_pending",
    riskLabel: "medium",
    riskSignals: [
      {
        id: "agent-org-change",
        label: "AI 직원 구성 변경",
        riskLabel: "medium",
        reason: "승인 전에는 실행되지 않으며, 적용 후에도 이전 상태로 되돌릴 수 있습니다.",
      },
    ],
    draft: {
      id: `agent-org-proposal-draft-${proposal.proposalId}`,
      toneLabel: "조직 제안",
      body: proposal.pitch,
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}
