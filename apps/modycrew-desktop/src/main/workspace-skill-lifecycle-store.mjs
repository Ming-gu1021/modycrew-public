import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const workspaceSkillLifecycleFileName =
  "modycrew-workspace-skill-lifecycle.json";
export const workspaceSkillLifecycleSummaryFileName =
  "WorkspaceSkillLifecycle.md";

const previousFileName = workspaceSkillLifecycleFileName + ".previous";
const envelopeSchemaVersion = 1;
const stateSchema = "modycrew.workspace-skill-lifecycle.v1";
const maximumRecords = 200;
const defaultMaximumPackageBytes = 64 * 1024 * 1024;
const lifecycleQueues = new Map();
const lifecycleOperationLockSuffix = ".operation.lock";
const lifecycleReclaimLockSuffix = ".reclaim.lock";
const lifecycleLockWaitMilliseconds = 30_000;
const lifecycleLockStaleMilliseconds = 10 * 60_000;
const lifecycleLockHeartbeatMilliseconds = 5_000;
const lifecycleLockRetryMilliseconds = 40;
const lifecycleOperationLockSchema =
  "modycrew.workspace-skill-operation-lock.v1";
const lifecycleReclaimLockSchema =
  "modycrew.workspace-skill-operation-reclaim.v1";
const allowedWorkPackIds = new Set([
  "inquiry_response",
  "schedule_coordination",
  "report_cleanup",
  "inventory_reorder",
  "tax_contract_archive",
]);
const allowedInstallModes = new Set([
  "portable_user_space",
]);
const allowedRecordStatuses = new Set([
  "approval_required",
  "blocked_untrusted_source",
  "declined",
  "download_approved",
  "download_authorization_consumed",
  "install_failed",
  "installed_inactive",
  "activation_in_progress",
  "active",
]);

export function resolveWorkspaceSkillLifecyclePaths(memoryRoot) {
  const resolvedRoot = resolveMemoryRoot(memoryRoot);
  const growthRoot = path.join(resolvedRoot, "memory", "growth");
  return {
    memoryRoot: resolvedRoot,
    growthRoot,
    statePath: path.join(growthRoot, workspaceSkillLifecycleFileName),
    previousPath: path.join(growthRoot, previousFileName),
    summaryPath: path.join(growthRoot, workspaceSkillLifecycleSummaryFileName),
  };
}

export async function readWorkspaceSkillLifecycle(memoryRoot, options = {}) {
  const paths = resolveWorkspaceSkillLifecyclePaths(memoryRoot);
  return enqueueLifecycle(paths.statePath, options.io ?? fs, async () => {
    const loaded = await loadLifecycleState(paths, options.io ?? fs);
    return createPublicLifecycleResult(paths, loaded);
  });
}

export async function persistWorkspaceSkillProposals(input = {}, options = {}) {
  const paths = resolveWorkspaceSkillLifecyclePaths(input.memoryRoot);
  return enqueueLifecycle(paths.statePath, options.io ?? fs, async () => {
    const io = options.io ?? fs;
    const loaded = await loadLifecycleState(paths, io);
    if (loaded.writeBlocked) {
      return createRecoveryRequiredResult(paths, loaded);
    }
    const workspaceId = requireSafeWorkspaceId(input.workspaceId);
    const state = cloneState(loaded.state ?? createEmptyState());
    const proposals = Array.isArray(input.proposals) ? input.proposals : [];
    const eligibleByProposal =
      input.eligibleAgentIdsByProposal &&
      typeof input.eligibleAgentIdsByProposal === "object"
        ? input.eligibleAgentIdsByProposal
        : {};
    const now = nowIso(options);
    let addedCount = 0;
    let updatedCount = 0;
    let conflictCount = 0;

    for (const rawProposal of proposals) {
      const proposal = sanitizeProposal(rawProposal);
      if (!proposal) continue;
      const recordKey = createRecordKey(workspaceId, proposal.id);
      const eligibleAgentIds = sanitizeAgentIds(
        eligibleByProposal[proposal.id],
      );
      const existing = state.records.find(
        (candidate) => candidate.recordKey === recordKey,
      );
      const requestFingerprint =
        proposal.capabilityDecision.request.constraints.requestFingerprint;
      if (!existing) {
        state.records.push({
          recordKey,
          workspaceId,
          proposalId: proposal.id,
          proposal,
          requestFingerprint,
          eligibleAgentIds,
          proposedAt: normalizeIsoDate(
            proposal.capabilityDecision.request.issuedAt,
            now,
          ),
          lastProposedAt: now,
          status: proposal.status,
          consentReceipts: [],
          installationReceipts: [],
          activationReceipts: [],
          rawSecretMaterialStored: false,
          packageBytesStored: false,
          automaticDownload: false,
          automaticActivation: false,
        });
        addedCount += 1;
        continue;
      }
      if (existing.requestFingerprint !== requestFingerprint) {
        existing.status = "blocked_untrusted_source";
        existing.catalogConflict = true;
        existing.lastProposedAt = now;
        conflictCount += 1;
        continue;
      }
      existing.proposal = proposal;
      existing.eligibleAgentIds = eligibleAgentIds;
      existing.lastProposedAt = now;
      existing.catalogConflict = false;
      if (
        existing.status === "approval_required" ||
        existing.status === "blocked_untrusted_source"
      ) {
        existing.status = proposal.status;
      }
      updatedCount += 1;
    }

    state.records = state.records
      .sort(
        (left, right) =>
          Date.parse(right.lastProposedAt) - Date.parse(left.lastProposedAt),
      )
      .slice(0, maximumRecords);
    state.updatedAt = now;
    const persistence = await writeLifecycleState(paths, state, io);
    return {
      ...createPublicLifecycleResult(paths, {
        state,
        loadedFromPrevious: loaded.loadedFromPrevious,
        recoveryReason: loaded.recoveryReason,
        writeBlocked: false,
      }),
      status: loaded.recoveryReason
        ? "workspace_skill_lifecycle_recovered_and_updated"
        : "workspace_skill_proposals_persisted",
      addedCount,
      updatedCount,
      conflictCount,
      persistence,
      externalMutation: false,
      localMutation: true,
    };
  });
}

