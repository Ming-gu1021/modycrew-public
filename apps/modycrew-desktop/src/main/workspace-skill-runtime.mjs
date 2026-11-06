import { createHash, randomUUID } from "node:crypto";
import { lookup as nodeLookup } from "node:dns/promises";
import https from "node:https";
import fs from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

export const workspaceSkillRuntimeSchema =
  "modycrew.workspace-skill-runtime.v1";

const runtimeStateFileName = "workspace-skill-runtime.json";
const runtimePreviousStateFileName = runtimeStateFileName + ".previous";
const runtimeLockFileName = ".workspace-skill-runtime.lock";
const runtimeReclaimLockFileName = runtimeLockFileName + ".reclaim";
const runtimeLockSchema = "modycrew.workspace-skill-runtime-lock.v1";
const runtimeReclaimLockSchema = "modycrew.workspace-skill-runtime-reclaim.v1";
const packagesDirectoryName = "packages";
const portableInstallMode = "portable_user_space";
const maximumPackageBytesHardLimit = 5 * 1024 * 1024;
const defaultMaximumPackageBytes = maximumPackageBytesHardLimit;
const defaultDownloadTimeoutMilliseconds = 15_000;
const defaultLockWaitMilliseconds = 5_000;
const defaultRuntimeLockStaleMilliseconds = 10 * 60_000;
const defaultRuntimeLockHeartbeatMilliseconds = 5_000;
const lockRetryMilliseconds = 40;
const maximumInstructions = 20;
const maximumInstructionCharacters = 20_000;
const maximumStateInstallations = 200;
const maximumPackageInventoryEntries = 240;
const runtimeQueues = new Map();

const allowedWorkPackIds = new Set([
  "inquiry_response",
  "schedule_coordination",
  "report_cleanup",
  "inventory_reorder",
  "tax_contract_archive",
]);

const allowedJsonContentTypes = new Set([
  "application/json",
  "application/manifest+json",
  "application/vnd.modycrew.workspace-skill+json",
]);

export function resolveWorkspaceSkillRuntimePaths(options = {}) {
  const userDataCandidate =
    cleanPathCandidate(options.userDataPath) ||
    cleanPathCandidate(options.storageRoot) ||
    resolveElectronUserDataPath(options.app);
  if (!userDataCandidate) {
    throw runtimeError("workspace_skill_user_data_path_required");
  }
  const userDataPath = path.resolve(userDataCandidate);
  const root = resolveChildPath(userDataPath, "workspace-skills");
  return {
    userDataPath,
    root,
    packagesRoot: resolveChildPath(root, packagesDirectoryName),
    statePath: resolveChildPath(root, runtimeStateFileName),
    previousStatePath: resolveChildPath(root, runtimePreviousStateFileName),
    lockPath: resolveChildPath(root, runtimeLockFileName),
    reclaimLockPath: resolveChildPath(root, runtimeReclaimLockFileName),
    catalogPath: resolveChildPath(root, workspaceSkillCatalogFileName),
  };
}

export function createWorkspaceSkillRuntime(options = {}) {
  const paths = resolveWorkspaceSkillRuntimePaths(options);
  const runtimeOptions = {
    io: options.io ?? fs,
    configuredWorkspaceId: optionalWorkspaceId(options.workspaceId),
    fetchImplementation: resolveFetchImplementation(options),
    lookup: typeof options.lookup === "function" ? options.lookup : nodeLookup,
    trustedCatalogHosts: normalizeTrustedCatalogHosts(options.trustedCatalogHosts),
    trustedCatalogManifest: options.trustedCatalogManifest,
    verifyCatalogSignature:
      typeof options.verifyCatalogSignature === "function"
        ? options.verifyCatalogSignature
        : undefined,
    packagedCatalogPath: cleanPathCandidate(options.packagedCatalogPath),
    resourcesPath: cleanPathCandidate(options.resourcesPath),
    maximumPackageBytes: clampPositiveInteger(
      options.maximumPackageBytes,
      defaultMaximumPackageBytes,
      maximumPackageBytesHardLimit,
    ),
    downloadTimeoutMilliseconds: clampPositiveInteger(
      options.downloadTimeoutMilliseconds ?? options.downloadTimeoutMs,
      defaultDownloadTimeoutMilliseconds,
      120_000,
    ),
    lockWaitMilliseconds: clampPositiveInteger(
      options.lockWaitMilliseconds,
      defaultLockWaitMilliseconds,
      30_000,
    ),
    lockStaleMilliseconds: clampPositiveInteger(
      options.lockStaleMilliseconds,
      defaultRuntimeLockStaleMilliseconds,
      24 * 60 * 60_000,
    ),
    lockHeartbeatMilliseconds: clampPositiveInteger(
      options.lockHeartbeatMilliseconds,
      defaultRuntimeLockHeartbeatMilliseconds,
      60_000,
    ),
    now: typeof options.now === "function" ? options.now : () => new Date(),
  };
  return Object.freeze({
    paths,
    downloadCatalogSkill(request = {}) {
      return downloadCatalogSkill(request, runtimeOptions);
    },
    installCatalogSkill(request = {}) {
      return enqueueRuntime(paths.statePath, () =>
        withRuntimeLock(paths, runtimeOptions, () =>
          installCatalogSkill(paths, request, runtimeOptions),
        ),
      );
    },
    activateCatalogSkill(request = {}) {
      return enqueueRuntime(paths.statePath, () =>
        withRuntimeLock(paths, runtimeOptions, () =>
          activateCatalogSkill(paths, request, runtimeOptions),
        ),
      );
    },
    inspectCatalogSkillInstallAttempt(request = {}) {
      return inspectCatalogSkillInstallAttempt(paths, request, runtimeOptions);
    },
    inspectCatalogSkillActivationAttempt(request = {}) {
      return inspectCatalogSkillActivationAttempt(paths, request, runtimeOptions);
    },
    inspectWorkspaceSkillRuntime(request = {}) {
      return inspectWorkspaceSkillRuntime(paths, request, runtimeOptions);
    },
    loadActiveSkillPromptContext(request = {}) {
      return loadActiveSkillPromptContext(paths, request, runtimeOptions);
    },
    loadVerifiedSkillCatalog() {
      return loadVerifiedSkillCatalog(paths, runtimeOptions);
    },
  });
}

function resolvePackagedSkillPackagePath(skill, options) {
  const resourcesPath = cleanPathCandidate(options.resourcesPath);
  if (!resourcesPath) return "";
  const fileName =
    requireSkillId(skill.skillId) +
    "-" +
    requireVersion(skill.version) +
    ".json";
  return resolveChildPath(
    path.resolve(resourcesPath, "workspace-skills"),
    fileName,
  );
}

async function readVerifiedPackagedSkillPackage(skill, options) {
  const packagePath = resolvePackagedSkillPackagePath(skill, options);
  if (!packagePath) return undefined;
  let packageBytes;
  try {
    packageBytes = Buffer.from(await options.io.readFile(packagePath));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw runtimeError("packaged_skill_package_read_failed");
  }
  if (packageBytes.length > options.maximumPackageBytes) {
    throw runtimeError("package_too_large");
  }
  const integritySha256 = sha256(packageBytes);
  if (integritySha256 !== skill.integritySha256) {
    throw runtimeError("integrity_mismatch");
  }
  validateSkillPackage(packageBytes, skill);
  return { packageBytes, integritySha256 };
}

async function downloadCatalogSkill(request, options) {
  requireConfiguredWorkspace(options);
  const binding = normalizeDownloadRequest(request);
  requireTrustedCatalogHostname(binding.sourceUrl, options.trustedCatalogHosts);
  const packagedPackage = await readVerifiedPackagedSkillPackage(
    binding.skill,
    options,
  );
  if (packagedPackage) {
    return {
      status: "downloaded_verified",
      packageBytes: packagedPackage.packageBytes,
      integritySha256: packagedPackage.integritySha256,
      skillId: binding.skill.skillId,
      version: binding.skill.version,
      requestFingerprint: binding.requestFingerprint,
      attemptId: binding.attemptId,
    };
  }
  const validatedAddresses = await resolveTrustedCatalogAddresses(
    binding.sourceUrl,
    options.lookup,
  );
  const deadline = createDownloadDeadline(options.downloadTimeoutMilliseconds);
  let transport;
  try {
    transport = await openPinnedDownloadTransport(
      binding.sourceUrl,
      validatedAddresses,
      options,
      deadline,
    );
    const response = transport.response;
    const status = responseStatus(response);
    if (
      response?.redirected === true ||
      (Number.isFinite(status) && status >= 300 && status < 400)
    ) {
      throw runtimeError("download_redirect_blocked");
    }
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      throw runtimeError("download_http_failure");
    }
    assertAllowedContentType(response);
    assertContentLengthWithinLimit(response, options.maximumPackageBytes);
    const packageBytes = await readResponseBytes(
      response,
      options.maximumPackageBytes,
      deadline,
    );
    const integritySha256 = sha256(packageBytes);
    if (integritySha256 !== binding.skill.integritySha256) {
      throw runtimeError("integrity_mismatch");
    }
    validateSkillPackage(packageBytes, binding.skill);
    return {
      status: "downloaded_verified",
      packageBytes: Buffer.from(packageBytes),
      integritySha256,
      skillId: binding.skill.skillId,
      version: binding.skill.version,
      requestFingerprint: binding.requestFingerprint,
      attemptId: binding.attemptId,
    };
  } finally {
    try {
      await transport?.dispose?.();
    } finally {
      deadline.dispose();
    }
  }
}
async function installCatalogSkill(paths, request, options) {
  requireConfiguredWorkspace(options);
  const workspaceId = resolveBoundWorkspaceId(
    request,
    options.configuredWorkspaceId,
  );
  const binding = normalizeInstallRequest(request, workspaceId);
  const loaded = await loadRuntimeState(paths, options.io, options.now);
  if (loaded.recoveryRequired) throw runtimeError("recovery_required");
  const packageInfo = validateSkillPackage(binding.packageBytes, binding.skill);
  const actualHash = sha256(binding.packageBytes);
  if (
    actualHash !== binding.verifiedIntegritySha256 ||
    actualHash !== binding.skill.integritySha256
  ) {
    throw runtimeError("integrity_mismatch");
  }
  const existingByAttempt = loaded.state.installations.find(
    (record) => record.attemptId === binding.attemptId,
  );
  if (existingByAttempt) {
    if (!installBindingMatchesRecord(binding, existingByAttempt)) {
      throw runtimeError("install_attempt_conflict");
    }
    const verified = await verifyInstallationRecord(
      paths,
      existingByAttempt,
      options.io,
    );
    if (!verified.ok) throw runtimeError("recovery_required");
    return createInstallReceipt(existingByAttempt, true);
  }
  const existingVersion = loaded.state.installations.find(
    (record) =>
      record.skillId === binding.skill.skillId &&
      record.version === binding.skill.version,
  );
  if (existingVersion) {
    if (
      existingVersion.integritySha256 !== actualHash ||
      !installBindingMatchesRecord(binding, existingVersion)
    ) {
      throw runtimeError("skill_version_package_conflict");
    }
    const verified = await verifyInstallationRecord(
      paths,
      existingVersion,
      options.io,
    );
    if (!verified.ok) throw runtimeError("recovery_required");
    return createInstallReceipt(existingVersion, true);
  }
  const packagePath = packagePathFor(
    paths,
    binding.skill.skillId,
    binding.skill.version,
    actualHash,
  );
  await writePackageAtomically(paths, packagePath, binding.packageBytes, options.io);
  const installedAt = nowIso(options.now);
  const record = {
    installationId: binding.attemptId,
    workspaceId: binding.workspaceId,
    proposalId: binding.proposalId,
    consentId: binding.consentId,
    attemptId: binding.attemptId,
    requestFingerprint: binding.requestFingerprint,
    sourceUrl: binding.skill.sourceUrl,
    skillId: binding.skill.skillId,
    version: binding.skill.version,
    integritySha256: actualHash,
    installMode: binding.skill.installMode,
    packageBytes: binding.packageBytes.length,
    manifest: packageInfo.manifest,
    installedAt,
    status: "installed_inactive",
    activated: false,
    activation: null,
  };
  loaded.state.installations.push(record);
  if (loaded.state.installations.length > maximumStateInstallations) {
    throw runtimeError("workspace_skill_runtime_capacity_exceeded");
  }
  loaded.state.updatedAt = installedAt;
  await writeRuntimeStateAtomically(paths, loaded.state, options.io);
  return createInstallReceipt(record, false);
}

