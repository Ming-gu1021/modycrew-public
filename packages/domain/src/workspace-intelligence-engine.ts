import {
  ModyCapabilityGrantGate,
  modyCapabilityGrantPolicyVersion,
  type ModyCapabilityGrantDecision,
  type ModyCapabilityGrantRequest,
  type ModyCatalogToolInstallMode,
} from "./capability-grant.js";
import {
  createDocumentAutomationRecommendations,
  type ModyDocumentAutomationRecommendation,
} from "./document-automation-recommendation.js";
import type {
  ModyDocumentLearningCategory,
  ModyDocumentLearningPlan,
} from "./local-document-learning.js";
import type { ModyWorkPackId } from "./work-pack.js";

export const modyWorkspaceIntelligenceSchemaVersion = 1 as const;
const modyWorkspaceIntelligenceWorkPackIds = new Set<ModyWorkPackId>([
  "inquiry_response",
  "schedule_coordination",
  "report_cleanup",
  "inventory_reorder",
  "tax_contract_archive",
]);
const modyWorkspaceIntelligenceOutcomeStatuses =
  new Set<ModyAgentWorkOutcomeStatus>([
    "accepted",
    "corrected",
    "rejected",
    "failed",
  ]);
const modyWorkspaceIntelligenceCorrectionSignals =
  new Set<ModyAgentCorrectionSignal>([
    "missing_source",
    "wrong_template",
    "wrong_assignee",
    "wrong_schedule",
    "calculation_error",
    "tone_mismatch",
    "approval_boundary_missed",
    "other",
  ]);

export type ModyAgentCorrectionSignal =
  | "missing_source"
  | "wrong_template"
  | "wrong_assignee"
  | "wrong_schedule"
  | "calculation_error"
  | "tone_mismatch"
  | "approval_boundary_missed"
  | "other";

export type ModyAgentWorkOutcomeStatus = "accepted" | "corrected" | "rejected" | "failed";

export type ModyAgentWorkOutcome = {
  runId: string;
  agentId: string;
  workPackId?: ModyWorkPackId;
  status: ModyAgentWorkOutcomeStatus;
  finishedAt: string;
  qualityScore?: number;
  correctionSignals?: readonly ModyAgentCorrectionSignal[];
};

export type ModyAgentWorkPackPerformance = {
  workPackId: ModyWorkPackId;
  totalRuns: number;
  acceptedRuns: number;
  correctedRuns: number;
  rejectedRuns: number;
  failedRuns: number;
  qualityScoreTotal: number;
  qualityScoreCount: number;
  correctionCounts: Partial<Record<ModyAgentCorrectionSignal, number>>;
  lastOutcomeAt: string;
};

export type ModyAgentCapabilityProfile = {
  agentId: string;
  displayName: string;
  availability: "ready" | "needs_setup" | "disabled";
  supportedWorkPackIds: readonly ModyWorkPackId[];
  activeSkillIds: readonly string[];
};

export type ModySkillCatalogTrust = "verified_catalog" | "publisher_signed" | "unverified";

export type ModySkillCatalogCandidate = {
  skillId: string;
  title: string;
  version: string;
  publisher: string;
  sourceUrl: string;
  license: string;
  integritySha256: string;
  trust: ModySkillCatalogTrust;
  installMode: ModyCatalogToolInstallMode;
  supportedWorkPackIds: readonly ModyWorkPackId[];
  requestedCapabilities: readonly string[];
  requestedNetworkHosts: readonly string[];
  requestedFolderScope: "none" | "selected_workspace_only";
};

export type ModyWorkspaceWorkSignal = {
  workPackId: ModyWorkPackId;
  observationCount: number;
  evidenceCount: number;
  confidence: number;
  categories: ModyDocumentLearningCategory[];
  sourceSessionIds: string[];
  lastSeenAt: string;
};

export type ModyAgentLearningProfile = {
  agentId: string;
  totalRuns: number;
  acceptedRuns: number;
  correctedRuns: number;
  rejectedRuns: number;
  failedRuns: number;
  qualityScoreTotal: number;
  qualityScoreCount: number;
  correctionCounts: Partial<Record<ModyAgentCorrectionSignal, number>>;
  workPackIds: ModyWorkPackId[];
  workPackPerformance: ModyAgentWorkPackPerformance[];
  lastOutcomeAt: string;
};

export type ModyWorkspaceIntelligenceState = {
  schemaVersion: typeof modyWorkspaceIntelligenceSchemaVersion;
  workspaceId: string;
  cycleCount: number;
  processedLearningSessionIds: string[];
  processedAgentRunIds: string[];
  workSignals: ModyWorkspaceWorkSignal[];
  agentLearningProfiles: ModyAgentLearningProfile[];
  pendingSkillProposalIds: string[];
  lastObservedAt?: string;
  memoryBoundary: {
    rawFileContentStored: false;
    rawSecretsStored: false;
    absolutePathsStored: false;
    learnedRulesAutoApplied: false;
  };
};

