import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const agentRunLedgerFileName = "agent-run-ledger.v1.json";
export const agentRunLedgerSchema = "mody.agent-run-ledger.v1";

const ledgerVersion = 1;
const maxRuns = 1_000;
const maxApprovalTickets = 1_000;
const retentionMs = 90 * 24 * 60 * 60 * 1000;
const authorizationLifetimeMs = 30 * 60 * 1000;
const approvalTicketLifetimeMs = 30 * 60 * 1000;
const ledgerLockStaleMs = 5 * 60 * 1000;
const workPackIds = new Set([
  "inquiry_response",
  "schedule_coordination",
  "report_cleanup",
  "inventory_reorder",
  "tax_contract_archive",
]);
const terminalDecisions = new Set(["approved", "change_requested", "rejected"]);
const ledgerQueues = new Map();

export function resolveAgentRunLedgerPaths(options = {}) {
  const root = options.storageRoot
    ? path.resolve(String(options.storageRoot))
    : options.app?.getPath
      ? path.resolve(options.app.getPath("userData"))
      : "";
  if (!root) throw new Error("agent run ledger storage root is required");
  const statePath = path.join(root, agentRunLedgerFileName);
  return {
    root,
    statePath,
    previousPath: path.join(root, `${agentRunLedgerFileName}.previous`),
    lockPath: `${statePath}.lock`,
    reclaimLockPath: `${statePath}.lock.reclaim`,
  };
}

