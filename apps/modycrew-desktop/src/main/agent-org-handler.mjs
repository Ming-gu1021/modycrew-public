/**
 * 에이전트 조직 ledger 핸들러 — memory/agents/* 4종 파일의 단일 기록자.
 *
 * 원칙:
 *  - 여기는 저장/불러오기만 한다. 조직·제안의 상태 전이 판단은 packages/domain 순수 함수 몫.
 *  - 스펙 버전 파일은 append-only 를 저장 계층에서도 강제한다: 기존에 저장된
 *    (teammateId, specVersion) 레코드가 하나라도 사라지는 저장 요청은 거부한다.
 *  - 루트 해석은 로컬 기억 핸들러의 status 를 그대로 재사용한다(경로 규칙 단일화).
 *  - 기록 실패는 흐름을 차단하지 않되 상태로 구분해 반환한다.
 */
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { handleLocalMemoryMessage } from "./local-memory-handler.mjs";

const agentOrgDirRelativePath = path.join("memory", "agents");
const blueprintRelativePath = path.join("memory", "agents", "agent-org-blueprint.json");
const blueprintSummaryRelativePath = path.join("memory", "agents", "AgentOrgBlueprint.md");
const specVersionsRelativePath = path.join("memory", "agents", "agent-spec-versions.json");
const proposalsRelativePath = path.join("memory", "agents", "agent-proposals.json");
const performanceLedgerRelativePath = path.join("memory", "agents", "agent-performance-ledger.json");

const proposalLedgerCap = 200;
const profileCapabilityTagsByTemplate = Object.freeze({
  operations: ["문의", "일정", "회의", "보고서", "문서", "재고", "발주", "업무"],
  mail: ["메일", "답장", "받은편지함", "문의", "일정"],
  desktop: ["폴더", "파일", "문서", "정리", "다운로드", "컴퓨터"],
  finance: ["세금", "세금계산서", "부가세", "정산", "회계", "재무", "청구", "비용"],
  legal: ["계약", "법무", "약관", "컴플라이언스", "공공기관"],
  marketing: ["마케팅", "홍보", "콘텐츠", "캠페인", "전환", "고객"],
  development: ["개발", "버그", "배포", "기술", "제품", "코드"],
});

let domainRuntimePromise;

