import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, watch as watchDirectory } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";

const STATE_VERSION = 1;
const STATE_FILE_NAME = "document-learning-supervisor.v1.json";
const PREVIOUS_STATE_FILE_NAME = "document-learning-supervisor.v1.previous.json";
const MAX_SOURCES = 100;
const MAX_STATE_FILES_PER_SOURCE = 500;
const MAX_ACKNOWLEDGED_TEAMMATE_DRAFT_IDS = 64;

const SUPPORTED_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "md",
  "pdf",
  "ppt",
  "pptx",
  "key",
  "hwp",
  "hwpx",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "json",
  "html",
  "xml",
  "rtf",
  "mp4",
  "mov",
  "mkv",
  "avi",
  "webm",
  "m4v",
  "psd",
  "ai",
  "fig",
  "sketch",
  "xd",
  "prproj",
  "aep",
  "indd",
  "eml",
  "msg",
  "mbox",
  "zip",
  "7z",
  "rar",
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  "node_modules",
  "$Recycle.Bin",
  "System Volume Information",
  "Windows",
  "Program Files",
  "Program Files (x86)",
  "ProgramData",
  "ModyCrew_Local_Index",
  "ModyCrew_Local_Data",
].map((name) => name.toLocaleLowerCase("en-US")));

const DEFAULT_POLICY = Object.freeze({
  maxFiles: 30,
  maxDepth: 5,
  maxFileBytes: 20 * 1024 * 1024,
  maxBatchBytes: 50 * 1024 * 1024,
  timeLimitMs: 30_000,
});

const DEFAULT_RUNTIME = Object.freeze({
  debounceMs: 1_500,
  maxDebounceMs: 6_000,
  reconcileIntervalMs: 5 * 60 * 1_000,
  stabilityDelayMs: 180,
  globalConcurrency: 1,
  stopGraceMs: 2_000,
});

class SupervisorAbortError extends Error {
  constructor(message = "document learning supervisor was stopped") {
    super(message);
    this.name = "SupervisorAbortError";
  }
}

class ScanBudgetExceededError extends Error {
  constructor(message = "document learning scan budget exhausted") {
    super(message);
    this.name = "ScanBudgetExceededError";
  }
}

/**
 * Returns the only paths the supervisor may use for its durable state.  The
 * state directory is deliberately constrained below Electron userData.
 */
export function resolveDocumentLearningSupervisorPaths(options = {}) {
  const userDataCandidate =
    typeof options.userDataPath === "string" && options.userDataPath.trim()
      ? options.userDataPath
      : options.app && typeof options.app.getPath === "function"
        ? options.app.getPath("userData")
        : "";
  if (typeof userDataCandidate !== "string" || !userDataCandidate.trim()) {
    throw new Error("document learning supervisor requires app.getPath('userData') or userDataPath");
  }

  const userDataPath = path.resolve(userDataCandidate);
  const requestedDirectory =
    typeof options.stateDirectory === "string" && options.stateDirectory.trim()
      ? options.stateDirectory
      : path.join(userDataPath, "document-learning-supervisor");
  const stateDirectory = path.resolve(requestedDirectory);
  if (!isPathWithin(userDataPath, stateDirectory)) {
    throw new Error("document learning supervisor state must stay below userData");
  }

  return Object.freeze({
    userDataPath,
    stateDirectory,
    statePath: path.join(stateDirectory, STATE_FILE_NAME),
    previousStatePath: path.join(stateDirectory, PREVIOUS_STATE_FILE_NAME),
  });
}

/**
 * Main-process-only, approval-gated local document learning supervisor.
 *
 * `confirmSource` must be implemented by the Electron main process with a
 * native confirmation flow. Renderer-provided booleans are never accepted as
 * authorization. `learnFiles` receives only file metadata and an approved
 * source descriptor; this module never invokes connectors, trigger runners,
 * shells, nor any mutation of the original source files.
 */
