import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const workspaceIntelligenceStateFileName = "modycrew-workspace-intelligence-state.json";
const workspaceIntelligencePreviousFileName = workspaceIntelligenceStateFileName + ".previous";
const workspaceIntelligenceEnvelopeSchemaVersion = 1;
const workspaceIntelligenceStateSchemaVersion = 1;
const stateUpdateQueues = new Map();
const workspaceIntelligenceOperationLockSuffix = ".operation.lock";
const workspaceIntelligenceReclaimLockSuffix = ".reclaim.lock";
const workspaceIntelligenceLockWaitMilliseconds = 30_000;
const workspaceIntelligenceLockStaleMilliseconds = 10 * 60_000;
const workspaceIntelligenceLockHeartbeatMilliseconds = 5_000;
const workspaceIntelligenceLockRetryMilliseconds = 40;
const workspaceIntelligenceOperationLockSchema =
  "modycrew.workspace-intelligence-operation-lock.v1";
const workspaceIntelligenceReclaimLockSchema =
  "modycrew.workspace-intelligence-operation-reclaim.v1";
const allowedWorkPackIds = new Set([
  "inquiry_response",
  "schedule_coordination",
  "report_cleanup",
  "inventory_reorder",
  "tax_contract_archive",
]);
const allowedCategories = new Set([
  "monthly_report",
  "settlement_sheet",
  "customer_inquiry",
  "schedule_rule",
  "tax_material",
  "contract",
  "form_template",
  "general_document",
]);
const allowedCorrectionSignals = new Set([
  "missing_source",
  "wrong_template",
  "wrong_assignee",
  "wrong_schedule",
  "calculation_error",
  "tone_mismatch",
  "approval_boundary_missed",
  "other",
]);

export function createWorkspaceLearningSnapshotSessionId(input = {}) {
  const workspaceId = cleanId(input.workspaceId) || "local_desktop";
  const extractedById = new Map(
    (Array.isArray(input.extracted) ? input.extracted : []).map((item) => [
      cleanId(item?.id),
      typeof item?.extractedText === "string" ? item.extractedText : "",
    ]),
  );
  const mappedFingerprints = (Array.isArray(input.files) ? input.files : []).map((file) => {
    const id = cleanId(file?.id);
    const rawPath = typeof file?.absolutePath === "string" ? path.resolve(file.absolutePath) : "";
    const extractedText = extractedById.get(id) ?? "";
    return {
      sourceHash: sha256(rawPath.toLocaleLowerCase("ko-KR")),
      contentHash: extractedText ? sha256(extractedText) : "",
      sizeBytes: finiteNonNegative(file?.sizeBytes),
      modifiedAt: cleanText(file?.modifiedAt).slice(0, 48),
    };
  });
  const fileFingerprints = [...new Map(
    mappedFingerprints.map((fingerprint) => [fingerprint.sourceHash, fingerprint]),
  ).values()].sort((left, right) => left.sourceHash.localeCompare(right.sourceHash));
  const snapshotHash = sha256(JSON.stringify({ workspaceId, fileFingerprints })).slice(0, 32);
  return "workspace-learning-" + workspaceId + "-" + snapshotHash;
}

export function updateWorkspaceIntelligenceFromLearningPlan(input = {}, options = {}) {
  const indexRoot = resolveRequiredIndexRoot(
    input.indexRoot ?? input.learningPlan?.localIndexRoot,
  );
  const statePath = path.join(indexRoot, workspaceIntelligenceStateFileName);
  const io = options.io ?? fs;
  return enqueueStateUpdate(statePath, io, () =>
    updateWorkspaceIntelligenceUnlocked(input, {
      ...options,
      indexRoot,
      statePath,
      io,
    }),
  );
}

export async function readWorkspaceIntelligenceState(indexRoot, workspaceId, options = {}) {
  const resolvedRoot = resolveRequiredIndexRoot(indexRoot);
  const io = options.io ?? fs;
  return loadWorkspaceIntelligenceState({
    statePath: path.join(resolvedRoot, workspaceIntelligenceStateFileName),
    previousPath: path.join(resolvedRoot, workspaceIntelligencePreviousFileName),
    workspaceId: cleanId(workspaceId),
    io,
  });
}