export async function handleAgentOrgMessage(_event, payload = {}, options = {}) {
  try {
    const kind = String(payload.kind ?? "");
    if (kind === "load_org") return await loadAgentOrg(options);
    if (kind === "sync_profile_team") return await syncAgentOrgFromLocalProfile(options);
    if (kind === "save_org") return await saveAgentOrg(payload, options);
    if (kind === "route_work_request") return await routeAgentOrgWork(payload, options);
    if (kind === "record_performance") return await recordAgentOrgPerformance(payload, options);
    return {
      status: "unsupported_action",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "지원하지 않는 에이전트 조직 요청입니다.",
    };
  } catch (error) {
    return {
      status: "agent_org_failed",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "에이전트 조직 처리 중 오류가 발생했습니다.",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveAgentOrgRoot(options = {}) {
  const status = await handleLocalMemoryMessage(null, { kind: "status" }, options);
  const root = typeof status?.root === "string" && status.root.trim() ? status.root : "";
  if (!root) throw new Error("로컬 기억 저장 위치를 확인할 수 없습니다.");
  mkdirSync(path.join(root, agentOrgDirRelativePath), { recursive: true });
  return root;
}

function resolveResourcePath(...segments) {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, ...segments);
    if (existsSync(packaged)) return packaged;
  }
  return null;
}

async function loadDomainRuntime(options = {}) {
  if (!domainRuntimePromise) {
    // 패키징 설치본에서는 domain dist 가 resources/domain/ 에 실리므로(형제 핸들러 규약)
    // repoRoot 경로가 없으면 그쪽을 먼저 찾는다.
    const repoEntryPath = path.join(
      options.repoRoot ?? process.cwd(),
      "packages",
      "domain",
      "dist",
      "index.js",
    );
    const domainEntryPath =
      options.domainEntryPath ??
      (existsSync(repoEntryPath) ? repoEntryPath : resolveResourcePath("domain", "index.js") ?? repoEntryPath);
    domainRuntimePromise = import(pathToFileURL(domainEntryPath).href);
    // 실패한 import 프로미스를 캐시에 남기면 재시작 전까지 성과 기록이 전부 실패한다.
    domainRuntimePromise.catch(() => {
      domainRuntimePromise = undefined;
    });
  }
  return domainRuntimePromise;
}

async function loadAgentOrg(options = {}) {
  const root = await resolveAgentOrgRoot(options);
  const blueprintPath = path.join(root, blueprintRelativePath);
  const specVersionsPath = path.join(root, specVersionsRelativePath);
  const proposalsPath = path.join(root, proposalsRelativePath);
  const performancePath = path.join(root, performanceLedgerRelativePath);
  const blueprint = sanitizeAgentOrgBlueprint(readJsonObject(blueprintPath));
  const specVersions = sanitizeAgentSpecVersions(readJsonArray(specVersionsPath));
  const proposals = sanitizeAgentProposals(readJsonArray(proposalsPath));
  const performanceRecords = sanitizePerformanceRecords(readJsonArray(performancePath));
  return {
    status: "agent_org_loaded",
    root,
    blueprintPath,
    specVersionsPath,
    proposalsPath,
    performanceLedgerPath: performancePath,
    blueprint,
    specVersions,
    proposals,
    performanceRecords,
    memberCount: blueprint?.members?.length ?? 0,
    specVersionCount: specVersions.length,
    proposalCount: proposals.length,
    performanceCount: performanceRecords.length,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage: blueprint
      ? `에이전트 조직(직원 ${blueprint.members.length}명, 스펙 ${specVersions.length}건)을 불러왔습니다.`
      : "아직 만들어진 에이전트 조직이 없습니다.",
  };
}

async function routeAgentOrgWork(payload = {}, options = {}) {
  const root = await resolveAgentOrgRoot(options);
  let blueprint = sanitizeAgentOrgBlueprint(readJsonObject(path.join(root, blueprintRelativePath)));
  let profileSync;
  if (!blueprint) {
    profileSync = await syncAgentOrgFromLocalProfile(options);
    blueprint = profileSync.blueprint ?? null;
  }
  const performanceRecords = sanitizePerformanceRecords(
    readJsonArray(path.join(root, performanceLedgerRelativePath)),
  );
  const allowedTeammateIds = Array.isArray(payload.allowedTeammateIds)
    ? new Set(
      payload.allowedTeammateIds
        .map(sanitizeAgentOrgProfileId)
        .filter(Boolean),
    )
    : null;
  const routingBlueprint = allowedTeammateIds
    ? {
      ...blueprint,
      members: blueprint.members.filter((member) => allowedTeammateIds.has(member.teammateId)),
    }
    : blueprint;
  const requestText = sanitizeLine(payload.requestText || payload.text, 500);
  if (!blueprint) {
    return {
      status: "agent_org_route_not_ready",
      root,
      routing: null,
      ...(profileSync ? { profileSync } : {}),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "역할을 나눌 AI 팀 구성이 아직 없습니다. 메인 컨트롤이 먼저 처리합니다.",
    };
  }
  if (!requestText) {
    return {
      status: "agent_org_route_request_required",
      root,
      routing: null,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "역할을 정할 업무 요청이 필요합니다.",
    };
  }
  const domain = await loadDomainRuntime(options);
  const routing = domain.routeWorkRequest({ requestText, blueprint: routingBlueprint, performanceRecords });
  const capabilityGap = domain.buildCapabilityGapReport({ requestText, blueprint: routingBlueprint, performanceRecords });
  return {
    status: "agent_org_work_routed",
    root,
    routing,
    capabilityGap,
    autoAgentProposalRequired: capabilityGap.recommendation === "propose_new_agent",
    routingMemberCount: routingBlueprint.members.length,
    ...(profileSync ? { profileSync } : {}),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage: routing.primary
      ? `${routing.primary.roleTitle}에게 근거를 확인해 업무를 배치했습니다.`
      : "맞는 담당자가 없어 메인 컨트롤이 먼저 처리합니다.",
  };
}

async function syncAgentOrgFromLocalProfile(options = {}) {
  const root = await resolveAgentOrgRoot(options);
  const loadedProfile = await handleLocalMemoryMessage(
    null,
    { kind: "load_app_profile" },
    options,
  );
  const profile = loadedProfile?.profile;
  if (!profile || typeof profile !== "object") {
    return profileSyncResult("agent_org_profile_sync_not_ready", root, null, [], [], "저장된 AI 팀 설정이 없어 조직 장부를 만들지 않았습니다.");
  }
  const masterTeammateId = sanitizeAgentOrgProfileId(profile.appSettings?.mainControllerId) || "teammate-personal-operator";
  const storedBlueprint = sanitizeAgentOrgBlueprint(readJsonObject(path.join(root, blueprintRelativePath)));
  if (storedBlueprint && storedBlueprint.masterTeammateId !== masterTeammateId) {
    return profileSyncResult("agent_org_profile_sync_master_mismatch", root, storedBlueprint, [], [], "기존 마스터와 저장된 팀 설정이 달라 자동으로 조직을 바꾸지 않았습니다.");
  }
  const domain = await loadDomainRuntime(options);
  let blueprint = storedBlueprint ?? domain.createAgentOrgBlueprint({ masterTeammateId });
  let specVersions = sanitizeAgentSpecVersions(readJsonArray(path.join(root, specVersionsRelativePath)));
  const existingMemberIds = new Set(blueprint.members.map((member) => member.teammateId));
  const activeSpecTeammateIds = new Set(
    specVersions
      .filter((version) => version.versionStatus === "active")
      .map((version) => version.teammateId),
  );
  const candidates = (Array.isArray(profile.teammates) ? profile.teammates : [])
    .map((teammate) => toProfileOrganizationCandidate(teammate, masterTeammateId, domain))
    .filter(Boolean)
    .filter(
      (candidate) =>
        !existingMemberIds.has(candidate.teammateId) ||
        !activeSpecTeammateIds.has(candidate.teammateId),
    );
  if (!candidates.length) {
    return profileSyncResult(
      "agent_org_profile_synced",
      root,
      blueprint,
      [],
      [],
      "저장된 AI 팀과 조직 장부가 이미 맞춰져 있습니다.",
    );
  }
  const createdMemberIds = [];
  const appendedSpecVersionKeys = [];
  for (const candidate of candidates) {
    const createdAt = new Date(candidate.createdAt).toISOString();
    if (!existingMemberIds.has(candidate.teammateId)) {
      blueprint = domain.addAgentOrgMember(blueprint, {
        teammateId: candidate.teammateId,
        roleTitle: candidate.roleTitle,
        capabilityTags: candidate.capabilityTags,
        joinedAt: createdAt,
      });
      existingMemberIds.add(candidate.teammateId);
      createdMemberIds.push(candidate.teammateId);
    }
    if (!activeSpecTeammateIds.has(candidate.teammateId)) {
      const appended = domain.appendAgentSpecVersion({
        versions: specVersions,
        teammateId: candidate.teammateId,
        fields: candidate.specFields,
        sourceProposalId: candidate.originProposalId || null,
        createdAt,
      });
      specVersions = appended.versions;
      activeSpecTeammateIds.add(candidate.teammateId);
      appendedSpecVersionKeys.push(`${candidate.teammateId}@v${appended.appended.specVersion}`);
    }
  }  const saved = await saveAgentOrg({ blueprint, specVersions }, options);
  if (saved.status !== "agent_org_saved") {
    return profileSyncResult("agent_org_profile_sync_write_failed", root, storedBlueprint, [], [], "AI 팀 설정은 저장됐지만 조직 장부 반영은 다시 시도해야 합니다.");
  }
return profileSyncResult(
    "agent_org_profile_synced",
    root,
    blueprint,
    createdMemberIds,
    appendedSpecVersionKeys,
    `저장된 AI 팀 ${createdMemberIds.length}명과 역할 스펙 ${appendedSpecVersionKeys.length}건을 장부에 반영했습니다.`,
  );
}

function toProfileOrganizationCandidate(value, masterTeammateId, domain) {
  if (!value || typeof value !== "object") return null;
  const teammateId = sanitizeAgentOrgProfileId(value.id);
  if (!teammateId || teammateId === masterTeammateId) return null;
  const templateId = sanitizeLine(value.templateId, 60).toLocaleLowerCase("en-US");
  const evidence = [
    value.roleTitle,
    value.name,
    value.teamLabel,
    value.brief,
    value.channelName,
    ...(Array.isArray(value.instructions) ? value.instructions : []),
  ]
    .map((item) => sanitizeLine(item, 300))
    .filter(Boolean)
    .join(" ");
  const capabilityTags = [...new Set([
    ...(profileCapabilityTagsByTemplate[templateId] ?? []),
    ...(typeof domain.extractWorkKeywords === "function" ? domain.extractWorkKeywords(evidence) : []),
  ])].slice(0, 16);
  if (!capabilityTags.length) return null;
  const specFields = {
    name: sanitizeLine(value.name, 60),
    roleTitle: sanitizeLine(value.roleTitle, 120) || "AI 직원",
    brief: sanitizeLine(value.brief, 300),
    channelName: sanitizeLine(value.channelName, 120),
    skillIds: Array.isArray(value.skillIds)
      ? value.skillIds.map((item) => sanitizeLine(item, 80)).filter(Boolean).slice(0, 16)
      : [],
    instructions: Array.isArray(value.instructions)
      ? value.instructions.map((item) => sanitizeLine(item, 220)).filter(Boolean).slice(0, 8)
      : [],
    capabilityTags,
  };
  const recordedAt = Number(value.createdAt);
  return {
    teammateId,
    roleTitle: specFields.roleTitle,
    capabilityTags,
    specFields,
    originProposalId: sanitizeAgentOrgProfileId(value.originProposalId),
    createdAt: Number.isFinite(recordedAt) && recordedAt > 0 ? recordedAt : Date.now(),
  };
}

function sanitizeAgentOrgProfileId(value) {
  const id = sanitizeLine(value, 120);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id) ? id : "";
}