export type ModyAgentAssignmentRecommendation = {
  workPackId: ModyWorkPackId;
  status: "recommended" | "specialist_needed";
  agentId?: string;
  agentLabel?: string;
  confidence: number;
  reasons: string[];
  evidenceCount: number;
  autoDispatch: false;
};

export type ModyAgentImprovementProposal = {
  id: string;
  agentId: string;
  correctionSignal: ModyAgentCorrectionSignal;
  evidenceCount: number;
  confidence: number;
  workPackIds: ModyWorkPackId[];
  reason: string;
  recommendedChange: string;
  status: "approval_required";
  userQuestion: string;
  autoApply: false;
  externalMutation: false;
};

export type ModySkillAcquisitionProposalStatus = "approval_required" | "blocked_untrusted_source";

export type ModySkillAcquisitionProposal = {
  id: string;
  skill: ModySkillCatalogCandidate;
  relatedWorkPackIds: ModyWorkPackId[];
  evidenceCount: number;
  reason: string;
  status: ModySkillAcquisitionProposalStatus;
  blockedReason?: string;
  userQuestion: string;
  requiresUserApprovalBeforeDownload: true;
  downloadStarted: false;
  installed: false;
  activated: false;
  activationRequiresSeparateUserAction: true;
  capabilityDecision: ModyCapabilityGrantDecision;
};

export type ModySkillAcquisitionUserDecision = "approve_once" | "decline";

export type ModySkillAcquisitionConsentReceipt = {
  proposalId: string;
  skillId: string;
  decidedAt: string;
  decision: ModySkillAcquisitionUserDecision;
  status: "approved_for_one_download" | "declined" | "blocked";
  canDownload: boolean;
  canInstall: boolean;
  canActivate: false;
  requestFingerprint: string;
  userMessage: string;
};

export type ModyWorkspaceIntelligenceCycleInput = {
  workspaceId: string;
  observedAt: string;
  previousState?: ModyWorkspaceIntelligenceState;
  learningPlans?: readonly ModyDocumentLearningPlan[];
  agentOutcomes?: readonly ModyAgentWorkOutcome[];
  agents?: readonly ModyAgentCapabilityProfile[];
  installedSkillIds?: readonly string[];
  skillCatalog?: readonly ModySkillCatalogCandidate[];
};

export type ModyWorkspaceIntelligenceCycleResult = {
  state: ModyWorkspaceIntelligenceState;
  newLearningSessionIds: string[];
  newAgentRunIds: string[];
  assignments: ModyAgentAssignmentRecommendation[];
  improvementProposals: ModyAgentImprovementProposal[];
  skillProposals: ModySkillAcquisitionProposal[];
  boundaries: {
    folderObservationOnly: true;
    noAutomaticExternalMutation: true;
    noAutomaticSkillDownload: true;
    noAutomaticSkillActivation: true;
  };
};

export class ModyWorkspaceIntelligenceEngine {
  readonly #grantGate: ModyCapabilityGrantGate;

  constructor(grantGate = new ModyCapabilityGrantGate()) {
    this.#grantGate = grantGate;
  }

  runCycle(input: ModyWorkspaceIntelligenceCycleInput): ModyWorkspaceIntelligenceCycleResult {
    const workspaceId = input.workspaceId.trim();
    if (!workspaceId) throw new Error("workspaceId가 필요합니다.");
    if (!Number.isFinite(Date.parse(input.observedAt))) {
      throw new Error("observedAt이 올바른 ISO 시각이어야 합니다.");
    }

    const state = cloneState(input.previousState ?? createEmptyWorkspaceIntelligenceState(workspaceId));
    if (state.workspaceId !== workspaceId) {
      throw new Error("이전 학습 상태의 workspaceId가 현재 작업공간과 다릅니다.");
    }
    for (const plan of input.learningPlans ?? []) {
      if (plan.workspaceId !== workspaceId) {
        throw new Error("다른 작업공간의 자료 학습 결과를 현재 기억에 합칠 수 없습니다.");
      }
    }

    const knownLearningSessions = new Set(state.processedLearningSessionIds);
    const newPlans = (input.learningPlans ?? []).filter((plan) => {
      if (knownLearningSessions.has(plan.sessionId)) return false;
      knownLearningSessions.add(plan.sessionId);
      return true;
    });
    for (const plan of newPlans) mergeLearningPlan(state, plan, input.observedAt);

    const knownAgentRuns = new Set(state.processedAgentRunIds);
    const newOutcomes = (input.agentOutcomes ?? []).filter((outcome) => {
      validateAgentOutcome(outcome);
      if (knownAgentRuns.has(outcome.runId)) return false;
      knownAgentRuns.add(outcome.runId);
      return true;
    });
    for (const outcome of newOutcomes) mergeAgentOutcome(state, outcome);

    state.cycleCount += 1;
    state.lastObservedAt = input.observedAt;
    state.processedLearningSessionIds = [...knownLearningSessions];
    state.processedAgentRunIds = [...knownAgentRuns];
    state.workSignals.sort(
      (left, right) => right.confidence - left.confidence || right.evidenceCount - left.evidenceCount,
    );
    state.agentLearningProfiles.sort((left, right) => left.agentId.localeCompare(right.agentId));

    const assignments = createAssignmentRecommendations(state, input.agents ?? []);
    const improvementProposals = createAgentImprovementProposals(state);
    const skillProposals = createSkillProposals({
      state,
      assignments,
      skillCatalog: input.skillCatalog ?? [],
      installedSkillIds: new Set(input.installedSkillIds ?? []),
      observedAt: input.observedAt,
      grantGate: this.#grantGate,
    });
    state.pendingSkillProposalIds = skillProposals
      .filter((proposal) => proposal.status === "approval_required")
      .map((proposal) => proposal.id);

    return {
      state,
      newLearningSessionIds: newPlans.map((plan) => plan.sessionId),
      newAgentRunIds: newOutcomes.map((outcome) => outcome.runId),
      assignments,
      improvementProposals,
      skillProposals,
      boundaries: {
        folderObservationOnly: true,
        noAutomaticExternalMutation: true,
        noAutomaticSkillDownload: true,
        noAutomaticSkillActivation: true,
      },
    };
  }
}