export async function recordWorkspaceSkillInstallDecision(
  input = {},
  options = {},
) {
  const paths = resolveWorkspaceSkillLifecyclePaths(input.memoryRoot);
  return enqueueLifecycle(paths.statePath, options.io ?? fs, async () => {
    const io = options.io ?? fs;
    const loaded = await loadLifecycleState(paths, io);
    if (loaded.writeBlocked) {
      return createRecoveryRequiredResult(paths, loaded);
    }
    const workspaceId = requireSafeWorkspaceId(input.workspaceId);
    const proposalId = requireSafeOpaqueId(input.proposalId, "proposalId");
    const decisionId = requireSafeOpaqueId(input.decisionId, "decisionId");
    const decision =
      input.decision === "approve_once" ? "approve_once" : "decline";
    const state = cloneState(loaded.state ?? createEmptyState());
    const record = findRecord(state, workspaceId, proposalId);
    if (!record) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_proposal_not_found",
        "설치 제안을 찾지 못했습니다. 최신 제안을 다시 확인해 주세요.",
      );
    }
    const interruptedConsent = [...record.consentReceipts]
      .reverse()
      .find(
        (receipt) =>
          receipt.status === "approved_for_one_download" &&
          receipt.consumedAt &&
          receipt.downloadAttemptId,
      );
    if (
      record.status === "download_authorization_consumed" &&
      interruptedConsent &&
      record.installationReceipts.length === 0
    ) {
      return createInstallReconciliationRequiredResult(
        paths,
        record,
        interruptedConsent,
      );
    }
    const existingReceipt = record.consentReceipts.find(
      (receipt) => receipt.decisionId === decisionId,
    );
    if (existingReceipt) {
      if (existingReceipt.decision !== decision) {
        return lifecycleBlockedResult(
          paths,
          "workspace_skill_decision_id_conflict",
          "같은 결정 ID에 다른 설치 결정을 사용할 수 없습니다.",
        );
      }
      return createConsentResult(paths, record, existingReceipt, true);
    }
    if (
      record.status === "installed_inactive" ||
      record.status === "activation_in_progress" ||
      record.status === "active"
    ) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_already_installed",
        "이미 설치된 업무 도구입니다. 사용 시작 여부만 별도로 결정해 주세요.",
      );
    }
    if (
      record.status === "blocked_untrusted_source" ||
      record.catalogConflict
    ) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_install_blocked",
        record.proposal.blockedReason ||
          "출처 또는 무결성 검증이 끝나지 않아 설치할 수 없습니다.",
      );
    }
    const openConsent = record.consentReceipts.find(
      (receipt) =>
        receipt.status === "approved_for_one_download" &&
        !receipt.consumedAt,
    );
    if (decision === "approve_once" && openConsent) {
      return createConsentResult(paths, record, openConsent, true);
    }
    if (typeof options.decideSkillAcquisition !== "function") {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_policy_unavailable",
        "설치 승인 정책을 불러오지 못했습니다.",
      );
    }

    const decidedAt = nowIso(options);
    const domainReceipt = options.decideSkillAcquisition(
      record.proposal,
      decision,
      decidedAt,
    );
    const consentReceipt = {
      consentId: decisionId,
      decisionId,
      proposalId,
      skillId: record.proposal.skill.skillId,
      decision,
      decidedAt,
      status: cleanLifecycleReceiptStatus(domainReceipt.status),
      canDownload: domainReceipt.canDownload === true,
      canInstall: domainReceipt.canInstall === true,
      canActivate: false,
      requestFingerprint: cleanFingerprint(
        domainReceipt.requestFingerprint,
      ),
      consumedAt: "",
      downloadAttemptId: "",
      rawSecretMaterialStored: false,
    };
    record.consentReceipts.push(consentReceipt);
    record.consentReceipts = record.consentReceipts.slice(-40);
    record.status =
      consentReceipt.status === "approved_for_one_download"
        ? "download_approved"
        : consentReceipt.status === "declined"
          ? "declined"
          : "blocked_untrusted_source";
    state.updatedAt = decidedAt;
    const persistence = await writeLifecycleState(paths, state, io);
    return {
      ...createConsentResult(paths, record, consentReceipt, false),
      persistence,
    };
  });
}
export async function installWorkspaceSkillFromApprovedProposal(
  input = {},
  options = {},
) {
  const paths = resolveWorkspaceSkillLifecyclePaths(input.memoryRoot);
  return enqueueLifecycle(paths.statePath, options.io ?? fs, async () => {
    const io = options.io ?? fs;
    const loaded = await loadLifecycleState(paths, io);
    if (loaded.writeBlocked) {
      return createRecoveryRequiredResult(paths, loaded);
    }
    const workspaceId = requireSafeWorkspaceId(input.workspaceId);
    const proposalId = requireSafeOpaqueId(input.proposalId, "proposalId");
    const consentId = requireSafeOpaqueId(input.consentId, "consentId");
    const state = cloneState(loaded.state ?? createEmptyState());
    const record = findRecord(state, workspaceId, proposalId);
    if (!record) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_proposal_not_found",
        "설치 제안을 찾지 못했습니다.",
      );
    }
    const latestInstall =
      record.installationReceipts[record.installationReceipts.length - 1];
    if (
      latestInstall &&
      (record.status === "installed_inactive" ||
        record.status === "activation_in_progress" ||
        record.status === "active")
    ) {
      return createInstallResult(
        paths,
        record,
        latestInstall,
        "workspace_skill_already_installed",
      );
    }
    const consent = record.consentReceipts.find(
      (candidate) => candidate.consentId === consentId,
    );
    if (
      !consent ||
      consent.status !== "approved_for_one_download" ||
      !consent.canDownload ||
      !consent.canInstall
    ) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_install_consent_missing",
        "이 버전과 권한 범위에 대한 1회 설치 승인이 필요합니다.",
      );
    }
    if (consent.consumedAt) {
      return await reconcileWorkspaceSkillInstallAttempt({
        paths,
        state,
        record,
        consent,
        options,
        io,
      });
    }
    if (
      consent.requestFingerprint !== record.requestFingerprint ||
      typeof options.decideSkillAcquisition !== "function"
    ) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_install_contract_mismatch",
        "저장된 설치 승인과 현재 제안의 무결성 범위가 일치하지 않습니다.",
      );
    }
    const policyReceipt = options.decideSkillAcquisition(
      record.proposal,
      "approve_once",
      consent.decidedAt,
    );
    if (
      policyReceipt.status !== "approved_for_one_download" ||
      policyReceipt.requestFingerprint !== record.requestFingerprint
    ) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_install_policy_blocked",
        policyReceipt.userMessage ||
          "현재 정책으로는 이 업무 도구를 설치할 수 없습니다.",
      );
    }
    if (
      typeof options.downloadCatalogSkill !== "function" ||
      typeof options.installCatalogSkill !== "function"
    ) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_install_executor_unavailable",
        "설치 승인은 저장했습니다. 공식 다운로드 실행기가 준비되면 이 승인 범위로 한 번 설치할 수 있습니다.",
      );
    }

    const startedAt = nowIso(options);
    const attemptId =
      "skill-install-" +
      sha256(
        record.recordKey +
          "|" +
          consent.consentId +
          "|" +
          record.requestFingerprint,
      ).slice(0, 24);
    consent.consumedAt = startedAt;
    consent.downloadAttemptId = attemptId;
    record.status = "download_authorization_consumed";
    state.updatedAt = startedAt;
    await writeLifecycleState(paths, state, io);

    let installExecutorStarted = false;
    try {
      const downloadResult = await options.downloadCatalogSkill({
        proposalId,
        skill: cloneJson(record.proposal.skill),
        sourceUrl: record.proposal.skill.sourceUrl,
        requestFingerprint: record.requestFingerprint,
        consentId,
        attemptId,
        maximumPackageBytes:
          finitePositive(options.maximumPackageBytes) ||
          defaultMaximumPackageBytes,
      });
      const packageBytes = normalizePackageBytes(
        downloadResult?.packageBytes,
      );
      const maximumPackageBytes =
        finitePositive(options.maximumPackageBytes) ||
        defaultMaximumPackageBytes;
      if (!packageBytes.length || packageBytes.length > maximumPackageBytes) {
        throw lifecycleError("package_size_invalid");
      }
      const verifiedIntegritySha256 = sha256(packageBytes);
      if (
        verifiedIntegritySha256 !==
        record.proposal.skill.integritySha256.toLowerCase()
      ) {
        throw lifecycleError("integrity_mismatch");
      }
      installExecutorStarted = true;
      const installResult = await options.installCatalogSkill({
        proposalId,
        skill: cloneJson(record.proposal.skill),
        packageBytes,
        verifiedIntegritySha256,
        requestFingerprint: record.requestFingerprint,
        consentId,
        attemptId,
      });
      const installedAt = normalizeIsoDate(
        installResult?.installedAt,
        nowIso(options),
      );
      if (
        installResult?.status !== "installed_inactive" ||
        installResult?.skillId !== record.proposal.skill.skillId ||
        installResult?.version !== record.proposal.skill.version ||
        String(installResult?.integritySha256 ?? "").toLowerCase() !==
          verifiedIntegritySha256 ||
        installResult?.installMode !== record.proposal.skill.installMode ||
        installResult?.activated === true
      ) {
        throw lifecycleError("install_receipt_invalid");
      }
      const installationReceipt = {
        installationId:
          safeOptionalOpaqueId(installResult.installationId) || attemptId,
        proposalId,
        skillId: record.proposal.skill.skillId,
        version: record.proposal.skill.version,
        installMode: record.proposal.skill.installMode,
        requestFingerprint: record.requestFingerprint,
        verifiedIntegritySha256,
        packageBytes: packageBytes.length,
        installedAt,
        status: "installed_inactive",
        activated: false,
        rawSecretMaterialStored: false,
        packageBytesStored: false,
      };
      record.installationReceipts.push(installationReceipt);
      record.installationReceipts =
        record.installationReceipts.slice(-20);
      record.status = "installed_inactive";
      record.lastInstallFailure = "";
      state.updatedAt = installedAt;
      const persistence = await writeLifecycleState(paths, state, io);
      return {
        ...createInstallResult(
          paths,
          record,
          installationReceipt,
          "workspace_skill_installed_inactive",
        ),
        persistence,
      };
    } catch (error) {
      const reconciliationRequired = installExecutorStarted;
      record.status = reconciliationRequired
        ? "download_authorization_consumed"
        : "install_failed";
      record.lastInstallFailure = reconciliationRequired
        ? "install_outcome_unverified"
        : cleanInstallFailureCode(error);
      state.updatedAt = nowIso(options);
      const persistence = await writeLifecycleState(paths, state, io);
      return {
        status: reconciliationRequired
          ? "workspace_skill_install_reconciliation_required"
          : "workspace_skill_install_failed",
        proposalId,
        skillId: record.proposal.skill.skillId,
        consentConsumed: true,
        attemptId,
        failureCode: record.lastInstallFailure,
        reconciliationRequired,
        downloadStarted: true,
        installed: false,
        installationState: reconciliationRequired ? "unknown" : "not_installed",
        activated: false,
        activationRequiresSeparateUserAction: true,
        persistence,
        statePath: paths.statePath,
        externalMutation: installExecutorStarted,
        externalMutationUncertain: reconciliationRequired,
        localMutation: true,
        rawSecretMaterialStored: false,
        packageBytesStored: false,
        userMessage: reconciliationRequired
          ? "설치 실행기의 결과를 확인하지 못했습니다. 다시 다운로드하지 않고 이 PC의 설치 상태를 먼저 확인합니다."
          : "업무 도구 설치를 완료하지 못했습니다. 같은 승인으로 다시 다운로드하지 않고 새 확인을 요청합니다.",
      };
    }
  });
}

