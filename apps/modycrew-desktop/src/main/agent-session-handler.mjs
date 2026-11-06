import path from "node:path";
import { mutateJsonStore, readJsonStore } from "./json-store.mjs";

const sessionFileName = "agent-sessions.json";

const agentCapabilities = Object.freeze([
  {
    id: "work_intake",
    label: "업무 처리",
    description: "메일, 문의, 예약 내용을 읽고 초안/승인 후보/파일 결과를 만듭니다.",
    safetyBoundary: "외부 발송, 일정 등록, 파일 공유는 승인 전 실행하지 않습니다.",
    permissionLevel: "read_draft_stage",
  },
  {
    id: "trigger_check",
    label: "자동 감시 실행",
    description: "켜진 트리거를 즉시 확인하고 새 업무를 인박스에 올립니다.",
    safetyBoundary: "연결된 도구를 읽기/명령 수신 범위로만 확인합니다.",
    permissionLevel: "read_stage",
  },
  {
    id: "connectivity_audit",
    label: "연결 진단",
    description: "AI 연결, 업무툴 연결, 자동화 규칙 상태를 한 번에 점검합니다.",
    safetyBoundary: "비밀값 원문은 읽거나 반환하지 않습니다.",
    permissionLevel: "read_only",
  },
  {
    id: "desktop_control_probe",
    label: "컴퓨터 확인",
    description: "열린 창과 최근 업무 파일 후보를 read-only로 확인해 다음 행동 후보를 만듭니다.",
    safetyBoundary: "클릭, 입력, 파일 쓰기, 외부 발송은 실행하지 않고 관찰 결과만 세션에 남깁니다.",
    permissionLevel: "read_only_desktop",
  },
  {
    id: "desktop_file_chain",
    label: "파일 업무 체인",
    description: "명시한 로컬 파일은 업무 카드, 문서 분석, 보고/답장 초안으로 이어갑니다.",
    safetyBoundary: "명시 파일만 읽고 인박스 초안으로 남깁니다. 원본 수정, 외부 발송, 일정 등록은 실행하지 않습니다.",
    permissionLevel: "read_analyze_draft_stage",
  },
  {
    id: "desktop_browser_chain",
    label: "브라우저 업무 체인",
    description: "업무 URL이나 사이트 요청을 승인 대기 카드와 열기 확인 단계로 준비합니다.",
    safetyBoundary: "사이트 열기 전 확인을 요구하고, 클릭/입력/발송/결제/삭제는 실행하지 않습니다.",
    permissionLevel: "stage_confirm_before_browser_mutation",
  },
  {
    id: "crew_channel_bootstrap",
    label: "AI 팀원 연결",
    description: "새 AI 팀원을 독립 AI 세션, 업무 방식, 작업 로그 경로와 즉시 묶습니다.",
    safetyBoundary: "AI 팀원 연결은 로컬 세션/기억 경로만 만들고 외부 발송이나 계정 작업은 실행하지 않습니다.",
    permissionLevel: "local_session_stage",
  },
]);

export async function handleAgentSessionMessage(_event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");

  if (kind === "status") {
    return getAgentRuntimeStatus(options);
  }

  if (kind === "run") {
    return runAgentSession(payload, options);
  }

  throw new Error(`unsupported agent-session kind: ${kind}`);
}