// The main process hashes this exact persisted-body contract. A renderer may not
// substitute a digest or a differently normalized body.
export function canonicalizeMainAgentArtifactBody(value) {
  return redactSecretMaterial(value)
    .replace(/\r\n/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .slice(0, 80_000)
    .trim();
}

export async function issueMainAgentRunAuthorization(input = {}, options = {}) {
  const paths = resolveAgentRunLedgerPaths(options);
  return runLedgerMutation(paths, options, async (state, io) => {
    const authority = normalizeIssuedRunAuthority(input);
    if (!authority) return blockedResult(paths, "agent_run_authority_invalid");
    const now = nowDate(options);
    const issuedAt = now.toISOString();
    const run = {
      runId: createUniqueOpaqueId("agent-run", state.runs, "runId"),
      authorizationId: createUniqueOpaqueId("agent-run-authorization", state.runs, "authorizationId"),
      eventId: createUniqueOpaqueId("agent-event", state.runs, "eventId"),
      artifactId: createUniqueOpaqueId("agent-artifact", state.runs, "artifactId"),
      artifactKind: authority.artifactKind,
      sourceTeammateId: authority.sourceTeammateId,
      targetTeammateId: authority.targetTeammateId,
      workPackId: authority.workPackId,
      sourceKind: authority.sourceKind,
      senderId: authority.senderId,
      roleContextTeammateId: authority.roleContextTeammateId,
      profileSnapshotSha256: authority.profileSnapshotSha256,
      requestFingerprint: sha256(input.prompt),
      runStatus: "issued",
      issuedAt,
      authorizationExpiresAt: new Date(now.getTime() + authorizationLifetimeMs).toISOString(),
      startedAt: issuedAt,
      finishedAt: "",
      requestSha256: sha256(input.prompt),
      outputSha256: "",
      outputChars: 0,
      provider: "",
      model: "",
      runtimeRoute: "",
      artifactBinding: null,
      terminalOutcome: null,
      rawPromptStored: false,
      rawOutputStored: false,
      rawSecretMaterialStored: false,
    };
    state.runs = pruneRuns([run, ...state.runs], now.getTime());
    state.updatedAt = issuedAt;
    await writeLedger(paths, state, io);
    return publicRunResult(paths, run, "agent_run_authorization_issued", false);
  });
}

// Completion only accepts a main-issued authorization. Renderer event/artifact,
// target, and work-pack fields are intentionally ignored.
export async function recordMainAgentRunResult(input = {}, options = {}) {
  const paths = resolveAgentRunLedgerPaths(options);
  return runLedgerMutation(paths, options, async (state, io) => {
    const authorizationId = safeOpaqueId(input.authorizationId);
    const senderId = safeSenderId(input.senderId);
    const runStatus = input.runStatus === "done" ? "done" : input.runStatus === "error" ? "error" : "";
    if (!authorizationId || !senderId || !runStatus) {
      return blockedResult(paths, "agent_run_authorization_required");
    }
    const run = state.runs.find((candidate) => candidate.authorizationId === authorizationId);
    if (!run || run.senderId !== senderId || (run.runStatus === "issued" && isAuthorizationExpired(run, options))) {
      return blockedResult(paths, "agent_run_authorization_rejected");
    }
    const canonicalOutput = canonicalizeMainAgentArtifactBody(input.outputText);
    const outputSha256 = sha256(canonicalOutput);
    if (run.runStatus !== "issued") {
      const idempotent = run.runStatus === runStatus && run.outputSha256 === outputSha256;
      return idempotent
        ? publicRunResult(paths, run, "agent_run_already_recorded", true)
        : blockedResult(paths, "agent_run_completion_conflict");
    }
    const finishedAt = normalizeIso(input.finishedAt, nowDate(options).toISOString());
    run.runStatus = runStatus;
    run.finishedAt = finishedAt;
    run.outputSha256 = outputSha256;
    run.outputChars = canonicalOutput.length;
    run.provider = safeText(input.provider, 60);
    run.model = safeText(input.model, 100);
    run.runtimeRoute = safeText(input.runtimeRoute, 80);
    state.updatedAt = finishedAt;
    await writeLedger(paths, state, io);
    return publicRunResult(paths, run, "agent_run_recorded", false);
  });
}

export async function resolveMainAgentRunArtifact(input = {}, options = {}) {
  const paths = resolveAgentRunLedgerPaths(options);
  return runLedgerMutation(paths, options, async (state, io) => {
    const eventId = safeOpaqueId(input.eventId);
    const artifactId = safeOpaqueId(input.artifactId);
    const artifactKind = safeArtifactKind(input.artifactKind);
    const sourceTeammateId = safeAgentId(input.sourceTeammateId);
    const senderId = safeSenderId(input.senderId);
    const canonicalBody = canonicalizeMainAgentArtifactBody(input.artifactBody);
    const bodySha256 = sha256(canonicalBody);
    const run = state.runs.find((candidate) => candidate.eventId === eventId);
    if (
      !run || !artifactId || !artifactKind || !sourceTeammateId || !senderId || !canonicalBody ||
      run.runStatus !== "done" || run.artifactId !== artifactId ||
      run.artifactKind !== artifactKind || run.sourceTeammateId !== sourceTeammateId ||
      run.senderId !== senderId || run.outputSha256 !== bodySha256 || isExpired(run, options)
    ) {
      return { verified: false, status: "agent_run_artifact_binding_rejected" };
    }
    const bindingDigest = createArtifactBindingDigest(run, {
      artifactId,
      artifactKind,
      sourceTeammateId,
      senderId,
      bodySha256,
    });
    const alreadyBound = Boolean(run.artifactBinding);
    if (run.artifactBinding && run.artifactBinding.bindingDigest !== bindingDigest) {
      return { verified: false, status: "agent_run_artifact_already_bound" };
    }
    if (!run.artifactBinding) {
      run.artifactBinding = {
        artifactId,
        artifactKind,
        sourceTeammateId,
        senderId,
        bodySha256,
        bindingDigest,
        boundAt: nowDate(options).toISOString(),
      };
      state.updatedAt = run.artifactBinding.boundAt;
      await writeLedger(paths, state, io);
    }
    return {
      verified: true,
      status: "agent_run_artifact_bound",
      artifactId,
      artifactKind,
      sourceTeammateId,
      eventId: run.eventId,
      runId: run.runId,
      authorizationId: run.authorizationId,
      targetTeammateId: run.targetTeammateId,
      workPackId: run.workPackId,
      profileSnapshotSha256: run.profileSnapshotSha256,
      runStatus: run.runStatus,
      idempotent: alreadyBound,
      rawSecretMaterialReturned: false,
    };
  });
}
// The main process calls this only after native confirmation. The durable ticket
// lets a retry retain the same decision without trusting renderer sender data.
export async function prepareMainAgentRunOutcomeApproval(input = {}, options = {}) {
  const paths = resolveAgentRunLedgerPaths(options);
  return runLedgerMutation(paths, options, async (state, io) => {
    const request = normalizeOutcomeRequest(input);
    if (!request || !(await isApprovalSenderAllowed(request.senderId, options))) {
      return { verified: false, status: "agent_run_outcome_approval_rejected" };
    }
    const run = findOutcomeRun(state, request);
    if (!run || !run.artifactBinding || isExpired(run, options)) {
      return { verified: false, status: "agent_run_outcome_approval_rejected" };
    }
    if (run.terminalOutcome) {
      const terminalTicket = state.approvalTickets.find(
        (ticket) => ticket.ticketId === run.terminalOutcome.approvalTicketId,
      );
      const idempotent = run.terminalOutcome.decisionId === request.decisionId &&
        run.terminalOutcome.decision === request.decision && terminalTicket?.approvingSenderId === request.senderId;
      return {
        verified: idempotent,
        status: idempotent ? "agent_run_outcome_already_finalized" : "agent_run_outcome_terminal_conflict",
        idempotent,
        ...publicOutcomeIdentity(run),
      };
    }
    const existing = state.approvalTickets.find((ticket) =>
      ticket.runId === run.runId && ticket.artifactId === request.artifactId &&
      ticket.decisionId === request.decisionId && ticket.decision === request.decision &&
      ticket.approvingSenderId === request.senderId,
    );
    if (existing && !isTicketExpired(existing, options)) {
      return {
        verified: true,
        status: "agent_run_outcome_approval_prepared",
        approvalTicketId: existing.ticketId,
        decisionId: existing.decisionId,
        idempotent: true,
        ...publicOutcomeIdentity(run),
      };
    }
    const conflictingTicket = state.approvalTickets.find((ticket) =>
      ticket.runId === run.runId && !isTicketExpired(ticket, options) &&
      (ticket.decision !== request.decision || ticket.decisionId !== request.decisionId),
    );
    if (conflictingTicket) return { verified: false, status: "agent_run_outcome_approval_conflict" };
    const now = nowDate(options);
    const ticket = {
      ticketId: createUniqueOpaqueId("agent-outcome-approval", state.approvalTickets, "ticketId"),
      runId: run.runId,
      eventId: run.eventId,
      artifactId: run.artifactId,
      decisionId: request.decisionId,
      decision: request.decision,
      approvingSenderId: request.senderId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + approvalTicketLifetimeMs).toISOString(),
      consumedAt: "",
      status: "prepared",
    };
    state.approvalTickets = pruneApprovalTickets([ticket, ...state.approvalTickets], now.getTime());
    state.updatedAt = ticket.issuedAt;
    await writeLedger(paths, state, io);
    return {
      verified: true,
      status: "agent_run_outcome_approval_prepared",
      approvalTicketId: ticket.ticketId,
      decisionId: ticket.decisionId,
      idempotent: false,
      ...publicOutcomeIdentity(run),
    };
  });
}