export async function recordWorkspaceSkillActivationDecision(
  input = {},
  options = {},
) {
  const paths = resolveWorkspaceSkillLifecyclePaths(input.memoryRoot);
  return enqueueLifecycle(paths.statePath, options.io ?? fs, async () => {
    const io = options.io ?? fs;
    const loaded = await loadLifecycleState(paths, io);
    if (loaded.writeBlocked) {
      return createRecoveryRequiredResult(paths, loaded);
    }
    const workspaceId = requireSafeWorkspaceId(input.workspaceId);
    const proposalId = requireSafeOpaqueId(input.proposalId, "proposalId");
    const decisionId = requireSafeOpaqueId(input.decisionId, "decisionId");
    const decision =
      input.decision === "activate" ? "activate" : "keep_inactive";
    const requestedTargetAgentId =
      decision === "activate"
        ? requireSafeAgentId(input.targetAgentId)
        : "";
    const state = cloneState(loaded.state ?? createEmptyState());
    const record = findRecord(state, workspaceId, proposalId);
    if (!record) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_proposal_not_found",
        "사용 시작 제안을 찾지 못했습니다.",
      );
    }
    const interruptedActivation = [...record.activationReceipts]
      .reverse()
      .find((receipt) => receipt.status === "activation_in_progress");
    if (record.status === "activation_in_progress" && interruptedActivation) {
      if (interruptedActivation.targetAgentId !== requestedTargetAgentId) {
        return lifecycleBlockedResult(
          paths,
          "workspace_skill_activation_target_conflict",
          "진행 중인 활성화는 다른 AI 팀원에게 바꿀 수 없습니다.",
        );
      }
      return await reconcileWorkspaceSkillActivationAttempt({
        paths,
        state,
        record,
        receipt: interruptedActivation,
        options,
        io,
      });
    }
    const existingReceipt = record.activationReceipts.find(
      (receipt) => receipt.decisionId === decisionId,
    );
    if (existingReceipt?.status === "activated") {
      if (existingReceipt.targetAgentId !== requestedTargetAgentId) {
        return lifecycleBlockedResult(
          paths,
          "workspace_skill_activation_target_conflict",
          "같은 활성화 결정 ID를 다른 AI 팀원에게 사용할 수 없습니다.",
        );
      }
      return createActivationResult(
        paths,
        record,
        existingReceipt,
        "workspace_skill_already_active",
      );
    }
    const activeReceipt = [...record.activationReceipts]
      .reverse()
      .find((receipt) => receipt.status === "activated");
    if (record.status === "active" && activeReceipt) {
      if (activeReceipt.targetAgentId !== requestedTargetAgentId) {
        return lifecycleBlockedResult(
          paths,
          "workspace_skill_activation_target_conflict",
          "이미 다른 AI 팀원에게 활성화된 업무 도구입니다.",
        );
      }
      return createActivationResult(
        paths,
        record,
        activeReceipt,
        "workspace_skill_already_active",
      );
    }
    if (existingReceipt?.status === "activation_failed") {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_activation_decision_consumed",
        "이 활성화 결정은 이미 종료되었습니다. 다시 시도하려면 새로 확인해 주세요.",
      );
    }
    if (existingReceipt?.status === "activation_in_progress") {
      return createActivationReconciliationRequiredResult(
        paths,
        record,
        existingReceipt,
      );
    }    if (
      existingReceipt &&
      existingReceipt.decision !== decision
    ) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_activation_decision_id_conflict",
        "같은 결정 ID에 다른 사용 시작 결정을 사용할 수 없습니다.",
      );
    }
    const installation =
      record.installationReceipts[record.installationReceipts.length - 1];
    if (!installation || installation.status !== "installed_inactive") {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_activation_requires_verified_install",
        "검증된 설치 완료 증거가 있어야 사용을 시작할 수 있습니다.",
      );
    }
    const decidedAt = nowIso(options);
    if (decision === "keep_inactive") {
      const inactiveReceipt =
        existingReceipt ?? {
          activationId: decisionId,
          decisionId,
          proposalId,
          skillId: record.proposal.skill.skillId,
          installationId: installation.installationId,
          decision,
          decidedAt,
          targetAgentId: "",
          requestFingerprint: record.requestFingerprint,
          status: "kept_inactive",
          rawSecretMaterialStored: false,
        };
      if (!existingReceipt) {
        record.activationReceipts.push(inactiveReceipt);
      }
      record.status = "installed_inactive";
      state.updatedAt = decidedAt;
      const persistence = await writeLifecycleState(paths, state, io);
      return {
        ...createActivationResult(
          paths,
          record,
          inactiveReceipt,
          "workspace_skill_kept_inactive",
        ),
        persistence,
      };
    }

    const targetAgentId = requestedTargetAgentId;
    if (!record.eligibleAgentIds.includes(targetAgentId)) {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_activation_agent_not_eligible",
        "이 업무 도구를 맡을 수 있는 명시된 AI 팀원을 선택해 주세요.",
      );
    }
    if (typeof options.activateCatalogSkill !== "function") {
      return lifecycleBlockedResult(
        paths,
        "workspace_skill_activation_executor_unavailable",
        "설치는 완료됐지만 사용 시작 실행기가 준비되지 않아 비활성 상태로 유지합니다.",
      );
    }

    const activationReceipt =
      existingReceipt ?? {
        activationId: decisionId,
        decisionId,
        proposalId,
        skillId: record.proposal.skill.skillId,
        installationId: installation.installationId,
        decision,
        decidedAt,
        targetAgentId,
        requestFingerprint: record.requestFingerprint,
        status: "activation_in_progress",
        rawSecretMaterialStored: false,
      };
    if (!existingReceipt) {
      record.activationReceipts.push(activationReceipt);
    }
    record.status = "activation_in_progress";
    state.updatedAt = decidedAt;
    await writeLifecycleState(paths, state, io);

    try {
      const activationResult = await options.activateCatalogSkill({
        proposalId,
        skill: cloneJson(record.proposal.skill),
        installation: cloneJson(installation),
        targetAgentId,
        activationId: activationReceipt.activationId,
      });
      if (
        activationResult?.status !== "activated" ||
        activationResult?.skillId !== record.proposal.skill.skillId ||
        activationResult?.version !== record.proposal.skill.version ||
        activationResult?.targetAgentId !== targetAgentId
      ) {
        throw lifecycleError("activation_receipt_invalid");
      }
      activationReceipt.status = "activated";
      activationReceipt.activatedAt = normalizeIsoDate(
        activationResult.activatedAt,
        nowIso(options),
      );
      record.status = "active";
      record.activeTargetAgentId = targetAgentId;
      state.updatedAt = activationReceipt.activatedAt;
      const persistence = await writeLifecycleState(paths, state, io);
      return {
        ...createActivationResult(
          paths,
          record,
          activationReceipt,
          "workspace_skill_activated",
        ),
        persistence,
      };
    } catch {
      activationReceipt.status = "activation_in_progress";
      record.status = "activation_in_progress";
      state.updatedAt = nowIso(options);
      const persistence = await writeLifecycleState(paths, state, io);
      return {
        status: "workspace_skill_activation_reconciliation_required",
        proposalId,
        skillId: record.proposal.skill.skillId,
        activationId: activationReceipt.activationId,
        installed: true,
        activated: false,
        activationState: "unknown",
        reconciliationRequired: true,
        activationRequiresSeparateUserAction: true,
        persistence,
        statePath: paths.statePath,
        externalMutation: true,
        externalMutationUncertain: true,
        localMutation: true,
        rawSecretMaterialStored: false,
        packageBytesStored: false,
        userMessage:
          "활성화 실행기의 결과를 확인하지 못했습니다. 다시 실행하지 않고 이 PC의 활성 상태를 먼저 확인합니다.",
      };
    }
  });
}
export function summarizeWorkspaceSkillLifecycle(records = []) {
  const safeRecords = Array.isArray(records) ? records : [];
  return {
    proposalCount: safeRecords.length,
    pendingInstallApprovalCount: safeRecords.filter(
      (record) => record.status === "approval_required",
    ).length,
    downloadApprovedCount: safeRecords.filter(
      (record) => record.status === "download_approved",
    ).length,
    installedInactiveCount: safeRecords.filter(
      (record) => record.status === "installed_inactive",
    ).length,
    activeCount: safeRecords.filter(
      (record) => record.status === "active",
    ).length,
    blockedCount: safeRecords.filter(
      (record) =>
        record.status === "blocked_untrusted_source" ||
        record.catalogConflict,
    ).length,
    historicalInstalledSkillIds: [
      ...new Set(
        safeRecords
          .filter((record) =>
            ["installed_inactive", "activation_in_progress", "active"].includes(
              record.status,
            ),
          )
          .map((record) => record.proposal?.skill?.skillId)
          .filter(Boolean),
      ),
    ],
    historicalActiveAssignments: safeRecords
      .filter(
        (record) =>
          record.status === "active" &&
          record.activeTargetAgentId,
      )
      .map((record) => ({
        skillId: record.proposal.skill.skillId,
        targetAgentId: record.activeTargetAgentId,
        supportedWorkPackIds: [
          ...record.proposal.skill.supportedWorkPackIds,
        ],
      })),
  };
}