export function createEmptyWorkspaceIntelligenceState(
  workspaceId: string,
): ModyWorkspaceIntelligenceState {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) throw new Error("workspaceId가 필요합니다.");
  return {
    schemaVersion: modyWorkspaceIntelligenceSchemaVersion,
    workspaceId: normalizedWorkspaceId,
    cycleCount: 0,
    processedLearningSessionIds: [],
    processedAgentRunIds: [],
    workSignals: [],
    agentLearningProfiles: [],
    pendingSkillProposalIds: [],
    memoryBoundary: {
      rawFileContentStored: false,
      rawSecretsStored: false,
      absolutePathsStored: false,
      learnedRulesAutoApplied: false,
    },
  };
}

export function decideSkillAcquisition(
  proposal: ModySkillAcquisitionProposal,
  decision: ModySkillAcquisitionUserDecision,
  decidedAt: string,
): ModySkillAcquisitionConsentReceipt {
  const requestFingerprint =
    proposal.capabilityDecision?.request?.constraints?.requestFingerprint ?? "";
  const contractFailure = validateSkillAcquisitionProposalContract(proposal);
  if (contractFailure) {
    return {
      proposalId: proposal.id,
      skillId: proposal.skill.skillId,
      decidedAt,
      decision,
      status: "blocked",
      canDownload: false,
      canInstall: false,
      canActivate: false,
      requestFingerprint,
      userMessage:
        proposal.blockedReason ??
        contractFailure ??
        "검증되지 않은 출처의 업무 도구라 다운로드할 수 없습니다.",
    };
  }
  if (decision === "decline") {
    return {
      proposalId: proposal.id,
      skillId: proposal.skill.skillId,
      decidedAt,
      decision,
      status: "declined",
      canDownload: false,
      canInstall: false,
      canActivate: false,
      requestFingerprint,
      userMessage: "설치하지 않았습니다. 기존 업무 방식으로 계속 진행합니다.",
    };
  }
  return {
    proposalId: proposal.id,
    skillId: proposal.skill.skillId,
    decidedAt,
    decision,
    status: "approved_for_one_download",
    canDownload: true,
    canInstall: true,
    canActivate: false,
    requestFingerprint,
    userMessage: "이 버전과 권한 범위에 한해 한 번 다운로드·설치할 수 있습니다. 사용 시작은 별도 확인이 필요합니다.",
  };
}

function cloneState(state: ModyWorkspaceIntelligenceState): ModyWorkspaceIntelligenceState {
  return {
    ...state,
    processedLearningSessionIds: [...state.processedLearningSessionIds],
    processedAgentRunIds: [...state.processedAgentRunIds],
    workSignals: state.workSignals.map((signal) => ({
      ...signal,
      categories: [...signal.categories],
      sourceSessionIds: [...signal.sourceSessionIds],
    })),
    agentLearningProfiles: state.agentLearningProfiles.map((profile) => ({
      ...profile,
      correctionCounts: { ...profile.correctionCounts },
      workPackIds: [...profile.workPackIds],
      workPackPerformance: (profile.workPackPerformance ?? []).map((performance) => ({
        ...performance,
        correctionCounts: { ...(performance.correctionCounts ?? {}) },
      })),
    })),
    pendingSkillProposalIds: [...state.pendingSkillProposalIds],
    memoryBoundary: { ...state.memoryBoundary },
  };
}