async function activateCatalogSkill(paths, request, options) {
  requireConfiguredWorkspace(options);
  const workspaceId = resolveBoundWorkspaceId(
    request,
    options.configuredWorkspaceId,
  );
  const binding = normalizeActivationRequest(request, workspaceId);
  const loaded = await loadRuntimeState(paths, options.io, options.now);
  if (loaded.recoveryRequired) throw runtimeError("recovery_required");
  const record = loaded.state.installations.find(
    (candidate) => candidate.installationId === binding.installationId,
  );
  if (!record || !activationBindingMatchesRecord(binding, record)) {
    throw runtimeError("installation_binding_mismatch");
  }
  const verified = await verifyInstallationRecord(paths, record, options.io);
  if (!verified.ok) throw runtimeError("recovery_required");
  if (record.activated) {
    if (
      record.activation?.activationId !== binding.activationId ||
      record.activation?.targetAgentId !== binding.targetAgentId
    ) {
      throw runtimeError("activation_id_or_target_conflict");
    }
    return createActivationReceipt(record, true);
  }
  const activatedAt = nowIso(options.now);
  record.status = "active";
  record.activated = true;
  record.activation = {
    activationId: binding.activationId,
    targetAgentId: binding.targetAgentId,
    activatedAt,
  };
  loaded.state.updatedAt = activatedAt;
  await writeRuntimeStateAtomically(paths, loaded.state, options.io);
  return createActivationReceipt(record, false);
}
function normalizeDownloadRequest(request) {
  const skill = normalizeApprovedSkill(request?.skill);
  const sourceUrl = normalizeCatalogSourceUrl(request?.sourceUrl);
  if (!sourceUrl || sourceUrl !== skill.sourceUrl) {
    throw runtimeError("download_source_binding_mismatch");
  }
  return {
    skill,
    sourceUrl,
    proposalId: requireOpaqueId(request?.proposalId, "proposal_id"),
    consentId: requireOpaqueId(request?.consentId, "consent_id"),
    attemptId: requireOpaqueId(request?.attemptId, "attempt_id"),
    requestFingerprint: requireRequestFingerprint(request?.requestFingerprint),
  };
}

function normalizeInstallRequest(request, workspaceId) {
  const skill = normalizeApprovedSkill(request?.skill);
  const packageBytes = normalizePackageBytes(request?.packageBytes);
  if (!packageBytes.length || packageBytes.length > maximumPackageBytesHardLimit) {
    throw runtimeError("package_size_invalid");
  }
  return {
    workspaceId,
    skill,
    packageBytes,
    verifiedIntegritySha256: requireSha256(
      request?.verifiedIntegritySha256,
      "verified_integrity_sha256",
    ),
    proposalId: requireOpaqueId(request?.proposalId, "proposal_id"),
    consentId: requireOpaqueId(request?.consentId, "consent_id"),
    attemptId: requireOpaqueId(request?.attemptId, "attempt_id"),
    requestFingerprint: requireRequestFingerprint(request?.requestFingerprint),
  };
}

function normalizeActivationRequest(request, workspaceId) {
  const skill = normalizeApprovedSkill(request?.skill);
  const installation = request?.installation;
  const installationId = requireOpaqueId(
    installation?.installationId,
    "installation_id",
  );
  const installationHash = requireSha256(
    installation?.verifiedIntegritySha256 ?? installation?.integritySha256,
    "installation_integrity_sha256",
  );
  const requestFingerprint = requireRequestFingerprint(
    installation?.requestFingerprint ?? request?.requestFingerprint,
  );
  if (
    String(installation?.proposalId ?? "") !== String(request?.proposalId ?? "") ||
    String(installation?.skillId ?? "") !== skill.skillId ||
    String(installation?.version ?? "") !== skill.version ||
    String(installation?.installMode ?? "") !== skill.installMode ||
    installationHash !== skill.integritySha256
  ) {
    throw runtimeError("activation_installation_binding_mismatch");
  }
  return {
    workspaceId,
    skill,
    proposalId: requireOpaqueId(request?.proposalId, "proposal_id"),
    installationId,
    requestFingerprint,
    targetAgentId: requireTargetAgentId(request?.targetAgentId),
    activationId: requireOpaqueId(request?.activationId, "activation_id"),
  };
}

function normalizeApprovedSkill(value) {
  if (!isPlainObject(value)) throw runtimeError("invalid_skill");
  const sourceUrl = normalizeCatalogSourceUrl(value.sourceUrl);
  if (!sourceUrl) throw runtimeError("invalid_catalog_source");
  return {
    skillId: requireSkillId(value.skillId),
    version: requireVersion(value.version),
    installMode: requirePortableInstallMode(value.installMode),
    integritySha256: requireSha256(value.integritySha256, "integrity_sha256"),
    sourceUrl,
    supportedWorkPackIds: normalizeWorkPackIds(value.supportedWorkPackIds),
    requestedCapabilities: normalizeCapabilityIds(value.requestedCapabilities),
    requestedNetworkHosts: normalizeNetworkHosts(value.requestedNetworkHosts),
    requestedFolderScope: normalizeFolderScope(value.requestedFolderScope),
  };
}

function validateSkillPackage(packageBytes, approvedSkill) {
  if (containsSecretText(packageBytes.toString("utf8"))) {
    throw runtimeError("package_secret_material_detected");
  }
  const source = decodeUtf8Json(packageBytes);
  assertNoDuplicateJsonKeys(source);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw runtimeError("package_json_invalid");
  }
  assertNoDangerousJsonKeys(parsed);
  assertExactObjectKeys(
    parsed,
    ["schema", "skillId", "version", "installMode", "manifest", "instructions"],
    "package",
  );
  if (
    parsed.schema !== "modycrew.workspace-skill-package.v1" ||
    parsed.skillId !== approvedSkill.skillId ||
    parsed.version !== approvedSkill.version ||
    parsed.installMode !== portableInstallMode
  ) {
    throw runtimeError("package_identity_mismatch");
  }
  const manifest = normalizePackageManifest(parsed.manifest, approvedSkill);
  const instructions = normalizeInstructions(parsed.instructions);
  const semanticPackage = {
    schema: "modycrew.workspace-skill-package.v1",
    skillId: approvedSkill.skillId,
    version: approvedSkill.version,
    installMode: portableInstallMode,
    manifest,
    instructions,
  };
  const semanticRoundTrip = JSON.parse(JSON.stringify(semanticPackage));
  assertNoDangerousJsonKeys(semanticRoundTrip);
  if (containsSecretMaterial(semanticRoundTrip)) {
    throw runtimeError("package_secret_material_detected");
  }
  return {
    manifest,
    instructions,
    semanticSha256: sha256(Buffer.from(JSON.stringify(semanticRoundTrip), "utf8")),
  };
}

function normalizePackageManifest(value, approvedSkill) {
  assertPlainObject(value, "manifest");
  const allowedKeys = [
    "supportedWorkPackIds",
    "requestedCapabilities",
    "networkHosts",
    "folderScope",
    "requestedNetworkHosts",
    "requestedFolderScope",
  ];
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw runtimeError("package_field_not_allowed");
  }
  if (
    !Object.hasOwn(value, "supportedWorkPackIds") ||
    !Object.hasOwn(value, "requestedCapabilities") ||
    (Object.hasOwn(value, "networkHosts") === Object.hasOwn(value, "requestedNetworkHosts")) ||
    (Object.hasOwn(value, "folderScope") === Object.hasOwn(value, "requestedFolderScope"))
  ) {
    throw runtimeError("package_manifest_invalid");
  }
  const manifest = {
    supportedWorkPackIds: normalizeWorkPackIds(value.supportedWorkPackIds),
    requestedCapabilities: normalizeCapabilityIds(value.requestedCapabilities),
    networkHosts: normalizeNetworkHosts(
      value.networkHosts ?? value.requestedNetworkHosts,
    ),
    folderScope: normalizeFolderScope(
      value.folderScope ?? value.requestedFolderScope,
    ),
  };
  if (
    !equalStringSets(
      manifest.supportedWorkPackIds,
      approvedSkill.supportedWorkPackIds,
    ) ||
    !equalStringSets(
      manifest.requestedCapabilities,
      approvedSkill.requestedCapabilities,
    ) ||
    !equalStringSets(manifest.networkHosts, approvedSkill.requestedNetworkHosts) ||
    manifest.folderScope !== approvedSkill.requestedFolderScope
  ) {
    throw runtimeError("package_scope_mismatch");
  }
  return manifest;
}

function normalizeInstructions(value) {
  if (!Array.isArray(value) || !value.length || value.length > maximumInstructions) {
    throw runtimeError("package_instructions_invalid");
  }
  let totalCharacters = 0;
  const result = [];
  for (const item of value) {
    if (typeof item !== "string") throw runtimeError("package_instructions_invalid");
    const instruction = item.trim();
    if (
      !instruction ||
      instruction.length > maximumInstructionCharacters ||
      looksLikeExecutableOrHtml(instruction) ||
      containsSecretText(instruction)
    ) {
      throw runtimeError("package_instructions_invalid");
    }
    totalCharacters += instruction.length;
    if (totalCharacters > maximumInstructionCharacters) {
      throw runtimeError("package_instructions_too_large");
    }
    result.push(instruction);
  }
  return result;
}

async function inspectCatalogSkillInstallAttempt(paths, request, options) {
  if (!hasConfiguredWorkspace(options)) {
    return createUnverifiedInspection("workspace_required");
  }
  let expected;
  try {
    expected = normalizeInstallInspectionRequest(
      request,
      options.configuredWorkspaceId,
    );
  } catch {
    return createUnverifiedInspection("invalid_request");
  }
  const loaded = await loadRuntimeState(paths, options.io, options.now);
  if (loaded.recoveryRequired) {
    return createUnverifiedInspection("recovery_required");
  }
  if (!(await verifyPackageInventory(paths, loaded.state, options.io))) {
    return createUnverifiedInspection("recovery_required");
  }
  const record = loaded.state.installations.find(
    (candidate) => candidate.attemptId === expected.attemptId,
  );
  if (!record) {
    return {
      verified: true,
      status: "not_installed",
      installed: false,
      activated: false,
      active: false,
      ...expected,
    };
  }
  if (!installInspectionMatchesRecord(expected, record)) {
    return createUnverifiedInspection("binding_mismatch");
  }
  const verified = await verifyInstallationRecord(paths, record, options.io);
  if (!verified.ok) return createUnverifiedInspection("recovery_required");
  return {
    verified: true,
    status: record.activated ? "active" : "installed_inactive",
    installed: true,
    activated: record.activated,
    active: record.activated,
    installationId: record.installationId,
    installedAt: record.installedAt,
    targetAgentId: record.activation?.targetAgentId ?? "",
    activatedAt: record.activation?.activatedAt ?? "",
    ...inspectionBindingFromRecord(record),
  };
}