function createEmptyState() {
  return {
    schema: stateSchema,
    updatedAt: "",
    records: [],
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    automaticDownload: false,
    automaticActivation: false,
  };
}

function createPublicLifecycleResult(paths, loaded) {
  const state = loaded.state ?? createEmptyState();
  const records = state.records.map(toPublicRecord);
  return {
    status: loaded.recoveryReason
      ? loaded.writeBlocked
        ? "workspace_skill_lifecycle_recovery_required"
        : "workspace_skill_lifecycle_recovered"
      : "workspace_skill_lifecycle_loaded",
    statePath: paths.statePath,
    summaryPath: paths.summaryPath,
    records,
    ...summarizeWorkspaceSkillLifecycle(records),
    recoveredFromPreviousState: loaded.loadedFromPrevious,
    recoveryReason: loaded.recoveryReason,
    writeBlocked: loaded.writeBlocked,
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    automaticDownload: false,
    automaticActivation: false,
    externalMutation: false,
  };
}

function createRecoveryRequiredResult(paths, loaded) {
  return {
    ...createPublicLifecycleResult(paths, loaded),
    status: "workspace_skill_lifecycle_recovery_required",
    persistence: {
      saved: false,
      atomicReplace: false,
      recoverableBackup: Boolean(loaded.loadedFromPrevious),
      bytesWritten: 0,
    },
    userMessage:
      "스킬 장부의 손상 가능성이 있어 이전 상태를 보호했습니다. 복구 확인 전에는 설치나 활성화를 진행하지 않습니다.",
  };
}

function lifecycleBlockedResult(paths, status, userMessage) {
  return {
    status,
    statePath: paths.statePath,
    downloadStarted: false,
    installed: false,
    activated: false,
    activationRequiresSeparateUserAction: true,
    externalMutation: false,
    localMutation: false,
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    userMessage,
  };
}

function createInstallReconciliationRequiredResult(paths, record, consent) {
  return {
    ...lifecycleBlockedResult(
      paths,
      "workspace_skill_install_reconciliation_required",
      "이전 설치 시도의 결과가 확정되지 않았습니다. 다시 다운로드하지 않고 이 PC의 설치 상태를 먼저 확인합니다.",
    ),
    proposalId: record.proposalId,
    skillId: record.proposal.skill.skillId,
    consentConsumed: true,
    attemptId: consent.downloadAttemptId || "",
    reconciliationRequired: true,
    installationState: "unknown",
  };
}

async function reconcileWorkspaceSkillInstallAttempt({
  paths,
  state,
  record,
  consent,
  options,
  io,
}) {
  const attemptId = safeOptionalOpaqueId(consent.downloadAttemptId);
  if (!attemptId || typeof options.inspectCatalogSkillInstallAttempt !== "function") {
    return createInstallReconciliationRequiredResult(paths, record, consent);
  }
  let inspected;
  try {
    inspected = await options.inspectCatalogSkillInstallAttempt({
      workspaceId: record.workspaceId,
      proposalId: record.proposalId,
      skillId: record.proposal.skill.skillId,
      version: record.proposal.skill.version,
      integritySha256: record.proposal.skill.integritySha256,
      installMode: record.proposal.skill.installMode,
      requestFingerprint: record.requestFingerprint,
      consentId: consent.consentId,
      attemptId,
    });
  } catch {
    return createInstallReconciliationRequiredResult(paths, record, consent);
  }
  const bindingMatches =
    inspected?.verified === true &&
    inspected?.workspaceId === record.workspaceId &&
    inspected?.proposalId === record.proposalId &&
    inspected?.consentId === consent.consentId &&
    inspected?.attemptId === attemptId &&
    inspected?.skillId === record.proposal.skill.skillId &&
    inspected?.version === record.proposal.skill.version &&
    inspected?.requestFingerprint === record.requestFingerprint &&
    String(inspected?.integritySha256 ?? "").toLowerCase() ===
      record.proposal.skill.integritySha256.toLowerCase() &&
    inspected?.installMode === record.proposal.skill.installMode;
  if (!bindingMatches) {
    return createInstallReconciliationRequiredResult(paths, record, consent);
  }
  if (
    inspected.status === "not_installed" &&
    inspected.installed === false &&
    inspected.activated === false
  ) {
    record.status = "install_failed";
    record.lastInstallFailure = "reconciled_not_installed";
    state.updatedAt = nowIso(options);
    const persistence = await writeLifecycleState(paths, state, io);
    return {
      ...lifecycleBlockedResult(
        paths,
        "workspace_skill_install_reconciled_not_installed",
        "이 PC에 설치되지 않은 것을 확인했습니다. 다시 설치하려면 새로 승인해 주세요.",
      ),
      proposalId: record.proposalId,
      skillId: record.proposal.skill.skillId,
      consentConsumed: true,
      attemptId,
      reconciliationRequired: false,
      installationState: "not_installed",
      persistence,
      localMutation: true,
    };
  }
  const verifiedIntegritySha256 = String(
    inspected?.integritySha256 ?? "",
  ).toLowerCase();
  if (
    inspected?.status !== "installed_inactive" ||
    inspected?.installed !== true ||
    inspected?.activated !== false ||
    verifiedIntegritySha256 !==
      record.proposal.skill.integritySha256.toLowerCase()
  ) {
    return createInstallReconciliationRequiredResult(paths, record, consent);
  }
  const installedAt = normalizeIsoDate(
    inspected.installedAt,
    nowIso(options),
  );
  const installationId = safeOptionalOpaqueId(inspected.installationId);
  if (!installationId) {
    return createInstallReconciliationRequiredResult(paths, record, consent);
  }
  const installationReceipt = {
    installationId,
    proposalId: record.proposalId,
    skillId: record.proposal.skill.skillId,
    version: record.proposal.skill.version,
    installMode: record.proposal.skill.installMode,
    requestFingerprint: record.requestFingerprint,
    verifiedIntegritySha256,
    packageBytes: 0,
    installedAt,
    status: "installed_inactive",
    activated: false,
    rawSecretMaterialStored: false,
    packageBytesStored: false,
  };
  record.installationReceipts.push(installationReceipt);
  record.installationReceipts = record.installationReceipts.slice(-20);
  record.status = "installed_inactive";
  record.lastInstallFailure = "";
  state.updatedAt = installedAt;
  const persistence = await writeLifecycleState(paths, state, io);
  return {
    ...createInstallResult(
      paths,
      record,
      installationReceipt,
      "workspace_skill_install_reconciled_inactive",
    ),
    attemptId,
    reconciled: true,
    reconciliationRequired: false,
    downloadStarted: false,
    persistence,
  };
}
function createActivationReconciliationRequiredResult(paths, record, receipt) {
  return {
    ...lifecycleBlockedResult(
      paths,
      "workspace_skill_activation_reconciliation_required",
      "이전 활성화 시도의 결과가 확정되지 않았습니다. 다시 실행하지 않고 이 PC의 활성 상태를 먼저 확인합니다.",
    ),
    proposalId: record.proposalId,
    skillId: record.proposal.skill.skillId,
    activationId: receipt.activationId,
    installed: true,
    activationState: "unknown",
    reconciliationRequired: true,
  };
}