export async function probeMainAgentRunOutcomeApproval(input = {}, options = {}) {
  const paths = resolveAgentRunLedgerPaths(options);
  const loaded = await loadLedger(paths, options.io ?? fs);
  if (loaded.writeBlocked) return { verified: false, status: loaded.status };
  const request = normalizeOutcomeRequest(input);
  if (!request || !(await isApprovalSenderAllowed(request.senderId, options))) {
    return { verified: false, status: "agent_run_outcome_approval_rejected" };
  }
  const run = findOutcomeRun(loaded.state, request);
  if (!run) return { verified: false, status: "agent_run_outcome_approval_rejected" };
  const ticket = loaded.state.approvalTickets.find((candidate) =>
    candidate.runId === run.runId && candidate.artifactId === request.artifactId &&
    candidate.decisionId === request.decisionId && candidate.decision === request.decision &&
    candidate.approvingSenderId === request.senderId && !isTicketExpired(candidate, options),
  );
  return ticket
    ? {
        verified: true,
        status: "agent_run_outcome_approval_prepared",
        approvalTicketId: ticket.ticketId,
        decisionId: ticket.decisionId,
        idempotent: true,
        ...publicOutcomeIdentity(run),
      }
    : { verified: false, status: "agent_run_outcome_approval_missing" };
}

export async function finalizeMainAgentRunOutcome(input = {}, options = {}) {
  const paths = resolveAgentRunLedgerPaths(options);
  return runLedgerMutation(paths, options, async (state, io) => {
    const request = normalizeOutcomeRequest(input);
    const approvalTicketId = safeOpaqueId(input.approvalTicketId);
    if (!request || !(await isApprovalSenderAllowed(request.senderId, options))) {
      return { verified: false, status: "agent_run_outcome_rejected" };
    }
    const run = findOutcomeRun(state, request);
    if (!run || !run.artifactBinding || isExpired(run, options)) {
      return { verified: false, status: "agent_run_outcome_rejected" };
    }
    if (run.terminalOutcome) {
      const terminalTicket = state.approvalTickets.find(
        (ticket) => ticket.ticketId === run.terminalOutcome.approvalTicketId,
      );
      const idempotent = run.terminalOutcome.decisionId === request.decisionId &&
        run.terminalOutcome.decision === request.decision && terminalTicket?.approvingSenderId === request.senderId;
      return {
        verified: idempotent,
        status: idempotent ? "agent_run_outcome_already_finalized" : "agent_run_outcome_terminal_conflict",
        idempotent,
        ...publicOutcomeIdentity(run),
      };
    }
    const ticket = state.approvalTickets.find((candidate) => candidate.ticketId === approvalTicketId);
    if (
      !ticket || ticket.status !== "prepared" || isTicketExpired(ticket, options) ||
      ticket.runId !== run.runId || ticket.eventId !== run.eventId ||
      ticket.artifactId !== request.artifactId || ticket.decisionId !== request.decisionId ||
      ticket.decision !== request.decision || ticket.approvingSenderId !== request.senderId
    ) {
      return { verified: false, status: "agent_run_outcome_ticket_rejected" };
    }
    const decidedAt = normalizeIso(input.decidedAt, nowDate(options).toISOString());
    run.terminalOutcome = {
      decisionId: request.decisionId,
      decision: request.decision,
      decidedAt,
      approvalTicketId,
    };
    ticket.status = "consumed";
    ticket.consumedAt = decidedAt;
    state.updatedAt = decidedAt;
    await writeLedger(paths, state, io);
    return {
      verified: true,
      status: "agent_run_outcome_finalized",
      idempotent: false,
      approvalTicketId,
      ...publicOutcomeIdentity(run),
    };
  });
}

export async function readMainAgentRunLedger(options = {}) {
  const paths = resolveAgentRunLedgerPaths(options);
  const loaded = await loadLedger(paths, options.io ?? fs);
  return {
    status: loaded.writeBlocked ? loaded.status : "agent_run_ledger_loaded",
    writeBlocked: loaded.writeBlocked,
    statePath: paths.statePath,
    runCount: loaded.state.runs.length,
    approvalTicketCount: loaded.state.approvalTickets.length,
    runs: clone(loaded.state.runs),
    rawSecretMaterialReturned: false,
  };
}