async function inspectCatalogSkillActivationAttempt(paths, request, options) {
  if (!hasConfiguredWorkspace(options)) {
    return createUnverifiedInspection("workspace_required");
  }
  let expected;
  try {
    expected = normalizeActivationInspectionRequest(
      request,
      options.configuredWorkspaceId,
    );
  } catch {
    return createUnverifiedInspection("invalid_request");
  }
  const loaded = await loadRuntimeState(paths, options.io, options.now);
  if (loaded.recoveryRequired) {
    return createUnverifiedInspection("recovery_required");
  }
  if (!(await verifyPackageInventory(paths, loaded.state, options.io))) {
    return createUnverifiedInspection("recovery_required");
  }
  const record = loaded.state.installations.find(
    (candidate) => candidate.installationId === expected.installationId,
  );
  if (!record || !activationInspectionMatchesRecord(expected, record)) {
    return createUnverifiedInspection("binding_mismatch");
  }
  const verified = await verifyInstallationRecord(paths, record, options.io);
  if (!verified.ok) return createUnverifiedInspection("recovery_required");
  if (!record.activated) {
    return {
      verified: true,
      status: "inactive",
      installed: true,
      activated: false,
      active: false,
      activatedAt: "",
      ...expected,
    };
  }
  if (
    record.activation?.activationId !== expected.activationId ||
    record.activation?.targetAgentId !== expected.targetAgentId
  ) {
    return createUnverifiedInspection("binding_mismatch");
  }
  return {
    verified: true,
    status: "activated",
    installed: true,
    activated: true,
    active: true,
    activatedAt: record.activation.activatedAt,
    ...expected,
  };
}

async function inspectWorkspaceSkillRuntime(paths, request, options) {
  if (!hasConfiguredWorkspace(options)) {
    return createUnverifiedInspection("workspace_required");
  }
  let filters;
  try {
    filters = normalizeRuntimeInspectionFilters(
      request,
      options.configuredWorkspaceId,
    );
  } catch {
    return createUnverifiedInspection("invalid_request");
  }
  const loaded = await loadRuntimeState(paths, options.io, options.now);
  if (loaded.recoveryRequired) {
    return createUnverifiedInspection("recovery_required");
  }
  if (!(await verifyPackageInventory(paths, loaded.state, options.io))) {
    return createUnverifiedInspection("recovery_required");
  }
  const records = [];
  for (const record of loaded.state.installations) {
    const verified = await verifyInstallationRecord(paths, record, options.io);
    if (!verified.ok) return createUnverifiedInspection("recovery_required");
    if (matchesRuntimeFilters(record, filters)) {
      records.push(createPublicRuntimeRecord(record));
    }
  }
  const installed = records.length > 0;
  const active = records.some((record) => record.active);
  return {
    verified: true,
    status: active
      ? "active"
      : installed
        ? "installed_inactive"
        : "not_installed",
    installed,
    activated: active,
    active,
    installationCount: records.length,
    installations: records,
  };
}
async function loadActiveSkillPromptContext(paths, request, options) {
  if (!hasConfiguredWorkspace(options)) {
    return createPromptWorkspaceRequiredResult();
  }
  let targetAgentId;
  let maximumCharacters;
  try {
    targetAgentId = requireTargetAgentId(request.targetAgentId);
    maximumCharacters = clampPositiveInteger(
      request.maxChars,
      maximumInstructionCharacters,
      maximumInstructionCharacters,
    );
  } catch {
    return {
      verified: false,
      status: "invalid_request",
      active: false,
      targetAgentId: "",
      instructions: [],
      truncated: false,
    };
  }
  const loaded = await loadRuntimeState(paths, options.io, options.now);
  if (loaded.recoveryRequired) return createPromptRecoveryResult(targetAgentId);
  if (!(await verifyPackageInventory(paths, loaded.state, options.io))) {
    return createPromptRecoveryResult(targetAgentId);
  }
  const activeRecords = loaded.state.installations.filter(
    (record) =>
      record.workspaceId === options.configuredWorkspaceId &&
      record.activated === true &&
      record.activation?.targetAgentId === targetAgentId,
  );
  const instructions = [];
  let usedCharacters = 0;
  let truncated = false;
  for (const record of activeRecords) {
    const verified = await verifyInstallationRecord(paths, record, options.io);
    if (!verified.ok) return createPromptRecoveryResult(targetAgentId);
    const selectedInstructions = [];
    for (const instruction of verified.packageInfo.instructions) {
      if (usedCharacters + instruction.length > maximumCharacters) {
        truncated = true;
        continue;
      }
      selectedInstructions.push(instruction);
      usedCharacters += instruction.length;
    }
    if (selectedInstructions.length) {
      instructions.push({
        skillId: record.skillId,
        version: record.version,
        installationId: record.installationId,
        instructions: selectedInstructions,
        approvedScope: createApprovedScopeSummary(record.manifest),
      });
    }
  }
  return {
    verified: true,
    status: activeRecords.length
      ? "active_skill_prompt_context_loaded"
      : "no_active_skills",
    active: activeRecords.length > 0,
    targetAgentId,
    instructions,
    truncated,
  };
}
function normalizeInstallInspectionRequest(request, configuredWorkspaceId) {
  const workspaceId = resolveBoundWorkspaceId(request, configuredWorkspaceId);
  return {
    workspaceId,
    proposalId: requireOpaqueId(request?.proposalId, "proposal_id"),
    consentId: requireOpaqueId(request?.consentId, "consent_id"),
    attemptId: requireOpaqueId(request?.attemptId, "attempt_id"),
    skillId: requireSkillId(request?.skillId),
    version: requireVersion(request?.version),
    integritySha256: requireSha256(request?.integritySha256, "integrity_sha256"),
    installMode: requirePortableInstallMode(request?.installMode),
    requestFingerprint: requireRequestFingerprint(request?.requestFingerprint),
  };
}

function normalizeActivationInspectionRequest(request, configuredWorkspaceId) {
  const workspaceId = resolveBoundWorkspaceId(request, configuredWorkspaceId);
  return {
    workspaceId,
    proposalId: requireOpaqueId(request?.proposalId, "proposal_id"),
    installationId: requireOpaqueId(request?.installationId, "installation_id"),
    activationId: requireOpaqueId(request?.activationId, "activation_id"),
    skillId: requireSkillId(request?.skillId),
    version: requireVersion(request?.version),
    integritySha256: requireSha256(request?.integritySha256, "integrity_sha256"),
    installMode: requirePortableInstallMode(request?.installMode),
    requestFingerprint: requireRequestFingerprint(request?.requestFingerprint),
    targetAgentId: requireTargetAgentId(request?.targetAgentId),
  };
}

function normalizeRuntimeInspectionFilters(request, configuredWorkspaceId) {
  const filters = {};
  if (request?.workspaceId !== undefined || configuredWorkspaceId) {
    filters.workspaceId = resolveBoundWorkspaceId(request, configuredWorkspaceId);
  }
  if (request?.skillId !== undefined) filters.skillId = requireSkillId(request.skillId);
  if (request?.version !== undefined) filters.version = requireVersion(request.version);
  if (request?.targetAgentId !== undefined) {
    filters.targetAgentId = requireTargetAgentId(request.targetAgentId);
  }
  if (request?.installationId !== undefined) {
    filters.installationId = requireOpaqueId(
      request.installationId,
      "installation_id",
    );
  }
  return filters;
}

async function loadRuntimeState(paths, io, now) {
  let statePathSafe;
  try {
    statePathSafe = await ensureSafeRuntimeFileTarget(paths, paths.statePath, io, false);
  } catch {
    return { recoveryRequired: true, reason: "runtime_path_unsafe" };
  }
  if (!statePathSafe) {
    return { recoveryRequired: false, state: createEmptyRuntimeState(now) };
  }
  let raw;
  try {
    raw = await io.readFile(paths.statePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return { recoveryRequired: true, reason: "state_read_failed" };
    }
    const previousExists = await pathExists(paths.previousStatePath, io);
    const packageArtifacts = await packageArtifactsExist(paths, io);
    if (previousExists || packageArtifacts) {
      return { recoveryRequired: true, reason: "state_missing_with_artifacts" };
    }
    return { recoveryRequired: false, state: createEmptyRuntimeState(now) };
  }
  try {
    return { recoveryRequired: false, state: parseRuntimeState(raw) };
  } catch {
    return { recoveryRequired: true, reason: "state_corrupt" };
  }
}

function createEmptyRuntimeState(now) {
  const timestamp = nowIso(now);
  const base = {
    schema: workspaceSkillRuntimeSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
    installations: [],
  };
  return {
    ...base,
    stateIntegritySha256: stateIntegritySha256(base),
  };
}

function parseRuntimeState(raw) {
  if (typeof raw !== "string" || raw.length > 2 * 1024 * 1024) {
    throw runtimeError("state_invalid");
  }
  assertNoDuplicateJsonKeys(raw);
  const parsed = JSON.parse(raw);
  assertNoDangerousJsonKeys(parsed);
  assertExactObjectKeys(
    parsed,
    [
      "schema",
      "createdAt",
      "updatedAt",
      "installations",
      "stateIntegritySha256",
    ],
    "runtime_state",
  );
  if (
    parsed.schema !== workspaceSkillRuntimeSchema ||
    !Array.isArray(parsed.installations) ||
    parsed.installations.length > maximumStateInstallations
  ) {
    throw runtimeError("state_invalid");
  }
  const base = {
    schema: workspaceSkillRuntimeSchema,
    createdAt: normalizeIsoDate(parsed.createdAt),
    updatedAt: normalizeIsoDate(parsed.updatedAt),
    installations: parsed.installations.map(normalizeRuntimeInstallationRecord),
  };
  const storedChecksum = requireSha256(
    parsed.stateIntegritySha256,
    "state_integrity_sha256",
  );
  if (stateIntegritySha256(base) !== storedChecksum) {
    throw runtimeError("state_integrity_mismatch");
  }
  const uniqueness = new Set();
  for (const record of base.installations) {
    if (
      uniqueness.has(record.installationId) ||
      uniqueness.has("attempt:" + record.attemptId)
    ) {
      throw runtimeError("state_duplicate_installation");
    }
    uniqueness.add(record.installationId);
    uniqueness.add("attempt:" + record.attemptId);
  }
  return {
    ...base,
    stateIntegritySha256: storedChecksum,
  };
}