async function reconcileWorkspaceSkillActivationAttempt({
  paths,
  state,
  record,
  receipt,
  options,
  io,
}) {
  if (typeof options.inspectCatalogSkillActivationAttempt !== "function") {
    return createActivationReconciliationRequiredResult(
      paths,
      record,
      receipt,
    );
  }
  let inspected;
  try {
    inspected = await options.inspectCatalogSkillActivationAttempt({
      workspaceId: record.workspaceId,
      proposalId: record.proposalId,
      skillId: record.proposal.skill.skillId,
      version: record.proposal.skill.version,
      requestFingerprint: record.requestFingerprint,
      activationId: receipt.activationId,
      installationId: receipt.installationId,
      integritySha256: record.proposal.skill.integritySha256,
      installMode: record.proposal.skill.installMode,
      targetAgentId: receipt.targetAgentId,
    });
  } catch {
    return createActivationReconciliationRequiredResult(
      paths,
      record,
      receipt,
    );
  }
  const bindingMatches =
    inspected?.verified === true &&
    inspected?.installed === true &&
    inspected?.workspaceId === record.workspaceId &&
    inspected?.proposalId === record.proposalId &&
    inspected?.installationId === receipt.installationId &&
    inspected?.activationId === receipt.activationId &&
    inspected?.skillId === record.proposal.skill.skillId &&
    inspected?.version === record.proposal.skill.version &&
    inspected?.requestFingerprint === record.requestFingerprint &&
    String(inspected?.integritySha256 ?? "").toLowerCase() ===
      record.proposal.skill.integritySha256.toLowerCase() &&
    inspected?.installMode === record.proposal.skill.installMode &&
    inspected?.targetAgentId === receipt.targetAgentId;
  if (!bindingMatches) {
    return createActivationReconciliationRequiredResult(
      paths,
      record,
      receipt,
    );
  }
  if (inspected.status === "inactive" && inspected.active === false) {
    receipt.status = "activation_failed";
    record.status = "installed_inactive";
    state.updatedAt = nowIso(options);
    const persistence = await writeLifecycleState(paths, state, io);
    return {
      ...createActivationResult(
        paths,
        record,
        receipt,
        "workspace_skill_activation_reconciled_inactive",
      ),
      reconciled: true,
      reconciliationRequired: false,
      activationState: "inactive",
      persistence,
    };
  }
  if (inspected.status !== "activated" || inspected.active !== true) {
    return createActivationReconciliationRequiredResult(
      paths,
      record,
      receipt,
    );
  }
  receipt.status = "activated";
  receipt.activatedAt = normalizeIsoDate(
    inspected.activatedAt,
    nowIso(options),
  );
  record.status = "active";
  record.activeTargetAgentId = receipt.targetAgentId;
  state.updatedAt = receipt.activatedAt;
  const persistence = await writeLifecycleState(paths, state, io);
  return {
    ...createActivationResult(
      paths,
      record,
      receipt,
      "workspace_skill_activation_reconciled_active",
    ),
    reconciled: true,
    reconciliationRequired: false,
    activationState: "active",
    persistence,
  };
}
function createConsentResult(paths, record, receipt, idempotent) {
  return {
    status:
      receipt.status === "approved_for_one_download"
        ? "workspace_skill_download_approved_once"
        : receipt.status === "declined"
          ? "workspace_skill_install_declined"
          : "workspace_skill_install_blocked",
    statePath: paths.statePath,
    proposalId: record.proposalId,
    skillId: record.proposal.skill.skillId,
    consent: cloneJson(receipt),
    idempotent,
    downloadStarted: false,
    installed: false,
    activated: false,
    activationRequiresSeparateUserAction: true,
    externalMutation: false,
    localMutation: !idempotent,
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    userMessage:
      receipt.status === "approved_for_one_download"
        ? "이 버전과 권한 범위의 다운로드·설치를 한 번 허용했습니다. 설치 후에도 사용 시작은 별도로 확인합니다."
        : receipt.status === "declined"
          ? "설치하지 않고 기존 업무 방식으로 계속합니다."
          : "현재 제안은 설치할 수 없습니다.",
  };
}

function createInstallResult(paths, record, receipt, status) {
  return {
    status,
    statePath: paths.statePath,
    proposalId: record.proposalId,
    skillId: record.proposal.skill.skillId,
    installation: cloneJson(receipt),
    consentConsumed: true,
    downloadStarted: true,
    installed: true,
    activated: record.status === "active",
    activationRequiresSeparateUserAction: true,
    externalMutation: false,
    localMutation: status !== "workspace_skill_already_installed",
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    userMessage:
      status === "workspace_skill_already_installed"
        ? "이미 설치된 업무 도구입니다. 사용 시작 여부를 확인해 주세요."
        : "무결성을 확인해 사용자 영역에 설치했습니다. 아직 사용하지 않으며, 어떤 AI 팀원에게 켤지 별도 확인이 필요합니다.",
  };
}

function createActivationResult(paths, record, receipt, status) {
  return {
    status,
    statePath: paths.statePath,
    proposalId: record.proposalId,
    skillId: record.proposal.skill.skillId,
    activation: cloneJson(receipt),
    installed: true,
    activated:
      status === "workspace_skill_activated" ||
      status === "workspace_skill_already_active" ||
      status === "workspace_skill_activation_reconciled_active",
    activationRequiresSeparateUserAction: true,
    externalMutation: false,
    localMutation: status !== "workspace_skill_already_active",
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    userMessage:
      status === "workspace_skill_kept_inactive" ||
      status === "workspace_skill_activation_reconciled_inactive"
        ? "이 PC에서 비활성 상태인 것을 확인해 다시 실행하지 않았습니다."
        : status === "workspace_skill_already_active"
          ? "이미 선택한 AI 팀원에게 활성화된 업무 도구입니다."
          : status === "workspace_skill_activation_reconciled_active"
            ? "이 PC에서 이미 활성화된 것을 확인해 중복 실행하지 않았습니다."
            : "별도 확인에 따라 선택한 AI 팀원에게만 업무 도구를 활성화했습니다.",
  };
}

function findRecord(state, workspaceId, proposalId) {
  const recordKey = createRecordKey(workspaceId, proposalId);
  return state.records.find(
    (record) => record.recordKey === recordKey,
  );
}

function createRecordKey(workspaceId, proposalId) {
  return workspaceId + ":" + proposalId;
}
function sanitizeProposal(value) {
  if (!value || typeof value !== "object") return undefined;
  const id = safeOptionalOpaqueId(value.id);
  const skill = sanitizeSkillCandidate(value.skill);
  const capabilityDecision = sanitizeCapabilityDecision(
    value.capabilityDecision,
  );
  const status =
    value.status === "approval_required"
      ? "approval_required"
      : "blocked_untrusted_source";
  if (!id || !skill || !capabilityDecision) return undefined;
  return {
    id,
    skill,
    relatedWorkPackIds: sanitizeWorkPackIds(
      value.relatedWorkPackIds,
    ),
    evidenceCount: finiteNonNegative(value.evidenceCount),
    reason: cleanLine(value.reason, 600),
    status,
    blockedReason: cleanLine(value.blockedReason, 400),
    userQuestion: cleanLine(value.userQuestion, 600),
    requiresUserApprovalBeforeDownload: true,
    downloadStarted: false,
    installed: false,
    activated: false,
    activationRequiresSeparateUserAction: true,
    capabilityDecision,
  };
}

function sanitizeSkillCandidate(value) {
  if (!value || typeof value !== "object") return undefined;
  const skillId = requireSafeSkillIdOrEmpty(value.skillId);
  const version = cleanLine(value.version, 80);
  const installMode = String(value.installMode ?? "");
  if (
    !skillId ||
    !version ||
    !allowedInstallModes.has(installMode)
  ) {
    return undefined;
  }
  const sourceUrl = sanitizeCatalogSourceUrl(value.sourceUrl);
  const trust =
    value.trust === "verified_catalog" ||
    value.trust === "publisher_signed"
      ? value.trust
      : "unverified";
  return {
    skillId,
    title: cleanLine(value.title, 160),
    version,
    publisher: cleanLine(value.publisher, 160),
    sourceUrl,
    license: cleanLine(value.license, 120),
    integritySha256: cleanSha256(value.integritySha256),
    trust,
    installMode,
    supportedWorkPackIds: sanitizeWorkPackIds(
      value.supportedWorkPackIds,
    ),
    requestedCapabilities: cleanStringArray(
      value.requestedCapabilities,
      40,
      100,
    ),
    requestedNetworkHosts: cleanStringArray(
      value.requestedNetworkHosts,
      40,
      180,
    ),
    requestedFolderScope:
      value.requestedFolderScope === "selected_workspace_only"
        ? "selected_workspace_only"
        : "none",
  };
}