async function updateWorkspaceIntelligenceUnlocked(input, options) {
  const Engine = input.WorkspaceIntelligenceEngine;
  if (typeof Engine !== "function") {
    throw new Error("ModyWorkspaceIntelligenceEngine을 불러오지 못했습니다.");
  }
  const rawLearningPlan =
    input.learningPlan && typeof input.learningPlan === "object"
      ? input.learningPlan
      : undefined;
  const rawAgentOutcomes = Array.isArray(input.agentOutcomes) ? input.agentOutcomes : [];
  if (!rawLearningPlan && rawAgentOutcomes.length === 0) {
    throw new Error("작업공간 지능 갱신에는 학습 계획 또는 에이전트 결과가 필요합니다.");
  }
  const workspaceId = cleanId(input.workspaceId ?? rawLearningPlan?.workspaceId);
  if (!workspaceId) {
    throw new Error("작업공간 지능 상태에는 workspaceId가 필요합니다.");
  }
  if (rawLearningPlan && rawLearningPlan.workspaceId !== workspaceId) {
    throw new Error("작업공간 지능 상태와 자료 학습 workspaceId가 일치해야 합니다.");
  }
  const learningPlan = rawLearningPlan
    ? {
        ...rawLearningPlan,
        sessionId: requireSafeOpaqueId(
          rawLearningPlan.sessionId,
          "자료 학습 sessionId",
        ),
      }
    : undefined;
  const agentOutcomes = rawAgentOutcomes.map(normalizeAgentOutcomeInput);
  const observedAt = normalizeIsoDate(input.observedAt ?? learningPlan?.createdAt);
  const indexRoot = options.indexRoot;
  const statePath = options.statePath;
  const previousPath = path.join(indexRoot, workspaceIntelligencePreviousFileName);
  const io = options.io ?? fs;
  const loaded = await loadWorkspaceIntelligenceState({
    statePath,
    previousPath,
    workspaceId,
    io,
  });

  if (loaded.writeBlocked) {
    return createRecoveryRequiredResult({
      workspaceId,
      statePath,
      loaded,
    });
  }

  const engine = new Engine();
  const cycle = engine.runCycle({
    workspaceId,
    observedAt,
    ...(loaded.state ? { previousState: loaded.state } : {}),
    learningPlans: learningPlan ? [learningPlan] : [],
    agentOutcomes,
    agents: Array.isArray(input.agents) ? input.agents : [],
    installedSkillIds: Array.isArray(input.installedSkillIds) ? input.installedSkillIds : [],
    skillCatalog: Array.isArray(input.skillCatalog) ? input.skillCatalog : [],
  });
  const persistedState = normalizeState(cycle.state, workspaceId);
  if (!persistedState) {
    throw new Error("작업공간 지능 상태를 안전한 저장 형식으로 정규화하지 못했습니다.");
  }
  const envelope = createStateEnvelope(workspaceId, observedAt, persistedState);
  const persistence = await writeStateEnvelope({
    indexRoot,
    statePath,
    previousPath,
    envelope,
    io,
  });

  return {
    status: loaded.recoveryReason
      ? "workspace_intelligence_recovered_and_updated"
      : "workspace_intelligence_updated",
    workspaceId,
    statePath,
    cycleCount: persistedState.cycleCount,
    newLearningSessionIds: [...cycle.newLearningSessionIds],
    newAgentRunIds: [...cycle.newAgentRunIds],
    workSignals: cloneWorkSignals(persistedState.workSignals),
    assignments: cycle.assignments,
    improvementProposals: cycle.improvementProposals,
    skillProposals: cycle.skillProposals,
    boundaries: cycle.boundaries,
    recoveredFromPreviousState: loaded.loadedFromPrevious,
    recoveryReason: loaded.recoveryReason,
    persistence,
    rawFileContentStored: false,
    rawSecretsStored: false,
    absolutePathsStoredInState: false,
    externalMutation: false,
  };
}

async function enqueueStateUpdate(statePath, io, task) {
  const key = path.resolve(statePath).toLocaleLowerCase("ko-KR");
  const previous = stateUpdateQueues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => withWorkspaceIntelligenceOperationLock(statePath, io, task));
  stateUpdateQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (stateUpdateQueues.get(key) === current) stateUpdateQueues.delete(key);
  }
}

async function withWorkspaceIntelligenceOperationLock(statePath, io, task) {
  const release = await acquireWorkspaceIntelligenceOperationLock(statePath, io);
  try {
    return await task();
  } finally {
    await release();
  }
}