function normalizeRuntimeInstallationRecord(value) {
  assertPlainObject(value, "installation");
  assertExactObjectKeys(
    value,
    [
      "installationId",
      "workspaceId",
      "proposalId",
      "consentId",
      "attemptId",
      "requestFingerprint",
      "sourceUrl",
      "skillId",
      "version",
      "integritySha256",
      "installMode",
      "packageBytes",
      "manifest",
      "installedAt",
      "status",
      "activated",
      "activation",
    ],
    "installation",
  );
  const status =
    value.status === "installed_inactive" || value.status === "active"
      ? value.status
      : "";
  const activated = value.activated === true;
  const activation = normalizeRuntimeActivation(value.activation);
  if (
    !status ||
    (status === "active") !== activated ||
    (activated && !activation) ||
    (!activated && activation)
  ) {
    throw runtimeError("state_installation_invalid");
  }
  return {
    installationId: requireOpaqueId(value.installationId, "installation_id"),
    workspaceId: requireWorkspaceId(value.workspaceId),
    proposalId: requireOpaqueId(value.proposalId, "proposal_id"),
    consentId: requireOpaqueId(value.consentId, "consent_id"),
    attemptId: requireOpaqueId(value.attemptId, "attempt_id"),
    requestFingerprint: requireRequestFingerprint(value.requestFingerprint),
    sourceUrl: requireCatalogSourceUrl(value.sourceUrl),
    skillId: requireSkillId(value.skillId),
    version: requireVersion(value.version),
    integritySha256: requireSha256(value.integritySha256, "integrity_sha256"),
    installMode: requirePortableInstallMode(value.installMode),
    packageBytes: requirePackageByteCount(value.packageBytes),
    manifest: normalizeStoredManifest(value.manifest),
    installedAt: normalizeIsoDate(value.installedAt),
    status,
    activated,
    activation,
  };
}

function normalizeRuntimeActivation(value) {
  if (value === null) return null;
  assertPlainObject(value, "activation");
  assertExactObjectKeys(
    value,
    ["activationId", "targetAgentId", "activatedAt"],
    "activation",
  );
  return {
    activationId: requireOpaqueId(value.activationId, "activation_id"),
    targetAgentId: requireTargetAgentId(value.targetAgentId),
    activatedAt: normalizeIsoDate(value.activatedAt),
  };
}

function normalizeStoredManifest(value) {
  assertPlainObject(value, "stored_manifest");
  assertExactObjectKeys(
    value,
    ["supportedWorkPackIds", "requestedCapabilities", "networkHosts", "folderScope"],
    "stored_manifest",
  );
  return {
    supportedWorkPackIds: normalizeWorkPackIds(value.supportedWorkPackIds),
    requestedCapabilities: normalizeCapabilityIds(value.requestedCapabilities),
    networkHosts: normalizeNetworkHosts(value.networkHosts),
    folderScope: normalizeFolderScope(value.folderScope),
  };
}

async function writeRuntimeStateAtomically(paths, state, io) {
  const normalized = parseRuntimeState(
    JSON.stringify(withStateIntegrityChecksum(state)),
  );
  const serialized = JSON.stringify(normalized, null, 2) + "\n";
  await ensureSafeRuntimeFileTarget(paths, paths.statePath, io, true);
  await ensureSafeRuntimeFileTarget(paths, paths.previousStatePath, io, true);
  try {
    const current = await io.readFile(paths.statePath);
    await writeFileAtomically(paths, paths.previousStatePath, current, io);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFileAtomically(paths, paths.statePath, serialized, io);
}

function withStateIntegrityChecksum(state) {
  const base = {
    schema: state.schema,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    installations: state.installations,
  };
  return {
    ...base,
    stateIntegritySha256: stateIntegritySha256(base),
  };
}

function stateIntegritySha256(base) {
  return sha256(Buffer.from(JSON.stringify(base), "utf8"));
}

async function writePackageAtomically(paths, packagePath, packageBytes, io) {
  await ensureSafeRuntimeFileTarget(paths, packagePath, io, true);
  try {
    const existing = await io.readFile(packagePath);
    if (!Buffer.from(existing).equals(packageBytes)) {
      throw runtimeError("package_file_conflict");
    }
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFileAtomically(paths, packagePath, packageBytes, io);
}

async function writeFileAtomically(paths, filePath, content, io) {
  await ensureSafeRuntimeFileTarget(paths, filePath, io, true);
  const temporaryPath = resolveChildPath(
    path.dirname(filePath),
    "." + path.basename(filePath) + "." + randomUUID() + ".tmp",
  );
  let handle;
  try {
    handle = await io.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content);
    if (typeof handle.sync === "function") await handle.sync();
    await ensureSafeRuntimeFileTarget(paths, temporaryPath, io, false);
    await ensureSafeRuntimeFileTarget(paths, filePath, io, false);
    await handle.close();
    handle = undefined;
    await ensureSafeRuntimeFileTarget(paths, temporaryPath, io, false);
    await ensureSafeRuntimeFileTarget(paths, filePath, io, false);
    await io.rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // A later inspection treats a remaining artifact as unsafe.
      }
    }
    try {
      await io.unlink(temporaryPath);
    } catch {
      // Best effort only.
    }
    throw error;
  }
}
async function verifyInstallationRecord(paths, record, io) {
  const packagePath = packagePathFor(
    paths,
    record.skillId,
    record.version,
    record.integritySha256,
  );
  try {
    if (!(await ensureSafeRuntimeFileTarget(paths, packagePath, io, false))) {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }
  let packageBytes;
  try {
    packageBytes = Buffer.from(await io.readFile(packagePath));
  } catch {
    return { ok: false };
  }
  if (
    packageBytes.length !== record.packageBytes ||
    sha256(packageBytes) !== record.integritySha256
  ) {
    return { ok: false };
  }
  try {
    const packageInfo = validateSkillPackage(packageBytes, {
      skillId: record.skillId,
      version: record.version,
      installMode: record.installMode,
      integritySha256: record.integritySha256,
      sourceUrl: record.sourceUrl,
      supportedWorkPackIds: record.manifest.supportedWorkPackIds,
      requestedCapabilities: record.manifest.requestedCapabilities,
      requestedNetworkHosts: record.manifest.networkHosts,
      requestedFolderScope: record.manifest.folderScope,
    });
    if (!equalManifest(packageInfo.manifest, record.manifest)) {
      return { ok: false };
    }
    return { ok: true, packageInfo };
  } catch {
    return { ok: false };
  }
}

async function verifyPackageInventory(paths, state, io) {
  let packageRootSafe;
  try {
    packageRootSafe = await ensureSafeRuntimeFileTarget(
      paths,
      path.join(paths.packagesRoot, ".inventory-probe"),
      io,
      false,
    );
  } catch {
    return false;
  }
  if (!packageRootSafe) return state.installations.length === 0;
  let found;
  try {
    found = await listPackageFiles(paths, paths.packagesRoot, io);
  } catch {
    return false;
  }
  const expected = new Set(
    state.installations.map((record) =>
      normalizeRelativePath(
        path.relative(
          paths.packagesRoot,
          packagePathFor(
            paths,
            record.skillId,
            record.version,
            record.integritySha256,
          ),
        ),
      ),
    ),
  );
  return (
    found.length === expected.size &&
    found.every((relativePath) => expected.has(relativePath))
  );
}

async function listPackageFiles(paths, root, io, relative = "", found = []) {
  const probePath = relative
    ? resolveChildPath(root, relative, ".inventory-probe")
    : resolveChildPath(root, ".inventory-probe");
  if (!(await ensureSafeRuntimeFileTarget(paths, probePath, io, false))) {
    return found;
  }
  let entries;
  try {
    entries = await io.readdir(
      relative ? resolveChildPath(root, relative) : root,
      { withFileTypes: true },
    );
  } catch (error) {
    if (error?.code === "ENOENT" && !relative) return found;
    throw error;
  }
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string") {
      throw runtimeError("package_inventory_invalid");
    }
    const entryRelative = relative
      ? relative + path.sep + entry.name
      : entry.name;
    if (entry.isDirectory()) {
      if (entryRelative.split(path.sep).length > 3) {
        throw runtimeError("package_inventory_invalid");
      }
      await listPackageFiles(paths, root, io, entryRelative, found);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink?.()) {
      throw runtimeError("package_inventory_invalid");
    }
    found.push(normalizeRelativePath(entryRelative));
    if (found.length > maximumPackageInventoryEntries) {
      throw runtimeError("package_inventory_invalid");
    }
  }
  return found;
}

function createInstallReceipt(record, idempotent) {
  return {
    status: "installed_inactive",
    installationId: record.installationId,
    proposalId: record.proposalId,
    skillId: record.skillId,
    version: record.version,
    integritySha256: record.integritySha256,
    installMode: record.installMode,
    installedAt: record.installedAt,
    installed: true,
    activated: false,
    active: false,
    idempotent,
  };
}

function createActivationReceipt(record, idempotent) {
  return {
    status: "activated",
    installationId: record.installationId,
    activationId: record.activation.activationId,
    skillId: record.skillId,
    version: record.version,
    integritySha256: record.integritySha256,
    installMode: record.installMode,
    targetAgentId: record.activation.targetAgentId,
    activatedAt: record.activation.activatedAt,
    installed: true,
    activated: true,
    active: true,
    idempotent,
  };
}

function inspectionBindingFromRecord(record) {
  return {
    workspaceId: record.workspaceId,
    proposalId: record.proposalId,
    consentId: record.consentId,
    attemptId: record.attemptId,
    skillId: record.skillId,
    version: record.version,
    integritySha256: record.integritySha256,
    installMode: record.installMode,
    requestFingerprint: record.requestFingerprint,
  };
}

function createPublicRuntimeRecord(record) {
  return {
    installationId: record.installationId,
    skillId: record.skillId,
    version: record.version,
    integritySha256: record.integritySha256,
    installMode: record.installMode,
    status: record.status,
    installed: true,
    activated: record.activated,
    active: record.activated,
    targetAgentId: record.activation?.targetAgentId ?? "",
    installedAt: record.installedAt,
    activatedAt: record.activation?.activatedAt ?? "",
    approvedScope: createApprovedScopeSummary(record.manifest),
  };
}

function createApprovedScopeSummary(manifest) {
  return {
    supportedWorkPackIds: [...manifest.supportedWorkPackIds],
    requestedCapabilities: [...manifest.requestedCapabilities],
    networkHosts: [...manifest.networkHosts],
    folderScope: manifest.folderScope,
    executionBoundary: "prompt_data_only",
  };
}

function createUnverifiedInspection(reason) {
  return {
    verified: false,
    status: "recovery_required",
    reason:
      reason === "invalid_request" || reason === "binding_mismatch"
        ? "verification_failed"
        : "recovery_required",
    installed: false,
    activated: false,
    active: false,
  };
}

function createPromptRecoveryResult(targetAgentId) {
  return {
    verified: false,
    status: "recovery_required",
    active: false,
    targetAgentId,
    instructions: [],
    truncated: false,
  };
}

function installBindingMatchesRecord(binding, record) {
  return (
    record.workspaceId === binding.workspaceId &&
    record.proposalId === binding.proposalId &&
    record.consentId === binding.consentId &&
    record.attemptId === binding.attemptId &&
    record.requestFingerprint === binding.requestFingerprint &&
    record.sourceUrl === binding.skill.sourceUrl &&
    record.skillId === binding.skill.skillId &&
    record.version === binding.skill.version &&
    record.integritySha256 === binding.verifiedIntegritySha256 &&
    record.installMode === binding.skill.installMode
  );
}

function activationBindingMatchesRecord(binding, record) {
  return (
    record.workspaceId === binding.workspaceId &&
    record.proposalId === binding.proposalId &&
    record.installationId === binding.installationId &&
    record.requestFingerprint === binding.requestFingerprint &&
    record.skillId === binding.skill.skillId &&
    record.version === binding.skill.version &&
    record.integritySha256 === binding.skill.integritySha256 &&
    record.installMode === binding.skill.installMode
  );
}