function sanitizeCapabilityDecision(value) {
  const request = value?.request;
  const resourceScope = request?.resourceScope;
  const constraints = request?.constraints;
  if (
    !value ||
    !request ||
    !resourceScope ||
    !constraints ||
    resourceScope.kind !== "catalog_tool"
  ) {
    return undefined;
  }
  return {
    policyVersion: Number(value.policyVersion) || 0,
    request: {
      grantId: cleanLine(request.grantId, 180),
      agentId: cleanLine(request.agentId, 80),
      connectorId: cleanLine(request.connectorId, 120),
      capabilityId: cleanLine(request.capabilityId, 180),
      action: cleanLine(request.action, 80),
      riskLevel: cleanLine(request.riskLevel, 80),
      resourceScope: {
        kind: "catalog_tool",
        catalogToolId: requireSafeSkillIdOrEmpty(
          resourceScope.catalogToolId,
        ),
        installMode: allowedInstallModes.has(
          resourceScope.installMode,
        )
          ? resourceScope.installMode
          : "portable_user_space",
      },
      dataClass: cleanLine(request.dataClass, 80),
      duration: cleanLine(request.duration, 80),
      constraints: {
        selectedScopeOnly:
          constraints.selectedScopeOnly === true,
        externalMutation: constraints.externalMutation === true,
        reversible: constraints.reversible === true,
        undoRequired: constraints.undoRequired === true,
        dryRunRequired: constraints.dryRunRequired === true,
        finalUserPresenceRequired:
          constraints.finalUserPresenceRequired === true,
        approvalMode: cleanLine(constraints.approvalMode, 40),
        secretEntryAllowedInChat:
          constraints.secretEntryAllowedInChat === true,
        catalogToolOnly: constraints.catalogToolOnly === true,
        requestFingerprint: cleanFingerprint(
          constraints.requestFingerprint,
        ),
      },
      issuedAt: normalizeIsoDate(
        request.issuedAt,
        new Date(0).toISOString(),
      ),
    },
    status: cleanLine(value.status, 80),
    handledBy: cleanLine(value.handledBy, 40),
    canPrepare: value.canPrepare === true,
    canExecute: value.canExecute === true,
    requiresApproval: value.requiresApproval === true,
    reason: cleanLine(value.reason, 600),
  };
}
async function loadLifecycleState(paths, io) {
  const primary = await readStateCandidate(paths.statePath, io);
  if (primary.state) {
    return {
      state: primary.state,
      loadedFromPrevious: false,
      recoveryReason: "",
      writeBlocked: false,
    };
  }
  const previous = await readStateCandidate(paths.previousPath, io);
  const primaryInvalid =
    Boolean(primary.reason) && primary.reason !== "state_not_found";
  if (previous.state) {
    return {
      state: previous.state,
      loadedFromPrevious: true,
      recoveryReason: primary.reason || "primary_state_missing",
      writeBlocked: primaryInvalid,
    };
  }
  return {
    state: undefined,
    loadedFromPrevious: false,
    recoveryReason: primaryInvalid
      ? primary.reason
      : previous.reason && previous.reason !== "state_not_found"
        ? previous.reason
        : "",
    writeBlocked: primaryInvalid,
  };
}

async function readStateCandidate(filePath, io) {
  let raw;
  try {
    raw = await io.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { state: undefined, reason: "state_not_found" };
    }
    return { state: undefined, reason: "state_read_failed" };
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { state: undefined, reason: "state_json_invalid" };
  }
  if (
    envelope?.schemaVersion !== envelopeSchemaVersion ||
    envelope?.stateSchema !== stateSchema ||
    typeof envelope?.checksumSha256 !== "string" ||
    !envelope?.state
  ) {
    return { state: undefined, reason: "state_envelope_invalid" };
  }
  if (
    sha256(JSON.stringify(envelope.state)) !==
    envelope.checksumSha256
  ) {
    return { state: undefined, reason: "state_checksum_mismatch" };
  }
  const state = normalizeState(envelope.state);
  if (!state) {
    return { state: undefined, reason: "state_payload_invalid" };
  }
  return { state, reason: "" };
}
function normalizeState(value) {
  if (
    !value ||
    value.schema !== stateSchema ||
    !Array.isArray(value.records) ||
    value.rawSecretMaterialStored !== false ||
    value.packageBytesStored !== false ||
    value.automaticDownload !== false ||
    value.automaticActivation !== false
  ) {
    return undefined;
  }
  const records = [];
  for (const candidate of value.records.slice(0, maximumRecords)) {
    const normalized = normalizeRecord(candidate);
    if (!normalized) return undefined;
    records.push(normalized);
  }
  return {
    schema: stateSchema,
    updatedAt: value.updatedAt
      ? normalizeIsoDate(value.updatedAt, "")
      : "",
    records,
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    automaticDownload: false,
    automaticActivation: false,
  };
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object") return undefined;
  const workspaceId = safeWorkspaceIdOrEmpty(value.workspaceId);
  const proposal = sanitizeProposal(value.proposal);
  const proposalId = safeOptionalOpaqueId(value.proposalId);
  const recordKey = createRecordKey(workspaceId, proposalId);
  const status = String(value.status ?? "");
  if (
    !workspaceId ||
    !proposal ||
    !proposalId ||
    value.recordKey !== recordKey ||
    !allowedRecordStatuses.has(status)
  ) {
    return undefined;
  }
  return {
    recordKey,
    workspaceId,
    proposalId,
    proposal,
    requestFingerprint: cleanFingerprint(
      value.requestFingerprint,
    ),
    eligibleAgentIds: sanitizeAgentIds(
      value.eligibleAgentIds,
    ),
    proposedAt: normalizeIsoDate(value.proposedAt, ""),
    lastProposedAt: normalizeIsoDate(
      value.lastProposedAt,
      value.proposedAt,
    ),
    status,
    catalogConflict: value.catalogConflict === true,
    consentReceipts: Array.isArray(value.consentReceipts)
      ? value.consentReceipts
          .map(normalizeConsentReceipt)
          .filter(Boolean)
          .slice(-40)
      : [],
    installationReceipts: Array.isArray(
      value.installationReceipts,
    )
      ? value.installationReceipts
          .map(normalizeInstallationReceipt)
          .filter(Boolean)
          .slice(-20)
      : [],
    activationReceipts: Array.isArray(
      value.activationReceipts,
    )
      ? value.activationReceipts
          .map(normalizeActivationReceipt)
          .filter(Boolean)
          .slice(-40)
      : [],
    activeTargetAgentId:
      safeWorkspaceAgentId(value.activeTargetAgentId),
    lastInstallFailure: cleanLine(
      value.lastInstallFailure,
      80,
    ),
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    automaticDownload: false,
    automaticActivation: false,
  };
}
function normalizeConsentReceipt(value) {
  if (!value || typeof value !== "object") return undefined;
  const consentId = safeOptionalOpaqueId(
    value.consentId || value.decisionId,
  );
  if (!consentId) return undefined;
  return {
    consentId,
    decisionId: consentId,
    proposalId: safeOptionalOpaqueId(value.proposalId),
    skillId: requireSafeSkillIdOrEmpty(value.skillId),
    decision:
      value.decision === "approve_once"
        ? "approve_once"
        : "decline",
    decidedAt: normalizeIsoDate(value.decidedAt, ""),
    status: cleanLifecycleReceiptStatus(value.status),
    canDownload: value.canDownload === true,
    canInstall: value.canInstall === true,
    canActivate: false,
    requestFingerprint: cleanFingerprint(
      value.requestFingerprint,
    ),
    consumedAt: value.consumedAt
      ? normalizeIsoDate(value.consumedAt, "")
      : "",
    downloadAttemptId: safeOptionalOpaqueId(
      value.downloadAttemptId,
    ),
    rawSecretMaterialStored: false,
  };
}
function normalizeInstallationReceipt(value) {
  if (!value || typeof value !== "object") return undefined;
  const installationId = safeOptionalOpaqueId(
    value.installationId,
  );
  if (!installationId) return undefined;
  return {
    installationId,
    proposalId: safeOptionalOpaqueId(value.proposalId),
    skillId: requireSafeSkillIdOrEmpty(value.skillId),
    version: cleanLine(value.version, 80),
    installMode: allowedInstallModes.has(value.installMode)
      ? value.installMode
      : "portable_user_space",
    requestFingerprint: cleanFingerprint(
      value.requestFingerprint,
    ),
    verifiedIntegritySha256: cleanSha256(
      value.verifiedIntegritySha256,
    ),
    packageBytes: finiteNonNegative(value.packageBytes),
    installedAt: normalizeIsoDate(value.installedAt, ""),
    status: "installed_inactive",
    activated: false,
    rawSecretMaterialStored: false,
    packageBytesStored: false,
  };
}
function normalizeActivationReceipt(value) {
  if (!value || typeof value !== "object") return undefined;
  const activationId = safeOptionalOpaqueId(
    value.activationId || value.decisionId,
  );
  if (!activationId) return undefined;
  const status = [
    "kept_inactive",
    "activation_in_progress",
    "activated",
    "activation_failed",
  ].includes(value.status)
    ? value.status
    : "activation_failed";
  return {
    activationId,
    decisionId: activationId,
    proposalId: safeOptionalOpaqueId(value.proposalId),
    skillId: requireSafeSkillIdOrEmpty(value.skillId),
    installationId: safeOptionalOpaqueId(
      value.installationId,
    ),
    decision:
      value.decision === "activate"
        ? "activate"
        : "keep_inactive",
    decidedAt: normalizeIsoDate(value.decidedAt, ""),
    activatedAt: value.activatedAt
      ? normalizeIsoDate(value.activatedAt, "")
      : "",
    targetAgentId: safeWorkspaceAgentId(
      value.targetAgentId,
    ),
    requestFingerprint: cleanFingerprint(value.requestFingerprint),
    status,
    rawSecretMaterialStored: false,
  };
}
async function writeLifecycleState(paths, state, io) {
  await io.mkdir(paths.growthRoot, { recursive: true });
  const envelope = {
    schemaVersion: envelopeSchemaVersion,
    stateSchema,
    updatedAt: state.updatedAt,
    state,
    checksumSha256: sha256(JSON.stringify(state)),
  };
  const serialized = JSON.stringify(envelope, null, 2) + "\n";
  await writeTextAtomically(
    paths,
    paths.statePath,
    paths.previousPath,
    serialized,
    io,
  );
  let summarySaved = true;
  try {
    await writeTextAtomically(
      paths,
      paths.summaryPath,
      paths.summaryPath + ".previous",
      renderLifecycleSummary(state.records, state.updatedAt),
      io,
    );
  } catch {
    summarySaved = false;
  }
  return {
    saved: true,
    atomicReplace: true,
    recoverableBackup: true,
    summarySaved,
    bytesWritten: Buffer.byteLength(serialized, "utf8"),
  };
}