function mergeLearningPlan(
  state: ModyWorkspaceIntelligenceState,
  plan: ModyDocumentLearningPlan,
  observedAt: string,
) {
  for (const recommendation of createDocumentAutomationRecommendations(plan)) {
    mergeWorkSignal(state, plan, recommendation, observedAt);
  }
}

function mergeWorkSignal(
  state: ModyWorkspaceIntelligenceState,
  plan: ModyDocumentLearningPlan,
  recommendation: ModyDocumentAutomationRecommendation,
  observedAt: string,
) {
  const existing = state.workSignals.find(
    (signal) => signal.workPackId === recommendation.workPackId,
  );
  const categories = unique(
    plan.filePlans
      .filter((file) => recommendation.sourceFileIds.includes(file.id))
      .map((file) => file.category),
  );
  if (!existing) {
    state.workSignals.push({
      workPackId: recommendation.workPackId,
      observationCount: 1,
      evidenceCount: recommendation.sourceFileIds.length,
      confidence: recommendation.confidence,
      categories,
      sourceSessionIds: [plan.sessionId],
      lastSeenAt: observedAt,
    });
    return;
  }
  existing.observationCount += 1;
  existing.evidenceCount += recommendation.sourceFileIds.length;
  existing.confidence = Math.min(
    0.99,
    Number(
      (
        Math.max(existing.confidence, recommendation.confidence) +
        Math.min(0.08, existing.observationCount * 0.01)
      ).toFixed(2),
    ),
  );
  existing.categories = unique([...existing.categories, ...categories]);
  existing.sourceSessionIds = unique([...existing.sourceSessionIds, plan.sessionId]).slice(-100);
  existing.lastSeenAt = observedAt;
}

function validateAgentOutcome(outcome: ModyAgentWorkOutcome) {
  if (!outcome.runId.trim() || !outcome.agentId.trim()) {
    throw new Error("에이전트 결과에는 runId와 agentId가 필요합니다.");
  }
  if (
    !modyWorkspaceIntelligenceOutcomeStatuses.has(outcome.status)
  ) {
    throw new Error("에이전트 결과 status가 허용된 상태가 아닙니다.");
  }
  if (
    outcome.workPackId &&
    !modyWorkspaceIntelligenceWorkPackIds.has(outcome.workPackId)
  ) {
    throw new Error("에이전트 결과의 workPackId가 등록된 업무팩이 아닙니다.");
  }
  if (
    (outcome.correctionSignals ?? []).some(
      (signal) => !modyWorkspaceIntelligenceCorrectionSignals.has(signal),
    )
  ) {
    throw new Error("에이전트 결과 correctionSignals에 허용되지 않은 값이 있습니다.");
  }
  if (!Number.isFinite(Date.parse(outcome.finishedAt))) {
    throw new Error("에이전트 결과의 finishedAt이 올바른 ISO 시각이어야 합니다.");
  }
}

function mergeAgentOutcome(
  state: ModyWorkspaceIntelligenceState,
  outcome: ModyAgentWorkOutcome,
) {
  const score = normalizeQualityScore(outcome.qualityScore, outcome.status);
  let profile = state.agentLearningProfiles.find(
    (candidate) => candidate.agentId === outcome.agentId,
  );
  if (!profile) {
    profile = {
      agentId: outcome.agentId,
      totalRuns: 0,
      acceptedRuns: 0,
      correctedRuns: 0,
      rejectedRuns: 0,
      failedRuns: 0,
      qualityScoreTotal: 0,
      qualityScoreCount: 0,
      correctionCounts: {},
      workPackIds: [],
      workPackPerformance: [],
      lastOutcomeAt: outcome.finishedAt,
    };
    state.agentLearningProfiles.push(profile);
  }
  profile.totalRuns += 1;
  if (outcome.status === "accepted") profile.acceptedRuns += 1;
  if (outcome.status === "corrected") profile.correctedRuns += 1;
  if (outcome.status === "rejected") profile.rejectedRuns += 1;
  if (outcome.status === "failed") profile.failedRuns += 1;
  profile.qualityScoreTotal += score;
  profile.qualityScoreCount += 1;
  profile.lastOutcomeAt = outcome.finishedAt;
  for (const signal of unique(outcome.correctionSignals ?? [])) {
    profile.correctionCounts[signal] = (profile.correctionCounts[signal] ?? 0) + 1;
  }
  if (!outcome.workPackId) return;

  profile.workPackIds = unique([...profile.workPackIds, outcome.workPackId]);
  let performance = profile.workPackPerformance.find(
    (candidate) => candidate.workPackId === outcome.workPackId,
  );
  if (!performance) {
    performance = {
      workPackId: outcome.workPackId,
      totalRuns: 0,
      acceptedRuns: 0,
      correctedRuns: 0,
      rejectedRuns: 0,
      failedRuns: 0,
      qualityScoreTotal: 0,
      qualityScoreCount: 0,
      correctionCounts: {},
      lastOutcomeAt: outcome.finishedAt,
    };
    profile.workPackPerformance.push(performance);
  }
  performance.totalRuns += 1;
  if (outcome.status === "accepted") performance.acceptedRuns += 1;
  if (outcome.status === "corrected") performance.correctedRuns += 1;
  if (outcome.status === "rejected") performance.rejectedRuns += 1;
  if (outcome.status === "failed") performance.failedRuns += 1;
  performance.qualityScoreTotal += score;
  performance.qualityScoreCount += 1;
  performance.lastOutcomeAt = outcome.finishedAt;
  for (const signal of unique(outcome.correctionSignals ?? [])) {
    performance.correctionCounts[signal] =
      (performance.correctionCounts[signal] ?? 0) + 1;
  }
  profile.workPackPerformance.sort((left, right) =>
    left.workPackId.localeCompare(right.workPackId),
  );
}