async function acquireWorkspaceIntelligenceOperationLock(statePath, io) {
  const lockPath = statePath + workspaceIntelligenceOperationLockSuffix;
  await io.mkdir(path.dirname(lockPath), { recursive: true });
  const ownerToken = "workspace-intelligence-lock-" + randomUUID();
  const deadline = Date.now() + workspaceIntelligenceLockWaitMilliseconds;

  while (true) {
    if (await workspaceIntelligenceReclaimLockExists(lockPath, io)) {
      if (Date.now() >= deadline) {
        throw createWorkspaceIntelligenceOperationLockError(
          "workspace_intelligence_operation_reclaim_recovery_required",
        );
      }
      await delay(workspaceIntelligenceLockRetryMilliseconds);
      continue;
    }
    let handle;
    let created = false;
    try {
      handle = await io.open(lockPath, "wx", 0o600);
      created = true;
      await handle.writeFile(
        JSON.stringify({
          schema: workspaceIntelligenceOperationLockSchema,
          ownerToken,
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }) + "\n",
        "utf8",
      );
      if (typeof handle.sync === "function") await handle.sync();
      const stopHeartbeat = startWorkspaceIntelligenceOperationLockHeartbeat({
        handle,
        lockPath,
        ownerToken,
        io,
      });
      return createWorkspaceIntelligenceOperationLockRelease({
        handle,
        lockPath,
        ownerToken,
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
      await tryReclaimStaleWorkspaceIntelligenceOperationLock(lockPath, io);
      if (Date.now() >= deadline) {
        throw createWorkspaceIntelligenceOperationLockError(
          "workspace_intelligence_operation_lock_timeout",
        );
      }
      await delay(workspaceIntelligenceLockRetryMilliseconds);
    }
  }
}

function startWorkspaceIntelligenceOperationLockHeartbeat(input) {
  let stopped = false;
  let refreshing = false;
  const heartbeat = setInterval(() => {
    if (stopped || refreshing) return;
    refreshing = true;
    refreshWorkspaceIntelligenceOperationLockHeartbeat(input)
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
  }, workspaceIntelligenceLockHeartbeatMilliseconds);
  if (typeof heartbeat.unref === "function") heartbeat.unref();
  return () => {
    stopped = true;
    clearInterval(heartbeat);
  };
}

async function refreshWorkspaceIntelligenceOperationLockHeartbeat(input) {
  const current = await readWorkspaceIntelligenceOperationLock(
    input.lockPath,
    input.io,
  );
  if (!workspaceIntelligenceOperationLockMatches(current?.record, input.ownerToken)) {
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

function createWorkspaceIntelligenceOperationLockRelease(input) {
  return async () => {
    input.stopHeartbeat();
    const current = await readWorkspaceIntelligenceOperationLock(
      input.lockPath,
      input.io,
    );
    const ownsLock = workspaceIntelligenceOperationLockMatches(
      current?.record,
      input.ownerToken,
    );
    await input.handle.close().catch(() => undefined);
    if (ownsLock) {
      await input.io.rm(input.lockPath, { force: true }).catch(() => undefined);
    }
  };
}

async function tryReclaimStaleWorkspaceIntelligenceOperationLock(lockPath, io) {
  const observed = await readWorkspaceIntelligenceOperationLock(lockPath, io);
  if (
    !observed ||
    !workspaceIntelligenceOperationLockIsStale(observed.stat) ||
    !workspaceIntelligenceOperationLockOwnerIsGone(observed.record)
  ) {
    return false;
  }

  const reclaim = await acquireWorkspaceIntelligenceReclaimLock(
    lockPath,
    observed.record,
    io,
  );
  if (!reclaim) return false;
  try {
    const current = await readWorkspaceIntelligenceOperationLock(lockPath, io);
    if (
      !current ||
      !workspaceIntelligenceOperationLockRecordsMatch(current.record, observed.record) ||
      !workspaceIntelligenceOperationLockIsStale(current.stat) ||
      !workspaceIntelligenceOperationLockOwnerIsGone(current.record)
    ) {
      return false;
    }
    await io.rm(lockPath, { force: true });
    return true;
  } finally {
    await reclaim.release();
  }
}

async function workspaceIntelligenceReclaimLockExists(lockPath, io) {
  try {
    await io.stat(lockPath + workspaceIntelligenceReclaimLockSuffix);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function acquireWorkspaceIntelligenceReclaimLock(lockPath, target, io) {
  const reclaimPath = lockPath + workspaceIntelligenceReclaimLockSuffix;
  const reclaimToken = "workspace-intelligence-reclaim-" + randomUUID();
  let handle;
  let created = false;
  try {
    handle = await io.open(reclaimPath, "wx", 0o600);
    created = true;
    await handle.writeFile(
      JSON.stringify({
        schema: workspaceIntelligenceReclaimLockSchema,
        reclaimToken,
        pid: process.pid,
        targetOwnerToken: target.ownerToken,
        targetPid: target.pid,
        acquiredAt: new Date().toISOString(),
      }) + "\n",
      "utf8",
    );
    if (typeof handle.sync === "function") await handle.sync();
    return {
      release: createWorkspaceIntelligenceReclaimLockRelease({
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

function createWorkspaceIntelligenceReclaimLockRelease(input) {
  return async () => {
    const current = await readWorkspaceIntelligenceReclaimLock(
      input.reclaimPath,
      input.io,
    );
    const ownsLock =
      current?.reclaimToken === input.reclaimToken && current?.pid === process.pid;
    await input.handle.close().catch(() => undefined);
    if (ownsLock) {
      await input.io.rm(input.reclaimPath, { force: true }).catch(() => undefined);
    }
  };
}

async function readWorkspaceIntelligenceReclaimLock(reclaimPath, io) {
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
  return normalizeWorkspaceIntelligenceReclaimLock(parsed);
}

function normalizeWorkspaceIntelligenceReclaimLock(value) {
  const reclaimToken = String(value?.reclaimToken ?? "");
  const targetOwnerToken = String(value?.targetOwnerToken ?? "");
  const pid = Number(value?.pid);
  const targetPid = Number(value?.targetPid);
  if (
    value?.schema !== workspaceIntelligenceReclaimLockSchema ||
    !/^workspace-intelligence-reclaim-[0-9a-f-]{36}$/u.test(reclaimToken) ||
    !/^workspace-intelligence-lock-[0-9a-f-]{36}$/u.test(targetOwnerToken) ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isSafeInteger(targetPid) ||
    targetPid <= 0 ||
    !validIsoOrEmpty(value?.acquiredAt)
  ) {
    return undefined;
  }
  return { reclaimToken, pid, targetOwnerToken, targetPid };
}

async function readWorkspaceIntelligenceOperationLock(lockPath, io) {
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
  const record = normalizeWorkspaceIntelligenceOperationLock(parsed);
  return record ? { record, stat } : undefined;
}

function normalizeWorkspaceIntelligenceOperationLock(value) {
  const ownerToken = String(value?.ownerToken ?? "");
  const pid = Number(value?.pid);
  if (
    value?.schema !== workspaceIntelligenceOperationLockSchema ||
    !/^workspace-intelligence-lock-[0-9a-f-]{36}$/u.test(ownerToken) ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !validIsoOrEmpty(value?.acquiredAt)
  ) {
    return undefined;
  }
  return { ownerToken, pid };
}

function workspaceIntelligenceOperationLockMatches(record, ownerToken) {
  return record?.ownerToken === ownerToken && record?.pid === process.pid;
}

function workspaceIntelligenceOperationLockRecordsMatch(left, right) {
  return left?.ownerToken === right?.ownerToken && left?.pid === right?.pid;
}

function workspaceIntelligenceOperationLockIsStale(stat) {
  const heartbeatAt = Number(stat?.mtimeMs);
  return (
    Number.isFinite(heartbeatAt) &&
    Date.now() - heartbeatAt >= workspaceIntelligenceLockStaleMilliseconds
  );
}

function workspaceIntelligenceOperationLockOwnerIsGone(record) {
  if (!record?.pid || record.pid === process.pid) return false;
  try {
    process.kill(record.pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function createWorkspaceIntelligenceOperationLockError(code) {
  const error = new Error(
    code === "workspace_intelligence_operation_lock_timeout"
      ? "?? ModyCrew ????? ???? ?? ??? ?? ????. ?? ? ?? ??? ???."
      : code === "workspace_intelligence_operation_reclaim_recovery_required"
        ? "?? ???? ?? ??? ??? ?????. ?? ??? ??? ? ?? ??? ???."
        : "???? ?? ?? ??? ???? ???? ???? ?????.",
  );
  error.code = code;
  return error;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadWorkspaceIntelligenceState(input) {
  const primary = await readStateCandidate(input.statePath, input.workspaceId, input.io);
  if (primary.state) {
    return {
      state: primary.state,
      loadedFromPrevious: false,
      recoveryReason: "",
      writeBlocked: false,
    };
  }
  const previous = await readStateCandidate(input.previousPath, input.workspaceId, input.io);
  const primaryInvalid = Boolean(primary.reason && primary.reason !== "state_not_found");
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
    recoveryReason:
      primaryInvalid
        ? primary.reason
        : previous.reason && previous.reason !== "state_not_found"
          ? previous.reason
          : "",
    writeBlocked: primaryInvalid,
  };
}

async function readStateCandidate(filePath, workspaceId, io) {
  let raw;
  try {
    raw = await io.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { state: undefined, reason: "state_not_found" };
    return { state: undefined, reason: "state_read_failed" };
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { state: undefined, reason: "state_json_invalid" };
  }
  const envelopeReason = validateStateEnvelope(envelope, workspaceId);
  if (envelopeReason) return { state: undefined, reason: envelopeReason };
  const state = normalizeState(envelope.state, workspaceId);
  if (!state) return { state: undefined, reason: "state_payload_invalid" };
  return { state, reason: "" };
}

function validateStateEnvelope(envelope, workspaceId) {
  if (!envelope || typeof envelope !== "object") return "state_envelope_invalid";
  if (envelope.schemaVersion !== workspaceIntelligenceEnvelopeSchemaVersion) {
    return "state_schema_unsupported";
  }
  if (envelope.workspaceId !== workspaceId || envelope.state?.workspaceId !== workspaceId) {
    return "state_workspace_mismatch";
  }
  if (!envelope.state || typeof envelope.state !== "object") return "state_payload_missing";
  const boundary = envelope.state.memoryBoundary;
  if (
    boundary?.rawFileContentStored !== false ||
    boundary?.rawSecretsStored !== false ||
    boundary?.absolutePathsStored !== false ||
    boundary?.learnedRulesAutoApplied !== false
  ) {
    return "state_memory_boundary_invalid";
  }
  if (sha256(JSON.stringify(envelope.state)) !== envelope.stateSha256) {
    return "state_integrity_mismatch";
  }
  return "";
}

function normalizeState(value, workspaceId) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== workspaceIntelligenceStateSchemaVersion ||
    value.workspaceId !== workspaceId
  ) {
    return undefined;
  }
  const workSignals = (Array.isArray(value.workSignals) ? value.workSignals : [])
    .map(normalizeWorkSignal)
    .filter(Boolean)
    .slice(0, 100);
  const agentLearningProfiles = (
    Array.isArray(value.agentLearningProfiles) ? value.agentLearningProfiles : []
  )
    .map(normalizeAgentLearningProfile)
    .filter(Boolean)
    .slice(0, 200);
  const lastObservedAt = validIsoOrEmpty(value.lastObservedAt);
  return {
    schemaVersion: workspaceIntelligenceStateSchemaVersion,
    workspaceId,
    cycleCount: boundedInteger(value.cycleCount, 0, 1_000_000),
    processedLearningSessionIds: normalizeOpaqueIdList(
      value.processedLearningSessionIds,
      500,
    ),
    processedAgentRunIds: normalizeOpaqueIdList(value.processedAgentRunIds, 2_000),
    workSignals,
    agentLearningProfiles,
    pendingSkillProposalIds: normalizeOpaqueIdList(value.pendingSkillProposalIds, 100),
    ...(lastObservedAt ? { lastObservedAt } : {}),
    memoryBoundary: {
      rawFileContentStored: false,
      rawSecretsStored: false,
      absolutePathsStored: false,
      learnedRulesAutoApplied: false,
    },
  };
}

function normalizeWorkSignal(value) {
  if (!value || typeof value !== "object" || !allowedWorkPackIds.has(value.workPackId)) {
    return undefined;
  }
  const lastSeenAt = validIsoOrEmpty(value.lastSeenAt);
  if (!lastSeenAt) return undefined;
  return {
    workPackId: value.workPackId,
    observationCount: boundedInteger(value.observationCount, 0, 1_000_000),
    evidenceCount: boundedInteger(value.evidenceCount, 0, 1_000_000),
    confidence: boundedNumber(value.confidence, 0, 1),
    categories: uniqueStrings(
      (Array.isArray(value.categories) ? value.categories : []).filter((item) =>
        allowedCategories.has(item),
      ),
      8,
    ),
    sourceSessionIds: normalizeOpaqueIdList(value.sourceSessionIds, 100),
    lastSeenAt,
  };
}

function normalizeAgentLearningProfile(value) {
  const agentId = cleanId(value?.agentId);
  const lastOutcomeAt = validIsoOrEmpty(value?.lastOutcomeAt);
  if (!agentId || !lastOutcomeAt) return undefined;
  const correctionCounts = {};
  for (const [signal, count] of Object.entries(value?.correctionCounts ?? {})) {
    if (allowedCorrectionSignals.has(signal)) {
      correctionCounts[signal] = boundedInteger(count, 0, 1_000_000);
    }
  }
  const workPackPerformance = (
    Array.isArray(value.workPackPerformance) ? value.workPackPerformance : []
  )
    .map(normalizeAgentWorkPackPerformance)
    .filter(Boolean)
    .slice(0, 5);
  return {
    agentId,
    totalRuns: boundedInteger(value.totalRuns, 0, 1_000_000),
    acceptedRuns: boundedInteger(value.acceptedRuns, 0, 1_000_000),
    correctedRuns: boundedInteger(value.correctedRuns, 0, 1_000_000),
    rejectedRuns: boundedInteger(value.rejectedRuns, 0, 1_000_000),
    failedRuns: boundedInteger(value.failedRuns, 0, 1_000_000),
    qualityScoreTotal: boundedNumber(value.qualityScoreTotal, 0, 1_000_000),
    qualityScoreCount: boundedInteger(value.qualityScoreCount, 0, 1_000_000),
    correctionCounts,
    workPackIds: uniqueStrings(
      [
        ...(Array.isArray(value.workPackIds) ? value.workPackIds : []),
        ...workPackPerformance.map((performance) => performance.workPackId),
      ].filter((item) => allowedWorkPackIds.has(item)),
      5,
    ),
    workPackPerformance,
    lastOutcomeAt,
  };
}

function normalizeAgentWorkPackPerformance(value) {
  if (!value || typeof value !== "object" || !allowedWorkPackIds.has(value.workPackId)) {
    return undefined;
  }
  const lastOutcomeAt = validIsoOrEmpty(value.lastOutcomeAt);
  if (!lastOutcomeAt) return undefined;
  return {
    workPackId: value.workPackId,
    totalRuns: boundedInteger(value.totalRuns, 0, 1_000_000),
    acceptedRuns: boundedInteger(value.acceptedRuns, 0, 1_000_000),
    correctedRuns: boundedInteger(value.correctedRuns, 0, 1_000_000),
    rejectedRuns: boundedInteger(value.rejectedRuns, 0, 1_000_000),
    failedRuns: boundedInteger(value.failedRuns, 0, 1_000_000),
    qualityScoreTotal: boundedNumber(value.qualityScoreTotal, 0, 1_000_000),
    qualityScoreCount: boundedInteger(value.qualityScoreCount, 0, 1_000_000),
    lastOutcomeAt,
  };
}

function createStateEnvelope(workspaceId, updatedAt, state) {
  return {
    schemaVersion: workspaceIntelligenceEnvelopeSchemaVersion,
    workspaceId,
    updatedAt,
    stateSha256: sha256(JSON.stringify(state)),
    state,
    storageBoundary: {
      rawFileContentStored: false,
      rawSecretsStored: false,
      absolutePathsStored: false,
      externalMutation: false,
    },
  };
}

async function writeStateEnvelope(input) {
  await input.io.mkdir(input.indexRoot, { recursive: true });
  const tempPath = path.join(
    input.indexRoot,
    "." + workspaceIntelligenceStateFileName + "." + randomUUID() + ".tmp",
  );
  const serialized = JSON.stringify(input.envelope, null, 2) + "\n";
  let handle;
  let backupCreated = false;
  try {
    handle = await input.io.open(tempPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    if (typeof handle.sync === "function") await handle.sync();
    await handle.close();
    handle = undefined;

    try {
      await input.io.copyFile(input.statePath, input.previousPath);
      backupCreated = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    try {
      await input.io.rename(tempPath, input.statePath);
      return {
        saved: true,
        atomicReplace: true,
        recoverableBackup: backupCreated,
        bytesWritten: Buffer.byteLength(serialized, "utf8"),
      };
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
      await input.io.rm(input.statePath, { force: true });
      try {
        await input.io.rename(tempPath, input.statePath);
      } catch (replaceError) {
        if (backupCreated) await input.io.copyFile(input.previousPath, input.statePath);
        throw replaceError;
      }
      return {
        saved: true,
        atomicReplace: false,
        recoverableBackup: backupCreated,
        bytesWritten: Buffer.byteLength(serialized, "utf8"),
      };
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await input.io.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function createRecoveryRequiredResult(input) {
  return {
    status: "workspace_intelligence_state_recovery_required",
    workspaceId: input.workspaceId,
    statePath: input.statePath,
    cycleCount: input.loaded.state?.cycleCount ?? 0,
    newLearningSessionIds: [],
    newAgentRunIds: [],
    workSignals: cloneWorkSignals(input.loaded.state?.workSignals ?? []),
    assignments: [],
    improvementProposals: [],
    skillProposals: [],
    boundaries: safeBoundaries(),
    recoveredFromPreviousState: input.loaded.loadedFromPrevious,
    recoveryReason: input.loaded.recoveryReason,
    persistence: {
      saved: false,
      atomicReplace: false,
      recoverableBackup: input.loaded.loadedFromPrevious,
      bytesWritten: 0,
    },
    rawFileContentStored: false,
    rawSecretsStored: false,
    absolutePathsStoredInState: false,
    externalMutation: false,
  };
}

function safeBoundaries() {
  return {
    folderObservationOnly: true,
    noAutomaticExternalMutation: true,
    noAutomaticSkillDownload: true,
    noAutomaticSkillActivation: true,
  };
}

function cloneWorkSignals(signals) {
  return (Array.isArray(signals) ? signals : []).map((signal) => ({
    ...signal,
    categories: [...(signal.categories ?? [])],
    sourceSessionIds: [...(signal.sourceSessionIds ?? [])],
  }));
}

function normalizeOpaqueIdList(value, limit) {
  return uniqueStrings(
    (Array.isArray(value) ? value : []).map(cleanOpaqueId).filter(Boolean),
    limit,
  );
}

function uniqueStrings(value, limit) {
  return [...new Set(value.map(String))].slice(-limit);
}

function normalizeIsoDate(value) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) throw new Error("올바른 학습 시각이 필요합니다.");
  return date.toISOString();
}

function validIsoOrEmpty(value) {
  try {
    return normalizeIsoDate(value);
  } catch {
    return "";
  }
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function finiteNonNegative(value) {
  return boundedNumber(value, 0, Number.MAX_SAFE_INTEGER);
}

function normalizeAgentOutcomeInput(value) {
  if (!value || typeof value !== "object") {
    throw new Error("에이전트 결과 형식이 올바르지 않습니다.");
  }
  return {
    ...value,
    runId: requireSafeOpaqueId(value.runId, "에이전트 결과 runId"),
    agentId: requireSafeAgentId(value.agentId),
  };
}

function requireSafeAgentId(value) {
  const raw = String(value ?? "");
  const agentId = cleanId(raw);
  if (!agentId || raw !== agentId) {
    throw new Error("에이전트 결과 agentId는 안전한 소문자 ID여야 합니다.");
  }
  return agentId;
}

function requireSafeOpaqueId(value, label) {
  const raw = String(value ?? "");
  const id = cleanOpaqueId(raw);
  if (!id || raw !== id) {
    throw new Error(label + "는 256자 이하의 안전한 불투명 ID여야 합니다.");
  }
  return id;
}

function resolveRequiredIndexRoot(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) {
    throw new Error("작업공간 지능 상태를 저장할 폴더가 필요합니다.");
  }
  return path.resolve(candidate);
}

function cleanId(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

function cleanOpaqueId(value) {
  const id = String(value ?? "");
  if (!id || id.length > 256 || !/^[A-Za-z0-9._:@+-]+$/u.test(id)) return "";
  return id;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}