function profileSyncResult(status, root, blueprint, createdMemberIds, appendedSpecVersionKeys, userMessage) {
  return {
    status,
    root,
    blueprint,
    createdMemberIds,
    appendedSpecVersionKeys,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage,
  };
}
async function saveAgentOrg(payload = {}, options = {}) {
  const root = await resolveAgentOrgRoot(options);

  // 1단계: 모든 섹션을 먼저 검증한다(디스크 쓰기 없음) — 한 섹션이 거부될 때
  // 다른 섹션이 이미 기록된 "부분 저장" 상태를 만들지 않기 위해서다.
  const writes = [];

  if (payload.blueprint !== undefined) {
    const blueprint = sanitizeAgentOrgBlueprint(payload.blueprint);
    if (!blueprint) {
      return invalidSaveResult("blueprint", "조직 구조 형식이 올바르지 않아 저장하지 않았습니다.");
    }
    writes.push({
      section: "blueprint",
      run: () => {
        atomicWriteJson(path.join(root, blueprintRelativePath), blueprint);
        writeBlueprintSummary(root, blueprint);
      },
    });
  }

  if (payload.specVersions !== undefined) {
    const specVersionsPath = path.join(root, specVersionsRelativePath);
    const existingRaw = readJsonArrayStrict(specVersionsPath);
    if (existingRaw === null) {
      // 파일이 존재하는데 읽을 수 없으면(손상/초과 크기) 빈 배열로 오판해
      // 히스토리를 덮어쓰지 않도록 저장 자체를 거부한다.
      return {
        status: "agent_org_spec_versions_source_unreadable",
        specVersionsPath,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        userMessage: "저장된 스펙 버전 파일을 읽을 수 없어 덮어쓰지 않았습니다. 파일 상태를 확인해 주세요.",
      };
    }
    const next = sanitizeAgentSpecVersions(payload.specVersions);
    const existing = sanitizeAgentSpecVersions(existingRaw);
    // append-only 강제 1: 저장돼 있던 (teammateId, specVersion) 쌍이 사라지면 거부.
    const nextByKey = new Map(next.map((version) => [`${version.teammateId}@${version.specVersion}`, version]));
    const missing = existing.filter(
      (version) => !nextByKey.has(`${version.teammateId}@${version.specVersion}`),
    );
    if (missing.length > 0) {
      return {
        status: "agent_org_spec_versions_append_only_violation",
        missingKeys: missing.map((version) => `${version.teammateId}@v${version.specVersion}`),
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        userMessage: "직원 스펙 버전 기록은 삭제할 수 없어 저장하지 않았습니다.",
      };
    }
    // append-only 강제 2: 남아 있는 레코드도 내용은 불변이어야 한다.
    // 상태 전이(versionStatus)만 허용하고, 그 외 필드가 바뀌면 개서로 보고 거부한다.
    const stripStatus = ({ versionStatus, ...rest }) => JSON.stringify(rest);
    const tampered = existing.filter((version) => {
      const candidate = nextByKey.get(`${version.teammateId}@${version.specVersion}`);
      return candidate ? stripStatus(candidate) !== stripStatus(version) : false;
    });
    if (tampered.length > 0) {
      return {
        status: "agent_org_spec_versions_immutable_violation",
        tamperedKeys: tampered.map((version) => `${version.teammateId}@v${version.specVersion}`),
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        userMessage: "과거 스펙 버전 내용은 수정할 수 없어 저장하지 않았습니다(상태 전이만 허용).",
      };
    }
    writes.push({
      section: "specVersions",
      run: () => atomicWriteJson(specVersionsPath, next),
    });
  }

  if (payload.proposals !== undefined) {
    const proposals = sanitizeAgentProposals(payload.proposals);
    writes.push({
      section: "proposals",
      run: () => atomicWriteJson(path.join(root, proposalsRelativePath), proposals),
    });
  }

  if (writes.length === 0) {
    return invalidSaveResult("none", "저장할 조직 데이터가 없습니다.");
  }

  // 2단계: 전 섹션 검증 통과 후에만 실제 기록.
  const saved = [];
  for (const write of writes) {
    write.run();
    saved.push(write.section);
  }

  return {
    status: "agent_org_saved",
    root,
    saved,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage: `에이전트 조직 데이터(${saved.join(", ")})를 저장했습니다.`,
  };
}

