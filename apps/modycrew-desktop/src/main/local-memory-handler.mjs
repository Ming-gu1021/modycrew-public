import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { resolveDesktopDomainEntryPath } from "./runtime-paths.mjs";
const { restoreBuiltinExpert, getBuiltinExpert } = await import(pathToFileURL(path.join(
  path.dirname(resolveDesktopDomainEntryPath({ repoRoot: fileURLToPath(new URL("../../../../", import.meta.url)) })),
  "builtin-experts.js",
)).href);
import { loadWorkSessionWorkspaceStore, updateWorkSessionWorkspaceStore } from "./work-session-workspace-store.mjs";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";

import {
  readWorkspaceIntelligenceState,
  updateWorkspaceIntelligenceFromLearningPlan,
} from "./workspace-intelligence-store.mjs";
import {
  installWorkspaceSkillFromApprovedProposal,
  persistWorkspaceSkillProposals,
  readWorkspaceSkillLifecycle,
  resolveWorkspaceSkillLifecyclePaths,
  recordWorkspaceSkillActivationDecision,
  recordWorkspaceSkillInstallDecision,
} from "./workspace-skill-lifecycle-store.mjs";
import {
  canonicalizeMainAgentArtifactBody,
} from "./agent-run-ledger.mjs";

import {
  userFacingGrowthCandidateNextAction,
  userFacingGrowthCandidateTitle,
  userFacingLocalProfileLoadedMessage,
  userFacingLocalProfileSavedMessage,
  userFacingSourceKindLabel,
  userFacingWorkLearningSavedMessage,
  userFacingWorkspaceKnowledgeSourceLabel,
} from "./user-facing-labels.mjs";

const configFileName = "local-memory-config.json";
const chatThreadsRelativePath = path.join("memory", "chat", "threads.json");
const conversationDigestRelativePath = path.join("memory", "chat", "conversation-digest.json");
const appProfileRelativePath = path.join("memory", "app-profile", "profile.json");
const decisionLedgerRelativePath = path.join("memory", "decisions", "decision-ledger.json");
const homeApprovalDecisionReceiptLedgerRelativePath = path.join("memory", "decisions", "home-approval-decision-receipts.json");
const homeApprovalDecisionReceiptSummaryRelativePath = path.join("memory", "decisions", "HomeApprovalDecisionReceipts.md");
const workPatternLedgerRelativePath = path.join("memory", "work-patterns", "work-pattern-ledger.json");
const delegationArtifactLedgerRelativePath = path.join("memory", "delegations", "delegation-artifacts.json");
const delegationApprovalDecisionLedgerRelativePath = path.join("memory", "delegations", "approval-decisions.json");
const delegationActionQueueLedgerRelativePath = path.join("memory", "delegations", "delegation-action-queue.json");
const delegationDecisionSagaRelativePath = path.join("memory", "delegations", "delegation-decision-saga.v1.json");
const learningSourcesLedgerRelativePath = path.join("memory", "documents", "learning-sources.json");
const portableManifestFileName = "ModyCrewMemoryManifest.json";
const crewSoulBundleRelativePath = path.join("memory", "CrewSoulBundle.json");
const crewSoulBundleSummaryRelativePath = path.join("memory", "CrewSoulBundle.md");
const crewChannelBlueprintRelativePath = path.join("memory", "crew-souls", "CrewChannelBlueprint.json");
const crewChannelBlueprintSummaryRelativePath = path.join("memory", "crew-souls", "CrewChannelBlueprint.md");
const skillBootstrapPlanRelativePath = path.join("memory", "growth", "skill-bootstrap-plan.json");
const skillBootstrapPlanSummaryRelativePath = path.join("memory", "growth", "SkillBootstrapPlan.md");

const workspaceIntelligenceWorkPackIds = new Set([
  "inquiry_response",
  "schedule_coordination",
  "report_cleanup",
  "inventory_reorder",
  "tax_contract_archive",
]);
const workspaceIntelligenceCorrectionSignals = new Set([
  "missing_source",
  "wrong_template",
  "wrong_assignee",
  "wrong_schedule",
  "calculation_error",
  "tone_mismatch",
  "approval_boundary_missed",
  "other",
]);
const terminalDelegationApprovalDecisions = new Set([
  "approved",
  "change_requested",
  "rejected",
]);
const delegationDecisionSagaSchema = "modycrew.delegation-decision-saga.v1";
const delegationDecisionSagaPhases = new Set([
  "pending",
  "approval_prepared",
  "finalized",
  "local_projected",
  "learning_applied",
  "committed",
]);
const delegationDecisionQueues = new Map();
let localMemoryDomainRuntimePromise;

export function resolveLocalMemoryWorkspaceIntelligenceRoot(
  options = {},
  workspaceId = "local_desktop",
) {
  const root = ensureLocalMemoryRoot(options);
  const normalizedWorkspaceId = normalizeWorkspaceIntelligenceWorkspaceId(workspaceId);
  const intelligenceRoot = path.join(root, "memory", "intelligence", normalizedWorkspaceId);
  mkdirSync(intelligenceRoot, { recursive: true });
  return intelligenceRoot;
}

export async function updateLocalMemoryWorkspaceIntelligence(input = {}, options = {}) {
  const workspaceId = normalizeWorkspaceIntelligenceWorkspaceId(input.workspaceId);
  const indexRoot = resolveLocalMemoryWorkspaceIntelligenceRoot(options, workspaceId);
  const observedAt = sanitizeIsoDate(input.observedAt || new Date().toISOString());
  try {
    const runtime = await loadLocalMemoryDomainRuntime(options);
    const memoryRoot = ensureLocalMemoryRoot(options);
    const profile = sanitizeAppProfile(
      readJsonObject(path.join(memoryRoot, appProfileRelativePath)),
    );
    const currentSkillLifecycle = await readWorkspaceSkillLifecycle(memoryRoot);
    const verifiedCatalogSkillRuntime =
      await verifyLocalMemoryWorkspaceSkillRuntime(
        currentSkillLifecycle,
        options,
      );
    const catalogSkillIds = new Set(
      currentSkillLifecycle.records
        .map((record) => record.proposal?.skill?.skillId)
        .filter(Boolean),
    );
    const profileAgents = createLocalMemoryAgentCapabilityProfiles(
      profile,
      verifiedCatalogSkillRuntime.activeAssignments,
      catalogSkillIds,
    );
    const agents = Array.isArray(input.agents)
      ? input.agents
      : profileAgents;
    const skillCatalog = await resolveLocalMemoryVerifiedSkillCatalog(
      input,
      options,
    );
    const result = await updateWorkspaceIntelligenceFromLearningPlan({
      WorkspaceIntelligenceEngine:
        input.WorkspaceIntelligenceEngine ?? runtime.ModyWorkspaceIntelligenceEngine,
      workspaceId,
      ...(input.learningPlan ? { learningPlan: input.learningPlan } : {}),
      agentOutcomes: Array.isArray(input.agentOutcomes) ? input.agentOutcomes : [],
      agents,
      installedSkillIds: verifiedCatalogSkillRuntime.installedSkillIds,
      skillCatalog,
      indexRoot,
      observedAt,
    });
    const eligibleAgentIdsByProposal = Object.fromEntries(
      result.skillProposals.map((proposal) => [
        proposal.id,
        profileAgents
          .filter((agent) =>
            proposal.relatedWorkPackIds.some((workPackId) =>
              agent.supportedWorkPackIds.includes(workPackId),
            ),
          )
          .map((agent) => agent.agentId),
      ]),
    );
    const skillLifecycle = result.skillProposals.length
      ? await persistWorkspaceSkillProposals({
          memoryRoot,
          workspaceId,
          proposals: result.skillProposals,
          eligibleAgentIdsByProposal,
        })
      : currentSkillLifecycle;
    if (result.skillProposals.length && profile) {
      await refreshPortableMemoryAfterWorkspaceSkillLifecycle(
        memoryRoot,
        profile,
        skillLifecycle,
      );
    }
    return {
      ...result,
      centralMemoryRoot: indexRoot,
      centralMemory: true,
      skillLifecycle,
      skillRuntimeVerification: {
        verificationAvailable:
          verifiedCatalogSkillRuntime.verificationAvailable,
        checkedSkillCount:
          verifiedCatalogSkillRuntime.checkedSkillCount,
        verifiedInstalledCount:
          verifiedCatalogSkillRuntime.installedSkillIds.length,
        verifiedActiveCount:
          verifiedCatalogSkillRuntime.activeAssignments.length,
      },
    };
  } catch (error) {
    return {
      status: "workspace_intelligence_update_failed",
      workspaceId,
      centralMemoryRoot: indexRoot,
      centralMemory: true,
      cycleCount: 0,
      newLearningSessionIds: [],
      newAgentRunIds: [],
      workSignals: [],
      assignments: [],
      improvementProposals: [],
      skillProposals: [],
      persistence: {
        saved: false,
        atomicReplace: false,
        recoverableBackup: false,
        bytesWritten: 0,
      },
      rawFileContentStored: false,
      rawSecretsStored: false,
      absolutePathsStoredInState: false,
      externalMutation: false,
      errorMessage: sanitizeLine(error instanceof Error ? error.message : String(error), 240),
    };
  }
}

/**
 * Reads the durable, approved-folder learning state and returns one eligible
 * in-app assignment recommendation. This read-only bridge never changes a
 * teammate, accepts a skill, or starts background work. The caller must still
 * verify the current profile target before it can handle a user request.
 */
export async function resolveLocalMemoryLearnedWorkAssignment(input = {}, options = {}) {
  const workspaceId = normalizeWorkspaceIntelligenceWorkspaceId(input.workspaceId);
  const workPackId = String(input.workPackId ?? "").trim();
  const allowedTeammateIds = new Set(
    (Array.isArray(input.allowedTeammateIds) ? input.allowedTeammateIds : [])
      .map((value) => safeWorkspaceIntelligenceAgentId(value))
      .filter(Boolean),
  );
  if (!workspaceIntelligenceWorkPackIds.has(workPackId) || allowedTeammateIds.size === 0) {
    return {
      status: "local_memory_learned_assignment_not_applicable",
      eligible: false,
      externalMutation: false,
      rawSecretMaterialReturned: false,
    };
  }

  const indexRoot = resolveLocalMemoryWorkspaceIntelligenceRoot(options, workspaceId);
  let loaded;
  try {
    loaded = await readWorkspaceIntelligenceState(indexRoot, workspaceId);
  } catch {
    return learnedAssignmentUnavailableResult();
  }
  if (!loaded?.state || loaded.writeBlocked === true) {
    return {
      status: "local_memory_learned_assignment_not_ready",
      eligible: false,
      externalMutation: false,
      rawSecretMaterialReturned: false,
    };
  }

  try {
    const runtime = await loadLocalMemoryDomainRuntime(options);
    const memoryRoot = ensureLocalMemoryRoot(options);
    const profile = sanitizeAppProfile(
      readJsonObject(path.join(memoryRoot, appProfileRelativePath)),
    );
    if (!profile) {
      return {
        status: "local_memory_learned_assignment_profile_missing",
        eligible: false,
        externalMutation: false,
        rawSecretMaterialReturned: false,
      };
    }
    const lifecycle = await readWorkspaceSkillLifecycle(memoryRoot);
    const verifiedCatalogSkillRuntime = await verifyLocalMemoryWorkspaceSkillRuntime(
      lifecycle,
      options,
    );
    const catalogSkillIds = new Set(
      lifecycle.records
        .map((record) => record.proposal?.skill?.skillId)
        .filter(Boolean),
    );
    const agents = createLocalMemoryAgentCapabilityProfiles(
      profile,
      verifiedCatalogSkillRuntime.activeAssignments,
      catalogSkillIds,
    );
    const cycle = new runtime.ModyWorkspaceIntelligenceEngine().runCycle({
      workspaceId,
      observedAt: loaded.state.lastObservedAt || new Date().toISOString(),
      previousState: loaded.state,
      agents,
      installedSkillIds: verifiedCatalogSkillRuntime.installedSkillIds,
      skillCatalog: [],
    });
    const assignment = cycle.assignments.find(
      (candidate) =>
        candidate?.workPackId === workPackId &&
        candidate?.status === "recommended" &&
        allowedTeammateIds.has(safeWorkspaceIntelligenceAgentId(candidate.agentId)),
    );
    const targetTeammateId = safeWorkspaceIntelligenceAgentId(assignment?.agentId);
    if (!assignment || !targetTeammateId) {
      return {
        status: "local_memory_learned_assignment_not_available",
        eligible: false,
        externalMutation: false,
        rawSecretMaterialReturned: false,
      };
    }
    return {
      status: "local_memory_learned_assignment_recommended",
      eligible: true,
      targetTeammateId,
      workPackId,
      confidence: Number(assignment.confidence ?? 0),
      evidenceCount: Math.max(0, Number(assignment.evidenceCount ?? 0)),
      reasons: Array.isArray(assignment.reasons)
        ? assignment.reasons.map((reason) => sanitizeLine(reason, 180)).filter(Boolean).slice(0, 3)
        : [],
      autoDispatch: false,
      externalMutation: false,
      rawSecretMaterialReturned: false,
    };
  } catch {
    return learnedAssignmentUnavailableResult();
  }
}

function learnedAssignmentUnavailableResult() {
  return {
    status: "local_memory_learned_assignment_unavailable",
    eligible: false,
    externalMutation: false,
    rawSecretMaterialReturned: false,
  };
}
async function resolveLocalMemoryVerifiedSkillCatalog(input = {}, options = {}) {
  if (Array.isArray(input.skillCatalog)) return input.skillCatalog;
  if (typeof options.loadVerifiedSkillCatalog !== "function") return [];
  try {
    const catalog = await options.loadVerifiedSkillCatalog();
    return catalog?.verified === true && Array.isArray(catalog.candidates)
      ? catalog.candidates
      : [];
  } catch {
    return [];
  }
}

export async function resolveLocalMemoryAuthoritativeAgentRunTarget(
  input = {},
  options = {},
) {
  const root = ensureLocalMemoryRoot(options);
  const profilePath = path.join(root, appProfileRelativePath);
  const profile = sanitizeAppProfile(readJsonObject(profilePath));
  const targetTeammateId = safeWorkspaceIntelligenceAgentId(
    input.targetTeammateId,
  );
  const workPackId = String(input.workPackId ?? "").trim();
  if (!profile || !targetTeammateId || !workspaceIntelligenceWorkPackIds.has(workPackId)) {
    return {
      verified: false,
      status: "local_memory_agent_run_target_rejected",
      root,
      rawSecretMaterialReturned: false,
    };
  }
  const matchingTeammates = profile.teammates.filter(
    (candidate) => candidate.id === targetTeammateId,
  );
  const teammate = matchingTeammates.length === 1 ? matchingTeammates[0] : undefined;
  const supportedWorkPackIds = teammate
    ? [
        ...new Set(
          supportedWorkPackIdsForTeammateTemplate(teammate.templateId, teammate),
        ),
      ].sort()
    : [];
  if (!teammate || !supportedWorkPackIds.includes(workPackId)) {
    return {
      verified: false,
      status: "local_memory_agent_run_target_rejected",
      root,
      rawSecretMaterialReturned: false,
    };
  }
  const profileSnapshot = {
    targetTeammateId,
    targetTemplateId: teammate.templateId,
    supportedWorkPackIds,
  };
  const profileSnapshotDigest = createHash("sha256")
    .update(JSON.stringify(profileSnapshot), "utf8")
    .digest("hex");
  return {
    verified: true,
    status: "local_memory_agent_run_target_verified",
    root,
    profilePath,
    targetTeammateId,
    workPackId,
    supportedWorkPackIds,
    profileSnapshot,
    profileSnapshotDigest,
    rawSecretMaterialReturned: false,
  };
}
export function createWorkspaceAgentOutcomeFromDelegationDecision(input = {}) {
  const artifact = input.artifact && typeof input.artifact === "object" ? input.artifact : {};
  const trustedOutcome = sanitizeTrustedWorkspaceAgentOutcomeBinding(
    artifact.trustedWorkspaceAgentOutcome,
  );
  const decision = sanitizeDelegationApprovalDecision(input.decision, "held");
  if (decision === "held") return undefined;

  if (!trustedOutcome || trustedOutcome.runStatus === "error") return undefined;

  const status =
    decision === "approved"
      ? "accepted"
      : decision === "change_requested"
        ? "corrected"
        : "rejected";
  const requestedSignals = Array.isArray(input.correctionSignals)
    ? input.correctionSignals
        .map((value) => String(value ?? "").trim())
        .filter((value) => workspaceIntelligenceCorrectionSignals.has(value))
    : [];
  const correctionSignals =
    status === "corrected"
      ? [...new Set(requestedSignals.length ? requestedSignals : ["other"])]
      : [];
  return {
    runId: trustedOutcome.runId,
    agentId: trustedOutcome.targetTeammateId,
    workPackId: trustedOutcome.workPackId,
    status,
    finishedAt: sanitizeIsoDate(input.finishedAt || input.decidedAt || new Date().toISOString()),
    qualityScore: status === "accepted" ? 1 : status === "corrected" ? 0.55 : 0,
    correctionSignals,
  };
}

function createWorkspaceAgentFailureOutcomeFromDelegationArtifact(artifact = {}) {
  const trustedOutcome = sanitizeTrustedWorkspaceAgentOutcomeBinding(
    artifact.trustedWorkspaceAgentOutcome,
  );
  if (trustedOutcome?.runStatus !== "error") return undefined;
  return {
    runId: trustedOutcome.runId,
    agentId: trustedOutcome.targetTeammateId,
    workPackId: trustedOutcome.workPackId,
    status: "failed",
    finishedAt: sanitizeIsoDate(artifact.createdAt || new Date().toISOString()),
    qualityScore: 0,
    correctionSignals: [],
  };
}

async function resolveTrustedWorkspaceAgentOutcomeBinding(
  artifact = {},
  artifactBody,
  options = {},
) {
  const eventId = safeWorkspaceIntelligenceOpaqueId(artifact.metrics?.eventId);
  if (
    !eventId ||
    typeof options.resolveTrustedWorkspaceAgentOutcome !== "function"
  ) {
    return undefined;
  }
  let resolved;
  const canonicalArtifactBody = canonicalizeMainAgentArtifactBody(artifactBody);
  if (!canonicalArtifactBody) return undefined;
  try {
    resolved = await options.resolveTrustedWorkspaceAgentOutcome({
      artifactId: artifact.id,
      artifactKind: artifact.artifactKind,
      eventId,
      sourceTeammateId: artifact.sourceTeammateId,
      artifactBody: canonicalArtifactBody,
    });
  } catch {
    return undefined;
  }
  if (resolved?.verified !== true) return undefined;

  const trustedOutcome = sanitizeTrustedWorkspaceAgentOutcomeBinding(resolved);
  const resolvedArtifactId = safeWorkspaceIntelligenceOpaqueId(
    resolved.artifactId,
  );
  const resolvedArtifactKind = String(resolved.artifactKind ?? "").trim();
  const resolvedSourceTeammateId = safeWorkspaceIntelligenceAgentId(
    resolved.sourceTeammateId,
  );
  const resolvedProfileSnapshotSha256 = safeWorkspaceIntelligenceSha256(
    resolved.profileSnapshotSha256,
  );
  const sourceTeammateId = safeWorkspaceIntelligenceAgentId(
    artifact.sourceTeammateId,
  );
  if (
    !trustedOutcome ||
    resolvedArtifactId !== artifact.id ||
    resolvedArtifactKind !== artifact.artifactKind ||
    resolvedSourceTeammateId !== sourceTeammateId ||
    trustedOutcome.eventId !== eventId ||
    (resolved.profileSnapshotSha256 !== undefined && !resolvedProfileSnapshotSha256) ||
    !sourceTeammateId
  ) {
    return undefined;
  }
  return trustedOutcome;
}

function hasWorkspaceAgentOutcomeReference(artifact = {}) {
  return Boolean(safeWorkspaceIntelligenceOpaqueId(artifact.metrics?.eventId));
}

function createLocalMemoryAgentCapabilityProfiles(
  profile,
  activeCatalogAssignments = [],
  knownCatalogSkillIds = new Set(),
) {
  if (!profile) return [];
  const activeBundledSkillIds = new Set(
    (profile.activeSkillIds ?? []).filter(
      (skillId) => !knownCatalogSkillIds.has(skillId),
    ),
  );
  const catalogAssignmentsByAgent = new Map();
  for (const assignment of activeCatalogAssignments) {
    const agentId = safeWorkspaceIntelligenceAgentId(assignment?.targetAgentId);
    const skillId = String(assignment?.skillId ?? "");
    if (!agentId || !/^[a-z0-9._-]{1,120}$/u.test(skillId)) continue;
    const current = catalogAssignmentsByAgent.get(agentId) ?? [];
    current.push({
      skillId,
      supportedWorkPackIds: (assignment.supportedWorkPackIds ?? []).filter(
        (workPackId) => workspaceIntelligenceWorkPackIds.has(workPackId),
      ),
    });
    catalogAssignmentsByAgent.set(agentId, current);
  }
  return (profile.teammates ?? [])
    .map((teammate) => {
      const agentId = safeWorkspaceIntelligenceAgentId(teammate.id);
      const catalogAssignments = catalogAssignmentsByAgent.get(agentId) ?? [];
      const supportedWorkPackIds = [
        ...new Set([
          ...supportedWorkPackIdsForTeammateTemplate(teammate.templateId, teammate),
          ...catalogAssignments.flatMap((assignment) =>
            assignment.supportedWorkPackIds,
          ),
        ]),
      ];
      if (supportedWorkPackIds.length === 0) return undefined;
      return {
        agentId,
        displayName: sanitizeLine(teammate.name || teammate.roleTitle, 80),
        availability: "ready",
        supportedWorkPackIds,
        activeSkillIds: [
          ...new Set([
            ...(teammate.skillIds ?? []).filter((skillId) =>
              activeBundledSkillIds.has(skillId),
            ),
            ...catalogAssignments.map((assignment) => assignment.skillId),
          ]),
        ],
      };
    })
    .filter((agent) => agent?.agentId && agent.displayName);
}

export async function verifyLocalMemoryWorkspaceSkillRuntime(
  lifecycle = {},
  options = {},
) {
  const inspectRuntime = options.inspectWorkspaceSkillRuntime;
  const records = Array.isArray(lifecycle.records) ? lifecycle.records : [];
  if (
    lifecycle.writeBlocked === true ||
    typeof inspectRuntime !== "function"
  ) {
    return {
      verificationAvailable: false,
      checkedSkillCount: 0,
      installedSkillIds: [],
      activeAssignments: [],
    };
  }
  const installedSkillIds = [];
  const activeAssignments = [];
  let checkedSkillCount = 0;
  for (const record of records) {
    if (
      !["installed_inactive", "activation_in_progress", "active"].includes(
        record?.status,
      )
    ) {
      continue;
    }
    const skill = record.proposal?.skill;
    if (!skill?.skillId || !skill?.integritySha256 || !skill?.version) {
      continue;
    }
    checkedSkillCount += 1;
    const installationReceipts = Array.isArray(record.installationReceipts)
      ? record.installationReceipts
      : [];
    const installation = [...installationReceipts]
      .reverse()
      .find(
        (receipt) =>
          receipt?.status === "installed_inactive" &&
          receipt?.installationId &&
          receipt?.skillId === skill.skillId &&
          receipt?.version === skill.version &&
          receipt?.verifiedIntegritySha256 === skill.integritySha256 &&
          receipt?.installMode === skill.installMode,
      );
    if (!installation) continue;
    let inspected;
    try {
      inspected = await inspectRuntime({
        workspaceId: record.workspaceId,
        skillId: skill.skillId,
        version: skill.version,
        installationId: installation.installationId,
        ...(record.status === "active" && record.activeTargetAgentId
          ? { targetAgentId: record.activeTargetAgentId }
          : {}),
      });
    } catch {
      continue;
    }
    const inspectedInstallations = Array.isArray(inspected?.installations)
      ? inspected.installations
      : [];
    const exactInstallations = inspectedInstallations.filter(
      (candidate) =>
        candidate?.installationId === installation.installationId &&
        candidate?.installed === true &&
        candidate?.skillId === skill.skillId &&
        candidate?.version === skill.version &&
        candidate?.integritySha256 === skill.integritySha256 &&
        candidate?.installMode === skill.installMode,
    );
    const installed =
      inspected?.verified === true &&
      inspected?.installed === true &&
      inspected?.installationCount === inspectedInstallations.length &&
      inspectedInstallations.length === 1 &&
      exactInstallations.length === 1;
    if (!installed) continue;
    const exactInstallation = exactInstallations[0];
    installedSkillIds.push(skill.skillId);
    if (
      record.status !== "active" ||
      inspected?.active !== true ||
      exactInstallation.active !== true ||
      !record.activeTargetAgentId ||
      exactInstallation.targetAgentId !== record.activeTargetAgentId
    ) {
      continue;
    }
    activeAssignments.push({
      skillId: skill.skillId,
      targetAgentId: record.activeTargetAgentId,
      supportedWorkPackIds: [
        ...new Set(
          (skill.supportedWorkPackIds ?? []).filter((workPackId) =>
            workspaceIntelligenceWorkPackIds.has(workPackId),
          ),
        ),
      ],
    });
  }
  return {
    verificationAvailable: true,
    checkedSkillCount,
    installedSkillIds: [...new Set(installedSkillIds)],
    activeAssignments,
  };
}

/**
 * 사용자가 만든 직원이 맡기로 **명시된** 업무 범위만 돌려준다.
 *
 * 산문(역할·소개)에서 추론하지 않는다. 이 값은 업무 배정 권한의 근거이고,
 * 그 근거는 사용자가 고칠 수 있는 자유 문장이 아니라 앱이 검증한 데이터여야 한다
 * (`authoritativeAgentRunTargetUsesFixedTemplateAuthority` 계약).
 * 저장 시점에 sanitizeTeammateProfile 이 정규 목록으로 걸러 두므로 여기서는
 * 다시 한 번 확인만 한다. 정렬해서 돌려준다 — 호출부가 이 목록으로 지문을 만든다.
 */
function explicitTeammateWorkPackIds(teammate) {
  const declared = Array.isArray(teammate?.workPackIds) ? teammate.workPackIds : [];
  return [
    ...new Set(
      declared
        .map((workPackId) => String(workPackId ?? "").trim())
        .filter((workPackId) => workspaceIntelligenceWorkPackIds.has(workPackId)),
    ),
  ].sort();
}

function supportedWorkPackIdsForTeammateTemplate(templateId, teammate = null) {
  if (templateId === "operations") {
    return [
      "inquiry_response",
      "schedule_coordination",
      "report_cleanup",
      "inventory_reorder",
    ];
  }
  if (templateId === "mail") return ["inquiry_response", "schedule_coordination"];
  if (templateId === "finance") return ["report_cleanup", "tax_contract_archive"];
  if (templateId === "legal") return ["tax_contract_archive"];
  if (templateId === "desktop") return ["report_cleanup", "inventory_reorder"];
  if (templateId === "marketing") return ["inquiry_response", "report_cleanup"];
  if (templateId === "development") return ["report_cleanup"];
  // 기본 비서는 사용자의 모든 요청을 가장 먼저 받는 조율자다. 고정 템플릿이므로
  // 여기서 전 업무팩을 주는 것은 "고정 템플릿 권한" 계약을 깨지 않는다.
  // 이게 없으면 모든 사용자가 기본으로 갖는 직원이 아무 일도 못 받는다.
  if (templateId === "personal") return [...workspaceIntelligenceWorkPackIds].sort();
  // 사용자가 만든 직원은 템플릿이 없다. 사용자가 만들 때 고른 업무 범위를 쓴다.
  // 고른 게 없으면 여전히 빈 목록이고 배정은 거부된다 — 조용히 넓히지 않는다.
  if (templateId === "custom") return explicitTeammateWorkPackIds(teammate);
  return [];
}

function safeWorkspaceIntelligenceAgentId(value) {
  const id = String(value ?? "");
  return /^[a-z0-9._-]{1,80}$/u.test(id) ? id : "";
}

function safeWorkspaceIntelligenceOpaqueId(value) {
  const id = String(value ?? "");
  return /^[A-Za-z0-9._:@+-]{1,256}$/u.test(id) ? id : "";
}

function safeWorkspaceIntelligenceSha256(value) {
  const digest = String(value ?? "").toLowerCase();
  return /^[a-f0-9]{64}$/u.test(digest) ? digest : "";
}

function normalizeWorkspaceIntelligenceWorkspaceId(value) {
  return (
    sanitizeLine(value || "local_desktop", 80)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "local_desktop"
  );
}

async function loadLocalMemoryDomainRuntime(options = {}) {
  if (options.WorkspaceIntelligenceEngine) {
    return {
      ModyWorkspaceIntelligenceEngine: options.WorkspaceIntelligenceEngine,
    };
  }
  if (!localMemoryDomainRuntimePromise) {
    const appRoot =
      typeof options.app?.getAppPath === "function" ? options.app.getAppPath() : "";
    // 설치본에서 도메인 런타임은 resources/domain 에 있다. appRoot(app.getAppPath())는
    // 패키지 앱에서 asar 내부를 가리키는데 packages/domain/dist 는 asar 밖이라 없다.
    // 공용 헬퍼가 반환하는 경로를 맨 앞 후보로 둔다.
    const candidates = [
      options.domainEntryPath,
      resolveDesktopDomainEntryPath({ repoRoot: options.repoRoot }),
      appRoot ? path.join(appRoot, "packages", "domain", "dist", "index.js") : "",
      path.join(process.cwd(), "packages", "domain", "dist", "index.js"),
    ].filter(Boolean);
    const domainEntryPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
    localMemoryDomainRuntimePromise = import(pathToFileURL(domainEntryPath).href);
  }
  try {
    return await localMemoryDomainRuntimePromise;
  } catch (error) {
    localMemoryDomainRuntimePromise = undefined;
    throw error;
  }
}

async function loadLocalMemorySkillPolicyRuntime(options = {}) {
  if (typeof options.decideSkillAcquisition === "function") {
    return {
      decideSkillAcquisition: options.decideSkillAcquisition,
    };
  }
  return loadLocalMemoryDomainRuntime({
    ...options,
    WorkspaceIntelligenceEngine: undefined,
  });
}

async function listLocalMemoryWorkspaceSkillLifecycle(payload = {}, options = {}) {
  const workspaceId = normalizeWorkspaceIntelligenceWorkspaceId(payload.workspaceId);
  const result = await readWorkspaceSkillLifecycle(ensureLocalMemoryRoot(options));
  return {
    ...result,
    workspaceId,
    records: result.records.filter(
      (record) => record.workspaceId === workspaceId,
    ),
    userMessage: result.records.length
      ? "업무 기록에서 찾은 검증된 도구 제안과 설치 상태를 불러왔습니다."
      : "아직 검증된 업무 도구 제안이 없습니다.",
  };
}

async function confirmLocalMemoryWorkspaceSkillDownloadInstall(
  payload = {},
  options = {},
) {
  const workspaceId = normalizeWorkspaceIntelligenceWorkspaceId(payload.workspaceId);
  const memoryRoot = ensureLocalMemoryRoot(options);
  const lifecycle = await readWorkspaceSkillLifecycle(memoryRoot);
  const proposalId = String(payload.proposalId ?? "");
  const record = lifecycle.records.find(
    (candidate) =>
      candidate.workspaceId === workspaceId &&
      candidate.proposalId === proposalId,
  );
  if (!record) {
    return {
      status: "workspace_skill_proposal_not_found",
      workspaceId,
      proposalId,
      downloadStarted: false,
      installed: false,
      activated: false,
      externalMutation: false,
      userMessage: "설치 제안을 찾지 못했습니다. 최신 제안을 다시 확인해 주세요.",
    };
  }
  if (String(payload.requestFingerprint ?? "") !== record.requestFingerprint) {
    return {
      status: "workspace_skill_install_contract_mismatch",
      workspaceId,
      proposalId,
      downloadStarted: false,
      installed: false,
      activated: false,
      externalMutation: false,
      userMessage: "화면에 표시된 제안과 현재 설치 범위가 달라 다시 확인이 필요합니다.",
    };
  }
  if (record.status === "download_authorization_consumed") {
    const consumedConsent = [...record.consentReceipts]
      .reverse()
      .find(
        (receipt) =>
          receipt.consumedAt && receipt.downloadAttemptId,
      );
    if (!consumedConsent) {
      return {
        status: "workspace_skill_install_reconciliation_required",
        workspaceId,
        proposalId,
        downloadStarted: false,
        installed: false,
        activated: false,
        reconciliationRequired: true,
        externalMutation: false,
        userMessage: "이전 설치 시도의 상태를 확인해야 합니다.",
      };
    }
    const reconciliationResult =
      await installWorkspaceSkillFromApprovedProposal(
        {
          memoryRoot,
          workspaceId,
          proposalId,
          consentId: consumedConsent.consentId,
        },
        {
          inspectCatalogSkillInstallAttempt:
            options.inspectCatalogSkillInstallAttempt,
          now: options.now,
        },
      );
    const profile = sanitizeAppProfile(
      readJsonObject(path.join(memoryRoot, appProfileRelativePath)),
    );
    if (profile) {
      await refreshPortableMemoryAfterWorkspaceSkillLifecycle(
        memoryRoot,
        profile,
      );
    }
    return reconciliationResult;
  }  if (
    record.status === "installed_inactive" ||
    record.status === "activation_in_progress" ||
    record.status === "active"
  ) {
    return {
      status: "workspace_skill_already_installed",
      workspaceId,
      proposalId,
      skillId: record.proposal.skill.skillId,
      downloadStarted: false,
      installed: true,
      activated: record.status === "active",
      activationRequiresSeparateUserAction: true,
      externalMutation: false,
      userMessage: "이미 설치된 업무 도구입니다. 사용 시작 여부만 확인해 주세요.",
    };
  }
  const decision =
    payload.decision === "approve_once" ? "approve_once" : "decline";
  if (decision === "approve_once") {
    if (typeof options.confirmWorkspaceSkillInstall !== "function") {
      return {
        status: "workspace_skill_user_confirmation_unavailable",
        workspaceId,
        proposalId,
        downloadStarted: false,
        installed: false,
        activated: false,
        externalMutation: false,
        userMessage: "설치 앱의 최종 확인 창을 열 수 없어 다운로드하지 않았습니다.",
      };
    }
    const confirmed = await options.confirmWorkspaceSkillInstall({
      workspaceId,
      proposalId,
      requestFingerprint: record.requestFingerprint,
      userQuestion: record.proposal.userQuestion,
      skill: {
        skillId: record.proposal.skill.skillId,
        title: record.proposal.skill.title,
        version: record.proposal.skill.version,
        publisher: record.proposal.skill.publisher,
        license: record.proposal.skill.license,
        installMode: record.proposal.skill.installMode,
        requestedCapabilities: [...record.proposal.skill.requestedCapabilities],
        requestedNetworkHosts: [...record.proposal.skill.requestedNetworkHosts],
        requestedFolderScope: record.proposal.skill.requestedFolderScope,
      },
    });
    if (confirmed !== true) {
      return {
        status: "workspace_skill_install_confirmation_cancelled",
        workspaceId,
        proposalId,
        downloadStarted: false,
        installed: false,
        activated: false,
        externalMutation: false,
        userMessage: "다운로드와 설치를 시작하지 않았습니다.",
      };
    }
  }
  const runtime = await loadLocalMemorySkillPolicyRuntime(options);
  const consentResult = await recordWorkspaceSkillInstallDecision(
    {
      memoryRoot,
      workspaceId,
      proposalId,
      decisionId: payload.decisionId,
      decision,
    },
    {
      decideSkillAcquisition: runtime.decideSkillAcquisition,
      now: options.now,
    },
  );
  const profile = sanitizeAppProfile(
    readJsonObject(path.join(memoryRoot, appProfileRelativePath)),
  );
  if (
    decision !== "approve_once" ||
    consentResult.status !== "workspace_skill_download_approved_once"
  ) {
    if (profile) {
      await refreshPortableMemoryAfterWorkspaceSkillLifecycle(
        memoryRoot,
        profile,
      );
    }
    return consentResult;
  }
  const installResult = await installWorkspaceSkillFromApprovedProposal(
    {
      memoryRoot,
      workspaceId,
      proposalId,
      consentId: consentResult.consent?.consentId,
    },
    {
      decideSkillAcquisition: runtime.decideSkillAcquisition,
      downloadCatalogSkill: options.downloadCatalogSkill,
      installCatalogSkill: options.installCatalogSkill,
      maximumPackageBytes: options.maximumPackageBytes,
      now: options.now,
    },
  );
  if (profile) {
    await refreshPortableMemoryAfterWorkspaceSkillLifecycle(
      memoryRoot,
      profile,
    );
  }
  return {
    ...installResult,
    consent: consentResult.consent,
    consentStatus: consentResult.status,
  };
}

async function confirmLocalMemoryWorkspaceSkillActivation(
  payload = {},
  options = {},
) {
  const workspaceId = normalizeWorkspaceIntelligenceWorkspaceId(payload.workspaceId);
  const memoryRoot = ensureLocalMemoryRoot(options);
  const lifecycle = await readWorkspaceSkillLifecycle(memoryRoot);
  const proposalId = String(payload.proposalId ?? "");
  const record = lifecycle.records.find(
    (candidate) =>
      candidate.workspaceId === workspaceId &&
      candidate.proposalId === proposalId,
  );
  if (!record) {
    return {
      status: "workspace_skill_proposal_not_found",
      workspaceId,
      proposalId,
      installed: false,
      activated: false,
      externalMutation: false,
      userMessage: "사용 시작 제안을 찾지 못했습니다.",
    };
  }
  if (String(payload.requestFingerprint ?? "") !== record.requestFingerprint) {
    return {
      status: "workspace_skill_activation_contract_mismatch",
      workspaceId,
      proposalId,
      installed: true,
      activated: false,
      externalMutation: false,
      userMessage: "설치된 도구와 현재 사용 시작 범위가 달라 활성화하지 않았습니다.",
    };
  }
  if (record.status === "activation_in_progress") {
    const interruptedActivation = [...record.activationReceipts]
      .reverse()
      .find((receipt) => receipt.status === "activation_in_progress");
    if (!interruptedActivation) {
      return {
        status: "workspace_skill_activation_reconciliation_required",
        workspaceId,
        proposalId,
        installed: true,
        activated: false,
        reconciliationRequired: true,
        externalMutation: false,
        userMessage: "이전 활성화 시도의 상태를 확인해야 합니다.",
      };
    }
    const reconciliationResult =
      await recordWorkspaceSkillActivationDecision(
        {
          memoryRoot,
          workspaceId,
          proposalId,
          decisionId: interruptedActivation.decisionId,
          decision: "activate",
          targetAgentId: interruptedActivation.targetAgentId,
        },
        {
          inspectCatalogSkillActivationAttempt:
            options.inspectCatalogSkillActivationAttempt,
          now: options.now,
        },
      );
    const profile = sanitizeAppProfile(
      readJsonObject(path.join(memoryRoot, appProfileRelativePath)),
    );
    if (profile) {
      await refreshPortableMemoryAfterWorkspaceSkillLifecycle(
        memoryRoot,
        profile,
      );
    }
    return reconciliationResult;
  }  if (record.status === "active") {
    if (
      payload.decision === "activate" &&
      String(payload.targetAgentId ?? "") !==
        record.activeTargetAgentId
    ) {
      return {
        status: "workspace_skill_activation_target_conflict",
        workspaceId,
        proposalId,
        skillId: record.proposal.skill.skillId,
        installed: true,
        activated: false,
        externalMutation: false,
        userMessage: "이미 다른 AI 팀원에게 활성화된 업무 도구입니다.",
      };
    }
    return {
      status: "workspace_skill_already_active",
      workspaceId,
      proposalId,
      skillId: record.proposal.skill.skillId,
      installed: true,
      activated: true,
      externalMutation: false,
      userMessage: "이미 선택한 AI 팀원에게 활성화된 업무 도구입니다.",
    };
  }
  if (record.status !== "installed_inactive") {
    return {
      status: "workspace_skill_activation_requires_verified_install",
      workspaceId,
      proposalId,
      installed: false,
      activated: false,
      externalMutation: false,
      userMessage: "검증된 설치 완료 증거가 있어야 사용을 시작할 수 있습니다.",
    };
  }
  if (!record.eligibleAgentIds.includes(String(payload.targetAgentId ?? ""))) {
    return {
      status: "workspace_skill_activation_agent_not_eligible",
      workspaceId,
      proposalId,
      installed: true,
      activated: false,
      externalMutation: false,
      userMessage: "이 업무 도구를 맡을 수 있는 명시된 AI 팀원을 선택해 주세요.",
    };
  }
  const decision =
    payload.decision === "activate" ? "activate" : "keep_inactive";
  if (decision === "activate") {
    if (typeof options.confirmWorkspaceSkillActivation !== "function") {
      return {
        status: "workspace_skill_user_confirmation_unavailable",
        workspaceId,
        proposalId,
        installed: true,
        activated: false,
        externalMutation: false,
        userMessage: "설치 앱의 사용 시작 확인 창을 열 수 없어 비활성 상태로 유지합니다.",
      };
    }
    const confirmed = await options.confirmWorkspaceSkillActivation({
      workspaceId,
      proposalId,
      requestFingerprint: record.requestFingerprint,
      targetAgentId: String(payload.targetAgentId ?? ""),
      userQuestion:
        record.proposal.skill.title +
        "을(를) 선택한 AI 팀원에게 사용할까요?",
      skill: {
        skillId: record.proposal.skill.skillId,
        title: record.proposal.skill.title,
        version: record.proposal.skill.version,
        publisher: record.proposal.skill.publisher,
      },
    });
    if (confirmed !== true) {
      return {
        status: "workspace_skill_activation_confirmation_cancelled",
        workspaceId,
        proposalId,
        installed: true,
        activated: false,
        externalMutation: false,
        userMessage: "설치된 업무 도구를 비활성 상태로 유지합니다.",
      };
    }
  }
  const activationResult =
    await recordWorkspaceSkillActivationDecision(
      {
        memoryRoot,
        workspaceId,
        proposalId,
        decisionId: payload.decisionId,
        decision,
        targetAgentId: payload.targetAgentId,
      },
      {
        activateCatalogSkill: options.activateCatalogSkill,
        now: options.now,
      },
    );
  const profile = sanitizeAppProfile(
    readJsonObject(path.join(memoryRoot, appProfileRelativePath)),
  );
  if (profile) {
    await refreshPortableMemoryAfterWorkspaceSkillLifecycle(
      memoryRoot,
      profile,
    );
  }
  return activationResult;
}

async function refreshPortableMemoryAfterWorkspaceSkillLifecycle(
  memoryRoot,
  profile,
  verifiedLifecycle = undefined,
) {
  const lifecycle =
    verifiedLifecycle ?? await readWorkspaceSkillLifecycle(memoryRoot);
  const lifecycleDisplay =
    createVerifiedWorkspaceSkillLifecycleDisplaySnapshot(
      memoryRoot,
      lifecycle,
    );
  if (lifecycleDisplay.recoveryRequired) return null;
  const crewKitRecords = readJsonArray(
    path.join(memoryRoot, "memory", "crew-kits", "crew-kits.json"),
  );
  return writePortableMemoryBundle(
    memoryRoot,
    profile,
    crewKitRecords.length
      ? crewKitRecords
      : createCrewKitRecords(profile),
    lifecycleDisplay,
  );
}

export async function handleLocalMemoryMessage(event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");
  try {
    if (kind === "status") return getLocalMemoryStatus(options);
    if (kind === "choose_root") return await chooseLocalMemoryRoot(options);
    if (kind === "load_chat_threads") return loadChatThreads(options);
    if (kind === "save_chat_threads") return saveChatThreads(payload, options, Boolean(event?.sender));
    if (kind === "load_work_session_workspace" || kind === "update_work_session_workspace") {
      try {
        const domain = await loadLocalMemoryDomainRuntime(options);
        const root = ensureLocalMemoryRoot(options);
        if (payload.expectedRoot !== undefined && (typeof payload.expectedRoot !== "string" || path.resolve(payload.expectedRoot) !== path.resolve(root))) {
          throw new Error("기억 저장소가 바뀌어 이전 회사의 요청을 적용하지 않았습니다. 현재 저장소를 다시 불러와 주세요.");
        }
        return kind === "load_work_session_workspace"
          ? loadWorkSessionWorkspaceStore(root, domain)
          : updateWorkSessionWorkspaceStore(root, payload.command, domain);
      } catch (error) {
        return { status: "work_session_workspace_failed", storage: "desktop", userMessage: error instanceof Error ? error.message : "업무 대화를 저장하지 못했습니다. 기존 자료는 보존했습니다." };
      }
    }
    if (kind === "load_app_profile") return loadAppProfile(options);
    if (kind === "save_app_profile") return saveAppProfile(payload, options);
    if (kind === "inspect_portable_memory") return await inspectPortableMemory(options);
    if (kind === "list_workspace_skill_acquisition_proposals") {
      return await listLocalMemoryWorkspaceSkillLifecycle(payload, options);
    }
    if (kind === "confirm_workspace_skill_download_install") {
      return await confirmLocalMemoryWorkspaceSkillDownloadInstall(payload, options);
    }
    if (kind === "confirm_workspace_skill_activation") {
      return await confirmLocalMemoryWorkspaceSkillActivation(payload, options);
    }
    if (kind === "save_work_decisions") return saveWorkDecisions(payload, options);
    if (kind === "save_work_learning") return saveWorkLearning(payload, options);
    if (kind === "list_work_patterns") return listWorkPatterns(options);
    if (kind === "update_work_pattern") return updateWorkPattern(payload, options);
    if (kind === "remove_work_pattern") return removeWorkPattern(payload, options);
    if (kind === "list_learning_sources") return listLearningSources(options);
    if (kind === "upsert_learning_sources") return upsertLearningSources(payload, options);
    if (kind === "import_workspace_knowledge") return importWorkspaceKnowledge(payload, options);
    if (kind === "remove_learning_source") return removeLearningSource(payload, options);
    if (kind === "save_delegation_artifact") return saveDelegationArtifact(payload, options);
    if (kind === "list_delegation_artifacts") return listDelegationArtifacts(options);
    if (kind === "open_delegation_artifact") return await openDelegationArtifact(payload, options);
    if (kind === "open_memory_file") return await openMemoryFile(payload, options);
    if (kind === "record_delegation_artifact_decision") return await recordDelegationArtifactDecision(payload, options);
    if (kind === "record_home_approval_decision_receipt") return recordHomeApprovalDecisionReceipt(payload, options);
    if (kind === "list_home_approval_decision_receipts") return listHomeApprovalDecisionReceipts(options);
    if (kind === "load_prompt_context") return await loadPromptContext(payload, options);
    if (kind === "load_learning_lessons") return await loadLearningLessons(payload, options);
    if (kind === "apply_learning_lessons") return await applyLearningLessons(payload, options);
    if (kind === "rollback_learning_lessons") return await rollbackLearningLessons(payload, options);
    if (kind === "decide_learning_proposal") return await decideLearningProposal(payload, options);
    if (kind === "list_tasks") return await listTasks(payload, options);
    if (kind === "upsert_tasks") return await upsertTasks(payload, options);
    if (kind === "answer_task_question") return await answerTaskQuestion(payload, options);
    if (kind === "complete_task") return await completeTask(payload, options);

    return {
      status: "local_memory_unknown_kind",
      userMessage: "알 수 없는 로컬 기억 저장소 요청입니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  } catch (error) {
    return {
      status: "local_memory_failed",
      errorMessage: sanitizeLine(error instanceof Error ? error.message : String(error), 240),
      userMessage: "로컬 기억 저장소 처리 중 문제가 생겼습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
}

function sanitizeWorkspaceSkillLifecycleDisplayCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function createVerifiedWorkspaceSkillLifecycleDisplaySnapshot(root, lifecycle = {}) {
  const paths = resolveWorkspaceSkillLifecyclePaths(root);
  const recoveryRequired = lifecycle.writeBlocked === true;
  return {
    statePath: lifecycle.statePath || paths.statePath,
    summaryPath: lifecycle.summaryPath || paths.summaryPath,
    ready: existsSync(paths.statePath) && !recoveryRequired,
    recoveryRequired,
    proposalCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      lifecycle.proposalCount,
    ),
    pendingInstallApprovalCount:
      sanitizeWorkspaceSkillLifecycleDisplayCount(
        lifecycle.pendingInstallApprovalCount,
      ),
    installedInactiveCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      lifecycle.installedInactiveCount,
    ),
    activeCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      lifecycle.activeCount,
    ),
    blockedCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      lifecycle.blockedCount,
    ),
  };
}

function readWorkspaceSkillLifecycleDisplayFromManifest(
  root,
  manifest = undefined,
) {
  const paths = resolveWorkspaceSkillLifecyclePaths(root);
  const safeManifest = sanitizePortableManifest(
    manifest ?? readJsonObject(path.join(root, portableManifestFileName)),
  );
  return {
    statePath: paths.statePath,
    summaryPath: paths.summaryPath,
    proposalCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      safeManifest?.counts?.workspaceSkillProposals,
    ),
    pendingInstallApprovalCount:
      sanitizeWorkspaceSkillLifecycleDisplayCount(
        safeManifest?.counts?.workspaceSkillPendingInstallApprovals,
      ),
    installedInactiveCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      safeManifest?.counts?.workspaceSkillsInstalledInactive,
    ),
    activeCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      safeManifest?.counts?.workspaceSkillsActive,
    ),
    blockedCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      safeManifest?.counts?.workspaceSkillsBlocked,
    ),
  };
}

function getLocalMemoryStatus(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const chatThreadsPath = path.join(root, chatThreadsRelativePath);
  const conversationDigestPath = path.join(root, conversationDigestRelativePath);
  const appProfilePath = path.join(root, appProfileRelativePath);
  const portableManifestPath = path.join(root, portableManifestFileName);
  const crewSoulBundlePath = path.join(root, crewSoulBundleRelativePath);
  const crewSoulBundleSummaryPath = path.join(root, crewSoulBundleSummaryRelativePath);
  const crewChannelBlueprintPath = path.join(root, crewChannelBlueprintRelativePath);
  const crewChannelBlueprintSummaryPath = path.join(root, crewChannelBlueprintSummaryRelativePath);
  const decisionLedgerPath = path.join(root, decisionLedgerRelativePath);
  const workPatternLedgerPath = path.join(root, workPatternLedgerRelativePath);
  const learningSourcesPath = path.join(root, learningSourcesLedgerRelativePath);
  const delegationArtifactLedgerPath = path.join(root, delegationArtifactLedgerRelativePath);
  const delegationApprovalDecisionLedgerPath = path.join(root, delegationApprovalDecisionLedgerRelativePath);
  const delegationActionQueueLedgerPath = path.join(root, delegationActionQueueLedgerRelativePath);
  const crewKitIndexPath = path.join(root, "memory", "crew-kits", "CrewKitIndex.md");
  const skillGrowthPath = path.join(root, "memory", "growth", "SkillGrowth.md");
  const skillBridgePath = path.join(root, "memory", "growth", "SkillBridge.md");
  const selfGrowthContractPath = path.join(root, "memory", "growth", "SelfGrowthContract.md");
  const skillSourceInventoryPath = path.join(root, "memory", "growth", "SkillSourceInventory.md");
  const skillSourcesPath = path.join(root, "memory", "growth", "skill-sources.json");
  const skillBootstrapPlanPath = path.join(root, skillBootstrapPlanRelativePath);
  const skillBootstrapPlanSummaryPath = path.join(root, skillBootstrapPlanSummaryRelativePath);
  const promptMemoryPath = path.join(root, "memory", "prompt", "PromptMemory.md");
  // 아래 원장 읽기는 모두 캐시를 거친다(파일이 그대로면 다시 파싱·검사하지 않음).
  // 캐시와 같은 배열을 그대로 내보내지 않도록 목록은 복사본(slice)으로 돌려준다.
  // 대화는 저장 직후 캐시에 넣어 둔 정리본을 같이 쓴다(원본 사본을 하나 더 들고 있지 않게).
  // 앱이 저장한 threads.json 은 이미 정리본이라 개수는 예전과 같다.
  const threads = readCachedThreads(root);
  const conversationDigest = readCachedConversationDigest(root);
  const decisions = readCachedJsonArray(decisionLedgerPath);
  const workPatterns = readCachedWorkPatternRecords(root);
  const learningSources = readCachedLearningSourceRecords(root);
  const connectorRecoveryMemories = readCachedConnectorRecoveryMemories(root);
  const delegationArtifacts = readCachedDelegationArtifactRecords(root);
  const delegationApprovalDecisions = readCachedDelegationApprovalDecisionRecords(root);
  const delegationActionQueue = readCachedDelegationActionQueueRecords(root);
  const growthSuggestions = readCachedGrowthSuggestions(root);
  const skillSources = readCachedSkillSourceRecords(root);
  const skillBootstrapPlan = readCachedSkillBootstrapPlan(root);
  const manifest = readCachedJsonObject(portableManifestPath);
  const workspaceSkillLifecycle =
    readWorkspaceSkillLifecycleDisplayFromManifest(root, manifest);
  const profile = readCachedAppProfile(root);
  const identityFiles = createIdentityFileRecords(root, profile);
  return {
    status: "local_memory_ready",
    root,
    defaultRoot: getDefaultLocalMemoryRoot(options),
    chatThreadsPath,
    appProfilePath,
    portableManifestPath,
    crewSoulBundlePath,
    crewSoulBundleSummaryPath,
    crewChannelBlueprintPath,
    crewChannelBlueprintSummaryPath,
    decisionLedgerPath,
    workPatternLedgerPath,
    learningSourcesPath,
    delegationArtifactLedgerPath,
    crewKitIndexPath,
    skillGrowthPath,
    skillBridgePath,
    selfGrowthContractPath,
    skillSourceInventoryPath,
    skillSourcesPath,
    skillBootstrapPlanPath,
    skillBootstrapPlanSummaryPath,
    workspaceSkillLifecyclePath: workspaceSkillLifecycle.statePath,
    workspaceSkillLifecycleSummaryPath:
      workspaceSkillLifecycle.summaryPath,
    workspaceSkillLifecycleReady: workspaceSkillLifecycle.ready,
    workspaceSkillLifecycleRecoveryRequired:
      workspaceSkillLifecycle.recoveryRequired,
    workspaceSkillProposalCount:
      workspaceSkillLifecycle.proposalCount,
    workspaceSkillPendingInstallApprovalCount:
      workspaceSkillLifecycle.pendingInstallApprovalCount,
    workspaceSkillInstalledInactiveCount:
      workspaceSkillLifecycle.installedInactiveCount,
    workspaceSkillActiveCount:
      workspaceSkillLifecycle.activeCount,
    workspaceSkillBlockedCount:
      workspaceSkillLifecycle.blockedCount,
    promptMemoryPath,
    manifestReady: Boolean(manifest?.portableMemory === true),
    crewSoulBundleReady: existsSync(crewSoulBundlePath) && existsSync(crewSoulBundleSummaryPath),
    crewChannelBlueprintReady: existsSync(crewChannelBlueprintPath) && existsSync(crewChannelBlueprintSummaryPath),
    restoreReady: Boolean(manifest?.portableMemory === true && existsSync(appProfilePath)),
    threadCount: threads.length,
    messageCount: countMessages(threads),
    conversationDigestCount: conversationDigest.length,
    decisionCount: decisions.length,
    workPatternCount: workPatterns.length,
    workPatterns: workPatterns.slice(0, 40),
    learningSourceCount: learningSources.length,
    learningSources: learningSources.slice(),
    delegationArtifactCount: delegationArtifacts.length,
    delegationApprovalDecisionCount: delegationApprovalDecisions.length,
    delegationActionQueueCount: delegationActionQueue.length,
    growthSuggestionCount: growthSuggestions.length,
    growthSuggestions: growthSuggestions.slice(),
    skillSourceCount: skillSources.length,
    skillSources: skillSources.slice(),
    skillBootstrapPlanReady:
      Boolean(skillBootstrapPlan) &&
      existsSync(skillBootstrapPlanPath) &&
      existsSync(skillBootstrapPlanSummaryPath),
    skillBootstrapPlan,
    connectorRecoveryMemoryCount: connectorRecoveryMemories.length,
    connectorRecoveryMemories: connectorRecoveryMemories.slice(),
    skillBootstrapActiveCrewKitCount: skillBootstrapPlan?.activeCrewKits?.length ?? 0,
    externalReauthorizationCount: skillBootstrapPlan?.externalReauthorization?.length ?? 0,
    identityFileCount: identityFiles.filter((file) => file.state === "ready").length,
    missingIdentityFileCount: identityFiles.filter((file) => file.state !== "ready").length,
    userMessage: `업무 기억은 이 PC 로컬 저장소에 보관됩니다: ${root}`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function chooseLocalMemoryRoot(options = {}) {
  const { dialog } = options;
  if (!dialog?.showOpenDialog) {
    return {
      status: "desktop_required",
      userMessage: "저장 위치 선택은 Windows 데스크톱 앱에서만 실행됩니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const focusedWindow = eventFocusedWindow(options);
  const currentRoot = getConfiguredLocalMemoryRoot(options);
  const result = await dialog.showOpenDialog(focusedWindow ?? undefined, {
    title: "ModyCrew 기억 저장소 위치 선택",
    defaultPath: currentRoot,
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return {
      ...getLocalMemoryStatus(options),
      status: "local_memory_root_unchanged",
      userMessage: "기억 저장소 위치를 바꾸지 않았습니다.",
    };
  }

  const selectedRoot = normalizeSelectedRoot(result.filePaths[0]);
  ensureMemoryFolders(selectedRoot, { force: true });
  writeConfig(options, { root: selectedRoot, updatedAt: new Date().toISOString() });
  return {
    ...getLocalMemoryStatus(options),
    status: "local_memory_root_updated",
    userMessage: `앞으로 대화 기억과 업무 인덱스는 여기에 저장합니다: ${selectedRoot}`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function loadChatThreads(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const chatThreadsPath = path.join(root, chatThreadsRelativePath);
  let threads;
  try { threads = sanitizeThreads(readChatThreadsArray(chatThreadsPath)); }
  catch (error) {
    return {
      status: "local_memory_chat_threads_failed", root, chatThreadsPath,
      userMessage: `기존 대화를 읽지 못해 원본을 보존했습니다. ${error instanceof Error ? error.message : "저장 파일을 확인해 주세요."}`,
      externalMutation: false, rawSecretMaterialStored: false, rawSecretMaterialReturned: false,
    };
  }
  return {
    status: "local_memory_chat_threads_loaded",
    // The renderer must not send snapshots through an older, unguarded main process.
    chatRootScopeVersion: 1,
    root,
    chatThreadsPath,
    threads,
    threadCount: threads.length,
    messageCount: countMessages(threads),
    userMessage: threads.length
      ? "저장된 로컬 대화 기억을 불러왔습니다."
      : "아직 저장된 로컬 대화 기억이 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function saveChatThreads(payload = {}, options = {}, rendererRequest = false) {
  if (!Array.isArray(payload.threads)) throw new Error("대화 목록 형식이 올바르지 않아 기존 대화를 보존했습니다.");
  // Bind this synchronous write to the same root that supplied the snapshot.
  // A stale window must never write its previous company into the current root.
  const root = getConfiguredLocalMemoryRoot(options);
  const expected = payload.expectedRoot;
  const normalized = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const missing = typeof expected !== "string" || !expected.trim() || !path.isAbsolute(expected);
  if ((rendererRequest && missing) || (expected !== undefined && (missing || normalized(expected) !== normalized(root)))) {
    return {
      status: "local_memory_chat_threads_failed",
      userMessage: missing
        ? "대화의 저장소를 확인하지 못해 저장하지 않았습니다. 앱을 새로 열어 다시 시도해 주세요."
        : "기억 저장소가 바뀌어 이전 대화를 저장하지 않았습니다. 현재 저장소를 다시 불러와 주세요.",
      externalMutation: false, rawSecretMaterialStored: false, rawSecretMaterialReturned: false,
    };
  }
  ensureMemoryFolders(root);
  const chatThreadsPath = path.join(root, chatThreadsRelativePath);
  const conversationDigestPath = path.join(root, conversationDigestRelativePath);
  const threads = sanitizeThreads(Array.isArray(payload.threads) ? payload.threads : []);
  const conversationDigest = createConversationDigestRecords(threads);
  atomicWriteJson(chatThreadsPath, threads);
  // 곧 이어질 프롬프트 기억 재생성이 방금 쓴 대화 파일(수 MB)을 다시 파싱하지 않게 한다.
  // sanitizeThreads 결과를 다시 sanitizeThreads 해도 같은 값이므로 읽은 것과 같다.
  primeLocalMemoryReadCache(chatThreadsPath, "threads", threads);
  atomicWriteJson(conversationDigestPath, conversationDigest);
  writeFileSync(
    path.join(root, "memory", "chat", "latest-summary.md"),
    createChatSummary(threads),
    "utf8",
  );
  writeFileSync(
    path.join(root, "memory", "chat", "CrewContext.md"),
    createCrewContextSummary(threads),
    "utf8",
  );
  writeFileSync(
    path.join(root, "memory", "chat", "ConversationDigest.md"),
    createConversationDigestSummary(conversationDigest),
    "utf8",
  );
  // 화면에서 오는 저장(대화 중 수시로 옴)은 프롬프트 기억 재생성(원장 10여 개 재파싱,
  // 약 80ms)을 잠깐 미뤄 한 번으로 합친다. 다음 답변 전 load_prompt_context 가 먼저
  // 밀린 재생성을 끝내므로 모델이 보는 기억은 늦지 않는다.
  if (payload.deferPromptRefresh === true) schedulePromptMemoryRefresh(root);
  else refreshPromptMemory(root);
  return {
    status: "local_memory_chat_threads_saved",
    root,
    chatThreadsPath,
    conversationDigestPath,
    threadCount: threads.length,
    messageCount: countMessages(threads),
    conversationDigestCount: conversationDigest.length,
    userMessage: "대화 기억을 로컬 저장소에 저장했습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function loadAppProfile(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const appProfilePath = path.join(root, appProfileRelativePath);
  const portableManifestPath = path.join(root, portableManifestFileName);
  const crewSoulBundlePath = path.join(root, crewSoulBundleRelativePath);
  const crewSoulBundleSummaryPath = path.join(root, crewSoulBundleSummaryRelativePath);
  const profile = sanitizeAppProfile(readJsonObject(appProfilePath));
  const portableManifest = readJsonObject(portableManifestPath);
  const crewSoulBundle = sanitizeCrewSoulBundle(readJsonObject(crewSoulBundlePath));
  const skillBootstrapPlan = sanitizeSkillBootstrapPlan(
    readJsonObject(path.join(root, skillBootstrapPlanRelativePath)),
  );
  return {
    status: "local_memory_app_profile_loaded",
    root,
    appProfilePath,
    portableManifestPath,
    crewSoulBundlePath,
    crewSoulBundleSummaryPath,
    portableManifest: sanitizePortableManifest(portableManifest),
    crewSoulBundle,
    crewSoulBundleReady: Boolean(crewSoulBundle && existsSync(crewSoulBundleSummaryPath)),
    skillBootstrapPlan,
    skillBootstrapPlanReady: Boolean(skillBootstrapPlan),
    skillBootstrapActiveCrewKitCount: skillBootstrapPlan?.activeCrewKits?.length ?? 0,
    externalReauthorizationCount: skillBootstrapPlan?.externalReauthorization?.length ?? 0,
    restoreReady: Boolean(profile && portableManifest?.portableMemory === true),
    profile,
    userMessage: userFacingLocalProfileLoadedMessage(Boolean(profile)),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function saveAppProfile(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const appProfilePath = path.join(root, appProfileRelativePath);
  const profile = sanitizeAppProfile(payload.profile);
  const nextProfile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...(profile ?? { teammates: [], skills: [], activeSkillIds: [], appSettings: {} }),
  };
  atomicWriteJson(appProfilePath, nextProfile);
  writeFileSync(
    path.join(root, "memory", "app-profile", "PROFILE.md"),
    createAppProfileSummary(nextProfile),
    "utf8",
  );
  writeFileSync(
    path.join(root, "memory", "CrewSoul.md"),
    createCrewSoulSummary(nextProfile),
    "utf8",
  );
  writeTeammateCrewSouls(root, nextProfile);
  writeCrewChannelIndex(root, nextProfile);
  writeCrewChannelBlueprint(root, nextProfile);
  const crewKitRecords = writeCrewKitMemory(root, nextProfile);
  const portableManifest = writePortableMemoryBundle(root, nextProfile, crewKitRecords);
  const crewSoulBundlePath = path.join(root, crewSoulBundleRelativePath);
  const crewSoulBundleSummaryPath = path.join(root, crewSoulBundleSummaryRelativePath);
  const crewChannelBlueprintPath = path.join(root, crewChannelBlueprintRelativePath);
  const crewChannelBlueprintSummaryPath = path.join(root, crewChannelBlueprintSummaryRelativePath);
  refreshPromptMemory(root);
  return {
    status: "local_memory_app_profile_saved",
    root,
    appProfilePath,
    portableManifestPath: path.join(root, portableManifestFileName),
    crewSoulBundlePath,
    crewSoulBundleSummaryPath,
    crewChannelBlueprintPath,
    crewChannelBlueprintSummaryPath,
    crewSoulBundle: sanitizeCrewSoulBundle(readJsonObject(crewSoulBundlePath)),
    crewSoulBundleReady: existsSync(crewSoulBundlePath) && existsSync(crewSoulBundleSummaryPath),
    crewChannelBlueprintReady: existsSync(crewChannelBlueprintPath) && existsSync(crewChannelBlueprintSummaryPath),
    portableManifest,
    restoreReady: true,
    profile: nextProfile,
    userMessage: userFacingLocalProfileSavedMessage(),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function saveWorkDecisions(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const decisionLedgerPath = path.join(root, decisionLedgerRelativePath);
  const existing = sanitizeDecisionRecords(readJsonArray(decisionLedgerPath));
  const incoming = sanitizeDecisionRecords(
    Array.isArray(payload.decisions) ? payload.decisions : [],
    {
      teammateId: payload.teammateId,
      teammateName: payload.teammateName,
      source: payload.source,
    },
  );
  const byId = new Map();
  for (const record of [...incoming, ...existing]) {
    if (!byId.has(record.id)) byId.set(record.id, record);
  }
  const records = [...byId.values()]
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime())
    .slice(0, 300);
  atomicWriteJson(decisionLedgerPath, records);
  writeFileSync(
    path.join(root, "memory", "decisions", "DecisionMemory.md"),
    createDecisionMemorySummary(records),
    "utf8",
  );
  writeTeammateDecisionLogs(root, records);
  const profile = sanitizeAppProfile(readJsonObject(path.join(root, appProfileRelativePath)));
  if (profile) {
    const crewKitRecords = readJsonArray(path.join(root, "memory", "crew-kits", "crew-kits.json"));
    writePortableMemoryBundle(root, profile, crewKitRecords.length ? crewKitRecords : createCrewKitRecords(profile));
  }
  refreshPromptMemory(root);
  return {
    status: "local_memory_work_decisions_saved",
    root,
    decisionLedgerPath,
    decisionCount: records.length,
    addedDecisionCount: incoming.length,
    userMessage: incoming.length
      ? `업무 결정 ${incoming.length}건을 로컬 DecisionMemory에 저장했습니다.`
      : "저장할 새 업무 결정은 없지만 DecisionMemory를 확인했습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function saveWorkLearning(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const workPatternLedgerPath = path.join(root, workPatternLedgerRelativePath);
  const existing = sanitizeWorkPatternRecords(readJsonArray(workPatternLedgerPath));
  const rawRecords = Array.isArray(payload.records) && payload.records.length ? payload.records : [payload];
  const incoming = sanitizeWorkPatternRecords(
    rawRecords,
    {
      teammateId: payload.teammateId,
      teammateName: payload.teammateName,
      sourceKind: payload.sourceKind,
      sourceLabel: payload.sourceLabel,
    },
  );
  const byId = new Map();
  for (const record of [...incoming, ...existing]) {
    if (!byId.has(record.id)) byId.set(record.id, record);
  }
  const records = [...byId.values()]
    .sort((a, b) => new Date(b.learnedAt).getTime() - new Date(a.learnedAt).getTime())
    .slice(0, 400);
  atomicWriteJson(workPatternLedgerPath, records);
  writeWorkPatternMemories(root, records);
  const profile = sanitizeAppProfile(readJsonObject(path.join(root, appProfileRelativePath)));
  if (profile) {
    const crewKitRecords = readJsonArray(path.join(root, "memory", "crew-kits", "crew-kits.json"));
    writePortableMemoryBundle(root, profile, crewKitRecords.length ? crewKitRecords : createCrewKitRecords(profile));
  }
  refreshPromptMemory(root);
  return {
    status: "local_memory_work_learning_saved",
    root,
    workPatternLedgerPath,
    workPatternCount: records.length,
    addedWorkPatternCount: incoming.length,
    connectorRecoveryMemoryCount: createConnectorRecoveryMemoryRecords(records).length,
    connectorRecoveryMemories: createConnectorRecoveryMemoryRecords(records),
    userMessage: userFacingWorkLearningSavedMessage(incoming.length),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function listWorkPatterns(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const workPatternLedgerPath = path.join(root, workPatternLedgerRelativePath);
  const records = readCachedWorkPatternRecords(root);
  writeWorkPatternMemories(root, records);
  const status = getLocalMemoryStatus(options);
  return {
    ...status,
    status: "local_memory_work_patterns_loaded",
    root,
    workPatternLedgerPath,
    workPatterns: records.slice(0, 80),
    workPatternCount: records.length,
    userMessage: records.length
      ? `저장한 업무 방식 ${records.length}개를 불러왔습니다.`
      : "아직 저장한 업무 방식이 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function updateWorkPattern(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const workPatternLedgerPath = path.join(root, workPatternLedgerRelativePath);
  const existing = sanitizeWorkPatternRecords(readJsonArray(workPatternLedgerPath));
  const targetId = sanitizeLine(payload.id || payload.patternId, 220);
  const target = existing.find((record) => record.id === targetId);
  if (!target) {
    return {
      ...getLocalMemoryStatus(options),
      status: "local_memory_work_pattern_not_found",
      workPatternLedgerPath,
      userMessage: "수정할 저장 방식이 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const patch = payload.patch && typeof payload.patch === "object" ? payload.patch : payload;
  const sanitized = sanitizeWorkPatternRecord(
    {
      ...target,
      ...("sourceKind" in patch ? { sourceKind: patch.sourceKind } : {}),
      ...("sourceLabel" in patch ? { sourceLabel: patch.sourceLabel } : {}),
      ...("teammateId" in patch ? { teammateId: patch.teammateId } : {}),
      ...("teammateName" in patch ? { teammateName: patch.teammateName } : {}),
      ...("summary" in patch ? { summary: patch.summary } : {}),
      ...("signals" in patch ? { signals: patch.signals } : {}),
      ...("artifactPaths" in patch ? { artifactPaths: patch.artifactPaths } : {}),
      ...("metrics" in patch ? { metrics: { ...target.metrics, ...patch.metrics } } : {}),
      id: target.id,
      learnedAt: sanitizeIsoDate(patch.learnedAt || new Date().toISOString()),
    },
    {},
    0,
  );

  if (!sanitized) {
    return {
      ...getLocalMemoryStatus(options),
      status: "local_memory_work_pattern_empty",
      workPatternLedgerPath,
      userMessage: "저장 방식은 요약이나 처리 기준이 최소 하나 필요합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const records = existing
    .map((record) => (record.id === target.id ? sanitized : record))
    .sort((a, b) => new Date(b.learnedAt).getTime() - new Date(a.learnedAt).getTime())
    .slice(0, 400);
  atomicWriteJson(workPatternLedgerPath, records);
  writeWorkPatternMemories(root, records);
  refreshPortableMemoryBundle(root);
  refreshPromptMemory(root);
  const status = getLocalMemoryStatus(options);
  return {
    ...status,
    status: "local_memory_work_pattern_updated",
    root,
    workPatternLedgerPath,
    workPatterns: records.slice(0, 80),
    workPatternCount: records.length,
    updatedWorkPatternId: target.id,
    userMessage: "저장한 업무 방식을 수정했습니다. 다음 답변부터 수정된 기준을 우선 참고합니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function removeWorkPattern(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const workPatternLedgerPath = path.join(root, workPatternLedgerRelativePath);
  const existing = sanitizeWorkPatternRecords(readJsonArray(workPatternLedgerPath));
  const targetId = sanitizeLine(payload.id || payload.patternId, 220);
  const records = existing.filter((record) => record.id !== targetId);
  const removedWorkPatternCount = existing.length - records.length;
  atomicWriteJson(workPatternLedgerPath, records);
  writeWorkPatternMemories(root, records);
  refreshPortableMemoryBundle(root);
  refreshPromptMemory(root);
  const status = getLocalMemoryStatus(options);
  return {
    ...status,
    status: removedWorkPatternCount ? "local_memory_work_pattern_removed" : "local_memory_work_pattern_not_found",
    root,
    workPatternLedgerPath,
    workPatterns: records.slice(0, 80),
    workPatternCount: records.length,
    removedWorkPatternCount,
    userMessage: removedWorkPatternCount
      ? "저장한 업무 방식을 목록에서 삭제했습니다. 원본 파일, 외부 계정, 과거 대화는 건드리지 않았습니다."
      : "삭제할 저장 방식이 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function listLearningSources(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const learningSourcesPath = path.join(root, learningSourcesLedgerRelativePath);
  const learningSources = readCachedLearningSourceRecords(root);
  writeLearningSourceSummary(root, learningSources);
  const status = getLocalMemoryStatus(options);
  return {
    ...status,
    status: "local_memory_learning_sources_loaded",
    root,
    learningSourcesPath,
    learningSources: learningSources.slice(),
    learningSourceCount: learningSources.length,
    userMessage: learningSources.length
      ? `업무 자료 출처 ${learningSources.length}곳을 불러왔습니다.`
      : "아직 저장된 업무 자료 출처가 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function upsertLearningSources(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const learningSourcesPath = path.join(root, learningSourcesLedgerRelativePath);
  const existing = sanitizeLearningSourceRecords(readJsonArray(learningSourcesPath));
  const rawSources = Array.isArray(payload.sources)
    ? payload.sources
    : Array.isArray(payload.folders)
      ? payload.folders
      : [];
  const incoming = sanitizeLearningSourceRecords(rawSources, {
    source: payload.source || "document_learning",
    selectedAt: payload.selectedAt || new Date().toISOString(),
    lastScannedAt: payload.lastScannedAt || new Date().toISOString(),
  });
  const byId = new Map();
  for (const record of [...existing, ...incoming]) {
    if (!record.id) continue;
    byId.set(record.id, { ...(byId.get(record.id) ?? {}), ...record });
  }
  const learningSources = [...byId.values()]
    .sort((a, b) => new Date(b.lastScannedAt || b.selectedAt).getTime() - new Date(a.lastScannedAt || a.selectedAt).getTime())
    .slice(0, 120);
  atomicWriteJson(learningSourcesPath, learningSources);
  writeLearningSourceSummary(root, learningSources);
  refreshPortableMemoryBundle(root);
  refreshPromptMemory(root);
  const status = getLocalMemoryStatus(options);
  return {
    ...status,
    status: "local_memory_learning_sources_saved",
    root,
    learningSourcesPath,
    learningSources,
    learningSourceCount: learningSources.length,
    addedLearningSourceCount: incoming.length,
    userMessage: incoming.length
      ? `업무 자료 출처 ${incoming.length}곳을 LearningSources에 저장했습니다.`
      : "저장할 새 업무 자료 출처는 없지만 LearningSources를 확인했습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function importWorkspaceKnowledge(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const importedAt = sanitizeIsoDate(payload.importedAt || payload.selectedAt || new Date().toISOString());
  const teammateId = sanitizeLine(payload.teammateId || "teammate-personal-operator", 120);
  const teammateName = sanitizeLine(payload.teammateName || "업무 비서", 80);
  const rawSources = Array.isArray(payload.sources) ? payload.sources : [];
  const incomingSources = sanitizeLearningSourceRecords(rawSources, {
    source: "workspace_knowledge_import",
    sourceKind: "workspace_knowledge",
    selectedAt: importedAt,
    lastScannedAt: importedAt,
  });
  const learningSourcesPath = path.join(root, learningSourcesLedgerRelativePath);
  const existingSources = sanitizeLearningSourceRecords(readJsonArray(learningSourcesPath));
  const sourceById = new Map();
  for (const source of [...existingSources, ...incomingSources]) {
    if (!source.id) continue;
    sourceById.set(source.id, { ...(sourceById.get(source.id) ?? {}), ...source });
  }
  const learningSources = [...sourceById.values()]
    .sort((a, b) => new Date(b.lastScannedAt || b.selectedAt).getTime() - new Date(a.lastScannedAt || a.selectedAt).getTime())
    .slice(0, 120);
  atomicWriteJson(learningSourcesPath, learningSources);
  writeLearningSourceSummary(root, learningSources);

  const sourceLabels = incomingSources.map((source) => source.label).filter(Boolean);
  const providerLabels = [...new Set(incomingSources.map((source) => source.sourceKind).filter(Boolean))];
  const signals = [
    "사용자가 선택한 회사 자료 출처만 학습 대상으로 저장했습니다.",
    "원본 Google Sheets, Slack, Notion, 로컬 폴더는 변경하지 않습니다.",
    "대량 자료는 인덱스, 샘플 요약, 보안 경계, 반복 업무 패턴 순서로 다시 확인합니다.",
    ...sourceLabels.slice(0, 6).map((label) => `선택 출처: ${label}`),
  ];
  const importSummary = sanitizeLine(
    payload.summary ||
      `${sourceLabels.join(", ") || "회사 자료"}에서 업무 지식 import 후보를 만들고 출처별 요약과 다음 확인 질문을 분리했습니다.`,
    360,
  );
  const workLearning = saveWorkLearning(
    {
      teammateId,
      teammateName,
      records: [
        {
          id: sanitizeLine(payload.id || `workspace-knowledge-import-${createHash("sha256").update(`${importedAt}:${sourceLabels.join("|")}`).digest("hex").slice(0, 12)}`, 220),
          sourceKind: "workspace_knowledge",
          sourceLabel: userFacingWorkspaceKnowledgeSourceLabel(),
          learnedAt: importedAt,
          teammateId,
          teammateName,
          summary: importSummary,
          signals,
          artifactPaths: [
            "memory/documents/LearningSources.md",
            "memory/documents/WorkspaceKnowledgeImport.md",
          ],
          metrics: {
            sourceCount: incomingSources.length,
            providerCount: providerLabels.length,
            fileCount: incomingSources.reduce((sum, source) => sum + Number(source.fileCount || 0), 0),
          },
        },
      ],
    },
    options,
  );
  writeWorkspaceKnowledgeImportSummary(root, incomingSources, {
    importedAt,
    teammateId,
    teammateName,
    summary: importSummary,
    signals,
  });
  refreshPortableMemoryBundle(root);
  refreshPromptMemory(root);
  const status = getLocalMemoryStatus(options);
  return {
    ...status,
    status: "local_memory_workspace_knowledge_imported",
    root,
    learningSourcesPath,
    learningSources,
    learningSourceCount: learningSources.length,
    importedLearningSourceCount: incomingSources.length,
    workPatternCount: workLearning.workPatternCount,
    workspaceKnowledgeImportPath: path.join(root, "memory", "documents", "WorkspaceKnowledgeImport.md"),
    userMessage: incomingSources.length
      ? `회사 자료 출처 ${incomingSources.length}곳을 선택 학습으로 저장하고 자료 학습 기억에 반영했습니다.`
      : "가져올 회사 자료 출처는 없지만 기존 학습 출처와 자료 학습 기억을 확인했습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function removeLearningSource(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const learningSourcesPath = path.join(root, learningSourcesLedgerRelativePath);
  const requestedId = sanitizeLine(payload.id || payload.sourceId, 160);
  const requestedPath = normalizeLearningSourcePath(payload.path || payload.absolutePath || "");
  const existing = sanitizeLearningSourceRecords(readJsonArray(learningSourcesPath));
  const learningSources = existing.filter((record) => {
    if (requestedId && record.id === requestedId) return false;
    if (requestedPath && record.path.toLowerCase() === requestedPath.toLowerCase()) return false;
    return true;
  });
  atomicWriteJson(learningSourcesPath, learningSources);
  writeLearningSourceSummary(root, learningSources);
  refreshPortableMemoryBundle(root);
  refreshPromptMemory(root);
  const status = getLocalMemoryStatus(options);
  return {
    ...status,
    status: "local_memory_learning_source_removed",
    root,
    learningSourcesPath,
    learningSources,
    learningSourceCount: learningSources.length,
    removedLearningSourceCount: existing.length - learningSources.length,
    userMessage:
      existing.length === learningSources.length
        ? "삭제할 업무 자료 출처를 찾지 못했습니다."
        : "업무 자료 출처를 LearningSources에서 제거했습니다. 원본 폴더나 파일은 삭제하지 않았습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function saveDelegationArtifact(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const kind = sanitizeDelegationArtifactKind(payload.artifactKind || payload.kind);
  const createdAt = sanitizeIsoDate(payload.createdAt || new Date().toISOString());
  const artifactId = sanitizePathSegment(payload.artifactId || payload.id || `delegation-${kind}-${Date.now()}`);
  const folder = path.join(root, "memory", "delegations", artifactId);
  const relativeFolder = `memory/delegations/${artifactId}`;
  const fileName = delegationArtifactFileName(kind);
  const relativePath = `${relativeFolder}/${fileName}`;
  const filePath = path.join(folder, fileName);
  const metadataPath = path.join(folder, "metadata.json");
  const ledgerPath = path.join(root, delegationArtifactLedgerRelativePath);
  const body = canonicalizeMainAgentArtifactBody(payload.body);
  const untrustedRecord = sanitizeDelegationArtifactRecord({
    id: artifactId,
    artifactKind: kind,
    title: payload.title,
    requestText: payload.requestText,
    sourceThreadId: payload.sourceThreadId,
    sourceTeammateId: payload.sourceTeammateId,
    teammateName: payload.teammateName,
    createdAt,
    relativePath,
    folderPath: relativeFolder,
    rows: payload.rows,
    metrics: payload.metrics,
  });
  const trustedWorkspaceAgentOutcome =
    await resolveTrustedWorkspaceAgentOutcomeBinding(
      untrustedRecord,
      body,
      options,
    );
  const record = trustedWorkspaceAgentOutcome
    ? { ...untrustedRecord, trustedWorkspaceAgentOutcome }
    : untrustedRecord;
  const existing = sanitizeDelegationArtifactRecords(readJsonArray(ledgerPath));
  const existingRecord = existing.find((item) => item.id === record.id);
  const existingTrustedOutcome = sanitizeTrustedWorkspaceAgentOutcomeBinding(
    existingRecord?.trustedWorkspaceAgentOutcome,
  );
  if (existingTrustedOutcome) {
    if (
      !trustedWorkspaceAgentOutcome ||
      existingTrustedOutcome.runId !== trustedWorkspaceAgentOutcome.runId
    ) {
      return {
        status: "local_memory_delegation_artifact_binding_conflict",
        root,
        artifactId,
        artifactKind: kind,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        userMessage: "\uc774\ubbf8 \ub2e4\ub978 main \ubc1c\uae09 \uc2e4\ud589\uc5d0 \ubb36\uc778 AI \ud300\uc6d0 \uacb0\uacfc\ub77c \ub36e\uc5b4\uc4f0\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.",
      };
    }
    return {
      status: "local_memory_delegation_artifact_already_saved",
      root,
      artifactId,
      artifactKind: kind,
      fileName,
      relativePath: existingRecord.relativePath,
      filePath,
      metadataPath,
      ledgerPath,
      agentOutcomeLearning: {
        status: "workspace_intelligence_outcome_already_bound",
        newAgentRunIds: [],
        externalMutation: false,
      },
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "\uac19\uc740 main \ubc1c\uae09 \uc2e4\ud589\uc758 AI \ud300\uc6d0 \uacb0\uacfc\uac00 \uc774\ubbf8 \uc548\uc804\ud558\uac8c \uc800\uc7a5\ub418\uc5b4 \uc788\uc2b5\ub2c8\ub2e4.",
    };
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(filePath, createDelegationArtifactMarkdown(record, body), "utf8");
  atomicWriteJson(metadataPath, {
    ...record,
    schema: "modycrew.delegation-artifact.v1",
    fileName,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  });

  const byId = new Map();
  for (const item of [record, ...existing]) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const records = [...byId.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 200);
  atomicWriteJson(ledgerPath, records);
  writeFileSync(
    path.join(root, "memory", "delegations", "DelegationArtifacts.md"),
    createDelegationArtifactsSummary(records),
    "utf8",
  );

  const profile = sanitizeAppProfile(
    readJsonObject(path.join(root, appProfileRelativePath)),
  );
  if (profile) {
    const crewKitRecords = readJsonArray(path.join(root, "memory", "crew-kits", "crew-kits.json"));
    writePortableMemoryBundle(root, profile, crewKitRecords.length ? crewKitRecords : createCrewKitRecords(profile));
  }
  refreshPromptMemory(root);
  const failedOutcome = createWorkspaceAgentFailureOutcomeFromDelegationArtifact(record);
  const agentOutcomeLearning = failedOutcome
    ? await updateLocalMemoryWorkspaceIntelligence(
        {
          workspaceId: payload.workspaceId,
          observedAt: failedOutcome.finishedAt,
          agentOutcomes: [failedOutcome],
        },
        options,
      )
    : {
        status:
          hasWorkspaceAgentOutcomeReference(record) &&
          !sanitizeTrustedWorkspaceAgentOutcomeBinding(record.trustedWorkspaceAgentOutcome)
            ? "workspace_intelligence_outcome_untrusted"
            : "workspace_intelligence_outcome_not_applicable",
        newAgentRunIds: [],
        externalMutation: false,
      };
  return {
    status: "local_memory_delegation_artifact_saved",
    root,
    artifactId,
    artifactKind: kind,
    fileName,
    relativePath,
    filePath,
    metadataPath,
    ledgerPath,
    artifactCount: records.length,
    delegationArtifactCount: records.length,
    agentOutcomeLearning,
    userMessage: `${delegationArtifactKindLabel(kind)}을 로컬 기억 결과로 저장했습니다: ${relativePath}`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function refreshPortableMemoryBundle(root) {
  const profile = sanitizeAppProfile(readJsonObject(path.join(root, appProfileRelativePath)));
  if (!profile) return null;
  const crewKitRecords = readJsonArray(path.join(root, "memory", "crew-kits", "crew-kits.json"));
  return writePortableMemoryBundle(root, profile, crewKitRecords.length ? crewKitRecords : createCrewKitRecords(profile));
}

function listDelegationArtifacts(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const ledgerPath = path.join(root, delegationArtifactLedgerRelativePath);
  const artifacts = readCachedDelegationArtifactRecords(root);
  return {
    status: "local_memory_delegation_artifacts_loaded",
    root,
    ledgerPath,
    artifacts: artifacts.slice(),
    artifactCount: artifacts.length,
    delegationArtifactCount: artifacts.length,
    userMessage: artifacts.length
      ? `AI 팀원 결과 ${artifacts.length}건을 불러왔습니다.`
      : "아직 AI 팀원이 만든 보고서, 메일, 승인 후보 결과가 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function openDelegationArtifact(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  if (!options.shell?.openPath) {
    return {
      status: "shell_unavailable",
      userMessage: "로컬 결과를 열 수 있는 Windows shell API가 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  const ledgerPath = path.join(root, delegationArtifactLedgerRelativePath);
  const artifacts = sanitizeDelegationArtifactRecords(readJsonArray(ledgerPath));
  const requestedId = sanitizeLine(payload.artifactId || payload.id, 180);
  const requestedPath = sanitizeLine(payload.relativePath, 260);
  const artifact = artifacts.find((item) =>
    (requestedId && item.id === requestedId) ||
    (requestedPath && item.relativePath === requestedPath),
  );
  const relativePath = artifact?.relativePath || requestedPath;
  const resolved = resolveDelegationArtifactPath(root, relativePath);
  if (!resolved || !existsSync(resolved)) {
    return {
      status: "local_memory_delegation_artifact_missing",
      root,
      artifactId: requestedId,
      relativePath,
      userMessage: "열 수 있는 AI 팀원 결과 파일이 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  const errorMessage = await options.shell.openPath(resolved);
  return {
    status: errorMessage ? "local_memory_delegation_artifact_open_failed" : "local_memory_delegation_artifact_opened",
    root,
    artifactId: artifact?.id || requestedId,
    artifactKind: artifact?.artifactKind,
    relativePath,
    filePath: resolved,
    errorMessage: errorMessage || undefined,
    userMessage: errorMessage || "AI 팀원 결과 파일 열기 요청을 보냈습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function openMemoryFile(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  if (!options.shell?.openPath) {
    return {
      status: "shell_unavailable",
      userMessage: "로컬 기억 파일을 열 수 있는 Windows shell API가 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  const relativePath = sanitizeLine(payload.relativePath || payload.path, 320);
  const resolved = resolveLocalMemoryFilePath(root, relativePath);
  if (!resolved) {
    return {
      status: "local_memory_file_blocked",
      root,
      relativePath,
      userMessage: "로컬 기억 폴더 밖의 파일은 앱에서 열 수 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return {
      status: "local_memory_file_missing",
      root,
      relativePath,
      filePath: resolved,
      userMessage: "아직 생성되지 않았거나 열 수 없는 로컬 기억 파일입니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  const errorMessage = await options.shell.openPath(resolved);
  return {
    status: errorMessage ? "local_memory_file_open_failed" : "local_memory_file_opened",
    root,
    relativePath,
    filePath: resolved,
    errorMessage: errorMessage || undefined,
    userMessage: errorMessage || "로컬 기억 파일 열기 요청을 보냈습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function recordDelegationArtifactDecision(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  return enqueueDelegationArtifactDecision(root, () =>
    recordDelegationArtifactDecisionSaga(payload, options, root),
  );
}

function enqueueDelegationArtifactDecision(root, task) {
  const key = path.resolve(root).toLowerCase();
  const previous = delegationDecisionQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  delegationDecisionQueues.set(key, current);
  return current.finally(() => {
    if (delegationDecisionQueues.get(key) === current) {
      delegationDecisionQueues.delete(key);
    }
  });
}

async function recordDelegationArtifactDecisionSaga(
  payload = {},
  options = {},
  root,
) {
  const artifactLedgerPath = path.join(root, delegationArtifactLedgerRelativePath);
  const decisionLedgerPath = path.join(root, delegationApprovalDecisionLedgerRelativePath);
  const globalDecisionLedgerPath = path.join(root, decisionLedgerRelativePath);
  const actionQueuePath = path.join(root, delegationActionQueueLedgerRelativePath);
  const sagaPath = path.join(root, delegationDecisionSagaRelativePath);
  const loadedSaga = readDelegationDecisionSaga(sagaPath);
  if (loadedSaga.corrupt) {
    return {
      status: "local_memory_delegation_decision_saga_recovery_required",
      root,
      sagaPath,
      writeBlocked: true,
      recoveryRequired: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "승인 결정 복구 장부를 안전하게 읽지 못해 새 결정을 저장하지 않았습니다.",
    };
  }
  const artifacts = sanitizeDelegationArtifactRecords(readJsonArray(artifactLedgerPath));
  const artifactId = sanitizeLine(payload.artifactId || payload.id, 180);
  const artifact = artifacts.find((item) => item.id === artifactId);
  if (!artifact) {
    return {
      status: "local_memory_delegation_artifact_missing",
      root,
      artifactId,
      sagaPath,
      userMessage: "승인 처리할 AI 팀원 결과를 찾지 못했습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const decision = sanitizeDelegationApprovalDecision(payload.decision);
  const decisionId = createDelegationDecisionId(artifact.id, decision);
  const terminalDecision = terminalDelegationApprovalDecisions.has(decision);
  const existingDecisions = sanitizeDelegationApprovalDecisionRecords(
    readJsonArray(decisionLedgerPath),
  );
  const conflictingSagaDecision = loadedSaga.state.records.find(
    (record) =>
      record.artifactId === artifact.id &&
      terminalDelegationApprovalDecisions.has(record.decision) &&
      record.decision !== decision,
  );
  const conflictingProjectedDecision = existingDecisions.find(
    (record) =>
      record.artifactId === artifact.id &&
      terminalDelegationApprovalDecisions.has(record.decision) &&
      record.decision !== decision,
  );
  if (terminalDecision && (conflictingSagaDecision || conflictingProjectedDecision)) {
    const existingTerminalDecision =
      conflictingSagaDecision ?? conflictingProjectedDecision;
    return {
      status: "local_memory_delegation_artifact_terminal_decision_exists",
      root,
      sagaPath,
      artifactId: artifact.id,
      decision: existingTerminalDecision.decision,
      approvalStatus: delegationApprovalDecisionStatus(existingTerminalDecision.decision),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "이 실행 결과의 최종 판단은 이미 기록되었습니다. 수정 재작업은 새 실행으로 시작해 주세요.",
    };
  }

  let sagaRecord = loadedSaga.state.records.find(
    (record) => record.artifactId === artifact.id && record.decisionId === decisionId,
  );
  if (!sagaRecord) {
    sagaRecord = createDelegationDecisionSagaRecord({
      artifact,
      decision,
      decisionId,
      decidedAt: payload.decidedAt,
      decidedBy: payload.decidedBy,
      note: payload.note || payload.revisionInstruction,
      correctionSignals: payload.correctionSignals,
    });
    loadedSaga.state.records = [sagaRecord, ...loadedSaga.state.records].slice(0, 300);
    loadedSaga.state.updatedAt = sagaRecord.updatedAt;
    writeDelegationDecisionSaga(sagaPath, loadedSaga.state);
  }

  const sagaArtifact = sanitizeDelegationArtifactRecord({
    ...artifact,
    ...(sagaRecord.trustedWorkspaceAgentOutcome
      ? { trustedWorkspaceAgentOutcome: sagaRecord.trustedWorkspaceAgentOutcome }
      : {}),
  });
  const decisionRecord = createDelegationApprovalDecisionRecordFromSaga(
    sagaRecord,
    sagaArtifact,
  );
  const candidateAgentOutcome = terminalDecision
    ? createWorkspaceAgentOutcomeFromDelegationDecision({
        artifact: sagaArtifact,
        decision: sagaRecord.decision,
        decidedAt: sagaRecord.decidedAt,
        correctionSignals: sagaRecord.correctionSignals,
      })
    : undefined;
  let agentOutcomeFinalization;

  if (candidateAgentOutcome && sagaRecord.phase === "pending") {
    if (typeof options.prepareTrustedWorkspaceAgentOutcomeApproval !== "function") {
      return createDelegationDecisionSagaPendingResult({
        status: "workspace_intelligence_outcome_approval_preparer_unavailable",
        root,
        sagaPath,
        artifactId: sagaArtifact.id,
        decision: sagaRecord.decision,
        userMessage: "main 실행 원장의 최종 승인 티켓을 준비할 수 없어 결정을 대기 상태로 남겼습니다.",
      });
    }
    let approvalPreparation;
    try {
      approvalPreparation = await options.prepareTrustedWorkspaceAgentOutcomeApproval(
        createTrustedWorkspaceAgentOutcomeDecisionRequest(
          sagaArtifact,
          decisionRecord,
        ),
      );
    } catch {
      approvalPreparation = {
        verified: false,
        status: "agent_run_outcome_approval_prepare_failed",
      };
    }
    const approvalTicketId = safeWorkspaceIntelligenceOpaqueId(
      approvalPreparation?.approvalTicketId,
    );
    if (approvalPreparation?.verified !== true || !approvalTicketId) {
      return createDelegationDecisionSagaPendingResult({
        status:
          approvalPreparation?.status ||
          "workspace_intelligence_outcome_approval_preparation_rejected",
        root,
        sagaPath,
        artifactId: sagaArtifact.id,
        decision: sagaRecord.decision,
        userMessage: "main 실행 원장의 최종 승인 티켓을 확인하지 못해 결정을 대기 상태로 남겼습니다.",
      });
    }
    sagaRecord = advanceDelegationDecisionSagaRecord(
      sagaPath,
      loadedSaga.state,
      sagaRecord,
      "approval_prepared",
      { approvalTicketId },
    );
  }

  if (candidateAgentOutcome && sagaRecord.phase === "approval_prepared") {
    if (typeof options.finalizeTrustedWorkspaceAgentOutcome !== "function") {
      return createDelegationDecisionSagaPendingResult({
        status: "workspace_intelligence_outcome_finalizer_unavailable",
        root,
        sagaPath,
        artifactId: sagaArtifact.id,
        decision: sagaRecord.decision,
        userMessage: "main 실행 원장을 다시 확인할 수 없어 최종 판단을 대기 상태로 남겼습니다.",
      });
    }
    let finalization;
    try {
      finalization = await options.finalizeTrustedWorkspaceAgentOutcome({
        ...createTrustedWorkspaceAgentOutcomeDecisionRequest(
          sagaArtifact,
          decisionRecord,
        ),
        approvalTicketId: sagaRecord.approvalTicketId,
      });
    } catch {
      finalization = { verified: false, status: "agent_run_outcome_finalize_failed" };
    }
    if (finalization?.verified !== true) {
      if (finalization?.status === "agent_run_outcome_ticket_rejected") {
        sagaRecord = advanceDelegationDecisionSagaRecord(
          sagaPath,
          loadedSaga.state,
          sagaRecord,
          "pending",
          { approvalTicketId: "", trustedOutcomeFinalized: false },
        );
      }
      return createDelegationDecisionSagaPendingResult({
        status:
          finalization?.status ||
          "workspace_intelligence_outcome_finalization_rejected",
        root,
        sagaPath,
        artifactId: sagaArtifact.id,
        decision: sagaRecord.decision,
        userMessage: "이 실행 결과는 이미 다른 최종 판단에 사용됐거나 main 원장과 일치하지 않아 대기 상태로 남겼습니다.",
      });
    }
    agentOutcomeFinalization = finalization;
    sagaRecord = advanceDelegationDecisionSagaRecord(
      sagaPath,
      loadedSaga.state,
      sagaRecord,
      "finalized",
      { trustedOutcomeFinalized: true },
    );
  }

  let projections;
  if (
    sagaRecord.phase === "finalized" ||
    (!candidateAgentOutcome && sagaRecord.phase === "pending")
  ) {
    projections = persistDelegationArtifactDecisionProjections(
      root,
      sagaArtifact,
      decisionRecord,
    );
    sagaRecord = advanceDelegationDecisionSagaRecord(
      sagaPath,
      loadedSaga.state,
      sagaRecord,
      "local_projected",
    );
  }

  let agentOutcomeLearning;
  let agentOrganizationPerformance;
  if (sagaRecord.phase === "local_projected") {
    if (candidateAgentOutcome) {
      agentOutcomeLearning = await updateLocalMemoryWorkspaceIntelligence(
        {
          workspaceId: payload.workspaceId,
          observedAt: candidateAgentOutcome.finishedAt,
          agentOutcomes: [candidateAgentOutcome],
        },
        options,
      );
      if (
        ![
          "workspace_intelligence_updated",
          "workspace_intelligence_recovered_and_updated",
        ].includes(agentOutcomeLearning.status)
      ) {
        return createDelegationDecisionSagaPendingResult({
          status: "local_memory_delegation_artifact_decision_learning_pending",
          root,
          sagaPath,
          artifactId: sagaArtifact.id,
          decision: sagaRecord.decision,
          agentOutcome: candidateAgentOutcome,
          agentOutcomeFinalization,
          agentOutcomeLearning,
          userMessage: "최종 판단은 저장됐지만 업무 학습 반영을 다시 시도해야 합니다.",
        });
      }
    } else {
      agentOutcomeLearning = createDelegationDecisionLearningNotApplicable(
        sagaArtifact,
        sagaRecord.decision,
      );
    }
    if (candidateAgentOutcome) {
      agentOrganizationPerformance =
        await recordAgentOrganizationPerformanceFromDelegationDecision({
          artifact: sagaArtifact,
          decisionRecord,
          agentOutcome: candidateAgentOutcome,
        }, options);
      if (
        agentOrganizationPerformance.status ===
        "agent_org_performance_record_write_failed"
      ) {
        return createDelegationDecisionSagaPendingResult({
          status: "local_memory_delegation_artifact_decision_performance_pending",
          root,
          sagaPath,
          artifactId: sagaArtifact.id,
          decision: sagaRecord.decision,
          agentOutcome: candidateAgentOutcome,
          agentOutcomeFinalization,
          agentOutcomeLearning,
          agentOrganizationPerformance,
          userMessage: "최종 판단은 저장됐지만 직원 성과 기록을 다시 반영해야 합니다.",
        });
      }
    }
    sagaRecord = advanceDelegationDecisionSagaRecord(
      sagaPath,
      loadedSaga.state,
      sagaRecord,
      "learning_applied",
    );
  }

  if (sagaRecord.phase === "learning_applied") {
    sagaRecord = advanceDelegationDecisionSagaRecord(
      sagaPath,
      loadedSaga.state,
      sagaRecord,
      "committed",
    );
  }

  const projectionSnapshot =
    projections ?? readDelegationArtifactDecisionProjectionSnapshot(root, sagaArtifact.id, decisionId);
  return {
    status: "local_memory_delegation_artifact_decision_recorded",
    root,
    sagaPath,
    artifactId: sagaArtifact.id,
    decision: sagaRecord.decision,
    approvalStatus: projectionSnapshot.artifact?.approvalStatus,
    decisionLedgerPath,
    globalDecisionLedgerPath,
    actionQueuePath,
    decisionCount: projectionSnapshot.decisionRecords.length,
    decisionMemoryCount: projectionSnapshot.decisionMemoryRecords.length,
    queueCount: projectionSnapshot.queueRecords.length,
    artifact: projectionSnapshot.artifact,
    queuedAction: projectionSnapshot.queuedAction,
    approvalTicketId: sagaRecord.approvalTicketId || undefined,
    agentOutcome: candidateAgentOutcome,
    ...(agentOutcomeFinalization ? { agentOutcomeFinalization } : {}),
    agentOutcomeLearning:
      agentOutcomeLearning ??
      (candidateAgentOutcome
        ? {
            status: "workspace_intelligence_outcome_already_learned",
            newAgentRunIds: [],
            externalMutation: false,
          }
        : createDelegationDecisionLearningNotApplicable(
            sagaArtifact,
            sagaRecord.decision,
          )),
    agentOrganizationPerformance:
      agentOrganizationPerformance ??
      (candidateAgentOutcome
        ? { status: "agent_org_performance_already_recorded", externalMutation: false }
        : { status: "agent_org_performance_not_applicable", externalMutation: false }),
    idempotent: sagaRecord.phase === "committed" && !projections && !agentOutcomeLearning,
    userMessage: `승인 요청 결과에 '${delegationApprovalDecisionLabel(sagaRecord.decision)}' 결정을 저장했습니다.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createDelegationDecisionSagaPendingResult(input = {}) {
  return {
    status: input.status || "local_memory_delegation_artifact_decision_pending",
    root: input.root,
    sagaPath: input.sagaPath,
    artifactId: input.artifactId,
    decision: input.decision,
    ...(input.agentOutcome ? { agentOutcome: input.agentOutcome } : {}),
    ...(input.agentOutcomeFinalization
      ? { agentOutcomeFinalization: input.agentOutcomeFinalization }
      : {}),
    ...(input.agentOutcomeLearning
      ? { agentOutcomeLearning: input.agentOutcomeLearning }
      : {}),
    ...(input.agentOrganizationPerformance
      ? { agentOrganizationPerformance: input.agentOrganizationPerformance }
      : {}),
    userMessage: input.userMessage || "승인 결정을 안전하게 이어서 처리해야 합니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createTrustedWorkspaceAgentOutcomeDecisionRequest(artifact, decisionRecord) {
  const trustedOutcome = sanitizeTrustedWorkspaceAgentOutcomeBinding(
    artifact.trustedWorkspaceAgentOutcome,
  );
  return {
    artifactId: artifact.id,
    eventId: trustedOutcome?.eventId,
    runId: trustedOutcome?.runId,
    decisionId: decisionRecord.id,
    decision: decisionRecord.decision,
    decidedAt: decisionRecord.decidedAt,
  };
}

async function recordAgentOrganizationPerformanceFromDelegationDecision(
  input = {},
  options = {},
) {
  if (typeof options.recordAgentOrganizationPerformance !== "function") {
    return {
      status: "agent_org_performance_not_connected",
      externalMutation: false,
    };
  }
  const outcome = input.agentOutcome && typeof input.agentOutcome === "object"
    ? input.agentOutcome
    : {};
  const decisionRecord = input.decisionRecord && typeof input.decisionRecord === "object"
    ? input.decisionRecord
    : {};
  const artifact = input.artifact && typeof input.artifact === "object"
    ? input.artifact
    : {};
  const teammateId = safeWorkspaceIntelligenceAgentId(outcome.agentId);
  const taskKind = String(outcome.workPackId ?? "").trim();
  const decisionId = safeWorkspaceIntelligenceOpaqueId(decisionRecord.id);
  if (!teammateId || !workspaceIntelligenceWorkPackIds.has(taskKind) || !decisionId) {
    return {
      status: "agent_org_performance_not_applicable",
      externalMutation: false,
    };
  }
  const performanceOutcome = outcome.status === "accepted" ? "success" : "failure";
  try {
    const result = await options.recordAgentOrganizationPerformance({
      teammateId,
      taskKind,
      outcome: performanceOutcome,
      keywords: extractAgentOrganizationPerformanceKeywords(
        `${artifact.title ?? ""} ${artifact.requestText ?? ""}`,
      ),
      sourceThreadId: `delegation-decision:${decisionId}`,
      recordedAt: outcome.finishedAt,
    });
return result &&
      typeof result === "object" &&
      ["agent_org_performance_recorded", "agent_org_performance_already_recorded"].includes(
        result.status,
      )
      ? { ...result, externalMutation: false }
      : { status: "agent_org_performance_record_write_failed", externalMutation: false };
  } catch {
    return {
      status: "agent_org_performance_record_write_failed",
      externalMutation: false,
    };
  }
}

function extractAgentOrganizationPerformanceKeywords(value) {
  const ignored = new Set([
    "그리고", "자료", "업무", "확인", "정리", "요청", "사용자", "최종", "승인",
  ]);
  return [...new Set(
    String(value ?? "")
      .toLocaleLowerCase("ko-KR")
      .match(/[a-z0-9가-힣_-]{2,}/gu) ?? [],
  )]
    .filter((keyword) => !ignored.has(keyword))
    .slice(0, 12);
}
function createDelegationDecisionLearningNotApplicable(artifact, decision) {
  return {
    status:
      decision === "held"
        ? "workspace_intelligence_outcome_held"
        : hasWorkspaceAgentOutcomeReference(artifact) &&
            !sanitizeTrustedWorkspaceAgentOutcomeBinding(
              artifact.trustedWorkspaceAgentOutcome,
            )
          ? "workspace_intelligence_outcome_untrusted"
          : "workspace_intelligence_outcome_not_applicable",
    newAgentRunIds: [],
    externalMutation: false,
  };
}

function persistDelegationArtifactDecisionProjections(root, artifact, decisionRecord) {
  const artifactLedgerPath = path.join(root, delegationArtifactLedgerRelativePath);
  const decisionLedgerPath = path.join(root, delegationApprovalDecisionLedgerRelativePath);
  const globalDecisionLedgerPath = path.join(root, decisionLedgerRelativePath);
  const actionQueuePath = path.join(root, delegationActionQueueLedgerRelativePath);
  const queuedAction = createDelegationActionQueueRecord(decisionRecord, artifact);
  const updatedArtifact = sanitizeDelegationArtifactRecord({
    ...artifact,
    approvalDecision: decisionRecord.decision,
    approvalStatus: delegationApprovalDecisionStatus(decisionRecord.decision),
    decidedAt: decisionRecord.decidedAt,
    decidedBy: decisionRecord.decidedBy,
    decisionNote: decisionRecord.note,
    nextActionKind: queuedAction.actionKind,
    nextActionStatus: queuedAction.status,
    nextActionLabel: queuedAction.label,
    nextActionQueuePath: delegationActionQueueLedgerRelativePath.replaceAll("\\", "/"),
  });
  const updatedArtifacts = sanitizeDelegationArtifactRecords(
    readJsonArray(artifactLedgerPath),
  )
    .map((item) => (item.id === artifact.id ? updatedArtifact : item))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 200);
  const existingDecisions = sanitizeDelegationApprovalDecisionRecords(
    readJsonArray(decisionLedgerPath),
  );
  const decisionsById = new Map();
  for (const item of [decisionRecord, ...existingDecisions]) {
    if (!decisionsById.has(item.id)) decisionsById.set(item.id, item);
  }
  const decisionRecords = [...decisionsById.values()]
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime())
    .slice(0, 300);
  const existingQueue = sanitizeDelegationActionQueueRecords(readJsonArray(actionQueuePath));
  const queueById = new Map();
  for (const item of [queuedAction, ...existingQueue]) {
    if (!queueById.has(item.id)) queueById.set(item.id, item);
  }
  const queueRecords = [...queueById.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 300);
  const existingDecisionMemory = sanitizeDecisionRecords(readJsonArray(globalDecisionLedgerPath));
  const decisionMemoryById = new Map();
  const delegationDecisionMemoryRecords =
    createDecisionRecordsFromDelegationApprovalDecisions(decisionRecords);
  for (const item of [...delegationDecisionMemoryRecords, ...existingDecisionMemory]) {
    if (!decisionMemoryById.has(item.id)) decisionMemoryById.set(item.id, item);
  }
  const decisionMemoryRecords = [...decisionMemoryById.values()]
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime())
    .slice(0, 300);

  atomicWriteJson(artifactLedgerPath, updatedArtifacts);
  atomicWriteJson(decisionLedgerPath, decisionRecords);
  atomicWriteJson(globalDecisionLedgerPath, decisionMemoryRecords);
  atomicWriteJson(actionQueuePath, queueRecords);
  if (updatedArtifact?.folderPath) {
    const metadataPath = path.join(root, updatedArtifact.folderPath, "metadata.json");
    atomicWriteJson(metadataPath, {
      ...updatedArtifact,
      schema: "modycrew.delegation-artifact.v1",
      latestApprovalDecision: decisionRecord,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
  }
  writeFileSync(
    path.join(root, "memory", "delegations", "DelegationArtifacts.md"),
    createDelegationArtifactsSummary(updatedArtifacts),
    "utf8",
  );
  writeFileSync(
    path.join(root, "memory", "delegations", "ApprovalDecisions.md"),
    createDelegationApprovalDecisionsSummary(decisionRecords),
    "utf8",
  );
  writeFileSync(
    path.join(root, "memory", "decisions", "DecisionMemory.md"),
    createDecisionMemorySummary(decisionMemoryRecords),
    "utf8",
  );
  writeTeammateDecisionLogs(root, decisionMemoryRecords);
  writeFileSync(
    path.join(root, "memory", "delegations", "DelegationActionQueue.md"),
    createDelegationActionQueueSummary(queueRecords),
    "utf8",
  );
  const profile = sanitizeAppProfile(readJsonObject(path.join(root, appProfileRelativePath)));
  if (profile) {
    const crewKitRecords = readJsonArray(path.join(root, "memory", "crew-kits", "crew-kits.json"));
    writePortableMemoryBundle(
      root,
      profile,
      crewKitRecords.length ? crewKitRecords : createCrewKitRecords(profile),
    );
  }
  refreshPromptMemory(root);
  return {
    artifactLedgerPath,
    decisionLedgerPath,
    globalDecisionLedgerPath,
    actionQueuePath,
    artifact: updatedArtifact,
    queuedAction,
    decisionRecords,
    decisionMemoryRecords,
    queueRecords,
  };
}

function readDelegationArtifactDecisionProjectionSnapshot(root, artifactId, decisionId) {
  const artifactLedgerPath = path.join(root, delegationArtifactLedgerRelativePath);
  const decisionLedgerPath = path.join(root, delegationApprovalDecisionLedgerRelativePath);
  const globalDecisionLedgerPath = path.join(root, decisionLedgerRelativePath);
  const actionQueuePath = path.join(root, delegationActionQueueLedgerRelativePath);
  const artifacts = sanitizeDelegationArtifactRecords(readJsonArray(artifactLedgerPath));
  const decisionRecords = sanitizeDelegationApprovalDecisionRecords(
    readJsonArray(decisionLedgerPath),
  );
  const decisionMemoryRecords = sanitizeDecisionRecords(readJsonArray(globalDecisionLedgerPath));
  const queueRecords = sanitizeDelegationActionQueueRecords(readJsonArray(actionQueuePath));
  return {
    artifactLedgerPath,
    decisionLedgerPath,
    globalDecisionLedgerPath,
    actionQueuePath,
    artifact: artifacts.find((item) => item.id === artifactId),
    queuedAction: queueRecords.find((item) => item.decisionId === decisionId),
    decisionRecords,
    decisionMemoryRecords,
    queueRecords,
  };
}

function createDelegationDecisionId(artifactId, decision) {
  return createHash("sha256")
    .update(`${artifactId}\0${decision}`, "utf8")
    .digest("hex");
}

function createDelegationActionQueueId(artifactId, decision, actionKind) {
  return createHash("sha256")
    .update(`${artifactId}\0${decision}\0${actionKind}`, "utf8")
    .digest("hex");
}

function createDelegationDecisionSagaRecord(input = {}) {
  const artifact = input.artifact && typeof input.artifact === "object" ? input.artifact : {};
  const decision = sanitizeDelegationApprovalDecision(input.decision);
  const artifactId = sanitizeLine(artifact.id, 180);
  const decisionId = createDelegationDecisionId(artifactId, decision);
  const decidedAt = sanitizeIsoDate(input.decidedAt || new Date().toISOString());
  const trustedWorkspaceAgentOutcome = sanitizeTrustedWorkspaceAgentOutcomeBinding(
    artifact.trustedWorkspaceAgentOutcome,
  );
  return {
    decisionId,
    artifactId,
    decision,
    phase: "pending",
    decidedAt,
    decidedBy: sanitizeLine(input.decidedBy || "app", 80) || "app",
    note: sanitizeLine(input.note, 600),
    correctionSignals: Array.isArray(input.correctionSignals)
      ? [...new Set(
          input.correctionSignals
            .map((value) => String(value ?? "").trim())
            .filter((value) => workspaceIntelligenceCorrectionSignals.has(value)),
        )]
      : [],
    approvalTicketId: "",
    trustedOutcomeFinalized: false,
    ...(trustedWorkspaceAgentOutcome ? { trustedWorkspaceAgentOutcome } : {}),
    createdAt: decidedAt,
    updatedAt: decidedAt,
  };
}

function createDelegationApprovalDecisionRecordFromSaga(sagaRecord, artifact) {
  return sanitizeDelegationApprovalDecisionRecord({
    id: sagaRecord.decisionId,
    artifactId: artifact.id,
    artifactKind: artifact.artifactKind,
    artifactTitle: artifact.title,
    decision: sagaRecord.decision,
    decidedAt: sagaRecord.decidedAt,
    decidedBy: sagaRecord.decidedBy,
    note: sagaRecord.note,
    relativePath: artifact.relativePath,
    teammateName: artifact.teammateName,
    sourceTeammateId: artifact.sourceTeammateId,
    sourceThreadId: artifact.sourceThreadId,
  });
}

function readDelegationDecisionSaga(sagaPath) {
  if (!existsSync(sagaPath)) {
    return {
      corrupt: false,
      state: {
        schema: delegationDecisionSagaSchema,
        version: 1,
        updatedAt: "",
        records: [],
      },
    };
  }
  try {
    const stat = statSync(sagaPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 2 * 1024 * 1024) {
      return { corrupt: true };
    }
    const value = JSON.parse(readFileSync(sagaPath, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.schema !== delegationDecisionSagaSchema ||
      value.version !== 1 ||
      !isDelegationDecisionSagaIsoDate(value.updatedAt) ||
      !Array.isArray(value.records) ||
      value.records.length > 300
    ) {
      return { corrupt: true };
    }
    const records = [];
    const ids = new Set();
    const terminalByArtifact = new Set();
    for (const valueRecord of value.records) {
      const record = sanitizeDelegationDecisionSagaRecord(valueRecord);
      if (!record || ids.has(record.decisionId)) return { corrupt: true };
      if (terminalDelegationApprovalDecisions.has(record.decision)) {
        if (terminalByArtifact.has(record.artifactId)) return { corrupt: true };
        terminalByArtifact.add(record.artifactId);
      }
      ids.add(record.decisionId);
      records.push(record);
    }
    return {
      corrupt: false,
      state: {
        schema: delegationDecisionSagaSchema,
        version: 1,
        updatedAt: value.updatedAt,
        records,
      },
    };
  } catch {
    return { corrupt: true };
  }
}

function sanitizeDelegationDecisionSagaRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const artifactId = sanitizeLine(value.artifactId, 180);
  const decision = sanitizeDelegationApprovalDecision(value.decision, "");
  const decisionId = String(value.decisionId ?? "").toLowerCase();
  const phase = String(value.phase ?? "");
  if (
    !artifactId ||
    !["approved", "change_requested", "rejected", "held"].includes(decision) ||
    decisionId !== createDelegationDecisionId(artifactId, decision) ||
    !delegationDecisionSagaPhases.has(phase) ||
    !isDelegationDecisionSagaIsoDate(value.decidedAt) ||
    !isDelegationDecisionSagaIsoDate(value.createdAt) ||
    !isDelegationDecisionSagaIsoDate(value.updatedAt)
  ) {
    return null;
  }
  const approvalTicketId = String(value.approvalTicketId ?? "");
  if (approvalTicketId && !safeWorkspaceIntelligenceOpaqueId(approvalTicketId)) {
    return null;
  }
  const hasTrustedOutcome = Object.hasOwn(value, "trustedWorkspaceAgentOutcome");
  const trustedWorkspaceAgentOutcome = sanitizeTrustedWorkspaceAgentOutcomeBinding(
    value.trustedWorkspaceAgentOutcome,
  );
  if (hasTrustedOutcome && !trustedWorkspaceAgentOutcome) return null;
  const requiresTrustedFinalization =
    terminalDelegationApprovalDecisions.has(decision) &&
    trustedWorkspaceAgentOutcome?.runStatus !== "error" &&
    Boolean(trustedWorkspaceAgentOutcome);
  const terminalOrLater = [
    "finalized",
    "local_projected",
    "learning_applied",
    "committed",
  ].includes(phase);
  if (
    (phase === "approval_prepared" || requiresTrustedFinalization && phase !== "pending") &&
    !approvalTicketId
  ) {
    return null;
  }
  if (
    (phase === "approval_prepared" && value.trustedOutcomeFinalized === true) ||
    (requiresTrustedFinalization && terminalOrLater && value.trustedOutcomeFinalized !== true) ||
    (!requiresTrustedFinalization && value.trustedOutcomeFinalized === true)
  ) {
    return null;
  }
  return {
    decisionId,
    artifactId,
    decision,
    phase,
    decidedAt: value.decidedAt,
    decidedBy: sanitizeLine(value.decidedBy, 80) || "app",
    note: sanitizeLine(value.note, 600),
    correctionSignals: Array.isArray(value.correctionSignals)
      ? [...new Set(
          value.correctionSignals
            .map((item) => String(item ?? "").trim())
            .filter((item) => workspaceIntelligenceCorrectionSignals.has(item)),
        )]
      : [],
    approvalTicketId,
    trustedOutcomeFinalized: value.trustedOutcomeFinalized === true,
    ...(trustedWorkspaceAgentOutcome ? { trustedWorkspaceAgentOutcome } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isDelegationDecisionSagaIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function writeDelegationDecisionSaga(sagaPath, state) {
  atomicWriteJson(sagaPath, {
    schema: delegationDecisionSagaSchema,
    version: 1,
    updatedAt: state.updatedAt || new Date().toISOString(),
    records: state.records,
  });
}

function advanceDelegationDecisionSagaRecord(
  sagaPath,
  state,
  record,
  phase,
  patch = {},
) {
  const updatedAt = new Date().toISOString();
  const next = {
    ...record,
    ...patch,
    phase,
    updatedAt,
  };
  state.records = state.records.map((item) =>
    item.decisionId === record.decisionId ? next : item,
  );
  state.updatedAt = updatedAt;
  writeDelegationDecisionSaga(sagaPath, state);
  return next;
}
function recordHomeApprovalDecisionReceipt(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const receiptLedgerPath = path.join(root, homeApprovalDecisionReceiptLedgerRelativePath);
  const receiptSummaryPath = path.join(root, homeApprovalDecisionReceiptSummaryRelativePath);
  const globalDecisionLedgerPath = path.join(root, decisionLedgerRelativePath);
  const receipt = sanitizeHomeApprovalDecisionReceipt(payload.receipt, {
    teammateId: payload.teammateId,
    teammateName: payload.teammateName,
    sourceThreadId: payload.sourceThreadId,
  });
  if (!receipt) {
    return {
      status: "local_memory_home_approval_decision_receipt_invalid",
      root,
      defaultRoot: getDefaultLocalMemoryRoot(options),
      receipts: [],
      receiptCount: 0,
      userMessage: "저장할 승인 결정 기록이 비어 있거나 올바르지 않습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const existingReceipts = sanitizeHomeApprovalDecisionReceipts(readJsonArray(receiptLedgerPath));
  const receiptsById = new Map();
  for (const item of [receipt, ...existingReceipts]) {
    if (!receiptsById.has(item.id)) receiptsById.set(item.id, item);
  }
  const receipts = [...receiptsById.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80);

  const existingDecisionMemory = sanitizeDecisionRecords(readJsonArray(globalDecisionLedgerPath));
  const homeDecisionMemoryRecords = createDecisionRecordsFromHomeApprovalDecisionReceipts(receipts);
  const decisionMemoryById = new Map();
  for (const item of [...homeDecisionMemoryRecords, ...existingDecisionMemory]) {
    if (!decisionMemoryById.has(item.id)) decisionMemoryById.set(item.id, item);
  }
  const decisionMemoryRecords = [...decisionMemoryById.values()]
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime())
    .slice(0, 300);

  atomicWriteJson(receiptLedgerPath, receipts);
  atomicWriteJson(globalDecisionLedgerPath, decisionMemoryRecords);
  writeFileSync(receiptSummaryPath, createHomeApprovalDecisionReceiptsSummary(receipts), "utf8");
  writeFileSync(
    path.join(root, "memory", "decisions", "DecisionMemory.md"),
    createDecisionMemorySummary(decisionMemoryRecords),
    "utf8",
  );
  writeTeammateDecisionLogs(root, decisionMemoryRecords);
  refreshPromptMemory(root);

  return {
    status: "local_memory_home_approval_decision_receipt_recorded",
    root,
    defaultRoot: getDefaultLocalMemoryRoot(options),
    receipts,
    receiptCount: receipts.length,
    receiptLedgerPath,
    receiptSummaryPath,
    globalDecisionLedgerPath,
    decisionMemoryCount: decisionMemoryRecords.length,
    userMessage: "최근 승인 결정 기록을 로컬 기억과 DecisionLog에 저장했습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function listHomeApprovalDecisionReceipts(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const receiptLedgerPath = path.join(root, homeApprovalDecisionReceiptLedgerRelativePath);
  const receipts = sanitizeHomeApprovalDecisionReceipts(readJsonArray(receiptLedgerPath));
  return {
    status: "local_memory_home_approval_decision_receipts_loaded",
    root,
    defaultRoot: getDefaultLocalMemoryRoot(options),
    receipts,
    receiptCount: receipts.length,
    receiptLedgerPath,
    receiptSummaryPath: path.join(root, homeApprovalDecisionReceiptSummaryRelativePath),
    userMessage: receipts.length
      ? "로컬 기억에서 최근 승인 결정 기록을 불러왔습니다."
      : "아직 로컬 기억에 저장된 승인 결정 기록이 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function loadVerifiedActiveSkillPromptSection(options = {}, teammateId = "") {
  if (!teammateId || typeof options.loadActiveSkillPromptContext !== "function") {
    return null;
  }
  const root = ensureLocalMemoryRoot(options);
  const profile = sanitizeAppProfile(
    readJsonObject(path.join(root, appProfileRelativePath)),
  );
  if (profile?.teammates.filter((teammate) => teammate.id === teammateId).length !== 1) {
    return null;
  }
  let loaded;
  try {
    loaded = await options.loadActiveSkillPromptContext({
      workspaceId: "local_desktop",
      targetAgentId: teammateId,
    });
  } catch {
    return null;
  }
  if (
    loaded?.verified !== true ||
    loaded?.active !== true ||
    loaded?.targetAgentId !== teammateId ||
    !Array.isArray(loaded.instructions)
  ) {
    return null;
  }
  const instructions = loaded.instructions
    .flatMap((candidate) =>
      Array.isArray(candidate?.instructions) ? candidate.instructions : [],
    )
    .map((instruction) => sanitizeLine(instruction, 420))
    .filter(Boolean)
    .slice(0, 24);
  if (!instructions.length) return null;
  return {
    label: "Verified active workspace skill instructions",
    text: truncateText(instructions.map((instruction) => `- ${instruction}`).join("\n"), 1_800),
  };
}
async function loadPromptContext(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  // 대화 턴마다 불린다. 예전에는 매번 원장 전체를 다시 읽고 다시 써서 턴마다 앱이
  // 약 0.1초 멈췄다. 밀린 재생성이 있거나 재료 파일이 더 새로울 때만 다시 만든다.
  if (!flushPendingPromptMemoryRefresh(root) && promptMemoryIsStale(root)) refreshPromptMemory(root);
  const teammateId = sanitizePathSegment(payload.teammateId || "");
  const maxChars = clampNumber(payload.maxChars, 2_000, 18_000, 9_000);
  const teammateFolder = teammateId ? path.join(root, "memory", "crew-souls", teammateId) : "";
  const verifiedActiveSkillSection =
    await loadVerifiedActiveSkillPromptSection(options, teammateId);
  // 사용자가 가르친 것은 오래된 작업 기록보다 앞선다. 아래 목록은 maxChars 로
  // 통째로 잘리므로, 뒤에 두면 배운 것이 먼저 잘려 나간다.
  const learningLessonsSection = await loadLearningLessonsSection(root, teammateId, options);
  const sections = [
    learningLessonsSection,
    readMemorySection("PromptMemory", path.join(root, "memory", "prompt", "PromptMemory.md"), 2_600),
    teammateFolder
      ? readMemorySection("Role PromptMemory", path.join(teammateFolder, "PromptMemory.md"), 1_800)
      : null,
    teammateFolder
      ? readMemorySection("Role CrewSoul", path.join(teammateFolder, "CrewSoul.md"), 2_400)
      : null,
    teammateFolder
      ? readMemorySection("Role DecisionLog", path.join(teammateFolder, "DecisionLog.md"), 2_000)
      : null,
    teammateFolder
      ? readMemorySection("Role WorkLog", path.join(teammateFolder, "WorkLog.md"), 2_000)
      : null,
    verifiedActiveSkillSection,
    readMemorySection("CrewSoul", path.join(root, "memory", "CrewSoul.md"), 2_200),
    readMemorySection("CrewSoulBundle", path.join(root, crewSoulBundleSummaryRelativePath), 1_800),
    readMemorySection("SkillBootstrapPlan", path.join(root, "memory", "growth", "SkillBootstrapPlan.md"), 1_400),
    readMemorySection("CrewChannelIndex", path.join(root, "memory", "crew-souls", "CrewChannelIndex.md"), 1_800),
    readMemorySection("CrewChannelBlueprint", path.join(root, crewChannelBlueprintSummaryRelativePath), 1_800),
    readMemorySection("CrewKitIndex", path.join(root, "memory", "crew-kits", "CrewKitIndex.md"), 2_200),
    readMemorySection("SkillGrowth", path.join(root, "memory", "growth", "SkillGrowth.md"), 1_800),
    readMemorySection("SkillBridge", path.join(root, "memory", "growth", "SkillBridge.md"), 1_600),
    readMemorySection("SelfGrowthContract", path.join(root, "memory", "growth", "SelfGrowthContract.md"), 1_800),
    readMemorySection("DecisionMemory", path.join(root, "memory", "decisions", "DecisionMemory.md"), 2_400),
    readMemorySection("ApprovalDecisions", path.join(root, "memory", "delegations", "ApprovalDecisions.md"), 1_600),
    readMemorySection("DelegationActionQueue", path.join(root, "memory", "delegations", "DelegationActionQueue.md"), 1_800),
    readMemorySection("WorkPatternMemory", path.join(root, "memory", "work-patterns", "WorkPatternMemory.md"), 2_600),
    readMemorySection("DelegationArtifacts", path.join(root, "memory", "delegations", "DelegationArtifacts.md"), 2_000),
    readMemorySection("MailOpsPromptMemory", path.join(root, "memory", "prompt", "crewkit", "MailOpsPromptMemory.md"), 1_600),
    readMemorySection("WriterPromptMemory", path.join(root, "memory", "prompt", "crewkit", "WriterPromptMemory.md"), 1_600),
    readMemorySection("TidyPromptMemory", path.join(root, "memory", "prompt", "crewkit", "TidyPromptMemory.md"), 1_600),
    readMemorySection("DesktopControlPromptMemory", path.join(root, "memory", "prompt", "crewkit", "DesktopControlPromptMemory.md"), 1_600),
    readMemorySection("CrewContext", path.join(root, "memory", "chat", "CrewContext.md"), 2_400),
    readMemorySection("ConversationDigest", path.join(root, "memory", "chat", "ConversationDigest.md"), 2_400),
    readMemorySection("GrowthMemory", path.join(root, "memory", "growth", "GrowthMemory.md"), 1_800),
    readMemorySection("LongMemoryIndex", path.join(root, "memory", "prompt", "LongMemoryIndex.md"), 1_600),
  ].filter(Boolean);
  const context = truncateText(
    [
      "[ModyCrew 로컬 기억]",
      "이 컨텍스트는 사용자가 선택한 로컬 기억 폴더에서 읽은 요약입니다. secret 원문은 포함하지 않습니다.",
      "Critical restore files: CrewSoul, CrewSoulBundle, CrewChannelIndex, CrewChannelBlueprint, DecisionMemory, WorkPatternMemory, CrewKitIndex, SkillGrowth, SkillBridge, SkillBootstrapPlan, ConversationDigest, DelegationArtifacts.",
      ...sections.map((section) => `## ${section.label}\n${section.text}`),
    ].join("\n\n"),
    maxChars,
  );
  return {
    status: "local_memory_prompt_context_loaded",
    root,
    teammateId,
    sectionCount: sections.length,
    context,
    contextChars: context.length,
    userMessage: sections.length
      ? "AI 팀원 업무 방식, 결정 기록, 업무 도구 목록을 답변 컨텍스트로 불러왔습니다."
      : "아직 답변에 붙일 로컬 기억 요약이 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function inspectPortableMemory(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const appProfilePath = path.join(root, appProfileRelativePath);
  const chatThreadsPath = path.join(root, chatThreadsRelativePath);
  const portableManifestPath = path.join(root, portableManifestFileName);
  const crewSoulBundlePath = path.join(root, crewSoulBundleRelativePath);
  const crewSoulBundleSummaryPath = path.join(root, crewSoulBundleSummaryRelativePath);
  // 오피스 창이 주기적으로 부르는 요청이라, 원장은 캐시를 거쳐 읽는다(status 와 같은 캐시).
  const profile = readCachedAppProfile(root);
  const threads = readCachedThreads(root);
  const conversationDigest = readCachedConversationDigest(root);
  const decisionRecords = readCachedDecisionRecords(root);
  const workPatternRecords = readCachedWorkPatternRecords(root);
  const connectorRecoveryMemories = readCachedConnectorRecoveryMemories(root);
  const delegationArtifactRecords = readCachedDelegationArtifactRecords(root);
  const delegationApprovalDecisionRecords = readCachedDelegationApprovalDecisionRecords(root);
  const delegationActionQueueRecords = readCachedDelegationActionQueueRecords(root);
  const portableManifest = readLocalMemoryCached(portableManifestPath, "portable-manifest", () =>
    sanitizePortableManifest(readJsonObject(portableManifestPath)));
  const crewKitRecords = readCachedJsonArray(path.join(root, "memory", "crew-kits", "crew-kits.json"));
  const activeCrewKitCount = crewKitRecords.filter((record) => record?.status === "active").length;
  const growthSuggestions = readCachedGrowthSuggestions(root);
  const skillSources = readCachedSkillSourceRecords(root);
  const skillBootstrapPlan = readCachedSkillBootstrapPlan(root);
  const skillBootstrapPlanReady =
    Boolean(skillBootstrapPlan) &&
    existsSync(path.join(root, skillBootstrapPlanRelativePath)) &&
    existsSync(path.join(root, skillBootstrapPlanSummaryRelativePath));
  const verifiedWorkspaceSkillLifecycle =
    await readWorkspaceSkillLifecycle(root);
  const workspaceSkillLifecycle =
    createVerifiedWorkspaceSkillLifecycleDisplaySnapshot(
      root,
      verifiedWorkspaceSkillLifecycle,
    );
  const crewSoulBundleReady = existsSync(crewSoulBundlePath) && existsSync(crewSoulBundleSummaryPath);
  const identityFiles = createIdentityFileRecords(root, profile);
  const readyIdentityFileCount = identityFiles.filter((file) => file.state === "ready").length;
  const restoreChecklist = [
    {
      id: "manifest",
      label: "포터블 매니페스트",
      state: portableManifest?.portableMemory ? "ready" : "missing",
      detail: portableManifest?.portableMemory
        ? "새 PC에서 이 폴더를 선택하면 복원 기준을 확인할 수 있습니다."
        : "앱 프로필을 한 번 저장하면 생성됩니다.",
    },
    {
      id: "profile",
      label: "앱 프로필",
      state: profile ? "ready" : "missing",
      detail: profile
        ? `AI 팀원 ${profile.teammates.length}명, 사용 중 도구 ${profile.activeSkillIds.length}개`
        : "팀원과 기능 설정이 아직 저장되지 않았습니다.",
    },
    {
      id: "identity_files",
      label: "AI 팀원 업무 방식 파일",
      state: identityFiles.length && readyIdentityFileCount === identityFiles.length ? "ready" : "missing",
      detail: identityFiles.length
        ? `준비 ${readyIdentityFileCount}/${identityFiles.length}개 · 팀원 업무 방식, 답변 기억, 기능 목록, 개선 기록`
        : "앱 프로필을 저장하면 AI 팀원 업무 방식 파일 묶음이 생성됩니다.",
    },
    {
      id: "crew_soul_bundle",
      label: "새 PC 복원 묶음",
      state: crewSoulBundleReady ? "ready" : "missing",
      detail: crewSoulBundleReady
        ? "새 PC에서 앱이 팀원, 역할, 사용 중 도구, 외부 재승인 순서를 한 번에 읽을 수 있습니다."
        : "앱 프로필을 저장하면 복원 묶음이 생성됩니다.",
    },
    {
      id: "chat",
      label: "대화 기억",
      state: threads.length ? "ready" : "optional",
      detail: threads.length
        ? `대화 ${threads.length}개, 메시지 ${countMessages(threads)}개, 압축 요약 ${conversationDigest.length}개`
        : "대화가 시작되면 자동 저장되고 짧은 요약으로 압축됩니다.",
    },
    {
      id: "decisions",
      label: "업무 결정 기억",
      state: decisionRecords.length ? "ready" : "optional",
      detail: decisionRecords.length
        ? `메신저/앱 결정 ${decisionRecords.length}건이 업무 결정 기억에 저장되었습니다.`
        : "승인, 수정, 보류, 거절 결정이 들어오면 자동 생성됩니다.",
    },
    {
      id: "work_patterns",
      label: "업무 패턴 기억",
      state: workPatternRecords.length ? "ready" : "optional",
      detail: workPatternRecords.length
        ? `메일/문서/폴더 학습 ${workPatternRecords.length}건이 지난 업무 기억에 저장되었습니다.`
        : "메일 분석, 자료 학습, 폴더 정리 결과가 생기면 자동 생성됩니다.",
    },
    {
      id: "delegation_artifacts",
      label: "AI 팀원 결과",
      state: delegationArtifactRecords.length ? "ready" : "optional",
      detail: delegationArtifactRecords.length
        ? `보고서/메일/승인 후보 결과 ${delegationArtifactRecords.length}건이 AI 팀원 결과에 저장되었습니다.`
        : "역할별 AI 팀원 결과를 취합하면 보고서, 메일, 승인 후보 결과가 생성됩니다.",
    },
    {
      id: "approval_decisions",
      label: "승인 처리 장부",
      state: delegationApprovalDecisionRecords.length ? "ready" : "optional",
      detail: delegationApprovalDecisionRecords.length
        ? `앱 안에서 처리한 승인/수정/보류 결정 ${delegationApprovalDecisionRecords.length}건이 승인 처리 기록에 저장되었습니다.`
        : "승인 요청 카드에서 승인, 수정 요청, 보류를 누르면 자동 생성됩니다.",
    },
    {
      id: "delegation_action_queue",
      label: "승인 이후 처리 큐",
      state: delegationActionQueueRecords.length ? "ready" : "optional",
      detail: delegationActionQueueRecords.length
        ? `실행 후보/수정 큐/보류 ${delegationActionQueueRecords.length}건이 승인 이후 처리 목록에 저장되었습니다.`
        : "승인 결과가 생기면 실행 후보와 수정 큐가 자동 분리됩니다.",
    },
    {
      id: "prompt",
      label: "답변용 짧은 기억",
      state: existsSync(path.join(root, "memory", "prompt", "PromptMemory.md")) ? "ready" : "optional",
      detail: existsSync(path.join(root, "memory", "prompt", "PromptMemory.md"))
        ? "AI 답변 직전에 읽는 짧은 기억이 준비되었습니다."
        : "대화, 앱 프로필, 결정 기록이 저장되면 자동 생성됩니다.",
    },
    {
      id: "crewkit",
      label: "업무 도구 목록",
      state: crewKitRecords.length ? "ready" : "missing",
      detail: crewKitRecords.length ? `업무 도구 ${crewKitRecords.length}개, 사용 중 ${activeCrewKitCount}개` : "도구 프로필 저장 뒤 생성됩니다.",
    },
    {
      id: "workspace_skill_lifecycle",
      label: "검증된 업무 도구 설치 장부",
      state: workspaceSkillLifecycle.ready
        ? "ready"
        : workspaceSkillLifecycle.recoveryRequired
          ? "missing"
          : "optional",
      detail: workspaceSkillLifecycle.ready
        ? "설치 제안 " +
          workspaceSkillLifecycle.proposalCount +
          "개 · 설치 후 대기 " +
          workspaceSkillLifecycle.installedInactiveCount +
          "개 · 사용 중 " +
          workspaceSkillLifecycle.activeCount +
          "개"
        : workspaceSkillLifecycle.recoveryRequired
          ? "장부 손상 가능성이 있어 설치와 활성화를 중지했습니다."
          : "검증된 외부 업무 도구 제안이 생기면 1회 승인과 활성화 기록을 저장합니다.",
    },
    {
      id: "skill_growth",
      label: "업무 도구 추천",
      state: growthSuggestions.length ? "ready" : "optional",
      detail: growthSuggestions.length
        ? `반복 업무에서 업무 도구 개선 후보 ${growthSuggestions.length}개를 만들었습니다.`
        : "메일, 자료, 폴더 작업이 쌓이면 필요한 업무 도구와 팀원 역할을 제안합니다.",
    },
    {
      id: "skill_sources",
      label: "기능 후보 보관함",
      state: skillSources.length ? "ready" : "optional",
      detail: skillSources.length
        ? `앱 내부 기능과 외부 기능 후보 ${skillSources.length}개를 복원 가능한 목록으로 저장했습니다.`
        : "업무 도구와 외부 연결 후보가 생기면 도구 후보 보관함에 저장됩니다.",
    },
    {
      id: "skill_bootstrap",
      label: "기능 자동 복원 계획",
      state: skillBootstrapPlanReady ? "ready" : "optional",
      detail: skillBootstrapPlanReady
        ? "새 PC에서 사용 중 도구, 담당 AI 팀원, 외부 연결 재승인 순서를 읽을 수 있습니다."
        : "앱 프로필을 저장하면 기능 복원 계획이 생성됩니다.",
    },
  ];
  return {
    status: "local_memory_portable_inspected",
    root,
    appProfilePath,
    chatThreadsPath,
    portableManifestPath,
    crewSoulBundlePath,
    crewSoulBundleSummaryPath,
    portableManifest,
    crewSoulBundleReady,
    restoreReady: Boolean(portableManifest?.portableMemory && profile),
    teammateCount: profile?.teammates.length ?? 0,
    activeSkillCount: profile?.activeSkillIds.length ?? 0,
    crewKitCount: crewKitRecords.length,
    activeCrewKitCount,
    threadCount: threads.length,
    messageCount: countMessages(threads),
    conversationDigestCount: conversationDigest.length,
    decisionCount: decisionRecords.length,
    workPatternCount: workPatternRecords.length,
    delegationArtifactCount: delegationArtifactRecords.length,
    delegationApprovalDecisionCount: delegationApprovalDecisionRecords.length,
    delegationActionQueueCount: delegationActionQueueRecords.length,
    delegationArtifacts: delegationArtifactRecords.slice(),
    growthSuggestionCount: growthSuggestions.length,
    growthSuggestions: growthSuggestions.slice(),
    connectorRecoveryMemoryCount: connectorRecoveryMemories.length,
    connectorRecoveryMemories: connectorRecoveryMemories.slice(),
    skillSourceCount: skillSources.length,
    skillSources: skillSources.slice(),
    skillBootstrapPlanReady,
    workspaceSkillLifecyclePath: workspaceSkillLifecycle.statePath,
    workspaceSkillLifecycleSummaryPath:
      workspaceSkillLifecycle.summaryPath,
    workspaceSkillLifecycleReady: workspaceSkillLifecycle.ready,
    workspaceSkillLifecycleRecoveryRequired:
      workspaceSkillLifecycle.recoveryRequired,
    workspaceSkillProposalCount:
      workspaceSkillLifecycle.proposalCount,
    workspaceSkillPendingInstallApprovalCount:
      workspaceSkillLifecycle.pendingInstallApprovalCount,
    workspaceSkillInstalledInactiveCount:
      workspaceSkillLifecycle.installedInactiveCount,
    workspaceSkillActiveCount:
      workspaceSkillLifecycle.activeCount,
    workspaceSkillBlockedCount:
      workspaceSkillLifecycle.blockedCount,
    skillBootstrapActiveCrewKitCount: skillBootstrapPlan?.activeCrewKits?.length ?? 0,
    externalReauthorizationCount: skillBootstrapPlan?.externalReauthorization?.length ?? 0,
    skillBootstrapPlan,
    identityFileCount: readyIdentityFileCount,
    missingIdentityFileCount: identityFiles.length - readyIdentityFileCount,
    identityFiles,
    restoreChecklist,
    userMessage: portableManifest?.portableMemory
      ? "이 폴더는 새 PC에서 그대로 선택해 복원할 수 있는 ModyCrew 기억 폴더입니다."
      : "아직 포터블 기억 매니페스트가 없습니다. 앱 프로필을 저장하면 자동 생성됩니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function ensureLocalMemoryRoot(options = {}) {
  const root = getConfiguredLocalMemoryRoot(options);
  ensureMemoryFolders(root);
  return root;
}

// 기억 폴더 15개를 요청마다 mkdirSync 로 다시 만들던 것을 저장소마다 한 번만 한다.
// 사용자가 폴더를 지웠거나 옮긴 경우를 위해, 이미 만든 저장소도 1단 폴더 목록을 한 번
// 훑어 빠진 게 있으면 다시 만든다(mkdirSync 15번 대신 디렉터리 읽기 한 번).
const localMemoryFirstLevelFolderNames = [
  "chat", "app-profile", "crew-kits", "crew-souls", "decisions", "work-patterns", "delegations",
  "agents", "growth", "prompt", "user", "documents", "intelligence",
];
const ensuredLocalMemoryRoots = new Set();

function localMemoryFoldersStillPresent(root) {
  try {
    const present = new Set(readdirSync(path.join(root, "memory")));
    return (
      localMemoryFirstLevelFolderNames.every((name) => present.has(name)) &&
      existsSync(path.join(root, "memory", "prompt", "crewkit")) &&
      existsSync(path.join(root, "audit"))
    );
  } catch {
    return false;
  }
}

function ensureMemoryFolders(root, { force = false } = {}) {
  const rootKey = path.resolve(root);
  if (!force && ensuredLocalMemoryRoots.has(rootKey) && localMemoryFoldersStillPresent(rootKey)) return;
  ensuredLocalMemoryRoots.delete(rootKey);
  localMemoryReadCacheStats.folderEnsures += 1;
  mkdirSync(path.join(root, "memory", "chat"), { recursive: true });
  mkdirSync(path.join(root, "memory", "app-profile"), { recursive: true });
  mkdirSync(path.join(root, "memory", "crew-kits"), { recursive: true });
  mkdirSync(path.join(root, "memory", "crew-souls"), { recursive: true });
  mkdirSync(path.join(root, "memory", "decisions"), { recursive: true });
  mkdirSync(path.join(root, "memory", "work-patterns"), { recursive: true });
  mkdirSync(path.join(root, "memory", "delegations"), { recursive: true });
  mkdirSync(path.join(root, "memory", "agents"), { recursive: true });
  mkdirSync(path.join(root, "memory", "growth"), { recursive: true });
  mkdirSync(path.join(root, "memory", "prompt"), { recursive: true });
  mkdirSync(path.join(root, "memory", "prompt", "crewkit"), { recursive: true });
  mkdirSync(path.join(root, "memory", "user"), { recursive: true });
  mkdirSync(path.join(root, "memory", "documents"), { recursive: true });
  mkdirSync(path.join(root, "memory", "intelligence"), { recursive: true });
  mkdirSync(path.join(root, "audit"), { recursive: true });
  ensuredLocalMemoryRoots.add(rootKey);
}

function getConfiguredLocalMemoryRoot(options = {}) {
  const explicitRoot =
    typeof options.localMemoryRoot === "string" ? options.localMemoryRoot.trim() : "";
  if (explicitRoot) return path.resolve(explicitRoot);
  const config = readConfig(options);
  const configuredRoot = typeof config.root === "string" ? config.root.trim() : "";
  return configuredRoot ? path.resolve(configuredRoot) : getDefaultLocalMemoryRoot(options);
}

function getDefaultLocalMemoryRoot(options = {}) {
  const userData = typeof options.app?.getPath === "function" ? options.app.getPath("userData") : process.cwd();
  if (process.env.MODYCREW_SOURCE_EDITION === "1" || isSmokeUserDataPath(userData)) return path.join(userData, "ModyCrew_Local_Data");
  const dRoot = "D:\\";
  if (existsSync(dRoot)) return path.join(dRoot, "ModyCrew_Local_Data");
  const documents = typeof options.app?.getPath === "function" ? options.app.getPath("documents") : "";
  if (documents) return path.join(documents, "ModyCrew_Local_Data");
  return path.join(userData, "ModyCrew_Local_Data");
}

function isSmokeUserDataPath(userData) {
  const normalized = String(userData ?? "").replaceAll("\\", "/").toLowerCase();
  return (
    normalized.endsWith("/dist/smoke/user-data") ||
    normalized.includes("/dist/smoke/user-data/")
  );
}

function normalizeSelectedRoot(inputPath) {
  const resolved = path.resolve(String(inputPath ?? ""));
  const parsed = path.parse(resolved);
  if (resolved.toLowerCase() === parsed.root.toLowerCase()) {
    return path.join(resolved, "ModyCrew_Local_Data");
  }
  return resolved;
}

function readConfig(options = {}) {
  try {
    const filePath = getConfigPath(options);
    if (!existsSync(filePath)) return {};
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(options = {}, config = {}) {
  const filePath = getConfigPath(options);
  mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteJson(filePath, config);
}

function getConfigPath(options = {}) {
  const userData = typeof options.app?.getPath === "function" ? options.app.getPath("userData") : process.cwd();
  return path.join(userData, configFileName);
}

function readChatThreadsArray(filePath) {
  let stat;
  try { stat = statSync(filePath); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (!stat.isFile()) throw new Error("대화 저장 경로가 파일이 아닙니다.");
  if (stat.size > 20 * 1024 * 1024) throw new Error("대화 파일이 한 번에 읽을 수 있는 크기(20MB)를 넘었습니다.");
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("대화 목록 형식이 올바르지 않습니다.");
  return parsed;
}

function readJsonArray(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return [];
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readJsonObject(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// 읽기 전용 요청(status, inspect_portable_memory, load_prompt_context 의 재생성 등)이
// 매번 원장 10여 개를 다시 읽고 정규식 검사까지 다시 해서 한 번에 50~100ms 씩 앱이
// 멈췄다. 같은 파일(경로·수정 시각·크기·파일 번호가 모두 그대로)이면 검사까지 끝난
// 결과를 다시 쓴다. atomicWriteJson 은 임시 파일을 rename 하므로 쓸 때마다 파일 번호가
// 바뀌고, 쓰는 즉시 이 캐시도 비운다. 캐시한 값은 여러 요청이 함께 보므로 절대 고치지
// 않는다(고칠 곳은 readJsonArray/readJsonObject 로 새로 읽는다).
const localMemoryReadCache = new Map();
const localMemoryReadCacheFileLimit = 96;
const localMemoryReadCacheStats = { hits: 0, misses: 0, invalidations: 0, folderEnsures: 0 };

export function getLocalMemoryReadCacheStats() {
  return { ...localMemoryReadCacheStats, cachedFiles: localMemoryReadCache.size };
}

function localMemoryFileSignature(filePath) {
  try {
    const stat = statSync(filePath, { throwIfNoEntry: false });
    if (!stat) return "missing";
    return `${stat.isFile() ? "file" : "other"}:${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return "";
  }
}

function readLocalMemoryCached(filePath, variant, compute) {
  const key = path.resolve(filePath);
  // 먼저 stat 하고 나서 읽는다. 그 사이에 파일이 바뀌면 다음 요청에서 서명이 달라 다시 읽을 뿐,
  // 옛 내용을 새 서명으로 붙잡아 두는 일은 생기지 않는다.
  const signature = localMemoryFileSignature(key);
  if (!signature) return compute();
  let variants = localMemoryReadCache.get(key);
  const cached = variants?.get(variant);
  if (cached && cached.signature === signature) {
    localMemoryReadCacheStats.hits += 1;
    return cached.value;
  }
  localMemoryReadCacheStats.misses += 1;
  const value = compute();
  storeLocalMemoryReadCache(key, variants, variant, signature, value);
  return value;
}

function storeLocalMemoryReadCache(key, variants, variant, signature, value) {
  let target = variants;
  if (!target) {
    if (localMemoryReadCache.size >= localMemoryReadCacheFileLimit) {
      localMemoryReadCache.delete(localMemoryReadCache.keys().next().value);
    }
    target = new Map();
    localMemoryReadCache.set(key, target);
  }
  target.set(variant, { signature, value });
}

// 방금 쓴 값이 곧 다시 읽힐 때(예: 대화 저장 직후의 프롬프트 기억 재생성) 다시 파싱하지 않게
// 결과를 미리 넣어 둔다. value 는 그 파일을 compute 로 읽었을 때와 같은 모양이어야 한다.
function primeLocalMemoryReadCache(filePath, variant, value) {
  const key = path.resolve(filePath);
  const signature = localMemoryFileSignature(key);
  if (!signature || signature === "missing") return;
  localMemoryReadCache.delete(key);
  storeLocalMemoryReadCache(key, undefined, variant, signature, value);
}

function invalidateLocalMemoryReadCache(filePath) {
  if (localMemoryReadCache.delete(path.resolve(filePath))) localMemoryReadCacheStats.invalidations += 1;
}

function readCachedJsonArray(filePath) {
  return readLocalMemoryCached(filePath, "json-array", () => readJsonArray(filePath));
}

function readCachedJsonObject(filePath) {
  return readLocalMemoryCached(filePath, "json-object", () => readJsonObject(filePath));
}

function readCachedSanitizedArray(filePath, variant, sanitize) {
  return readLocalMemoryCached(filePath, variant, () => sanitize(readJsonArray(filePath)));
}

function readCachedThreads(root) {
  return readCachedSanitizedArray(path.join(root, chatThreadsRelativePath), "threads", sanitizeThreads);
}

function readCachedConversationDigest(root) {
  return readCachedSanitizedArray(path.join(root, conversationDigestRelativePath), "conversation-digest", sanitizeConversationDigestRecords);
}

function readCachedDecisionRecords(root) {
  return readCachedSanitizedArray(path.join(root, decisionLedgerRelativePath), "decisions", (records) => sanitizeDecisionRecords(records));
}

function readCachedWorkPatternRecords(root) {
  return readCachedSanitizedArray(path.join(root, workPatternLedgerRelativePath), "work-patterns", (records) => sanitizeWorkPatternRecords(records));
}

function readCachedConnectorRecoveryMemories(root) {
  const ledgerPath = path.join(root, workPatternLedgerRelativePath);
  return readLocalMemoryCached(ledgerPath, "connector-recovery", () =>
    createConnectorRecoveryMemoryRecords(readCachedWorkPatternRecords(root)));
}

function readCachedLearningSourceRecords(root) {
  return readCachedSanitizedArray(path.join(root, learningSourcesLedgerRelativePath), "learning-sources", (records) => sanitizeLearningSourceRecords(records));
}

function readCachedDelegationArtifactRecords(root) {
  return readCachedSanitizedArray(path.join(root, delegationArtifactLedgerRelativePath), "delegation-artifacts", sanitizeDelegationArtifactRecords);
}

function readCachedDelegationApprovalDecisionRecords(root) {
  return readCachedSanitizedArray(path.join(root, delegationApprovalDecisionLedgerRelativePath), "delegation-approval-decisions", sanitizeDelegationApprovalDecisionRecords);
}

function readCachedDelegationActionQueueRecords(root) {
  return readCachedSanitizedArray(path.join(root, delegationActionQueueLedgerRelativePath), "delegation-action-queue", sanitizeDelegationActionQueueRecords);
}

function readCachedGrowthSuggestions(root) {
  return readCachedSanitizedArray(path.join(root, "memory", "growth", "skill-suggestions.json"), "growth-suggestions", sanitizeGrowthSuggestions);
}

function readCachedSkillSourceRecords(root) {
  return readCachedSanitizedArray(path.join(root, "memory", "growth", "skill-sources.json"), "skill-sources", sanitizeSkillSourceRecords);
}

function readCachedSkillBootstrapPlan(root) {
  const planPath = path.join(root, skillBootstrapPlanRelativePath);
  return readLocalMemoryCached(planPath, "skill-bootstrap-plan", () => sanitizeSkillBootstrapPlan(readJsonObject(planPath)));
}

function readCachedAppProfile(root) {
  const profilePath = path.join(root, appProfileRelativePath);
  return readLocalMemoryCached(profilePath, "app-profile", () => sanitizeAppProfile(readJsonObject(profilePath)));
}

function readMemorySection(label, filePath, maxChars) {
  const text = redactPromptLocalPathMaterial(readTextFile(filePath, maxChars));
  return text ? { label, text } : null;
}

/**
 * 업무 원장 — "지금 무슨 일이 어디까지 됐는지"를 한 곳에 둔다.
 *
 * packages/domain/src/hive/task-ledger.ts 는 완성돼 있었지만 앱 호출부가 0곳이었다.
 * 메일에서 온 카드, 대화에서 맡긴 일, 자동 점검이 만든 카드가 각각 다른 곳에 흩어져
 * 사람이 전체를 볼 수 없었다. 여기가 그 하나의 자리다.
 *
 * 카드는 만들 때 원본 항목을 그대로 두고, 고칠 때는 patchTaskInLedger 로 그 카드의
 * 그 필드만 바꾼다(정규화된 표시 모델을 다시 쓰면 원본 값이 망가진다 — 도메인 주석 참고).
 */
export const taskLedgerRelativePath = path.join("memory", "tasks", "TaskLedger.json");

function readTaskLedgerRaw(root) {
  const raw = readJsonObject(path.join(root, taskLedgerRelativePath));
  return Array.isArray(raw?.tasks) ? raw.tasks : [];
}

function writeTaskLedgerRaw(root, tasks) {
  atomicWriteJson(path.join(root, taskLedgerRelativePath), {
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks,
  });
}

function taskResult(status, root, runtime, rawTasks, extra = {}) {
  const rawById = new Map(rawTasks.map((task) => [task?.id, task]));
  const tasks = runtime.parseTaskLedger(rawTasks).map((task) => {
    if (!task.execution) return task;
    const execution = rawById.get(task.id)?.execution;
    return { ...task, execution: {
      ...task.execution,
      ...(typeof execution?.sourceThreadId === "string" ? { sourceThreadId: execution.sourceThreadId.slice(0, 200) } : {}),
      ...(typeof execution?.sourceEventId === "string" ? { sourceEventId: execution.sourceEventId.slice(0, 200) } : {}),
      // 이 일이 올린 승인함 카드 — 업무판의 '승인함에서 확인'이 이 카드로 바로 간다.
      ...(typeof execution?.approvalCardId === "string" && execution.approvalCardId ? { approvalCardId: execution.approvalCardId.slice(0, 200) } : {}),
    } };
  });
  return {
    status,
    root,
    tasks,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    ...extra,
  };
}

// Main-process execution updates are synchronous read/modify/write operations.
// Never retain a snapshot across a provider call: other cards and human answers
// may have changed while that call was pending.
export async function openTaskLedgerExecutionStore(options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const runtime = await loadLocalMemoryDomainRuntime(options);
  return {
    root,
    runtime,
    read: () => readTaskLedgerRaw(root),
    change(id, update) {
      const rows = readTaskLedgerRaw(root);
      const index = rows.findIndex((row) => row?.id === id);
      const next = update(index < 0 ? undefined : rows[index]);
      if (!next) return false;
      if (index < 0) rows.unshift(next);
      else rows[index] = next;
      writeTaskLedgerRaw(root, rows);
      return true;
    },
    result: (status, extra = {}) => taskResult(status, root, runtime, readTaskLedgerRaw(root), extra),
  };
}

async function listTasks(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const runtime = await loadLocalMemoryDomainRuntime(options);
  const rawTasks = readTaskLedgerRaw(root);
  const tasks = runtime.parseTaskLedger(rawTasks);
  const open = tasks.filter((task) => task.status !== "done");
  return taskResult("local_memory_tasks_loaded", root, runtime, rawTasks, {
    openCount: open.length,
    blockedCount: open.filter((task) => task.status === "blocked").length,
    userMessage: open.length
      ? `진행 중인 일 ${open.length}건을 불러왔습니다.`
      : "지금 진행 중인 일이 없습니다.",
  });
}

/**
 * 카드를 넣거나 갱신한다. 같은 id 가 이미 있으면 **있던 값 위에 덮는다** — 메일 자동
 * 점검이 같은 메일을 다시 봐도 카드가 둘이 되지 않는다. 사람이 이미 답한 질문이나
 * 진행 상태는 들어오는 값에 그 필드가 없으면 그대로 남는다.
 */
async function upsertTasks(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const runtime = await loadLocalMemoryDomainRuntime(options);
  const drafts = Array.isArray(payload.tasks) ? payload.tasks.slice(0, 80) : [];
  if (drafts.length === 0) {
    return taskResult("local_memory_tasks_unchanged", root, runtime, readTaskLedgerRaw(root), {
      userMessage: "넣을 카드가 없습니다.",
    });
  }
  const nowIso = new Date().toISOString();
  const existing = readTaskLedgerRaw(root);
  const existingIds = new Set(existing.map((entry) => sanitizeLine(entry?.id, 120)).filter(Boolean));
  const created = [];
  let next = existing;
  for (const draft of drafts) {
    const id = sanitizeLine(draft?.id, 120);
    const title = sanitizeLine(draft?.title, 200);
    if (!id || !title) continue;
    if (existingIds.has(id)) {
      // 있던 카드는 그 카드의 넘어온 필드만 갈아 끼운다. 상태·답변은 건드리지 않는다.
      const patch = {};
      if (draft.description) patch.description = sanitizeLine(draft.description, 2000);
      if (draft.assigneeId) patch.assigneeId = sanitizeLine(draft.assigneeId, 120);
      if (draft.assigneeName) patch.assigneeName = sanitizeLine(draft.assigneeName, 80);
      patch.updatedAt = nowIso;
      next = runtime.patchTaskInLedger(next, id, patch);
      continue;
    }
    const task = runtime.createModyTask({
      id,
      title,
      createdAt: sanitizeIsoDate(draft.createdAt || nowIso),
      ...(draft.description ? { description: sanitizeLine(draft.description, 2000) } : {}),
      ...(draft.assigneeId ? { assigneeId: sanitizeLine(draft.assigneeId, 120) } : {}),
      ...(draft.assigneeName ? { assigneeName: sanitizeLine(draft.assigneeName, 80) } : {}),
      ...(draft.status ? { status: draft.status } : {}),
      ...(Array.isArray(draft.dependsOn) ? { dependsOn: draft.dependsOn.map((v) => sanitizeLine(v, 120)).filter(Boolean) } : {}),
      ...(Number.isFinite(draft.priority) ? { priority: Number(draft.priority) } : {}),
      ...(draft.origin && typeof draft.origin === "object" ? { origin: draft.origin } : {}),
    });
    next = [task, ...next];
    existingIds.add(id);
    created.push(task.id);
  }
  writeTaskLedgerRaw(root, next);
  return taskResult("local_memory_tasks_upserted", root, runtime, next, {
    createdCount: created.length,
    userMessage: created.length ? `새 일 ${created.length}건을 원장에 올렸습니다.` : "이미 있던 일을 갱신했습니다.",
  });
}

/** 직원이 물어본 것에 사람이 답한다. 답하면 카드가 다시 움직인다(blocked → doing). */
async function answerTaskQuestion(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const runtime = await loadLocalMemoryDomainRuntime(options);
  const taskId = sanitizeLine(payload.taskId, 120);
  const answer = sanitizeLine(payload.answer, 1000);
  const existing = readTaskLedgerRaw(root);
  const task = runtime.parseTaskLedger(existing).find((entry) => entry.id === taskId);
  if (!taskId || !answer || !task) {
    return taskResult("local_memory_task_blocked", root, runtime, existing, {
      userMessage: "답할 질문을 찾지 못했습니다.",
    });
  }
  const pendingQuestion = [...(task.humanQA ?? [])].reverse().find((qa) => qa.answer === undefined && !qa.dismissedAt);
  if (payload.askedAt && pendingQuestion?.askedAt !== payload.askedAt) {
    return taskResult("local_memory_task_blocked", root, runtime, existing, { userMessage: "질문이 바뀌었습니다. 다시 읽고 답해 주세요." });
  }
  const answered = runtime.answerHumanOnModyTask(task, answer, new Date(options.now?.() ?? Date.now()).toISOString());
  if (answered === task) {
    return taskResult("local_memory_task_blocked", root, runtime, existing, {
      userMessage: "이미 답한 질문입니다. 업무판을 다시 읽어 주세요.",
    });
  }
  const rawTask = existing.find((entry) => entry?.id === taskId);
  const next = runtime.patchTaskInLedger(existing, taskId, {
    status: answered.status,
    completedAt: undefined,
    humanQA: answered.humanQA,
    updatedAt: answered.updatedAt,
    ...(rawTask?.execution ? {
      status: rawTask.execution.state === "paused" ? "blocked" : "todo",
      execution: { ...rawTask.execution, state: rawTask.execution.state === "paused" ? "paused" : "queued", owner: null, token: null, dueAt: answered.updatedAt, error: "" },
    } : {}),
  });
  writeTaskLedgerRaw(root, next);
  return taskResult("local_memory_task_answered", root, runtime, next, {
    userMessage: rawTask?.execution?.state === "paused" ? "답변을 저장했습니다. 이어가기를 누르면 진행합니다." : rawTask?.execution ? "답변을 저장했습니다. 이 답으로 업무를 이어갑니다." : "답변을 업무 기록에 저장했습니다.",
  });
}

async function completeTask(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const runtime = await loadLocalMemoryDomainRuntime(options);
  const taskId = sanitizeLine(payload.taskId, 120);
  const result = sanitizeLine(payload.result, 2000);
  const existing = readTaskLedgerRaw(root);
  const task = runtime.parseTaskLedger(existing).find((entry) => entry.id === taskId);
  if (!taskId || !task) {
    return taskResult("local_memory_task_blocked", root, runtime, existing, {
      userMessage: "끝낼 일을 찾지 못했습니다.",
    });
  }
  const done = runtime.completeModyTask(task, result || "완료", new Date(options.now?.() ?? Date.now()).toISOString());
  const next = runtime.patchTaskInLedger(existing, taskId, {
    status: done.status,
    completedAt: done.completedAt,
    result: done.result,
    updatedAt: done.updatedAt,
    ...(existing.find((entry) => entry?.id === taskId)?.execution ? {
      execution: { ...existing.find((entry) => entry?.id === taskId).execution, state: "completed", owner: null, token: null, repeat: "none" },
    } : {}),
  });
  writeTaskLedgerRaw(root, next);
  return taskResult("local_memory_task_completed", root, runtime, next, {
    userMessage: "끝난 것으로 표시했습니다.",
  });
}

/** 배운 것 장부가 사는 곳. 사용자가 고른 로컬 기억 폴더 안이다. */
export const learningLedgerRelativePath = path.join("memory", "learning", "LearningLedger.json");

function readLearningLedgerFile(runtime, root) {
  return runtime.parseLearningLedger(readJsonObject(path.join(root, learningLedgerRelativePath)));
}

function blockedLearningResult(root, userMessage) {
  return {
    status: "local_memory_learning_blocked",
    root,
    lessons: [],
    applied: [],
    proposals: [],
    userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 지금까지 배운 것을 그대로 보여준다. 화면이 "무엇을 배웠는지"를 사람에게 보이는 근거다. */
async function loadLearningLessons(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const teammateId = sanitizePathSegment(payload.teammateId || "");
  const runtime = await loadLocalMemoryDomainRuntime(options);
  const ledger = readLearningLedgerFile(runtime, root);
  const lessons =
    teammateId && typeof runtime.lessonsForTeammate === "function"
      ? runtime.lessonsForTeammate(ledger, teammateId)
      : ledger.lessons;
  return {
    status: "local_memory_learning_lessons_loaded",
    root,
    teammateId,
    lessons,
    // 확인을 기다리는 배움도 같이 준다 — 화면이 두 번 물어보지 않도록.
    proposals: readLearningProposalsFile(root),
    totalCount: ledger.lessons.length,
    userMessage: lessons.length
      ? `지금까지 배운 것 ${lessons.length}개를 불러왔습니다.`
      : "아직 배운 것이 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/**
 * 배운 것을 적는다.
 *
 * **승인이 필요한 종류는 여기서 막는다.** 승인함 배선이 붙기 전까지, 앱이 스스로
 * 밖으로 나가는 행동을 바꾸는 일은 일어나지 않는다. 사용자를 알아가는 것
 * (취향·사실)만 저절로 쌓인다. 막을 때는 왜 막았는지 그대로 돌려준다.
 */
async function applyLearningLessons(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const runtime = await loadLocalMemoryDomainRuntime(options);
  const requested = Array.isArray(payload.edits) ? payload.edits.slice(0, 40) : [];
  if (requested.length === 0) {
    return blockedLearningResult(root, "적을 내용이 없습니다.");
  }
  const nowIso = new Date().toISOString();
  // 밖으로 나가는 행동이 달라지는 배움은 곧바로 적지 않고 **사용자에게 물어본다.**
  // 예전에는 통째로 막았는데, 그러면 앱은 영원히 일하는 순서를 배우지 못한다.
  const needsApproval = [];
  const appliesNow = [];
  for (const edit of requested) {
    // source 를 같이 넘긴다 — 사용자가 직접 적은 것은 묻지 않는다.
    if (runtime.lessonNeedsApproval({ kind: edit?.kind, scope: edit?.scope, source: edit?.source }))
      needsApproval.push(edit);
    else appliesNow.push(edit);
  }

  const ledger = readLearningLedgerFile(runtime, root);
  const result =
    appliesNow.length > 0
      ? runtime.applyLessonEdits({ ledger, edits: appliesNow, nowIso })
      : { applied: [], ledger };

  const proposals = readLearningProposalsFile(root);
  const addedProposals = [];
  for (const edit of needsApproval) {
    // 물어볼 수 없는 편집은 물어보지 않는다 — 근거가 없으면 사용자도 판단할 수 없다.
    const invalid = runtime.validateLessonEdit(edit);
    if (invalid) continue;
    const proposal = {
      id: `learning-proposal-${nowIso}-${addedProposals.length}`,
      proposedAt: nowIso,
      reason:
        edit.scope === "office"
          ? "사무실 전체에 걸리는 규칙이라 확인이 필요합니다."
          : "앞으로 일하는 방식이 달라지는 배움이라 확인이 필요합니다.",
      edit,
    };
    addedProposals.push(proposal);
  }
  if (appliesNow.length > 0) {
    atomicWriteJson(path.join(root, learningLedgerRelativePath), result.ledger);
  }
  if (addedProposals.length > 0) {
    writeLearningProposalsFile(root, [...addedProposals, ...proposals].slice(0, maxLearningProposals));
  }

  const appliedCount = result.applied.filter((edit) => edit.applied).length;
  const messages = [];
  if (appliedCount > 0) messages.push(`${appliedCount}개를 배웠습니다. 마음에 안 들면 되돌릴 수 있습니다.`);
  if (addedProposals.length > 0) messages.push(`${addedProposals.length}개는 확인을 기다립니다.`);
  return {
    status: "local_memory_learning_lessons_applied",
    root,
    applied: result.applied,
    lessons: result.ledger.lessons,
    appliedCount,
    proposals: readLearningProposalsFile(root),
    proposedCount: addedProposals.length,
    userMessage: messages.length > 0 ? messages.join(" ") : "적을 수 있는 것이 없었습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 확인을 기다리는 배움. 최대 개수를 둬서 무한히 쌓이지 않게 한다. */
const maxLearningProposals = 40;
export const learningProposalsRelativePath = path.join("memory", "learning", "LearningProposals.json");

function readLearningProposalsFile(root) {
  const raw = readJsonObject(path.join(root, learningProposalsRelativePath));
  const list = Array.isArray(raw?.proposals) ? raw.proposals : [];
  return list
    .filter((entry) => entry && typeof entry === "object" && entry.edit && typeof entry.edit === "object")
    .map((entry) => ({
      id: sanitizeLine(entry.id, 120),
      proposedAt: sanitizeIsoDate(entry.proposedAt || new Date().toISOString()),
      reason: sanitizeLine(entry.reason, 200),
      edit: entry.edit,
    }))
    .filter((entry) => entry.id)
    .slice(0, maxLearningProposals);
}

function writeLearningProposalsFile(root, proposals) {
  atomicWriteJson(path.join(root, learningProposalsRelativePath), {
    version: 1,
    updatedAt: new Date().toISOString(),
    proposals,
  });
}

/**
 * 확인을 기다리는 배움에 답한다.
 *
 * 승인하면 그때 장부에 적히고(그래서 되돌리기도 그대로 된다), 거절하면 흔적 없이 사라진다.
 * 승인 결과도 before/after 를 들고 나오므로 승인한 뒤에도 되돌릴 수 있다.
 */
async function decideLearningProposal(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const runtime = await loadLocalMemoryDomainRuntime(options);
  const proposalId = sanitizeLine(payload.proposalId, 120);
  const decision = payload.decision === "approve" ? "approve" : payload.decision === "reject" ? "reject" : "";
  const proposals = readLearningProposalsFile(root);
  const target = proposals.find((entry) => entry.id === proposalId);
  if (!proposalId || !decision || !target) {
    return blockedLearningResult(root, "확인할 항목을 찾지 못했습니다.");
  }

  const remaining = proposals.filter((entry) => entry.id !== proposalId);
  if (decision === "reject") {
    writeLearningProposalsFile(root, remaining);
    return {
      status: "local_memory_learning_proposal_rejected",
      root,
      applied: [],
      lessons: readLearningLedgerFile(runtime, root).lessons,
      proposals: remaining,
      userMessage: "배우지 않기로 했습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const ledger = readLearningLedgerFile(runtime, root);
  const result = runtime.applyLessonEdits({
    ledger,
    edits: [target.edit],
    nowIso: new Date().toISOString(),
  });
  atomicWriteJson(path.join(root, learningLedgerRelativePath), result.ledger);
  writeLearningProposalsFile(root, remaining);
  const appliedCount = result.applied.filter((edit) => edit.applied).length;
  return {
    status: "local_memory_learning_proposal_approved",
    root,
    applied: result.applied,
    lessons: result.ledger.lessons,
    proposals: remaining,
    appliedCount,
    userMessage: appliedCount ? "확인해 주셔서 배웠습니다. 마음에 안 들면 되돌릴 수 있습니다." : "적을 수 없었습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/**
 * 되돌리기. 직전 적용의 applied 기록을 그대로 넘기면 역순으로 뒤집는다.
 * 되돌리기도 같은 검사를 받고, 그 자체가 다시 되돌릴 수 있는 기록으로 남는다.
 */
async function rollbackLearningLessons(payload = {}, options = {}) {
  const root = ensureLocalMemoryRoot(options);
  const runtime = await loadLocalMemoryDomainRuntime(options);
  const applied = Array.isArray(payload.applied) ? payload.applied.slice(0, 40) : [];
  if (applied.length === 0) {
    return blockedLearningResult(root, "되돌릴 기록이 없습니다.");
  }
  const edits = runtime.buildLessonRollbackEdits(applied);
  if (edits.length === 0) {
    return blockedLearningResult(root, "되돌릴 것이 없습니다.");
  }
  const ledger = readLearningLedgerFile(runtime, root);
  const result = runtime.applyLessonEdits({
    ledger,
    edits,
    nowIso: new Date().toISOString(),
  });
  atomicWriteJson(path.join(root, learningLedgerRelativePath), result.ledger);
  const undoneCount = result.applied.filter((edit) => edit.applied).length;
  return {
    status: "local_memory_learning_lessons_rolled_back",
    root,
    applied: result.applied,
    lessons: result.ledger.lessons,
    undoneCount,
    userMessage: undoneCount ? `${undoneCount}개를 되돌렸습니다.` : "되돌릴 것이 없었습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/**
 * 지금까지 배운 것을 프롬프트 한 조각으로 만든다.
 *
 * 본문을 통째로 넣지 않는다 — 배움은 시간이 갈수록 늘어나므로 요약만 넣고, 넘치는
 * 만큼은 개수로 알린다(도메인 formatLessonsForPrompt 가 그 상한을 갖고 있다).
 * 도메인을 못 읽으면 조용히 건너뛴다. 기억 전체가 이것 때문에 막히면 안 된다.
 */
async function loadLearningLessonsSection(root, teammateId, options) {
  try {
    const runtime = await loadLocalMemoryDomainRuntime(options);
    if (
      typeof runtime.parseLearningLedger !== "function" ||
      typeof runtime.formatLessonsForPrompt !== "function"
    ) {
      return null;
    }
    const ledger = runtime.parseLearningLedger(
      readJsonObject(path.join(root, learningLedgerRelativePath)),
    );
    const lessons =
      teammateId && typeof runtime.lessonsForTeammate === "function"
        ? runtime.lessonsForTeammate(ledger, teammateId)
        : ledger.lessons;
    const text = redactPromptLocalPathMaterial(runtime.formatLessonsForPrompt(lessons));
    return text ? { label: "LearningLedger", text } : null;
  } catch {
    return null;
  }
}

function redactPromptLocalPathMaterial(value) {
  return String(value ?? "")
    .replace(/file:\/\/\/+[A-Za-z]:[\\/].*$/gimu, "[local-path]")
    .replace(/(^|[\s:("'=\[{])[A-Za-z]:[\\/].*$/gmu, "$1[local-path]")
    .replace(
      /(^|[\s("'=\[{])(?:\\\\|\/\/)[^\\/\s]+[\\/].*$/gmu,
      "$1[local-path]",
    );
}

function readTextFile(filePath, maxChars = 2_000) {
  try {
    if (!existsSync(filePath)) return "";
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return "";
    return truncateText(readFileSync(filePath, "utf8"), maxChars)
      .split("\n")
      .map((line) => sanitizeLine(line, 360))
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function truncateText(value, maxChars) {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 28)).trimEnd()}\n...truncated for prompt...`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function sanitizePortableManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  return {
    schema: sanitizeLine(manifest.schema, 80),
    portableMemory: manifest.portableMemory === true,
    product: sanitizeLine(manifest.product, 80),
    version: Number(manifest.version) || 1,
    updatedAt: sanitizeIsoDate(manifest.updatedAt || new Date().toISOString()),
    restore: manifest.restore && typeof manifest.restore === "object"
      ? {
          profilePath: sanitizeLine(manifest.restore.profilePath, 240),
          chatThreadsPath: sanitizeLine(manifest.restore.chatThreadsPath, 240),
          conversationDigestPath: sanitizeLine(manifest.restore.conversationDigestPath, 240),
          crewSoulBundlePath: sanitizeLine(manifest.restore.crewSoulBundlePath, 240),
          crewSoulBundleSummaryPath: sanitizeLine(manifest.restore.crewSoulBundleSummaryPath, 240),
          crewSoulPath: sanitizeLine(manifest.restore.crewSoulPath, 240),
          crewKitIndexPath: sanitizeLine(manifest.restore.crewKitIndexPath, 240),
          growthLedgerPath: sanitizeLine(manifest.restore.growthLedgerPath, 240),
          skillGrowthPath: sanitizeLine(manifest.restore.skillGrowthPath, 240),
          skillBridgePath: sanitizeLine(manifest.restore.skillBridgePath, 240),
          selfGrowthContractPath: sanitizeLine(manifest.restore.selfGrowthContractPath, 240),
          skillSourceInventoryPath: sanitizeLine(manifest.restore.skillSourceInventoryPath, 240),
          skillSourcesPath: sanitizeLine(manifest.restore.skillSourcesPath, 240),
          skillBootstrapPlanPath: sanitizeLine(manifest.restore.skillBootstrapPlanPath, 240),
          skillBootstrapPlanSummaryPath: sanitizeLine(manifest.restore.skillBootstrapPlanSummaryPath, 240),
          workspaceSkillLifecyclePath: sanitizeLine(
            manifest.restore.workspaceSkillLifecyclePath,
            240,
          ),
          workspaceSkillLifecycleSummaryPath: sanitizeLine(
            manifest.restore.workspaceSkillLifecycleSummaryPath,
            240,
          ),
          decisionLedgerPath: sanitizeLine(manifest.restore.decisionLedgerPath, 240),
          workPatternLedgerPath: sanitizeLine(manifest.restore.workPatternLedgerPath, 240),
          delegationArtifactLedgerPath: sanitizeLine(manifest.restore.delegationArtifactLedgerPath, 240),
          delegationApprovalDecisionLedgerPath: sanitizeLine(manifest.restore.delegationApprovalDecisionLedgerPath, 240),
          delegationActionQueueLedgerPath: sanitizeLine(manifest.restore.delegationActionQueueLedgerPath, 240),
          promptMemoryPath: sanitizeLine(manifest.restore.promptMemoryPath, 240),
          identityFiles: Array.isArray(manifest.restore.identityFiles)
            ? manifest.restore.identityFiles.map(sanitizeIdentityFileRecord).filter(Boolean).slice(0, 80)
            : [],
        }
      : {},
    counts: manifest.counts && typeof manifest.counts === "object"
      ? {
          teammates: Number(manifest.counts.teammates) || 0,
          skills: Number(manifest.counts.skills) || 0,
          activeSkills: Number(manifest.counts.activeSkills) || 0,
          messengerChannels: Number(manifest.counts.messengerChannels) || 0,
          crewKits: Number(manifest.counts.crewKits) || 0,
          workDecisions: Number(manifest.counts.workDecisions) || 0,
          workPatterns: Number(manifest.counts.workPatterns) || 0,
          connectorRecoveryMemories: Number(manifest.counts.connectorRecoveryMemories) || 0,
          delegationArtifacts: Number(manifest.counts.delegationArtifacts) || 0,
          delegationApprovalDecisions: Number(manifest.counts.delegationApprovalDecisions) || 0,
          delegationActionQueue: Number(manifest.counts.delegationActionQueue) || 0,
          growthSuggestions: Number(manifest.counts.growthSuggestions) || 0,
          skillSources: Number(manifest.counts.skillSources) || 0,
          skillBootstrapPlans: Number(manifest.counts.skillBootstrapPlans) || 0,
          workspaceSkillProposals:
            Number(manifest.counts.workspaceSkillProposals) || 0,
          workspaceSkillPendingInstallApprovals:
            Number(
              manifest.counts.workspaceSkillPendingInstallApprovals,
            ) || 0,
          workspaceSkillsInstalledInactive:
            Number(manifest.counts.workspaceSkillsInstalledInactive) || 0,
          workspaceSkillsActive:
            Number(manifest.counts.workspaceSkillsActive) || 0,
          workspaceSkillsBlocked:
            Number(manifest.counts.workspaceSkillsBlocked) || 0,
          crewSoulBundles: Number(manifest.counts.crewSoulBundles) || 0,
          promptMemories: Number(manifest.counts.promptMemories) || 0,
          identityFiles: Number(manifest.counts.identityFiles) || 0,
        }
      : {},
    safety: Array.isArray(manifest.safety)
      ? manifest.safety.map((line) => sanitizeLine(line, 220)).filter(Boolean).slice(0, 12)
      : [],
  };
}

function sanitizeCrewSoulBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return null;
  const raw = bundle;
  return {
    schema: sanitizeLine(raw.schema, 80),
    product: sanitizeLine(raw.product, 80),
    generatedAt: sanitizeIsoDate(raw.generatedAt || new Date().toISOString()),
    purpose: sanitizeLine(raw.purpose, 280),
    restoreMode: sanitizeLine(raw.restoreMode, 120),
    restoreOrder: Array.isArray(raw.restoreOrder)
      ? raw.restoreOrder.map((line) => sanitizeLine(line, 240)).filter(Boolean).slice(0, 24)
      : [],
    appSettings: raw.appSettings && typeof raw.appSettings === "object"
      ? {
          activeTeammateId: sanitizeLine(raw.appSettings.activeTeammateId, 80),
          theme: sanitizeLine(raw.appSettings.theme, 40),
          assistantDisplayName: sanitizeLine(raw.appSettings.assistantDisplayName, 80),
          userDisplayName: sanitizeLine(raw.appSettings.userDisplayName, 80),
          userCallName: sanitizeLine(raw.appSettings.userCallName, 80),
          mainControllerId: sanitizeLine(raw.appSettings.mainControllerId, 120),
          mainControllerName: sanitizeLine(raw.appSettings.mainControllerName, 80),
          mainControllerChannelName: sanitizeLine(raw.appSettings.mainControllerChannelName, 120),
        }
      : {},
    teammateChannels: Array.isArray(raw.teammateChannels)
      ? raw.teammateChannels.map(sanitizeCrewSoulBundleTeammate).filter(Boolean).slice(0, 40)
      : [],
    activeCrewKits: Array.isArray(raw.activeCrewKits)
      ? raw.activeCrewKits.map(sanitizeCrewSoulBundleCrewKit).filter(Boolean).slice(0, 80)
      : [],
    skillRecommendations: Array.isArray(raw.skillRecommendations)
      ? raw.skillRecommendations.map(sanitizeCrewSoulBundleRecommendation).filter(Boolean).slice(0, 80)
      : [],
    messengerChannels: Array.isArray(raw.messengerChannels)
      ? raw.messengerChannels.map(sanitizeCrewSoulBundleMessenger).filter(Boolean).slice(0, 24)
      : [],
    restorePaths: raw.restorePaths && typeof raw.restorePaths === "object"
      ? Object.fromEntries(
          Object.entries(raw.restorePaths)
            .map(([key, value]) => [sanitizeLine(key, 80), sanitizeLine(value, 240)])
            .filter(([key, value]) => key && value),
        )
      : {},
    counts: raw.counts && typeof raw.counts === "object"
      ? {
          teammates: Number(raw.counts.teammates) || 0,
          activeCrewKits: Number(raw.counts.activeCrewKits) || 0,
          recommendations: Number(raw.counts.recommendations) || 0,
          messengerChannels: Number(raw.counts.messengerChannels) || 0,
          manifestIdentityFiles: Number(raw.counts.manifestIdentityFiles) || 0,
        }
      : {},
    safety: Array.isArray(raw.safety)
      ? raw.safety.map((line) => sanitizeLine(line, 220)).filter(Boolean).slice(0, 12)
      : [],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeCrewSoulBundleTeammate(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeLine(value.id, 80),
    templateId: sanitizeLine(value.templateId, 40),
    avatarId: sanitizeLine(value.avatarId, 64),
    name: sanitizeLine(value.name, 80),
    teamLabel: sanitizeLine(value.teamLabel, 80),
    roleTitle: sanitizeLine(value.roleTitle, 120),
    channelName: sanitizeLine(value.channelName, 80),
    brief: sanitizeLine(value.brief, 280),
    skillIds: Array.isArray(value.skillIds)
      ? value.skillIds.map((id) => sanitizeLine(id, 80)).filter(Boolean).slice(0, 24)
      : [],
    activeSkillIds: Array.isArray(value.activeSkillIds)
      ? value.activeSkillIds.map((id) => sanitizeLine(id, 80)).filter(Boolean).slice(0, 24)
      : [],
    instructions: Array.isArray(value.instructions)
      ? value.instructions.map((line) => sanitizeLine(line, 180)).filter(Boolean).slice(0, 12)
      : [],
    memoryPaths: value.memoryPaths && typeof value.memoryPaths === "object"
      ? Object.fromEntries(
          Object.entries(value.memoryPaths)
            .map(([key, pathValue]) => [sanitizeLine(key, 80), sanitizeLine(pathValue, 240)])
            .filter(([key, pathValue]) => key && pathValue),
        )
      : {},
    recentWork: Array.isArray(value.recentWork)
      ? value.recentWork.map(sanitizeCrewSoulBundleRecentWork).filter(Boolean).slice(0, 12)
      : [],
    recentDecisions: Array.isArray(value.recentDecisions)
      ? value.recentDecisions.map(sanitizeCrewSoulBundleRecentDecision).filter(Boolean).slice(0, 12)
      : [],
    restoreRule: sanitizeLine(value.restoreRule, 220),
  };
}

function sanitizeCrewSoulBundleRecentWork(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeLine(value.id, 120),
    sourceKind: sanitizeLine(value.sourceKind, 80),
    label: sanitizeLine(value.label, 120),
    summary: sanitizeLine(value.summary, 220),
    learnedAt: sanitizeIsoDate(value.learnedAt || new Date().toISOString()),
    artifactPaths: Array.isArray(value.artifactPaths)
      ? value.artifactPaths.map((item) => sanitizeLine(item, 240)).filter(Boolean).slice(0, 4)
      : [],
  };
}

function sanitizeCrewSoulBundleRecentDecision(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeLine(value.id, 120),
    decision: sanitizeLine(value.decision, 80),
    summary: sanitizeLine(value.summary, 220),
    decidedAt: sanitizeIsoDate(value.decidedAt || new Date().toISOString()),
  };
}

function sanitizeCrewSoulBundleCrewKit(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeLine(value.id, 80),
    label: sanitizeLine(value.label, 120),
    category: sanitizeLine(value.category, 80),
    connectorIds: Array.isArray(value.connectorIds)
      ? value.connectorIds.map((id) => sanitizeLine(id, 80)).filter(Boolean).slice(0, 20)
      : [],
    assignedTeammateIds: Array.isArray(value.assignedTeammateIds)
      ? value.assignedTeammateIds.map((id) => sanitizeLine(id, 80)).filter(Boolean).slice(0, 20)
      : [],
    restoreAction: sanitizeLine(value.restoreAction, 140),
  };
}

function sanitizeCrewSoulBundleRecommendation(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeLine(value.id, 80),
    label: sanitizeLine(value.label, 120),
    recommendedTeam: sanitizeLine(value.recommendedTeam, 80),
    triggerKeywords: Array.isArray(value.triggerKeywords)
      ? value.triggerKeywords.map((keyword) => sanitizeLine(keyword, 80)).filter(Boolean).slice(0, 12)
      : [],
    restoreAction: sanitizeLine(value.restoreAction, 140),
  };
}

function sanitizeCrewSoulBundleMessenger(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeLine(value.id, 80),
    label: sanitizeLine(value.label, 120),
    provider: sanitizeLine(value.provider, 80),
    restoreAction: sanitizeLine(value.restoreAction, 140),
  };
}

function sanitizeIdentityFileRecord(record) {
  if (!record || typeof record !== "object") return null;
  const relativePath = sanitizeLine(record.relativePath, 240);
  if (!relativePath) return null;
  return {
    label: sanitizeLine(record.label, 80) || "ModyCrew 기억 파일",
    kind: sanitizeLine(record.kind, 80) || "memory",
    relativePath,
    state: sanitizeLine(record.state, 40) || "ready",
    detail: sanitizeLine(record.detail, 220),
    teammateId: sanitizeLine(record.teammateId, 120),
  };
}

function atomicWriteJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
  invalidateLocalMemoryReadCache(filePath);
}

function sanitizeChatRoutingReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const targetCrewName = sanitizeLine(value.targetCrewName, 60);
  const reason = sanitizeLine(value.reason, 240);
  if (value.contract !== "agent_org_runtime_routing_v1" || !targetCrewName || !reason || value.externalMutation !== false) {
    return undefined;
  }
  const evidenceCount = Number(value.learningEvidenceCount);
  return {
    contract: "agent_org_runtime_routing_v1",
    sourceLabel: "메인 크루",
    targetCrewName,
    roleTitle: sanitizeLine(value.roleTitle, 80),
    reason,
    assignmentSource: value.assignmentSource === "approved_folder_learning" ? "approved_folder_learning" : undefined,
    learningEvidenceCount: value.assignmentSource === "approved_folder_learning" && Number.isFinite(evidenceCount) && evidenceCount >= 0
      ? Math.floor(evidenceCount)
      : undefined,
    externalMutation: false,
  };
}
function sanitizeThreads(threads) {
  return threads
    .filter((thread) => typeof thread?.id === "string" && Array.isArray(thread?.messages))
    .map((thread) => ({
      id: String(thread.id),
      teammateId: typeof thread.teammateId === "string" ? String(thread.teammateId).slice(0, 120) : undefined,
      surface: thread.surface === "agent" ? "agent" : "general",
      ...(thread.sessionCreated === true ? { sessionCreated: true } : {}),
      ...(typeof thread.taskId === "string" && thread.taskId.length <= 200 ? { taskId: thread.taskId } : {}),
      title: typeof thread.title === "string" ? thread.title.slice(0, 120) : "업무 대화",
      createdAt: Number(thread.createdAt) || Date.now(),
      updatedAt: Number(thread.updatedAt) || Date.now(),
      messages: thread.messages
        .filter((message) => typeof message?.id === "string" && typeof message?.text === "string")
        .map((message) => ({
          id: String(message.id),
          role: message.role === "user" ? "user" : "assistant",
          kind: message.kind === "agent_command" ? "agent_command" : "chat",
          agentRoutingReceipt: sanitizeChatRoutingReceipt(message.agentRoutingReceipt),
          text: String(message.text).slice(0, 100_000),
          actions: Array.isArray(message.actions)
            ? message.actions
                .filter((action) => typeof action?.label === "string")
                .slice(0, 8)
                .map((action) => ({
                  label: String(action.label).slice(0, 40),
                  ...(typeof action.href === "string" ? { href: String(action.href).slice(0, 500) } : {}),
                  ...(typeof action.action === "string" ? { action: String(action.action).slice(0, 80) } : {}),
                  ...(typeof action.shareToTeamTitle === "string" ? { shareToTeamTitle: action.shareToTeamTitle.trim().slice(0, 180) } : {}),
                  ...(typeof action.saveAsDocumentTitle === "string" ? { saveAsDocumentTitle: action.saveAsDocumentTitle.trim().slice(0, 180) } : {}),
                }))
            : undefined,
        })),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function sanitizeConversationDigestRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => sanitizeConversationDigestRecord(record, index))
    .filter(Boolean)
    .slice(0, 80);
}

function sanitizeConversationDigestRecord(record, index = 0) {
  if (!record || typeof record !== "object") return null;
  const threadId = sanitizeLine(record.threadId || `thread-${index}`, 140);
  if (!threadId) return null;
  return {
    id: sanitizeLine(record.id || `digest-${threadId}`, 180),
    threadId,
    teammateId: sanitizeLine(record.teammateId || "teammate-personal-operator", 120),
    title: sanitizeLine(record.title || "업무 대화", 140),
    updatedAt: sanitizeIsoDate(record.updatedAt || new Date().toISOString()),
    latestUserIntent: sanitizeLine(record.latestUserIntent, 320),
    latestAssistantCommitment: sanitizeLine(record.latestAssistantCommitment, 320),
    userPreferences: sanitizeLineArray(record.userPreferences, 8, 220),
    decisions: sanitizeLineArray(record.decisions, 8, 220),
    openQuestions: sanitizeLineArray(record.openQuestions, 8, 220),
    openIssues: sanitizeLineArray(record.openIssues, 8, 220),
    nextActions: sanitizeLineArray(record.nextActions, 8, 220),
    safetyBoundaries: sanitizeLineArray(record.safetyBoundaries, 8, 220),
    connectionHints: sanitizeLineArray(record.connectionHints, 8, 220),
    storageHints: sanitizeLineArray(record.storageHints, 8, 220),
    sourceMessageCount: Number(record.sourceMessageCount) || 0,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeLineArray(value, limit = 8, maxLength = 220) {
  return Array.isArray(value)
    ? value.map((line) => sanitizeLine(line, maxLength)).filter(Boolean).slice(0, limit)
    : [];
}

function sanitizeDecisionRecords(decisions, defaults = {}) {
  return (Array.isArray(decisions) ? decisions : [])
    .map((value, index) => sanitizeDecisionRecord(value, defaults, index))
    .filter(Boolean)
    .slice(0, 300);
}

function sanitizeHomeApprovalDecisionReceipts(receipts) {
  return (Array.isArray(receipts) ? receipts : [])
    .map((value, index) => sanitizeHomeApprovalDecisionReceipt(value, {}, index))
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80);
}

function sanitizeHomeApprovalDecisionReceipt(value, defaults = {}, index = 0) {
  if (!value || typeof value !== "object") return null;
  const createdAt = Number(value.createdAt) || Date.now();
  const title = sanitizeLine(value.title, 180);
  if (!title) return null;
  const source = sanitizeHomeApprovalDecisionReceiptSource(value.source);
  const status = sanitizeHomeApprovalDecisionReceiptStatus(value.status);
  const id = sanitizeLine(value.id || `${source}-${createdAt}-${index}`, 220);
  return {
    id,
    source,
    label: sanitizeLine(value.label || "결정 기록", 40),
    title,
    detail: sanitizeLine(value.detail || "앱 승인함에서 결정과 실행 경계를 확인했습니다.", 140),
    workTitle: sanitizeLine(value.workTitle || "최근 승인 후보", 80),
    recordPath: sanitizeLine(value.recordPath || "오피스 승인함 · 결정 기록", 160),
    executionLogLabel: sanitizeLine(value.executionLogLabel || "오피스 승인함 · 결정 기록", 160),
    undoLabel: sanitizeLine(value.undoLabel || "최종 실행 전이면 취소 가능, 실행 뒤에는 감사 기록 기준 확인", 160),
    nextStep: sanitizeLine(value.nextStep || "오피스 승인함에서 계속 확인합니다.", 160),
    safetyGate: sanitizeLine(value.safetyGate || "최종 확인 전까지 외부 실행 잠금", 140),
    status,
    proofChainContract: sanitizeLine(value.proofChainContract || "approval_decision_receipt_log_memory_next", 140),
    sourceEvidenceContract: sanitizeLine(value.sourceEvidenceContract || "home_approval_decision_receipt", 140),
    runtimeEvidenceContract: sanitizeLine(value.runtimeEvidenceContract || "home_approval_decision_receipt_runtime", 160),
    approvalGateContract: sanitizeLine(value.approvalGateContract || "external_mutation_requires_user_final_confirmation", 140),
    liveReadinessContract: sanitizeLine(value.liveReadinessContract || "local_decision_receipt_ready", 140),
    memorySuggestionPolicy: sanitizeLine(value.memorySuggestionPolicy || "manual_next_time_only", 80),
    createdAt,
    teammateId: sanitizeLine(value.teammateId || defaults.teammateId || "teammate-personal-operator", 120),
    teammateName: sanitizeLine(value.teammateName || defaults.teammateName || "", 80),
    sourceThreadId: sanitizeLine(value.sourceThreadId || defaults.sourceThreadId || "", 140),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeDecisionRecord(value, defaults = {}, index = 0) {
  if (!value || typeof value !== "object") return null;
  const channelDecision = value.channelDecision && typeof value.channelDecision === "object"
    ? value.channelDecision
    : value;
  const decision = sanitizeDecision(channelDecision.decision);
  if (!decision) return null;
  const decidedAt = sanitizeIsoDate(channelDecision.decidedAt || value.decidedAt || value.receivedAt || new Date().toISOString());
  const workItemId = sanitizeLine(value.workItemId || value.id || channelDecision.workItemId || `decision-${index}`, 160);
  const title = sanitizeLine(value.title || channelDecision.title || "업무 결정", 140);
  const channel = sanitizeLine(channelDecision.channel || value.channel || "app-main-control", 60);
  const decidedBy = sanitizeLine(channelDecision.decidedBy || value.decidedBy || "user", 80);
  const teammateId = sanitizeLine(value.teammateId || defaults.teammateId || "teammate-personal-operator", 120);
  const teammateName = sanitizeLine(value.teammateName || defaults.teammateName || "", 80);
  return {
    id: sanitizeLine(value.decisionMemoryId || `${workItemId}:${decision}:${decidedAt}`, 220),
    workItemId,
    title,
    sourceLabel: sanitizeLine(value.sourceLabel || defaults.source || "업무 인박스", 100),
    status: sanitizeLine(value.status || "decision_recorded", 60),
    decision,
    decisionLabel: decisionLabel(decision),
    channel,
    decidedBy,
    decidedAt,
    teammateId,
    ...(teammateName ? { teammateName } : {}),
    requiresAppReconfirm: channelDecision.requiresAppReconfirm !== false,
    externalMutation: false,
    ...(channelDecision.revisionInstruction
      ? { revisionInstruction: sanitizeLine(channelDecision.revisionInstruction, 220) }
      : {}),
    ...(channelDecision.messagePreview
      ? { messagePreview: sanitizeLine(channelDecision.messagePreview, 220) }
      : {}),
  };
}

function sanitizeWorkPatternRecords(records, defaults = {}) {
  return (Array.isArray(records) ? records : [])
    .map((value, index) => sanitizeWorkPatternRecord(value, defaults, index))
    .filter(Boolean)
    .slice(0, 400);
}

function sanitizeWorkPatternRecord(value, defaults = {}, index = 0) {
  if (!value || typeof value !== "object") return null;
  const sourceKind = sanitizeWorkPatternSourceKind(value.sourceKind || defaults.sourceKind);
  const learnedAt = sanitizeIsoDate(value.learnedAt || value.createdAt || new Date().toISOString());
  const summary = sanitizeLine(value.summary || value.userMessage || value.title || "", 360);
  const signals = Array.isArray(value.signals)
    ? value.signals.map((line) => sanitizeLine(line, 240)).filter(Boolean).slice(0, 12)
    : [];
  if (!summary && signals.length === 0) return null;
  const teammateId = sanitizeLine(value.teammateId || defaults.teammateId || "", 120);
  const sourceLabel = sanitizeLine(value.sourceLabel || defaults.sourceLabel || sourceKindLabel(sourceKind), 100);
  return {
    id: sanitizeLine(value.id || `${sourceKind}-${learnedAt}-${index}`, 220),
    sourceKind,
    sourceLabel,
    learnedAt,
    teammateId,
    teammateName: sanitizeLine(value.teammateName || defaults.teammateName || "", 80),
    summary,
    signals,
    artifactPaths: Array.isArray(value.artifactPaths)
      ? value.artifactPaths.map((line) => sanitizeLine(line, 260)).filter(Boolean).slice(0, 8)
      : [],
    metrics: sanitizeWorkPatternMetrics(value.metrics),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeLearningSourceRecords(records, defaults = {}) {
  return (Array.isArray(records) ? records : [])
    .map((value, index) => sanitizeLearningSourceRecord(value, defaults, index))
    .filter(Boolean)
    .slice(0, 120);
}

function sanitizeLearningSourceRecord(value, defaults = {}, index = 0) {
  if (!value || typeof value !== "object") return null;
  const sourcePath = normalizeLearningSourcePath(value.path || value.absolutePath || value.sourceFolderPath);
  if (!sourcePath) return null;
  const selectedAt = sanitizeIsoDate(value.selectedAt || defaults.selectedAt || value.createdAt || new Date().toISOString());
  const lastScannedAt = sanitizeIsoDate(value.lastScannedAt || defaults.lastScannedAt || value.scannedAt || selectedAt);
  const id = sanitizeLine(value.id || learningSourceId(sourcePath), 160);
  return {
    id,
    path: sourcePath,
    label: sanitizeLine(value.label || value.sourceFolderLabel || path.basename(sourcePath) || sourcePath, 120),
    sourceKind: sanitizeLine(value.sourceKind || defaults.sourceKind || "custom", 60),
    source: sanitizeLine(value.source || defaults.source || "document_learning", 80),
    status: sanitizeLine(value.status || "active", 60),
    fileCount: clampMemoryNumber(value.fileCount ?? value.count, 0, 1_000_000, 0),
    skippedCount: clampMemoryNumber(value.skippedCount, 0, 1_000_000, 0),
    maxDepth: clampMemoryNumber(value.maxDepth, 0, 20, 0),
    maxFiles: clampMemoryNumber(value.maxFiles, 0, 10_000, 0),
    selectedAt,
    lastScannedAt,
    lastSummary: sanitizeLine(value.lastSummary || value.summary || "", 260),
    externalMutation: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function normalizeLearningSourcePath(value) {
  const input = String(value ?? "").replace(/\0/g, "").trim();
  if (!input) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(input)) {
    return input.replace(/\s+/g, "%20").slice(0, 500);
  }
  try {
    return path.resolve(input);
  } catch {
    return "";
  }
}

function learningSourceId(sourcePath) {
  return `learning-source-${createHash("sha256").update(String(sourcePath).toLowerCase()).digest("hex").slice(0, 16)}`;
}

function clampMemoryNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function createConnectorRecoveryMemoryRecords(records) {
  return sanitizeWorkPatternRecords(records)
    .filter((record) => record.sourceKind === "connector_recovery")
    .slice(0, 12)
    .map((record) => ({
      id: record.id,
      connectorId: sanitizeLine(record.metrics?.connectorId || "", 100),
      recoveryKind: sanitizeLine(record.metrics?.recoveryKind || "", 80),
      actionLabel: sanitizeLine(record.metrics?.actionLabel || "연결 확인", 100),
      status: sanitizeLine(record.metrics?.status || "", 100),
      method: sanitizeLine(record.metrics?.method || "", 100),
      category: sanitizeLine(record.metrics?.category || "", 100),
      messengerChannelId: sanitizeLine(record.metrics?.messengerChannelId || "", 100),
      summary: record.summary,
      signals: record.signals.slice(0, 6),
      updatedAt: record.learnedAt,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    }));
}

function sanitizeWorkPatternSourceKind(value) {
  const kind = String(value ?? "").trim();
  if (kind === "mailops") return "mailops";
  if (kind === "connector_recovery") return "connector_recovery";
  if (kind === "document_learning") return "document_learning";
  if (kind === "folder_plan") return "folder_plan";
  if (kind === "document_writer") return "document_writer";
  if (kind === "desktop_control") return "desktop_control";
  if (kind === "channel_delegation") return "channel_delegation";
  if (kind === "crewkit_activation") return "crewkit_activation";
  if (kind === "teammate_memory_update") return "teammate_memory_update";
  if (kind === "teammate_decision_log") return "teammate_decision_log";
  if (kind === "workspace_knowledge") return "workspace_knowledge";
  return "general";
}

function sanitizeDelegationArtifactKind(value) {
  const kind = String(value ?? "").trim();
  if (kind === "mail") return "mail";
  if (kind === "approval") return "approval";
  return "report";
}

function delegationArtifactFileName(kind) {
  if (kind === "mail") return "MailDraft.md";
  if (kind === "approval") return "ApprovalRequest.md";
  return "ReportDraft.md";
}

function delegationArtifactKindLabel(kind) {
  if (kind === "mail") return "메일 초안";
  if (kind === "approval") return "승인 요청 카드";
  return "보고서 초안";
}

function sanitizeDelegationArtifactRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => sanitizeDelegationArtifactRecord(record, index))
    .filter(Boolean)
    .slice(0, 200);
}

function sanitizeDelegationArtifactRecord(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const artifactKind = sanitizeDelegationArtifactKind(value.artifactKind);
  const createdAt = sanitizeIsoDate(value.createdAt || new Date().toISOString());
  const id = sanitizeLine(value.id || `delegation-${artifactKind}-${createdAt}-${index}`, 180);
  if (!id) return null;
  const rows = Array.isArray(value.rows)
    ? value.rows.map(sanitizeDelegationArtifactRow).filter(Boolean).slice(0, 12)
    : [];
  const trustedWorkspaceAgentOutcome = sanitizeTrustedWorkspaceAgentOutcomeBinding(
    value.trustedWorkspaceAgentOutcome,
  );
  return {
    id,
    artifactKind,
    title: sanitizeLine(value.title || delegationArtifactKindLabel(artifactKind), 140),
    requestText: sanitizeLine(value.requestText, 360),
    sourceThreadId: sanitizeLine(value.sourceThreadId, 140),
    sourceTeammateId: sanitizeLine(value.sourceTeammateId, 120),
    teammateName: sanitizeLine(value.teammateName, 80),
    createdAt,
    relativePath: sanitizeLine(value.relativePath, 260),
    folderPath: sanitizeLine(value.folderPath, 240),
    approvalDecision: sanitizeDelegationApprovalDecision(value.approvalDecision, ""),
    approvalStatus: sanitizeLine(value.approvalStatus, 80),
    decidedAt: value.decidedAt ? sanitizeIsoDate(value.decidedAt) : "",
    decidedBy: sanitizeLine(value.decidedBy, 80),
    decisionNote: sanitizeLine(value.decisionNote, 600),
    nextActionKind: sanitizeDelegationActionKind(value.nextActionKind),
    nextActionStatus: sanitizeDelegationActionStatus(value.nextActionStatus),
    nextActionLabel: sanitizeLine(value.nextActionLabel, 140),
    nextActionQueuePath: sanitizeLine(value.nextActionQueuePath, 260),
    rows,
    metrics: sanitizeWorkPatternMetrics(value.metrics),
    ...(trustedWorkspaceAgentOutcome
      ? { trustedWorkspaceAgentOutcome }
      : {}),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeTrustedWorkspaceAgentOutcomeBinding(value) {
  if (!value || typeof value !== "object") return undefined;
  const eventId = safeWorkspaceIntelligenceOpaqueId(value.eventId);
  const runId = safeWorkspaceIntelligenceOpaqueId(value.runId);
  const targetTeammateId = safeWorkspaceIntelligenceAgentId(
    value.targetTeammateId,
  );
  const workPackId = String(value.workPackId ?? "").trim();
  const profileSnapshotSha256 = safeWorkspaceIntelligenceSha256(
    value.profileSnapshotSha256,
  );
  if (
    !eventId ||
    !runId ||
    !targetTeammateId ||
    !workspaceIntelligenceWorkPackIds.has(workPackId)
  ) {
    return undefined;
  }
  const runStatus = String(value.runStatus ?? "").trim();
  return {
    eventId,
    runId,
    targetTeammateId,
    workPackId,
    ...(profileSnapshotSha256 ? { profileSnapshotSha256 } : {}),
    ...(runStatus === "done" || runStatus === "error" ? { runStatus } : {}),
  };
}

function sanitizeDelegationActionKind(value) {
  const kind = String(value ?? "").trim();
  if (kind === "execution_candidate") return "execution_candidate";
  if (kind === "revision_request") return "revision_request";
  if (kind === "rejected_archive") return "rejected_archive";
  if (kind === "review_hold") return "review_hold";
  return "";
}

function sanitizeDelegationActionStatus(value) {
  const status = String(value ?? "").trim();
  if (status === "ready_for_final_confirmation") return "ready_for_final_confirmation";
  if (status === "queued_for_revision") return "queued_for_revision";
  if (status === "held_for_review") return "held_for_review";
  if (status === "archived_rejected") return "archived_rejected";
  return "";
}

function delegationActionKindLabel(kind) {
  if (kind === "execution_candidate") return "실행 후보";
  if (kind === "revision_request") return "수정 큐";
  if (kind === "rejected_archive") return "거절 보관";
  if (kind === "review_hold") return "검토 보류";
  return "다음 처리";
}

function sanitizeDelegationApprovalDecision(value, fallback = "held") {
  const decision = String(value ?? "").trim();
  if (decision === "approved" || decision === "approve") return "approved";
  if (decision === "change_requested" || decision === "revise" || decision === "revision") return "change_requested";
  if (decision === "rejected" || decision === "reject") return "rejected";
  if (decision === "held" || decision === "hold") return "held";
  return fallback;
}

function delegationApprovalDecisionStatus(decision) {
  if (decision === "approved") return "approved_for_execution";
  if (decision === "change_requested") return "needs_revision";
  if (decision === "rejected") return "rejected";
  return "held_for_review";
}

function delegationApprovalDecisionLabel(decision) {
  if (decision === "approved") return "승인";
  if (decision === "change_requested") return "수정 요청";
  if (decision === "rejected") return "거절";
  return "보류";
}

function sanitizeDelegationApprovalDecisionRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => sanitizeDelegationApprovalDecisionRecord(record, index))
    .filter(Boolean)
    .slice(0, 300);
}

function sanitizeDelegationApprovalDecisionRecord(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const decision = sanitizeDelegationApprovalDecision(value.decision);
  const decidedAt = sanitizeIsoDate(value.decidedAt || new Date().toISOString());
  const artifactId = sanitizeLine(value.artifactId, 180);
  if (!artifactId) return null;
  return {
    id: sanitizeLine(value.id || `${artifactId}-${decision}-${decidedAt}-${index}`, 220),
    artifactId,
    artifactKind: sanitizeDelegationArtifactKind(value.artifactKind),
    artifactTitle: sanitizeLine(value.artifactTitle, 140),
    decision,
    status: delegationApprovalDecisionStatus(decision),
    decidedAt,
    decidedBy: sanitizeLine(value.decidedBy, 80) || "app",
    note: sanitizeLine(value.note, 600),
    relativePath: sanitizeLine(value.relativePath, 260),
    teammateName: sanitizeLine(value.teammateName, 80),
    sourceTeammateId: sanitizeLine(value.sourceTeammateId, 120),
    sourceThreadId: sanitizeLine(value.sourceThreadId, 140),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createDelegationActionQueueRecord(decisionRecord, artifact) {
  const actionKind =
    decisionRecord.decision === "approved"
      ? "execution_candidate"
      : decisionRecord.decision === "change_requested"
        ? "revision_request"
        : decisionRecord.decision === "rejected"
          ? "rejected_archive"
          : "review_hold";
  const status =
    actionKind === "execution_candidate"
      ? "ready_for_final_confirmation"
      : actionKind === "revision_request"
        ? "queued_for_revision"
        : actionKind === "rejected_archive"
          ? "archived_rejected"
          : "held_for_review";
  const label =
    actionKind === "execution_candidate"
      ? "최종 실행 전 재확인 대기"
      : actionKind === "revision_request"
        ? "담당 AI 팀원 재작업 대기"
        : actionKind === "rejected_archive"
          ? "거절된 승인 요청 보관"
          : "사용자 재검토 대기";
  return sanitizeDelegationActionQueueRecord({
    id: createDelegationActionQueueId(decisionRecord.artifactId, decisionRecord.decision, actionKind),
    artifactId: decisionRecord.artifactId,
    artifactKind: decisionRecord.artifactKind,
    artifactTitle: decisionRecord.artifactTitle,
    actionKind,
    status,
    label,
    createdAt: decisionRecord.decidedAt,
    decisionId: decisionRecord.id,
    decision: decisionRecord.decision,
    note: decisionRecord.note,
    relativePath: decisionRecord.relativePath,
    sourceTeammateId: artifact.sourceTeammateId,
    teammateName: artifact.teammateName,
    sourceThreadId: artifact.sourceThreadId,
  });
}

function sanitizeDelegationActionQueueRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => sanitizeDelegationActionQueueRecord(record, index))
    .filter(Boolean)
    .slice(0, 300);
}

function sanitizeDelegationActionQueueRecord(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const artifactId = sanitizeLine(value.artifactId, 180);
  const actionKind = sanitizeDelegationActionKind(value.actionKind);
  const status = sanitizeDelegationActionStatus(value.status);
  if (!artifactId || !actionKind || !status) return null;
  const createdAt = sanitizeIsoDate(value.createdAt || new Date().toISOString());
  return {
    id: sanitizeLine(value.id || `${artifactId}-${actionKind}-${createdAt}-${index}`, 220),
    artifactId,
    artifactKind: sanitizeDelegationArtifactKind(value.artifactKind),
    artifactTitle: sanitizeLine(value.artifactTitle, 140),
    actionKind,
    status,
    label: sanitizeLine(value.label, 140) || delegationActionKindLabel(actionKind),
    createdAt,
    decisionId: sanitizeLine(value.decisionId, 220),
    decision: sanitizeDelegationApprovalDecision(value.decision, ""),
    note: sanitizeLine(value.note, 600),
    relativePath: sanitizeLine(value.relativePath, 260),
    sourceTeammateId: sanitizeLine(value.sourceTeammateId, 120),
    teammateName: sanitizeLine(value.teammateName, 80),
    sourceThreadId: sanitizeLine(value.sourceThreadId, 140),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeDelegationArtifactRow(value) {
  if (!value || typeof value !== "object") return null;
  return {
    teammateId: sanitizeLine(value.teammateId, 120),
    teammateName: sanitizeLine(value.teammateName, 80),
    channelName: sanitizeLine(value.channelName, 120),
    status: sanitizeLine(value.status, 40),
    summary: sanitizeLine(value.summary || value.mergedText || value.outputPreview || value.detail, 420),
  };
}

function resolveDelegationArtifactPath(root, relativePath) {
  const clean = String(relativePath ?? "").replaceAll("\\", "/");
  if (!clean || clean.includes("\0") || clean.startsWith("/") || clean.includes("..")) return "";
  if (!clean.startsWith("memory/delegations/")) return "";
  const resolved = path.resolve(root, clean);
  const allowedRoot = path.resolve(root, "memory", "delegations");
  const normalizedResolved = `${resolved.toLowerCase()}${path.sep}`;
  const normalizedAllowed = `${allowedRoot.toLowerCase()}${path.sep}`;
  if (!normalizedResolved.startsWith(normalizedAllowed) && resolved.toLowerCase() !== allowedRoot.toLowerCase()) return "";
  return resolved;
}

function resolveLocalMemoryFilePath(root, relativePath) {
  const clean = String(relativePath ?? "").replaceAll("\\", "/");
  if (!clean || clean.includes("\0") || clean.startsWith("/") || /^[A-Za-z]:\//.test(clean) || clean.includes("..")) {
    return "";
  }
  const allowedStandaloneFiles = new Set([portableManifestFileName, "RESTORE.md"]);
  if (!clean.startsWith("memory/") && !allowedStandaloneFiles.has(clean)) return "";
  const resolved = path.resolve(root, clean);
  const allowedRoot = path.resolve(root);
  const normalizedResolved = `${resolved.toLowerCase()}${path.sep}`;
  const normalizedAllowed = `${allowedRoot.toLowerCase()}${path.sep}`;
  if (!normalizedResolved.startsWith(normalizedAllowed) && resolved.toLowerCase() !== allowedRoot.toLowerCase()) return "";
  return resolved;
}

function redactSecretMaterial(value) {
  return String(value ?? "")
    .replace(
      /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi,
      "[redacted-private-key]",
    )
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, "[redacted-jwt]")
    .replace(
      /(\b(?:password|passwd|pwd|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|x-api-key)\b\s*(?:=|:)\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}&\]]+)/gi,
      "$1[redacted-secret]",
    )
    .replace(/\bgithub_pat_[A-Za-z0-9_]{16,}\b/gi, "[redacted-github-token]")
    .replace(/\bghp_[A-Za-z0-9]{16,}\b/g, "[redacted-github-token]")
    .replace(/\bxox[bp]-[A-Za-z0-9-]{10,}\b/gi, "[redacted-slack-token]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]");
}

function sanitizeArtifactBody(value) {
  return redactSecretMaterial(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .slice(0, 80_000)
    .trim();
}

function createDelegationArtifactMarkdown(record, body) {
  const lines = [
    `# ${record.title}`,
    "",
    `- Kind: ${delegationArtifactKindLabel(record.artifactKind)}`,
    `- Created: ${record.createdAt}`,
    record.requestText ? `- Request: ${record.requestText}` : "",
    record.teammateName ? `- Source teammate: ${record.teammateName}` : "",
    record.sourceThreadId ? `- Source thread: ${record.sourceThreadId}` : "",
    "",
    "## Draft",
    "",
    body || "(empty draft)",
    "",
    "## Delegated Channels",
    "",
  ].filter(Boolean);
  if (record.rows.length === 0) {
    lines.push("- No delegated channel rows were captured.");
  } else {
    for (const row of record.rows) {
      lines.push(`- ${row.teammateName || row.teammateId || "AI 팀원"} · ${row.channelName || "역할"} · ${row.status || "unknown"}`);
      if (row.summary) lines.push(`  - ${row.summary}`);
    }
  }
  lines.push("", "## Safety", "");
  lines.push("- 이 파일은 로컬 기억 폴더에만 저장되는 초안 결과입니다.");
  lines.push("- 외부 발송, 제출, 일정 등록, 파일 삭제는 사용자 최종 승인 전 실행하지 않습니다.");
  lines.push("- 비밀번호, API key, 로그인 승인 원문은 이 결과에 저장하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function createDelegationArtifactsSummary(records) {
  const counts = records.reduce((acc, record) => {
    acc[record.artifactKind] = (acc[record.artifactKind] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# DelegationArtifacts",
    "",
    "역할별 AI 팀원에게 맡긴 결과를 보고서, 메일, 승인 요청 후보로 전환한 로컬 결과 인덱스입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Artifacts: ${records.length}`,
    `- Reports: ${counts.report ?? 0}`,
    `- Mail drafts: ${counts.mail ?? 0}`,
    `- Approval requests: ${counts.approval ?? 0}`,
    "",
    "## Recent Artifacts",
    "",
  ];
  for (const record of records.slice(0, 60)) {
    lines.push(`- [${delegationArtifactKindLabel(record.artifactKind)}] ${record.title} · ${record.createdAt}`);
    if (record.requestText) lines.push(`  - 요청: ${record.requestText}`);
    if (record.relativePath) lines.push(`  - 파일: ${record.relativePath}`);
    if (record.approvalDecision) {
      lines.push(`  - 승인 처리: ${delegationApprovalDecisionLabel(record.approvalDecision)} · ${record.approvalStatus || "recorded"}`);
      if (record.decisionNote) lines.push(`  - 처리 메모: ${record.decisionNote}`);
    }
    if (record.rows.length) lines.push(`  - AI 팀원: ${record.rows.map((row) => row.teammateName || row.channelName || row.teammateId).filter(Boolean).join(", ")}`);
  }
  lines.push("", "## Use Rule", "");
  lines.push("- 다음에 비슷한 요청이 오면 이 인덱스에서 결과 종류와 AI 팀원 분배 방식을 먼저 확인합니다.");
  lines.push("- 승인 요청 결과는 실행 후보일 뿐이며 앱 최종 승인 전 외부 변경을 하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function createDelegationApprovalDecisionsSummary(records) {
  const counts = records.reduce((acc, record) => {
    acc[record.decision] = (acc[record.decision] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# ApprovalDecisions",
    "",
    "승인 요청 결과에 대해 앱 안에서 사용자가 내린 승인, 수정 요청, 보류, 거절 결정을 보관하는 로컬 장부입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Decisions: ${records.length}`,
    `- Approved: ${counts.approved ?? 0}`,
    `- Change requested: ${counts.change_requested ?? 0}`,
    `- Held: ${counts.held ?? 0}`,
    `- Rejected: ${counts.rejected ?? 0}`,
    "",
    "## 오피스 승인함 결정",
    "",
    "오피스 승인함에서 사용자가 남긴 승인, 수정 요청, 보류, 거절 결정을 같은 결과 기준으로 이어받습니다.",
    "",
    "## Recent Decisions",
    "",
  ];
  for (const record of records.slice(0, 80)) {
    lines.push(`- [${delegationApprovalDecisionLabel(record.decision)}] ${record.artifactTitle || record.artifactId} · ${record.decidedAt}`);
    if (record.relativePath) lines.push(`  - 결과: ${record.relativePath}`);
    if (record.note) lines.push(`  - 메모: ${record.note}`);
    lines.push(`  - 실행 상태: ${record.status}`);
  }
  lines.push("", "## Execution Rule", "");
  lines.push("- approved_for_execution 상태도 즉시 외부 발송을 의미하지 않습니다. 실제 메일 발송, 일정 등록, 파일 삭제는 별도 실행 단계에서 다시 확인합니다.");
  lines.push("- change_requested 상태는 같은 AI 팀원에게 수정 지시로 되돌려야 합니다.");
  lines.push("- held_for_review 상태는 오피스에서 계속 대기시키고 사용자가 다시 판단할 수 있게 둡니다.");
  lines.push("");
  return lines.join("\n");
}

function createDecisionRecordsFromDelegationApprovalDecisions(records) {
  return sanitizeDecisionRecords(
    records.map((record) => ({
      decisionMemoryId: `delegation-approval:${record.id}`,
      workItemId: record.artifactId,
      title: record.artifactTitle || "AI 팀원 승인 요청",
      sourceLabel: "업무 알림 비서 결정",
      status: record.status || delegationApprovalDecisionStatus(record.decision),
      teammateId: record.sourceTeammateId || "teammate-personal-operator",
      teammateName: record.teammateName,
      channelDecision: {
        decision: record.decision,
        channel: "업무 알림 비서",
        decidedBy: record.decidedBy || "ModyCrew Chat",
        decidedAt: record.decidedAt,
        messagePreview: record.note,
        revisionInstruction: record.decision === "change_requested" ? record.note : "",
        requiresAppReconfirm: record.decision === "approved",
      },
    })),
  );
}

function createHomeApprovalDecisionReceiptsSummary(records) {
  const counts = records.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# HomeApprovalDecisionReceipts",
    "",
    "앱 홈과 오피스에서 사용자가 내린 최근 승인, 수정 요청, 취소/보류 결정을 쉬운 말로 다시 보여주기 위한 로컬 기억입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Receipts: ${records.length}`,
    `- Saved: ${counts.saved ?? 0}`,
    `- Review: ${counts.review ?? 0}`,
    `- Blocked: ${counts.blocked ?? 0}`,
    "",
    "## Recent Receipts",
    "",
  ];
  for (const record of records.slice(0, 60)) {
    lines.push(`- [${record.label}] ${record.workTitle} · ${new Date(record.createdAt).toISOString()}`);
    lines.push(`  - 내용: ${record.title}`);
    lines.push(`  - 기록 위치: ${record.recordPath}`);
    lines.push(`  - 실행 로그: ${record.executionLogLabel}`);
    lines.push(`  - 되돌리기: ${record.undoLabel}`);
    lines.push(`  - 다음 단계: ${record.nextStep}`);
    lines.push(`  - 증거 체인: ${record.proofChainContract}`);
    lines.push(`  - 런타임 증거: ${record.runtimeEvidenceContract}`);
    lines.push(`  - 기억 제안: ${record.memorySuggestionPolicy}`);
  }
  lines.push("", "## Safety Rule", "");
  lines.push("- 이 기록은 사용자의 결정 기억입니다. 외부 발송, 일정 등록, 파일 변경, 클릭은 이 기록만으로 실행하지 않습니다.");
  lines.push("- 실제 변경 작업은 오피스 최종 확인과 실행 전 미리보기를 다시 거칩니다.");
  lines.push("");
  return lines.join("\n");
}

function createDecisionRecordsFromHomeApprovalDecisionReceipts(records) {
  return sanitizeDecisionRecords(
    records.map((record) => ({
      decisionMemoryId: `home-approval-receipt:${record.id}`,
      workItemId: record.id,
      title: record.workTitle || record.title || "최근 승인 결정",
      sourceLabel: record.sourceEvidenceContract || "오피스 최근 결정",
      status: record.status === "blocked" ? "held_for_review" : record.status === "review" ? "needs_review" : "decision_recorded",
      teammateId: record.teammateId || "teammate-personal-operator",
      teammateName: record.teammateName,
      channelDecision: {
        decision: homeReceiptDecision(record),
        channel: "ModyCrew Office",
        decidedBy: "ModyCrew Office",
        decidedAt: new Date(record.createdAt).toISOString(),
        messagePreview: `${record.label}: ${record.title} · ${record.proofChainContract}`,
        revisionInstruction: record.status === "review" ? record.nextStep : "",
        requiresAppReconfirm: true,
      },
    })),
  );
}

function createDelegationActionQueueSummary(records) {
  const counts = records.reduce((acc, record) => {
    acc[record.actionKind] = (acc[record.actionKind] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# DelegationActionQueue",
    "",
    "승인 요청 결과가 앱 안에서 처리된 뒤 다음 단계로 넘겨지는 안전 큐입니다. 이 큐는 외부 발송이나 일정 등록을 즉시 실행하지 않고, 실행 후보와 수정 큐를 분리합니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Queue items: ${records.length}`,
    `- Execution candidates: ${counts.execution_candidate ?? 0}`,
    `- Revision requests: ${counts.revision_request ?? 0}`,
    `- Review holds: ${counts.review_hold ?? 0}`,
    `- Rejected archives: ${counts.rejected_archive ?? 0}`,
    "",
    "## Recent Queue",
    "",
  ];
  for (const record of records.slice(0, 80)) {
    lines.push(`- [${delegationActionKindLabel(record.actionKind)}] ${record.artifactTitle || record.artifactId} · ${record.status}`);
    if (record.relativePath) lines.push(`  - 결과: ${record.relativePath}`);
    if (record.teammateName) lines.push(`  - 담당 AI 팀원: ${record.teammateName}`);
    if (record.note) lines.push(`  - 지시: ${record.note}`);
    if (record.actionKind === "execution_candidate") {
      lines.push("  - 다음: 실제 메일 발송, 일정 등록, 파일 변경 전 실행 확인을 한 번 더 요청합니다.");
    }
    if (record.actionKind === "revision_request") {
      lines.push("  - 다음: 담당 AI 팀원의 WorkLog/PromptMemory를 참고해 수정 초안을 다시 만듭니다.");
    }
  }
  lines.push("", "## Safety Rule", "");
  lines.push("- 이 큐의 execution_candidate는 실행 준비 상태일 뿐이며 외부 변경은 아닙니다.");
  lines.push("- 모든 외부 발송, 일정 등록, 파일 삭제, 제출은 실제 실행 핸들러에서 다시 사용자 확인을 받아야 합니다.");
  lines.push("");
  return lines.join("\n");
}

function sourceKindLabel(kind) {
  return userFacingSourceKindLabel(kind, "업무 학습");
}

function sanitizeWorkPatternMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return {};
  const output = {};
  for (const [key, value] of Object.entries(metrics).slice(0, 20)) {
    const cleanKey = sanitizeLine(key, 60);
    if (!cleanKey) continue;
    if (typeof value === "number" || typeof value === "boolean") output[cleanKey] = value;
    else if (typeof value === "string") output[cleanKey] = sanitizeLine(value, 120);
  }
  return output;
}

function sanitizeGrowthSuggestions(records) {
  return (Array.isArray(records) ? records : [])
    .map((value, index) => sanitizeGrowthSuggestion(value, index))
    .filter(Boolean)
    .slice(0, 40);
}

function sanitizeGrowthSuggestion(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const priority = sanitizeGrowthPriority(value.priority);
  return {
    id: sanitizeLine(value.id || `growth-suggestion-${index}`, 180),
    kind: sanitizeLine(value.kind || "strengthen_skill", 80),
    priority,
    skillId: sanitizeLine(value.skillId || "", 80),
    skillLabel: sanitizeLine(value.skillLabel || value.skillId || "업무 도구", 80),
    title: sanitizeLine(value.title || userFacingGrowthCandidateTitle(), 160),
    reason: sanitizeLine(value.reason || "반복 업무 패턴에서 나온 제안입니다.", 360),
    nextAction: sanitizeLine(value.nextAction || userFacingGrowthCandidateNextAction(), 280),
    evidencePatternIds: Array.isArray(value.evidencePatternIds)
      ? value.evidencePatternIds.map((line) => sanitizeLine(line, 180)).filter(Boolean).slice(0, 12)
      : [],
    connectorIds: Array.isArray(value.connectorIds)
      ? value.connectorIds.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 12)
      : [],
    assignedTeammateIds: Array.isArray(value.assignedTeammateIds)
      ? value.assignedTeammateIds.map((line) => sanitizeLine(line, 120)).filter(Boolean).slice(0, 12)
      : [],
    updatedAt: sanitizeIsoDate(value.updatedAt || new Date().toISOString()),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeGrowthPriority(value) {
  const priority = String(value ?? "").trim();
  if (priority === "high" || priority === "normal" || priority === "low") return priority;
  return "normal";
}

function sanitizeSkillSourceRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map((value, index) => sanitizeSkillSourceRecord(value, index))
    .filter(Boolean)
    .slice(0, 120);
}

function sanitizeSkillSourceRecord(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const id = sanitizeLine(value.id || `skill-source-${index}`, 100);
  if (!id) return null;
  return {
    id,
    label: sanitizeLine(value.label || value.title || id, 100),
    sourceKind: sanitizeLine(value.sourceKind || "app_builtin", 80),
    status: sanitizeLine(value.status || "available", 80),
    category: sanitizeLine(value.category || "automation", 80),
    restoreMode: sanitizeLine(value.restoreMode || "manifest_reference", 100),
    assignedTeammateIds: Array.isArray(value.assignedTeammateIds)
      ? value.assignedTeammateIds.map((line) => sanitizeLine(line, 120)).filter(Boolean).slice(0, 16)
      : [],
    connectorIds: Array.isArray(value.connectorIds)
      ? value.connectorIds.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 16)
      : [],
    externalToolHints: Array.isArray(value.externalToolHints)
      ? value.externalToolHints.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 16)
      : [],
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map((line) => sanitizeLine(line, 180)).filter(Boolean).slice(0, 8)
      : [],
    safetyBoundary: sanitizeLine(value.safetyBoundary || "사용자가 켠 뒤에만 활성화하고 secret 원문은 저장하지 않습니다.", 260),
    updatedAt: sanitizeIsoDate(value.updatedAt || new Date().toISOString()),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeSkillBootstrapPlan(value) {
  if (!value || typeof value !== "object") return null;
  return {
    schema: sanitizeLine(value.schema || "modycrew.skill-bootstrap-plan.v1", 100),
    product: sanitizeLine(value.product || "ModyCrew", 80),
    generatedAt: sanitizeIsoDate(value.generatedAt || new Date().toISOString()),
    memoryManifestPath: sanitizeLine(value.memoryManifestPath || portableManifestFileName, 180),
    restoreMode: sanitizeLine(value.restoreMode || "read_folder_then_rehydrate_app_state", 120),
    restoreOrder: sanitizeLineArray(value.restoreOrder, 16, 240),
    activeCrewKits: sanitizeSkillBootstrapCrewKits(value.activeCrewKits, true),
    recommendationCrewKits: sanitizeSkillBootstrapCrewKits(value.recommendationCrewKits, false),
    teammateChannels: sanitizeSkillBootstrapTeammateChannels(value.teammateChannels),
    externalReauthorization: sanitizeSkillBootstrapExternalReauthorization(value.externalReauthorization),
    counts: value.counts && typeof value.counts === "object"
      ? {
          activeCrewKits: Number(value.counts.activeCrewKits) || 0,
          recommendationCrewKits: Number(value.counts.recommendationCrewKits) || 0,
          teammateChannels: Number(value.counts.teammateChannels) || 0,
          externalReauthorization: Number(value.counts.externalReauthorization) || 0,
          manifestSkillSources: Number(value.counts.manifestSkillSources) || 0,
        }
      : {},
    safety: sanitizeLineArray(value.safety, 12, 240),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeSkillBootstrapCrewKits(value, active = false) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = sanitizeLine(item.id, 80);
      if (!id) return null;
      return {
        id,
        label: sanitizeLine(item.label || id, 120),
        category: sanitizeLine(item.category, 80),
        assignedTeammateIds: Array.isArray(item.assignedTeammateIds)
          ? item.assignedTeammateIds.map((line) => sanitizeLine(line, 120)).filter(Boolean).slice(0, 16)
          : [],
        connectorIds: Array.isArray(item.connectorIds)
          ? item.connectorIds.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 16)
          : [],
        restoreAction: sanitizeLine(item.restoreAction || (active ? "enable_without_secret" : "show_as_recommendation"), 100),
        safety: sanitizeLine(item.safety || "secret 원문 없이 설정만 복원합니다.", 240),
      };
    })
    .filter(Boolean)
    .slice(0, active ? 40 : 80);
}

function sanitizeSkillBootstrapTeammateChannels(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = sanitizeLine(item.id, 80);
      if (!id) return null;
      return {
        id,
        avatarId: sanitizeLine(item.avatarId, 64),
        name: sanitizeLine(item.name || id, 80),
        channelName: sanitizeLine(item.channelName || "팀원 대화", 100),
        teamLabel: sanitizeLine(item.teamLabel, 80),
        roleTitle: sanitizeLine(item.roleTitle, 120),
        skillIds: Array.isArray(item.skillIds)
          ? item.skillIds.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 24)
          : [],
        crewSoulPath: sanitizeLine(item.crewSoulPath, 240),
        promptMemoryPath: sanitizeLine(item.promptMemoryPath, 240),
      };
    })
    .filter(Boolean)
    .slice(0, 60);
}

function sanitizeSkillBootstrapExternalReauthorization(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const skillId = sanitizeLine(item.skillId || item.id, 80);
      if (!skillId) return null;
      return {
        skillId,
        label: sanitizeLine(item.label || skillId, 120),
        connectorIds: Array.isArray(item.connectorIds)
          ? item.connectorIds.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 16)
          : [],
        externalToolHints: Array.isArray(item.externalToolHints)
          ? item.externalToolHints.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 16)
          : [],
        requiredUserStep: sanitizeLine(item.requiredUserStep || "새 PC에서 다시 승인합니다.", 220),
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    })
    .filter(Boolean)
    .slice(0, 80);
}

function priorityRank(priority) {
  if (priority === "high") return 0;
  if (priority === "normal") return 1;
  return 2;
}

function sanitizeDecision(value) {
  const decision = String(value ?? "").trim();
  if (decision === "approved") return "approved";
  if (decision === "change_requested") return "change_requested";
  if (decision === "held") return "held";
  if (decision === "rejected") return "rejected";
  return "";
}

function sanitizeHomeApprovalDecisionReceiptSource(value) {
  const source = String(value ?? "").trim();
  if (
    source === "mailops" ||
    source === "local_file" ||
    source === "local_file_pattern" ||
    source === "final_confirmation" ||
    source === "browser_task"
  ) {
    return source;
  }
  return "mailops";
}

function sanitizeHomeApprovalDecisionReceiptStatus(value) {
  const status = String(value ?? "").trim();
  if (status === "blocked" || status === "review") return status;
  return "saved";
}

function homeReceiptDecision(record) {
  if (record.status === "blocked") return "held";
  if (record.status === "review" || /수정 요청/u.test(record.label || record.title || "")) return "change_requested";
  return "approved";
}

function decisionLabel(decision) {
  if (decision === "approved") return "승인";
  if (decision === "change_requested") return "수정 요청";
  if (decision === "held") return "보류";
  if (decision === "rejected") return "거절";
  return "결정";
}

function sanitizeAppProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const teammates = Array.isArray(profile.teammates)
    ? profile.teammates.slice(0, 50).map(sanitizeTeammateProfile).filter(Boolean)
    : [];
  const skills = Array.isArray(profile.skills)
    ? profile.skills.slice(0, 80).map(sanitizeSkillProfile).filter(Boolean)
    : [];
  const activeSkillIds = Array.isArray(profile.activeSkillIds)
    ? profile.activeSkillIds.map((id) => sanitizeLine(id, 80)).filter(Boolean).slice(0, 80)
    : [];
  const messengerChannels = Array.isArray(profile.messengerChannels)
    ? profile.messengerChannels.slice(0, 40).map(sanitizeMessengerChannelProfile).filter(Boolean)
    : [];
  const activeMessengerChannelIds = Array.isArray(profile.activeMessengerChannelIds)
    ? profile.activeMessengerChannelIds.map((id) => sanitizeLine(id, 80)).filter(Boolean).slice(0, 40)
    : [];
  return {
    version: Number(profile.version) || 1,
    updatedAt: sanitizeIsoDate(profile.updatedAt || new Date().toISOString()),
    teammates,
    skills,
    activeSkillIds,
    messengerChannels,
    activeMessengerChannelIds,
    appSettings: profile.appSettings && typeof profile.appSettings === "object"
      ? {
          activeTeammateId: sanitizeLine(profile.appSettings.activeTeammateId, 120),
          theme: sanitizeLine(profile.appSettings.theme, 20),
          assistantDisplayName: sanitizeLine(profile.appSettings.assistantDisplayName, 80),
          userDisplayName: sanitizeLine(profile.appSettings.userDisplayName, 80),
          userCallName: sanitizeLine(profile.appSettings.userCallName, 80),
          mainControllerId: sanitizeLine(profile.appSettings.mainControllerId, 120),
          mainControllerName: sanitizeLine(profile.appSettings.mainControllerName, 80),
          mainControllerChannelName: sanitizeLine(profile.appSettings.mainControllerChannelName, 120),
        }
      : {},
  };
}

function sanitizeMessengerChannelProfile(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeLine(value.id, 80),
    kind: sanitizeLine(value.kind, 40),
    label: sanitizeLine(value.label, 80),
    connectorId: sanitizeLine(value.connectorId, 80),
    status: sanitizeLine(value.status, 40),
    summary: sanitizeLine(value.summary, 260),
    setupHint: sanitizeLine(value.setupHint, 260),
    commandExamples: Array.isArray(value.commandExamples)
      ? value.commandExamples.map((line) => sanitizeLine(line, 100)).filter(Boolean).slice(0, 12)
      : [],
    safetyBoundary: sanitizeLine(value.safetyBoundary, 260),
  };
}

function sanitizeTeammateProfile(value) {
  if (!value || typeof value !== "object") return null;
  value = restoreBuiltinExpert(value);
  const originProposalId = sanitizeTeammateOriginProposalId(
    value.originProposalId,
  );
  return {
    id: sanitizeLine(value.id, 120),
    ...(getBuiltinExpert(value) ? { builtinExpertId: getBuiltinExpert(value).id, promptVersion: value.promptVersion } : {}),
    templateId: sanitizeLine(value.templateId, 60),
    avatarId: sanitizeLine(value.avatarId, 64),
    name: sanitizeLine(value.name, 60),
    teamLabel: sanitizeLine(value.teamLabel, 60),
    roleTitle: sanitizeLine(value.roleTitle, 120),
    channelName: sanitizeLine(value.channelName, 120),
    brief: sanitizeLine(value.brief, 300),
    skillIds: Array.isArray(value.skillIds)
      ? value.skillIds.map((id) => sanitizeLine(id, 80)).filter(Boolean).slice(0, 24)
      : [],
    // 이 직원이 맡기로 한 업무 범위. 사용자가 직원을 만들 때 고른 값이며,
    // 업무 배정 권한의 근거가 되므로 정규 목록에 있는 것만 통과시킨다.
    workPackIds: Array.isArray(value.workPackIds)
      ? [
          ...new Set(
            value.workPackIds
              .map((workPackId) => sanitizeLine(workPackId, 60))
              .filter((workPackId) => workspaceIntelligenceWorkPackIds.has(workPackId)),
          ),
        ].sort()
      : [],
    instructions: Array.isArray(value.instructions)
      ? value.instructions.map((line) => sanitizeLine(line, 220)).filter(Boolean).slice(0, 20)
      : [],
    ...(originProposalId ? { originProposalId } : {}),
    createdAt: Number(value.createdAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}

function sanitizeTeammateOriginProposalId(value) {
  const proposalId = sanitizeLine(value, 240);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(proposalId)
    ? proposalId
    : "";
}

function sanitizeSkillProfile(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeLine(value.id, 80),
    title: sanitizeLine(value.title, 80),
    category: sanitizeLine(value.category, 40),
    summary: sanitizeLine(value.summary, 260),
    crewKitLabel: sanitizeLine(value.crewKitLabel, 80),
    installHint: sanitizeLine(value.installHint, 320),
    connectorIds: Array.isArray(value.connectorIds)
      ? value.connectorIds.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 16)
      : [],
    externalToolHints: Array.isArray(value.externalToolHints)
      ? value.externalToolHints.map((line) => sanitizeLine(line, 80)).filter(Boolean).slice(0, 16)
      : [],
    activationSteps: Array.isArray(value.activationSteps)
      ? value.activationSteps.map((line) => sanitizeLine(line, 140)).filter(Boolean).slice(0, 12)
      : [],
    fallbackRoutes: Array.isArray(value.fallbackRoutes)
      ? value.fallbackRoutes.map((line) => sanitizeLine(line, 140)).filter(Boolean).slice(0, 12)
      : [],
    recommendedTeam: sanitizeLine(value.recommendedTeam, 60),
    triggerKeywords: Array.isArray(value.triggerKeywords)
      ? value.triggerKeywords.map((line) => sanitizeLine(line, 60)).filter(Boolean).slice(0, 24)
      : [],
    instructions: Array.isArray(value.instructions)
      ? value.instructions.map((line) => sanitizeLine(line, 220)).filter(Boolean).slice(0, 20)
      : [],
  };
}

function sanitizeLine(value, maxLength) {
  return redactSecretMaterial(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function createDecisionMemorySummary(records) {
  const recent = records.slice(0, 40);
  const totals = recent.reduce(
    (acc, record) => {
      acc[record.decision] = (acc[record.decision] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const lines = [
    "# DecisionMemory",
    "",
    "메신저와 앱에서 들어온 승인, 수정 요청, 보류, 거절 의사를 업무 기억으로 압축한 장부입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Decisions: ${records.length}`,
    `- Approved: ${totals.approved ?? 0}`,
    `- Change requested: ${totals.change_requested ?? 0}`,
    `- Held: ${totals.held ?? 0}`,
    `- Rejected: ${totals.rejected ?? 0}`,
    "",
    "## Recent Decisions",
    "",
  ];
  for (const record of recent) {
    lines.push(
      `- [${record.decisionLabel}] ${record.title} · ${record.channel} · ${record.decidedAt}` +
        (record.requiresAppReconfirm ? " · 앱 최종 확인 필요" : ""),
    );
    if (record.sourceLabel) lines.push(`  - 근거: ${record.sourceLabel}`);
    if (record.messagePreview) lines.push(`  - 채널 답장: ${record.messagePreview}`);
    if (record.revisionInstruction) lines.push(`  - 수정 지시: ${record.revisionInstruction}`);
  }
  lines.push("", "## Operating Rule", "");
  lines.push("- 채널 답장은 의사 기록이며 외부 발송, 일정 등록, 파일 변경은 앱 최종 확인 전 실행하지 않습니다.");
  lines.push("- 반복되는 수정 요청과 보류 이유는 역할별 AI 팀원 업무 방식과 결정 기록에 함께 반영합니다.");
  lines.push("- 계정 비밀번호, API key, 로그인 승인 원문은 결정 기록에 저장하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function writeTeammateDecisionLogs(root, records) {
  const grouped = new Map();
  for (const record of records) {
    const teammateId = sanitizePathSegment(record.teammateId || "teammate-personal-operator");
    const list = grouped.get(teammateId) ?? [];
    list.push(record);
    grouped.set(teammateId, list);
  }
  for (const [teammateId, list] of grouped) {
    const folder = path.join(root, "memory", "crew-souls", teammateId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "DecisionLog.md"), createTeammateDecisionLogSummary(list), "utf8");
  }
}

function createTeammateDecisionLogSummary(records) {
  const first = records[0];
  const lines = [
    `# DecisionLog: ${first?.teammateName || first?.teammateId || "AI 팀원"}`,
    "",
    "이 AI 팀원에게 연결된 업무 결정 히스토리입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Decisions: ${records.length}`,
    "",
    "## Recent Decisions",
    "",
  ];
  for (const record of records.slice(0, 60)) {
    lines.push(`- [${record.decisionLabel}] ${record.title} · ${record.sourceLabel} · ${record.decidedAt}`);
    if (record.messagePreview) lines.push(`  - 채널 답장: ${record.messagePreview}`);
    if (record.revisionInstruction) lines.push(`  - 수정 지시: ${record.revisionInstruction}`);
  }
  lines.push("", "## How To Use", "");
  lines.push("- 같은 업무가 반복되면 승인 후보 문구, 일정 후보, 답장 톤을 이 결정 이력에 맞춰 조정합니다.");
  lines.push("- 보류/거절이 반복되는 조건은 다음 자동화 후보에서 더 보수적으로 제안합니다.");
  lines.push("");
  return lines.join("\n");
}

function writeWorkPatternMemories(root, records) {
  const folder = path.join(root, "memory", "work-patterns");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "WorkPatternMemory.md"), createWorkPatternMemorySummary(records), "utf8");
  writeTeammateWorkLogs(root, records);
  writeCrewKitPromptMemoryFiles(root, records);
}

function writeLearningSourceSummary(root, learningSources) {
  const folder = path.join(root, "memory", "documents");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "LearningSources.md"), createLearningSourceSummary(learningSources), "utf8");
}

function createLearningSourceSummary(learningSources) {
  const active = learningSources.filter((source) => source.status !== "removed");
  const lines = [
    "# LearningSources",
    "",
    "사용자가 직접 선택한 업무 자료 폴더/드라이브 출처 목록입니다. 원본 파일은 이동하거나 삭제하지 않고, 읽기와 인덱싱 후보로만 사용합니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Sources: ${learningSources.length}`,
    `- Active: ${active.length}`,
    `- Files seen: ${learningSources.reduce((sum, source) => sum + Number(source.fileCount || 0), 0)}`,
    "",
    "## Sources",
    "",
  ];
  if (!learningSources.length) {
    lines.push("- 아직 선택된 업무 자료 출처가 없습니다.");
  }
  for (const source of learningSources.slice(0, 80)) {
    lines.push(`- ${source.label} · ${source.sourceKind} · ${source.fileCount} files`);
    lines.push(`  - Path: ${source.path}`);
    lines.push(`  - Last scanned: ${source.lastScannedAt}`);
    lines.push("  - Safety: 원본 이동/삭제 없음, secret 원문 저장 없음");
    if (source.lastSummary) lines.push(`  - Summary: ${source.lastSummary}`);
  }
  lines.push("", "## Use Rule", "");
  lines.push("- 사용자가 자료 분석, 보고서, 메일, 정리 요청을 하면 이 출처 목록에서 먼저 읽을 범위를 제안합니다.");
  lines.push("- 대량 폴더는 전체 원문을 한 번에 답변에 넣지 않고 인덱스/요약/샘플부터 사용합니다.");
  lines.push("- 출처 삭제는 장부에서만 제거하며 원본 폴더와 파일은 삭제하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function writeWorkspaceKnowledgeImportSummary(root, sources, input = {}) {
  const folder = path.join(root, "memory", "documents");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, "WorkspaceKnowledgeImport.md"),
    createWorkspaceKnowledgeImportSummary(sources, input),
    "utf8",
  );
}

function createWorkspaceKnowledgeImportSummary(sources, input = {}) {
  const counts = sources.reduce((acc, source) => {
    acc[source.sourceKind] = (acc[source.sourceKind] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# WorkspaceKnowledgeImport",
    "",
    "Google Sheets, Slack, Notion, 로컬 폴더처럼 회사에서 쓰던 자료를 사용자가 직접 고른 범위만 학습 대상으로 남기는 import 장부입니다.",
    "",
    `- Imported: ${input.importedAt || new Date().toISOString()}`,
    `- Teammate: ${input.teammateName || input.teammateId || "업무 비서"}`,
    `- Sources: ${sources.length}`,
    `- Google Sheets: ${counts.google_sheets ?? 0}`,
    `- Slack: ${counts.slack ?? 0}`,
    `- Notion: ${counts.notion ?? 0}`,
    `- Local folders: ${counts.folder ?? 0}`,
    "",
    "## Summary",
    "",
    input.summary || "선택한 회사 자료 출처를 자료 학습 기억으로 연결했습니다.",
    "",
    "## Sources",
    "",
  ];
  if (!sources.length) lines.push("- 아직 import한 회사 자료 출처가 없습니다.");
  for (const source of sources.slice(0, 80)) {
    lines.push(`- ${source.label} · ${source.sourceKind}`);
    lines.push(`  - Reference: ${source.path}`);
    lines.push(`  - Files/items seen: ${source.fileCount}`);
    if (source.lastSummary) lines.push(`  - Summary: ${source.lastSummary}`);
    lines.push("  - Safety: 원본 변경 없음, secret 원문 저장 없음, 쓰기 작업은 승인 후 후보로만 처리");
  }
  lines.push("", "## Import Signals", "");
  for (const signal of input.signals ?? []) lines.push(`- ${signal}`);
  lines.push("", "## Next Review", "");
  lines.push("- 대량 자료는 전체 원문을 한 번에 답변에 넣지 않고 출처별 인덱스와 샘플 요약부터 사용합니다.");
  lines.push("- 보고서, 메일, 운영관리, 다음 할 일 추천은 WorkPatternMemory와 PromptMemory에서 이 import 장부를 먼저 확인합니다.");
  lines.push("- Google Sheets/Slack/Notion live connector가 준비되면 같은 source id를 유지하고 OAuth/권한 재확인만 추가합니다.");
  lines.push("");
  return lines.join("\n");
}

function createWorkPatternMemorySummary(records) {
  const counts = records.reduce((acc, record) => {
    acc[record.sourceKind] = (acc[record.sourceKind] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# WorkPatternMemory",
    "",
    "메일 분석, 연결 복구, 자료 학습, 폴더 정리, 문서 작성, 내 PC 작업 결과에서 재사용할 업무 방식을 압축한 기억입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Patterns: ${records.length}`,
    `- MailOps: ${counts.mailops ?? 0}`,
    `- Connector Recovery: ${counts.connector_recovery ?? 0}`,
    `- Documents: ${(counts.document_learning ?? 0) + (counts.document_writer ?? 0)}`,
    `- Tidy: ${counts.folder_plan ?? 0}`,
    `- Desktop Control: ${counts.desktop_control ?? 0}`,
    "",
    "## Recent Patterns",
    "",
  ];
  for (const record of records.slice(0, 60)) {
    lines.push(`- [${sourceKindLabel(record.sourceKind)}] ${record.summary || record.sourceLabel}`);
    if (record.teammateName) lines.push(`  - 담당: ${record.teammateName}`);
    for (const signal of record.signals.slice(0, 4)) lines.push(`  - ${signal}`);
    for (const artifactPath of record.artifactPaths.slice(0, 2)) lines.push(`  - 근거 파일: ${artifactPath}`);
  }
  lines.push("", "## Use Rule", "");
  lines.push("- 다음 답변에서는 사용자의 업무 방식, 문서 양식, 메일 처리 패턴을 이 기억에서 먼저 확인합니다.");
  lines.push("- 원본 파일 내용이나 secret 원문을 답변에 직접 노출하지 않고 필요한 요약과 경로만 사용합니다.");
  lines.push("- 파일 이동, 삭제, 외부 발송, 일정 등록은 항상 승인 전에는 후보로만 둡니다.");
  lines.push("");
  return lines.join("\n");
}

function writeTeammateWorkLogs(root, records) {
  const grouped = new Map();
  for (const record of records) {
    const teammateId = sanitizePathSegment(record.teammateId || "teammate-personal-operator");
    const list = grouped.get(teammateId) ?? [];
    list.push(record);
    grouped.set(teammateId, list);
  }
  for (const [teammateId, list] of grouped) {
    const folder = path.join(root, "memory", "crew-souls", teammateId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "WorkLog.md"), createTeammateWorkLogSummary(list), "utf8");
  }
}

function createTeammateWorkLogSummary(records) {
  const first = records[0];
  const counts = records.reduce((acc, record) => {
    acc[record.sourceKind] = (acc[record.sourceKind] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    `# WorkLog: ${first?.teammateName || first?.teammateId || "AI 팀원"}`,
    "",
    "이 AI 팀원이 실제로 위임받거나 학습한 업무 흐름입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Records: ${records.length}`,
    `- Delegations: ${counts.channel_delegation ?? 0}`,
    `- MailOps: ${counts.mailops ?? 0}`,
    `- Connector Recovery: ${counts.connector_recovery ?? 0}`,
    `- Documents: ${(counts.document_learning ?? 0) + (counts.document_writer ?? 0)}`,
    `- Tidy: ${counts.folder_plan ?? 0}`,
    `- Desktop Control: ${counts.desktop_control ?? 0}`,
    "",
    "## Recent Work",
    "",
  ];
  for (const record of records.slice(0, 60)) {
    lines.push(`- [${sourceKindLabel(record.sourceKind)}] ${record.summary || record.sourceLabel}`);
    lines.push(`  - Learned: ${record.learnedAt}`);
    if (record.sourceLabel) lines.push(`  - Source: ${record.sourceLabel}`);
    for (const signal of record.signals.slice(0, 4)) lines.push(`  - ${signal}`);
    for (const artifactPath of record.artifactPaths.slice(0, 2)) lines.push(`  - 근거 파일: ${artifactPath}`);
  }
  lines.push("", "## How To Use", "");
  lines.push("- 메인 컨트롤에서 이 채널로 위임한 업무는 같은 방식의 다음 요청을 더 빠르게 분류하는 근거로 사용합니다.");
  lines.push("- 각 AI 팀원의 대화와 실행 기록을 섞지 않습니다.");
  lines.push("- 이 기록은 실행 증거와 요약만 저장하며 비밀번호, token, API key 원문은 저장하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function createTeammatePromptMemorySeed(teammate, profile) {
  const lines = [
    `# PromptMemory: ${teammate.name || teammate.id || "AI 팀원"}`,
    "",
    "이 AI 팀원이 답변 직전에 먼저 읽는 짧은 업무 방식 기억입니다.",
    "",
    `- Channel: ${teammate.channelName || "팀원 대화"}`,
    `- Team: ${teammate.teamLabel || "Control"}`,
    `- Role: ${teammate.roleTitle || "업무 역할"}`,
    `- Updated: ${profile.updatedAt || new Date().toISOString()}`,
    "",
    "## Mission",
    "",
    teammate.brief || "사용자가 맡긴 업무를 역할 범위 안에서 처리합니다.",
    "",
    "## Operating Instructions",
    "",
  ];
  for (const instruction of teammate.instructions ?? []) lines.push(`- ${instruction}`);
  lines.push("", "## Restore Rule", "");
  lines.push("- 새 PC에서는 CrewChannelIndex와 이 파일을 읽어 같은 AI 팀원을 복원합니다.");
  lines.push("- WorkLog와 DecisionLog가 쌓이면 이 짧은 기억이 더 구체적으로 갱신됩니다.");
  lines.push("- secret 원문, 비밀번호, OAuth token, API key는 이 파일에 저장하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function createTeammateWorkLogSeed(teammate, records = []) {
  if (records.length) {
    return createTeammateWorkLogSummary(
      records.map((record) => ({
        ...record,
        teammateId: record.teammateId || teammate.id,
        teammateName: record.teammateName || teammate.name,
      })),
    );
  }
  const lines = [
    `# WorkLog: ${teammate.name || teammate.id || "AI 팀원"}`,
    "",
    "이 AI 팀원이 실제로 위임받거나 학습한 업무 흐름입니다.",
    "",
    `- Channel: ${teammate.channelName || "팀원 대화"}`,
    `- Updated: ${new Date().toISOString()}`,
    "- Records: 0",
    "",
    "## Recent Work",
    "",
    "- 아직 이 AI 팀원에게 위임되거나 학습된 업무가 없습니다.",
    "",
    "## How To Use",
    "",
    "- 메인 컨트롤에서 이 채널로 맡긴 업무는 이후 같은 종류의 요청을 더 빠르게 분류하는 근거로 사용합니다.",
    "- 각 AI 팀원의 대화와 실행 기록을 섞지 않습니다.",
    "- 실행 증거와 요약만 저장하며 비밀번호, token, API key 원문은 저장하지 않습니다.",
    "",
  ];
  return lines.join("\n");
}

function createTeammateDecisionLogSeed(teammate, records = []) {
  if (records.length) {
    return createTeammateDecisionLogSummary(
      records.map((record) => ({
        ...record,
        teammateId: record.teammateId || teammate.id,
        teammateName: record.teammateName || teammate.name,
      })),
    );
  }
  const lines = [
    `# DecisionLog: ${teammate.name || teammate.id || "AI 팀원"}`,
    "",
    "이 AI 팀원에게 연결된 업무 결정 히스토리입니다.",
    "",
    `- Channel: ${teammate.channelName || "팀원 대화"}`,
    `- Updated: ${new Date().toISOString()}`,
    "- Decisions: 0",
    "",
    "## Recent Decisions",
    "",
    "- 아직 승인, 수정 요청, 보류, 거절 기록이 없습니다.",
    "",
    "## How To Use",
    "",
    "- 같은 업무가 반복되면 승인 후보 문구, 일정 후보, 답장 톤을 이 결정 이력에 맞춰 조정합니다.",
    "- 외부 발송, 일정 등록, 파일 이동/삭제는 최종 승인 전에는 실행하지 않습니다.",
    "",
  ];
  return lines.join("\n");
}

function writeCrewKitPromptMemoryFiles(root, records) {
  const folder = path.join(root, "memory", "prompt", "crewkit");
  mkdirSync(folder, { recursive: true });
  const groups = {
    MailOpsPromptMemory: records.filter((record) => record.sourceKind === "mailops"),
    WriterPromptMemory: records.filter((record) =>
      record.sourceKind === "document_learning" || record.sourceKind === "document_writer",
    ),
    TidyPromptMemory: records.filter((record) => record.sourceKind === "folder_plan"),
    DesktopControlPromptMemory: records.filter((record) => record.sourceKind === "desktop_control"),
  };
  for (const [name, groupRecords] of Object.entries(groups)) {
    writeFileSync(
      path.join(folder, `${name}.md`),
      createCrewKitPromptMemorySummary(name, groupRecords),
      "utf8",
    );
  }
}

function createCrewKitPromptMemorySummary(name, records) {
  const title =
    name === "MailOpsPromptMemory"
      ? "MailOps PromptMemory"
      : name === "TidyPromptMemory"
        ? "Tidy PromptMemory"
        : name === "DesktopControlPromptMemory"
          ? "Desktop Control PromptMemory"
          : "Writer PromptMemory";
  const lines = [
    `# ${title}`,
    "",
    "CrewKit 실행 결과에서 다음 실행 직전에 읽을 짧은 업무 패턴입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Patterns: ${records.length}`,
    "",
    "## Learned Defaults",
    "",
  ];
  if (!records.length) {
    lines.push("- 아직 이 CrewKit에서 저장된 업무 패턴이 없습니다.");
  }
  for (const record of records.slice(0, 20)) {
    lines.push(`- ${record.summary || record.sourceLabel}`);
    for (const signal of record.signals.slice(0, 3)) lines.push(`  - ${signal}`);
  }
  lines.push("", "## Boundary", "");
  lines.push("- secret 원문은 읽지 않습니다.");
  lines.push("- 외부 변경은 승인 후보로만 만들고 즉시 실행하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function createAppProfileSummary(profile) {
  const lines = [
    "# ModyCrew App Profile",
    "",
    `- Updated: ${profile.updatedAt}`,
    `- AI teammates: ${profile.teammates?.length ?? 0}`,
    `- Skills: ${profile.skills?.length ?? 0}`,
    `- Active skills: ${profile.activeSkillIds?.length ?? 0}`,
    "",
    "## AI Teammates",
    "",
  ];
  for (const teammate of profile.teammates ?? []) {
    lines.push(`- ${teammate.name} · ${teammate.channelName} · ${teammate.roleTitle}`);
  }
  lines.push("", "## Active Skills", "");
  for (const skillId of profile.activeSkillIds ?? []) {
    const skill = (profile.skills ?? []).find((candidate) => candidate.id === skillId);
    lines.push(`- ${skill?.title ?? skillId}`);
  }
  lines.push("");
  return lines.join("\n");
}

function createCrewSoulSummary(profile) {
  const activeChannels = new Set(profile.activeMessengerChannelIds ?? []);
  const lines = [
    "# CrewSoul",
    "",
    "ModyCrew가 이 컴퓨터에서 이어받아야 하는 앱 정체성, 팀원, 스킬, 채널 기억입니다.",
    "",
    `- Updated: ${profile.updatedAt}`,
    `- AI teammates: ${profile.teammates?.length ?? 0}`,
    `- Active skills: ${profile.activeSkillIds?.length ?? 0}`,
    `- Active messenger channels: ${profile.activeMessengerChannelIds?.length ?? 0}`,
    profile.appSettings?.assistantDisplayName ? `- Assistant name: ${profile.appSettings.assistantDisplayName}` : "",
    profile.appSettings?.userDisplayName || profile.appSettings?.userCallName
      ? `- User call name: ${profile.appSettings.userCallName || profile.appSettings.userDisplayName}`
      : "",
    profile.appSettings?.mainControllerName || profile.appSettings?.mainControllerChannelName
      ? `- Main controller: ${profile.appSettings.mainControllerName || "업무 비서"} · ${profile.appSettings.mainControllerChannelName || "메인 컨트롤"}`
      : "",
    "",
    "## Main Control",
    "",
    "- 앱 안의 메인 컨트롤 채널이 기본 지휘 채널입니다.",
    "- 외부 메신저는 보고와 승인 의사 기록을 돕고, 실제 외부 실행은 앱 최종 확인을 거칩니다.",
    "",
    "## Channels",
    "",
  ];
  for (const channel of profile.messengerChannels ?? []) {
    lines.push(`- ${activeChannels.has(channel.id) ? "[active]" : "[available]"} ${channel.label}: ${channel.summary}`);
  }
  lines.push("", "## Crew Members", "");
  for (const teammate of profile.teammates ?? []) {
    lines.push(`- ${teammate.name} (${teammate.channelName}): ${teammate.roleTitle}`);
  }
  lines.push("");
  return lines.join("\n");
}

function writeTeammateCrewSouls(root, profile) {
  const workPatterns = sanitizeWorkPatternRecords(readJsonArray(path.join(root, workPatternLedgerRelativePath)));
  const decisions = sanitizeDecisionRecords(readJsonArray(path.join(root, decisionLedgerRelativePath)));
  for (const teammate of profile.teammates ?? []) {
    const folderName = sanitizePathSegment(teammate.id || teammate.name || "teammate");
    const teammateFolder = path.join(root, "memory", "crew-souls", folderName);
    const teammateWorkPatterns = selectTeammateWorkPatterns(teammate, workPatterns);
    const teammateDecisions = selectTeammateDecisions(teammate, decisions);
    mkdirSync(teammateFolder, { recursive: true });
    writeFileSync(
      path.join(teammateFolder, "CrewSoul.md"),
      createTeammateCrewSoulSummary(teammate, profile, workPatterns, decisions),
      "utf8",
    );
    writeFileSync(
      path.join(teammateFolder, "PromptMemory.md"),
      createTeammatePromptMemorySeed(teammate, profile),
      "utf8",
    );
    writeFileSync(
      path.join(teammateFolder, "WorkLog.md"),
      createTeammateWorkLogSeed(teammate, teammateWorkPatterns),
      "utf8",
    );
    writeFileSync(
      path.join(teammateFolder, "DecisionLog.md"),
      createTeammateDecisionLogSeed(teammate, teammateDecisions),
      "utf8",
    );
  }
}

function writeCrewChannelIndex(root, profile) {
  const folder = path.join(root, "memory", "crew-souls");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "CrewChannelIndex.md"), createCrewChannelIndexSummary(profile), "utf8");
}

function writeCrewChannelBlueprint(root, profile) {
  const folder = path.join(root, "memory", "crew-souls");
  mkdirSync(folder, { recursive: true });
  const blueprint = createCrewChannelBlueprint(profile);
  atomicWriteJson(path.join(root, crewChannelBlueprintRelativePath), blueprint);
  writeFileSync(
    path.join(root, crewChannelBlueprintSummaryRelativePath),
    createCrewChannelBlueprintSummary(blueprint),
    "utf8",
  );
  return blueprint;
}

function createCrewChannelBlueprint(profile) {
  const teammates = profile.teammates ?? [];
  const groups = [
    {
      id: "control",
      label: "Mody Control Tower",
      purpose: "사용자와 먼저 대화하고 외부 메신저와 AI 팀원을 지휘합니다.",
      teams: ["personal"],
    },
    {
      id: "product",
      label: "Product & Tech Lab",
      purpose: "제품, 개발, 도구 설치, 릴리즈, 기술 자동화 업무를 맡습니다.",
      teams: ["development"],
    },
    {
      id: "business",
      label: "Business Operations",
      purpose: "운영, 메일, 재무, 계약, 승인 후보를 업무 단위로 정리합니다.",
      teams: ["operations", "finance", "legal"],
    },
    {
      id: "growth",
      label: "Growth & Intelligence",
      purpose: "마케팅, 리서치, 콘텐츠, 성장 실험 후보를 정리합니다.",
      teams: ["marketing"],
    },
    {
      id: "custom",
      label: "직접 만든 담당자",
      purpose: "사용자가 직접 정한 이름, 직업, 성향, 맡길 일을 기준으로 독립 채널을 복원합니다.",
      teams: ["custom"],
    },
  ];
  const channels = teammates.map((teammate) => {
    const teammateId = sanitizePathSegment(teammate.id || teammate.name || "teammate");
    const group = groups.find((item) => item.teams.includes(teammate.templateId)) ?? groups[0];
    return {
      id: teammate.id || teammateId,
      groupId: group.id,
      avatarId: sanitizeLine(teammate.avatarId, 64),
      name: teammate.name || "AI 팀원",
      teamLabel: teammate.teamLabel || "Control",
      roleTitle: teammate.roleTitle || "업무 역할",
      channelName: teammate.channelName || "팀원 대화",
      brief: teammate.brief || "사용자가 맡긴 업무를 처리합니다.",
      skillIds: Array.isArray(teammate.skillIds) ? teammate.skillIds.slice(0, 24) : [],
      memoryPaths: {
        crewSoul: `memory/crew-souls/${teammateId}/CrewSoul.md`,
        promptMemory: `memory/crew-souls/${teammateId}/PromptMemory.md`,
        workLog: `memory/crew-souls/${teammateId}/WorkLog.md`,
        decisionLog: `memory/crew-souls/${teammateId}/DecisionLog.md`,
      },
      restoreRule: "팀원 대화, WorkLog, DecisionLog, PromptMemory를 섞지 않고 같은 AI 팀원으로 복원합니다.",
    };
  });
  return {
    schema: "modycrew.crew-channel-blueprint.v1",
    product: "ModyCrew",
    generatedAt: profile.updatedAt || new Date().toISOString(),
    purpose: "ModyCrew 내부 AI 팀원과 역할 구조를 폴더 이동만으로 복원하기 위한 청사진입니다.",
    groups,
    channels,
    routing: [
      "Mody Control Tower가 기본 지휘 채널입니다.",
      "외부 메신저 명령은 앱 메인 컨트롤로 들어온 뒤 역할별 채널로 분배됩니다.",
      "병렬 실행은 채널별 WorkLog와 오피스 큐에 따로 기록됩니다.",
      "외부 발송, 일정 등록, 파일 삭제, 결제, 제출은 앱 최종 승인 전 실행하지 않습니다.",
    ],
    restorePaths: {
      index: "memory/crew-souls/CrewChannelIndex.md",
      blueprint: crewChannelBlueprintRelativePath.replaceAll("\\", "/"),
      summary: crewChannelBlueprintSummaryRelativePath.replaceAll("\\", "/"),
      bundle: crewSoulBundleRelativePath.replaceAll("\\", "/"),
    },
    safety: [
      "secret 원문, 비밀번호, OAuth token, API key는 이 파일에 저장하지 않습니다.",
      "새 PC에서는 이 청사진으로 직원 탭과 채널을 복원하고 외부 계정은 다시 승인합니다.",
    ],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createCrewChannelBlueprintSummary(blueprint) {
  const lines = [
    "# CrewChannelBlueprint",
    "",
    "ModyCrew 내부 AI 팀원과 역할 구조를 복원하기 위한 청사진입니다.",
    "",
    `- Generated: ${blueprint.generatedAt}`,
    `- Groups: ${blueprint.groups.length}`,
    `- Channels: ${blueprint.channels.length}`,
    "",
    "## Groups",
    "",
  ];
  for (const group of blueprint.groups) {
    const channels = blueprint.channels.filter((channel) => channel.groupId === group.id);
    lines.push(`### ${group.label}`);
    lines.push("");
    lines.push(`- Purpose: ${group.purpose}`);
    lines.push(`- Channels: ${channels.length ? channels.map((channel) => channel.channelName).join(", ") : "아직 없음"}`);
    lines.push("");
  }
  lines.push("## Channels", "");
  for (const channel of blueprint.channels) {
    lines.push(`- ${channel.name} / ${channel.channelName}`);
    lines.push(`  - Team: ${channel.teamLabel}`);
    lines.push(`  - Role: ${channel.roleTitle}`);
    lines.push(`  - CrewSoul: ${channel.memoryPaths.crewSoul}`);
    lines.push(`  - WorkLog: ${channel.memoryPaths.workLog}`);
  }
  lines.push("", "## Restore Rule", "");
  for (const rule of blueprint.routing) lines.push(`- ${rule}`);
  lines.push("", "## Safety", "");
  for (const rule of blueprint.safety) lines.push(`- ${rule}`);
  lines.push("");
  return lines.join("\n");
}

function createCrewChannelIndexSummary(profile) {
  const activeSkillIds = new Set(profile.activeSkillIds ?? []);
  const skillMap = new Map((profile.skills ?? []).map((skill) => [skill.id, skill]));
  const lines = [
    "# CrewChannelIndex",
    "",
    "ModyCrew 내부 AI 팀원을 새 PC에서도 같은 구조로 복원하기 위한 인덱스입니다.",
    "",
    `- Updated: ${profile.updatedAt}`,
    `- Channels: ${profile.teammates?.length ?? 0}`,
    `- Active CrewKits: ${profile.activeSkillIds?.length ?? 0}`,
    "",
    "## Routing Rule",
    "",
    "- 메인 컨트롤 채널이 기본 지휘 채널입니다.",
    "- 사용자가 팀별, 병렬, 맡겨, 분배 같은 요청을 하면 역할별 채널로 나누어 기록합니다.",
    "- 각 채널의 대화, WorkLog, DecisionLog, PromptMemory는 섞지 않습니다.",
    "- 외부 발송, 일정 등록, 파일 삭제, 결제, 제출은 AI 팀원 답변만으로 실행하지 않고 앱 최종 승인에서만 실행합니다.",
    "",
    "## Channels",
    "",
  ];
  for (const teammate of profile.teammates ?? []) {
    const folderName = sanitizePathSegment(teammate.id || teammate.name || "teammate");
    const teammateSkills = (teammate.skillIds ?? [])
      .map((skillId) => {
        const skill = skillMap.get(skillId);
        const state = activeSkillIds.has(skillId) ? "active" : "available";
        return `${skill?.crewKitLabel || skill?.title || skillId} (${state})`;
      })
      .join(", ");
    lines.push(`### ${teammate.name || teammate.id}`);
    lines.push("");
    lines.push(`- Team: ${teammate.teamLabel || "Control"}`);
    lines.push(`- Role: ${teammate.roleTitle || "업무 역할"}`);
    lines.push(`- Channel: ${teammate.channelName || "팀원 대화"}`);
    lines.push(`- Brief: ${teammate.brief || "사용자 업무를 처리합니다."}`);
    lines.push(`- CrewKits: ${teammateSkills || "기본"}`);
    lines.push(`- CrewSoul: memory/crew-souls/${folderName}/CrewSoul.md`);
    lines.push(`- PromptMemory: memory/crew-souls/${folderName}/PromptMemory.md`);
    lines.push(`- WorkLog: memory/crew-souls/${folderName}/WorkLog.md`);
    lines.push(`- DecisionLog: memory/crew-souls/${folderName}/DecisionLog.md`);
    lines.push("");
  }
  lines.push("## Restore Rule", "");
  lines.push("- 새 PC에서는 이 파일을 읽어 내부 AI 팀원 목록과 역할을 다시 구성합니다.");
  lines.push("- secret 원문은 포함하지 않으며 외부 계정은 새 PC에서 다시 승인합니다.");
  lines.push("");
  return lines.join("\n");
}

function writeCrewKitMemory(root, profile) {
  const crewKitFolder = path.join(root, "memory", "crew-kits");
  mkdirSync(crewKitFolder, { recursive: true });
  const records = createCrewKitRecords(profile);
  atomicWriteJson(path.join(crewKitFolder, "crew-kits.json"), records);
  writeFileSync(path.join(crewKitFolder, "CrewKitIndex.md"), createCrewKitIndexSummary(profile, records), "utf8");
  for (const record of records) {
    const skillFolder = path.join(crewKitFolder, sanitizePathSegment(record.id));
    mkdirSync(skillFolder, { recursive: true });
    writeFileSync(path.join(skillFolder, "CrewKit.md"), createCrewKitSummary(record), "utf8");
  }
  return records;
}

function writePortableMemoryBundle(
  root,
  profile,
  crewKitRecords = createCrewKitRecords(profile),
  workspaceSkillLifecycleDisplay = undefined,
) {
  writeGrowthMemory(root, profile, crewKitRecords);
  writeTeammateCrewSouls(root, profile);
  writeCrewChannelIndex(root, profile);
  writeCrewChannelBlueprint(root, profile);
  let manifest = createPortableManifest(
    profile,
    crewKitRecords,
    root,
    workspaceSkillLifecycleDisplay,
  );
  writeSkillBootstrapPlan(root, profile, crewKitRecords, manifest);
  manifest = createPortableManifest(
    profile,
    crewKitRecords,
    root,
    workspaceSkillLifecycleDisplay,
  );
  writeCrewSoulBundle(root, profile, crewKitRecords, manifest);
  manifest = createPortableManifest(
    profile,
    crewKitRecords,
    root,
    workspaceSkillLifecycleDisplay,
  );
  atomicWriteJson(path.join(root, portableManifestFileName), manifest);
  writeFileSync(path.join(root, "RESTORE.md"), createPortableRestoreGuide(profile, manifest), "utf8");
  return manifest;
}

function writeCrewSoulBundle(root, profile, crewKitRecords, manifest) {
  const workPatterns = sanitizeWorkPatternRecords(readJsonArray(path.join(root, workPatternLedgerRelativePath)));
  const decisions = sanitizeDecisionRecords(readJsonArray(path.join(root, decisionLedgerRelativePath)));
  const bundle = createCrewSoulBundle(profile, crewKitRecords, manifest, workPatterns, decisions);
  mkdirSync(path.join(root, "memory"), { recursive: true });
  atomicWriteJson(path.join(root, crewSoulBundleRelativePath), bundle);
  writeFileSync(
    path.join(root, crewSoulBundleSummaryRelativePath),
    createCrewSoulBundleSummary(bundle),
    "utf8",
  );
  return bundle;
}

function createCrewSoulBundle(profile, crewKitRecords, manifest, workPatterns = [], decisions = []) {
  const activeSkillIds = new Set(profile.activeSkillIds ?? []);
  const skillMap = new Map((profile.skills ?? []).map((skill) => [skill.id, skill]));
  const teammateChannels = (profile.teammates ?? []).map((teammate) => {
    const teammateSkillIds = Array.isArray(teammate.skillIds) ? teammate.skillIds : [];
    const teammateWork = selectTeammateWorkPatterns(teammate, workPatterns).slice(0, 8);
    const teammateDecisions = selectTeammateDecisions(teammate, decisions).slice(0, 6);
    return {
      id: sanitizeLine(teammate.id, 80),
      templateId: sanitizeLine(teammate.templateId, 40),
      avatarId: sanitizeLine(teammate.avatarId, 64),
      name: sanitizeLine(teammate.name, 80),
      teamLabel: sanitizeLine(teammate.teamLabel, 80),
      roleTitle: sanitizeLine(teammate.roleTitle, 120),
      channelName: sanitizeLine(teammate.channelName, 80),
      brief: sanitizeLine(teammate.brief, 280),
      skillIds: teammateSkillIds.map((id) => sanitizeLine(id, 80)).filter(Boolean),
      activeSkillIds: teammateSkillIds.filter((id) => activeSkillIds.has(id)).map((id) => sanitizeLine(id, 80)),
      instructions: Array.isArray(teammate.instructions)
        ? teammate.instructions.map((line) => sanitizeLine(line, 180)).filter(Boolean)
        : [],
      memoryPaths: {
        crewSoul: `memory/crew-souls/${sanitizePathSegment(teammate.id || teammate.name || "teammate")}/CrewSoul.md`,
        promptMemory: `memory/crew-souls/${sanitizePathSegment(teammate.id || teammate.name || "teammate")}/PromptMemory.md`,
        decisionLog: `memory/crew-souls/${sanitizePathSegment(teammate.id || teammate.name || "teammate")}/DecisionLog.md`,
        workLog: `memory/crew-souls/${sanitizePathSegment(teammate.id || teammate.name || "teammate")}/WorkLog.md`,
      },
      recentWork: teammateWork.map((record) => ({
        id: sanitizeLine(record.id, 120),
        sourceKind: sanitizeLine(record.sourceKind, 80),
        label: sourceKindLabel(record.sourceKind),
        summary: sanitizeLine(record.summary || record.sourceLabel, 220),
        learnedAt: sanitizeIsoDate(record.learnedAt || new Date().toISOString()),
        artifactPaths: (record.artifactPaths ?? []).map((item) => sanitizeLine(item, 240)).filter(Boolean).slice(0, 3),
      })),
      recentDecisions: teammateDecisions.map((record) => ({
        id: sanitizeLine(record.id, 120),
        decision: sanitizeLine(record.decision, 80),
        summary: sanitizeLine(record.revisionInstruction || record.messagePreview || record.title, 220),
        decidedAt: sanitizeIsoDate(record.decidedAt || new Date().toISOString()),
      })),
      restoreRule: "이 AI 팀원의 대화, 업무 결정, 학습 기록은 다른 팀원과 섞지 않고 복원합니다.",
    };
  });
  const activeCrewKits = crewKitRecords
    .filter((record) => record.status === "active")
    .map((record) => ({
      id: sanitizeLine(record.id, 80),
      label: sanitizeLine(record.label || record.title, 120),
      category: sanitizeLine(record.category, 80),
      connectorIds: (record.connectorIds ?? []).map((id) => sanitizeLine(id, 80)).filter(Boolean),
      assignedTeammateIds: (record.assignedTeammates ?? []).map((teammate) => sanitizeLine(teammate.id, 80)).filter(Boolean),
      restoreAction: "enable_app_setting_then_reconfirm_external_routes",
    }));
  const skillRecommendations = crewKitRecords
    .filter((record) => record.status !== "active")
    .map((record) => ({
      id: sanitizeLine(record.id, 80),
      label: sanitizeLine(record.label || record.title, 120),
      recommendedTeam: sanitizeLine(record.recommendedTeam, 80),
      triggerKeywords: (record.triggerKeywords ?? []).map((keyword) => sanitizeLine(keyword, 80)).filter(Boolean).slice(0, 8),
      restoreAction: "show_when_user_intent_matches",
    }))
    .slice(0, 40);
  return {
    schema: "modycrew.crew-soul-bundle.v1",
    product: "ModyCrew",
    generatedAt: new Date().toISOString(),
    purpose: "새 PC에서 기억 폴더만 선택해도 AI 팀원, 역할, 업무 도구, 업무 도구 추천, 외부 재승인 순서를 한 번에 이어받기 위한 구조화 묶음입니다.",
    restoreMode: "select_memory_folder_then_read_bundle",
    restoreOrder: [
      portableManifestFileName,
      crewSoulBundleRelativePath.replaceAll("\\", "/"),
      appProfileRelativePath.replaceAll("\\", "/"),
      "memory/crew-souls/CrewChannelIndex.md",
      crewChannelBlueprintRelativePath.replaceAll("\\", "/"),
      "memory/prompt/PromptMemory.md",
      skillBootstrapPlanRelativePath.replaceAll("\\", "/"),
      "memory/growth/SkillBridge.md",
    ],
    appSettings: {
      activeTeammateId: sanitizeLine(profile.appSettings?.activeTeammateId, 80),
      theme: sanitizeLine(profile.appSettings?.theme, 40),
      assistantDisplayName: sanitizeLine(profile.appSettings?.assistantDisplayName, 80),
      userDisplayName: sanitizeLine(profile.appSettings?.userDisplayName, 80),
      userCallName: sanitizeLine(profile.appSettings?.userCallName, 80),
      mainControllerId: sanitizeLine(profile.appSettings?.mainControllerId, 120),
      mainControllerName: sanitizeLine(profile.appSettings?.mainControllerName, 80),
      mainControllerChannelName: sanitizeLine(profile.appSettings?.mainControllerChannelName, 120),
    },
    teammateChannels,
    activeCrewKits,
    skillRecommendations,
    messengerChannels: (profile.messengerChannels ?? []).map((channel) => ({
      id: sanitizeLine(channel.id, 80),
      label: sanitizeLine(channel.label || channel.title || channel.id, 120),
      provider: sanitizeLine(channel.provider || channel.kind, 80),
      restoreAction: "reconnect_without_secret",
    })),
    skillMapPreview: [...skillMap.values()].slice(0, 40).map((skill) => ({
      id: sanitizeLine(skill.id, 80),
      title: sanitizeLine(skill.title, 120),
      summary: sanitizeLine(skill.summary, 220),
    })),
    restorePaths: {
      manifest: portableManifestFileName,
      profile: appProfileRelativePath.replaceAll("\\", "/"),
      crewSoul: "memory/CrewSoul.md",
      crewChannelIndex: "memory/crew-souls/CrewChannelIndex.md",
      crewChannelBlueprint: crewChannelBlueprintRelativePath.replaceAll("\\", "/"),
      crewChannelBlueprintSummary: crewChannelBlueprintSummaryRelativePath.replaceAll("\\", "/"),
      promptMemory: "memory/prompt/PromptMemory.md",
      conversationDigest: conversationDigestRelativePath.replaceAll("\\", "/"),
      skillBootstrapPlan: skillBootstrapPlanRelativePath.replaceAll("\\", "/"),
      skillBridge: "memory/growth/SkillBridge.md",
      skillSourceInventory: "memory/growth/SkillSourceInventory.md",
    },
    counts: {
      teammates: teammateChannels.length,
      activeCrewKits: activeCrewKits.length,
      recommendations: skillRecommendations.length,
      messengerChannels: profile.messengerChannels?.length ?? 0,
      manifestIdentityFiles: manifest?.counts?.identityFiles ?? 0,
    },
    safety: [
      "이 묶음은 복원과 추천용입니다.",
      "계정 비밀번호, OAuth token, API key 원문은 저장하지 않습니다.",
      "외부 발송, 일정 등록, 파일 이동/삭제, 제출, 결제는 복원 후에도 사용자 승인 없이는 실행하지 않습니다.",
      "공식 API가 없는 외부 기능은 보관함, 앱 위치, 사이트 링크, Computer Use 권한을 새 PC에서 다시 확인합니다.",
    ],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createCrewSoulBundleSummary(bundle) {
  const lines = [
    "# CrewSoulBundle",
    "",
    "ModyCrew 기억 폴더를 새 PC로 옮겼을 때 앱이 가장 먼저 읽는 구조화 복원 묶음입니다.",
    "",
    `- Generated: ${bundle.generatedAt}`,
    `- Restore mode: ${bundle.restoreMode}`,
    `- AI teammates: ${bundle.counts.teammates}`,
    `- Active CrewKits: ${bundle.counts.activeCrewKits}`,
    `- Recommended CrewKits: ${bundle.counts.recommendations}`,
    `- Messenger channels: ${bundle.counts.messengerChannels}`,
    "",
    "## Restore Order",
    "",
    ...bundle.restoreOrder.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## AI Teammate Channels",
    "",
  ];
  if (!bundle.teammateChannels.length) {
    lines.push("- 아직 복원할 AI 팀원이 없습니다.");
  } else {
    for (const teammate of bundle.teammateChannels) {
      lines.push(`- ${teammate.name} · ${teammate.channelName}`);
      lines.push(`  - Role: ${teammate.roleTitle}`);
      lines.push(`  - CrewSoul: ${teammate.memoryPaths.crewSoul}`);
      lines.push(`  - PromptMemory: ${teammate.memoryPaths.promptMemory}`);
      lines.push(`  - WorkLog: ${teammate.memoryPaths.workLog}`);
      if (teammate.recentWork?.length) {
        lines.push(`  - Learned work: ${teammate.recentWork.map((record) => record.label).slice(0, 4).join(", ")}`);
      }
      if (teammate.recentDecisions?.length) {
        lines.push(`  - Recent decisions: ${teammate.recentDecisions.length}`);
      }
    }
  }
  lines.push("", "## Active CrewKits", "");
  if (!bundle.activeCrewKits.length) {
    lines.push("- 아직 활성 CrewKit이 없습니다.");
  } else {
    for (const crewKit of bundle.activeCrewKits) {
      lines.push(`- ${crewKit.label} (${crewKit.id})`);
      lines.push(`  - Assigned: ${crewKit.assignedTeammateIds.join(", ") || "메인 컨트롤"}`);
      lines.push(`  - Connectors: ${crewKit.connectorIds.join(", ") || "앱 내부"}`);
    }
  }
  lines.push("", "## Safety", "");
  for (const rule of bundle.safety) lines.push(`- ${rule}`);
  lines.push("");
  return lines.join("\n");
}

function createPortableManifest(
  profile,
  crewKitRecords,
  root,
  workspaceSkillLifecycleDisplay = undefined,
) {
  const decisionCount = root ? readJsonArray(path.join(root, decisionLedgerRelativePath)).length : 0;
  const workPatternCount = root ? readJsonArray(path.join(root, workPatternLedgerRelativePath)).length : 0;
  const learningSourceCount = root ? sanitizeLearningSourceRecords(readJsonArray(path.join(root, learningSourcesLedgerRelativePath))).length : 0;
  const connectorRecoveryMemoryCount = root
    ? createConnectorRecoveryMemoryRecords(readJsonArray(path.join(root, workPatternLedgerRelativePath))).length
    : 0;
  const delegationArtifactCount = root ? readJsonArray(path.join(root, delegationArtifactLedgerRelativePath)).length : 0;
  const delegationApprovalDecisionCount = root ? readJsonArray(path.join(root, delegationApprovalDecisionLedgerRelativePath)).length : 0;
  const delegationActionQueueCount = root ? readJsonArray(path.join(root, delegationActionQueueLedgerRelativePath)).length : 0;
  const conversationDigestCount = root ? readJsonArray(path.join(root, conversationDigestRelativePath)).length : 0;
  const growthSuggestionCount = root
    ? sanitizeGrowthSuggestions(readJsonArray(path.join(root, "memory", "growth", "skill-suggestions.json"))).length
    : 0;
  const skillSourceCount = root
    ? sanitizeSkillSourceRecords(readJsonArray(path.join(root, "memory", "growth", "skill-sources.json"))).length
    : 0;
  const lifecyclePaths = resolveWorkspaceSkillLifecyclePaths(root);
  const priorWorkspaceSkillLifecycleDisplay =
    workspaceSkillLifecycleDisplay ??
    readWorkspaceSkillLifecycleDisplayFromManifest(root);
  const workspaceSkillLifecycle = {
    statePath: lifecyclePaths.statePath,
    summaryPath: lifecyclePaths.summaryPath,
    proposalCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      priorWorkspaceSkillLifecycleDisplay.proposalCount,
    ),
    pendingInstallApprovalCount:
      sanitizeWorkspaceSkillLifecycleDisplayCount(
        priorWorkspaceSkillLifecycleDisplay.pendingInstallApprovalCount,
      ),
    installedInactiveCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      priorWorkspaceSkillLifecycleDisplay.installedInactiveCount,
    ),
    activeCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      priorWorkspaceSkillLifecycleDisplay.activeCount,
    ),
    blockedCount: sanitizeWorkspaceSkillLifecycleDisplayCount(
      priorWorkspaceSkillLifecycleDisplay.blockedCount,
    ),
  };
  return {
    schema: "modycrew.portable-memory.v1",
    portableMemory: true,
    product: "ModyCrew",
    version: 1,
    updatedAt: profile.updatedAt,
    restore: {
      profilePath: appProfileRelativePath.replaceAll("\\", "/"),
      chatThreadsPath: chatThreadsRelativePath.replaceAll("\\", "/"),
      conversationDigestPath: conversationDigestRelativePath.replaceAll("\\", "/"),
      crewSoulBundlePath: crewSoulBundleRelativePath.replaceAll("\\", "/"),
      crewSoulBundleSummaryPath: crewSoulBundleSummaryRelativePath.replaceAll("\\", "/"),
      crewSoulPath: "memory/CrewSoul.md",
      crewChannelIndexPath: "memory/crew-souls/CrewChannelIndex.md",
      crewChannelBlueprintPath: crewChannelBlueprintRelativePath.replaceAll("\\", "/"),
      crewChannelBlueprintSummaryPath: crewChannelBlueprintSummaryRelativePath.replaceAll("\\", "/"),
      crewKitIndexPath: "memory/crew-kits/CrewKitIndex.md",
      growthLedgerPath: "memory/growth/growth-ledger.json",
      skillGrowthPath: "memory/growth/SkillGrowth.md",
      skillBridgePath: "memory/growth/SkillBridge.md",
      selfGrowthContractPath: "memory/growth/SelfGrowthContract.md",
      skillSourceInventoryPath: "memory/growth/SkillSourceInventory.md",
      skillSourcesPath: "memory/growth/skill-sources.json",
      skillBootstrapPlanPath: skillBootstrapPlanRelativePath.replaceAll("\\", "/"),
      skillBootstrapPlanSummaryPath: skillBootstrapPlanSummaryRelativePath.replaceAll("\\", "/"),
      workspaceSkillLifecyclePath: path
        .relative(root, workspaceSkillLifecycle.statePath)
        .replaceAll("\\", "/"),
      workspaceSkillLifecycleSummaryPath: path
        .relative(root, workspaceSkillLifecycle.summaryPath)
        .replaceAll("\\", "/"),
      decisionLedgerPath: decisionLedgerRelativePath.replaceAll("\\", "/"),
      workPatternLedgerPath: workPatternLedgerRelativePath.replaceAll("\\", "/"),
      learningSourcesPath: learningSourcesLedgerRelativePath.replaceAll("\\", "/"),
      learningSourcesSummaryPath: "memory/documents/LearningSources.md",
      delegationArtifactLedgerPath: delegationArtifactLedgerRelativePath.replaceAll("\\", "/"),
      delegationApprovalDecisionLedgerPath: delegationApprovalDecisionLedgerRelativePath.replaceAll("\\", "/"),
      delegationActionQueueLedgerPath: delegationActionQueueLedgerRelativePath.replaceAll("\\", "/"),
      promptMemoryPath: "memory/prompt/PromptMemory.md",
      identityFiles: createIdentityFileRecords(root, profile).map(({ label, kind, relativePath, teammateId }) => ({
        label,
        kind,
        relativePath,
        ...(teammateId ? { teammateId } : {}),
      })),
    },
    counts: {
      teammates: profile.teammates?.length ?? 0,
      skills: profile.skills?.length ?? 0,
      activeSkills: profile.activeSkillIds?.length ?? 0,
      messengerChannels: profile.messengerChannels?.length ?? 0,
      crewKits: crewKitRecords.length,
      workDecisions: decisionCount,
      workPatterns: workPatternCount,
      learningSources: learningSourceCount,
      connectorRecoveryMemories: connectorRecoveryMemoryCount,
      delegationArtifacts: delegationArtifactCount,
      delegationApprovalDecisions: delegationApprovalDecisionCount,
      delegationActionQueue: delegationActionQueueCount,
      conversationDigests: conversationDigestCount,
      growthSuggestions: growthSuggestionCount,
      skillSources: skillSourceCount,
      skillBootstrapPlans: existsSync(path.join(root, skillBootstrapPlanRelativePath)) ? 1 : 0,
      workspaceSkillProposals:
        workspaceSkillLifecycle.proposalCount,
      workspaceSkillPendingInstallApprovals:
        workspaceSkillLifecycle.pendingInstallApprovalCount,
      workspaceSkillsInstalledInactive:
        workspaceSkillLifecycle.installedInactiveCount,
      workspaceSkillsActive:
        workspaceSkillLifecycle.activeCount,
      workspaceSkillsBlocked:
        workspaceSkillLifecycle.blockedCount,
      crewSoulBundles: existsSync(path.join(root, crewSoulBundleRelativePath)) ? 1 : 0,
      promptMemories: existsSync(path.join(root, "memory", "prompt", "PromptMemory.md"))
        ? 1 + (profile.teammates?.length ?? 0)
        : 0,
      identityFiles: createIdentityFileRecords(root, profile).filter((file) => file.state === "ready").length,
    },
    safety: [
      "secret 원문은 이 폴더의 업무 방식/업무 도구/manifest에 저장하지 않습니다.",
      "새 PC에서는 이 폴더를 기억 저장소로 선택하면 앱 프로필과 대화 기억을 먼저 복원합니다.",
      "도구 추천 기준은 필요한 외부 연결을 추천하고 사용자가 켠 업무 도구와 담당 AI 팀원만 장부에 남깁니다.",
      "외부 업무 도구의 과거 상태는 표시용으로만 이어받고, 이 PC에서 설치 파일과 SHA-256을 다시 확인한 뒤 설치·활성화를 각각 승인합니다.",
      "외부 발송, 일정 등록, 파일 삭제, 결제, 제출은 복원 후에도 사용자 승인 전 실행하지 않습니다.",
    ],
  };
}

function createIdentityFileRecords(root, profile = null) {
  const teammates = profile?.teammates ?? [];
  const baseRecords = [
    {
      label: "ModyCrew 복원 매니페스트",
      kind: "restore_manifest",
      relativePath: portableManifestFileName,
      detail: "새 PC에서 이 폴더를 ModyCrew 기억 저장소로 인식하는 기준 파일입니다.",
    },
    {
      label: "복원 안내서",
      kind: "restore_guide",
      relativePath: "RESTORE.md",
      detail: "새 PC에서 기억 폴더를 선택하고 외부 계정을 다시 승인하는 순서입니다.",
    },
    {
      label: "CrewSoul",
      kind: "crew_soul",
      relativePath: "memory/CrewSoul.md",
      detail: "앱 전체 정체성, AI 팀원, 업무 도구, 메신저 연결 기준을 요약합니다.",
    },
    {
      label: "CrewSoulBundle",
      kind: "crew_soul_bundle",
      relativePath: "memory/CrewSoulBundle.json",
      detail: "새 PC에서 앱이 AI 팀원, 역할, 사용 중 도구, 이어쓰기 순서를 한 번에 읽는 구조화 묶음입니다.",
    },
    {
      label: "CrewSoulBundle 안내",
      kind: "crew_soul_bundle_summary",
      relativePath: "memory/CrewSoulBundle.md",
      detail: "CrewSoulBundle의 사람이 읽는 복원 요약입니다.",
    },
    {
      label: "CrewChannelIndex",
      kind: "crew_channel_index",
      relativePath: "memory/crew-souls/CrewChannelIndex.md",
      detail: "AI 팀원, 역할, 업무 방식 파일 경로를 한 번에 복원하는 인덱스입니다.",
    },
    {
      label: "CrewChannelBlueprint",
      kind: "crew_channel_blueprint",
      relativePath: "memory/crew-souls/CrewChannelBlueprint.json",
      detail: "메인 컨트롤, 제품, 운영, 성장 그룹과 역할별 채널을 구조화해 새 PC에서 그대로 복원하는 청사진입니다.",
    },
    {
      label: "CrewChannelBlueprint 안내",
      kind: "crew_channel_blueprint_summary",
      relativePath: "memory/crew-souls/CrewChannelBlueprint.md",
      detail: "CrewChannelBlueprint의 사람이 읽는 팀/채널 복원 요약입니다.",
    },
    {
      label: "앱 프로필",
      kind: "app_profile",
      relativePath: "memory/app-profile/profile.json",
      detail: "AI 팀원, CrewKit, 활성 스킬, 앱 설정의 구조화 원본입니다.",
    },
    {
      label: "ConversationDigest",
      kind: "conversation_digest",
      relativePath: "memory/chat/ConversationDigest.md",
      detail: "긴 대화를 요청, 선호, 결정, 미해결, 다음 행동으로 압축한 답변용 기억입니다.",
    },
    {
      label: "CrewKitIndex",
      kind: "crewkit_index",
      relativePath: "memory/crew-kits/CrewKitIndex.md",
      detail: "사용자 요청에 맞춰 추천하거나 켤 수 있는 스킬 장부입니다.",
    },
    {
      label: "PromptMemory",
      kind: "prompt_memory",
      relativePath: "memory/prompt/PromptMemory.md",
      detail: "AI 답변 직전에 먼저 읽는 압축된 업무 기억입니다.",
    },
    {
      label: "SkillGrowth",
      kind: "skill_growth",
      relativePath: "memory/growth/SkillGrowth.md",
      detail: "반복 업무를 보고 다음에 켤 업무 도구와 담당 팀원을 제안하는 장부입니다.",
    },
    {
      label: "SkillBridge",
      kind: "skill_bridge",
      relativePath: "memory/growth/SkillBridge.md",
      detail: "앱 기본 업무 도구와 외부 연결 후보, 내 PC 작업 도우미 후보를 연결하는 도구 추천 기준입니다.",
    },
    {
      label: "SkillBootstrapPlan",
      kind: "skill_bootstrap_plan",
      relativePath: "memory/growth/SkillBootstrapPlan.md",
      detail: "새 PC에서 사용 중 도구, 담당 AI 팀원, 외부 재승인 순서를 자동으로 맞추기 위한 읽기용 계획입니다.",
    },
    {
      label: "SelfGrowthContract",
      kind: "self_growth_contract",
      relativePath: "memory/growth/SelfGrowthContract.md",
      detail: "스스로 성장, 외부 기능 추천, 사용자 승인, 새 PC 복원 경계를 설명하는 핵심 계약입니다.",
    },
    {
      label: "WorkspaceSkillLifecycle",
      kind: "workspace_skill_lifecycle_summary",
      relativePath: "memory/growth/WorkspaceSkillLifecycle.md",
      detail: "검증된 외부 도구 제안과 과거 설치·활성화 상태의 표시용 요약입니다. 이 파일은 실행 권한이 아닙니다.",
    },
    {
      label: "DecisionMemory",
      kind: "decision_memory",
      relativePath: "memory/decisions/DecisionMemory.md",
      detail: "승인, 수정 요청, 보류, 거절 패턴을 다음 초안에 반영하는 기억입니다.",
    },
    {
      label: "WorkPatternMemory",
      kind: "work_pattern_memory",
      relativePath: "memory/work-patterns/WorkPatternMemory.md",
      detail: "메일, 문서, 폴더, 일정 업무에서 학습한 반복 패턴입니다.",
    },
    {
      label: "DelegationArtifacts",
      kind: "delegation_artifacts",
      relativePath: "memory/delegations/DelegationArtifacts.md",
      detail: "AI 팀원 취합 결과에서 만든 보고서, 메일, 승인 요청 결과 인덱스입니다.",
    },
    {
      label: "ApprovalDecisions",
      kind: "approval_decisions",
      relativePath: "memory/delegations/ApprovalDecisions.md",
      detail: "승인 요청 결과에 사용자가 내린 승인, 수정 요청, 보류, 거절 결정 장부입니다.",
    },
    {
      label: "DelegationActionQueue",
      kind: "delegation_action_queue",
      relativePath: "memory/delegations/DelegationActionQueue.md",
      detail: "승인 이후 실행 후보, 수정 큐, 보류 큐를 분리해 두는 안전 장부입니다.",
    },
  ];
  const teammateRecords = teammates.flatMap((teammate) => {
    const folderName = sanitizePathSegment(teammate.id || teammate.name || "teammate");
    return [
      {
        label: `${teammate.name || "AI 팀원"} CrewSoul`,
        kind: "teammate_crew_soul",
        relativePath: `memory/crew-souls/${folderName}/CrewSoul.md`,
        teammateId: teammate.id,
        detail: `${teammate.channelName || "팀원 대화"}에서 사용할 역할별 장기 기억입니다.`,
      },
      {
        label: `${teammate.name || "AI 팀원"} PromptMemory`,
        kind: "teammate_prompt_memory",
        relativePath: `memory/crew-souls/${folderName}/PromptMemory.md`,
        teammateId: teammate.id,
        detail: "해당 AI 팀원에게만 붙는 짧은 답변 기억입니다.",
      },
      {
        label: `${teammate.name || "AI 팀원"} WorkLog`,
        kind: "teammate_work_log",
        relativePath: `memory/crew-souls/${folderName}/WorkLog.md`,
        teammateId: teammate.id,
        detail: "해당 직원이 위임받거나 학습한 업무 실행 기록입니다.",
      },
      {
        label: `${teammate.name || "AI 팀원"} DecisionLog`,
        kind: "teammate_decision_log",
        relativePath: `memory/crew-souls/${folderName}/DecisionLog.md`,
        teammateId: teammate.id,
        detail: "해당 AI 팀원의 승인, 수정 요청, 보류, 거절 기준입니다.",
      },
    ];
  });
  return [...baseRecords, ...teammateRecords].map((record) => {
    const filePath = path.join(root, record.relativePath);
    return {
      ...record,
      state: existsSync(filePath) ? "ready" : "missing",
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  });
}

function writeGrowthMemory(root, profile, crewKitRecords) {
  const growthFolder = path.join(root, "memory", "growth");
  mkdirSync(growthFolder, { recursive: true });
  const workPatterns = readCachedWorkPatternRecords(root);
  const decisions = readCachedDecisionRecords(root);
  const ledger = createGrowthLedger(profile, crewKitRecords, workPatterns, decisions);
  const skillSources = createSkillSourceInventory(profile, crewKitRecords, ledger);
  atomicWriteJson(path.join(growthFolder, "growth-ledger.json"), ledger);
  atomicWriteJson(path.join(growthFolder, "skill-suggestions.json"), ledger.suggestions ?? []);
  atomicWriteJson(path.join(growthFolder, "skill-sources.json"), skillSources);
  writeFileSync(path.join(growthFolder, "GrowthMemory.md"), createGrowthMemorySummary(ledger), "utf8");
  writeFileSync(path.join(growthFolder, "SkillGrowth.md"), createSkillGrowthSummary(ledger), "utf8");
  writeFileSync(path.join(growthFolder, "SkillBridge.md"), createSkillBridgeSummary(ledger), "utf8");
  writeFileSync(path.join(growthFolder, "SelfGrowthContract.md"), createSelfGrowthContractSummary(ledger), "utf8");
  writeFileSync(path.join(growthFolder, "SkillSourceInventory.md"), createSkillSourceInventorySummary(skillSources), "utf8");
}

const pendingPromptMemoryRefreshTimers = new Map();

function schedulePromptMemoryRefresh(root, delayMs = 3_000) {
  if (pendingPromptMemoryRefreshTimers.has(root)) return;
  const timer = setTimeout(() => {
    pendingPromptMemoryRefreshTimers.delete(root);
    try {
      refreshPromptMemory(root);
    } catch {
      // 다음 저장이나 load_prompt_context(재료가 더 새로우면 다시 만듦)에서 다시 시도한다.
    }
  }, delayMs);
  timer.unref?.();
  pendingPromptMemoryRefreshTimers.set(root, timer);
}

function cancelPendingPromptMemoryRefresh(root) {
  const timer = pendingPromptMemoryRefreshTimers.get(root);
  if (!timer) return false;
  clearTimeout(timer);
  pendingPromptMemoryRefreshTimers.delete(root);
  return true;
}

function flushPendingPromptMemoryRefresh(root) {
  if (!cancelPendingPromptMemoryRefresh(root)) return false;
  refreshPromptMemory(root);
  return true;
}

// refreshPromptMemory 가 읽는 재료 파일 중 하나라도 prompt-context.json 보다 새로우면(또는
// 결과 파일이 없으면) 다시 만들어야 한다. 파일 stat 10여 번이라 1ms 안쪽이다.
function promptMemoryIsStale(root) {
  let builtAt = 0;
  try {
    builtAt = statSync(path.join(root, "memory", "prompt", "prompt-context.json")).mtimeMs;
  } catch {
    return true;
  }
  const inputs = [
    appProfileRelativePath,
    chatThreadsRelativePath,
    conversationDigestRelativePath,
    decisionLedgerRelativePath,
    workPatternLedgerRelativePath,
    learningSourcesLedgerRelativePath,
    delegationArtifactLedgerRelativePath,
    delegationApprovalDecisionLedgerRelativePath,
    delegationActionQueueLedgerRelativePath,
    path.join("memory", "crew-kits", "crew-kits.json"),
  ];
  for (const relativePath of inputs) {
    try {
      if (statSync(path.join(root, relativePath)).mtimeMs >= builtAt) return true;
    } catch {
      // 없는 재료 파일은 결과에 영향을 주지 않는다.
    }
  }
  return false;
}

function refreshPromptMemory(root) {
  cancelPendingPromptMemoryRefresh(root);
  // 재료 원장은 읽기 캐시를 거친다. 방금 저장한 파일만 다시 읽고 나머지는 검사 결과를 재사용한다.
  const profile = readCachedAppProfile(root) ?? {
    version: 1,
    updatedAt: new Date().toISOString(),
    teammates: [],
    skills: [],
    activeSkillIds: [],
    messengerChannels: [],
    activeMessengerChannelIds: [],
    appSettings: {},
  };
  const threads = readCachedThreads(root);
  const conversationDigest = readCachedConversationDigest(root);
  const decisions = readCachedDecisionRecords(root);
  const workPatterns = readCachedWorkPatternRecords(root);
  const learningSources = readCachedLearningSourceRecords(root);
  const delegationArtifacts = readCachedDelegationArtifactRecords(root);
  const delegationApprovalDecisions = readCachedDelegationApprovalDecisionRecords(root);
  const delegationActionQueue = readCachedDelegationActionQueueRecords(root);
  const crewKitRecords = readCachedJsonArray(path.join(root, "memory", "crew-kits", "crew-kits.json"));
  const promptFolder = path.join(root, "memory", "prompt");
  mkdirSync(promptFolder, { recursive: true });
  writeWorkPatternMemories(root, workPatterns);
  writeLearningSourceSummary(root, learningSources);
  const promptContext = createPromptContextRecord(profile, threads, decisions, crewKitRecords, workPatterns, conversationDigest, delegationArtifacts, delegationApprovalDecisions, delegationActionQueue, learningSources);
  atomicWriteJson(path.join(promptFolder, "prompt-context.json"), promptContext);
  writeFileSync(path.join(promptFolder, "PromptMemory.md"), createPromptMemorySummary(promptContext), "utf8");
  writeFileSync(path.join(promptFolder, "LongMemoryIndex.md"), createLongMemoryIndexSummary(promptContext), "utf8");
  writeTeammatePromptMemories(root, profile, threads, decisions, promptContext);
  updatePromptMemoryManifest(root, promptContext);
  return promptContext;
}

function updatePromptMemoryManifest(root, promptContext) {
  const manifestPath = path.join(root, portableManifestFileName);
  // manifest 는 아래에서 고쳐 쓰므로 캐시가 아닌 새로 읽은 객체를 쓴다.
  const manifest = readJsonObject(manifestPath);
  if (!manifest?.portableMemory) return;
  const profile = readCachedAppProfile(root) ?? {
    teammates: [],
    skills: [],
    activeSkillIds: [],
    messengerChannels: [],
    activeMessengerChannelIds: [],
    appSettings: {},
  };
  const identityFiles = createIdentityFileRecords(root, profile);
  manifest.updatedAt = promptContext.updatedAt;
  manifest.restore = {
    ...(manifest.restore ?? {}),
    promptMemoryPath: "memory/prompt/PromptMemory.md",
    crewSoulBundlePath: crewSoulBundleRelativePath.replaceAll("\\", "/"),
    crewSoulBundleSummaryPath: crewSoulBundleSummaryRelativePath.replaceAll("\\", "/"),
    conversationDigestPath: conversationDigestRelativePath.replaceAll("\\", "/"),
    workPatternLedgerPath: workPatternLedgerRelativePath.replaceAll("\\", "/"),
    learningSourcesPath: learningSourcesLedgerRelativePath.replaceAll("\\", "/"),
    delegationArtifactLedgerPath: delegationArtifactLedgerRelativePath.replaceAll("\\", "/"),
    delegationApprovalDecisionLedgerPath: delegationApprovalDecisionLedgerRelativePath.replaceAll("\\", "/"),
    delegationActionQueueLedgerPath: delegationActionQueueLedgerRelativePath.replaceAll("\\", "/"),
    skillGrowthPath: "memory/growth/SkillGrowth.md",
    skillBridgePath: "memory/growth/SkillBridge.md",
    selfGrowthContractPath: "memory/growth/SelfGrowthContract.md",
    skillSourceInventoryPath: "memory/growth/SkillSourceInventory.md",
    skillSourcesPath: "memory/growth/skill-sources.json",
    skillBootstrapPlanPath: skillBootstrapPlanRelativePath.replaceAll("\\", "/"),
    skillBootstrapPlanSummaryPath: skillBootstrapPlanSummaryRelativePath.replaceAll("\\", "/"),
    identityFiles: identityFiles.map(({ label, kind, relativePath, teammateId }) => ({
      label,
      kind,
      relativePath,
      ...(teammateId ? { teammateId } : {}),
    })),
  };
  manifest.counts = {
    ...(manifest.counts ?? {}),
    promptMemories: 1 + Number(promptContext.counts?.teammates ?? 0),
    conversationDigests: Number(promptContext.counts?.conversationDigests ?? 0),
    workPatterns: Number(promptContext.counts?.workPatterns ?? 0),
    learningSources: Number(promptContext.counts?.learningSources ?? 0),
    connectorRecoveryMemories: readCachedConnectorRecoveryMemories(root).length,
    delegationArtifacts: Number(promptContext.counts?.delegationArtifacts ?? 0),
    delegationApprovalDecisions: readCachedJsonArray(path.join(root, delegationApprovalDecisionLedgerRelativePath)).length,
    delegationActionQueue: Number(promptContext.counts?.delegationActionQueue ?? 0),
    growthSuggestions: Number(promptContext.counts?.growthSuggestions ?? 0),
    skillSources: readCachedJsonArray(path.join(root, "memory", "growth", "skill-sources.json")).length,
    skillBootstrapPlans: existsSync(path.join(root, skillBootstrapPlanRelativePath)) ? 1 : 0,
    crewSoulBundles: existsSync(path.join(root, crewSoulBundleRelativePath)) ? 1 : 0,
    identityFiles: identityFiles.filter((file) => file.state === "ready").length,
  };
  atomicWriteJson(manifestPath, manifest);
}

function createPromptContextRecord(profile, threads, decisions, crewKitRecords, workPatterns = [], conversationDigest = [], delegationArtifacts = [], delegationApprovalDecisions = [], delegationActionQueue = [], learningSources = []) {
  const activeSkillIds = new Set(profile.activeSkillIds ?? []);
  const activeSkills = (profile.skills ?? [])
    .filter((skill) => activeSkillIds.has(skill.id))
    .slice(0, 12)
    .map((skill) => ({
      id: skill.id,
      title: skill.title,
      summary: skill.summary,
      connectorIds: skill.connectorIds ?? [],
      instructions: (skill.instructions ?? []).slice(0, 3),
    }));
  const recentIntents = extractRecentUserIntents(threads);
  const decisionPatterns = summarizeDecisionPatterns(decisions);
  const learnedWorkPatterns = summarizeWorkPatterns(workPatterns);
  const growthSuggestions = createGrowthSuggestions(profile, crewKitRecords, workPatterns, decisions);
  const teammateBriefs = (profile.teammates ?? []).slice(0, 12).map((teammate) => ({
    id: teammate.id,
    name: teammate.name,
    channelName: teammate.channelName,
    roleTitle: teammate.roleTitle,
    brief: teammate.brief,
    skillIds: teammate.skillIds ?? [],
  }));
  return {
    schema: "modycrew.prompt-memory.v1",
    updatedAt: new Date().toISOString(),
    purpose: "AI 답변 직전에 붙이는 짧은 기억입니다. 장기 원본은 CrewSoul, CrewKit, DecisionMemory, CrewContext에 따로 보관합니다.",
    counts: {
      teammates: teammateBriefs.length,
      activeSkills: activeSkills.length,
      threads: threads.length,
      messages: countMessages(threads),
      conversationDigests: conversationDigest.length,
      decisions: decisions.length,
      workPatterns: workPatterns.length,
      learningSources: learningSources.length,
      delegationArtifacts: delegationArtifacts.length,
      delegationApprovalDecisions: delegationApprovalDecisions.length,
      delegationActionQueue: delegationActionQueue.length,
      crewKits: crewKitRecords.length,
      growthSuggestions: growthSuggestions.length,
    },
    safetyRules: [
      "비밀번호, API key, 로그인 승인 원문은 채팅에 쓰게 하지 않고 보관함으로 안내합니다.",
      "외부 발송, 일정 등록, 파일 삭제, 결제, 제출은 사용자 최종 승인 전 실행하지 않습니다.",
      "확인되지 않은 연결 상태는 가능한 일과 필요한 연결을 분리해서 답합니다.",
    ],
    appSettings: {
      assistantDisplayName: sanitizeLine(profile.appSettings?.assistantDisplayName, 80),
      userDisplayName: sanitizeLine(profile.appSettings?.userDisplayName, 80),
      userCallName: sanitizeLine(profile.appSettings?.userCallName, 80),
      mainControllerId: sanitizeLine(profile.appSettings?.mainControllerId, 120),
      mainControllerName: sanitizeLine(profile.appSettings?.mainControllerName, 80),
      mainControllerChannelName: sanitizeLine(profile.appSettings?.mainControllerChannelName, 120),
    },
    teammateBriefs,
    activeSkills,
    conversationDigest: conversationDigest.slice(0, 18),
    recentIntents,
    decisionPatterns,
    learnedWorkPatterns,
    delegationArtifacts: summarizeDelegationArtifacts(delegationArtifacts),
    delegationApprovalDecisions: summarizeDelegationApprovalDecisions(delegationApprovalDecisions),
    delegationActionQueue: summarizeDelegationActionQueue(delegationActionQueue),
    learningSources: summarizeLearningSources(learningSources),
    growthSuggestions,
    connectorFocus: summarizeConnectorFocus(profile, activeSkills),
    longMemoryPaths: [
      "memory/CrewSoul.md",
      "memory/CrewSoulBundle.json",
      "memory/CrewSoulBundle.md",
      "memory/crew-souls/CrewChannelIndex.md",
      "memory/crew-souls/CrewChannelBlueprint.json",
      "memory/crew-souls/CrewChannelBlueprint.md",
      "memory/crew-souls/{teammateId}/CrewSoul.md",
      "memory/crew-souls/{teammateId}/DecisionLog.md",
      "memory/crew-souls/{teammateId}/WorkLog.md",
      "memory/crew-kits/CrewKitIndex.md",
      "memory/decisions/DecisionMemory.md",
      "memory/work-patterns/WorkPatternMemory.md",
      "memory/documents/LearningSources.md",
      "memory/documents/WorkspaceKnowledgeImport.md",
      "memory/documents/learning-sources.json",
      "memory/delegations/DelegationArtifacts.md",
      "memory/delegations/ApprovalDecisions.md",
      "memory/delegations/DelegationActionQueue.md",
      "memory/prompt/crewkit/MailOpsPromptMemory.md",
      "memory/prompt/crewkit/WriterPromptMemory.md",
      "memory/prompt/crewkit/TidyPromptMemory.md",
      "memory/chat/CrewContext.md",
      "memory/chat/ConversationDigest.md",
      "memory/chat/conversation-digest.json",
      "memory/growth/GrowthMemory.md",
      "memory/growth/SkillGrowth.md",
      "memory/growth/SkillBridge.md",
      "memory/growth/SkillSourceInventory.md",
      "memory/growth/SkillBootstrapPlan.md",
    ],
  };
}

function extractRecentUserIntents(threads) {
  const intents = [];
  for (const thread of threads.slice(0, 16)) {
    const teammateId = thread.teammateId || "main";
    for (const message of thread.messages.filter((item) => item.role === "user").slice(-3)) {
      intents.push({
        teammateId,
        threadTitle: sanitizeLine(thread.title || "업무 대화", 80),
        text: summarizeMemoryLine(message.text),
        updatedAt: new Date(thread.updatedAt || Date.now()).toISOString(),
      });
    }
  }
  return intents.slice(0, 24);
}

function summarizeDecisionPatterns(decisions) {
  const recent = decisions.slice(0, 30);
  const totals = {};
  const channels = {};
  const revisions = [];
  for (const decision of recent) {
    totals[decision.decision] = (totals[decision.decision] ?? 0) + 1;
    channels[decision.channel] = (channels[decision.channel] ?? 0) + 1;
    if (decision.revisionInstruction) revisions.push(sanitizeLine(decision.revisionInstruction, 160));
  }
  return {
    total: decisions.length,
    recentTotals: totals,
    channels,
    revisionHints: [...new Set(revisions)].slice(0, 8),
    operatingRule: decisions.length
      ? "이전 결정 패턴을 참고하되, 외부 실행은 앱 최종 확인으로 멈춥니다."
      : "아직 승인/수정/보류/거절 결정이 적으므로 사용자의 다음 결정을 학습합니다.",
  };
}

function summarizeWorkPatterns(workPatterns) {
  const recent = workPatterns.slice(0, 40);
  const byKind = {};
  const summaries = [];
  const signals = [];
  for (const pattern of recent) {
    byKind[pattern.sourceKind] = (byKind[pattern.sourceKind] ?? 0) + 1;
    if (pattern.summary) summaries.push({
      sourceKind: pattern.sourceKind,
      sourceLabel: pattern.sourceLabel,
      summary: pattern.summary,
      teammateId: pattern.teammateId,
      teammateName: pattern.teammateName,
      artifactPaths: pattern.artifactPaths ?? [],
    });
    for (const signal of pattern.signals ?? []) signals.push(signal);
  }
  return {
    total: workPatterns.length,
    recentByKind: byKind,
    summaries: summaries.slice(0, 12),
    reusableSignals: [...new Set(signals)].slice(0, 16),
    operatingRule: workPatterns.length
      ? "메일/문서/폴더 작업은 저장된 업무 패턴을 먼저 참고하고 필요한 연결만 추가로 요청합니다."
      : "아직 저장된 업무 패턴이 적으므로 메일 분석, 자료 학습, 폴더 정리 결과를 WorkPatternMemory에 쌓습니다.",
  };
}

function summarizeLearningSources(learningSources) {
  return learningSources.slice(0, 12).map((source) => ({
    id: source.id,
    label: source.label,
    scope: "user_approved_local_source",
    sourceKind: source.sourceKind,
    status: source.status,
    fileCount: source.fileCount,
    lastScannedAt: source.lastScannedAt,
    operatingRule: "원본은 변경하지 않고 자료 분석, 보고서, 메일, 폴더 정리의 읽기 후보로만 사용합니다.",
  }));
}

function summarizeDelegationArtifacts(records) {
  return records.slice(0, 20).map((record) => ({
    id: record.id,
    artifactKind: record.artifactKind,
    title: record.title,
    requestText: record.requestText,
    relativePath: record.relativePath,
    approvalDecision: record.approvalDecision,
    approvalStatus: record.approvalStatus,
    decisionNote: record.decisionNote,
    teammateNames: record.rows.map((row) => row.teammateName || row.channelName || row.teammateId).filter(Boolean).slice(0, 6),
  }));
}

function summarizeDelegationApprovalDecisions(records) {
  return records.slice(0, 20).map((record) => ({
    id: record.id,
    artifactId: record.artifactId,
    artifactTitle: record.artifactTitle,
    decision: record.decision,
    status: record.status,
    decidedAt: record.decidedAt,
    note: record.note,
    relativePath: record.relativePath,
  }));
}

function summarizeDelegationActionQueue(records) {
  return records.slice(0, 24).map((record) => ({
    id: record.id,
    artifactId: record.artifactId,
    artifactTitle: record.artifactTitle,
    actionKind: record.actionKind,
    status: record.status,
    label: record.label,
    createdAt: record.createdAt,
    note: record.note,
    relativePath: record.relativePath,
    teammateName: record.teammateName,
  }));
}

function summarizeConnectorFocus(profile, activeSkills) {
  const connectorIds = new Set();
  for (const skill of activeSkills) {
    for (const connectorId of skill.connectorIds ?? []) connectorIds.add(connectorId);
  }
  for (const channel of profile.messengerChannels ?? []) {
    if ((profile.activeMessengerChannelIds ?? []).includes(channel.id) && channel.connectorId) {
      connectorIds.add(channel.connectorId);
    }
  }
  return [...connectorIds].slice(0, 16);
}

function createPromptMemorySummary(record) {
  const lines = [
    "# PromptMemory",
    "",
    "AI 답변 직전에 붙이는 답변용 짧은 기억입니다. 자세한 원본은 LongMemoryIndex의 파일들을 읽습니다.",
    "",
    `- Updated: ${record.updatedAt}`,
    `- Teammates: ${record.counts.teammates}`,
    `- Active skills: ${record.counts.activeSkills}`,
    `- Recent decisions: ${record.counts.decisions}`,
    `- Learned work patterns: ${record.counts.workPatterns}`,
    `- Learning sources: ${record.counts.learningSources}`,
    `- Delegation artifacts: ${record.counts.delegationArtifacts}`,
    `- Approval decisions: ${record.counts.delegationApprovalDecisions}`,
    `- Delegation action queue: ${record.counts.delegationActionQueue}`,
    "",
    "## Safety Rules",
    "",
  ];
  for (const rule of record.safetyRules) lines.push(`- ${rule}`);
  lines.push("", "## Identity", "");
  if (record.appSettings?.assistantDisplayName || record.appSettings?.userDisplayName || record.appSettings?.userCallName) {
    if (record.appSettings.assistantDisplayName) lines.push(`- Assistant name: ${record.appSettings.assistantDisplayName}`);
    if (record.appSettings.userDisplayName) lines.push(`- User name: ${record.appSettings.userDisplayName}`);
    if (record.appSettings.userCallName) lines.push(`- User call name: ${record.appSettings.userCallName}`);
    if (record.appSettings.mainControllerName || record.appSettings.mainControllerChannelName) {
      lines.push(`- Main controller: ${record.appSettings.mainControllerName || "업무 비서"} · ${record.appSettings.mainControllerChannelName || "메인 컨트롤"}`);
    }
  } else {
    lines.push("- 아직 저장된 이름/호칭 선호가 없습니다.");
  }
  lines.push("", "## Recent Approval Decisions", "");
  if (record.delegationApprovalDecisions?.length) {
    for (const decision of record.delegationApprovalDecisions.slice(0, 5)) {
      lines.push(`- [${delegationApprovalDecisionLabel(decision.decision)}] ${decision.artifactTitle || decision.artifactId} · ${decision.status}`);
      if (decision.note) lines.push(`  - Note: ${decision.note}`);
    }
  } else {
    lines.push("- 아직 앱 안에서 처리한 승인 요청 결정은 없습니다.");
  }
  lines.push("", "## Delegation Action Queue", "");
  if (record.delegationActionQueue?.length) {
    for (const item of record.delegationActionQueue.slice(0, 6)) {
      lines.push(`- [${delegationActionKindLabel(item.actionKind)}] ${item.artifactTitle || item.artifactId} · ${item.status}`);
      if (item.note) lines.push(`  - Note: ${item.note}`);
    }
  } else {
    lines.push("- 아직 승인 이후 실행 후보나 수정 큐가 없습니다.");
  }
  lines.push("", "## Recent Delegation Artifacts", "");
  if (record.delegationArtifacts?.length) {
    for (const artifact of record.delegationArtifacts.slice(0, 5)) {
      lines.push(`- [${delegationArtifactKindLabel(artifact.artifactKind)}] ${artifact.title}`);
      if (artifact.relativePath) lines.push(`  - File: ${artifact.relativePath}`);
      if (artifact.approvalDecision) lines.push(`  - Approval: ${delegationApprovalDecisionLabel(artifact.approvalDecision)} · ${artifact.approvalStatus}`);
    }
  } else {
    lines.push("- 아직 AI 팀원에게서 취합한 결과가 없습니다.");
  }
  lines.push("", "## Active Crew", "");
  for (const teammate of record.teammateBriefs.slice(0, 8)) {
    lines.push(`- ${teammate.name} (${teammate.channelName}): ${teammate.roleTitle} · ${teammate.brief}`);
  }
  lines.push("", "## Active CrewKit", "");
  for (const skill of record.activeSkills.slice(0, 8)) {
    lines.push(`- ${skill.title}: ${skill.summary}`);
    for (const instruction of skill.instructions ?? []) lines.push(`  - ${instruction}`);
  }
  lines.push("", "## Recent User Intents", "");
  for (const intent of record.recentIntents.slice(0, 10)) {
    lines.push(`- ${intent.threadTitle}: ${intent.text}`);
  }
  lines.push("", "## Conversation Digest", "");
  if (record.conversationDigest?.length) {
    for (const digest of record.conversationDigest.slice(0, 8)) {
      lines.push(`- ${digest.title}: ${digest.latestUserIntent || "사용자 의도 없음"}`);
      if (digest.latestAssistantCommitment) lines.push(`  - Commitment: ${digest.latestAssistantCommitment}`);
      for (const nextAction of digest.nextActions ?? []) lines.push(`  - Next: ${nextAction}`);
      for (const preference of digest.userPreferences ?? []) lines.push(`  - Preference: ${preference}`);
      for (const openQuestion of digest.openQuestions ?? []) lines.push(`  - Open: ${openQuestion}`);
      for (const openIssue of digest.openIssues ?? []) lines.push(`  - Issue: ${openIssue}`);
      for (const boundary of digest.safetyBoundaries ?? []) lines.push(`  - Boundary: ${boundary}`);
      for (const connectionHint of digest.connectionHints ?? []) lines.push(`  - Connection: ${connectionHint}`);
      for (const storageHint of digest.storageHints ?? []) lines.push(`  - Storage: ${storageHint}`);
    }
  } else {
    lines.push("- 아직 압축된 대화 요약이 없습니다.");
  }
  lines.push("", "## Decision Pattern", "");
  lines.push(`- Total decisions: ${record.decisionPatterns.total}`);
  lines.push(`- Rule: ${record.decisionPatterns.operatingRule}`);
  for (const hint of record.decisionPatterns.revisionHints ?? []) lines.push(`- Revision hint: ${hint}`);
  lines.push("", "## Learned Work Patterns", "");
  lines.push(`- Total patterns: ${record.learnedWorkPatterns.total}`);
  lines.push(`- Rule: ${record.learnedWorkPatterns.operatingRule}`);
  for (const pattern of record.learnedWorkPatterns.summaries ?? []) {
    lines.push(`- [${sourceKindLabel(pattern.sourceKind)}] ${pattern.summary}`);
    for (const artifactPath of pattern.artifactPaths ?? []) lines.push(`  - File: ${artifactPath}`);
  }
  for (const signal of record.learnedWorkPatterns.reusableSignals ?? []) lines.push(`- Signal: ${signal}`);
  lines.push("", "## Learning Sources", "");
  if (record.learningSources?.length) {
    for (const source of record.learningSources.slice(0, 8)) {
      lines.push(`- ${source.label}: ${source.fileCount} files · ${source.sourceKind}`);
      lines.push("  - Scope: user-approved local source (absolute path omitted)");
    }
  } else {
    lines.push("- 아직 선택된 업무 자료 폴더/드라이브 출처가 없습니다.");
  }
  lines.push("", "## Delegation Artifacts Detail", "");
  if (record.delegationArtifacts?.length) {
    for (const artifact of record.delegationArtifacts.slice(0, 8)) {
      lines.push(`- [${delegationArtifactKindLabel(artifact.artifactKind)}] ${artifact.title}`);
      if (artifact.requestText) lines.push(`  - Request: ${artifact.requestText}`);
      if (artifact.relativePath) lines.push(`  - File: ${artifact.relativePath}`);
      if (artifact.approvalDecision) lines.push(`  - Approval: ${delegationApprovalDecisionLabel(artifact.approvalDecision)} · ${artifact.approvalStatus}`);
    }
  } else {
    lines.push("- 아직 AI 팀원에게서 취합한 결과가 없습니다.");
  }
  lines.push("", "## Approval Decisions", "");
  if (record.delegationApprovalDecisions?.length) {
    for (const decision of record.delegationApprovalDecisions.slice(0, 8)) {
      lines.push(`- [${delegationApprovalDecisionLabel(decision.decision)}] ${decision.artifactTitle || decision.artifactId} · ${decision.status}`);
      if (decision.note) lines.push(`  - Note: ${decision.note}`);
    }
  } else {
    lines.push("- 아직 앱 안에서 처리한 승인 요청 결정은 없습니다.");
  }
  lines.push("", "## Skill Growth Suggestions", "");
  if (record.growthSuggestions?.length) {
    for (const suggestion of record.growthSuggestions.slice(0, 6)) {
      lines.push(`- [${suggestion.priority}] ${suggestion.title}: ${suggestion.nextAction}`);
    }
  } else {
    lines.push("- 아직 제안할 만큼 반복된 스킬 패턴이 없습니다.");
  }
  lines.push("", "## Connector Focus", "");
  lines.push(record.connectorFocus.length ? `- ${record.connectorFocus.join(", ")}` : "- 앱 내부 채팅과 로컬 기억부터 사용합니다.");
  lines.push("");
  return lines.join("\n");
}

function createLongMemoryIndexSummary(record) {
  const lines = [
    "# LongMemoryIndex",
    "",
    "PromptMemory가 짧게 압축한 뒤에도 필요할 때 다시 열어볼 장기 기억 원본 위치입니다.",
    "",
    `- Updated: ${record.updatedAt}`,
    `- Threads: ${record.counts.threads}`,
    `- Messages: ${record.counts.messages}`,
    `- ConversationDigests: ${record.counts.conversationDigests}`,
    `- CrewKits: ${record.counts.crewKits}`,
    `- WorkPatterns: ${record.counts.workPatterns}`,
    `- LearningSources: ${record.counts.learningSources}`,
    `- DelegationArtifacts: ${record.counts.delegationArtifacts}`,
    `- ApprovalDecisions: ${record.counts.delegationApprovalDecisions}`,
    `- DelegationActionQueue: ${record.counts.delegationActionQueue}`,
    "",
    "## Paths",
    "",
  ];
  for (const memoryPath of record.longMemoryPaths) lines.push(`- ${memoryPath}`);
  lines.push("", "## Use Rule", "");
  lines.push("- 일반 답변은 PromptMemory를 우선 사용합니다.");
  lines.push("- 보고서, 메일 초안, 파일 정리처럼 근거가 필요한 일은 장기 기억 원본과 자료 인덱스를 함께 확인합니다.");
  lines.push("");
  return lines.join("\n");
}

function writeTeammatePromptMemories(root, profile, threads, decisions, promptContext) {
  for (const teammate of profile.teammates ?? []) {
    const teammateId = sanitizePathSegment(teammate.id || teammate.name || "teammate");
    const folder = path.join(root, "memory", "crew-souls", teammateId);
    mkdirSync(folder, { recursive: true });
    const teammateThreads = threads.filter((thread) => (thread.teammateId || "main") === teammate.id);
    const teammateDecisions = decisions.filter((decision) => decision.teammateId === teammate.id);
    writeFileSync(
      path.join(folder, "PromptMemory.md"),
      createTeammatePromptMemorySummary(teammate, teammateThreads, teammateDecisions, promptContext),
      "utf8",
    );
  }
}

function createTeammatePromptMemorySummary(teammate, threads, decisions, promptContext) {
  const lines = [
    `# PromptMemory: ${teammate.name}`,
    "",
    "이 AI 팀원이 답변 직전에 먼저 읽는 짧은 업무 방식 기억입니다.",
    "",
    `- Channel: ${teammate.channelName}`,
    `- Role: ${teammate.roleTitle}`,
    `- Updated: ${promptContext.updatedAt}`,
    "",
    "## Mission",
    "",
    teammate.brief,
    "",
    "## Operating Instructions",
    "",
  ];
  for (const instruction of teammate.instructions ?? []) lines.push(`- ${instruction}`);
  lines.push("", "## Recent Channel Intents", "");
  for (const intent of extractRecentUserIntents(threads).slice(0, 8)) {
    lines.push(`- ${intent.text}`);
  }
  const roleDigests = (promptContext.conversationDigest ?? [])
    .filter((digest) => digest.teammateId === teammate.id)
    .slice(0, 6);
  lines.push("", "## Conversation Digest", "");
  if (roleDigests.length) {
    for (const digest of roleDigests) {
      lines.push(`- ${digest.title}: ${digest.latestUserIntent || "사용자 의도 없음"}`);
      for (const nextAction of digest.nextActions ?? []) lines.push(`  - Next: ${nextAction}`);
      for (const preference of digest.userPreferences ?? []) lines.push(`  - Preference: ${preference}`);
      for (const openIssue of digest.openIssues ?? []) lines.push(`  - Issue: ${openIssue}`);
      for (const boundary of digest.safetyBoundaries ?? []) lines.push(`  - Boundary: ${boundary}`);
      for (const connectionHint of digest.connectionHints ?? []) lines.push(`  - Connection: ${connectionHint}`);
      for (const storageHint of digest.storageHints ?? []) lines.push(`  - Storage: ${storageHint}`);
    }
  } else {
    lines.push("- 아직 이 채널의 압축 대화 요약이 없습니다.");
  }
  lines.push("", "## Channel Decisions", "");
  if (decisions.length) {
    for (const decision of decisions.slice(0, 8)) {
      lines.push(`- [${decision.decisionLabel}] ${decision.title}`);
      if (decision.revisionInstruction) lines.push(`  - 수정 지시: ${decision.revisionInstruction}`);
    }
  } else {
    lines.push("- 아직 이 채널의 승인/수정/보류/거절 결정이 없습니다.");
  }
  const rolePatterns = (promptContext.learnedWorkPatterns?.summaries ?? [])
    .filter((pattern) => !pattern.teammateId || pattern.teammateId === teammate.id)
    .slice(0, 8);
  lines.push("", "## Learned Work Patterns", "");
  if (rolePatterns.length) {
    for (const pattern of rolePatterns) lines.push(`- [${sourceKindLabel(pattern.sourceKind)}] ${pattern.summary}`);
  } else {
    lines.push("- 아직 이 채널에서 재사용할 메일/문서/폴더 업무 패턴이 없습니다.");
  }
  lines.push("", "## Boundary", "");
  lines.push("- 이 짧은 기억으로 먼저 답하고, 세부 근거가 필요하면 CrewSoul/DecisionLog/CrewKit 원본을 참고합니다.");
  lines.push("");
  return lines.join("\n");
}

function createGrowthLedger(profile, crewKitRecords, workPatterns = [], decisions = []) {
  const activeSkillIds = new Set(profile.activeSkillIds ?? []);
  const suggestions = createGrowthSuggestions(profile, crewKitRecords, workPatterns, decisions);
  return {
    schema: "modycrew.growth-ledger.v1",
    updatedAt: profile.updatedAt,
    rules: [
      {
        id: "recommend_before_install",
        label: "추천 후 활성화",
        detail: "새 업무 도구는 사용자 요청과 반복 조건이 맞을 때 추천하고, 사용자가 켠 뒤 업무 도구 목록에 활성 상태로 남깁니다.",
      },
      {
        id: "local_first_memory",
        label: "로컬 우선 기억",
        detail: "업무 방식, 팀원 역할, 대화 요약은 포터블 기억 폴더에 JSON과 Markdown으로 함께 저장합니다.",
      },
      {
        id: "approval_before_external_mutation",
        label: "외부 변경 승인",
        detail: "발송, 일정 등록, 파일 삭제, 결제, 제출은 후보만 만들고 최종 실행은 사용자 승인 뒤로 둡니다.",
      },
    ],
    skillStates: crewKitRecords.map((record) => ({
      id: record.id,
      label: record.label,
      status: activeSkillIds.has(record.id) ? "active" : "available",
      connectorIds: record.connectorIds ?? [],
      externalToolHints: deriveExternalToolHints(record),
      triggerKeywords: record.triggerKeywords ?? [],
      assignedTeammateIds: (record.assignedTeammates ?? []).map((teammate) => teammate.id),
    })),
    teammateChannels: (profile.teammates ?? []).map((teammate) => ({
      id: teammate.id,
      avatarId: sanitizeLine(teammate.avatarId, 64),
      name: teammate.name,
      teamLabel: teammate.teamLabel,
      channelName: teammate.channelName,
      skillIds: teammate.skillIds ?? [],
    })),
    suggestions,
  };
}

function deriveExternalToolHints(record) {
  const hints = new Set(record.externalToolHints ?? []);
  const connectorText = (record.connectorIds ?? []).join(" ").toLowerCase();
  const skillText = `${record.id ?? ""} ${record.category ?? ""} ${record.summary ?? ""} ${(record.triggerKeywords ?? []).join(" ")}`.toLowerCase();
  if (/desktop-bridge|local-folder-index|local-cli-tools|codex|git|node|python/.test(connectorText) || /폴더|파일|정리|코딩|개발|cli|git|배포/.test(skillText)) {
    hints.add("Computer Use");
  }
  if (/gmail|google-calendar|google-drive|slack|notion/.test(connectorText)) hints.add("MCP/OAuth");
  if (/문서|보고서|word|excel|ppt|슬라이드|영상|remotion/.test(skillText)) hints.add("Document/Media plugins");
  return [...hints].map((hint) => sanitizeLine(hint, 80)).filter(Boolean).slice(0, 16);
}

function createSkillSourceInventory(profile, crewKitRecords, ledger) {
  const suggestionBySkill = new Map();
  for (const suggestion of ledger.suggestions ?? []) {
    const list = suggestionBySkill.get(suggestion.skillId) ?? [];
    list.push(suggestion);
    suggestionBySkill.set(suggestion.skillId, list);
  }
  return sanitizeSkillSourceRecords(
    crewKitRecords.map((record) => {
      const suggestions = suggestionBySkill.get(record.id) ?? [];
      const externalToolHints = deriveExternalToolHints(record);
      const hasExternalRoute = Boolean((record.connectorIds ?? []).length || externalToolHints.length);
      return {
        id: record.id,
        label: record.label,
        sourceKind: hasExternalRoute ? "crewkit_with_external_routes" : "app_builtin_crewkit",
        status: record.status,
        category: record.category,
        restoreMode: record.status === "active" ? "auto_restore_active_setting" : "restore_as_recommendation_candidate",
        assignedTeammateIds: (record.assignedTeammates ?? []).map((teammate) => teammate.id),
        connectorIds: record.connectorIds ?? [],
        externalToolHints,
        evidence: [
          ...(record.triggerKeywords ?? []).slice(0, 4).map((keyword) => `trigger:${keyword}`),
          ...suggestions.slice(0, 3).map((suggestion) => suggestion.reason),
        ],
        safetyBoundary: "새 PC에서는 이 소스를 읽어 CrewKit 후보와 연결 안내만 복원하고, secret/OAuth/token은 다시 승인합니다.",
        updatedAt: record.updatedAt,
      };
    }),
  );
}

function createSkillSourceInventorySummary(records) {
  const active = records.filter((record) => record.status === "active");
  const external = records.filter((record) => record.connectorIds.length || record.externalToolHints.length);
  const lines = [
    "# SkillSourceInventory",
    "",
    "ModyCrew가 앱 기본 업무 도구와 외부 연결 후보를 어떤 방식으로 다시 붙일지 저장하는 이어쓰기 목록입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Skill sources: ${records.length}`,
    `- Active restore sources: ${active.length}`,
    `- External route candidates: ${external.length}`,
    "",
    "## Restore Rule",
    "",
    "- 이 파일은 새 PC에서 업무 도구와 외부 연결 후보를 다시 추천하기 위한 목록입니다.",
    "- secret, OAuth token, API key 원문은 저장하지 않습니다.",
    "- 사용자가 켠 업무 도구만 active로 이어받고, 외부 연결은 보관함/공식 로그인/내 PC 작업 권한을 다시 확인합니다.",
    "",
    "## Sources",
    "",
  ];
  for (const record of records) {
    lines.push(`- [${record.status}] ${record.label} (${record.id})`);
    lines.push(`  - Source: ${record.sourceKind}`);
    lines.push(`  - Restore: ${record.restoreMode}`);
    lines.push(`  - Connectors: ${record.connectorIds.join(", ") || "앱 내부"}`);
    lines.push(`  - External tools: ${record.externalToolHints.join(", ") || "없음"}`);
    if (record.assignedTeammateIds.length) lines.push(`  - Assigned: ${record.assignedTeammateIds.join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

function writeSkillBootstrapPlan(root, profile, crewKitRecords, manifest) {
  const growthFolder = path.join(root, "memory", "growth");
  mkdirSync(growthFolder, { recursive: true });
  const skillSources = sanitizeSkillSourceRecords(readJsonArray(path.join(root, "memory", "growth", "skill-sources.json")));
  const plan = createSkillBootstrapPlan(profile, crewKitRecords, skillSources, manifest);
  atomicWriteJson(path.join(root, skillBootstrapPlanRelativePath), plan);
  writeFileSync(
    path.join(root, skillBootstrapPlanSummaryRelativePath),
    createSkillBootstrapPlanSummary(plan),
    "utf8",
  );
  return plan;
}

function createSkillBootstrapPlan(profile, crewKitRecords, skillSources, manifest) {
  const activeCrewKits = crewKitRecords
    .filter((record) => record.status === "active")
    .map((record) => ({
      id: sanitizeLine(record.id, 80),
      label: sanitizeLine(record.label || record.title, 120),
      category: sanitizeLine(record.category, 80),
      assignedTeammateIds: (record.assignedTeammates ?? []).map((teammate) => sanitizeLine(teammate.id, 80)).filter(Boolean),
      connectorIds: (record.connectorIds ?? []).map((id) => sanitizeLine(id, 80)).filter(Boolean),
      restoreAction: "enable_without_secret",
      safety: "설정값만 복원하고 외부 계정/OAuth/token은 새 PC에서 다시 확인합니다.",
    }));
  const recommendationCrewKits = crewKitRecords
    .filter((record) => record.status !== "active")
    .map((record) => ({
      id: sanitizeLine(record.id, 80),
      label: sanitizeLine(record.label || record.title, 120),
      category: sanitizeLine(record.category, 80),
      restoreAction: "show_as_recommendation",
    }))
    .slice(0, 30);
  const teammateChannels = (profile.teammates ?? []).map((teammate) => ({
    id: sanitizeLine(teammate.id, 80),
    templateId: sanitizeLine(teammate.templateId, 60),
    avatarId: sanitizeLine(teammate.avatarId, 64),
    name: sanitizeLine(teammate.name, 80),
    channelName: sanitizeLine(teammate.channelName, 80),
    teamLabel: sanitizeLine(teammate.teamLabel, 80),
    roleTitle: sanitizeLine(teammate.roleTitle, 120),
    skillIds: Array.isArray(teammate.skillIds) ? teammate.skillIds.map((id) => sanitizeLine(id, 80)).filter(Boolean) : [],
    crewSoulPath: `memory/crew-souls/${sanitizePathSegment(teammate.id || teammate.name || "teammate")}/CrewSoul.md`,
    promptMemoryPath: `memory/crew-souls/${sanitizePathSegment(teammate.id || teammate.name || "teammate")}/PromptMemory.md`,
  }));
  const externalReauthorization = skillSources
    .filter((source) => source.connectorIds.length || source.externalToolHints.length)
    .map((source) => ({
      skillId: source.id,
      label: source.label,
      connectorIds: source.connectorIds,
      externalToolHints: source.externalToolHints,
      requiredUserStep: "새 PC에서 계정 보관함/OAuth/Computer Use 권한을 다시 승인",
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    }));
  return {
    schema: "modycrew.skill-bootstrap-plan.v1",
    product: "ModyCrew",
    generatedAt: new Date().toISOString(),
    memoryManifestPath: portableManifestFileName,
    restoreMode: "read_folder_then_rehydrate_app_state",
    restoreOrder: [
      "ModyCrewMemoryManifest.json",
      "memory/app-profile/profile.json",
      "memory/crew-souls/CrewChannelIndex.md",
      crewChannelBlueprintRelativePath.replaceAll("\\", "/"),
      "memory/crew-kits/CrewKitIndex.md",
      "memory/growth/SkillSourceInventory.md",
      "memory/growth/SkillBootstrapPlan.md",
      "memory/prompt/PromptMemory.md",
    ],
    activeCrewKits,
    recommendationCrewKits,
    teammateChannels,
    externalReauthorization,
    counts: {
      activeCrewKits: activeCrewKits.length,
      recommendationCrewKits: recommendationCrewKits.length,
      teammateChannels: teammateChannels.length,
      externalReauthorization: externalReauthorization.length,
      manifestSkillSources: manifest?.counts?.skillSources ?? skillSources.length,
    },
    safety: [
      "이 계획은 앱 상태 복원과 추천 목록 복원용입니다.",
      "secret, OAuth token, API key, 외부 계정 비밀번호 원문은 저장하지 않습니다.",
      "외부 발송, 일정 등록, 파일 이동/삭제, 결제, 제출은 복원만으로 자동 실행하지 않습니다.",
      "공식 API가 막힌 기능은 Computer Use 또는 보관함 후보로만 표시하고 사용자가 다시 켭니다.",
    ],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createSkillBootstrapPlanSummary(plan) {
  const lines = [
    "# SkillBootstrapPlan",
    "",
    "새 PC에서 ModyCrew 기억 폴더를 선택했을 때 앱이 어떤 순서로 AI 팀원, 업무 도구, 외부 연결 후보를 다시 붙일지 읽는 계획입니다.",
    "",
    `- Generated: ${plan.generatedAt}`,
    `- Restore mode: ${plan.restoreMode}`,
    `- Active CrewKits: ${plan.counts?.activeCrewKits ?? 0}`,
    `- Recommendation CrewKits: ${plan.counts?.recommendationCrewKits ?? 0}`,
    `- Teammate channels: ${plan.counts?.teammateChannels ?? 0}`,
    `- External reauthorization: ${plan.counts?.externalReauthorization ?? 0}`,
    "",
    "## Restore Order",
    "",
    ...plan.restoreOrder.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Active CrewKits",
    "",
  ];
  if (!plan.activeCrewKits.length) {
    lines.push("- 아직 자동 복원할 활성 CrewKit이 없습니다.");
  } else {
    for (const item of plan.activeCrewKits) {
      lines.push(`- ${item.label} (${item.id})`);
      lines.push(`  - Assigned: ${item.assignedTeammateIds.join(", ") || "미지정"}`);
      lines.push(`  - Connectors: ${item.connectorIds.join(", ") || "앱 내부"}`);
    }
  }
  lines.push("", "## Teammate Channels", "");
  if (!plan.teammateChannels.length) {
    lines.push("- 아직 AI 팀원이 없습니다.");
  } else {
    for (const channel of plan.teammateChannels) {
      lines.push(`- ${channel.name} · ${channel.channelName}`);
      lines.push(`  - Role: ${channel.roleTitle}`);
      lines.push(`  - CrewSoul: ${channel.crewSoulPath}`);
    }
  }
  lines.push("", "## External Reauthorization", "");
  if (!plan.externalReauthorization.length) {
    lines.push("- 새 PC에서 재승인할 외부 기능 후보가 없습니다.");
  } else {
    for (const item of plan.externalReauthorization) {
      lines.push(`- ${item.label} (${item.skillId})`);
      lines.push(`  - Connectors: ${item.connectorIds.join(", ") || "없음"}`);
      lines.push(`  - External tools: ${item.externalToolHints.join(", ") || "없음"}`);
      lines.push(`  - Step: ${item.requiredUserStep}`);
    }
  }
  lines.push("", "## Safety", "");
  for (const rule of plan.safety) lines.push(`- ${rule}`);
  lines.push("");
  return lines.join("\n");
}

function createGrowthMemorySummary(ledger) {
  const lines = [
    "# GrowthMemory",
    "",
    "ModyCrew가 어떻게 스스로 기능을 늘리고 다음 PC에서도 같은 상태로 이어받을지에 대한 장부입니다.",
    "",
    `- Updated: ${ledger.updatedAt}`,
    `- Skill states: ${ledger.skillStates.length}`,
    `- Teammate channels: ${ledger.teammateChannels.length}`,
    `- Growth suggestions: ${ledger.suggestions?.length ?? 0}`,
    "",
    "## Rules",
    "",
  ];
  for (const rule of ledger.rules) lines.push(`- ${rule.label}: ${rule.detail}`);
  lines.push("", "## Skill States", "");
  for (const skill of ledger.skillStates) {
    lines.push(`- [${skill.status}] ${skill.label} (${skill.id})`);
  }
  lines.push("", "## Teammate Channels", "");
  for (const channel of ledger.teammateChannels) {
    lines.push(`- ${channel.name} · ${channel.channelName}: ${channel.skillIds.join(", ") || "기본"}`);
  }
  lines.push("", "## Growth Suggestions", "");
  if (ledger.suggestions?.length) {
    for (const suggestion of ledger.suggestions) {
      lines.push(`- [${suggestion.priority}] ${suggestion.title}`);
      lines.push(`  - ${suggestion.reason}`);
      lines.push(`  - 다음 행동: ${suggestion.nextAction}`);
    }
  } else {
    lines.push("- 아직 자동 제안할 만큼 반복된 업무 패턴이 없습니다.");
  }
  lines.push("");
  return lines.join("\n");
}

function createGrowthSuggestions(profile, crewKitRecords, workPatterns = [], decisions = []) {
  const activeSkillIds = new Set(profile.activeSkillIds ?? []);
  const skillById = new Map(crewKitRecords.map((record) => [record.id, record]));
  const patternGroups = groupWorkPatternsBySkill(workPatterns);
  const suggestions = [];

  for (const [skillId, patterns] of patternGroups) {
    const skill = skillById.get(skillId);
    if (!skill || patterns.length < 1) continue;
    const active = activeSkillIds.has(skillId);
    const assigned = (skill.assignedTeammates ?? []).length > 0;
    suggestions.push({
      id: `growth-${skillId}`,
      kind: active ? "strengthen_skill" : "activate_skill",
      priority: active ? "normal" : "high",
      skillId,
      skillLabel: skill.label || skill.title || skillId,
      title: active
        ? `${skill.label || skill.title}의 실행 기준을 더 구체화`
        : `${skill.label || skill.title} 활성화 추천`,
      reason: `${patterns.length}개 업무 패턴이 이 CrewKit과 맞습니다. 예: ${patterns[0].summary || patterns[0].sourceLabel}`,
      nextAction: active
        ? "반복 신호를 PromptMemory와 역할별 CrewSoul에 반영합니다."
        : "사용자가 켜면 해당 CrewKit을 활성 스킬 장부에 남깁니다.",
      evidencePatternIds: patterns.map((pattern) => pattern.id).slice(0, 8),
      connectorIds: skill.connectorIds ?? [],
      assignedTeammateIds: (skill.assignedTeammates ?? []).map((teammate) => teammate.id),
      updatedAt: new Date().toISOString(),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
    if (active && !assigned) {
      suggestions.push({
        id: `growth-${skillId}-owner`,
        kind: "assign_teammate",
        priority: "normal",
        skillId,
        skillLabel: skill.label || skill.title || skillId,
        title: `${skill.label || skill.title} 전담 직원 지정`,
        reason: "CrewKit은 켜져 있지만 담당 AI 팀원이 없습니다. 업무 오피스에서 누가 처리하는지 분리하면 병렬 작업이 쉬워집니다.",
        nextAction: "운영, 개발, 마케팅, 재무, 법무 중 가까운 팀원에게 이 CrewKit을 연결합니다.",
        evidencePatternIds: patterns.map((pattern) => pattern.id).slice(0, 6),
        connectorIds: skill.connectorIds ?? [],
        assignedTeammateIds: [],
        updatedAt: new Date().toISOString(),
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      });
    }
  }

  const repeatedRevisions = decisions.filter((decision) => decision.revisionInstruction).slice(0, 12);
  if (repeatedRevisions.length >= 1) {
    suggestions.push({
      id: "growth-decision-style",
      kind: "refine_approval_style",
      priority: repeatedRevisions.length >= 3 ? "high" : "normal",
      skillId: "approval_guard",
      skillLabel: "승인 보호",
      title: "승인 전 제안 문구 개선",
      reason: `수정 요청 ${repeatedRevisions.length}건이 DecisionMemory에 있습니다. 반복 수정 사유를 다음 초안에 먼저 반영할 수 있습니다.`,
      nextAction: "DecisionLog의 수정 지시를 역할별 PromptMemory에 요약해 다음 후보 문구를 더 보수적으로 만듭니다.",
      evidencePatternIds: repeatedRevisions.map((decision) => decision.id).slice(0, 8),
      connectorIds: [],
      assignedTeammateIds: [...new Set(repeatedRevisions.map((decision) => decision.teammateId).filter(Boolean))],
      updatedAt: new Date().toISOString(),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
  }

  return sanitizeGrowthSuggestions(suggestions)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 16);
}

function groupWorkPatternsBySkill(workPatterns) {
  const groups = new Map();
  for (const pattern of workPatterns) {
    const skillId = skillIdForWorkPattern(pattern);
    if (!skillId) continue;
    const list = groups.get(skillId) ?? [];
    list.push(pattern);
    groups.set(skillId, list);
  }
  return groups;
}

function skillIdForWorkPattern(pattern) {
  if (pattern.sourceKind === "mailops") return "mail_calendar_operator";
  if (pattern.sourceKind === "connector_recovery") return "connector_discovery";
  if (pattern.sourceKind === "folder_plan") return "folder_organizer";
  if (pattern.sourceKind === "document_learning" || pattern.sourceKind === "document_writer") return "document_writer";
  if (pattern.sourceKind === "desktop_control") return "desktop_control_operator";
  if (pattern.sourceKind === "channel_delegation") return "parallel_team_routing";
  if (pattern.sourceKind === "crewkit_activation") return sanitizeLine(pattern.metrics?.skillId || "skill_bridge_orchestrator", 80);
  if (pattern.sourceKind === "teammate_memory_update") return "work_pattern_learning";
  const combined = `${pattern.summary ?? ""} ${(pattern.signals ?? []).join(" ")}`.toLowerCase();
  if (combined.includes("ppt") || combined.includes("슬라이드") || combined.includes("발표")) return "presentation_deck";
  if (combined.includes("영상") || combined.includes("쇼츠") || combined.includes("remotion")) return "remotion_video";
  if (combined.includes("git") || combined.includes("코딩") || combined.includes("배포")) return "codex_cli_workbench";
  return "";
}

function createSkillGrowthSummary(ledger) {
  const suggestions = ledger.suggestions ?? [];
  const lines = [
    "# SkillGrowth",
    "",
    "반복 업무 패턴을 보고 ModyCrew가 어떤 CrewKit을 켜거나 강화하면 좋은지 제안하는 장부입니다.",
    "",
    `- Updated: ${ledger.updatedAt}`,
    `- Suggestions: ${suggestions.length}`,
    "",
    "## How Growth Works",
    "",
    "- 앱이 실제 업무 결과를 WorkPatternMemory와 DecisionMemory에 저장합니다.",
    "- 반복 신호를 CrewKit trigger와 비교해 필요한 스킬을 추천합니다.",
    "- 사용자가 켜기 전에는 새 기능을 자동 실행하지 않습니다.",
    "- 켜진 뒤에는 CrewSoul, PromptMemory, 업무 오피스 상태에 반영합니다.",
    "",
    "## Suggestions",
    "",
  ];
  if (!suggestions.length) {
    lines.push("- 아직 제안이 없습니다. 메일, 자료, 폴더, 문서 작업이 쌓이면 자동으로 생깁니다.");
  }
  for (const suggestion of suggestions) {
    lines.push(`- ${suggestion.title}`);
    lines.push(`  - Priority: ${suggestion.priority}`);
    lines.push(`  - Reason: ${suggestion.reason}`);
    lines.push(`  - Next: ${suggestion.nextAction}`);
  }
  lines.push("", "## Restore Rule", "");
  lines.push("- 새 PC에서는 이 파일과 skill-suggestions.json을 읽어 이전에 추천되던 업무 도구 흐름을 이어받습니다.");
  lines.push("- secret 원문은 포함하지 않으며, 외부 계정 연결은 새 PC에서 다시 승인합니다.");
  lines.push("");
  return lines.join("\n");
}

function createSkillBridgeSummary(ledger) {
  const activeSkills = (ledger.skillStates ?? []).filter((skill) => skill.status === "active");
  const lines = [
    "# SkillBridge",
    "",
    "ModyCrew가 앱 기본 업무 도구, 외부 연결 후보, 내 PC 작업 도우미 후보를 어떤 순서로 붙일지 정리하는 도구 추천 기준입니다.",
    "",
    `- Updated: ${ledger.updatedAt}`,
    `- Active skills: ${activeSkills.length}`,
    `- Teammate channels: ${ledger.teammateChannels?.length ?? 0}`,
    "",
    "## 업무 도구 추천 기준",
    "",
    "1. 사용자의 대화와 실제 업무 결과에서 필요한 업무 도구 신호를 관찰합니다.",
    "2. 바로 실행하지 않고 앱 기본 도구, 외부 계정 연결, 로컬 도구, 내 PC 작업 도우미 후보를 추천합니다.",
    "3. 사용자가 켠 도구만 도구 목록, 개선 기록, 답변 기준, 역할별 업무 방식에 반영합니다.",
    "4. 새 PC에서는 이 파일, 이어쓰기 목록, manifest를 읽어 어떤 도구가 왜 켜졌는지 이어받습니다.",
    "",
    "## External Tool Fallback",
    "",
    "- 공식 API가 있으면 공식 API와 최소 권한 OAuth를 먼저 씁니다.",
    "- 공식 API가 없거나 막히면 계정 보관함, 앱 위치, 사이트 링크, Computer Use 후보로 안내합니다.",
    "- secret 원문은 이 파일에 쓰지 않고, 보관함/OS 보안 저장소 참조만 사용합니다.",
    "",
    "## Active Skill Routes",
    "",
  ];
  if (!activeSkills.length) {
    lines.push("- 아직 활성 CrewKit이 없습니다.");
  }
  for (const skill of activeSkills) {
    lines.push(`- ${skill.label}: ${(skill.connectorIds ?? []).join(", ") || "앱 내부 기능"}`);
  }
  lines.push("");
  return lines.join("\n");
}

function createSelfGrowthContractSummary(ledger) {
  const suggestions = ledger.suggestions ?? [];
  const activeSkills = (ledger.skillStates ?? []).filter((skill) => skill.status === "active");
  const lines = [
    "# SelfGrowthContract",
    "",
    "ModyCrew가 스스로 성장한다는 것은 사용자 몰래 새 기능을 실행한다는 뜻이 아닙니다.",
    "반복 업무를 기억하고, 필요한 업무 도구와 외부 연결 후보를 추천하고, 사용자가 켠 것만 다음 답변과 업무 오피스에 반영한다는 뜻입니다.",
    "",
    `- Updated: ${ledger.updatedAt}`,
    `- Active work tools: ${activeSkills.length}`,
    `- AI teammate channels: ${ledger.teammateChannels?.length ?? 0}`,
    `- Growth suggestions: ${suggestions.length}`,
    "",
    "## Growth Loop",
    "",
    "1. 대화, 메일, 파일, 폴더, 승인/수정 기록을 WorkPatternMemory와 DecisionMemory에 저장합니다.",
    "2. 도구 추천 기준이 기록을 보고 문서 작성, 메일 운영, 코딩 자동화, 영상 제작, 메신저 승인, 내 PC 작업 도우미 같은 도구 후보를 고릅니다.",
    "3. 사용자가 켠 도구만 도구 목록, 개선 기록, 답변 기준, 역할별 업무 방식에 반영합니다.",
    "4. AI 답변 전에는 답변 기준과 역할별 업무 방식을 먼저 읽어 이전 설정과 업무 방식을 이어받습니다.",
    "5. 공식 API가 막히면 계정 보관함, 앱 위치, 사이트 링크, 내 PC 작업 도우미 대체 루트를 안내합니다.",
    "",
    "## Portable Restore",
    "",
    "- 이 파일, ModyCrewMemoryManifest.json, RESTORE.md, 업무 방식, 도구 목록, 개선 기록, 이어쓰기 목록, 답변 기준을 같은 폴더에 보관합니다.",
    "- 새 PC에서는 이 폴더를 기억 저장소로 선택하면 AI 팀원, 업무 도구, 대화 요약, 업무 도구 추천을 이어받습니다.",
    "- secret 원문은 저장하지 않으므로 외부 계정, OAuth, token은 새 PC에서 다시 승인합니다.",
    "",
    "## Safety Boundary",
    "",
    "- 외부 발송, 일정 등록, 파일 이동/삭제, 결제, 제출은 복원만으로 자동 실행하지 않습니다.",
    "- 새 기능은 추천, 사용자 확인, 활성화, 장부 기록, 실행 후보 생성 순서로만 켭니다.",
    "- 사용자가 끄거나 지운 업무 도구는 다음 저장 때 비활성 상태로 남깁니다.",
    "",
    "## Current Active Work Tools",
    "",
  ];
  if (!activeSkills.length) {
    lines.push("- 아직 사용 중인 업무 도구가 없습니다.");
  } else {
    for (const skill of activeSkills) {
      lines.push(`- ${skill.label}: ${(skill.connectorIds ?? []).join(", ") || "앱 기본 도구"}`);
    }
  }
  lines.push("", "## Current Suggestions", "");
  if (!suggestions.length) {
    lines.push("- 아직 업무 도구 추천이 없습니다. 실제 업무 기록이 쌓이면 여기에 후보가 생깁니다.");
  } else {
    for (const suggestion of suggestions.slice(0, 10)) {
      lines.push(`- ${suggestion.title}`);
      lines.push(`  - Reason: ${suggestion.reason}`);
      lines.push(`  - Next: ${suggestion.nextAction}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function createPortableRestoreGuide(profile, manifest) {
  const lines = [
    "# ModyCrew Memory Restore",
    "",
    "이 폴더는 ModyCrew의 포터블 기억 저장소입니다.",
    "",
    "## 새 PC에서 이어받는 순서",
    "",
    "1. ModyCrew 설치 앱을 실행합니다.",
    "2. 설정에서 `기억 저장 위치`를 누르고 이 폴더를 선택합니다.",
    "3. 앱이 `ModyCrewMemoryManifest.json`, `memory/app-profile/profile.json`, `memory/chat/threads.json`을 읽어 AI 팀원, 업무 도구, 대화 기억을 이어받습니다.",
    "4. `memory/CrewSoulBundle.json`을 읽어 AI 팀원, 역할, 사용 중 도구, 외부 재승인 순서를 한 번에 재구성합니다.",
    "5. `memory/chat/ConversationDigest.md`를 읽어 긴 대화에서 남겨야 할 요청, 선호, 결정, 미해결, 다음 행동을 먼저 복원합니다.",
    "6. `memory/decisions/decision-ledger.json`과 `DecisionMemory.md`를 읽어 이전 승인, 수정 요청, 보류, 거절 패턴을 참고합니다.",
    "7. `memory/prompt/PromptMemory.md`를 먼저 읽어 답변용 짧은 기억을 구성하고, 세부 근거가 필요할 때 장기 기억 파일을 엽니다.",
    "8. `memory/crew-souls/CrewChannelIndex.md`를 읽어 내부 AI 팀원 목록과 역할을 복원합니다.",
    "9. `memory/crew-souls/CrewChannelBlueprint.json`을 읽어 메인 컨트롤, 제품, 운영, 성장 그룹과 채널 배치를 복원합니다.",
    "10. `memory/growth/SkillGrowth.md`를 읽어 이전 PC에서 추천되던 업무 도구 개선 제안을 이어받습니다.",
    "11. `memory/growth/SkillBridge.md`를 읽어 앱 기본 도구, 외부 연결, 내 PC 작업 연결 방식을 이어받습니다.",
    "12. `memory/growth/SkillSourceInventory.md`와 `skill-sources.json`을 읽어 앱 기본 도구와 외부 연결 후보를 추천 목록으로 이어받습니다.",
    "13. `memory/growth/SkillBootstrapPlan.md`와 `skill-bootstrap-plan.json`을 읽어 사용 중 도구, 담당 AI 팀원, 외부 재승인 순서를 앱 상태로 되살립니다.",
    "14. `memory/growth/SelfGrowthContract.md`를 읽어 업무 도구 추천, 사용자 확인, 외부 연결 대체 루트, 안전 경계를 이어받습니다.",
    "15. `memory/growth/modycrew-workspace-skill-lifecycle.json`과 `memory/growth/WorkspaceSkillLifecycle.md`를 읽어 과거 제안과 상태를 표시합니다. 이 기록만으로 설치·활성화하지 않고 이 PC에서 설치 파일과 SHA-256을 다시 확인한 뒤 각각 사용자 승인을 받습니다.",
    "16. 외부 계정 비밀번호와 로그인 승인 원문은 이 폴더에 저장하지 않으므로 필요한 연결은 새 PC에서 다시 승인합니다.",
    "",
    "## 현재 저장된 구성",
    "",
    `- Updated: ${manifest.updatedAt}`,
    `- AI teammates: ${profile.teammates?.length ?? 0}`,
    `- Active functions: ${profile.activeSkillIds?.length ?? 0}`,
    `- Messenger channels: ${profile.activeMessengerChannelIds?.length ?? 0}`,
    `- Work decisions: ${manifest.counts?.workDecisions ?? 0}`,
    `- Conversation digests: ${manifest.counts?.conversationDigests ?? 0}`,
    `- Growth suggestions: ${manifest.counts?.growthSuggestions ?? 0}`,
    `- Skill bootstrap plans: ${manifest.counts?.skillBootstrapPlans ?? 0}`,
    `- Prompt memories: ${manifest.counts?.promptMemories ?? 0}`,
    "",
    "- Verified skill proposals: " +
      (manifest.counts?.workspaceSkillProposals ?? 0),
    "- Pending install approvals: " +
      (manifest.counts?.workspaceSkillPendingInstallApprovals ?? 0),
    "- Installed but inactive skills: " +
      (manifest.counts?.workspaceSkillsInstalledInactive ?? 0),
    "- Active verified skills: " +
      (manifest.counts?.workspaceSkillsActive ?? 0),
    "- Blocked skill proposals: " +
      (manifest.counts?.workspaceSkillsBlocked ?? 0),
    "",
    "## 안전 경계",
    "",
    "- secret 원문은 저장하지 않습니다.",
    "- 삭제, 발송, 제출, 결제는 복원만으로 자동 실행되지 않습니다.",
    "- 업무 도구 장부는 실제 실행 전에 연결 상태와 사용자 승인 여부를 다시 확인합니다.",
    "- 외부 업무 도구의 과거 활성 상태는 실행 권한이 아니며, 이 PC의 설치 파일·SHA-256 확인과 별도 설치·활성화 승인을 다시 거칩니다.",
    "- package bytes, secret 원문, 절대 설치 경로는 복원 장부에 저장하지 않습니다.",
    "- 도구 추천 기준과 이어쓰기 목록은 필요한 도구를 추천하고 사용자가 켠 도구만 이어받습니다.",
    "",
  ];
  return lines.join("\n");
}

function createCrewKitRecords(profile) {
  const activeSkillIds = new Set(profile.activeSkillIds ?? []);
  const teammates = profile.teammates ?? [];
  return (profile.skills ?? []).map((skill) => ({
    id: skill.id,
    title: skill.title,
    label: skill.crewKitLabel || `${skill.title} CrewKit`,
    category: skill.category,
    status: activeSkillIds.has(skill.id) ? "active" : "available",
    summary: skill.summary,
    installHint: skill.installHint || "사용자가 이 작업을 요청하면 채팅 안에서 필요한 연결과 권한을 열어줍니다.",
    connectorIds: skill.connectorIds ?? [],
    externalToolHints: skill.externalToolHints ?? [],
    activationSteps: skill.activationSteps ?? [],
    fallbackRoutes: skill.fallbackRoutes ?? [],
    recommendedTeam: skill.recommendedTeam || "personal",
    triggerKeywords: skill.triggerKeywords ?? [],
    assignedTeammates: teammates
      .filter((teammate) => Array.isArray(teammate.skillIds) && teammate.skillIds.includes(skill.id))
      .map((teammate) => ({
        id: teammate.id,
        name: teammate.name,
        channelName: teammate.channelName,
        roleTitle: teammate.roleTitle,
      }))
      .slice(0, 20),
    instructions: skill.instructions ?? [],
    updatedAt: profile.updatedAt,
  }));
}

function createCrewKitIndexSummary(profile, records = createCrewKitRecords(profile)) {
  const activeRecords = records.filter((record) => record.status === "active");
  const lines = [
    "# CrewKitIndex",
    "",
    "ModyCrew가 사용자의 요청을 보고 추천하거나 활성화할 수 있는 스킬 장부입니다.",
    "",
    `- Updated: ${profile.updatedAt}`,
    `- CrewKits: ${records.length}`,
    `- Active CrewKits: ${activeRecords.length}`,
    "",
    "## Active CrewKits",
    "",
  ];
  for (const record of activeRecords) {
    lines.push(`- ${record.label}: ${record.summary}`);
  }
  lines.push("", "## Available CrewKits", "");
  for (const record of records.filter((item) => item.status !== "active")) {
    lines.push(`- ${record.label}: ${record.installHint}`);
  }
  lines.push("", "## Growth Rules", "");
  lines.push("- 사용자가 반복 요청하는 업무는 관련 CrewKit의 trigger keyword와 역할별 CrewSoul에 반영합니다.");
  lines.push("- 새 기능은 먼저 추천, 사용자 확인, 로컬 장부 기록, 실행 후보 생성 순서로 켭니다.");
  lines.push("- 외부 발송, 일정 등록, 파일 삭제, 결제, 제출은 승인 전 실행하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function createCrewKitSummary(record) {
  const lines = [
    `# ${record.label}`,
    "",
    `- Status: ${record.status}`,
    `- Category: ${record.category}`,
    `- Updated: ${record.updatedAt}`,
    "",
    "## Purpose",
    "",
    record.summary,
    "",
    "## When To Recommend",
    "",
    record.installHint,
    "",
    "## Connectors",
    "",
  ];
  if (record.connectorIds.length) {
    for (const connectorId of record.connectorIds) lines.push(`- ${connectorId}`);
  } else {
    lines.push("- 앱 내부 기능만으로 시작할 수 있습니다.");
  }
  lines.push("", "## External Tool Candidates", "");
  if (record.externalToolHints?.length) {
    for (const tool of record.externalToolHints) lines.push(`- ${tool}`);
  } else {
    lines.push("- 공식 연결이 막히면 앱 내부 승인 카드와 로컬 기억으로 먼저 처리합니다.");
  }
  lines.push("", "## Assigned Crew", "");
  if (record.assignedTeammates.length) {
    for (const teammate of record.assignedTeammates) {
      lines.push(`- ${teammate.name} (${teammate.channelName}): ${teammate.roleTitle}`);
    }
  } else {
    lines.push("- 아직 전담 팀원이 없습니다. 메인 컨트롤 채널에서 먼저 처리합니다.");
  }
  lines.push("", "## Operating Instructions", "");
  for (const instruction of record.instructions) lines.push(`- ${instruction}`);
  lines.push("", "## Safety Boundary", "");
  lines.push("- 계정 비밀번호, API key, 로그인 승인 원문은 기능 파일에 저장하지 않습니다.");
  lines.push("- 실행 전 사용자에게 연결, 권한, 승인 필요 여부를 채팅 안에서 안내합니다.");
  lines.push("");
  return lines.join("\n");
}

function selectTeammateWorkPatterns(teammate, workPatterns = []) {
  const teammateId = sanitizeLine(teammate.id, 120);
  const skillIds = new Set(Array.isArray(teammate.skillIds) ? teammate.skillIds : []);
  return workPatterns
    .filter((record) => {
      if (record.teammateId) return record.teammateId === teammateId;
      const inferredSkillId = skillIdForWorkPattern(record);
      return inferredSkillId && skillIds.has(inferredSkillId);
    })
    .sort((a, b) => new Date(b.learnedAt).getTime() - new Date(a.learnedAt).getTime());
}

function selectTeammateDecisions(teammate, decisions = []) {
  const teammateId = sanitizeLine(teammate.id, 120);
  return decisions
    .filter((record) => record.teammateId === teammateId)
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime());
}

function createTeammateCrewSoulSummary(teammate, profile, workPatterns = [], decisions = []) {
  const skillMap = new Map((profile.skills ?? []).map((skill) => [skill.id, skill]));
  const teammateWork = selectTeammateWorkPatterns(teammate, workPatterns);
  const teammateDecisions = selectTeammateDecisions(teammate, decisions);
  const lines = [
    `# CrewSoul: ${teammate.name}`,
    "",
    `- Channel: ${teammate.channelName}`,
    `- Team: ${teammate.teamLabel}`,
    `- Role: ${teammate.roleTitle}`,
    `- Updated: ${profile.updatedAt}`,
    "",
    "## Mission",
    "",
    teammate.brief,
    "",
    "## Skills",
    "",
  ];
  for (const skillId of teammate.skillIds ?? []) {
    const skill = skillMap.get(skillId);
    lines.push(`- ${skill?.title ?? skillId} (${skillId}): ${skill?.summary ?? "팀원 기본 스킬"}`);
  }
  lines.push("", "## Operating Instructions", "");
  for (const instruction of teammate.instructions ?? []) {
    lines.push(`- ${instruction}`);
  }
  lines.push("", "## Learned Work Patterns", "");
  if (!teammateWork.length) {
    lines.push("- 아직 이 AI 팀원에게 누적된 메일/문서/폴더/위임 학습이 없습니다.");
  } else {
    for (const record of teammateWork.slice(0, 12)) {
      lines.push(`- [${sourceKindLabel(record.sourceKind)}] ${record.summary || record.sourceLabel}`);
      lines.push(`  - Learned: ${record.learnedAt}`);
      if (record.sourceLabel) lines.push(`  - Source: ${record.sourceLabel}`);
      for (const signal of record.signals.slice(0, 3)) lines.push(`  - ${signal}`);
    }
  }
  lines.push("", "## Recent Approval Decisions", "");
  if (!teammateDecisions.length) {
    lines.push("- 아직 이 AI 팀원의 승인/수정 결정 패턴이 없습니다.");
  } else {
    for (const decision of teammateDecisions.slice(0, 8)) {
      lines.push(`- ${delegationApprovalDecisionLabel(decision.decision || "held")}: ${decision.revisionInstruction || decision.messagePreview || decision.title}`);
      lines.push(`  - Decided: ${decision.decidedAt}`);
    }
  }
  lines.push("", "## Memory Boundary", "");
  lines.push("- 이 파일은 역할별 장기 기억 요약입니다.");
  lines.push("- WorkLog와 DecisionLog에서 반복되는 메일, 문서, 폴더, 승인 기준을 자동 반영합니다.");
  lines.push("- 계정 비밀번호, API key, 로그인 승인 원문은 이 파일에 저장하지 않습니다.");
  lines.push("");
  return lines.join("\n");
}

function sanitizePathSegment(value) {
  return String(value ?? "item")
    .replace(/[^a-z0-9_-]/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 80) || "item";
}

function countMessages(threads) {
  return threads.reduce((total, thread) => total + (Array.isArray(thread.messages) ? thread.messages.length : 0), 0);
}

function createChatSummary(threads) {
  const lines = [
    "# ModyCrew Local Chat Memory",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Threads: ${threads.length}`,
    `- Messages: ${countMessages(threads)}`,
    "",
    "## Recent Threads",
    "",
  ];
  for (const thread of threads.slice(0, 20)) {
    lines.push(`- ${thread.title || "업무 대화"} (${new Date(thread.updatedAt || Date.now()).toISOString()})`);
  }
  lines.push("");
  return lines.join("\n");
}

function createConversationDigestRecords(threads) {
  return threads
    .map((thread, index) => createConversationDigestRecord(thread, index))
    .filter(Boolean)
    .slice(0, 80);
}

function createConversationDigestRecord(thread, index = 0) {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const userLines = messages.filter((message) => message.role === "user").map((message) => message.text);
  const assistantLines = messages.filter((message) => message.role === "assistant").map((message) => message.text);
  const allLines = messages.map((message) => message.text);
  return sanitizeConversationDigestRecord({
    id: `digest-${thread.id || index}`,
    threadId: thread.id,
    teammateId: thread.teammateId || "teammate-personal-operator",
    title: thread.title || "업무 대화",
    updatedAt: new Date(thread.updatedAt || Date.now()).toISOString(),
    latestUserIntent: summarizeMemoryLine(latestUser?.text || ""),
    latestAssistantCommitment: summarizeAssistantCommitment(latestAssistant?.text || ""),
    userPreferences: pickDigestLines(userLines, /(원해|좋겠|싫|불편|편하게|간결|심플|미니멀|단일 설정|사용성|헷갈리지|딱딱 맞|폰트|두께|위치|D드라이브|저장|기억|삭제|정리|승인|보안)/u, 8),
    decisions: pickDigestLines(allLines, /(결정|승인|수정|보류|거절|해야|하지 말|남겨|제거|추가|연결|분배|위임)/u, 8),
    openQuestions: pickDigestLines(allLines, /(\?|확인 필요|안됨|실패|문제|부족|다음|나중|추후)/u, 8),
    openIssues: pickDigestLines(allLines, /(확인 필요|경고|warning|누락|없음|안됨|실패|문제|부족|client id|OAuth client|실계정|연결 필요|대기)/iu, 8),
    nextActions: pickDigestLines(assistantLines, /(다음 작업|다음에는|진행|하겠습니다|보강|수정|확인|검증|빌드|스모크)/u, 8),
    safetyBoundaries: pickDigestLines(allLines, /(비밀번호|token|토큰|API key|OAuth|secret|외부 발송|일정 등록|파일 삭제|최종 승인)/iu, 8),
    connectionHints: pickDigestLines(allLines, /(Gmail|Outlook|Google Calendar|캘린더|메일|IMAP|SMTP|OAuth|Telegram|Slack|Discord|Notion|Google Drive|연결|계정)/iu, 8),
    storageHints: pickDigestLines(allLines, /(D드라이브|C드라이브|저장 위치|저장|보관함|OS 보안 저장소|CrewSoul|ConversationDigest|PromptMemory|ModyCrew_Local_Data|기억 폴더|로컬 기억)/iu, 8),
    sourceMessageCount: messages.length,
  });
}

function summarizeAssistantCommitment(value) {
  return summarizeMemoryLine(value)
    .replace(/^진행률\s*\d+%[:：]?\s*/u, "")
    .slice(0, 240);
}

function pickDigestLines(lines, pattern, limit = 8) {
  const selected = [];
  for (const line of lines) {
    const clean = summarizeMemoryLine(line);
    if (!clean || !pattern.test(clean)) continue;
    if (!selected.includes(clean)) selected.push(clean);
    if (selected.length >= limit) break;
  }
  return selected;
}

function createConversationDigestSummary(records) {
  const lines = [
    "# ConversationDigest",
    "",
    "긴 대화를 그대로 다시 읽지 않아도 이어받을 수 있도록 요청, 선호, 결정, 미해결, 다음 행동으로 압축한 기억입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Digests: ${records.length}`,
    "",
    "## Digests",
    "",
  ];
  for (const record of records.slice(0, 24)) {
    lines.push(`### ${record.title}`);
    lines.push("");
    lines.push(`- Teammate: ${record.teammateId}`);
    lines.push(`- Updated: ${record.updatedAt}`);
    if (record.latestUserIntent) lines.push(`- Latest user intent: ${record.latestUserIntent}`);
    if (record.latestAssistantCommitment) lines.push(`- Latest assistant commitment: ${record.latestAssistantCommitment}`);
    appendDigestList(lines, "User preferences", record.userPreferences);
    appendDigestList(lines, "Decisions", record.decisions);
    appendDigestList(lines, "Open questions", record.openQuestions);
    appendDigestList(lines, "Open issues", record.openIssues);
    appendDigestList(lines, "Next actions", record.nextActions);
    appendDigestList(lines, "Safety boundaries", record.safetyBoundaries);
    appendDigestList(lines, "Connection hints", record.connectionHints);
    appendDigestList(lines, "Storage hints", record.storageHints);
    lines.push("");
  }
  lines.push("## Compression Rules", "");
  lines.push("- 원문 대화는 threads.json에 보관하고, 답변 직전에는 ConversationDigest와 PromptMemory를 우선 사용합니다.");
  lines.push("- secret 원문은 저장하지 않고, 보관함/OS 암호화 저장소 참조만 남깁니다.");
  lines.push("- 사용자가 불편하다고 말한 UI/흐름/승인 기준은 다음 답변과 작업 계획에 반영합니다.");
  lines.push("");
  return lines.join("\n");
}

function appendDigestList(lines, label, values) {
  if (!values?.length) return;
  lines.push(`- ${label}:`);
  for (const value of values.slice(0, 6)) lines.push(`  - ${value}`);
}

function createCrewContextSummary(threads) {
  const lines = [
    "# CrewContext",
    "",
    "대화가 길어져도 ModyCrew가 이어받을 수 있도록 압축한 업무 맥락입니다.",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Threads: ${threads.length}`,
    `- Messages: ${countMessages(threads)}`,
    "",
    "## Recent Working Memory",
    "",
  ];
  for (const thread of threads.slice(0, 12)) {
    const userMessages = thread.messages.filter((message) => message.role === "user").slice(-4);
    const assistantMessages = thread.messages.filter((message) => message.role === "assistant").slice(-3);
    lines.push(`### ${thread.title || "업무 대화"}`);
    lines.push("");
    lines.push(`- Teammate: ${thread.teammateId || "main"}`);
    lines.push(`- Updated: ${new Date(thread.updatedAt || Date.now()).toISOString()}`);
    if (userMessages.length) {
      lines.push("- User intents:");
      for (const message of userMessages) {
        lines.push(`  - ${summarizeMemoryLine(message.text)}`);
      }
    }
    if (assistantMessages.length) {
      lines.push("- Assistant commitments:");
      for (const message of assistantMessages) {
        lines.push(`  - ${summarizeMemoryLine(message.text)}`);
      }
    }
    lines.push("");
  }
  lines.push("## Compression Rules", "");
  lines.push("- 계정 비밀번호, API key, 로그인 승인 원문은 저장하지 않습니다.");
  lines.push("- 사용자가 반복 요청한 업무 방식, 승인 기준, 연결 필요 항목은 AI 팀원 업무 방식과 함께 다음 대화에 반영합니다.");
  lines.push("");
  return lines.join("\n");
}

function summarizeMemoryLine(value) {
  return sanitizeLine(value, 240)
    .replace(/\s+/g, " ")
    .trim();
}

function eventFocusedWindow(options = {}) {
  try {
    return options.BrowserWindow?.getFocusedWindow?.() ?? null;
  } catch {
    return null;
  }
}