function installInspectionMatchesRecord(expected, record) {
  return (
    record.workspaceId === expected.workspaceId &&
    record.proposalId === expected.proposalId &&
    record.consentId === expected.consentId &&
    record.attemptId === expected.attemptId &&
    record.skillId === expected.skillId &&
    record.version === expected.version &&
    record.integritySha256 === expected.integritySha256 &&
    record.installMode === expected.installMode &&
    record.requestFingerprint === expected.requestFingerprint
  );
}

function activationInspectionMatchesRecord(expected, record) {
  return (
    record.workspaceId === expected.workspaceId &&
    record.proposalId === expected.proposalId &&
    record.installationId === expected.installationId &&
    record.skillId === expected.skillId &&
    record.version === expected.version &&
    record.integritySha256 === expected.integritySha256 &&
    record.installMode === expected.installMode &&
    record.requestFingerprint === expected.requestFingerprint
  );
}

function matchesRuntimeFilters(record, filters) {
  return (
    (!filters.workspaceId || record.workspaceId === filters.workspaceId) &&
    (!filters.skillId || record.skillId === filters.skillId) &&
    (!filters.version || record.version === filters.version) &&
    (!filters.installationId || record.installationId === filters.installationId) &&
    (!filters.targetAgentId || record.activation?.targetAgentId === filters.targetAgentId)
  );
}

function equalManifest(left, right) {
  return (
    equalStringSets(left.supportedWorkPackIds, right.supportedWorkPackIds) &&
    equalStringSets(left.requestedCapabilities, right.requestedCapabilities) &&
    equalStringSets(left.networkHosts, right.networkHosts) &&
    left.folderScope === right.folderScope
  );
}

function equalStringSets(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function normalizeWorkPackIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > allowedWorkPackIds.size) {
    throw runtimeError("invalid_work_pack_scope");
  }
  const ids = value.map((item) => String(item ?? ""));
  if (
    ids.some((id) => !allowedWorkPackIds.has(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw runtimeError("invalid_work_pack_scope");
  }
  return [...ids].sort();
}

function normalizeCapabilityIds(value) {
  return normalizeScopeTokenArray(value, 40, 180, "invalid_capability_scope");
}

function normalizeNetworkHosts(value) {
  if (!Array.isArray(value) || value.length > 40) {
    throw runtimeError("invalid_network_scope");
  }
  const hosts = value.map((item) => normalizePublicHostname(item));
  if (new Set(hosts).size !== hosts.length) {
    throw runtimeError("invalid_network_scope");
  }
  return [...hosts].sort();
}

function normalizeScopeTokenArray(value, maximumItems, maximumLength, code) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw runtimeError(code);
  }
  const items = value.map((item) => String(item ?? ""));
  const tokenPattern = new RegExp(
    "^[A-Za-z0-9][A-Za-z0-9._:@/-]{0," + (maximumLength - 1) + "}$",
    "u",
  );
  if (
    items.some((item) => !tokenPattern.test(item) || item.includes("..")) ||
    new Set(items).size !== items.length
  ) {
    throw runtimeError(code);
  }
  return [...items].sort();
}

function normalizeFolderScope(value) {
  if (value === "none" || value === "selected_workspace_only") return value;
  throw runtimeError("invalid_folder_scope");
}

function normalizePublicHostname(value) {
  const host = String(value ?? "").trim().toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u.test(
      host,
    ) ||
    host.length > 253 ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    isIP(host)
  ) {
    throw runtimeError("invalid_network_scope");
  }
  return host;
}

function requireWorkspaceId(value) {
  const id = optionalWorkspaceId(value);
  if (!id) throw runtimeError("invalid_workspace_id");
  return id;
}

function optionalWorkspaceId(value) {
  const id = String(value ?? "");
  return /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(id) && !id.includes("..")
    ? id
    : "";
}

function resolveBoundWorkspaceId(request, configuredWorkspaceId) {
  const requestedWorkspaceId =
    request?.workspaceId === undefined
      ? ""
      : requireWorkspaceId(request.workspaceId);
  if (
    configuredWorkspaceId &&
    requestedWorkspaceId &&
    configuredWorkspaceId !== requestedWorkspaceId
  ) {
    throw runtimeError("workspace_binding_mismatch");
  }
  const workspaceId = requestedWorkspaceId || configuredWorkspaceId;
  if (!workspaceId) throw runtimeError("workspace_id_required");
  return workspaceId;
}

function requireSkillId(value) {
  const id = String(value ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(id) || id.includes("..")) {
    throw runtimeError("invalid_skill_id");
  }
  return id;
}

function requireVersion(value) {
  const version = String(value ?? "");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(version) ||
    version.includes("..")
  ) {
    throw runtimeError("invalid_skill_version");
  }
  return version;
}

function requireTargetAgentId(value) {
  const id = String(value ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(id) || id.includes("..")) {
    throw runtimeError("invalid_target_agent_id");
  }
  return id;
}

function requireOpaqueId(value, label) {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9._:@+-]{1,256}$/u.test(id) || id.includes("..")) {
    throw runtimeError("invalid_" + label);
  }
  return id;
}

function requireRequestFingerprint(value) {
  const fingerprint = String(value ?? "");
  if (
    fingerprint.length < 72 ||
    fingerprint.length > 4096 ||
    !/^sha256:[a-f0-9]{64}(?::binding:[A-Za-z0-9._~%|,=:+-]+)?$/u.test(
      fingerprint,
    )
  ) {
    throw runtimeError("invalid_request_fingerprint");
  }
  return fingerprint;
}

function requireSha256(value, label) {
  const hash = String(value ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw runtimeError("invalid_" + label);
  }
  return hash;
}

function requirePortableInstallMode(value) {
  if (value !== portableInstallMode) {
    throw runtimeError("install_mode_not_allowed");
  }
  return portableInstallMode;
}

function requirePackageByteCount(value) {
  const count = Number(value);
  if (
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    count > maximumPackageBytesHardLimit
  ) {
    throw runtimeError("invalid_package_byte_count");
  }
  return count;
}

function normalizeCatalogSourceUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    return "";
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443")
  ) {
    return "";
  }
  const host = url.hostname.toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    isIP(host)
  ) {
    return "";
  }
  return url.toString();
}

function requireCatalogSourceUrl(value) {
  const sourceUrl = normalizeCatalogSourceUrl(value);
  if (!sourceUrl) throw runtimeError("invalid_catalog_source");
  return sourceUrl;
}

async function assertTrustedCatalogUrl(sourceUrl, lookup) {
  await resolveTrustedCatalogAddresses(sourceUrl, lookup);
}

async function resolveTrustedCatalogAddresses(sourceUrl, lookup) {
  const normalized = requireCatalogSourceUrl(sourceUrl);
  const host = new URL(normalized).hostname.toLowerCase();
  let resolved;
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw runtimeError("catalog_host_resolution_failed");
  }
  const entries = Array.isArray(resolved)
    ? resolved
    : resolved && typeof resolved.address === "string"
      ? [resolved]
      : [];
  if (!entries.length) throw runtimeError("catalog_host_resolution_failed");
  const addresses = [];
  for (const entry of entries) {
    const address = String(entry?.address ?? "");
    if (!isPublicInternetAddress(address)) {
      throw runtimeError("catalog_private_address_blocked");
    }
    if (!addresses.some((candidate) => ipAddressesEqual(candidate, address))) {
      addresses.push(address);
    }
  }
  if (!addresses.length) throw runtimeError("catalog_host_resolution_failed");
  return addresses;
}

function isPublicInternetAddress(address) {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;
  const bytes = parseIpv6Bytes(address);
  if (!bytes) return false;
  const embeddedIpv4 = extractEmbeddedIpv4(bytes);
  if (embeddedIpv4) return isPublicIpv4(embeddedIpv4);
  if (bytes.every((value) => value === 0)) return false;
  if (bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1) {
    return false;
  }
  if ((bytes[0] & 0xfe) === 0xfc) return false;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false;
  if (bytes[0] === 0xff) return false;
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  ) {
    return false;
  }
  return true;
}

function isPublicIpv4(address) {
  const octets = parseIpv4Octets(address);
  if (!octets) return false;
  const [a, b, c] = octets;
  if (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return false;
  }
  return true;
}

function parseIpv4Octets(address) {
  if (!/^\d+\.\d+\.\d+\.\d+$/u.test(address)) return undefined;
  const octets = address.split(".").map((part) => Number(part));
  return octets.every(
    (octet) => Number.isSafeInteger(octet) && octet >= 0 && octet <= 255,
  )
    ? octets
    : undefined;
}