async function recordAgentOrgPerformance(payload = {}, options = {}) {
  const root = await resolveAgentOrgRoot(options);
  const performancePath = path.join(root, performanceLedgerRelativePath);
  const domain = await loadDomainRuntime(options);
  const ledger = sanitizePerformanceRecords(readJsonArray(performancePath));
  const sourceDecisionId = sanitizeLine(payload.record?.sourceThreadId, 120);
  if (
    /^delegation-decision:[a-f0-9]{64}$/u.test(sourceDecisionId) &&
    ledger.some((record) => record.sourceThreadId === sourceDecisionId)
  ) {
    const improvementProposal = createAgentOrganizationImprovementProposal(
      root,
      domain,
      ledger,
      payload.record?.teammateId,
    );
    return {
      status: "agent_org_performance_already_recorded",
      performanceLedgerPath: performancePath,
      performanceCount: ledger.length,
      improvementProposal,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "이 최종 승인 결과의 직원 성과는 이미 기록했습니다.",
    };
  }
  let nextLedger;
  try {
    nextLedger = domain.recordAgentPerformance({ ledger, record: payload.record ?? {} });
  } catch (error) {
    return {
      status: "agent_org_performance_record_invalid",
      performanceLedgerPath: performancePath,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "성과 기록 형식이 올바르지 않아 저장하지 않았습니다.",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    atomicWriteJson(performancePath, nextLedger);
  } catch (error) {
    // 기록 실패는 사용자 흐름을 막지 않되 상태로 구분한다.
    return {
      status: "agent_org_performance_record_write_failed",
      performanceLedgerPath: performancePath,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "성과 기록 저장에 실패했습니다. 다음 기록 때 다시 시도합니다.",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  const improvementProposal = createAgentOrganizationImprovementProposal(
    root,
    domain,
    nextLedger,
    payload.record?.teammateId,
  );
  return {
    status: "agent_org_performance_recorded",
    performanceLedgerPath: performancePath,
    performanceCount: nextLedger.length,
    improvementProposal,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage: "직원 성과 기록을 저장했습니다.",
  };
}

function createAgentOrganizationImprovementProposal(root, domain, ledger, teammateId) {
  const targetTeammateId = sanitizeAgentOrgProfileId(teammateId);
  if (!targetTeammateId) {
    return { status: "agent_org_improvement_not_applicable", externalMutation: false };
  }
  const blueprint = sanitizeAgentOrgBlueprint(readJsonObject(path.join(root, blueprintRelativePath)));
  const targetMember = blueprint?.members.find(
    (member) => member.teammateId === targetTeammateId && member.memberStatus !== "retired",
  );
  if (!targetMember) {
    return { status: "agent_org_improvement_not_applicable", externalMutation: false };
  }
  const versions = sanitizeAgentSpecVersions(readJsonArray(path.join(root, specVersionsRelativePath)));
  const activeSpec = domain.findActiveAgentSpecVersion?.(versions, targetTeammateId);
  if (!activeSpec || activeSpec.specVersion !== targetMember.activeSpecVersion) {
    return { status: "agent_org_improvement_spec_not_ready", externalMutation: false };
  }
  const performanceSummary = domain.summarizeAgentPerformance?.(ledger, targetTeammateId);
  const trigger = domain.shouldProposeAgentImprovement?.(performanceSummary);
  if (!performanceSummary || !trigger?.shouldPropose) {
    return {
      status: "agent_org_improvement_not_needed",
      performanceSummary,
      reason: trigger?.reason ?? "성과 근거가 아직 충분하지 않습니다.",
      externalMutation: false,
    };
  }
  const proposalPath = path.join(root, proposalsRelativePath);
  const proposals = sanitizeAgentProposals(readJsonArray(proposalPath));
  const existing = proposals.find(
    (proposal) =>
      proposal.kind === "improve_agent" &&
      proposal.targetTeammateId === targetTeammateId &&
      proposal.baseSpecVersion === activeSpec.specVersion &&
      ["proposed", "held"].includes(proposal.proposalStatus),
  );
  if (existing) {
    return {
      status: "agent_org_improvement_already_proposed",
      proposalId: existing.proposalId,
      performanceSummary,
      externalMutation: false,
    };
  }
  const failedTaskLabels = performanceSummary.recentFailedTaskKinds.length
    ? performanceSummary.recentFailedTaskKinds.join(", ")
    : "최근 실패 업무";
  const correctiveInstruction = `${failedTaskLabels} 업무는 근거를 다시 확인하고, 불확실한 내용은 승인 후보로 분리합니다.`;
  const instructions = [
    ...(activeSpec.instructions ?? []).filter((line) => line !== correctiveInstruction).slice(0, 7),
    correctiveInstruction,
  ];
  let proposal;
  try {
    proposal = domain.createAgentImprovementProposal({
      targetTeammateId,
      baseSpecVersion: activeSpec.specVersion,
      performanceSummary,
      draftSpec: {
        name: activeSpec.name,
        roleTitle: activeSpec.roleTitle,
        brief: activeSpec.brief,
        channelName: activeSpec.channelName,
        skillIds: activeSpec.skillIds,
        instructions,
        capabilityTags: activeSpec.capabilityTags,
      },
      affectedAutomationIds: [],
    });
    atomicWriteJson(proposalPath, [...proposals, proposal].slice(-proposalLedgerCap));
  } catch {
    return {
      status: "agent_org_improvement_proposal_write_failed",
      performanceSummary,
      externalMutation: false,
    };
  }
  return {
    status: "agent_org_improvement_proposed",
    proposalId: proposal.proposalId,
    performanceSummary,
    externalMutation: false,
  };
}

function invalidSaveResult(field, userMessage) {
  return {
    status: "agent_org_save_invalid",
    invalidField: field,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage,
  };
}

function writeBlueprintSummary(root, blueprint) {
  const lines = [
    "# AI 에이전트 조직",
    "",
    `- 마스터: ${blueprint.masterTeammateId}`,
    `- 직원 수: ${blueprint.members.length}명`,
    `- 갱신: ${blueprint.updatedAt}`,
    "",
    ...blueprint.members.map(
      (member) =>
        `- ${member.roleTitle} (${member.teammateId}) · 상태 ${member.memberStatus} · 스펙 v${member.activeSpecVersion} · 담당: ${member.capabilityTags.join(", ") || "(없음)"}`,
    ),
    "",
    "모든 채용·개선·퇴사는 오피스 승인함 승인 후에만 적용됩니다.",
    "",
  ];
  writeFileSync(path.join(root, blueprintSummaryRelativePath), lines.join("\n"), "utf8");
}

function sanitizeLine(value, maxLength) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function sanitizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sanitizeLine(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function sanitizeAgentOrgBlueprint(value) {
  if (!value || typeof value !== "object") return null;
  if (value.contract !== "agent_org_blueprint_v1") return null;
  const masterTeammateId = sanitizeLine(value.masterTeammateId, 120);
  if (!masterTeammateId) return null;
  const members = (Array.isArray(value.members) ? value.members : [])
    .map((member) => sanitizeAgentOrgMember(member, masterTeammateId))
    .filter(Boolean)
    .slice(0, 50);
  return {
    contract: "agent_org_blueprint_v1",
    version: Math.max(1, Math.floor(Number(value.version) || 1)),
    updatedAt: sanitizeLine(value.updatedAt, 40) || new Date().toISOString(),
    masterTeammateId,
    members,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeAgentOrgMember(value, masterTeammateId) {
  if (!value || typeof value !== "object") return null;
  const teammateId = sanitizeLine(value.teammateId, 120);
  if (!teammateId || teammateId === masterTeammateId) return null;
  const memberStatus = ["active", "probation", "retired"].includes(value.memberStatus)
    ? value.memberStatus
    : "probation";
  return {
    teammateId,
    // 마스터 1층 + 직원 1층 고정 — 저장 계층에서도 부모를 마스터로 강제한다.
    parentTeammateId: masterTeammateId,
    roleTitle: sanitizeLine(value.roleTitle, 48) || "AI 직원",
    capabilityTags: sanitizeStringArray(value.capabilityTags, 16, 24),
    activeSpecVersion: Math.max(1, Math.floor(Number(value.activeSpecVersion) || 1)),
    memberStatus,
    joinedAt: sanitizeLine(value.joinedAt, 40) || new Date().toISOString(),
    ...(value.retiredAt ? { retiredAt: sanitizeLine(value.retiredAt, 40) } : {}),
  };
}

function sanitizeAgentSpecVersions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((record) => {
      if (!record || typeof record !== "object") return null;
      if (record.contract !== "agent_spec_version_v1") return null;
      const teammateId = sanitizeLine(record.teammateId, 120);
      const specVersion = Math.floor(Number(record.specVersion) || 0);
      if (!teammateId || specVersion < 1) return null;
      return {
        contract: "agent_spec_version_v1",
        teammateId,
        specVersion,
        name: sanitizeLine(record.name, 32),
        roleTitle: sanitizeLine(record.roleTitle, 48),
        brief: sanitizeLine(record.brief, 180),
        channelName: sanitizeLine(record.channelName, 42),
        skillIds: sanitizeStringArray(record.skillIds, 16, 60),
        instructions: sanitizeStringArray(record.instructions, 8, 160),
        capabilityTags: sanitizeStringArray(record.capabilityTags, 16, 24),
        sourceProposalId: record.sourceProposalId ? sanitizeLine(record.sourceProposalId, 120) : null,
        createdAt: sanitizeLine(record.createdAt, 40) || new Date().toISOString(),
        versionStatus: ["active", "superseded", "rolled_back"].includes(record.versionStatus)
          ? record.versionStatus
          : "superseded",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    })
    .filter(Boolean);
  // append-only 원장에는 개수 캡을 두지 않는다 — 캡을 두면 "가장 오래된 것 유지"는
  // 새 버전을 조용히 유실시키고, "가장 새것 유지"는 append-only 가드와 모순된다.
  // 크기 방어는 20MB 읽기 캡 + 건당 필드 클램프가 담당한다.
}

function sanitizeAgentProposals(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((record) => {
      if (!record || typeof record !== "object") return null;
      if (record.contract !== "agent_spec_proposal_v1") return null;
      const proposalId = sanitizeLine(record.proposalId, 120);
      const kind = ["create_agent", "improve_agent", "retire_agent", "delegation_plan"].includes(record.kind)
        ? record.kind
        : "";
      const proposalStatus = ["proposed", "approved", "rejected", "held", "applied", "rolled_back"].includes(
        record.proposalStatus,
      )
        ? record.proposalStatus
        : "";
      if (!proposalId || !kind || !proposalStatus) return null;
      const sanitized = {
        ...record,
        contract: "agent_spec_proposal_v1",
        proposalId,
        kind,
        proposalStatus,
        pitch: sanitizeLine(record.pitch, 360),
        userMessage: sanitizeLine(record.userMessage, 240),
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
      // 스프레드로 들어온 미지 필드가 무한히 커져 20MB 읽기 캡으로 원장 전체가
      // 소실되지 않도록 건당 크기를 제한한다(200건 × 32KB = 최대 6.4MB).
      if (JSON.stringify(sanitized).length > 32 * 1024) return null;
      return sanitized;
    })
    .filter(Boolean)
    .slice(-proposalLedgerCap);
}

function sanitizePerformanceRecords(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((record) => {
      if (!record || typeof record !== "object") return null;
      const teammateId = sanitizeLine(record.teammateId, 120);
      const outcome = ["success", "failure", "refused"].includes(record.outcome) ? record.outcome : "";
      if (!teammateId || !outcome) return null;
      if (outcome === "refused" && !record.refusedReason) return null;
      return {
        teammateId,
        taskKind: sanitizeLine(record.taskKind, 60) || "general",
        outcome,
        ...(record.refusedReason ? { refusedReason: sanitizeLine(record.refusedReason, 40) } : {}),
        keywords: sanitizeStringArray(record.keywords, 12, 24),
        ...(record.sourceThreadId ? { sourceThreadId: sanitizeLine(record.sourceThreadId, 120) } : {}),
        recordedAt: sanitizeLine(record.recordedAt, 40) || new Date().toISOString(),
      };
    })
    .filter(Boolean)
    .slice(-500);
}

function readJsonArray(filePath) {
  return readJsonArrayStrict(filePath) ?? [];
}

/** 파일 없음 → []. 존재하지만 손상/초과 크기/비배열 → null (읽기와 "읽을 수 없음"을 구분). */
function readJsonArrayStrict(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
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

function atomicWriteJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}