function createAssignmentRecommendations(
  state: ModyWorkspaceIntelligenceState,
  agents: readonly ModyAgentCapabilityProfile[],
): ModyAgentAssignmentRecommendation[] {
  return state.workSignals.map((signal) => {
    const ranked = agents
      .filter(
        (agent) =>
          agent.availability === "ready" &&
          agent.supportedWorkPackIds.includes(signal.workPackId),
      )
      .map((agent) => ({
        agent,
        score: assignmentScore(agent, signal.workPackId, state),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.agent.displayName.localeCompare(right.agent.displayName, "ko-KR"),
      );
    const winner = ranked[0];
    if (!winner || winner.score < 0.55) {
      return {
        workPackId: signal.workPackId,
        status: "specialist_needed",
        confidence: signal.confidence,
        reasons: [
          `${signal.evidenceCount}개 자료 근거에서 이 업무가 반복될 가능성을 확인했습니다.`,
          "현재 팀원 중 해당 업무를 명시적으로 지원하고 준비된 팀원이 없습니다.",
        ],
        evidenceCount: signal.evidenceCount,
        autoDispatch: false,
      };
    }
    const learningProfile = state.agentLearningProfiles.find(
      (profile) => profile.agentId === winner.agent.agentId,
    );
    const workPackPerformance = learningProfile?.workPackPerformance.find(
      (performance) => performance.workPackId === signal.workPackId,
    );
    const reasons = [
      `${winner.agent.displayName}에게 ${signal.workPackId} 업무 지원 범위가 설정되어 있습니다.`,
    ];
    if (workPackPerformance?.totalRuns) {
      reasons.push(
        `같은 업무의 실제 결과 ${workPackPerformance.totalRuns}건을 배정 점수에 반영했습니다.`,
      );
    } else if (learningProfile?.totalRuns) {
      reasons.push(
        "다른 업무의 결과 기록은 보관했지만 이 업무 배정 점수에는 섞지 않았습니다.",
      );
    } else {
      reasons.push("이 업무의 실제 결과 기록이 아직 없어 첫 결과는 반드시 검토가 필요합니다.");
    }
    return {
      workPackId: signal.workPackId,
      status: "recommended",
      agentId: winner.agent.agentId,
      agentLabel: winner.agent.displayName,
      confidence: Number(Math.min(0.98, winner.score).toFixed(2)),
      reasons,
      evidenceCount: signal.evidenceCount,
      autoDispatch: false,
    };
  });
}

function assignmentScore(
  agent: ModyAgentCapabilityProfile,
  workPackId: ModyWorkPackId,
  state: ModyWorkspaceIntelligenceState,
) {
  if (agent.availability !== "ready" || !agent.supportedWorkPackIds.includes(workPackId)) {
    return 0;
  }
  const profile = state.agentLearningProfiles.find(
    (candidate) => candidate.agentId === agent.agentId,
  );
  const performance = profile?.workPackPerformance.find(
    (candidate) => candidate.workPackId === workPackId,
  );
  const activeSkillBoost = agent.activeSkillIds.length > 0 ? 0.04 : 0;
  if (!performance?.totalRuns) return 0.58 + activeSkillBoost;
  const acceptanceRate = performance.acceptedRuns / performance.totalRuns;
  const failureRate =
    (performance.failedRuns + performance.rejectedRuns) / performance.totalRuns;
  const averageQuality = performance.qualityScoreCount
    ? performance.qualityScoreTotal / performance.qualityScoreCount
    : 0.5;
  return Math.max(
    0,
    0.5 +
      acceptanceRate * 0.2 +
      averageQuality * 0.18 -
      failureRate * 0.28 +
      activeSkillBoost,
  );
}

function createAgentImprovementProposals(
  state: ModyWorkspaceIntelligenceState,
): ModyAgentImprovementProposal[] {
  const proposals: ModyAgentImprovementProposal[] = [];
  for (const profile of state.agentLearningProfiles) {
    for (const performance of profile.workPackPerformance) {
      const entries = Object.entries(performance.correctionCounts ?? {}) as Array<
        [ModyAgentCorrectionSignal, number]
      >;
      for (const [signal, count] of entries) {
        const threshold = signal === "approval_boundary_missed" ? 1 : 2;
        if (count < threshold) continue;
        proposals.push({
          id:
            `agent-improvement-${safeId(profile.agentId)}-` +
            `${safeId(performance.workPackId)}-${signal}`,
          agentId: profile.agentId,
          correctionSignal: signal,
          evidenceCount: count,
          confidence:
            signal === "approval_boundary_missed"
              ? 0.98
              : Math.min(0.95, Number((0.62 + count * 0.08).toFixed(2))),
          workPackIds: [performance.workPackId],
          reason:
            `${performance.workPackId} 업무에서 ` +
            improvementReason(signal, count),
          recommendedChange: improvementAction(signal),
          status: "approval_required",
          userQuestion:
            `이 개선 기준을 ${profile.agentId}의 ` +
            `${performance.workPackId} 업무에만 적용할까요?`,
          autoApply: false,
          externalMutation: false,
        });
      }
    }
  }
  return proposals.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.evidenceCount - left.evidenceCount ||
      left.id.localeCompare(right.id),
  );
}

function createSkillProposals(input: {
  state: ModyWorkspaceIntelligenceState;
  assignments: readonly ModyAgentAssignmentRecommendation[];
  skillCatalog: readonly ModySkillCatalogCandidate[];
  installedSkillIds: ReadonlySet<string>;
  observedAt: string;
  grantGate: ModyCapabilityGrantGate;
}): ModySkillAcquisitionProposal[] {
  const gaps = input.assignments.filter(
    (assignment) => assignment.status === "specialist_needed",
  );
  const proposals: ModySkillAcquisitionProposal[] = [];
  const proposedSkillIds = new Set<string>();
  for (const gap of gaps) {
    const candidate = input.skillCatalog
      .filter(
        (skill) =>
          !input.installedSkillIds.has(skill.skillId) &&
          skill.supportedWorkPackIds.includes(gap.workPackId),
      )
      .sort(
        (left, right) =>
          skillCandidateScore(right) - skillCandidateScore(left) ||
          left.title.localeCompare(right.title, "ko-KR"),
      )[0];
    if (!candidate || proposedSkillIds.has(candidate.skillId)) continue;
    proposedSkillIds.add(candidate.skillId);
    const relatedWorkPackIds = unique(
      gaps
        .filter((item) => candidate.supportedWorkPackIds.includes(item.workPackId))
        .map((item) => item.workPackId),
    );
    const evidenceCount = input.state.workSignals
      .filter((signal) => relatedWorkPackIds.includes(signal.workPackId))
      .reduce((total, signal) => total + signal.evidenceCount, 0);
    proposals.push(
      createSkillProposal(
        candidate,
        relatedWorkPackIds,
        evidenceCount,
        input.observedAt,
        input.grantGate,
      ),
    );
  }
  return proposals;
}

function createSkillProposal(
  skill: ModySkillCatalogCandidate,
  relatedWorkPackIds: ModyWorkPackId[],
  evidenceCount: number,
  observedAt: string,
  grantGate: ModyCapabilityGrantGate,
): ModySkillAcquisitionProposal {
  const trustFailure = validateSkillCandidate(skill);
  const requestFingerprint = createSkillRequestFingerprint(skill);
  const grantRequest: ModyCapabilityGrantRequest = {
    grantId: `skill-install-${safeId(skill.skillId)}-${safeId(skill.version)}`,
    agentId: "main-controller",
    connectorId: "managed-skill-catalog",
    capabilityId: `skill.install.${safeId(skill.skillId)}`,
    action: "install_catalog_tool",
    riskLevel: "l2_isolated_draft",
    resourceScope: {
      kind: "catalog_tool",
      catalogToolId: skill.skillId,
      installMode: skill.installMode,
    },
    dataClass: "metadata",
    duration: "single_run",
    constraints: {
      selectedScopeOnly: true,
      externalMutation: false,
      dryRunRequired: true,
      finalUserPresenceRequired: true,
      approvalMode: "once",
      secretEntryAllowedInChat: false,
      catalogToolOnly: true,
      requestFingerprint,
    },
    issuedAt: observedAt,
  };
  const capabilityDecision = trustFailure
    ? blockedSkillDecision(grantRequest, trustFailure)
    : grantGate.evaluate(grantRequest);
  const status: ModySkillAcquisitionProposalStatus = trustFailure
    ? "blocked_untrusted_source"
    : "approval_required";
  return {
    id: `skill-proposal-${safeId(skill.skillId)}-${safeId(skill.version)}`,
    skill: cloneSkillCandidate(skill),
    relatedWorkPackIds,
    evidenceCount,
    reason: `${relatedWorkPackIds.join(", ")} 업무 근거 ${evidenceCount}건이 있지만 현재 검증된 담당 능력이 부족합니다.`,
    status,
    ...(trustFailure ? { blockedReason: trustFailure } : {}),
    userQuestion: trustFailure
      ? "출처 검증이 끝나기 전에는 이 업무 도구를 설치할 수 없습니다."
      : `${skill.publisher}의 ${skill.title} ${skill.version}을(를) ${skill.installMode} 범위에 다운로드할까요?`,
    requiresUserApprovalBeforeDownload: true,
    downloadStarted: false,
    installed: false,
    activated: false,
    activationRequiresSeparateUserAction: true,
    capabilityDecision,
  };
}

function blockedSkillDecision(
  request: ModyCapabilityGrantRequest,
  reason: string,
): ModyCapabilityGrantDecision {
  return {
    policyVersion: modyCapabilityGrantPolicyVersion,
    request,
    status: "blocked",
    handledBy: "user",
    canPrepare: false,
    canExecute: false,
    requiresApproval: true,
    reason,
  };
}

function validateSkillCandidate(skill: ModySkillCatalogCandidate): string | undefined {
  if (skill.trust !== "verified_catalog") return "검증된 관리형 카탈로그 출처가 아닙니다.";
  try {
    const url = new URL(skill.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password) {
      return "자격정보가 없는 HTTPS 다운로드 출처가 필요합니다.";
    }
    if (url.search || url.hash) {
      return "다운로드 주소에는 자격정보가 섞일 수 있는 query 또는 fragment를 사용할 수 없습니다.";
    }
    if (isPrivateCatalogHost(url.hostname)) {
      return "로컬 또는 사설 네트워크 주소에서는 업무 도구를 다운로드할 수 없습니다.";
    }
  } catch {
    return "검증할 수 있는 다운로드 출처가 없습니다.";
  }
  if (!/^[a-f0-9]{64}$/iu.test(skill.integritySha256)) {
    return "설치 파일의 SHA-256 무결성 값이 없습니다.";
  }
  if (skill.installMode !== "portable_user_space") {
    return "검증된 사용자 영역 설치 방식만 사용할 수 있습니다.";
  }
  if (!skill.publisher.trim() || !skill.version.trim() || !skill.license.trim()) {
    return "배포자, 버전 또는 라이선스 정보가 불완전합니다.";
  }
  if (
    skill.requestedFolderScope === "selected_workspace_only" &&
    !skill.requestedCapabilities.includes("read_selected_workspace")
  ) {
    return "선택 작업공간 접근 범위와 요청 권한이 일치하지 않습니다.";
  }
  if (
    skill.requestedNetworkHosts.some(
      (host) =>
        !/^[a-z0-9.-]+$/iu.test(host) ||
        host.startsWith(".") ||
        host.endsWith(".") ||
        isPrivateCatalogHost(host),
    )
  ) {
    return "요청 네트워크 호스트 범위가 올바르지 않습니다.";
  }
  return undefined;
}

function validateSkillAcquisitionProposalContract(
  proposal: ModySkillAcquisitionProposal,
): string | undefined {
  const trustFailure = validateSkillCandidate(proposal.skill);
  if (trustFailure) return trustFailure;
  const request = proposal.capabilityDecision?.request;
  const expectedFingerprint = createSkillRequestFingerprint(proposal.skill);
  if (
    proposal.status !== "approval_required" ||
    proposal.capabilityDecision.status !== "approval_required" ||
    proposal.capabilityDecision.canPrepare !== true ||
    proposal.capabilityDecision.canExecute !== false ||
    proposal.capabilityDecision.requiresApproval !== true ||
    proposal.requiresUserApprovalBeforeDownload !== true ||
    proposal.downloadStarted !== false ||
    proposal.installed !== false ||
    proposal.activated !== false ||
    proposal.activationRequiresSeparateUserAction !== true
  ) {
    return "다운로드 전 사용자 승인 계약이 올바르지 않습니다.";
  }
  if (
    !request ||
    request.action !== "install_catalog_tool" ||
    request.riskLevel !== "l2_isolated_draft" ||
    request.dataClass !== "metadata" ||
    request.duration !== "single_run" ||
    request.resourceScope.kind !== "catalog_tool" ||
    request.resourceScope.catalogToolId !== proposal.skill.skillId ||
    request.resourceScope.installMode !== proposal.skill.installMode ||
    request.constraints.requestFingerprint !== expectedFingerprint ||
    request.constraints.selectedScopeOnly !== true ||
    request.constraints.externalMutation !== false ||
    request.constraints.dryRunRequired !== true ||
    request.constraints.finalUserPresenceRequired !== true ||
    request.constraints.approvalMode !== "once" ||
    request.constraints.secretEntryAllowedInChat !== false ||
    request.constraints.catalogToolOnly !== true
  ) {
    return "업무 도구의 출처, 버전, 무결성, 권한 또는 1회 설치 범위가 승인 요청과 일치하지 않습니다.";
  }
  return undefined;
}

function isPrivateCatalogHost(value: string) {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  if (!host) return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host.includes(":")
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function sanitizeSkillSourceUrlForOutput(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      isPrivateCatalogHost(url.hostname)
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function createSkillRequestFingerprint(skill: ModySkillCatalogCandidate) {
  const binding = JSON.stringify({
    skillId: skill.skillId,
    title: skill.title,
    version: skill.version,
    publisher: skill.publisher,
    license: skill.license,
    sourceUrl: sanitizeSkillSourceUrlForOutput(skill.sourceUrl),
    integritySha256: skill.integritySha256.toLowerCase(),
    trust: skill.trust,
    installMode: skill.installMode,
    supportedWorkPackIds: [...skill.supportedWorkPackIds].sort(),
    requestedCapabilities: [...skill.requestedCapabilities].sort(),
    requestedNetworkHosts: [...skill.requestedNetworkHosts].sort(),
    requestedFolderScope: skill.requestedFolderScope,
  });
  const encodedBinding = encodeURIComponent(binding).replace(
    /[!'()*]/gu,
    (character) =>
      "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
  return (
    "sha256:" +
    skill.integritySha256.toLowerCase() +
    ":binding:" +
    encodedBinding
  );
}

function cloneSkillCandidate(
  skill: ModySkillCatalogCandidate,
): ModySkillCatalogCandidate {
  return {
    ...skill,
    sourceUrl: sanitizeSkillSourceUrlForOutput(skill.sourceUrl),
    supportedWorkPackIds: [...skill.supportedWorkPackIds],
    requestedCapabilities: [...skill.requestedCapabilities],
    requestedNetworkHosts: [...skill.requestedNetworkHosts],
  };
}

function skillCandidateScore(skill: ModySkillCatalogCandidate) {
  const trustScore =
    skill.trust === "verified_catalog"
      ? 3
      : skill.trust === "publisher_signed"
        ? 2
        : 0;
  const integrityScore = /^[a-f0-9]{64}$/iu.test(skill.integritySha256) ? 1 : 0;
  return trustScore + integrityScore + Math.min(3, skill.supportedWorkPackIds.length);
}

function normalizeQualityScore(
  score: number | undefined,
  status: ModyAgentWorkOutcomeStatus,
) {
  if (typeof score === "number" && Number.isFinite(score)) {
    return Math.min(1, Math.max(0, score));
  }
  if (status === "accepted") return 1;
  if (status === "corrected") return 0.6;
  if (status === "rejected") return 0.2;
  return 0;
}

function improvementReason(signal: ModyAgentCorrectionSignal, count: number) {
  const labels: Record<ModyAgentCorrectionSignal, string> = {
    missing_source: "근거 자료 누락",
    wrong_template: "회사 양식 불일치",
    wrong_assignee: "담당 배정 오류",
    wrong_schedule: "일정 조건 오류",
    calculation_error: "계산 오류",
    tone_mismatch: "말투 불일치",
    approval_boundary_missed: "승인 경계 누락",
    other: "기타 사용자 수정",
  };
  return `${labels[signal]} 신호가 실제 결과에서 ${count}회 확인됐습니다.`;
}

function improvementAction(signal: ModyAgentCorrectionSignal) {
  const actions: Record<ModyAgentCorrectionSignal, string> = {
    missing_source: "답변 전에 원본 근거와 출처 표시를 필수 점검합니다.",
    wrong_template: "승인된 회사 양식을 우선 검색하고 형식 일치 검사를 추가합니다.",
    wrong_assignee: "업무 유형과 팀원 지원 범위를 다시 비교한 뒤 배정합니다.",
    wrong_schedule: "운영 시간, 휴무, 시간대와 기존 일정을 교차 확인합니다.",
    calculation_error: "표 계산을 재검산하고 합계·단위 검증 단계를 추가합니다.",
    tone_mismatch: "승인된 말투 기준을 초안 생성 전에 적용합니다.",
    approval_boundary_missed: "외부 발송·일정 등록·파일 변경 전에 승인 잠금을 강제로 검사합니다.",
    other: "사용자가 수정한 구조를 개선 후보로만 저장하고 다음 결과에서 다시 검증합니다.",
  };
  return actions[signal];
}

function safeId(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "unknown"
  );
}

function unique<T extends string>(values: readonly T[]) {
  return [...new Set(values)];
}