function parseIpv6Bytes(address) {
  const input = String(address ?? "").toLowerCase();
  if (!input || input.includes("%") || isIP(input) !== 6) return undefined;
  let normalized = input;
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const ipv4 = parseIpv4Octets(normalized.slice(separator + 1));
    if (!ipv4) return undefined;
    normalized =
      normalized.slice(0, separator) +
      ":" +
      ((ipv4[0] << 8) | ipv4[1]).toString(16) +
      ":" +
      ((ipv4[2] << 8) | ipv4[3]).toString(16);
  }
  const doubleSeparator = normalized.indexOf("::");
  if (doubleSeparator !== normalized.lastIndexOf("::")) return undefined;
  let parts;
  if (doubleSeparator >= 0) {
    const left = normalized.slice(0, doubleSeparator).split(":").filter(Boolean);
    const right = normalized.slice(doubleSeparator + 2).split(":").filter(Boolean);
    const missing = 8 - left.length - right.length;
    if (missing < 1) return undefined;
    parts = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    parts = normalized.split(":");
  }
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) {
    return undefined;
  }
  const bytes = [];
  for (const part of parts) {
    const value = Number.parseInt(part, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function extractEmbeddedIpv4(bytes) {
  const compatible = bytes.slice(0, 12).every((value) => value === 0);
  const mapped =
    bytes.slice(0, 10).every((value) => value === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (!compatible && !mapped) return "";
  return bytes.slice(12).join(".");
}

function ipAddressesEqual(left, right) {
  const leftVersion = isIP(left);
  const rightVersion = isIP(right);
  if (leftVersion === 4 && rightVersion === 4) return left === right;
  const leftBytes = leftVersion === 6 ? parseIpv6Bytes(left) : undefined;
  const rightBytes = rightVersion === 6 ? parseIpv6Bytes(right) : undefined;
  if (leftVersion === 4 && rightBytes) {
    return extractEmbeddedIpv4(rightBytes) === left;
  }
  if (rightVersion === 4 && leftBytes) {
    return extractEmbeddedIpv4(leftBytes) === right;
  }
  return Boolean(
    leftBytes &&
      rightBytes &&
      leftBytes.length === rightBytes.length &&
      leftBytes.every((value, index) => value === rightBytes[index]),
  );
}

function createDownloadDeadline(timeoutMilliseconds) {
  const controller = new AbortController();
  const aborters = new Set();
  const expiresAt = Date.now() + timeoutMilliseconds;
  let timedOut = false;
  let disposed = false;
  const abort = (timeout = false) => {
    if (disposed) return;
    if (timeout) timedOut = true;
    try {
      controller.abort();
    } catch {
      // Abort is best-effort; the surrounding deadline race still fails closed.
    }
    for (const aborter of [...aborters]) {
      try {
        aborter();
      } catch {
        // Each transport performs its own cleanup.
      }
    }
  };
  const timer = setTimeout(() => abort(true), timeoutMilliseconds);
  return {
    controller,
    expiresAt,
    timedOut: () => timedOut || Date.now() >= expiresAt,
    registerAborter(aborter) {
      if (typeof aborter !== "function") return () => undefined;
      aborters.add(aborter);
      return () => aborters.delete(aborter);
    },
    abort,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      aborters.clear();
    },
  };
}

async function awaitWithinDownloadDeadline(promise, deadline, cancel) {
  const remaining = deadline.expiresAt - Date.now();
  if (remaining <= 0 || deadline.timedOut()) {
    deadline.abort(true);
    cancel?.();
    throw runtimeError("download_timeout");
  }
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        deadline.abort(true);
        try {
          cancel?.();
        } finally {
          reject(runtimeError("download_timeout"));
        }
      }, remaining);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  } catch (error) {
    if (error?.code === "download_timeout" || deadline.timedOut()) {
      throw runtimeError("download_timeout");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function requireTrustedCatalogHostname(sourceUrl, trustedCatalogHosts) {
  const hostname = new URL(sourceUrl).hostname.toLowerCase();
  if (
    !Array.isArray(trustedCatalogHosts) ||
    trustedCatalogHosts.length === 0 ||
    !trustedCatalogHosts.includes(hostname)
  ) {
    throw runtimeError("pinned_fetch_host_not_trusted");
  }
  return hostname;
}

async function openPinnedDownloadTransport(
  sourceUrl,
  validatedAddresses,
  options,
  deadline,
) {
  requireTrustedCatalogHostname(sourceUrl, options.trustedCatalogHosts);
  if (
    typeof options.fetchImplementation === "function" &&
    options.fetchImplementation.supportsAddressPinning === true
  ) {
    return openPinnedFetchTransport(
      sourceUrl,
      validatedAddresses,
      options,
      deadline,
    );
  }
  return openPinnedHttpsTransport(sourceUrl, validatedAddresses, deadline);
}

async function openPinnedFetchTransport(
  sourceUrl,
  validatedAddresses,
  options,
  deadline,
) {
  const hostname = requireTrustedCatalogHostname(
    sourceUrl,
    options.trustedCatalogHosts,
  );
  let response;
  const cancel = () => cancelResponse(response);
  try {
    response = await awaitWithinDownloadDeadline(
      options.fetchImplementation(sourceUrl, {
        method: "GET",
        redirect: "error",
        signal: deadline.controller.signal,
        headers: { Accept: "application/json, application/manifest+json" },
        pinResolvedAddress: true,
        validatedAddresses: [...validatedAddresses],
        expectedHostname: hostname,
      }),
      deadline,
      cancel,
    );
  } catch (error) {
    if (error?.code === "download_timeout") throw error;
    throw runtimeError("download_fetch_failed");
  }
  const remoteAddress = responseRemoteAddress(response);
  if (
    !remoteAddress ||
    !validatedAddresses.some((address) => ipAddressesEqual(address, remoteAddress))
  ) {
    cancelResponse(response);
    throw runtimeError("download_remote_address_unverified");
  }
  return { response, dispose: async () => undefined };
}

async function openPinnedHttpsTransport(sourceUrl, validatedAddresses, deadline) {
  let lastError;
  for (const address of validatedAddresses) {
    try {
      return await openSinglePinnedHttpsTransport(sourceUrl, address, deadline);
    } catch (error) {
      if (error?.code === "download_timeout") throw error;
      if (error?.code === "download_remote_address_unverified") throw error;
      lastError = error;
    }
  }
  if (lastError?.code) throw lastError;
  throw runtimeError("download_fetch_failed");
}

function openSinglePinnedHttpsTransport(sourceUrl, address, deadline) {
  const url = new URL(sourceUrl);
  const hostname = url.hostname;
  const family = isIP(address);
  return new Promise((resolve, reject) => {
    let response;
    let settled = false;
    let unregisterAborter = () => undefined;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      unregisterAborter();
      reject(error);
    };
    const request = https.request(
      {
        protocol: "https:",
        hostname,
        port: url.port || 443,
        method: "GET",
        path: url.pathname,
        agent: false,
        servername: hostname,
        headers: {
          Accept: "application/json, application/manifest+json",
          Host: url.host,
        },
        lookup: (requestedHostname, _lookupOptions, callback) => {
          if (String(requestedHostname).toLowerCase() !== hostname.toLowerCase()) {
            callback(runtimeError("download_hostname_binding_mismatch"));
            return;
          }
          callback(null, address, family);
        },
      },
      (incoming) => {
        response = incoming;
        const remoteAddress = responseRemoteAddress(incoming);
        if (!remoteAddress || !ipAddressesEqual(address, remoteAddress)) {
          incoming.destroy();
          fail(runtimeError("download_remote_address_unverified"));
          return;
        }
        if (settled) {
          incoming.destroy();
          return;
        }
        settled = true;
        resolve({
          response: incoming,
          dispose: async () => unregisterAborter(),
        });
      },
    );
    unregisterAborter = deadline.registerAborter(() => {
      request.destroy(runtimeError("download_timeout"));
      response?.destroy(runtimeError("download_timeout"));
    });
    request.once("error", (error) => {
      if (deadline.timedOut()) {
        fail(runtimeError("download_timeout"));
        return;
      }
      fail(runtimeError("download_fetch_failed"));
    });
    request.end();
  });
}

function responseStatus(response) {
  const status = Number(response?.status ?? response?.statusCode);
  return Number.isFinite(status) ? status : Number.NaN;
}

function responseHeader(response, name) {
  const normalizedName = String(name).toLowerCase();
  if (typeof response?.headers?.get === "function") {
    return response.headers.get(normalizedName) ?? "";
  }
  const value =
    response?.headers?.[normalizedName] ??
    response?.headers?.[name] ??
    "";
  return Array.isArray(value) ? value.join(",") : String(value ?? "");
}

function responseRemoteAddress(response) {
  return String(
    response?.remoteAddress ??
      response?.socket?.remoteAddress ??
      response?.connection?.remoteAddress ??
      "",
  );
}

function cancelResponse(response) {
  try {
    response?.destroy?.();
  } catch {
    // The deadline race still rejects even when the transport ignores cancel.
  }
  try {
    response?.body?.destroy?.();
  } catch {
    // Best effort.
  }
  try {
    const cancellation = response?.body?.cancel?.();
    cancellation?.catch?.(() => undefined);
  } catch {
    // Best effort.
  }
}

function assertAllowedContentType(response) {
  const contentType = responseHeader(response, "content-type")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!allowedJsonContentTypes.has(contentType)) {
    throw runtimeError("download_content_type_blocked");
  }
}

function assertContentLengthWithinLimit(response, maximumBytes) {
  const value = responseHeader(response, "content-length");
  if (!value) return;
  if (!/^\d+$/u.test(String(value))) {
    throw runtimeError("download_content_length_invalid");
  }
  if (Number(value) > maximumBytes) throw runtimeError("package_too_large");
}

async function readResponseBytes(response, maximumBytes, deadline) {
  const body = response?.body ?? response;
  const chunks = [];
  let length = 0;
  let completed = false;
  const cancel = () => cancelResponse(response);
  const append = (chunk) => {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > maximumBytes) {
      deadline.abort();
      cancel();
      throw runtimeError("package_too_large");
    }
    chunks.push(bytes);
  };
  try {
    if (body?.getReader) {
      const reader = body.getReader();
      try {
        while (true) {
          const next = await awaitWithinDownloadDeadline(
            reader.read(),
            deadline,
            () => {
              reader.cancel?.().catch?.(() => undefined);
              cancel();
            },
          );
          if (next.done) break;
          append(next.value);
        }
      } finally {
        try {
          reader.releaseLock?.();
        } catch {
          // Best effort.
        }
      }
    } else if (body && typeof body[Symbol.asyncIterator] === "function") {
      const iterator = body[Symbol.asyncIterator]();
      try {
        while (true) {
          const next = await awaitWithinDownloadDeadline(
            iterator.next(),
            deadline,
            cancel,
          );
          if (next.done) break;
          append(next.value);
        }
      } finally {
        try {
          await iterator.return?.();
        } catch {
          // Best effort.
        }
      }
    } else if (typeof response?.arrayBuffer === "function") {
      append(
        await awaitWithinDownloadDeadline(response.arrayBuffer(), deadline, cancel),
      );
    } else {
      throw runtimeError("download_body_unavailable");
    }
    completed = true;
  } catch (error) {
    if (error?.code === "download_timeout" || deadline.timedOut()) {
      throw runtimeError("download_timeout");
    }
    throw error;
  } finally {
    if (!completed) cancel();
  }
  if (!length) throw runtimeError("package_empty");
  return Buffer.concat(chunks, length);
}
function decodeUtf8Json(packageBytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(packageBytes);
    if (!text || text.charCodeAt(0) === 0xfeff) {
      throw runtimeError("package_encoding_invalid");
    }
    return text;
  } catch (error) {
    if (error?.code) throw error;
    throw runtimeError("package_encoding_invalid");
  }
}

function assertNoDuplicateJsonKeys(source) {
  let index = 0;
  const length = source.length;
  const skipWhitespace = () => {
    while (index < length && /[\u0009\u000a\u000d\u0020]/u.test(source[index])) {
      index += 1;
    }
  };
  const parseString = () => {
    if (source[index] !== "\"") throw runtimeError("package_json_invalid");
    const start = index;
    index += 1;
    while (index < length) {
      const code = source.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch {
          throw runtimeError("package_json_invalid");
        }
      }
      if (code < 0x20) throw runtimeError("package_json_invalid");
      if (code === 0x5c) {
        index += 1;
        const escape = source[index];
        if (!escape) throw runtimeError("package_json_invalid");
        if (escape === "u") {
          const digits = source.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) {
            throw runtimeError("package_json_invalid");
          }
          index += 5;
          continue;
        }
        if (!"\"\\/bfnrt".includes(escape)) {
          throw runtimeError("package_json_invalid");
        }
        index += 1;
        continue;
      }
      index += 1;
    }
    throw runtimeError("package_json_invalid");
  };
  const parseValue = (depth = 0) => {
    if (depth > 64) throw runtimeError("package_json_too_deep");
    skipWhitespace();
    const token = source[index];
    if (token === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (true) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw runtimeError("package_duplicate_json_key");
        keys.add(key);
        skipWhitespace();
        if (source[index] !== ":") throw runtimeError("package_json_invalid");
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") throw runtimeError("package_json_invalid");
        index += 1;
      }
    }
    if (token === "[") {
      index += 1;
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (true) {
        parseValue(depth + 1);
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") throw runtimeError("package_json_invalid");
        index += 1;
      }
    }
    if (token === "\"") {
      parseString();
      return;
    }
    if (source.startsWith("true", index)) {
      index += 4;
      return;
    }
    if (source.startsWith("false", index)) {
      index += 5;
      return;
    }
    if (source.startsWith("null", index)) {
      index += 4;
      return;
    }
    const number = source
      .slice(index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (number) {
      index += number[0].length;
      return;
    }
    throw runtimeError("package_json_invalid");
  };
  parseValue();
  skipWhitespace();
  if (index !== length) throw runtimeError("package_json_invalid");
}