export function createDocumentLearningSupervisor(options = {}) {
  if (typeof options.learnFiles !== "function") {
    throw new Error("document learning supervisor requires a learnFiles callback");
  }

  const paths = resolveDocumentLearningSupervisorPaths(options);
  const runtimeOptions = normalizeRuntimeOptions(options);
  const excludedRoots = buildExcludedRoots(paths, options);
  const learnFiles = options.learnFiles;
  const confirmSource = typeof options.confirmSource === "function" ? options.confirmSource : null;
  const watchFactory = typeof options.watchFactory === "function" ? options.watchFactory : watchDirectory;
  const beforeOpenTrustedFile =
    typeof options.beforeOpenTrustedFile === "function" ? options.beforeOpenTrustedFile : null;
  const writeStateSnapshot =
    typeof options.writeStateSnapshot === "function"
      ? options.writeStateSnapshot
      : atomicWriteJsonWithPrevious;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const limiter = createAsyncLimiter(runtimeOptions.globalConcurrency);

  let state = createEmptyState();
  let stateStatus = "not_started";
  let stateLoadError = "";
  let stateLoaded = false;
  let started = false;
  let startPromise = null;
  let stopPromise = null;
  let stateWriteQueue = Promise.resolve();

  const runtimes = new Map();
  const sourceQueues = new Map();
  const sourceEpochs = new Map();
  let supervisorEpoch = 0;

  async function ensureStateLoaded() {
    if (stateLoaded) return;
    const loaded = await readSupervisorState(paths);
    state = loaded.state;
    stateStatus = loaded.status;
    stateLoadError = loaded.errorMessage;
    stateLoaded = true;
  }

  function queueStateOperation(operation) {
    const previous = stateWriteQueue.catch(() => undefined);
    const queued = previous.then(operation);
    stateWriteQueue = queued;
    return queued;
  }

  async function persistState() {
    return queueStateOperation(() =>
      writeStateSnapshot(paths, cloneJson(state)),
    );
  }

  async function start() {
    if (started) return getStatus();
    if (startPromise) return startPromise;

    startPromise = (async () => {
      await ensureStateLoaded();
      if (stateStatus === "corrupt_fail_closed") {
        return getStatus();
      }

      started = true;
      let changedState = false;
      const initialRuns = [];
      for (const source of state.sources) {
        if (source.status !== "active") continue;
        const identity = await verifyStoredSourceIdentity(source);
        if (!identity.ok) {
          transitionToNeedsReapproval(source, identity.reason);
          changedState = true;
          continue;
        }
        openSourceRuntime(source);
        initialRuns.push(reconcile(source.sourceId, { reason: "startup" }));
      }
      if (changedState) await persistState();
      await Promise.allSettled(initialRuns);
      return getStatus();
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      started = false;
      supervisorEpoch += 1;
      for (const runtime of runtimes.values()) closeRuntime(runtime, { abort: true });
      const queued = [...sourceQueues.values()]
        .map((slot) => slot.current)
        .filter(Boolean);
      await Promise.race([
        Promise.allSettled(queued),
        waitForStopGrace(runtimeOptions.stopGraceMs),
      ]);
      return {
        status: "document_learning_supervisor_stopped",
        externalMutation: false,
      };
    })();
    try {
      return await stopPromise;
    } finally {
      stopPromise = null;
    }
  }

  async function enableSources(folders) {
    await ensureStateLoaded();
    const requestedFolders = normalizeFolderInputs(folders);
    if (requestedFolders.length === 0) {
      return result("document_learning_no_sources_requested", { sources: [] });
    }
    if (!confirmSource) {
      return result("document_learning_approval_required", {
        sources: requestedFolders.map((entry) => ({ path: entry.path, status: "approval_required" })),
      });
    }

    const prepared = [];
    for (const entry of requestedFolders) {
      try {
        const root = await canonicalizeApprovedRoot(entry.path);
        const decision = await confirmSource(
          Object.freeze({
            requestedPath: path.resolve(entry.path),
            canonicalRoot: root.canonicalRoot,
            label: safeLabel(entry.label, root.canonicalRoot),
            approvalPurpose: "continuous_watch",
            policy: Object.freeze({ ...normalizePolicy(entry.policy ?? entry) }),
          }),
        );
        if (!isApprovedDecision(decision)) {
          prepared.push({ path: root.canonicalRoot, status: "approval_declined" });
          continue;
        }
        prepared.push({ entry, root, status: "approved" });
      } catch (error) {
        prepared.push({
          path: typeof entry.path === "string" ? path.resolve(entry.path) : "",
          status: "rejected",
          reason: safeErrorMessage(error),
        });
      }
    }

    const approved = prepared.filter((entry) => entry.status === "approved");
    if (approved.length === 0) {
      return result("document_learning_no_sources_enabled", { sources: prepared });
    }

    // A user who explicitly confirms a fresh folder may recover from a corrupt
    // registry. We never auto-recover or auto-resume a corrupt registry.
    if (stateStatus === "corrupt_fail_closed") {
      state = createEmptyState();
      stateStatus = "recovered_after_explicit_approval";
      stateLoadError = "";
    }

    const changedSources = [];
    for (const item of approved) {
      const sourceId = sourceIdFor(item.root.canonicalRoot);
      const policy = normalizePolicy(item.entry.policy ?? item.entry);
      const existing = findSource(sourceId);
      const preserveStaffingState = Boolean(
        existing && sameIdentity(existing.rootIdentity, item.root.rootIdentity),
      );
      const source = {
        sourceId,
        canonicalRoot: item.root.canonicalRoot,
        rootIdentity: item.root.rootIdentity,
        label: safeLabel(item.entry.label, item.root.canonicalRoot),
        status: "active",
        approvedAt: nowIso(now),
        createdAt: existing?.createdAt ?? nowIso(now),
        updatedAt: nowIso(now),
        policy,
        files: existing?.files ?? createDictionary(),
        staleFiles: existing?.staleFiles ?? createDictionary(),
        lastResult: existing?.lastResult ?? null,
        pendingTeammateProposal: preserveStaffingState
          ? existing?.pendingTeammateProposal ?? null
          : null,
        acknowledgedTeammateDraftIds: preserveStaffingState
          ? existing?.acknowledgedTeammateDraftIds ?? []
          : [],
        acknowledgedTeammateRoleKeys: preserveStaffingState
          ? existing?.acknowledgedTeammateRoleKeys ?? []
          : [],
        lastError: "",
        watcherError: "",
      };
      if (existing) {
        advanceSourceEpoch(sourceId);
        closeRuntime(runtimes.get(sourceId), { abort: true });
        const index = state.sources.indexOf(existing);
        state.sources.splice(index, 1, source);
      } else if (state.sources.length < MAX_SOURCES) {
        state.sources.push(source);
      } else {
        prepared.push({ path: item.root.canonicalRoot, status: "source_limit_reached" });
        continue;
      }
      changedSources.push(source);
      prepared.push({ sourceId, path: source.canonicalRoot, status: "enabled" });
    }

    if (changedSources.length === 0) {
      return result("document_learning_no_sources_enabled", { sources: prepared });
    }
    await persistState();

    const initialRuns = [];
    if (started) {
      for (const source of changedSources) {
        openSourceRuntime(source);
        initialRuns.push(reconcile(source.sourceId, { reason: "enabled" }));
      }
    }
    await Promise.allSettled(initialRuns);
    return result("document_learning_sources_enabled", {
      sources: prepared,
      supervisor: getStatus(),
    });
  }

  async function pause(sourceId) {
    await ensureStateLoaded();
    const source = findSource(sourceId);
    if (!source) return result("document_learning_source_not_found", { sourceId });
    if (source.status === "needs_reapproval") {
      return result("document_learning_source_needs_reapproval", { sourceId });
    }
    advanceSourceEpoch(sourceId);
    closeRuntime(runtimes.get(sourceId), { abort: true });
    source.status = "paused";
    source.updatedAt = nowIso(now);
    source.lastResult = createResultSummary("paused", { reason: "user_paused" });
    await persistState();
    return result("document_learning_source_paused", { sourceId });
  }

  async function resume(sourceId) {
    await ensureStateLoaded();
    const source = findSource(sourceId);
    if (!source) return result("document_learning_source_not_found", { sourceId });
    const resumeEpoch = currentSourceEpoch(sourceId);
    const identity = await verifyStoredSourceIdentity(source);
    if (findSource(sourceId) !== source || currentSourceEpoch(sourceId) !== resumeEpoch) {
      return sourceLifecycleResult(sourceId);
    }
    if (!identity.ok) {
      transitionToNeedsReapproval(source, identity.reason);
      await persistState();
      return result("document_learning_source_needs_reapproval", { sourceId, reason: identity.reason });
    }
    advanceSourceEpoch(sourceId);
    source.status = "active";
    source.updatedAt = nowIso(now);
    source.lastError = "";
    await persistState();
    if (!started) return result("document_learning_source_resumed_waiting_for_start", { sourceId });
    openSourceRuntime(source);
    return reconcile(sourceId, { reason: "resumed" });
  }

  async function revoke(sourceId) {
    await ensureStateLoaded();
    const source = findSource(sourceId);
    if (!source) return result("document_learning_source_not_found", { sourceId });
    advanceSourceEpoch(sourceId);
    closeRuntime(runtimes.get(sourceId), { abort: true });
    runtimes.delete(sourceId);
    state.sources = state.sources.filter((candidate) => candidate.sourceId !== sourceId);
    await persistState();
    return result("document_learning_source_revoked", { sourceId });
  }

  async function acknowledgeTeammateProposal(sourceId, draftId, proposalId) {
    await ensureStateLoaded();
    const safeDraftId = safeOpaqueId(draftId, 240);
    const safeProposalId = sanitizeTeammateProposalId(proposalId);
    if (!safeDraftId || !safeProposalId) {
      return result("document_learning_teammate_proposal_invalid", { sourceId });
    }
    return queueStateOperation(async () => {
      const source = findSource(sourceId);
      if (!source) {
        return result("document_learning_source_not_found", { sourceId });
      }
      const pending = source.pendingTeammateProposal;
      if (
        !pending ||
        pending.draftId !== safeDraftId ||
        pending.proposalId !== safeProposalId
      ) {
        return result("document_learning_teammate_proposal_not_found", {
          sourceId,
        });
      }
      const previousAcknowledgedIds =
        source.acknowledgedTeammateDraftIds ?? [];
      const previousAcknowledgedRoleKeys =
        source.acknowledgedTeammateRoleKeys ?? [];
      const previousPending = source.pendingTeammateProposal;
      const previousUpdatedAt = source.updatedAt;
      source.acknowledgedTeammateDraftIds = [
        ...previousAcknowledgedIds.filter((value) => value !== safeDraftId),
        safeDraftId,
      ].slice(-MAX_ACKNOWLEDGED_TEAMMATE_DRAFT_IDS);
      source.acknowledgedTeammateRoleKeys = [
        ...previousAcknowledgedRoleKeys.filter(
          (value) => value !== pending.roleKey,
        ),
        pending.roleKey,
      ].slice(-MAX_ACKNOWLEDGED_TEAMMATE_DRAFT_IDS);
      source.pendingTeammateProposal = null;
      source.updatedAt = nowIso(now);
      try {
        await writeStateSnapshot(paths, cloneJson(state));
      } catch (error) {
        source.acknowledgedTeammateDraftIds = previousAcknowledgedIds;
        source.acknowledgedTeammateRoleKeys =
          previousAcknowledgedRoleKeys;
        source.pendingTeammateProposal = previousPending;
        source.updatedAt = previousUpdatedAt;
        throw error;
      }
      return result("document_learning_teammate_proposal_acknowledged", {
        sourceId,
        draftId: safeDraftId,
        proposalId: safeProposalId,
      });
    });
  }

  async function reconcile(sourceId, reconcileOptions = {}) {
    await ensureStateLoaded();
    if (!started) return result("document_learning_supervisor_not_started", { sourceId });
    return queueSource(sourceId, async () => {
      const source = findSource(sourceId);
      if (!source) return result("document_learning_source_revoked", { sourceId });
      if (source.status === "needs_reapproval") {
        return result("document_learning_source_needs_reapproval", { sourceId });
      }
      if (source.status !== "active") return result("document_learning_source_paused", { sourceId });

      const sourceEpoch = currentSourceEpoch(sourceId);
      const runEpoch = supervisorEpoch;
      const identity = await verifyStoredSourceIdentity(source);
      if (!isCurrentSource(source, sourceEpoch, runEpoch)) return sourceLifecycleResult(sourceId);
      if (!identity.ok) {
        transitionToNeedsReapproval(source, identity.reason);
        closeRuntime(runtimes.get(sourceId), { abort: true });
        await persistState();
        return result("document_learning_source_needs_reapproval", { sourceId, reason: identity.reason });
      }

      const runtime = openSourceRuntime(source);
      const controller = new AbortController();
      runtime.controller = controller;
      const startedAt = Date.now();
      try {
        const scan = await scanApprovedSource(source, {
          signal: controller.signal,
          paths,
          excludedRoots,
          stabilityDelayMs: runtimeOptions.stabilityDelayMs,
          beforeOpenTrustedFile,
        });
        throwIfAborted(controller.signal);
        if (!isCurrentSource(source, sourceEpoch, runEpoch)) return sourceLifecycleResult(sourceId);

        if (scan.complete !== true) {
          source.updatedAt = nowIso(now);
          source.lastError = "";
          source.lastResult = createResultSummary("incomplete", {
            candidateFiles: scan.files.length,
            skippedCount: scan.skippedCount,
            complete: false,
            durationMs: Date.now() - startedAt,
            reason: "bounded_scan_incomplete",
          });
          await persistState();
          return result("document_learning_reconcile_incomplete", {
            sourceId,
            candidateFiles: scan.files.length,
            skippedCount: scan.skippedCount,
            complete: false,
          });
        }

        const known = source.files ?? createDictionary();
        const next = buildNextSourceSnapshot(known, source.staleFiles, scan.files, now);
        if (next.changed.length === 0 && next.staleCount === 0) {
          source.updatedAt = nowIso(now);
          source.lastError = "";
          source.lastResult = createResultSummary("no_changes", {
            candidateFiles: scan.files.length,
            staleCount: 0,
            skippedCount: scan.skippedCount,
            complete: true,
            durationMs: Date.now() - startedAt,
          });
          await persistState();
          return result("document_learning_no_changes", {
            sourceId,
            candidateFiles: scan.files.length,
            staleCount: 0,
            skippedCount: scan.skippedCount,
            complete: true,
          });
        }

        const safeFiles = Object.freeze(scan.files.map((file, index) => freezeSafeFileRecord(file, source, index)));
        const expectedContentSha256s = safeFiles.map((file) => file.contentSha256).sort();
        const snapshotDigest = createSnapshotDigest(scan.files);
        const sourceInfo = Object.freeze({
          sourceId: source.sourceId,
          canonicalRoot: source.canonicalRoot,
          label: source.label,
          approvedAt: source.approvedAt,
          policy: Object.freeze({ ...source.policy }),
          reason: safeReason(reconcileOptions.reason),
          changedFileCount: next.changed.length,
          changedRelativePaths: Object.freeze(next.changed.map((file) => file.relativePath)),
          fullSnapshot: true,
          emptySnapshot: safeFiles.length === 0,
          snapshotDigest,
          acceptedContentSha256s: Object.freeze([...expectedContentSha256s]),
          signal: controller.signal,
          externalMutation: false,
        });
        const callbackResult = await learnFiles(safeFiles, sourceInfo);
        throwIfAborted(controller.signal);
        if (!isCurrentSource(source, sourceEpoch, runEpoch)) return sourceLifecycleResult(sourceId);
        assertAcceptedSnapshotReceipt(callbackResult, snapshotDigest, expectedContentSha256s);

        const pendingProposal = createPendingTeammateProposal({
          sourceId: source.sourceId,
          snapshotDigest,
          proposedAt: nowIso(now),
          draft: callbackResult?.teammateProfileDraft,
        });
        if (
          pendingProposal &&
          !(source.acknowledgedTeammateDraftIds ?? []).includes(
            pendingProposal.draftId,
          ) &&
          !(source.acknowledgedTeammateRoleKeys ?? []).includes(
            pendingProposal.roleKey,
          ) &&
          (source.pendingTeammateProposal?.draftId !== pendingProposal.draftId ||
            source.pendingTeammateProposal?.snapshotDigest !== pendingProposal.snapshotDigest)
        ) {
          source.pendingTeammateProposal = pendingProposal;
        }

        source.files = next.files;
        source.staleFiles = next.staleFiles;
        source.updatedAt = nowIso(now);
        source.lastLearnedAt = nowIso(now);
        source.lastError = "";
        source.lastResult = createResultSummary("learned", {
          learnedCount: next.changed.length,
          candidateFiles: scan.files.length,
          staleCount: next.staleCount,
          skippedCount: scan.skippedCount,
          complete: true,
          durationMs: Date.now() - startedAt,
          callbackStatus: summarizeCallbackResult(callbackResult),
        });
        await persistState();
        return result("document_learning_reconciled", {
          sourceId,
          learnedCount: next.changed.length,
          candidateFiles: scan.files.length,
          staleCount: next.staleCount,
          skippedCount: scan.skippedCount,
          complete: true,
        });
      } catch (error) {
        if (error instanceof SupervisorAbortError || !isCurrentSource(source, sourceEpoch, runEpoch)) {
          return sourceLifecycleResult(sourceId);
        }
        source.updatedAt = nowIso(now);
        source.lastError = safeErrorMessage(error);
        source.lastResult = createResultSummary("failed", {
          durationMs: Date.now() - startedAt,
          error: source.lastError,
        });
        try {
          await persistState();
        } catch {
          // A failed state write must never turn into a retrying watcher loop.
        }
        return result("document_learning_reconcile_failed", {
          sourceId,
          errorMessage: source.lastError,
        });
      } finally {
        if (runtime.controller === controller) runtime.controller = null;
      }
    });
  }

  function scheduleReconcile(sourceId, reason = "watch") {
    if (!started) return;
    const source = findSource(sourceId);
    if (!source || source.status !== "active") return;
    const runtime = openSourceRuntime(source);
    const current = Date.now();
    if (!runtime.firstEventAt) runtime.firstEventAt = current;
    const elapsed = current - runtime.firstEventAt;
    const delay = elapsed >= runtimeOptions.maxDebounceMs ? 0 : runtimeOptions.debounceMs;
    if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
    runtime.debounceTimer = setTimeout(() => {
      runtime.debounceTimer = null;
      runtime.firstEventAt = 0;
      void reconcile(sourceId, { reason }).catch(() => undefined);
    }, delay);
  }

  function openSourceRuntime(source) {
    let runtime = runtimes.get(source.sourceId);
    if (!runtime) {
      runtime = {
        sourceId: source.sourceId,
        watcher: null,
        interval: null,
        debounceTimer: null,
        firstEventAt: 0,
        controller: null,
      };
      runtimes.set(source.sourceId, runtime);
    }
    if (!started || source.status !== "active") return runtime;

    if (!runtime.watcher) {
      const callback = () => {
        // fs.watch filenames are platform-dependent and attacker-controlled.
        // Never derive a path from them; reconcile the already-approved root.
        scheduleReconcile(source.sourceId, "watch");
      };
      try {
        runtime.watcher = watchFactory(source.canonicalRoot, {
          persistent: true,
          recursive: true,
        }, callback);
      } catch (error) {
        try {
          runtime.watcher = watchFactory(source.canonicalRoot, { persistent: true, recursive: false }, callback);
        } catch (fallbackError) {
          noteWatcherError(source, fallbackError ?? error);
        }
      }
      if (runtime.watcher && typeof runtime.watcher.on === "function") {
        runtime.watcher.on("error", (error) => noteWatcherError(source, error));
      }
    }
    if (!runtime.interval && runtimeOptions.reconcileIntervalMs > 0) {
      runtime.interval = setInterval(() => scheduleReconcile(source.sourceId, "periodic"), runtimeOptions.reconcileIntervalMs);
    }
    return runtime;
  }

  function closeRuntime(runtime, { abort = false } = {}) {
    if (!runtime) return;
    if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
    if (runtime.interval) clearInterval(runtime.interval);
    if (abort && runtime.controller) runtime.controller.abort();
    try {
      runtime.watcher?.close?.();
    } catch {
      // Closing an already-failed OS watcher is best effort only.
    }
    runtime.watcher = null;
    runtime.interval = null;
    runtime.debounceTimer = null;
    runtime.firstEventAt = 0;
  }

  function noteWatcherError(source, error) {
    source.watcherError = safeErrorMessage(error);
    source.updatedAt = nowIso(now);
    void persistState().catch(() => undefined);
  }

  function queueSource(sourceId, task) {
    let slot = sourceQueues.get(sourceId);
    if (!slot) {
      slot = { running: false, dirty: false, nextTask: null, current: null };
      sourceQueues.set(sourceId, slot);
    }
    if (slot.running) {
      slot.dirty = true;
      slot.nextTask = task;
      return Promise.resolve(result("document_learning_reconcile_coalesced", { sourceId }));
    }
    slot.running = true;
    slot.current = (async () => {
      let currentTask = task;
      let finalResult;
      while (true) {
        slot.dirty = false;
        slot.nextTask = null;
        finalResult = await limiter.run(currentTask);
        if (!started || !slot.dirty) break;
        currentTask = slot.nextTask ?? currentTask;
      }
      return finalResult;
    })().finally(() => {
      slot.running = false;
      slot.current = null;
      if (sourceQueues.get(sourceId) === slot) sourceQueues.delete(sourceId);
    });
    return slot.current;
  }

  async function verifyStoredSourceIdentity(source) {
    try {
      const resolved = await canonicalizeApprovedRoot(source.canonicalRoot);
      if (!samePath(resolved.canonicalRoot, source.canonicalRoot)) {
        return { ok: false, reason: "canonical_root_changed" };
      }
      if (!sameIdentity(resolved.rootIdentity, source.rootIdentity)) {
        return { ok: false, reason: "root_identity_changed" };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: safeErrorMessage(error) || "root_unavailable" };
    }
  }

  function transitionToNeedsReapproval(source, reason) {
    source.status = "needs_reapproval";
    source.updatedAt = nowIso(now);
    source.lastError = safeReason(reason) || "root_identity_changed";
    source.lastResult = createResultSummary("needs_reapproval", { reason: source.lastError });
    source.pendingTeammateProposal = null;
    source.acknowledgedTeammateDraftIds = [];
    source.acknowledgedTeammateRoleKeys = [];
  }

  function findSource(sourceId) {
    return state.sources.find((source) => source.sourceId === sourceId) ?? null;
  }

  function currentSourceEpoch(sourceId) {
    return sourceEpochs.get(sourceId) ?? 0;
  }

  function advanceSourceEpoch(sourceId) {
    const next = currentSourceEpoch(sourceId) + 1;
    sourceEpochs.set(sourceId, next);
    return next;
  }

  function isCurrentSource(source, sourceEpoch, runEpoch = supervisorEpoch) {
    return (
      started &&
      supervisorEpoch === runEpoch &&
      currentSourceEpoch(source.sourceId) === sourceEpoch &&
      findSource(source.sourceId) === source &&
      source.status === "active"
    );
  }

  function sourceLifecycleResult(sourceId) {
    const current = findSource(sourceId);
    if (!current) return result("document_learning_source_revoked", { sourceId });
    if (current.status === "needs_reapproval") {
      return result("document_learning_source_needs_reapproval", { sourceId });
    }
    if (!started) return result("document_learning_reconcile_aborted", { sourceId });
    return result("document_learning_source_paused", { sourceId });
  }

  function getStatus() {
    const nextPendingTeammateProposal = state.sources
      .map((source) =>
        sanitizeDocumentLearningSupervisorTeammateProposal(source.pendingTeammateProposal),
      )
      .filter(Boolean)
      .sort(
        (left, right) =>
          left.proposedAt.localeCompare(right.proposedAt) ||
          left.sourceId.localeCompare(right.sourceId) ||
          left.draftId.localeCompare(right.draftId),
      )[0] ?? null;
    return Object.freeze({
      status: stateStatus === "corrupt_fail_closed" ? "document_learning_supervisor_fail_closed" : "document_learning_supervisor_ready",
      stateStatus,
      statePath: paths.statePath,
      previousStatePath: paths.previousStatePath,
      started,
      stateLoadError,
      sources: state.sources.map((source) => Object.freeze({
        sourceId: source.sourceId,
        canonicalRoot: source.canonicalRoot,
        label: source.label,
        status: source.status,
        approvedAt: source.approvedAt,
        lastLearnedAt: source.lastLearnedAt ?? "",
        lastError: source.lastError ?? "",
        watcherError: source.watcherError ?? "",
        knownFileCount: Object.keys(source.files ?? {}).length,
        staleFileCount: Object.keys(source.staleFiles ?? {}).length,
        lastResult: source.lastResult ? { ...source.lastResult } : null,
      })),
      nextPendingTeammateProposal,
      externalMutation: false,
    });
  }

  return Object.freeze({
    start,
    stop,
    enableSources,
    getStatus,
    pause,
    resume,
    revoke,
    acknowledgeTeammateProposal,
    reconcile,
  });
}