async function writeTextAtomically(
  paths,
  targetPath,
  backupPath,
  content,
  io,
) {
  const tempPath = path.join(
    paths.growthRoot,
    "." + path.basename(targetPath) + "." + randomUUID() + ".tmp",
  );
  let handle;
  try {
    handle = await io.open(tempPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    if (typeof handle.sync === "function") await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await io.copyFile(targetPath, backupPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      await io.rename(tempPath, targetPath);
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) {
        throw error;
      }
      await io.rm(targetPath, { force: true });
      try {
        await io.rename(tempPath, targetPath);
      } catch (replaceError) {
        try {
          await io.copyFile(backupPath, targetPath);
        } catch {
          // Recovery remains available at backupPath.
        }
        throw replaceError;
      }
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await io.rm(tempPath, { force: true }).catch(() => undefined);
  }
}
function renderLifecycleSummary(records, updatedAt) {
  const summary = summarizeWorkspaceSkillLifecycle(
    records.map(toPublicRecord),
  );
  const lines = [
    "# Workspace Skill Lifecycle",
    "",
    "검증된 업무 도구 제안, 1회 설치 승인, 무결성 확인, 별도 활성화 승인을 순서대로 보관합니다.",
    "",
    "- Updated: " + (updatedAt || "not yet"),
    "- Proposals: " + summary.proposalCount,
    "- Waiting for install approval: " +
      summary.pendingInstallApprovalCount,
    "- Download approved once: " +
      summary.downloadApprovedCount,
    "- Historical installed but inactive: " +
      summary.installedInactiveCount,
    "- Historical active intent: " + summary.activeCount,
    "- Blocked: " + summary.blockedCount,
    "",
    "## Safety",
    "",
    "- 사용자 승인 전에는 다운로드를 시작하지 않습니다.",
    "- 1회 설치 승인은 정확한 버전과 SHA-256에만 한 번 사용합니다.",
    "- 설치 완료 뒤에도 별도 활성화 확인 전에는 어떤 AI 팀원도 사용하지 않습니다.",
    "- package bytes, secret 원문, 절대 설치 경로는 이 장부에 저장하지 않습니다.",
    "",
    "## Records",
    "",
  ];
  if (!records.length) {
    lines.push("- 아직 검증된 업무 도구 제안이 없습니다.");
  }
  for (const record of records.slice(0, 40)) {
    lines.push(
      "- [" +
        record.status +
        "] " +
        record.proposal.skill.title +
        " " +
        record.proposal.skill.version,
    );
    lines.push(
      "  - Publisher: " +
        record.proposal.skill.publisher +
        " / License: " +
        record.proposal.skill.license,
    );
    lines.push(
      "  - Work packs: " +
        (record.proposal.relatedWorkPackIds.join(", ") || "none"),
    );
    lines.push(
      "  - Eligible agents: " +
        (record.eligibleAgentIds.join(", ") || "specialist needed"),
    );
  }
  lines.push("");
  return lines.join("\n");
}
function toPublicRecord(record) {
  return {
    workspaceId: record.workspaceId,
    proposalId: record.proposalId,
    proposal: cloneJson(record.proposal),
    requestFingerprint: record.requestFingerprint,
    eligibleAgentIds: [...record.eligibleAgentIds],
    proposedAt: record.proposedAt,
    lastProposedAt: record.lastProposedAt,
    status: record.status,
    catalogConflict: record.catalogConflict === true,
    consentReceipts: record.consentReceipts.map(cloneJson),
    installationReceipts:
      record.installationReceipts.map(cloneJson),
    activationReceipts:
      record.activationReceipts.map(cloneJson),
    activeTargetAgentId: record.activeTargetAgentId || "",
    lastInstallFailure: record.lastInstallFailure || "",
    rawSecretMaterialStored: false,
    packageBytesStored: false,
    automaticDownload: false,
    automaticActivation: false,
  };
}

function enqueueLifecycle(statePath, io, task) {
  const key = path.resolve(statePath).toLocaleLowerCase("ko-KR");
  const previous = lifecycleQueues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => withLifecycleOperationLock(statePath, io, task));
  lifecycleQueues.set(key, current);
  return current.finally(() => {
    if (lifecycleQueues.get(key) === current) {
      lifecycleQueues.delete(key);
    }
  });
}

async function withLifecycleOperationLock(statePath, io, task) {
  const release = await acquireLifecycleOperationLock(statePath, io);
  try {
    return await task();
  } finally {
    await release();
  }
}