async function getAgentRuntimeStatus(options = {}) {
  const state = await readSessionState(options);
  return {
    status: "agent_runtime_ready",
    runtimeLabel: "ModyCrew 자동화 런타임",
    capabilities: agentCapabilities,
    recentSessions: state.sessions.slice(0, 12),
    userMessage:
      "업무 처리, 자동 감시, 연결 진단, 컴퓨터 확인, 파일 업무 체인, 브라우저 업무 체인, AI 팀원 연결을 하나의 자동화 실행 기록으로 남길 수 있습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function runAgentSession(payload, options = {}) {
  const mode = normalizeMode(payload.mode);
  const text = sanitizeText(payload.text ?? payload.prompt ?? "");
  const now = new Date().toISOString();
  const session = {
    id: `agent-session-${Date.now().toString(36)}`,
    mode,
    label: capabilityLabel(mode),
    status: "running",
    startedAt: now,
    finishedAt: "",
    inputSummary: text.slice(0, 180),
    outputSummary: "",
    createdWorkItemsCount: 0,
    approvalQueueCount: 0,
    createdWorkItemIds: [],
    auditMessages: [],
    teammateId: sanitizeId(payload.teammateId, ""),
    teammateName: sanitizeText(payload.teammateName ?? ""),
    teammateChannelName: sanitizeText(payload.teammateChannelName ?? ""),
    teammateRoleTitle: sanitizeText(payload.teammateRoleTitle ?? ""),
    memoryPaths: normalizeMemoryPaths(payload.memoryPaths, payload.teammateId),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  const result = await runMode(mode, text, { ...options, payload });
  const finished = {
    ...session,
    status: result.status,
    finishedAt: new Date().toISOString(),
    outputSummary: sanitizeText(result.userMessage ?? result.outputSummary ?? result.status),
    createdWorkItemsCount: Number(result.createdWorkItemsCount ?? 0),
    approvalQueueCount: Number(result.approvalQueueCount ?? 0),
    createdWorkItemIds: Array.isArray(result.createdWorkItemIds)
      ? result.createdWorkItemIds.map((id) => sanitizeId(id, "work-item")).slice(0, 8)
      : [],
    auditMessages: Array.isArray(result.auditMessages)
      ? result.auditMessages.map(sanitizeText).slice(0, 12)
      : [],
    teammateId: session.teammateId,
    teammateName: session.teammateName,
    teammateChannelName: session.teammateChannelName,
    teammateRoleTitle: session.teammateRoleTitle,
    memoryPaths: session.memoryPaths,
  };

  await appendSession(options, finished);

  return {
    status: finished.status,
    session: finished,
    result,
    userMessage: finished.outputSummary,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function runMode(mode, text, options) {
  if (mode === "crew_channel_bootstrap") {
    return bootstrapCrewChannelAI(text, options);
  }

  if (mode === "work_intake") {
    if (text.length < 8) {
      return {
        status: "needs_input",
        userMessage: "처리할 업무 내용을 8자 이상 입력해 주세요.",
      };
    }
    const result = await options.runLocalWorkflow?.(text);
    return {
      status: result?.status ?? "local_workflow_unavailable",
      userMessage: result?.report?.summary ?? result?.userMessage ?? "로컬 업무 처리 결과를 확인하지 못했습니다.",
      createdWorkItemsCount: result?.report?.createdWorkItemsCount ?? 0,
      approvalQueueCount: result?.report?.approvalQueueCount ?? 0,
      createdWorkItemIds: Array.isArray(result?.report?.workItems)
        ? result.report.workItems.map((item) => item.id).filter(Boolean).slice(0, 8)
        : [],
      auditMessages: result?.report?.auditMessages ?? [],
      outputDir: result?.outputDir,
    };
  }

  if (mode === "trigger_check") {
    const result = await options.runTriggerDueChecks?.();
    return {
      status: result?.status ?? "trigger_runner_unavailable",
      userMessage:
        result?.userMessage ??
        `자동 감시를 확인했습니다. 업무 ${result?.createdWorkItemsCount ?? 0}건, 승인 ${result?.approvalQueueCount ?? 0}건`,
      createdWorkItemsCount: result?.createdWorkItemsCount ?? 0,
      approvalQueueCount: result?.approvalQueueCount ?? 0,
      createdWorkItemIds: Array.isArray(result?.report?.createdWorkItemIds)
        ? result.report.createdWorkItemIds.slice(0, 8)
        : [],
      auditMessages: result?.auditMessages ?? [],
    };
  }

  if (mode === "desktop_control_probe") {
    const [windowResult, fileResult] = await Promise.all([
      options.requestDesktopControlAction?.({
        capability: "list_windows",
        featureEnabled: true,
        instruction: text || "현재 업무 창을 확인해줘.",
      }),
      options.requestDesktopControlAction?.({
        capability: "list_recent_files",
        featureEnabled: true,
        instruction: text || "최근 업무 문서 후보를 찾아줘.",
        includeTempCandidates: false,
      }),
    ]);
    const windowCount = windowResult?.observedWindows?.length ?? 0;
    const fileCount = fileResult?.observedFiles?.length ?? 0;
    return {
      status: "desktop_control_probe_completed",
      userMessage: `열린 창 ${windowCount}개와 최근 업무 파일 후보 ${fileCount}개를 read-only로 확인했습니다.`,
      createdWorkItemsCount: 0,
      approvalQueueCount: 0,
      auditMessages: [
        `desktop_windows:${windowCount}`,
        `recent_work_files:${fileCount}`,
        `window_status:${windowResult?.status ?? "unavailable"}`,
        `file_status:${fileResult?.status ?? "unavailable"}`,
      ],
      observations: {
        windows: (windowResult?.observedWindows ?? []).slice(0, 8),
        files: (fileResult?.observedFiles ?? []).slice(0, 8),
      },
    };
  }

  if (mode === "desktop_file_chain") {
    return runDesktopFileChain(text, options);
  }

  if (mode === "desktop_browser_chain") {
    return runDesktopBrowserChain(text, options);
  }

  const [connectorStatus, triggerSettings, aiStatusResult] = await Promise.all([
    options.listConnectorStatuses?.(),
    options.getTriggerSettings?.(),
    Promise.resolve()
      .then(() => options.getAIProviderStatus?.())
      .then((status) => ({ status, error: null }))
      .catch((error) => ({ status: null, error })),
  ]);
  const connectors = connectorStatus?.connectors ?? [];
  const enabledRules = (triggerSettings?.rules ?? []).filter((rule) => rule.enabled);
  const aiStatus = aiStatusResult.status;
  const aiStatusError = aiStatusResult.error;
  const aiReady = (aiStatus?.providers ?? []).some(
    (provider) =>
      (provider.provider === "codex_oauth" &&
        provider.status === "codex_oauth_ready" &&
        provider.hasLocalKey) ||
      ((provider.provider === "openai" || provider.provider === "gemini") &&
        provider.hasLocalKey &&
        provider.chatContentAllowed === true),
  );
  const aiStateLabel =
    aiStatusError?.code === "ai_provider_vault_unreadable"
      ? "연결 복구 필요"
      : aiReady
        ? "연결됨"
        : "연결 필요";

  return {
    status: "connectivity_audit_completed",
    userMessage: `연결 ${connectors.length}개, 켜진 자동화 ${enabledRules.length}개, AI ${aiStateLabel} 상태입니다.`,
    createdWorkItemsCount: 0,
    approvalQueueCount: 0,
    auditMessages: [
      `connector_count:${connectors.length}`,
      `enabled_trigger_rules:${enabledRules.length}`,
      `ai_ready:${aiReady}`,
      `ai_status:${aiStatusError?.code ?? aiStatus?.status ?? "unavailable"}`,
    ],
  };
}

function bootstrapCrewChannelAI(text, options) {
  const payload = options.payload ?? {};
  const teammateId = sanitizeId(payload.teammateId, "teammate-channel");
  const teammateName = sanitizeText(payload.teammateName || "AI 팀원");
  const teammateChannelName = sanitizeText(payload.teammateChannelName || "팀원 대화");
  const teammateRoleTitle = sanitizeText(payload.teammateRoleTitle || "역할");
  const skillIds = Array.isArray(payload.skillIds)
    ? payload.skillIds.map((item) => sanitizeId(item, "")).filter(Boolean).slice(0, 16)
    : [];
  const instructions = Array.isArray(payload.instructions)
    ? payload.instructions.map(sanitizeText).filter(Boolean).slice(0, 8)
    : [];
  const memoryPaths = normalizeMemoryPaths(payload.memoryPaths, teammateId);

  return {
    status: "crew_channel_bootstrap_ready",
    userMessage: `${teammateName} 팀원에게 AI 런타임 세션을 연결했습니다. 다음 답변은 ${teammateRoleTitle} 역할과 ${teammateChannelName} 업무 방식을 먼저 읽습니다.`,
    createdWorkItemsCount: 0,
    approvalQueueCount: 0,
    auditMessages: [
      `teammate_id:${teammateId}`,
      `teammate_channel:${teammateChannelName}`,
      `teammate_role:${teammateRoleTitle}`,
      `skill_count:${skillIds.length}`,
      `instruction_count:${instructions.length}`,
      `memory_crew_soul:${memoryPaths.crewSoul}`,
      "codex_channel_runtime:ready",
      text ? `input:${text.slice(0, 120)}` : "input:channel_bootstrap",
    ],
    teammateId,
    teammateName,
    teammateChannelName,
    teammateRoleTitle,
    memoryPaths,
  };
}

async function appendSession(options, session) {
  // 최신 기록을 대기열 안에서 읽고 한 건을 붙여 원자적으로 저장한다.
  // 예전엔 두 실행이 동시에 끝나면 늦게 쓴 쪽이 다른 실행 기록을 지웠다.
  await mutateJsonStore(
    sessionStatePath(options),
    {
      parse: parseSessionStateFile,
      empty: () => ({ version: 1, sessions: [] }),
      onUnreadable: "reset",
    },
    (state) => ({
      version: 1,
      sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)].slice(0, 40),
    }),
  );
}

async function runDesktopBrowserChain(text, options) {
  const targetUrl = findExplicitUrl(text);
  const staged = await options.requestDesktopControlAction?.({
    capability: "stage_browser_work_item",
    featureEnabled: true,
    target: targetUrl ?? "",
    instruction: text || "브라우저에서 처리할 업무를 승인 대기 카드로 준비해줘.",
  });
  const plan = staged?.status === "browser_work_item_staged"
    ? await options.requestDesktopControlAction?.({
        capability: "plan_browser_actions",
        featureEnabled: true,
        target: targetUrl ?? "",
        instruction: text || "브라우저에서 처리할 다음 행동 후보를 정리해줘.",
        workItemId: staged?.stagedWorkItem?.id,
      })
    : null;
  const openPlan = targetUrl
    ? await options.requestDesktopControlAction?.({
        capability: "open_url",
        featureEnabled: true,
        target: targetUrl,
        instruction: text || "이 업무 사이트를 열기 전 사용자 확인을 준비해줘.",
      })
    : null;
  const createdIds = [staged?.stagedWorkItem?.id].filter(Boolean).slice(0, 8);
  const stagedOk = staged?.status === "browser_work_item_staged";
  const actionPlanReady = plan?.status === "browser_actions_planned";
  const openReady = openPlan?.status === "needs_user_confirmation";

  return {
    status: stagedOk && actionPlanReady && (openReady || !targetUrl)
      ? "desktop_browser_chain_ready"
      : stagedOk && actionPlanReady
        ? "desktop_browser_chain_planned"
        : stagedOk
          ? "desktop_browser_chain_staged"
        : staged?.status ?? "desktop_browser_chain_unavailable",
    userMessage:
      openReady
        ? "브라우저 업무 카드, 행동 후보, 사이트 열기 확인 단계까지 준비했습니다."
        : actionPlanReady
          ? "브라우저 업무 카드와 다음 행동 후보를 준비했습니다."
        : staged?.userMessage ?? "브라우저 업무 체인을 준비하지 못했습니다.",
    createdWorkItemsCount: createdIds.length,
    approvalQueueCount: createdIds.length > 0 ? 1 : 0,
    createdWorkItemIds: createdIds,
    auditMessages: [
      `browser_stage_status:${staged?.status ?? "unavailable"}`,
      `browser_action_plan_status:${plan?.status ?? "not_run"}`,
      `browser_action_candidates:${plan?.actionPlan?.length ?? 0}`,
      `open_url_status:${openPlan?.status ?? "not_run"}`,
      `target_url:${targetUrl ? "present" : "missing"}`,
      "finalUserPresence_required:true",
    ],
  };
}

function normalizeMemoryPaths(value, fallbackTeammateId = "teammate-channel") {
  const input = value && typeof value === "object" ? value : {};
  const fallbackId = sanitizeId(input.teammateId ?? fallbackTeammateId, "teammate-channel");
  return {
    crewSoul: sanitizeRelativePath(input.crewSoul, `memory/crew-souls/${fallbackId}/CrewSoul.md`),
    promptMemory: sanitizeRelativePath(input.promptMemory, `memory/crew-souls/${fallbackId}/PromptMemory.md`),
    workLog: sanitizeRelativePath(input.workLog, `memory/crew-souls/${fallbackId}/WorkLog.md`),
    decisionLog: sanitizeRelativePath(input.decisionLog, `memory/crew-souls/${fallbackId}/DecisionLog.md`),
  };
}

function sanitizeRelativePath(value, fallback) {
  const text = String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+\//g, "")
    .replace(/[^A-Za-z0-9._/\-가-힣]/gu, "")
    .slice(0, 240);
  if (!text || text.includes("..") || /^[A-Za-z]:/u.test(text)) return fallback;
  return text;
}

async function runDesktopFileChain(text, options) {
  const target = findExplicitLocalPath(text);
  if (!target) {
    const fileResult = await options.requestDesktopControlAction?.({
      capability: "list_recent_files",
      featureEnabled: true,
      instruction: text || "최근 업무 문서 후보를 찾아서 업무 카드로 준비해줘.",
      includeTempCandidates: false,
    });
    const firstFile = fileResult?.observedFiles?.[0];
    if (!firstFile?.path) {
      return {
        status: "desktop_file_chain_no_candidate",
        userMessage: "최근 업무 파일 후보를 찾지 못했습니다. 파일 경로를 입력하면 바로 업무 카드와 초안을 만들 수 있습니다.",
        createdWorkItemsCount: 0,
        approvalQueueCount: 0,
        auditMessages: [
          `recent_work_files:${fileResult?.observedFiles?.length ?? 0}`,
          `file_status:${fileResult?.status ?? "unavailable"}`,
        ],
      };
    }

    const staged = await options.requestDesktopControlAction?.({
      capability: "stage_file_work_item",
      featureEnabled: true,
      target: firstFile.path,
      instruction: text || "이 파일을 업무 카드로 올리고 다음 처리 후보를 준비해줘.",
    });
    return summarizeDesktopFileChain({
      status: staged?.status === "work_item_staged" ? "desktop_file_candidate_staged" : staged?.status,
      userMessage:
        staged?.userMessage ??
        "최근 업무 파일 후보를 찾았지만 업무 카드로 만들지 못했습니다.",
      steps: [fileResult, staged],
      createdWorkItemIds: [staged?.stagedWorkItem?.id].filter(Boolean),
      auditMessages: [
        `recent_work_files:${fileResult?.observedFiles?.length ?? 0}`,
        `file_status:${fileResult?.status ?? "unavailable"}`,
        `stage_status:${staged?.status ?? "unavailable"}`,
      ],
    });
  }

  const staged = await options.requestDesktopControlAction?.({
    capability: "stage_file_work_item",
    featureEnabled: true,
    target,
    instruction: text || "이 파일을 업무 카드로 올려줘.",
  });
  if (staged?.status !== "work_item_staged") {
    return summarizeDesktopFileChain({
      status: staged?.status ?? "desktop_file_chain_unavailable",
      userMessage: staged?.userMessage ?? "파일 업무 카드를 만들지 못했습니다.",
      steps: [staged],
      createdWorkItemIds: [staged?.stagedWorkItem?.id].filter(Boolean),
      auditMessages: [`stage_status:${staged?.status ?? "unavailable"}`],
    });
  }

  const workItemId = staged.stagedWorkItem?.id;
  const analyzed = await options.requestDesktopControlAction?.({
    capability: "analyze_local_file",
    featureEnabled: true,
    target,
    instruction: text || "이 파일을 읽고 확인 항목을 정리해줘.",
    workItemId,
  });
  const drafted = analyzed?.status === "file_analyzed"
    ? await options.requestDesktopControlAction?.({
        capability: "draft_from_local_file",
        featureEnabled: true,
        target,
        instruction: text || "이 파일을 기준으로 보고서 초안을 만들어줘.",
        workItemId,
        outputKind: inferOutputKind(text),
      })
    : null;

  const finalStatus = drafted?.status === "output_drafted"
    ? "desktop_file_chain_completed"
    : analyzed?.status === "file_analyzed"
      ? "desktop_file_chain_analyzed"
      : "desktop_file_chain_staged";

  return summarizeDesktopFileChain({
    status: finalStatus,
    userMessage:
      drafted?.userMessage ??
      analyzed?.userMessage ??
      staged.userMessage ??
      "파일 업무 체인을 실행했습니다.",
    steps: [staged, analyzed, drafted],
    createdWorkItemIds: [
      staged?.stagedWorkItem?.id,
      analyzed?.stagedWorkItem?.id,
      drafted?.stagedWorkItem?.id,
    ].filter(Boolean),
    auditMessages: [
      `stage_status:${staged?.status ?? "unavailable"}`,
      `analysis_status:${analyzed?.status ?? "not_run"}`,
      `draft_status:${drafted?.status ?? "not_run"}`,
    ],
  });
}

function summarizeDesktopFileChain(input) {
  const createdIds = [...new Set(input.createdWorkItemIds ?? [])].slice(0, 8);
  const completedSteps = (input.steps ?? []).filter((step) =>
    ["work_item_staged", "file_analyzed", "output_drafted", "read_completed"].includes(String(step?.status ?? "")),
  ).length;
  return {
    status: input.status ?? "desktop_file_chain_completed",
    userMessage: input.userMessage,
    createdWorkItemsCount: createdIds.length,
    approvalQueueCount: createdIds.length > 0 ? 1 : 0,
    createdWorkItemIds: createdIds,
    auditMessages: [
      `desktop_file_chain_steps:${completedSteps}`,
      ...(input.auditMessages ?? []),
    ],
  };
}

function findExplicitLocalPath(value) {
  const text = String(value ?? "");
  const quoted = /["']([A-Za-z]:\\[^"']+)["']/u.exec(text);
  if (quoted?.[1]) return quoted[1].trim();
  const unquoted = /\b([A-Za-z]:\\[^\r\n]+?\.(?:pdf|docx?|xlsx?|csv|txt|md|pptx?|hwp|hwpx))\b/iu.exec(text);
  return unquoted?.[1]?.trim();
}

function inferOutputKind(text) {
  if (/답장|회신|메일|reply|email/i.test(text)) return "reply";
  if (/표|엑셀|table|정리표|csv/i.test(text)) return "table";
  return "report";
}

function findExplicitUrl(value) {
  const text = String(value ?? "");
  const match = /\bhttps?:\/\/[^\s"'<>]+/iu.exec(text);
  if (!match?.[0]) return "";
  try {
    const url = new URL(match[0]);
    if (!url.hostname || url.username || url.password) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|password|passwd|auth|code|session/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.href.slice(0, 500);
  } catch {
    return "";
  }
}

function parseSessionStateFile(parsed) {
  if (!parsed || !Array.isArray(parsed.sessions)) throw new Error("invalid_agent_session_state_shape");
  return {
    version: 1,
    sessions: parsed.sessions.map(normalizeSession).filter(Boolean),
  };
}

async function readSessionState(options) {
  const filePath = sessionStatePath(options);
  // 본 파일이 깨졌으면 직전 정상본(.previous)으로 읽는다.
  const loaded = await readJsonStore(filePath, { parse: parseSessionStateFile });
  if (loaded.status === "ok" || loaded.status === "recovered") return loaded.value;
  // Missing or invalid history starts empty. No secret material belongs here.
  return { version: 1, sessions: [] };
}

function sessionStatePath(options) {
  if (!options.app?.getPath) {
    throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  }
  return path.join(options.app.getPath("userData"), sessionFileName);
}

function normalizeSession(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeId(value.id, "agent-session"),
    mode: normalizeMode(value.mode),
    label: sanitizeText(value.label ?? capabilityLabel(value.mode)),
    status: sanitizeId(value.status, "completed"),
    startedAt: sanitizeText(value.startedAt),
    finishedAt: sanitizeText(value.finishedAt),
    inputSummary: sanitizeText(value.inputSummary),
    outputSummary: sanitizeText(value.outputSummary),
    createdWorkItemsCount: Number(value.createdWorkItemsCount ?? 0),
    approvalQueueCount: Number(value.approvalQueueCount ?? 0),
    createdWorkItemIds: Array.isArray(value.createdWorkItemIds)
      ? value.createdWorkItemIds.map((id) => sanitizeId(id, "work-item")).slice(0, 8)
      : [],
    auditMessages: Array.isArray(value.auditMessages)
      ? value.auditMessages.map(sanitizeText).slice(0, 12)
      : [],
    teammateId: sanitizeId(value.teammateId, ""),
    teammateName: sanitizeText(value.teammateName ?? ""),
    teammateChannelName: sanitizeText(value.teammateChannelName ?? ""),
    teammateRoleTitle: sanitizeText(value.teammateRoleTitle ?? ""),
    memoryPaths: normalizeMemoryPaths(value.memoryPaths, value.teammateId),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function normalizeMode(value) {
  const mode = String(value ?? "");
  if (
    [
      "work_intake",
      "trigger_check",
      "connectivity_audit",
      "desktop_control_probe",
      "desktop_file_chain",
      "desktop_browser_chain",
      "crew_channel_bootstrap",
    ].includes(mode)
  ) {
    return mode;
  }
  return "connectivity_audit";
}

function capabilityLabel(mode) {
  return agentCapabilities.find((capability) => capability.id === mode)?.label ?? "연결 진단";
}

function sanitizeId(value, fallback) {
  const text = String(value ?? "")
    .trim()
    .replace(/[^a-z0-9._:-]/gi, "")
    .slice(0, 120);
  return text || fallback;
}

function sanitizeText(value) {
  return redactSensitiveUrlsInText(String(value ?? ""))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function redactSensitiveUrlsInText(value) {
  return String(value ?? "").replace(/\bhttps?:\/\/[^\s"'<>]+/giu, (urlText) => {
    try {
      const url = new URL(urlText);
      for (const key of [...url.searchParams.keys()]) {
        if (/token|secret|key|password|passwd|auth|code|session/i.test(key)) {
          url.searchParams.set(key, "[redacted]");
        }
      }
      return url.href;
    } catch {
      return "[redacted-url]";
    }
  });
}