async function scanApprovedSource(source, input) {
  const policy = normalizePolicy(source.policy);
  const deadline = Date.now() + policy.timeLimitMs;
  const files = [];
  let batchBytes = 0;
  let skippedCount = 0;
  let complete = true;
  const visitedDirectories = new Set();
  const stack = [{ directory: source.canonicalRoot, depth: 0 }];

  try {
    while (stack.length > 0) {
      throwIfAborted(input.signal);
      throwIfPastDeadline(deadline);
      const current = stack.shift();
      if (!current) break;
      const directoryInspection = await inspectApprovedPath(current.directory, source.canonicalRoot);
      if (!directoryInspection.ok || !directoryInspection.stats.isDirectory()) {
        skippedCount += 1;
        continue;
      }
      const directoryKey = comparablePath(directoryInspection.canonicalPath);
      if (visitedDirectories.has(directoryKey)) {
        skippedCount += 1;
        continue;
      }
      visitedDirectories.add(directoryKey);
      if (isInternalPath(directoryInspection.canonicalPath, input.paths, input.excludedRoots)) continue;

      let entries;
      try {
        entries = await readdir(directoryInspection.canonicalPath, { withFileTypes: true });
      } catch {
        skippedCount += 1;
        continue;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));

      for (const entry of entries) {
        throwIfAborted(input.signal);
        throwIfPastDeadline(deadline);
        const entryPath = path.join(directoryInspection.canonicalPath, entry.name);
        if (isIgnoredEntryName(entry.name) || isInternalPath(entryPath, input.paths, input.excludedRoots)) {
          skippedCount += 1;
          continue;
        }
        const inspection = await inspectApprovedPath(entryPath, source.canonicalRoot);
        if (!inspection.ok) {
          skippedCount += 1;
          continue;
        }
        if (inspection.stats.isDirectory()) {
          if (current.depth >= policy.maxDepth) {
            skippedCount += 1;
            continue;
          }
          stack.push({ directory: inspection.canonicalPath, depth: current.depth + 1 });
          continue;
        }
        if (!inspection.stats.isFile()) continue;
        if (!SUPPORTED_EXTENSIONS.has(extensionFor(inspection.canonicalPath))) continue;
        if (inspection.stats.size > policy.maxFileBytes) {
          skippedCount += 1;
          continue;
        }
        if (files.length >= policy.maxFiles || batchBytes + inspection.stats.size > policy.maxBatchBytes) {
          complete = false;
          break;
        }

        const stable = await readTrustedFileSnapshot({
          filePath: inspection.canonicalPath,
          canonicalRoot: source.canonicalRoot,
          signal: input.signal,
          stabilityDelayMs: input.stabilityDelayMs,
          deadline,
          maxBytes: policy.maxFileBytes,
          beforeOpenTrustedFile: input.beforeOpenTrustedFile,
        });
        if (!stable) {
          skippedCount += 1;
          continue;
        }
        if (batchBytes + stable.sizeBytes > policy.maxBatchBytes) {
          skippedCount += 1;
          complete = false;
          continue;
        }
        const relativePath = safeRelativePath(source.canonicalRoot, stable.canonicalPath);
        if (!relativePath) {
          skippedCount += 1;
          continue;
        }
        files.push({
          relativePath,
          canonicalPath: stable.canonicalPath,
          sizeBytes: stable.sizeBytes,
          mtimeMs: stable.mtimeMs,
          modifiedAt: new Date(stable.mtimeMs).toISOString(),
          contentBuffer: stable.contentBuffer,
          contentHash: stable.contentHash,
          fingerprint: createFingerprint(relativePath, stable.sizeBytes, stable.mtimeMs, stable.contentHash),
        });
        batchBytes += stable.sizeBytes;
      }
      if (!complete) break;
    }
  } catch (error) {
    if (error instanceof ScanBudgetExceededError) {
      complete = false;
    } else {
      throw error;
    }
  }

  return { files, skippedCount, complete };
}