async function acquireLifecycleOperationLock(statePath, io) {
  const lockPath = statePath + lifecycleOperationLockSuffix;
  await io.mkdir(path.dirname(lockPath), { recursive: true });
  const lockId = "workspace-skill-lock-" + randomUUID();
  const deadline = Date.now() + lifecycleLockWaitMilliseconds;
  while (true) {
    if (await lifecycleReclaimLockExists(lockPath, io)) {
      if (Date.now() >= deadline) {
        throw lifecycleError("lifecycle_operation_reclaim_recovery_required");
      }
      await delay(lifecycleLockRetryMilliseconds);
      continue;
    }
    let handle;
    let created = false;
    try {
      handle = await io.open(lockPath, "wx", 0o600);
      created = true;
      await handle.writeFile(
        JSON.stringify({
          schema: lifecycleOperationLockSchema,
          lockId,
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }) + "\n",
        "utf8",
      );
      if (typeof handle.sync === "function") await handle.sync();
      const stopHeartbeat = startLifecycleOperationLockHeartbeat({
        handle,
        lockPath,
        lockId,
        io,
      });
      return createLifecycleOperationLockRelease({
        handle,
        lockPath,
        lockId,
        io,
        stopHeartbeat,
      });
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (created) {
        await io.rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      if (error?.code !== "EEXIST") throw error;
      await tryReclaimStaleLifecycleOperationLock(lockPath, io);
      if (Date.now() >= deadline) {
        throw lifecycleError("lifecycle_operation_lock_timeout");
      }
      await delay(lifecycleLockRetryMilliseconds);
    }
  }
}

function startLifecycleOperationLockHeartbeat(input) {
  let stopped = false;
  let refreshing = false;
  const heartbeat = setInterval(() => {
    if (stopped || refreshing) return;
    refreshing = true;
    refreshLifecycleOperationLockHeartbeat(input)
      .then((ownsLock) => {
        if (!ownsLock) {
          stopped = true;
          clearInterval(heartbeat);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        refreshing = false;
      });
  }, lifecycleLockHeartbeatMilliseconds);
  if (typeof heartbeat.unref === "function") heartbeat.unref();
  return () => {
    stopped = true;
    clearInterval(heartbeat);
  };
}

async function refreshLifecycleOperationLockHeartbeat(input) {
  const current = await readLifecycleOperationLock(input.lockPath, input.io);
  if (!lifecycleOperationLockMatches(current?.record, input.lockId)) {
    return false;
  }
  const now = new Date();
  if (typeof input.handle?.utimes === "function") {
    await input.handle.utimes(now, now);
    return true;
  }
  if (typeof input.io?.utimes === "function") {
    await input.io.utimes(input.lockPath, now, now);
    return true;
  }
  return false;
}

function createLifecycleOperationLockRelease(input) {
  return async () => {
    input.stopHeartbeat();
    const current = await readLifecycleOperationLock(input.lockPath, input.io);
    const ownsLock = lifecycleOperationLockMatches(current?.record, input.lockId);
    await input.handle.close().catch(() => undefined);
    if (ownsLock) {
      await input.io.rm(input.lockPath, { force: true }).catch(() => undefined);
    }
  };
}

async function tryReclaimStaleLifecycleOperationLock(lockPath, io) {
  const observed = await readLifecycleOperationLock(lockPath, io);
  if (
    !observed ||
    !lifecycleOperationLockIsStale(observed.stat) ||
    !lifecycleOperationLockOwnerIsGone(observed.record)
  ) {
    return false;
  }

  const reclaim = await acquireLifecycleReclaimLock(lockPath, observed.record, io);
  if (!reclaim) return false;
  try {
    const current = await readLifecycleOperationLock(lockPath, io);
    if (
      !current ||
      !lifecycleOperationLockRecordsMatch(current.record, observed.record) ||
      !lifecycleOperationLockIsStale(current.stat) ||
      !lifecycleOperationLockOwnerIsGone(current.record)
    ) {
      return false;
    }
    await io.rm(lockPath, { force: true });
    return true;
  } finally {
    await reclaim.release();
  }
}

async function lifecycleReclaimLockExists(lockPath, io) {
  try {
    await io.stat(lockPath + lifecycleReclaimLockSuffix);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function acquireLifecycleReclaimLock(lockPath, target, io) {
  const reclaimPath = lockPath + lifecycleReclaimLockSuffix;
  const reclaimToken = "workspace-skill-reclaim-" + randomUUID();
  let handle;
  let created = false;
  try {
    handle = await io.open(reclaimPath, "wx", 0o600);
    created = true;
    await handle.writeFile(
      JSON.stringify({
        schema: lifecycleReclaimLockSchema,
        reclaimToken,
        pid: process.pid,
        targetLockId: target.lockId,
        targetPid: target.pid,
        acquiredAt: new Date().toISOString(),
      }) + "\n",
      "utf8",
    );
    if (typeof handle.sync === "function") await handle.sync();
    return {
      release: createLifecycleReclaimLockRelease({
        handle,
        reclaimPath,
        reclaimToken,
        io,
      }),
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (created) {
      await io.rm(reclaimPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (error?.code === "EEXIST") return undefined;
    throw error;
  }
}

function createLifecycleReclaimLockRelease(input) {
  return async () => {
    const current = await readLifecycleReclaimLock(input.reclaimPath, input.io);
    const ownsLock =
      current?.reclaimToken === input.reclaimToken && current?.pid === process.pid;
    await input.handle.close().catch(() => undefined);
    if (ownsLock) {
      await input.io.rm(input.reclaimPath, { force: true }).catch(() => undefined);
    }
  };
}

async function readLifecycleReclaimLock(reclaimPath, io) {
  let raw;
  try {
    raw = await io.readFile(reclaimPath, "utf8");
  } catch {
    return undefined;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return normalizeLifecycleReclaimLock(parsed);
}

function normalizeLifecycleReclaimLock(value) {
  const reclaimToken = String(value?.reclaimToken ?? "");
  const targetLockId = String(value?.targetLockId ?? "");
  const pid = Number(value?.pid);
  const targetPid = Number(value?.targetPid);
  if (
    value?.schema !== lifecycleReclaimLockSchema ||
    !/^workspace-skill-reclaim-[0-9a-f-]{36}$/u.test(reclaimToken) ||
    !/^workspace-skill-lock-[0-9a-f-]{36}$/u.test(targetLockId) ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isSafeInteger(targetPid) ||
    targetPid <= 0 ||
    !normalizeIsoDate(value?.acquiredAt, "")
  ) {
    return undefined;
  }
  return { reclaimToken, pid, targetLockId, targetPid };
}

async function readLifecycleOperationLock(lockPath, io) {
  let raw;
  let stat;
  try {
    raw = await io.readFile(lockPath, "utf8");
    stat = await io.stat(lockPath);
  } catch {
    return undefined;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const record = normalizeLifecycleOperationLock(parsed);
  return record ? { record, stat } : undefined;
}

function normalizeLifecycleOperationLock(value) {
  const lockId = String(value?.lockId ?? "");
  const pid = Number(value?.pid);
  if (
    value?.schema !== lifecycleOperationLockSchema ||
    !/^workspace-skill-lock-[0-9a-f-]{36}$/u.test(lockId) ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !normalizeIsoDate(value?.acquiredAt, "")
  ) {
    return undefined;
  }
  return { lockId, pid };
}

function lifecycleOperationLockMatches(record, lockId) {
  return record?.lockId === lockId && record?.pid === process.pid;
}

function lifecycleOperationLockRecordsMatch(left, right) {
  return left?.lockId === right?.lockId && left?.pid === right?.pid;
}

function lifecycleOperationLockIsStale(stat) {
  const heartbeatAt = Number(stat?.mtimeMs);
  return (
    Number.isFinite(heartbeatAt) &&
    Date.now() - heartbeatAt >= lifecycleLockStaleMilliseconds
  );
}

function lifecycleOperationLockOwnerIsGone(record) {
  if (!record?.pid || record.pid === process.pid) return false;
  try {
    process.kill(record.pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function resolveMemoryRoot(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new Error("스킬 장부 memoryRoot가 필요합니다.");
  return path.resolve(raw);
}

function requireSafeWorkspaceId(value) {
  const id = safeWorkspaceIdOrEmpty(value);
  if (!id || id !== String(value ?? "")) {
    throw new Error(
      "workspaceId는 80자 이하의 안전한 소문자 ID여야 합니다.",
    );
  }
  return id;
}

function safeWorkspaceIdOrEmpty(value) {
  const id = String(value ?? "");
  return /^[a-z0-9._-]{1,80}$/u.test(id) ? id : "";
}

function requireSafeAgentId(value) {
  const id = safeWorkspaceAgentId(value);
  if (!id) {
    throw new Error(
      "targetAgentId는 80자 이하의 안전한 소문자 ID여야 합니다.",
    );
  }
  return id;
}

function safeWorkspaceAgentId(value) {
  const id = String(value ?? "");
  return /^[a-z0-9._-]{1,80}$/u.test(id) ? id : "";
}

function requireSafeOpaqueId(value, label) {
  const id = safeOptionalOpaqueId(value);
  if (!id || id !== String(value ?? "")) {
    throw new Error(
      label + "는 256자 이하의 안전한 불투명 ID여야 합니다.",
    );
  }
  return id;
}

function safeOptionalOpaqueId(value) {
  const id = String(value ?? "");
  return /^[A-Za-z0-9._:@+-]{1,256}$/u.test(id) ? id : "";
}

function requireSafeSkillIdOrEmpty(value) {
  const id = String(value ?? "");
  return /^[a-z0-9._-]{1,120}$/u.test(id) ? id : "";
}

function sanitizeAgentIds(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map(safeWorkspaceAgentId)
        .filter(Boolean),
    ),
  ].slice(0, 40);
}

function sanitizeWorkPackIds(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item ?? ""))
        .filter((item) => allowedWorkPackIds.has(item)),
    ),
  ];
}

function sanitizeCatalogSourceUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}
function cleanLifecycleReceiptStatus(value) {
  if (value === "approved_for_one_download") {
    return "approved_for_one_download";
  }
  if (value === "declined") return "declined";
  return "blocked";
}

function cleanFingerprint(value) {
  const fingerprint = String(value ?? "");
  if (
    fingerprint.length < 72 ||
    fingerprint.length > 4096 ||
    !/^sha256:[a-f0-9]{64}(?::binding:[A-Za-z0-9._~%|,=:+-]+)?$/u.test(
      fingerprint,
    )
  ) {
    return "";
  }
  return fingerprint;
}

function cleanSha256(value) {
  const hash = String(value ?? "").toLowerCase();
  return /^[a-f0-9]{64}$/u.test(hash) ? hash : "";
}

function cleanStringArray(value, maxItems, maxLength) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => cleanLine(item, maxLength))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

function cleanLine(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeIsoDate(value, fallback) {
  const date = new Date(value);
  if (Number.isFinite(date.getTime())) return date.toISOString();
  return fallback || "";
}

function nowIso(options) {
  const value =
    typeof options.now === "function" ? options.now() : new Date();
  return normalizeIsoDate(value, new Date().toISOString());
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizePackageBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw lifecycleError("package_bytes_missing");
}

function cleanInstallFailureCode(error) {
  const code = cleanLine(error?.lifecycleCode, 80);
  return [
    "package_size_invalid",
    "package_bytes_missing",
    "integrity_mismatch",
    "install_receipt_invalid",
  ].includes(code)
    ? code
    : "download_or_install_failed";
}

function lifecycleError(code) {
  const error = new Error(code);
  error.lifecycleCode = code;
  return error;
}

function cloneState(state) {
  return cloneJson(state);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