function assertNoDangerousJsonKeys(value, seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw runtimeError("package_json_invalid");
  seen.add(value);
  if (!isPlainObject(value) && !Array.isArray(value)) {
    throw runtimeError("package_json_invalid");
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoDangerousJsonKeys(item, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw runtimeError("package_prototype_key_blocked");
    }
    assertNoDangerousJsonKeys(child, seen);
  }
}

function assertExactObjectKeys(value, allowedKeys, label) {
  assertPlainObject(value, label);
  const keys = Object.keys(value);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    throw runtimeError(label + "_field_not_allowed");
  }
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw runtimeError(label + "_invalid");
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function containsSecretMaterial(value, seen = new Set()) {
  if (typeof value === "string") return containsSecretText(value);
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretMaterial(item, seen));
  }
  return Object.entries(value).some(
    ([key, child]) =>
      /(?:password|secret|token|authorization|credential|private.?key|api.?key|access.?key|client.?key)/iu.test(
        key,
      ) || containsSecretMaterial(child, seen),
  );
}

function containsSecretText(value) {
  const text = String(value ?? "");
  return (
    /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/iu.test(text) ||
    /\bprivate\s+key\b/iu.test(text) ||
    /\bbearer\s+[A-Za-z0-9._~+/-]{16,}\b/iu.test(text) ||
    /\b(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|password)\s*[:=]/iu.test(
      text,
    ) ||
    /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/u.test(
      text,
    )
  );
}

function looksLikeExecutableOrHtml(instruction) {
  return (
    /[<>\x60]/u.test(instruction) ||
    /\b(?:https?|file|javascript|data):/iu.test(instruction) ||
    /^\s*(?:#!|(?:bash|sh|zsh|cmd|powershell|pwsh|node|python|curl|wget|npm|yarn|pnpm|deno)\b)/iu.test(
      instruction,
    ) ||
    /\b(?:require\s*\(|import\s+.+\s+from|function\s*\(|=>|child_process|process\.exec)\b/iu.test(
      instruction,
    )
  );
}

async function withRuntimeLock(paths, options, operation) {
  const release = await acquireRuntimeLock(paths, options);
  try {
    return await operation();
  } finally {
    await release();
  }
}

async function acquireRuntimeLock(paths, options) {
  const { io, lockWaitMilliseconds, lockStaleMilliseconds, lockHeartbeatMilliseconds } =
    options;
  await ensureSafeRuntimeFileTarget(paths, paths.lockPath, io, true);
  await ensureSafeRuntimeFileTarget(paths, paths.reclaimLockPath, io, true);
  const deadline = Date.now() + lockWaitMilliseconds;
  while (true) {
    let handle;
    const lockId = "workspace-skill-runtime-lock-" + randomUUID();
    const record = {
      schema: runtimeLockSchema,
      lockId,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
    try {
      handle = await io.open(paths.lockPath, "wx", 0o600);
      await writeRuntimeLockRecord(handle, record);
      return createRuntimeLockRelease(
        paths,
        io,
        handle,
        record,
        lockHeartbeatMilliseconds,
      );
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // Cleanup below is deliberately token-bound.
        }
        await removeOwnedRuntimeLock(paths, io, lockId);
      }
      if (error?.code !== "EEXIST") throw error;
      const reclaimed = await tryReclaimRuntimeLock(paths, options);
      if (reclaimed) continue;
      if (Date.now() >= deadline) throw runtimeError("runtime_lock_unavailable");
      await delay(lockRetryMilliseconds);
    }
  }
}

function createRuntimeLockRelease(
  paths,
  io,
  handle,
  record,
  heartbeatMilliseconds,
) {
  let released = false;
  let heartbeatWrite = Promise.resolve();
  const heartbeat = setInterval(() => {
    record.heartbeatAt = new Date().toISOString();
    heartbeatWrite = heartbeatWrite
      .then(() => writeRuntimeLockRecord(handle, record))
      .catch(() => undefined);
  }, heartbeatMilliseconds);
  heartbeat.unref?.();
  return async () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    await heartbeatWrite;
    try {
      await handle.close();
    } finally {
      await removeOwnedRuntimeLock(paths, io, record.lockId);
    }
  };
}

async function writeRuntimeLockRecord(handle, record) {
  const bytes = Buffer.from(JSON.stringify(record), "utf8");
  await handle.write(bytes, 0, bytes.length, 0);
  await handle.truncate(bytes.length);
  if (typeof handle.sync === "function") await handle.sync();
}

async function removeOwnedRuntimeLock(paths, io, lockId) {
  try {
    if (!(await ensureSafeRuntimeFileTarget(paths, paths.lockPath, io, false))) {
      return;
    }
    const current = await readRuntimeLockRecord(paths.lockPath, io);
    if (current?.lockId !== lockId) return;
    await io.unlink(paths.lockPath);
  } catch {
    // A failed token-bound cleanup stays fail-closed for subsequent reclaim.
  }
}

async function tryReclaimRuntimeLock(paths, options) {
  const reclaim = await acquireRuntimeReclaimLock(paths, options);
  if (!reclaim) return false;
  const { io, lockStaleMilliseconds } = options;
  try {
    if (!(await ensureSafeRuntimeFileTarget(paths, paths.lockPath, io, false))) {
      return false;
    }
    const lock = await readRuntimeLockRecord(paths.lockPath, io);
    if (!lock || !isReclaimableRuntimeLock(lock, lockStaleMilliseconds)) {
      return false;
    }
    const rechecked = await readRuntimeLockRecord(paths.lockPath, io);
    if (!rechecked || rechecked.lockId !== lock.lockId) return false;
    await io.unlink(paths.lockPath);
    return true;
  } finally {
    try {
      await reclaim.handle.close();
    } finally {
      await removeOwnedRuntimeReclaimLock(paths, reclaim.io, reclaim.record.reclaimId);
    }
  }
}

async function acquireRuntimeReclaimLock(paths, options) {
  const { io, lockStaleMilliseconds } = options;
  const create = async () => {
    const reclaimId = "workspace-skill-runtime-reclaim-" + randomUUID();
    const record = {
      schema: runtimeReclaimLockSchema,
      reclaimId,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    };
    const handle = await io.open(paths.reclaimLockPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(record), "utf8");
      if (typeof handle.sync === "function") await handle.sync();
      return { handle, record, io };
    } catch (error) {
      try {
        await handle.close();
      } finally {
        await removeOwnedRuntimeReclaimLock(paths, io, reclaimId);
      }
      throw error;
    }
  };
  try {
    return await create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const stale = await readRuntimeReclaimLockRecord(paths.reclaimLockPath, io);
  if (!stale || !isReclaimableRuntimeReclaimLock(stale, lockStaleMilliseconds)) {
    return undefined;
  }
  const rechecked = await readRuntimeReclaimLockRecord(paths.reclaimLockPath, io);
  if (!rechecked || rechecked.reclaimId !== stale.reclaimId) return undefined;
  try {
    await io.unlink(paths.reclaimLockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") return undefined;
  }
  try {
    return await create();
  } catch (error) {
    if (error?.code === "EEXIST") return undefined;
    throw error;
  }
}

async function removeOwnedRuntimeReclaimLock(paths, io, reclaimId) {
  try {
    if (!(await ensureSafeRuntimeFileTarget(paths, paths.reclaimLockPath, io, false))) {
      return;
    }
    const current = await readRuntimeReclaimLockRecord(paths.reclaimLockPath, io);
    if (current?.reclaimId !== reclaimId) return;
    await io.unlink(paths.reclaimLockPath);
  } catch {
    // Token-bound cleanup only.
  }
}

function isReclaimableRuntimeReclaimLock(lock, staleMilliseconds) {
  const acquiredAt = Date.parse(lock.acquiredAt);
  return (
    Number.isFinite(acquiredAt) &&
    Date.now() - acquiredAt >= staleMilliseconds &&
    isProcessDefinitelyAbsent(lock.pid)
  );
}

async function readRuntimeReclaimLockRecord(lockPath, io) {
  try {
    const raw = await io.readFile(lockPath, "utf8");
    if (raw.length > 8 * 1024) return undefined;
    assertNoDuplicateJsonKeys(raw);
    const parsed = JSON.parse(raw);
    assertNoDangerousJsonKeys(parsed);
    assertExactObjectKeys(
      parsed,
      ["schema", "reclaimId", "pid", "acquiredAt"],
      "runtime_reclaim_lock",
    );
    if (
      parsed.schema !== runtimeReclaimLockSchema ||
      !/^workspace-skill-runtime-reclaim-[0-9a-f-]{36}$/u.test(parsed.reclaimId) ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0
    ) {
      return undefined;
    }
    return {
      reclaimId: parsed.reclaimId,
      pid: parsed.pid,
      acquiredAt: normalizeIsoDate(parsed.acquiredAt),
    };
  } catch {
    return undefined;
  }
}
function isReclaimableRuntimeLock(lock, staleMilliseconds) {
  const heartbeatTime = Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(heartbeatTime)) return false;
  if (Date.now() - heartbeatTime < staleMilliseconds) return false;
  return isProcessDefinitelyAbsent(lock.pid);
}

function isProcessDefinitelyAbsent(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

async function readRuntimeLockRecord(lockPath, io) {
  try {
    const raw = await io.readFile(lockPath, "utf8");
    if (raw.length > 8 * 1024) return undefined;
    assertNoDuplicateJsonKeys(raw);
    const parsed = JSON.parse(raw);
    assertNoDangerousJsonKeys(parsed);
    assertExactObjectKeys(
      parsed,
      ["schema", "lockId", "pid", "acquiredAt", "heartbeatAt"],
      "runtime_lock",
    );
    if (
      parsed.schema !== runtimeLockSchema ||
      !/^workspace-skill-runtime-lock-[0-9a-f-]{36}$/u.test(parsed.lockId) ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0
    ) {
      return undefined;
    }
    return {
      lockId: parsed.lockId,
      pid: parsed.pid,
      acquiredAt: normalizeIsoDate(parsed.acquiredAt),
      heartbeatAt: normalizeIsoDate(parsed.heartbeatAt),
    };
  } catch {
    return undefined;
  }
}
function enqueueRuntime(key, operation) {
  const prior = runtimeQueues.get(key) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(operation);
  runtimeQueues.set(key, next);
  return next.finally(() => {
    if (runtimeQueues.get(key) === next) runtimeQueues.delete(key);
  });
}

function packagePathFor(paths, skillId, version, integritySha256) {
  const skillDirectory = resolveChildPath(paths.packagesRoot, requireSkillId(skillId));
  const versionDirectory = resolveChildPath(skillDirectory, requireVersion(version));
  return resolveChildPath(
    versionDirectory,
    requireSha256(integritySha256, "integrity_sha256") + ".json",
  );
}

function resolveChildPath(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, candidate);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw runtimeError("workspace_skill_path_boundary_violation");
  }
  return candidate;
}

function normalizePackageBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw runtimeError("package_bytes_missing");
}

function resolveFetchImplementation(options) {
  if (typeof options.fetch === "function") return options.fetch;
  if (typeof options.netFetch === "function") return options.netFetch;
  if (typeof options.net?.fetch === "function") return options.net.fetch.bind(options.net);
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  return undefined;
}

function resolveElectronUserDataPath(app) {
  try {
    return cleanPathCandidate(app?.getPath?.("userData"));
  } catch {
    return "";
  }
}

function cleanPathCandidate(value) {
  const candidate = String(value ?? "").trim();
  return candidate ? candidate : "";
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeIsoDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw runtimeError("invalid_timestamp");
  return date.toISOString();
}

function clampPositiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(number)));
}

function normalizeRelativePath(value) {
  return String(value).replaceAll("\\", "/");
}

async function pathExists(filePath, io) {
  try {
    await io.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function packageArtifactsExist(paths, io) {
  try {
    const entries = await io.readdir(paths.packagesRoot);
    return Array.isArray(entries) && entries.length > 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return true;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runtimeError(code) {
  const error = new Error(code);
  error.code = code;
  error.workspaceSkillRuntimeCode = code;
  return error;
}

const workspaceSkillCatalogFileName = "workspace-skill-catalog.v1.json";

async function loadVerifiedSkillCatalog(paths, options) {
  if (!hasConfiguredWorkspace(options)) {
    return createCatalogResult("workspace_skill_catalog_workspace_required", false, []);
  }
  const manifest = normalizeTrustedCatalogManifest(options.trustedCatalogManifest);
  if (!manifest) {
    return createCatalogResult("workspace_skill_catalog_unconfigured", false, []);
  }
  let catalog;
  let source = "";
  if (manifest.catalog) {
    catalog = manifest.catalog;
    source = "trusted_manifest";
  } else {
    if (!manifest.expectedSha256 && typeof options.verifyCatalogSignature !== "function") {
      return createCatalogResult("workspace_skill_catalog_unconfigured", false, []);
    }
    const catalogFile = await readVerifiedCatalogFile(paths, manifest, options);
    if (!catalogFile) {
      return createCatalogResult("workspace_skill_catalog_unavailable", false, []);
    }
    try {
      catalog = parseCatalogBytes(catalogFile.bytes);
      source = catalogFile.source;
    } catch {
      return createCatalogResult("workspace_skill_catalog_invalid", false, []);
    }
  }
  let candidates;
  try {
    candidates = normalizeCatalogDocument(catalog);
    for (const candidate of candidates) {
      requireTrustedCatalogHostname(
        candidate.sourceUrl,
        options.trustedCatalogHosts,
      );
      const packagedPackage = await readVerifiedPackagedSkillPackage(
        candidate,
        options,
      );
      if (!packagedPackage) {
        await assertTrustedCatalogUrl(candidate.sourceUrl, options.lookup);
      }
    }
  } catch {
    return createCatalogResult("workspace_skill_catalog_invalid", false, []);
  }
  return {
    ...createCatalogResult("workspace_skill_catalog_verified", true, candidates),
    source,
  };
}
function normalizeTrustedCatalogManifest(value) {
  if (!isPlainObject(value)) return undefined;
  try {
    assertNoDangerousJsonKeys(value);
  } catch {
    return undefined;
  }
  const expectedSha256 = optionalSha256(
    value.catalogSha256 ?? value.integritySha256 ?? value.sha256,
  );
  const catalog = isPlainObject(value.catalog)
    ? value.catalog
    : value.schema === "modycrew.workspace-skill-catalog.v1" &&
        Array.isArray(value.candidates)
      ? value
      : undefined;
  const location =
    value.location === "user_data" || value.location === "packaged"
      ? value.location
      : "either";
  if (!catalog && !expectedSha256 && typeof value.signature !== "string") {
    return undefined;
  }
  return { catalog, expectedSha256, location, signature: String(value.signature ?? "") };
}

async function readVerifiedCatalogFile(paths, manifest, options) {
  const candidates = [];
  if (manifest.location !== "packaged") {
    candidates.push({
      source: "user_data",
      filePath: resolveChildPath(paths.root, workspaceSkillCatalogFileName),
    });
  }
  if (manifest.location !== "user_data") {
    const packagedPath = resolvePackagedCatalogPath(options);
    if (packagedPath) candidates.push({ source: "packaged", filePath: packagedPath });
  }
  for (const candidate of candidates) {
    if (candidate.source === "user_data") {
      try {
        if (!(await ensureSafeRuntimeFileTarget(paths, candidate.filePath, options.io, false))) {
          continue;
        }
      } catch {
        return undefined;
      }
    }
    let bytes;
    try {
      bytes = Buffer.from(await options.io.readFile(candidate.filePath));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      return undefined;
    }
    if (bytes.length > maximumPackageBytesHardLimit) return undefined;
    const hashMatches =
      manifest.expectedSha256 && sha256(bytes) === manifest.expectedSha256;
    let signatureMatches = false;
    if (!hashMatches && typeof options.verifyCatalogSignature === "function") {
      try {
        signatureMatches =
          (await options.verifyCatalogSignature({
            catalogBytes: Buffer.from(bytes),
            signature: manifest.signature,
            source: candidate.source,
          })) === true;
      } catch {
        signatureMatches = false;
      }
    }
    if (hashMatches || signatureMatches) {
      return { bytes, source: candidate.source };
    }
  }
  return undefined;
}

function resolvePackagedCatalogPath(options) {
  const explicitPath = cleanPathCandidate(options.packagedCatalogPath);
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    return path.basename(resolved) === workspaceSkillCatalogFileName
      ? resolved
      : "";
  }
  const resourcesPath = cleanPathCandidate(options.resourcesPath);
  return resourcesPath
    ? path.resolve(resourcesPath, workspaceSkillCatalogFileName)
    : "";
}

function parseCatalogBytes(bytes) {
  const source = decodeUtf8Json(bytes);
  assertNoDuplicateJsonKeys(source);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw runtimeError("catalog_json_invalid");
  }
  assertNoDangerousJsonKeys(parsed);
  return parsed;
}

function normalizeCatalogDocument(value) {
  assertPlainObject(value, "catalog");
  assertExactObjectKeys(value, ["schema", "candidates"], "catalog");
  if (
    value.schema !== "modycrew.workspace-skill-catalog.v1" ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 100
  ) {
    throw runtimeError("catalog_invalid");
  }
  const ids = new Set();
  return value.candidates.map((candidate) => {
    const normalized = normalizeCatalogCandidate(candidate);
    const identity = normalized.skillId + "@" + normalized.version;
    if (ids.has(identity)) throw runtimeError("catalog_duplicate_candidate");
    ids.add(identity);
    return normalized;
  });
}

function normalizeCatalogCandidate(value) {
  assertPlainObject(value, "catalog_candidate");
  const allowedKeys = [
    "skillId",
    "title",
    "version",
    "publisher",
    "sourceUrl",
    "license",
    "integritySha256",
    "trust",
    "installMode",
    "supportedWorkPackIds",
    "requestedCapabilities",
    "requestedNetworkHosts",
    "requestedFolderScope",
  ];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw runtimeError("catalog_candidate_field_not_allowed");
  }
  const safeSkill = normalizeApprovedSkill(value);
  const trust =
    value.trust === "verified_catalog" || value.trust === "publisher_signed"
      ? value.trust
      : "";
  if (!trust) throw runtimeError("catalog_candidate_unverified");
  const title = cleanCatalogText(value.title, 160);
  const publisher = cleanCatalogText(value.publisher, 160);
  const license = cleanCatalogText(value.license, 120);
  if (!title || containsSecretText(title + " " + publisher + " " + license)) {
    throw runtimeError("catalog_candidate_invalid");
  }
  return {
    skillId: safeSkill.skillId,
    title,
    version: safeSkill.version,
    publisher,
    sourceUrl: safeSkill.sourceUrl,
    license,
    integritySha256: safeSkill.integritySha256,
    trust,
    installMode: safeSkill.installMode,
    supportedWorkPackIds: safeSkill.supportedWorkPackIds,
    requestedCapabilities: safeSkill.requestedCapabilities,
    requestedNetworkHosts: safeSkill.requestedNetworkHosts,
    requestedFolderScope: safeSkill.requestedFolderScope,
  };
}

function cleanCatalogText(value, maximumLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength);
}

function optionalSha256(value) {
  const hash = String(value ?? "").toLowerCase();
  return /^[a-f0-9]{64}$/u.test(hash) ? hash : "";
}

function createCatalogResult(status, verified, candidates) {
  return {
    status,
    verified,
    candidates: Array.isArray(candidates) ? candidates : [],
    candidateCount: Array.isArray(candidates) ? candidates.length : 0,
  };
}

async function ensureSafeRuntimeFileTarget(paths, filePath, io, create) {
  const userDataPath = path.resolve(paths.userDataPath);
  const runtimeRoot = path.resolve(paths.root);
  const targetPath = path.resolve(filePath);
  if (
    !isLexicallyInside(userDataPath, runtimeRoot) ||
    !isLexicallyInside(runtimeRoot, targetPath)
  ) {
    throw runtimeError("workspace_skill_path_boundary_violation");
  }
  const userDataExists = await ensureSafeRuntimeDirectory(
    userDataPath,
    io,
    create,
  );
  if (!userDataExists) return false;
  const canonicalUserDataPath = await io.realpath(userDataPath);
  const directoryPath = path.dirname(targetPath);
  const relativeDirectory = path.relative(userDataPath, directoryPath);
  if (relativeDirectory === ".." || relativeDirectory.startsWith(".." + path.sep)) {
    throw runtimeError("workspace_skill_path_boundary_violation");
  }
  let currentPath = userDataPath;
  const segments = relativeDirectory ? relativeDirectory.split(path.sep) : [];
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw runtimeError("workspace_skill_path_boundary_violation");
    }
    currentPath = path.join(currentPath, segment);
    const exists = await ensureSafeRuntimeDirectory(currentPath, io, create);
    if (!exists) return false;
    const canonicalCurrentPath = await io.realpath(currentPath);
    if (!isLexicallyInside(canonicalUserDataPath, canonicalCurrentPath)) {
      throw runtimeError("workspace_skill_reparse_point_blocked");
    }
  }
  let targetStats;
  try {
    targetStats = await io.lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (isReparseOrLink(targetStats) || !targetStats.isFile()) {
    throw runtimeError("workspace_skill_reparse_point_blocked");
  }
  const canonicalTargetPath = await io.realpath(targetPath);
  if (!isLexicallyInside(canonicalUserDataPath, canonicalTargetPath)) {
    throw runtimeError("workspace_skill_reparse_point_blocked");
  }
  return true;
}

async function ensureSafeRuntimeDirectory(directoryPath, io, create) {
  let stats;
  try {
    stats = await io.lstat(directoryPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!create) return false;
    await io.mkdir(directoryPath, { recursive: true });
    stats = await io.lstat(directoryPath);
  }
  if (isReparseOrLink(stats) || !stats.isDirectory()) {
    throw runtimeError("workspace_skill_reparse_point_blocked");
  }
  return true;
}

function isReparseOrLink(stats) {
  return Boolean(stats?.isSymbolicLink?.());
}

function isLexicallyInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function hasConfiguredWorkspace(options) {
  return Boolean(options?.configuredWorkspaceId);
}

function requireConfiguredWorkspace(options) {
  if (!hasConfiguredWorkspace(options)) {
    throw runtimeError("workspace_id_required");
  }
  return options.configuredWorkspaceId;
}

function createPromptWorkspaceRequiredResult() {
  return {
    verified: false,
    status: "workspace_required",
    active: false,
    targetAgentId: "",
    instructions: [],
    truncated: false,
  };
}

function normalizeTrustedCatalogHosts(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 40) {
    throw runtimeError("invalid_trusted_catalog_hosts");
  }
  const hosts = value.map((host) => normalizePublicHostname(host));
  if (new Set(hosts).size !== hosts.length) {
    throw runtimeError("invalid_trusted_catalog_hosts");
  }
  return [...hosts].sort();
}