async function readTrustedFileSnapshot({
  filePath,
  canonicalRoot,
  signal,
  stabilityDelayMs,
  deadline,
  maxBytes,
  beforeOpenTrustedFile,
}) {
  const first = await inspectApprovedPath(filePath, canonicalRoot);
  if (!first.ok || !first.stats.isFile()) return null;
  throwIfAborted(signal);
  await sleepWithSignal(stabilityDelayMs, signal);
  throwIfPastDeadline(deadline);
  const second = await inspectApprovedPath(filePath, canonicalRoot);
  if (!second.ok || !second.stats.isFile()) return null;
  if (
    first.canonicalPath !== second.canonicalPath ||
    first.stats.size !== second.stats.size ||
    first.stats.mtimeMs !== second.stats.mtimeMs ||
    !sameIdentity(identityFor(first.stats), identityFor(second.stats))
  ) {
    return null;
  }
  if (typeof beforeOpenTrustedFile === "function") {
    await beforeOpenTrustedFile(
      Object.freeze({
        canonicalPath: second.canonicalPath,
        expectedIdentity: Object.freeze(identityFor(second.stats)),
      }),
    );
  }
  throwIfAborted(signal);
  throwIfPastDeadline(deadline);

  const flags =
    process.platform === "win32" || !Number.isInteger(fsConstants.O_NOFOLLOW)
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(second.canonicalPath, flags);
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.size !== second.stats.size ||
      opened.mtimeMs !== second.stats.mtimeMs ||
      !sameIdentity(identityFor(opened), identityFor(second.stats))
    ) {
      return null;
    }
    if (opened.size > maxBytes) throw new ScanBudgetExceededError("file exceeds approved byte limit");
    // 읽는 64KB 조각마다 바로 해시에 넣는다. 예전에는 다 읽은 뒤 최대 20MB 를 한 번에
    // 해시해 그동안 앱 전체가 멈췄다. 조각 사이마다 파일 읽기를 기다리므로 화면이 끊기지 않는다.
    const contentHasher = createHash("sha256");
    const contentBuffer = await readBoundedFileHandle(handle, maxBytes, signal, deadline, contentHasher);
    const afterRead = await handle.stat();
    if (
      !afterRead.isFile() ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      !sameIdentity(identityFor(afterRead), identityFor(opened)) ||
      contentBuffer.length !== opened.size
    ) {
      return null;
    }
    return {
      canonicalPath: second.canonicalPath,
      sizeBytes: opened.size,
      mtimeMs: opened.mtimeMs,
      contentBuffer,
      contentHash: contentHasher.digest("hex"),
    };
  } catch (error) {
    if (error?.code === "ELOOP") return null;
    throw error;
  } finally {
    await handle?.close?.().catch(() => undefined);
  }
}

async function readBoundedFileHandle(handle, maxBytes, signal, deadline, hasher = null) {
  const chunks = [];
  let bytes = 0;
  let position = 0;
  while (true) {
    throwIfAborted(signal);
    throwIfPastDeadline(deadline);
    const remaining = maxBytes - bytes;
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, remaining + 1)));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
    if (!bytesRead) break;
    bytes += bytesRead;
    if (bytes > maxBytes) throw new ScanBudgetExceededError("file exceeds approved byte limit");
    const piece = chunk.subarray(0, bytesRead);
    hasher?.update(piece);
    chunks.push(piece);
    position += bytesRead;
  }
  return Buffer.concat(chunks, bytes);
}

/**
 * 버퍼의 sha256 을 1MB 씩 나눠 계산하고, 조각 사이마다 이벤트 루프에 한 번 양보한다.
 * 수십 MB 를 한 번에 해시하면 그동안 창 이동·입력이 멈춘다.
 */