async function runLedgerMutation(paths, options, task) {
  const io = options.io ?? fs;
  return enqueueLedger(paths.statePath, async () => {
    const locked = await withLedgerLock(paths, io, task, options);
    if (locked.locked) return unavailableResult(paths, "agent_run_ledger_locked");
    return locked.value;
  });
}

async function withLedgerLock(paths, io, task, options = {}) {
  await io.mkdir(paths.root, { recursive: true });
  const ownerId = `agent-ledger-lock-${randomUUID()}`;
  let acquired = await tryAcquireLedgerLock(paths.lockPath, ownerId, io, options);
  if (!acquired) {
    const reclaimed = await reclaimStaleLedgerLock(paths, io, options);
    if (!reclaimed) return { locked: true };
    acquired = await tryAcquireLedgerLock(paths.lockPath, ownerId, io, options);
  }
  if (!acquired) return { locked: true };
  try {
    const loaded = await loadLedger(paths, io);
    if (loaded.writeBlocked) {
      return { value: unavailableResult(paths, loaded.status) };
    }
    return { value: await task(clone(loaded.state), io) };
  } finally {
    await removeOwnedLedgerLock(paths.lockPath, ownerId, io);
  }
}

async function tryAcquireLedgerLock(lockPath, ownerId, io, options) {
  const lockedAt = nowDate(options).toISOString();
  try {
    await io.writeFile(
      lockPath,
      `${JSON.stringify({
        schema: agentRunLedgerSchema,
        kind: "agent_run_ledger_lock",
        ownerId,
        pid: process.pid,
        lockedAt,
      })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

async function reclaimStaleLedgerLock(paths, io, options) {
  const nowMs = nowDate(options).getTime();
  const observed = await readLedgerLock(paths.lockPath, io);
  if (
    observed.status !== "loaded" ||
    nowMs - Date.parse(observed.lock.lockedAt) <= ledgerLockStaleMs ||
    ledgerLockProcessIsAlive(observed.lock.pid, options)
  ) {
    return observed.status === "missing";
  }
  const guardOwnerId = `agent-ledger-reclaim-${randomUUID()}`;
  const guardAcquired = await tryAcquireReclaimGuard(
    paths.reclaimLockPath,
    guardOwnerId,
    io,
    options,
  );
  if (!guardAcquired) return false;
  try {
    const current = await readLedgerLock(paths.lockPath, io);
    if (current.status === "missing") return true;
    if (
      current.status !== "loaded" ||
      current.lock.ownerId !== observed.lock.ownerId ||
      current.lock.lockedAt !== observed.lock.lockedAt ||
      nowMs - Date.parse(current.lock.lockedAt) <= ledgerLockStaleMs ||
      ledgerLockProcessIsAlive(current.lock.pid, options)
    ) {
      return false;
    }
    await io.rm(paths.lockPath, { force: true });
    return true;
  } finally {
    await removeOwnedLedgerLock(paths.reclaimLockPath, guardOwnerId, io);
  }
}

async function tryAcquireReclaimGuard(lockPath, ownerId, io, options) {
  if (await tryAcquireLedgerLock(lockPath, ownerId, io, options)) return true;
  const nowMs = nowDate(options).getTime();
  const observed = await readLedgerLock(lockPath, io);
  if (
    observed.status !== "loaded" ||
    nowMs - Date.parse(observed.lock.lockedAt) <= ledgerLockStaleMs ||
    ledgerLockProcessIsAlive(observed.lock.pid, options)
  ) {
    return false;
  }
  const current = await readLedgerLock(lockPath, io);
  if (
    current.status !== "loaded" ||
    current.lock.ownerId !== observed.lock.ownerId ||
    current.lock.lockedAt !== observed.lock.lockedAt ||
    current.lock.pid !== observed.lock.pid ||
    ledgerLockProcessIsAlive(current.lock.pid, options)
  ) {
    return false;
  }
  await io.rm(lockPath, { force: true });
  return tryAcquireLedgerLock(lockPath, ownerId, io, options);
}

async function readLedgerLock(lockPath, io) {
  try {
    const parsed = JSON.parse(await io.readFile(lockPath, "utf8"));
    const ownerId = safeOpaqueId(parsed?.ownerId);
    const lockedAt = normalizeIso(parsed?.lockedAt, "");
    const pid = Number(parsed?.pid);
    if (
      parsed?.schema !== agentRunLedgerSchema ||
      !["agent_run_ledger_lock", "agent_run_ledger_reclaim"].includes(
        String(parsed?.kind ?? ""),
      ) ||
      !ownerId ||
      !lockedAt ||
      !Number.isInteger(pid) ||
      pid <= 0
    ) {
      return { status: "invalid" };
    }
    return {
      status: "loaded",
      lock: { ownerId, lockedAt, pid },
    };
  } catch (error) {
    return error?.code === "ENOENT"
      ? { status: "missing" }
      : { status: "invalid" };
  }
}

function ledgerLockProcessIsAlive(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  if (typeof options.isProcessAlive === "function") {
    try {
      return options.isProcessAlive(pid) !== false;
    } catch {
      return true;
    }
  }
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function removeOwnedLedgerLock(lockPath, ownerId, io) {
  const current = await readLedgerLock(lockPath, io);
  if (current.status === "loaded" && current.lock.ownerId === ownerId) {
    await io.rm(lockPath, { force: true }).catch(() => undefined);
  }
}
function normalizeIssuedRunAuthority(input = {}) {
  const artifactKind = safeArtifactKind(input.artifactKind || "report");
  const sourceTeammateId = safeAgentId(input.sourceTeammateId);
  const targetTeammateId = safeAgentId(input.targetTeammateId);
  const workPackId = String(input.workPackId ?? "");
  const sourceKind = safeSourceKind(input.sourceKind || "delegated_channel");
  const senderId = safeSenderId(input.senderId);
  const roleContextTeammateId = safeAgentId(input.roleContextTeammateId);
  const profileSnapshotSha256 = safeSha256(input.profileSnapshotSha256);
  if (
    !artifactKind || !sourceTeammateId || !targetTeammateId || !workPackIds.has(workPackId) ||
    !sourceKind || !senderId || !roleContextTeammateId ||
    roleContextTeammateId !== targetTeammateId || !profileSnapshotSha256
  ) {
    return undefined;
  }
  return {
    artifactKind,
    sourceTeammateId,
    targetTeammateId,
    workPackId,
    sourceKind,
    senderId,
    roleContextTeammateId,
    profileSnapshotSha256,
  };
}

function normalizeOutcomeRequest(input = {}) {
  const eventId = safeOpaqueId(input.eventId);
  const runId = safeOpaqueId(input.runId);
  const artifactId = safeOpaqueId(input.artifactId);
  const decisionId = safeOpaqueId(input.decisionId);
  const decision = String(input.decision ?? "");
  const senderId = safeSenderId(input.senderId);
  if (!eventId || !runId || !artifactId || !decisionId || !senderId || !terminalDecisions.has(decision)) {
    return undefined;
  }
  return { eventId, runId, artifactId, decisionId, decision, senderId };
}

function findOutcomeRun(state, request) {
  const run = state.runs.find(
    (candidate) => candidate.eventId === request.eventId && candidate.runId === request.runId,
  );
  if (!run || run.artifactId !== request.artifactId || run.artifactBinding?.artifactId !== request.artifactId) {
    return undefined;
  }
  return run;
}

async function isApprovalSenderAllowed(senderId, options) {
  if (typeof options.isApprovalSenderAllowed !== "function") return false;
  try {
    return (await options.isApprovalSenderAllowed(senderId)) === true;
  } catch {
    return false;
  }
}

function publicOutcomeIdentity(run) {
  return {
    runId: run.runId,
    eventId: run.eventId,
    artifactId: run.artifactId,
    targetTeammateId: run.targetTeammateId,
    workPackId: run.workPackId,
    runStatus: run.runStatus,
    profileSnapshotSha256: run.profileSnapshotSha256,
    ...(run.terminalOutcome
      ? {
          approvalTicketId: run.terminalOutcome.approvalTicketId,
          decisionId: run.terminalOutcome.decisionId,
          decision: run.terminalOutcome.decision,
          decidedAt: run.terminalOutcome.decidedAt,
        }
      : {}),
  };
}

function publicRunResult(paths, run, status, idempotent) {
  return {
    status,
    verified: true,
    idempotent,
    statePath: paths.statePath,
    eventId: run.eventId,
    runId: run.runId,
    authorizationId: run.authorizationId,
    artifactId: run.artifactId,
    artifactKind: run.artifactKind,
    sourceTeammateId: run.sourceTeammateId,
    targetTeammateId: run.targetTeammateId,
    workPackId: run.workPackId,
    profileSnapshotSha256: run.profileSnapshotSha256,
    runStatus: run.runStatus,
    rawSecretMaterialReturned: false,
  };
}

function blockedResult(paths, status) {
  return {
    status,
    verified: false,
    statePath: paths.statePath,
    externalMutation: false,
    rawSecretMaterialReturned: false,
  };
}

function unavailableResult(paths, status) {
  return {
    ...blockedResult(paths, status || "agent_run_ledger_recovery_required"),
    writeBlocked: true,
  };
}

async function loadLedger(paths, io) {
  const primary = await readLedgerCandidate(paths.statePath, io);
  if (primary.state) {
    return { state: primary.state, writeBlocked: false, status: "agent_run_ledger_loaded" };
  }
  const previous = await readLedgerCandidate(paths.previousPath, io);
  if (primary.status === "missing" && previous.status === "missing") {
    return { state: emptyState(), writeBlocked: false, status: "agent_run_ledger_empty" };
  }
  return {
    state: previous.state ?? emptyState(),
    writeBlocked: true,
    status: "agent_run_ledger_recovery_required",
  };
}

async function readLedgerCandidate(filePath, io) {
  try {
    const parsed = JSON.parse(await io.readFile(filePath, "utf8"));
    const state = normalizeState(parsed);
    return state ? { status: "loaded", state } : { status: "invalid" };
  } catch (error) {
    return error?.code === "ENOENT" ? { status: "missing" } : { status: "invalid" };
  }
}

function normalizeState(value) {
  if (
    !value ||
    value.schema !== agentRunLedgerSchema ||
    value.version !== ledgerVersion ||
    !Array.isArray(value.runs) ||
    value.runs.length > maxRuns ||
    (value.approvalTickets !== undefined && !Array.isArray(value.approvalTickets))
  ) {
    return undefined;
  }
  const updatedAt = normalizeIso(value.updatedAt, "");
  if (!updatedAt) return undefined;
  const runs = value.runs.map(normalizeStoredRun).filter(Boolean);
  if (runs.length !== value.runs.length) return undefined;
  const rawTickets = Array.isArray(value.approvalTickets) ? value.approvalTickets : [];
  if (rawTickets.length > maxApprovalTickets) return undefined;
  const approvalTickets = rawTickets.map(normalizeApprovalTicket).filter(Boolean);
  if (approvalTickets.length !== rawTickets.length) return undefined;
  if (!hasUniqueLedgerIdentifiers(runs, approvalTickets)) return undefined;
  if (!validateLedgerRelationships(runs, approvalTickets)) return undefined;
  return {
    schema: agentRunLedgerSchema,
    version: ledgerVersion,
    updatedAt,
    runs,
    approvalTickets,
  };
}

function normalizeStoredRun(value) {
  if (!value || typeof value !== "object") return undefined;
  const eventId = safeOpaqueId(value.eventId);
  const artifactId = safeOpaqueId(value.artifactId);
  const artifactKind = safeArtifactKind(value.artifactKind);
  const sourceTeammateId = safeAgentId(value.sourceTeammateId);
  const targetTeammateId = safeAgentId(value.targetTeammateId);
  const workPackId = String(value.workPackId ?? "");
  const sourceKind = safeSourceKind(value.sourceKind);
  const senderId = safeSenderId(value.senderId);
  const runId = safeOpaqueId(value.runId);
  const authorizationId = safeOpaqueId(value.authorizationId);
  const roleContextTeammateId = safeAgentId(value.roleContextTeammateId);
  const profileSnapshotSha256 = safeSha256(value.profileSnapshotSha256);
  const requestFingerprint = safeSha256(value.requestFingerprint);
  const requestSha256 = safeSha256(value.requestSha256);
  const runStatus = ["issued", "done", "error"].includes(value.runStatus)
    ? value.runStatus
    : "";
  if (
    !eventId ||
    !artifactId ||
    !artifactKind ||
    !sourceTeammateId ||
    !targetTeammateId ||
    !workPackIds.has(workPackId) ||
    !sourceKind ||
    !senderId ||
    !runId ||
    !authorizationId ||
    !roleContextTeammateId ||
    roleContextTeammateId !== targetTeammateId ||
    !profileSnapshotSha256 ||
    !requestFingerprint ||
    !requestSha256 ||
    requestFingerprint !== requestSha256 ||
    !runStatus
  ) {
    return undefined;
  }

  const issuedAt = normalizeIso(value.issuedAt || value.startedAt, "");
  const startedAt = normalizeIso(value.startedAt, "");
  const authorizationExpiresAt = normalizeIso(value.authorizationExpiresAt, "");
  if (
    !issuedAt ||
    !startedAt ||
    !authorizationExpiresAt ||
    Date.parse(startedAt) < Date.parse(issuedAt) ||
    Date.parse(authorizationExpiresAt) < Date.parse(issuedAt)
  ) {
    return undefined;
  }

  const artifactBinding = value.artifactBinding
    ? {
        artifactId: safeOpaqueId(value.artifactBinding.artifactId),
        artifactKind: safeArtifactKind(value.artifactBinding.artifactKind),
        sourceTeammateId: safeAgentId(value.artifactBinding.sourceTeammateId),
        senderId: safeSenderId(value.artifactBinding.senderId),
        bodySha256: safeSha256(value.artifactBinding.bodySha256),
        bindingDigest: safeSha256(value.artifactBinding.bindingDigest),
        boundAt: normalizeIso(value.artifactBinding.boundAt, ""),
      }
    : null;
  if (
    value.artifactBinding &&
    (!artifactBinding.artifactId ||
      !artifactBinding.artifactKind ||
      !artifactBinding.sourceTeammateId ||
      !artifactBinding.senderId ||
      !artifactBinding.bodySha256 ||
      !artifactBinding.bindingDigest ||
      !artifactBinding.boundAt)
  ) {
    return undefined;
  }

  const terminalOutcome = value.terminalOutcome
    ? {
        decisionId: safeOpaqueId(value.terminalOutcome.decisionId),
        decision: terminalDecisions.has(value.terminalOutcome.decision)
          ? value.terminalOutcome.decision
          : "",
        decidedAt: normalizeIso(value.terminalOutcome.decidedAt, ""),
        approvalTicketId: safeOpaqueId(value.terminalOutcome.approvalTicketId),
      }
    : null;
  if (
    value.terminalOutcome &&
    (!terminalOutcome.decisionId ||
      !terminalOutcome.decision ||
      !terminalOutcome.decidedAt ||
      !terminalOutcome.approvalTicketId)
  ) {
    return undefined;
  }

  const finishedAt = runStatus === "issued" ? "" : normalizeIso(value.finishedAt, "");
  const outputSha256 = runStatus === "issued" ? "" : safeSha256(value.outputSha256);
  const outputChars = Number(value.outputChars);
  if (!Number.isInteger(outputChars) || outputChars < 0 || outputChars > 80_000) {
    return undefined;
  }
  if (
    (runStatus === "issued" &&
      (String(value.finishedAt ?? "") ||
        String(value.outputSha256 ?? "") ||
        outputChars !== 0 ||
        artifactBinding ||
        terminalOutcome)) ||
    (runStatus !== "issued" && (!finishedAt || !outputSha256)) ||
    (runStatus === "done" && outputChars === 0) ||
    (runStatus === "error" && (artifactBinding || terminalOutcome))
  ) {
    return undefined;
  }

  return {
    runId,
    authorizationId,
    eventId,
    artifactId,
    artifactKind,
    sourceTeammateId,
    targetTeammateId,
    workPackId,
    sourceKind,
    senderId,
    roleContextTeammateId,
    profileSnapshotSha256,
    requestFingerprint,
    runStatus,
    issuedAt,
    authorizationExpiresAt,
    startedAt,
    finishedAt,
    requestSha256,
    outputSha256,
    outputChars,
    provider: safeText(value.provider, 60),
    model: safeText(value.model, 100),
    runtimeRoute: safeText(value.runtimeRoute, 80),
    artifactBinding,
    terminalOutcome,
    rawPromptStored: false,
    rawOutputStored: false,
    rawSecretMaterialStored: false,
  };
}

function normalizeApprovalTicket(value) {
  if (!value || typeof value !== "object") return undefined;
  const ticket = {
    ticketId: safeOpaqueId(value.ticketId),
    runId: safeOpaqueId(value.runId),
    eventId: safeOpaqueId(value.eventId),
    artifactId: safeOpaqueId(value.artifactId),
    decisionId: safeOpaqueId(value.decisionId),
    decision: terminalDecisions.has(value.decision) ? value.decision : "",
    approvingSenderId: safeSenderId(value.approvingSenderId),
    issuedAt: normalizeIso(value.issuedAt, ""),
    expiresAt: normalizeIso(value.expiresAt, ""),
    consumedAt: value.consumedAt ? normalizeIso(value.consumedAt, "") : "",
    status:
      value.status === "consumed"
        ? "consumed"
        : value.status === "prepared"
          ? "prepared"
          : "",
  };
  if (
    !ticket.ticketId ||
    !ticket.runId ||
    !ticket.eventId ||
    !ticket.artifactId ||
    !ticket.decisionId ||
    !ticket.decision ||
    !ticket.approvingSenderId ||
    !ticket.issuedAt ||
    !ticket.expiresAt ||
    !ticket.status ||
    Date.parse(ticket.expiresAt) < Date.parse(ticket.issuedAt) ||
    (ticket.status === "prepared" && ticket.consumedAt) ||
    (ticket.status === "consumed" &&
      (!ticket.consumedAt ||
        Date.parse(ticket.consumedAt) < Date.parse(ticket.issuedAt) ||
        Date.parse(ticket.consumedAt) > Date.parse(ticket.expiresAt)))
  ) {
    return undefined;
  }
  return ticket;
}

function hasUniqueLedgerIdentifiers(runs, approvalTickets) {
  return (
    hasUniqueValues(runs, "runId") &&
    hasUniqueValues(runs, "authorizationId") &&
    hasUniqueValues(runs, "eventId") &&
    hasUniqueValues(runs, "artifactId") &&
    hasUniqueValues(approvalTickets, "ticketId")
  );
}

function hasUniqueValues(records, key) {
  const values = records.map((record) => record[key]);
  return new Set(values).size === values.length;
}

function validateLedgerRelationships(runs, approvalTickets) {
  const runsById = new Map(runs.map((run) => [run.runId, run]));
  const ticketsById = new Map(
    approvalTickets.map((ticket) => [ticket.ticketId, ticket]),
  );
  const consumedTicketReferences = new Map();

  for (const run of runs) {
    const binding = run.artifactBinding;
    if (binding) {
      if (
        run.runStatus !== "done" ||
        binding.artifactId !== run.artifactId ||
        binding.artifactKind !== run.artifactKind ||
        binding.sourceTeammateId !== run.sourceTeammateId ||
        binding.senderId !== run.senderId ||
        binding.bodySha256 !== run.outputSha256 ||
        binding.bindingDigest !== createArtifactBindingDigest(run, binding) ||
        Date.parse(binding.boundAt) < Date.parse(run.finishedAt)
      ) {
        return false;
      }
    }

    const terminal = run.terminalOutcome;
    if (!terminal) continue;
    if (!binding || run.runStatus !== "done") return false;
    const ticket = ticketsById.get(terminal.approvalTicketId);
    if (
      !ticket ||
      ticket.status !== "consumed" ||
      ticket.runId !== run.runId ||
      ticket.eventId !== run.eventId ||
      ticket.artifactId !== run.artifactId ||
      ticket.decisionId !== terminal.decisionId ||
      ticket.decision !== terminal.decision ||
      ticket.consumedAt !== terminal.decidedAt ||
      Date.parse(terminal.decidedAt) < Date.parse(binding.boundAt)
    ) {
      return false;
    }
    consumedTicketReferences.set(
      ticket.ticketId,
      (consumedTicketReferences.get(ticket.ticketId) ?? 0) + 1,
    );
  }

  for (const ticket of approvalTickets) {
    const run = runsById.get(ticket.runId);
    if (
      !run ||
      run.runStatus !== "done" ||
      !run.artifactBinding ||
      ticket.eventId !== run.eventId ||
      ticket.artifactId !== run.artifactId
    ) {
      return false;
    }
    if (
      ticket.status === "consumed" &&
      consumedTicketReferences.get(ticket.ticketId) !== 1
    ) {
      return false;
    }
  }
  return true;
}

function createArtifactBindingDigest(run, binding) {
  return sha256(
    [
      run.runId,
      run.profileSnapshotSha256,
      binding.artifactId,
      binding.artifactKind,
      binding.sourceTeammateId,
      String(binding.senderId),
      binding.bodySha256,
    ].join("\u0000"),
  );
}
async function writeLedger(paths, state, io) {
  await io.mkdir(paths.root, { recursive: true });
  const text = `${JSON.stringify(state, null, 2)}\n`;
  const tempPath = `${paths.statePath}.${randomUUID()}.tmp`;
  await io.writeFile(tempPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    try {
      const current = await io.readFile(paths.statePath);
      await io.writeFile(paths.previousPath, current, { flag: "w", mode: 0o600 });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      await io.rename(tempPath, paths.statePath);
    } catch (error) {
      // Preserve a valid primary on Windows replacement failure rather than
      // deleting it and creating a replayable recovery gap.
      if (["EEXIST", "EPERM", "EACCES"].includes(error?.code)) {
        throw Object.assign(new Error("agent run ledger atomic replacement unavailable"), {
          code: "AGENT_RUN_LEDGER_REPLACE_UNAVAILABLE",
        });
      }
      throw error;
    }
  } finally {
    await io.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function emptyState() {
  return {
    schema: agentRunLedgerSchema,
    version: ledgerVersion,
    updatedAt: new Date(0).toISOString(),
    runs: [],
    approvalTickets: [],
  };
}

function pruneRuns(runs, nowMs) {
  const seenEvents = new Set();
  return runs
    .filter((run) => {
      if (seenEvents.has(run.eventId)) return false;
      seenEvents.add(run.eventId);
      const relevantAt = Date.parse(run.finishedAt || run.issuedAt || run.startedAt);
      return Number.isFinite(relevantAt) && nowMs - relevantAt <= retentionMs;
    })
    .slice(0, maxRuns);
}

function pruneApprovalTickets(tickets, nowMs) {
  const seen = new Set();
  return tickets
    .filter((ticket) => {
      if (seen.has(ticket.ticketId)) return false;
      seen.add(ticket.ticketId);
      const issuedAt = Date.parse(ticket.issuedAt);
      return Number.isFinite(issuedAt) && nowMs - issuedAt <= retentionMs;
    })
    .slice(0, maxApprovalTickets);
}

function isAuthorizationExpired(run, options) {
  const expiresAt = Date.parse(run.authorizationExpiresAt);
  return !Number.isFinite(expiresAt) || nowDate(options).getTime() > expiresAt;
}

function isExpired(run, options) {
  const finishedAt = Date.parse(run.finishedAt || run.issuedAt || run.startedAt);
  return !Number.isFinite(finishedAt) || nowDate(options).getTime() - finishedAt > retentionMs;
}

function isTicketExpired(ticket, options) {
  const expiresAt = Date.parse(ticket.expiresAt);
  return !Number.isFinite(expiresAt) || nowDate(options).getTime() > expiresAt;
}

function enqueueLedger(key, task) {
  const previous = ledgerQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  ledgerQueues.set(key, current);
  return current.finally(() => {
    if (ledgerQueues.get(key) === current) ledgerQueues.delete(key);
  });
}

function createUniqueOpaqueId(prefix, records, key) {
  let value;
  do {
    value = `${prefix}-${randomUUID()}`;
  } while (records.some((record) => record?.[key] === value));
  return value;
}

function safeOpaqueId(value) {
  const text = String(value ?? "");
  return /^[A-Za-z0-9._:@+-]{1,256}$/u.test(text) ? text : "";
}

function safeAgentId(value) {
  const text = String(value ?? "");
  return /^[a-z0-9._-]{1,80}$/u.test(text) ? text : "";
}

function safeArtifactKind(value) {
  const text = String(value ?? "");
  return /^[a-z_]{1,40}$/u.test(text) ? text : "";
}

function safeSourceKind(value) {
  const text = String(value ?? "");
  return /^[a-z_]{1,60}$/u.test(text) ? text : "";
}

function safeSenderId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function safeSha256(value) {
  const text = String(value ?? "").toLowerCase();
  return /^[a-f0-9]{64}$/u.test(text) ? text : "";
}

function safeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
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

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function normalizeIso(value, fallback) {
  const time = Date.parse(String(value ?? ""));
  if (Number.isFinite(time)) return new Date(time).toISOString();
  return fallback;
}

function nowDate(options) {
  const value = typeof options.now === "function" ? options.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}