export async function sha256InChunks(buffer, { chunkBytes = 1024 * 1024 } = {}) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? "");
  const hasher = createHash("sha256");
  const step = Math.max(64 * 1024, Math.floor(Number(chunkBytes) || 0));
  for (let offset = 0; offset < source.length; offset += step) {
    hasher.update(source.subarray(offset, Math.min(source.length, offset + step)));
    if (offset + step < source.length) await new Promise((resolve) => setImmediate(resolve));
  }
  return hasher.digest("hex");
}

async function inspectApprovedPath(candidatePath, canonicalRoot) {
  const resolved = path.resolve(candidatePath);
  if (!isPathWithin(canonicalRoot, resolved)) return { ok: false, reason: "outside_root" };
  try {
    const stats = await lstat(resolved);
    if (isReparsePoint(stats)) return { ok: false, reason: "reparse_point" };
    const canonicalPath = await realpath(resolved);
    if (!samePath(canonicalPath, resolved) || !isPathWithin(canonicalRoot, canonicalPath)) {
      return { ok: false, reason: "canonical_path_changed" };
    }
    return { ok: true, stats, canonicalPath };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

async function canonicalizeApprovedRoot(candidatePath) {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) {
    throw new Error("folder path is required");
  }
  const requested = path.resolve(candidatePath);
  const stats = await lstat(requested);
  if (!stats.isDirectory()) throw new Error("selected path is not a directory");
  if (isReparsePoint(stats)) throw new Error("symlink or junction roots require a new explicit selection");
  const canonicalRoot = await realpath(requested);
  if (!samePath(canonicalRoot, requested)) {
    throw new Error("reparse roots are not eligible for background learning");
  }
  const canonicalStats = await lstat(canonicalRoot);
  if (!canonicalStats.isDirectory() || isReparsePoint(canonicalStats)) {
    throw new Error("selected root is not a regular directory");
  }
  return { canonicalRoot, rootIdentity: identityFor(canonicalStats) };
}

async function readSupervisorState(paths) {
  try {
    const statePaths = await assertSupervisorStatePathsSafe(paths, { create: false });
    if (statePaths.missing) return { status: "ready", state: createEmptyState(), errorMessage: "" };
    const text = await readFile(paths.statePath, "utf8");
    const parsed = JSON.parse(text);
    return { status: "ready", state: validateState(parsed), errorMessage: "" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      try {
        const statePaths = await assertSupervisorStatePathsSafe(paths, { create: false });
        if (statePaths.missing) return { status: "ready", state: createEmptyState(), errorMessage: "" };
        await readFile(paths.previousStatePath, "utf8");
        return {
          status: "corrupt_fail_closed",
          state: createEmptyState(),
          errorMessage: "document learning supervisor primary state is missing while previous state exists",
        };
      } catch (previousError) {
        if (previousError?.code === "ENOENT") {
          return { status: "ready", state: createEmptyState(), errorMessage: "" };
        }
        return {
          status: "corrupt_fail_closed",
          state: createEmptyState(),
          errorMessage: safeErrorMessage(previousError) || "document learning supervisor recovery state is unreadable",
        };
      }
    }
    return {
      status: "corrupt_fail_closed",
      state: createEmptyState(),
      errorMessage: safeErrorMessage(error) || "document learning supervisor state is unreadable",
    };
  }
}

async function atomicWriteJsonWithPrevious(paths, value) {
  await assertSupervisorStatePathsSafe(paths, { create: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = path.join(paths.stateDirectory, `.${STATE_FILE_NAME}.${randomUUID()}.tmp`);
  const backupTempPath = path.join(paths.stateDirectory, `.${PREVIOUS_STATE_FILE_NAME}.${randomUUID()}.tmp`);
  try {
    await writeTextWithSync(tempPath, content);
    await assertSupervisorStatePathsSafe(paths, { create: true });
    try {
      const previousContent = await readFile(paths.statePath, "utf8");
      await writeTextWithSync(backupTempPath, previousContent);
      await assertSupervisorStatePathsSafe(paths, { create: true });
      await replaceFileAtomically(backupTempPath, paths.previousStatePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await assertSupervisorStatePathsSafe(paths, { create: true });
    await replaceFileAtomically(tempPath, paths.statePath);
  } finally {
    await Promise.allSettled([
      unlink(tempPath),
      unlink(backupTempPath),
    ]);
  }
}

async function assertSupervisorStatePathsSafe(paths, { create = false } = {}) {
  const userDataPath = path.resolve(paths.userDataPath);
  const stateDirectory = path.resolve(paths.stateDirectory);
  if (!isPathWithin(userDataPath, stateDirectory)) {
    throw new Error("document learning supervisor state must stay below userData");
  }
  if (create) await mkdir(userDataPath, { recursive: true });
  let userStats;
  try {
    userStats = await lstat(userDataPath);
  } catch (error) {
    if (!create && error?.code === "ENOENT") return { missing: true };
    throw error;
  }
  if (!userStats.isDirectory() || isReparsePoint(userStats)) {
    throw new Error("document learning supervisor userData must be a regular directory");
  }
  const canonicalUserData = await realpath(userDataPath);
  const relative = path.relative(userDataPath, stateDirectory);
  if (!isSafeStateRelativePath(relative)) {
    throw new Error("document learning supervisor state must stay below userData");
  }
  let current = userDataPath;
  for (const segment of relative ? relative.split(/[\\/]+/u).filter(Boolean) : []) {
    current = path.join(current, segment);
    if (create) await mkdir(current, { recursive: false }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    let currentStats;
    try {
      currentStats = await lstat(current);
    } catch (error) {
      if (!create && error?.code === "ENOENT") return { missing: true };
      throw error;
    }
    if (!currentStats.isDirectory() || isReparsePoint(currentStats)) {
      throw new Error("document learning supervisor state directory cannot be a symlink or junction");
    }
  }
  const stateStats = await lstat(stateDirectory);
  if (!stateStats.isDirectory() || isReparsePoint(stateStats)) {
    throw new Error("document learning supervisor state directory cannot be a symlink or junction");
  }
  const canonicalStateDirectory = await realpath(stateDirectory);
  if (!isPathWithin(canonicalUserData, canonicalStateDirectory)) {
    throw new Error("document learning supervisor state escaped userData");
  }
  for (const stateFile of [paths.statePath, paths.previousStatePath]) {
    if (path.dirname(path.resolve(stateFile)) !== stateDirectory) {
      throw new Error("invalid document learning supervisor state target");
    }
    try {
      const stats = await lstat(stateFile);
      if (isReparsePoint(stats)) {
        throw new Error("document learning supervisor state target cannot be a symlink or junction");
      }
      const canonicalFile = await realpath(stateFile);
      if (!isPathWithin(canonicalStateDirectory, canonicalFile)) {
        throw new Error("document learning supervisor state target escaped state directory");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return { missing: false, canonicalUserData, canonicalStateDirectory };
}

function isSafeStateRelativePath(value) {
  return value === "" || (typeof value === "string" && !path.isAbsolute(value) && value !== ".." && !value.startsWith(`..${path.sep}`));
}

async function writeTextWithSync(filePath, content) {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    if (typeof handle.sync === "function") await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceFileAtomically(tempPath, targetPath) {
  try {
    await rename(tempPath, targetPath);
    return;
  } catch (error) {
    if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
  }

  const displacedPath = `${targetPath}.${randomUUID()}.replace-old`;
  let displaced = false;
  let replaced = false;
  try {
    await rename(targetPath, displacedPath);
    displaced = true;
    await rename(tempPath, targetPath);
    replaced = true;
  } catch (error) {
    if (displaced && !replaced) {
      await rename(displacedPath, targetPath).catch(() => undefined);
    }
    throw error;
  } finally {
    // Keep the displaced primary as a recoverable local artifact. Deleting it
    // would create an avoidable external-path risk if the directory changes.
  }
}

export function sanitizeDocumentLearningSupervisorTeammateProposal(value) {
  if (!isPlainObject(value)) return null;
  const sourceId =
    typeof value.sourceId === "string" && /^docsrc_[a-f0-9]{24}$/u.test(value.sourceId)
      ? value.sourceId
      : "";
  const draftId = safeOpaqueId(value.draftId, 240);
  const proposalId = sanitizeTeammateProposalId(value.proposalId);
  const proposedAt = safeIso(value.proposedAt);
  const draft = sanitizeTeammateProfileDraft(value.draft);
  if (
    !sourceId ||
    !draftId ||
    !proposalId ||
    !proposedAt ||
    !draft ||
    draft.id !== draftId
  ) {
    return null;
  }
  return {
    sourceId,
    draftId,
    proposalId,
    proposedAt,
    draft,
  };
}

function createPendingTeammateProposal(value) {
  if (
    !isPlainObject(value) ||
    !/^[a-f0-9]{64}$/u.test(String(value.snapshotDigest ?? ""))
  ) {
    return null;
  }
  const draft = sanitizeTeammateProfileDraft(value.draft);
  if (!draft) return null;
  const snapshotDigest = String(value.snapshotDigest);
  const proposal = sanitizeDocumentLearningSupervisorTeammateProposal({
    sourceId: value.sourceId,
    draftId: draft.id,
    proposalId: createTeammateProposalId(
      value.sourceId,
      draft.id,
      snapshotDigest,
    ),
    proposedAt: value.proposedAt,
    draft,
  });
  const roleKey = createTeammateRoleKey(draft);
  return proposal && roleKey
    ? {
        ...proposal,
        roleKey,
        snapshotDigest,
      }
    : null;
}

function sanitizePersistedTeammateProposal(value, sourceId) {
  if (
    !isPlainObject(value) ||
    !/^[a-f0-9]{64}$/u.test(String(value.snapshotDigest ?? ""))
  ) {
    return null;
  }
  const snapshotDigest = String(value.snapshotDigest);
  const draftId = safeOpaqueId(value?.draft?.id ?? value.draftId, 240);
  const proposal = sanitizeDocumentLearningSupervisorTeammateProposal({
    ...value,
    sourceId,
    draftId,
    proposalId:
      sanitizeTeammateProposalId(value.proposalId) ||
      createTeammateProposalId(sourceId, draftId, snapshotDigest),
  });
  const roleKey =
    sanitizeTeammateRoleKey(value.roleKey) ||
    createTeammateRoleKey(proposal?.draft);
  return proposal && roleKey
    ? {
        ...proposal,
        roleKey,
        snapshotDigest,
      }
    : null;
}

function sanitizeAcknowledgedTeammateDraftIds(value) {
  const ids = (Array.isArray(value) ? value : [])
    .map((entry) => safeOpaqueId(entry, 240))
    .filter(Boolean);
  return [...new Set(ids)].slice(-MAX_ACKNOWLEDGED_TEAMMATE_DRAFT_IDS);
}

function sanitizeAcknowledgedTeammateRoleKeys(value) {
  const roleKeys = (Array.isArray(value) ? value : [])
    .map(sanitizeTeammateRoleKey)
    .filter(Boolean);
  return [...new Set(roleKeys)].slice(-MAX_ACKNOWLEDGED_TEAMMATE_DRAFT_IDS);
}function sanitizeTeammateProfileDraft(value) {
  if (!isPlainObject(value)) return null;
  const id = safeOpaqueId(value.id, 240);
  const createdAt = safeIso(value.createdAt);
  const suggestedTemplateId = [
    "operations",
    "mail",
    "finance",
    "legal",
    "desktop",
    "custom",
  ].includes(value.suggestedTemplateId)
    ? value.suggestedTemplateId
    : "";
  const name = safeProposalText(value.name, 32);
  const roleTitle = safeProposalText(value.roleTitle, 48);
  if (!id || !createdAt || !suggestedTemplateId || !name || !roleTitle) return null;
  const draft = {
    id,
    createdAt,
    suggestedTemplateId,
    name,
    teamLabel: safeProposalText(value.teamLabel, 28) || "???",
    roleTitle,
    channelName: safeProposalText(value.channelName, 42) || roleTitle,
    brief: safeProposalText(value.brief, 180) || roleTitle,
    instructions: sanitizeProposalTextArray(value.instructions, 8, 160),
    automationRecommendations: (
      Array.isArray(value.automationRecommendations) ? value.automationRecommendations : []
    )
      .slice(0, 12)
      .map(sanitizeAutomationRecommendation)
      .filter(Boolean),
    evidence: sanitizeTeammateDraftEvidence(value.evidence),
  };
  const blueprint = sanitizeTeammateAgentBlueprint(value.agentBlueprint);
  if (blueprint) draft.agentBlueprint = blueprint;
  return draft;
}

function sanitizeAutomationRecommendation(value) {
  if (!isPlainObject(value)) return null;
  const id = safeOpaqueId(value.id, 160);
  const title = safeProposalText(value.title, 120);
  if (!id || !title) return null;
  const outputPlan = isPlainObject(value.outputPlan) ? value.outputPlan : {};
  const confidence = Number(value.confidence);
  return {
    id,
    workPackId: safeOpaqueId(value.workPackId, 160),
    title,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
    reason: safeProposalText(value.reason, 240),
    sourceLabels: sanitizeEvidenceLabels(value.sourceLabels, 8, 80),
    suggestedRuleLabel: safeProposalText(value.suggestedRuleLabel, 120),
    outputPlan: {
      kind: safeOpaqueId(outputPlan.kind, 80),
      label: safeProposalText(outputPlan.label, 120),
      draftTarget: safeProposalText(outputPlan.draftTarget, 120),
      handoffLabel: safeProposalText(outputPlan.handoffLabel, 120),
      approvalGateLabel: safeProposalText(outputPlan.approvalGateLabel, 120),
      nextUserAction: safeProposalText(outputPlan.nextUserAction, 160),
    },
  };
}

function sanitizeTeammateDraftEvidence(value) {
  const evidence = isPlainObject(value) ? value : {};
  return {
    styleProfileName: safeProposalText(evidence.styleProfileName, 80),
    topCategories: (
      Array.isArray(evidence.topCategories) ? evidence.topCategories : []
    )
      .slice(0, 8)
      .filter(isPlainObject)
      .map((entry) => ({
        category: safeOpaqueId(entry.category, 80),
        label: safeProposalText(entry.label, 80),
        weight: Number.isFinite(Number(entry.weight))
          ? Math.max(0, Math.min(1, Number(entry.weight)))
          : 0,
      })),
    sourceFileLabels: sanitizeEvidenceLabels(evidence.sourceFileLabels, 8, 80),
  };
}

function sanitizeTeammateAgentBlueprint(value) {
  if (!isPlainObject(value)) return null;
  const connectionRequirements = (
    Array.isArray(value.connectionRequirements) ? value.connectionRequirements : []
  )
    .slice(0, 8)
    .filter(isPlainObject)
    .map((entry) => ({
      connectorId: safeOpaqueId(entry.connectorId, 80),
      label: safeProposalText(entry.label, 120),
      requiredFor: entry.requiredFor === "dry_run" ? "dry_run" : "live_operation",
      appHandledSteps: sanitizeProposalTextArray(entry.appHandledSteps, 8, 120),
      userOnlySteps: (Array.isArray(entry.userOnlySteps) ? entry.userOnlySteps : [])
        .slice(0, 8)
        .filter(isPlainObject)
        .map((step) => ({
          kind: safeOpaqueId(step.kind, 80),
          when: "only_if_runtime_requires",
          label: safeProposalText(step.label, 120),
          reason: safeProposalText(step.reason, 180),
        })),
      secretEntryAllowedInChat: false,
    }))
    .filter((entry) => entry.connectorId);
  const setupSummary = isPlainObject(value.setupSummary) ? value.setupSummary : {};
  const executionPolicy = isPlainObject(value.executionPolicy) ? value.executionPolicy : {};
  const dryRun = isPlainObject(executionPolicy.dryRun) ? executionPolicy.dryRun : {};
  return {
    schemaVersion: finiteNumber(value.schemaVersion, 1, 1, 10),
    connectionRequirements,
    setupSummary: {
      appHandledLabels: sanitizeProposalTextArray(
        setupSummary.appHandledLabels,
        8,
        120,
      ),
      userOnlyLabels: sanitizeProposalTextArray(
        setupSummary.userOnlyLabels,
        8,
        120,
      ),
      nextUserAction: safeProposalText(setupSummary.nextUserAction, 160),
    },
    executionPolicy: {
      dryRun: {
        requiredSuccessfulRuns: finiteNumber(
          dryRun.requiredSuccessfulRuns,
          0,
          0,
          100,
        ),
        externalMutation: false,
      },
      activation: {
        startsEnabled: false,
        requiresUserApproval: true,
      },
    },
    safety: {
      selectedSourceScopeOnly: true,
      rawSecretMaterialVisibleToAgent: false,
      externalMutation: false,
    },
  };
}

function sanitizeProposalTextArray(value, limit, maxLength) {
  return (Array.isArray(value) ? value : [])
    .slice(0, limit)
    .map((entry) => safeProposalText(entry, maxLength))
    .filter(Boolean);
}

function sanitizeEvidenceLabels(value, limit, maxLength) {
  return (Array.isArray(value) ? value : [])
    .slice(0, limit)
    .map((entry) => {
      const segments = String(entry ?? "").split(/[\\/]+/u);
      return safeProposalText(segments.at(-1), maxLength);
    })
    .filter(Boolean);
}

function safeProposalText(value, maxLength) {
  return safeText(value, maxLength)
    .replace(
      /(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+/giu,
      "$1=[???]",
    )
    .replace(
      /\b(?:postgres|mysql|mongodb(?:\+srv)?):\/\/\S+/giu,
      "[??? ??]",
    )
    .replace(/[A-Za-z]:\\[^\s]+/gu, "[?? ??]")
    .replace(/(?:\/[^/\s]+){2,}/gu, "[?? ??]");
}

function safeOpaqueId(value, maxLength) {
  const text = safeText(value, maxLength);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text) ? text : "";
}

function sanitizeTeammateProposalId(value) {
  const proposalId = safeOpaqueId(value, 44);
  return /^docproposal_[a-f0-9]{32}$/u.test(proposalId) ? proposalId : "";
}

function sanitizeTeammateRoleKey(value) {
  const roleKey = safeOpaqueId(value, 46);
  return /^teammate_role_[a-f0-9]{32}$/u.test(roleKey) ? roleKey : "";
}

function createTeammateRoleKey(draft) {
  if (!isPlainObject(draft)) return "";
  const categoryIds = (Array.isArray(draft.evidence?.topCategories)
    ? draft.evidence.topCategories
    : [])
    .map((entry) => safeOpaqueId(entry?.category, 80))
    .filter(Boolean)
    .sort()
    .slice(0, 6);
  const workPackIds = (Array.isArray(draft.automationRecommendations)
    ? draft.automationRecommendations
    : [])
    .map((entry) => safeOpaqueId(entry?.workPackId, 160))
    .filter(Boolean)
    .sort()
    .slice(0, 8);
  const signature = {
    templateId: safeOpaqueId(draft.suggestedTemplateId, 40),
    categoryIds,
    workPackIds,
    fallbackRole:
      categoryIds.length || workPackIds.length
        ? ""
        : safeProposalText(draft.roleTitle, 80).toLocaleLowerCase("ko-KR"),
  };
  if (!signature.templateId) return "";
  return (
    "teammate_role_" +
    createHash("sha256")
      .update(JSON.stringify(signature))
      .digest("hex")
      .slice(0, 32)
  );
}

function createTeammateProposalId(sourceId, draftId, snapshotDigest) {
  if (
    typeof sourceId !== "string" ||
    !/^docsrc_[a-f0-9]{24}$/u.test(sourceId) ||
    !safeOpaqueId(draftId, 240) ||
    !/^[a-f0-9]{64}$/u.test(String(snapshotDigest ?? ""))
  ) {
    return "";
  }
  return (
    "docproposal_" +
    createHash("sha256")
      .update([sourceId, draftId, snapshotDigest].join("\0"))
      .digest("hex")
      .slice(0, 32)
  );
}
function validateState(value) {
  if (!isPlainObject(value) || value.version !== STATE_VERSION || !Array.isArray(value.sources)) {
    throw new Error("unsupported document learning supervisor state");
  }
  if (value.sources.length > MAX_SOURCES) throw new Error("too many document learning sources");
  const sourceIds = new Set();
  const sources = value.sources.map((source) => sanitizePersistedSource(source, sourceIds));
  return {
    version: STATE_VERSION,
    updatedAt: safeIso(value.updatedAt) || "",
    sources,
  };
}

function sanitizePersistedSource(value, sourceIds) {
  if (!isPlainObject(value)) throw new Error("invalid document learning source state");
  const canonicalRoot = requireAbsolutePath(value.canonicalRoot, "invalid source root");
  const sourceId = requireSourceId(value.sourceId, canonicalRoot);
  if (sourceIds.has(sourceId)) throw new Error("duplicate document learning source state");
  sourceIds.add(sourceId);
  const status = ["active", "paused", "needs_reapproval"].includes(value.status) ? value.status : null;
  if (!status) throw new Error("invalid document learning source status");
  return {
    sourceId,
    canonicalRoot,
    rootIdentity: sanitizeIdentity(value.rootIdentity),
    label: safeLabel(value.label, canonicalRoot),
    status,
    approvedAt: safeIso(value.approvedAt) || "",
    createdAt: safeIso(value.createdAt) || "",
    updatedAt: safeIso(value.updatedAt) || "",
    lastLearnedAt: safeIso(value.lastLearnedAt) || "",
    policy: normalizePolicy(value.policy),
    files: sanitizeFileState(value.files),
    staleFiles: sanitizeStaleState(value.staleFiles),
    lastResult: sanitizeResult(value.lastResult),
    pendingTeammateProposal: sanitizePersistedTeammateProposal(
      value.pendingTeammateProposal,
      sourceId,
    ),
    acknowledgedTeammateDraftIds: sanitizeAcknowledgedTeammateDraftIds(
      value.acknowledgedTeammateDraftIds,
    ),
    acknowledgedTeammateRoleKeys: sanitizeAcknowledgedTeammateRoleKeys(
      value.acknowledgedTeammateRoleKeys,
    ),
    lastError: safeReason(value.lastError),
    watcherError: safeReason(value.watcherError),
  };
}

function sanitizeFileState(value) {
  const clean = createDictionary();
  if (!isPlainObject(value)) return clean;
  for (const [relativePath, record] of Object.entries(value).slice(0, MAX_STATE_FILES_PER_SOURCE)) {
    if (!isSafeRelativePath(relativePath) || !isPlainObject(record)) continue;
    if (typeof record.fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(record.fingerprint)) continue;
    clean[relativePath] = {
      fingerprint: record.fingerprint,
      contentHash: typeof record.contentHash === "string" && /^[a-f0-9]{64}$/u.test(record.contentHash) ? record.contentHash : "",
      sizeBytes: finiteNumber(record.sizeBytes, 0, 0, Number.MAX_SAFE_INTEGER),
      mtimeMs: finiteNumber(record.mtimeMs, 0, 0, Number.MAX_SAFE_INTEGER),
      learnedAt: safeIso(record.learnedAt) || "",
    };
  }
  return clean;
}

function sanitizeStaleState(value) {
  const clean = createDictionary();
  if (!isPlainObject(value)) return clean;
  for (const [relativePath, record] of Object.entries(value).slice(0, 100)) {
    if (!isSafeRelativePath(relativePath) || !isPlainObject(record)) continue;
    clean[relativePath] = {
      fingerprint: typeof record.fingerprint === "string" && /^[a-f0-9]{64}$/u.test(record.fingerprint) ? record.fingerprint : "",
      missingAt: safeIso(record.missingAt) || "",
    };
  }
  return clean;
}

function sanitizeResult(value) {
  if (!isPlainObject(value)) return null;
  return createResultSummary(safeReason(value.status) || "unknown", {
    learnedCount: finiteNumber(value.learnedCount, 0, 0, MAX_STATE_FILES_PER_SOURCE),
    candidateFiles: finiteNumber(value.candidateFiles, 0, 0, MAX_STATE_FILES_PER_SOURCE),
    staleCount: finiteNumber(value.staleCount, 0, 0, MAX_STATE_FILES_PER_SOURCE),
    skippedCount: finiteNumber(value.skippedCount, 0, 0, Number.MAX_SAFE_INTEGER),
    durationMs: finiteNumber(value.durationMs, 0, 0, 120_000),
    complete: Boolean(value.complete),
    callbackStatus: safeReason(value.callbackStatus),
    reason: safeReason(value.reason),
    error: safeReason(value.error),
  });
}

function createEmptyState() {
  return { version: STATE_VERSION, updatedAt: "", sources: [] };
}

function normalizeFolderInputs(folders) {
  const entries = Array.isArray(folders) ? folders : [folders];
  return entries
    .map((entry) => (typeof entry === "string" ? { path: entry } : entry))
    .filter((entry) => isPlainObject(entry) && typeof entry.path === "string" && entry.path.trim());
}

function normalizeRuntimeOptions(options) {
  return {
    debounceMs: finiteNumber(options.debounceMs, DEFAULT_RUNTIME.debounceMs, 20, 30_000),
    maxDebounceMs: finiteNumber(options.maxDebounceMs, DEFAULT_RUNTIME.maxDebounceMs, 20, 60_000),
    reconcileIntervalMs: finiteNumber(options.reconcileIntervalMs, DEFAULT_RUNTIME.reconcileIntervalMs, 0, 60 * 60 * 1_000),
    stabilityDelayMs: finiteNumber(options.stabilityDelayMs, DEFAULT_RUNTIME.stabilityDelayMs, 10, 5_000),
    globalConcurrency: finiteNumber(options.globalConcurrency, DEFAULT_RUNTIME.globalConcurrency, 1, 4),
    stopGraceMs: finiteNumber(options.stopGraceMs, DEFAULT_RUNTIME.stopGraceMs, 100, 10_000),
  };
}

function normalizePolicy(value = {}) {
  const input = isPlainObject(value) ? value : {};
  return {
    maxFiles: finiteNumber(input.maxFiles, DEFAULT_POLICY.maxFiles, 1, MAX_STATE_FILES_PER_SOURCE),
    maxDepth: finiteNumber(input.maxDepth, DEFAULT_POLICY.maxDepth, 0, 12),
    maxFileBytes: finiteNumber(input.maxFileBytes, DEFAULT_POLICY.maxFileBytes, 1_024, 100 * 1024 * 1024),
    maxBatchBytes: finiteNumber(input.maxBatchBytes, DEFAULT_POLICY.maxBatchBytes, 1_024, 500 * 1024 * 1024),
    timeLimitMs: finiteNumber(input.timeLimitMs, DEFAULT_POLICY.timeLimitMs, 1_000, 120_000),
  };
}

function buildExcludedRoots(paths, options) {
  const roots = [paths.stateDirectory];
  for (const candidate of [...asArray(options.excludePaths), ...asArray(options.localIndexRoots)]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    roots.push(path.resolve(candidate));
  }
  return roots.map((entry) => path.resolve(entry));
}

function isInternalPath(candidatePath, paths, excludedRoots) {
  const resolved = path.resolve(candidatePath);
  if (isPathWithin(paths.stateDirectory, resolved)) return true;
  return excludedRoots.some((root) => isPathWithin(root, resolved));
}

function isIgnoredEntryName(name) {
  const lower = String(name).toLocaleLowerCase("en-US");
  if (IGNORED_DIRECTORY_NAMES.has(lower)) return true;
  return (
    lower.startsWith("~$") ||
    lower.endsWith(".tmp") ||
    lower.endsWith(".previous") ||
    lower.endsWith(".part") ||
    lower.endsWith(".swp") ||
    lower.endsWith(".bak")
  );
}

function freezeSafeFileRecord(file, source, index) {
  return Object.freeze({
    id: `document_watch_${source.sourceId}_${index + 1}_${createHash("sha256").update(file.relativePath).digest("hex").slice(0, 12)}`,
    name: path.basename(file.canonicalPath),
    fileName: path.basename(file.canonicalPath),
    sizeBytes: file.sizeBytes,
    modifiedAt: file.modifiedAt,
    selected: true,
    relativePath: file.relativePath,
    contentSha256: file.contentHash,
    // The handler must parse this in-memory snapshot and must not reopen the source path.
    trustedContentBuffer: Buffer.from(file.contentBuffer),
    sourceMetadata: Object.freeze({
      relativePath: file.relativePath,
      sourceFolderLabel: source.label,
      sourceKind: "approved_folder_watch",
      provenanceAbsolutePath: file.canonicalPath,
    }),
  });
}

function createFingerprint(relativePath, sizeBytes, mtimeMs, contentHash) {
  return createHash("sha256")
    .update(relativePath)
    .update("\0")
    .update(String(sizeBytes))
    .update("\0")
    .update(String(mtimeMs))
    .update("\0")
    .update(contentHash)
    .digest("hex");
}

function sourceIdFor(canonicalRoot) {
  return `docsrc_${createHash("sha256").update(comparablePath(canonicalRoot)).digest("hex").slice(0, 24)}`;
}

function identityFor(stats) {
  return {
    dev: String(stats.dev ?? ""),
    ino: String(stats.ino ?? ""),
    mode: Number(stats.mode ?? 0),
  };
}

function sanitizeIdentity(value) {
  if (!isPlainObject(value)) throw new Error("invalid source identity");
  const dev = typeof value.dev === "string" ? value.dev : String(value.dev ?? "");
  const ino = typeof value.ino === "string" ? value.ino : String(value.ino ?? "");
  const mode = finiteNumber(value.mode, -1, 0, Number.MAX_SAFE_INTEGER);
  if (!dev || !ino || mode < 0) throw new Error("invalid source identity");
  return { dev, ino, mode };
}

function sameIdentity(left, right) {
  return Boolean(left && right) && String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino) && Number(left.mode) === Number(right.mode);
}

function isReparsePoint(stats) {
  return Boolean(
    stats &&
      ((typeof stats.isSymbolicLink === "function" && stats.isSymbolicLink()) ||
        (typeof stats.isReparsePoint === "function" && stats.isReparsePoint())),
  );
}

function isPathWithin(root, candidate) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function comparablePath(value) {
  let resolved = path.normalize(path.resolve(value)).replace(/[\\/]+$/u, "");
  if (process.platform === "win32") {
    resolved = resolved.replace(/^\\\\\?\\/u, "").toLocaleLowerCase("en-US");
  }
  return resolved;
}

function safeRelativePath(root, filePath) {
  const relative = path.relative(root, filePath);
  return isSafeRelativePath(relative) ? relative : "";
}

function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && value !== ".." && !value.startsWith(`..${path.sep}`);
}

function extensionFor(filePath) {
  return path.extname(filePath).replace(/^\./u, "").toLocaleLowerCase("en-US");
}

function requireAbsolutePath(value, errorMessage) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) throw new Error(errorMessage);
  return path.resolve(value);
}

function requireSourceId(value, canonicalRoot) {
  if (typeof value !== "string" || value !== sourceIdFor(canonicalRoot)) {
    throw new Error("invalid source id");
  }
  return value;
}

function createAsyncLimiter(limit) {
  let active = 0;
  const waiting = [];
  const runNext = () => {
    while (active < limit && waiting.length > 0) {
      const next = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  };
  return {
    run(task) {
      return new Promise((resolve, reject) => {
        waiting.push({ task, resolve, reject });
        runNext();
      });
    },
  };
}

function buildNextSourceSnapshot(knownFiles, staleFiles, scanFiles, now) {
  const nextFiles = createDictionary();
  const nextStaleFiles = createDictionary();
  for (const [relativePath, entry] of Object.entries(staleFiles ?? {})) {
    nextStaleFiles[relativePath] = { ...entry };
  }
  const observed = new Set();
  const changed = [];
  for (const file of scanFiles) {
    observed.add(file.relativePath);
    const prior = knownFiles?.[file.relativePath];
    const didChange = prior?.fingerprint !== file.fingerprint;
    if (didChange) changed.push(file);
    nextFiles[file.relativePath] = {
      fingerprint: file.fingerprint,
      contentHash: file.contentHash,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
      learnedAt: didChange ? nowIso(now) : prior?.learnedAt ?? "",
    };
    delete nextStaleFiles[file.relativePath];
  }
  let staleCount = 0;
  for (const [relativePath, prior] of Object.entries(knownFiles ?? {})) {
    if (observed.has(relativePath)) continue;
    nextStaleFiles[relativePath] = {
      fingerprint: prior?.fingerprint ?? "",
      missingAt: nowIso(now),
    };
    staleCount += 1;
  }
  return {
    files: pruneDictionary(nextFiles, MAX_STATE_FILES_PER_SOURCE),
    staleFiles: pruneDictionary(nextStaleFiles, 100),
    changed,
    staleCount,
  };
}

function createSnapshotDigest(files) {
  const digest = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en-US"))) {
    digest.update(file.relativePath).update("\0").update(file.contentHash).update("\0");
  }
  return digest.digest("hex");
}

function assertAcceptedSnapshotReceipt(value, expectedDigest, expectedContentSha256s) {
  if (!isPlainObject(value)) throw new Error("document learning callback did not return a receipt");
  if (!["document_learning_indexed", "document_learning_indexed_with_warnings"].includes(value.status)) {
    throw new Error("document learning callback did not report an accepted index status");
  }
  if (
    value.continuousLearningCommitted !== true ||
    value.snapshotApplied !== true ||
    value.snapshotDigest !== expectedDigest
  ) {
    throw new Error("document learning callback snapshot receipt did not match");
  }
  if (!Array.isArray(value.failures) || value.failures.length !== 0) {
    throw new Error("document learning callback reported failed files");
  }
  const accepted = Array.isArray(value.acceptedContentSha256s)
    ? value.acceptedContentSha256s.map(String).sort()
    : [];
  if (accepted.length !== expectedContentSha256s.length || accepted.some((entry, index) => entry !== expectedContentSha256s[index])) {
    throw new Error("document learning callback accepted file hashes did not match");
  }
}

function waitForStopGrace(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
function createDictionary() {
  return Object.create(null);
}

function pruneDictionary(value, limit) {
  const entries = Object.entries(value ?? {});
  if (entries.length <= limit) return value;
  const keep = createDictionary();
  for (const [key, entry] of entries.slice(-limit)) keep[key] = entry;
  return keep;
}

function createResultSummary(status, details = {}) {
  return {
    status: safeReason(status) || "unknown",
    learnedCount: finiteNumber(details.learnedCount, 0, 0, MAX_STATE_FILES_PER_SOURCE),
    candidateFiles: finiteNumber(details.candidateFiles, 0, 0, MAX_STATE_FILES_PER_SOURCE),
    staleCount: finiteNumber(details.staleCount, 0, 0, MAX_STATE_FILES_PER_SOURCE),
    skippedCount: finiteNumber(details.skippedCount, 0, 0, Number.MAX_SAFE_INTEGER),
    durationMs: finiteNumber(details.durationMs, 0, 0, 120_000),
    complete: Boolean(details.complete),
    callbackStatus: safeReason(details.callbackStatus),
    reason: safeReason(details.reason),
    error: safeReason(details.error),
  };
}

function summarizeCallbackResult(value) {
  if (isPlainObject(value) && typeof value.status === "string") return safeReason(value.status);
  return value === undefined ? "completed" : "completed_without_status";
}

function result(status, details = {}) {
  return Object.freeze({ status, ...details, externalMutation: false, originalFilesMoved: false, originalFilesDeleted: false });
}

function finiteNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function safeLabel(value, fallback) {
  const clean = safeText(value, 160);
  return clean || path.basename(fallback) || fallback;
}

function safeReason(value) {
  return safeText(value, 240);
}

function safeErrorMessage(error) {
  return safeText(error instanceof Error ? error.message : String(error ?? ""), 240);
}

function safeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function safeIso(value) {
  if (typeof value !== "string" || !value) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function nowIso(now) {
  const value = now();
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : new Date().toISOString();
}

function isApprovedDecision(decision) {
  return Boolean(
    isPlainObject(decision) &&
      decision.approved === true &&
      decision.approvalPurpose === "continuous_watch",
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new SupervisorAbortError();
}

function throwIfPastDeadline(deadline) {
  if (Date.now() > deadline) throw new ScanBudgetExceededError();
}

function sleepWithSignal(delayMs, signal) {
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(new SupervisorAbortError());
    };
    function done() {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}
