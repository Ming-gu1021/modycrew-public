const { contextBridge, ipcRenderer } = require("electron");
const { webUtils } = require("electron");

/**
 * V2 web (apps/modycrew-web) 의 `lib/desktop-bridge.ts` 가 부르는 메서드들을
 * 안전한 형태로 노출합니다.
 *
 * 보안 원칙:
 *  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` 전제
 *  - allowlist 에 없는 IPC channel 은 호출 불가
 *  - secret 원문 (API key/token/password) 은 결과에 포함되지 않음
 */

const allowedChannels = new Set([
  "mody.project-deliverables.v1",
  "mody.native-skills.v1",
  "mody.crew-skills.v1",
                                                                            
  // 시작하자마자 "allowlist 에 없습니다"로 실패했다. tests/desktop/ipc-channel-wiring.test.mjs 가 다시 막는다.
  "mody.creative-studio.v1",
  "mody.workspace-files.v1",
  "mody.metrics-export.v1",
  "mody.work-browser.v1",
  "mody.account.v1",
  "mody.google-auth.v1",
  "mody.billing.v1",
  "mody.ai-provider.v1",
  "mody.connector.v1",
  "mody.mail-work-intake.v1",
  "mody.mail-autodiscovery.v1",
  "mody.mail-imap.v1",
  "mody.local-workflow.v1",
  "mody.selected-work-actions.v1",
  "mody.public-trigger-relay.v1",
  "mody.work-sync.v1",
  "mody.toolchain.v1",
  "mody.local-memory.v1",
  "mody.agent-org.v1",
  "mody.document-learning.v1",
  "mody.receipt-agent.v1",
  "mody.google-drive.v1",
  "mody.document-production.v1",
  "mody.daily-skills.v1",
  "mody.company-automation.v1",
  "mody.desktop-update.v1",
  "mody.trigger-runner.v1",
  "mody.trigger-settings.v1",
  "mody.trigger-webhook.v1",
  "mody.agent-session.v1",
  "mody.desktop-control.v1",
  "mody.audit.v1",
  "mody.desktop-bridge.v1",
  "mody.oauth-callback.v1",
  "mody.inbox.v1",
  "mody.background-digest.v1",
  "mody.background-service.v1",
  "mody.assistant-secretary.v1",
  "mody.document-viewer.v1",
  "mody.speech-recognition.v1",
  "mody.employee-skills.v1",
]);

function invoke(channel, payload) {
  if (!allowedChannels.has(channel)) {
    return Promise.reject(new Error(`channel '${channel}' 은 allowlist 에 없습니다.`));
  }
  return ipcRenderer.invoke(channel, payload);
}

// 문서 비교의 한쪽: 파일 경로 또는 글(저장 전 결과). 다른 모양은 넘기지 않는다.
function documentViewerDiffSide(side) {
  if (side === null) return null;
  if (!side || typeof side !== "object") return undefined;
  if (typeof side.path === "string") return { path: side.path.slice(0, 4096) };
  if (typeof side.text === "string") return { text: side.text.slice(0, 4000000), label: typeof side.label === "string" ? side.label.slice(0, 120) : undefined };
  return undefined;
}

function chatTidyPayload(payload) {
  if (!payload.chatTidy) return {};
  const value = payload.chatTidy;
  return { chatTidy: { requestId: String(value.requestId ?? "").slice(0, 160), threadId: String(value.threadId ?? "").slice(0, 200),
    scopeKey: String(value.scopeKey ?? "").slice(0, 1000), approvalToken: String(value.approvalToken ?? "").slice(0, 80),
    intent: ["cancel", "open", "access", "set_access"].includes(value.intent) ? value.intent : "",
    accessMode: ["disabled", "approval", "auto"].includes(value.accessMode) ? value.accessMode : undefined,
    automatic: value.automatic === true } };
}

async function serializeRendererFiles(files, sourceKind = "renderer") {
  const normalizedFiles = [];
  for (const [index, file] of Array.from(files ?? []).entries()) {
    if (!file || typeof file !== "object") continue;
    const absolutePath =
      (webUtils && typeof webUtils.getPathForFile === "function"
        ? webUtils.getPathForFile(file)
        : "") || String(file.path ?? "");
    const fileName = String(file.name ?? `clipboard-${index + 1}`);
    const base = {
      id: `renderer-file-${Date.now()}-${index}`,
      absolutePath,
      fileName,
      name: fileName,
      sizeBytes: Number(file.size ?? 0),
      mimeType: String(file.type ?? ""),
      modifiedAt: Number(file.lastModified)
        ? new Date(Number(file.lastModified)).toISOString()
        : new Date().toISOString(),
      selected: true,
      sourceKind,
    };
    // A real dropped/pasted File supplies its own bytes. Do not turn attachment
    // into permission to read an arbitrary pathname or enroll a learning source.
    if ((sourceKind === "drop" || sourceKind === "paste") && typeof file.arrayBuffer === "function") base.absolutePath = "";
    if (base.absolutePath) {
      normalizedFiles.push(base);
      continue;
    }
    if (typeof file.arrayBuffer === "function") {
      const buffer = Buffer.from(await file.arrayBuffer());
      normalizedFiles.push({
        ...base,
        dataBase64: buffer.toString("base64"),
      });
    }
  }
  return normalizedFiles;
}

// main → 화면 방향 신호. 받기만 하고, 목록에 없는 채널은 구독할 수 없다.
// 리스너에는 IPC event 객체를 넘기지 않고 정리한 값만 넘긴다.
const allowedEventChannels = new Set(["mody.focus-work-item.v1", "mody.inbox.changed", "mody.work-browser.open", "mody.desktop-update.changed", "mody.assistant-secretary.changed"]);

function subscribe(channel, listener, sanitize) {
  if (!allowedEventChannels.has(channel) || typeof listener !== "function") return () => {};
  const handler = (_event, data) => {
    try {
      listener(sanitize(data));
    } catch {
      // 화면 쪽 콜백 오류가 다른 구독을 막지 않게 한다.
    }
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

function sanitizeWorkItemFocus(data) {
  const queue = String(data?.queue ?? "");
  const kind = String(data?.kind ?? "");
  return {
    workItemId: String(data?.workItemId ?? "").replace(/[^A-Za-z0-9:_./-]/g, "").slice(0, 180),
    queue: ["approval", "deadline", "meeting", "today"].includes(queue) ? queue : "",
    // "task" = 업무판의 맡긴 업무(승인함 카드가 아님).
    kind: kind === "task" ? kind : "",
  };
}

function sanitizeInboxChange(data) {
  const whole = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };
  return {
    revision: whole(data?.revision),
    pendingApprovalCount: whole(data?.pendingApprovalCount),
  };
}

function sanitizeDesktopUpdateEvent(data) {
  const text = (value, max) => String(value ?? "").slice(0, max);
  const pct = Number(data?.progressPercent);
  return {
    status: text(data?.status || "idle", 40),
    currentVersion: text(data?.currentVersion, 40),
    updateVersion: text(data?.updateVersion, 40),
    progressPercent: Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0,
    isPackaged: data?.isPackaged === true,
    updatedFromVersion: text(data?.updatedFromVersion, 40),
    installUnconfirmedVersion: text(data?.installUnconfirmedVersion, 40),
    installMode: text(data?.installMode, 20),
    userMessage: text(data?.userMessage, 300),
    errorMessage: text(data?.errorMessage, 300),
  };
}

async function importRendererFiles(files, sourceKind = "renderer") {
  const normalizedFiles = await serializeRendererFiles(files, sourceKind);
  return invoke("mody.document-learning.v1", {
    kind: "import_renderer_files",
    files: normalizedFiles,
    sourceKind,
  });
}

async function importReceiptFiles(files) {
  const normalizedFiles = await serializeRendererFiles(files, "receipt");
  return invoke("mody.receipt-agent.v1", {
    kind: "import_files",
    files: normalizedFiles,
  });
}

contextBridge.exposeInMainWorld("modyCrewWorkBrowser", {
  request: (payload) => invoke("mody.work-browser.v1", payload),
  onOpen: (listener) => subscribe("mody.work-browser.open", listener, data => ({ url: String(data?.url ?? '').slice(0, 8192) })),
});
contextBridge.exposeInMainWorld("modyCrewMetrics", {
  saveCsv: (payload) => invoke("mody.metrics-export.v1", { csv: payload?.csv, fileName: payload?.fileName }),
});
contextBridge.exposeInMainWorld("modyCrewFiles", {
  request: (payload) => invoke("mody.workspace-files.v1", { kind: payload?.kind, path: payload?.path, name: payload?.name, base64: payload?.base64 }),
});
contextBridge.exposeInMainWorld("modyCrewDesktopBridge", {
  projectDeliverables: (payload = {}) => invoke("mody.project-deliverables.v1", payload),
  // 앱 안 문서 보기(읽기 전용). kind: status | open | pick | pdf_page | diff | open_external | show_in_folder | open_pdf_viewer
  documentViewer: (payload = {}) => invoke("mody.document-viewer.v1", {
    kind: String(payload?.kind ?? ""),
    path: typeof payload?.path === "string" ? payload.path.slice(0, 4096) : undefined,
    workspaceRoot: typeof payload?.workspaceRoot === "string" ? payload.workspaceRoot.slice(0, 4096) : undefined,
    reveal: payload?.reveal === true,
    page: Number.isInteger(payload?.page) ? payload.page : undefined,
    width: Number.isFinite(payload?.width) ? payload.width : undefined,
    appIndex: Number.isInteger(payload?.appIndex) && payload.appIndex >= 0 && payload.appIndex < 4 ? payload.appIndex : undefined,
    before: documentViewerDiffSide(payload?.before),
    after: documentViewerDiffSide(payload?.after),
  }),
  nativeSkills: (payload = {}) => invoke("mody.native-skills.v1", payload),
  // 받아쓰기(이 PC 안 whisper.cpp). kind: status | prepare | transcribe | cancel | select_model | remove_model
  speechRecognition: (payload = {}) => invoke("mody.speech-recognition.v1", payload),
  // 직원 만들기·내 스킬 보관함(저장·가져오기·갱신은 데스크톱 확인 창 뒤에만)
  employeeSkills: (payload = {}) => invoke("mody.employee-skills.v1", payload),
  crewSkills: (payload = {}) => invoke("mody.crew-skills.v1", payload),
  // 이미지 스튜디오(이미지·홍보물 만들기). kind: status | generate | job | jobs | preview | folder | open | connect | cancel
  creativeStudio: (payload = {}) => invoke("mody.creative-studio.v1", payload),
  backgroundService: (payload = {}) => invoke("mody.background-service.v1", payload),
  // MODY 비서 대화·먼저 알림. kind: state | context | append | mark_read | run_now | set_preferences | clear
  assistantSecretary: (payload = {}) => invoke("mody.assistant-secretary.v1", payload),
  onAssistantSecretaryChanged: (listener) =>
    subscribe("mody.assistant-secretary.changed", listener, (data) => ({
      unread: Math.max(0, Math.floor(Number(data?.unread) || 0)),
      attention: Math.max(0, Math.floor(Number(data?.attention) || 0)),
      lastMessageId: String(data?.lastMessageId ?? "").slice(0, 120),
      lastTickAt: String(data?.lastTickAt ?? "").slice(0, 40),
    })),
  documentProduction: (payload = {}) => invoke("mody.document-production.v1", payload),
  // 일상 도구(공개 정보 조회). kind: "catalog" | "lookup" 만 메인이 받는다.
  dailySkills: (payload = {}) => invoke("mody.daily-skills.v1", payload),
  companyAutomation: (payload = {}) => invoke("mody.company-automation.v1", payload),
  // 팀 공유 자료에 드라이브 파일 링크를 걸 때 쓰는 보기 전용 목록(영수증 채널과 분리).
  googleDriveFiles: (payload = {}) =>
    invoke("mody.google-drive.v1", {
      kind: ["status", "list_files", "list_recent_files"].includes(payload.kind) ? payload.kind : "list_recent_files",
      query: String(payload.query ?? "").slice(0, 80),
      parentId: String(payload.parentId ?? ""),
      driveId: String(payload.driveId ?? ""),
      pageSize: Number(payload.pageSize ?? 30),
    }),
  fetchInbox: () => invoke("mody.inbox.v1", { kind: "fetch_inbox" }),
  fetchHandledInbox: () => invoke("mody.inbox.v1", { kind: "fetch_inbox_handled" }),
  setInboxCardDisposition: (request) => invoke("mody.inbox.v1", { ...request, kind: "set_card_disposition" }),
  fetchHeaderMetrics: () => invoke("mody.inbox.v1", { kind: "fetch_header_metrics" }),
  // 인박스가 바뀌었는지만 가볍게 묻습니다(바뀐 게 없으면 오피스가 전체 목록을 다시 받지 않음).
  fetchInboxRevision: () => invoke("mody.inbox.v1", { kind: "fetch_inbox_revision" }),
  retryInboxSave: () => invoke("mody.inbox.v1", { kind: "retry_inbox_save" }),
  runLocalWorkflow: (text) =>
    invoke("mody.local-workflow.v1", { kind: "create_from_text", text }),
  openLocalWorkflowOutput: () =>
    invoke("mody.local-workflow.v1", { kind: "open_output" }),
  readSelectedWorkActionEvents: () =>
    invoke("mody.selected-work-actions.v1", { kind: "read" }),
  recordSelectedWorkActionEvent: (event) =>
    invoke("mody.selected-work-actions.v1", { kind: "record", event }),
  recordReleaseReadinessVirtualOfficeEvent: () =>
    invoke("mody.selected-work-actions.v1", { kind: "record_release_readiness" }),
  updateSelectedWorkActionEvent: (eventId, patch) =>
    invoke("mody.selected-work-actions.v1", { kind: "update", eventId, patch }),
  approveDraft: (workItemId) =>
    invoke("mody.inbox.v1", { kind: "approve_draft", workItemId }),
  openApprovedOutput: (workItemId) =>
    invoke("mody.inbox.v1", { kind: "open_approved_output", workItemId }),
  stageFinalAction: (workItemId, actionKind) =>
    invoke("mody.inbox.v1", { kind: "stage_final_action", workItemId, actionKind }),
  prepareFinalConfirmation: (workItemId, options = {}) =>
    invoke("mody.inbox.v1", {
      kind: "prepare_final_confirmation",
      workItemId,
      mailSendApprovalGate:
        options && typeof options === "object" ? options.mailSendApprovalGate : undefined,
    }),
  runFinalActionDryRun: (workItemId, values) =>
    invoke("mody.inbox.v1", { kind: "dry_run_final_action", workItemId, values }),
  executeFinalAction: (workItemId, confirmation) =>
    invoke("mody.inbox.v1", { kind: "execute_final_action", workItemId, confirmation }),
  stageDelegationActionQueueItem: (queueItem = {}) =>
    invoke("mody.inbox.v1", {
      kind: "stage_delegation_action_queue_item",
      queueItem: queueItem && typeof queueItem === "object" ? queueItem : {},
    }),
  confirmScheduleTime: (workItemId, values) =>
    invoke("mody.inbox.v1", { kind: "confirm_schedule_time", workItemId, ...values }),
  requestChange: (workItemId, instruction) =>
    invoke("mody.inbox.v1", { kind: "request_change", workItemId, instruction }),
  // AI가 쓴 메일 초안을 승인함 '보낼까요?' 카드로만 올린다(보내지 않음).
  stageMailDraft: (draft = {}) =>
    invoke("mody.inbox.v1", {
      kind: "stage_mail_draft",
      draft: draft && typeof draft === "object" ? draft : {},
    }),
  // 사용자가 적은 지시로 AI가 답장 초안을 다시 쓴다(보내지 않음). fromSource 면 원래 메일을 읽고 새로 쓴다.
  redraftMailReply: (workItemId, instruction, options = {}) =>
    invoke("mody.inbox.v1", { kind: "request_change", workItemId, instruction, redraft: true, ...(options?.fromSource === true ? { fromSource: true } : {}) }),
  holdAction: (workItemId) =>
    invoke("mody.inbox.v1", { kind: "hold_action", workItemId }),
  rejectAction: (workItemId, reason) =>
    invoke("mody.inbox.v1", { kind: "reject_action", workItemId, reason }),
  // 메일 카드의 담당 AI 직원만 바꿉니다(표시용 — 발송·실행과 무관).
  setCardAssignee: (workItemId, assignee = {}) =>
    invoke("mody.inbox.v1", {
      kind: "set_card_assignee",
      workItemId,
      assigneeTeammateId: assignee && typeof assignee === "object" ? assignee.teammateId : "",
      assigneeName: assignee && typeof assignee === "object" ? assignee.name : "",
      assigneeRoleTitle: assignee && typeof assignee === "object" ? assignee.roleTitle : "",
    }),
  connectConnector: (connectorId, payload) =>
    invoke("mody.connector.v1", { kind: "connect", connectorId, payload }),
  listConnectorStatuses: () => invoke("mody.connector.v1", { kind: "list" }),
  disconnectConnector: (payload = {}) =>
    invoke("mody.connector.v1", { ...payload, kind: "disconnect" }),
  discoverMailServer: (payload) =>
    invoke("mody.mail-autodiscovery.v1", { kind: "discover", payload }),
  getProviderOAuthPreflight: () => invoke("mody.connector.v1", { kind: "preflight" }),
  // 연결된 메일·캘린더에서 실제로 읽은 내용. 지금까지 데스크톱 안에서만 살아 있었다.
  getConnectorChatContext: () => invoke("mody.connector.v1", { kind: "chat_context" }),
  runMailWorkIntake: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { kind: "run", ...payload }),
  // 메일 답장 서명(명함)·말투 읽기·저장·말투 정리만. 메일을 읽거나 보내는 요청은 이 길로 지나가지 않는다.
  mailWritingProfile: (payload = {}) =>
    ["writing_profile_load", "writing_profile_save", "writing_profile_learn_tone"].includes(payload?.kind)
      ? invoke("mody.mail-work-intake.v1", payload)
      : Promise.reject(new Error("지원하지 않는 서명·말투 요청입니다.")),
  runMailLiveE2ERehearsal: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { kind: "run_live_e2e_rehearsal", ...payload }),
  openMailLiveE2EReport: () =>
    invoke("mody.mail-work-intake.v1", { kind: "open_mail_live_e2e_report" }),
  downloadMailAttachmentsToStaging: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { kind: "download_imap_attachments", ...payload }),
  runMobileMailShareIntake: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { kind: "run_mobile_share", ...payload }),
  reviewMailRecipientList: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { kind: "review_recipient_list", ...payload }),
  listMailMessages: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { ...payload, kind: "list_mail_messages" }),
  searchMail: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { ...payload, kind: "mail_search" }),
  readMail: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { ...payload, kind: "mail_read" }),
  draftMail: (payload = {}) =>
    invoke("mody.mail-work-intake.v1", { ...payload, kind: "mail_draft" }),
  sendApprovalNotification: (payload = {}) =>
    invoke("mody.inbox.v1", {
      kind: "send_approval_notification",
      channel: "telegram",
      userInitiated: true,
      ...payload,
    }),
  applyChannelDecision: (payload = {}) =>
    invoke("mody.inbox.v1", {
      kind: "apply_channel_decision",
      ...(payload && typeof payload === "object" ? payload : {}),
    }),
  saveAIProviderKey: (provider, payload) =>
    invoke("mody.ai-provider.v1", { kind: "save_api_key", provider, payload }),
  saveAIProviderModel: (provider, payload) =>
    invoke("mody.ai-provider.v1", { kind: "save_model", provider, payload }),
  startAIProviderOAuth: (provider, options = {}) =>
    invoke("mody.ai-provider.v1", {
      kind: "start_oauth",
      provider,
      forceReconnect: Boolean(options.forceReconnect),
      model: String(options.model ?? ""),
    }),
  // 내 PC 에 깔린 모델 목록. 사용자가 모델 이름을 외워 치지 않아도 되게 한다.
  listLocalAIModels: (payload = {}) =>
    invoke("mody.ai-provider.v1", {
      kind: "list_local_models",
      baseUrl: String(payload.baseUrl ?? ""),
    }),
  // 구독 계정으로 쓰는 AI(Claude 등) — 설치·로그인 상태를 한 번에 준다.
  // 상태 확인은 모델을 부르지 않으므로 사용자 할당량이 닳지 않는다.
  listSubscriptionAIRuntimes: () => invoke("mody.ai-provider.v1", { kind: "subscription_runtimes" }),
  startSubscriptionAILogin: (provider) =>
    invoke("mody.ai-provider.v1", { kind: "subscription_runtime_login", provider: String(provider ?? "") }),
  listAIProviderModels: (provider, options = {}) => invoke("mody.ai-provider.v1", { kind: "list_models", provider, forceRefresh: options.forceRefresh === true }),
  getAIProviderStatus: () => invoke("mody.ai-provider.v1", { kind: "status" }),
  getAIUsageSummary: (days = 30, includeProviderLimits = false) => invoke("mody.ai-provider.v1", { kind: "usage_summary", days, includeProviderLimits: includeProviderLimits === true }),
  getAIRuntimeLiveProofs: () => invoke("mody.ai-provider.v1", { kind: "live_proofs" }),
  // Jev는 채팅 제공업체 목록에 넣지 않고, 같은 제한된 IPC 운반 경로만 사용한다.
  getJevMailClassificationStatus: () =>
    invoke("mody.ai-provider.v1", { kind: "jev_status" }),
  saveJevMailClassification: (payload = {}) =>
    invoke("mody.ai-provider.v1", {
      kind: "jev_save",
      payload: {
        // 입력한 비밀값은 이 호출에만 담고, main 결과로 다시 돌려주지 않는다.
        secret: typeof payload.secret === "string" ? payload.secret : "",
        mode: ["off", "shadow", "assist"].includes(payload.mode) ? payload.mode : "off",
        allowContent: payload.allowContent === true,
      },
    }),
  testJevMailClassification: () =>
    invoke("mody.ai-provider.v1", { kind: "jev_test" }),
  disconnectJevMailClassification: () =>
    invoke("mody.ai-provider.v1", { kind: "jev_disconnect" }),
  clearAIProviderCredential: (provider) =>
    invoke("mody.ai-provider.v1", { kind: "clear_credential", provider }),
  generateAIText: (payload = {}) =>
    invoke("mody.ai-provider.v1", {
      kind: "generate_text",
      prompt: String(payload.prompt ?? ""),
      model: String(payload.model ?? ""),
      roleContext: payload.roleContext && typeof payload.roleContext === "object" ? payload.roleContext : undefined,
      executionContext: payload.executionContext && typeof payload.executionContext === "object" ? payload.executionContext : undefined,
      agentRunContext: payload.agentRunContext && typeof payload.agentRunContext === "object" ? payload.agentRunContext : undefined,
    }),
  generateAITextStream: (payload = {}, onChunk) => {
    const streamChannel = "mody.ai-provider.stream.v1";
    // 화면이 streamId 를 정해 주면 그대로 써서, '중지' 때 cancelAITextStream(streamId) 로 멈출 수 있게 한다.
    const requestedStreamId = typeof payload.streamId === "string" ? payload.streamId : "";
    const streamId = /^[A-Za-z0-9_-]{8,120}$/u.test(requestedStreamId)
      ? requestedStreamId
      : `aistream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const listener = (_event, data) => {
      if (!data || data.streamId !== streamId) return;
      if (typeof onChunk === "function") {
        try {
          onChunk(String(data.delta ?? ""));
        } catch {
          // 렌더러 콜백 오류는 최종 결과 수신을 막지 않습니다.
        }
      }
    };
    ipcRenderer.on(streamChannel, listener);
    return invoke("mody.ai-provider.v1", {
      kind: "generate_text_stream",
      streamId,
      prompt: String(payload.prompt ?? ""),
      model: String(payload.model ?? ""),
      roleContext: payload.roleContext && typeof payload.roleContext === "object" ? payload.roleContext : undefined,
      executionContext: payload.executionContext && typeof payload.executionContext === "object" ? payload.executionContext : undefined,
      agentRunContext: payload.agentRunContext && typeof payload.agentRunContext === "object" ? payload.agentRunContext : undefined,
    }).finally(() => {
      ipcRenderer.removeListener(streamChannel, listener);
    });
  },
  cancelAITextStream: (streamId) =>
    invoke("mody.ai-provider.v1", { kind: "cancel_stream", streamId: String(streamId ?? "").slice(0, 120) }),
  getTriggerSettings: () => invoke("mody.trigger-settings.v1", { kind: "list" }),
  updateTriggerRule: (rule) =>
    invoke("mody.trigger-settings.v1", { kind: "update_rule", rule }),
  getTriggerRunnerStatus: () => invoke("mody.trigger-runner.v1", { kind: "status" }),
  getScheduleNotificationStatus: () =>
    invoke("mody.trigger-runner.v1", {
      kind: "notification_status",
      browserNotificationPermission: getBrowserNotificationPermission(),
    }),
  requestScheduleNotificationPermission: async () =>
    invoke("mody.trigger-runner.v1", {
      kind: "request_notification_permission",
      browserNotificationPermission: await requestBrowserNotificationPermission(),
    }),
  runTriggerDueChecks: () =>
    invoke("mody.trigger-runner.v1", {
      kind: "run_due_checks",
      force: true,
      triggeredBy: "renderer",
    }),
  openTriggerRunnerReport: () =>
    invoke("mody.trigger-runner.v1", {
      kind: "open_latest_report",
    }),
  getTriggerWebhookStatus: () => invoke("mody.trigger-webhook.v1", { kind: "status" }),
  startTriggerWebhook: () => invoke("mody.trigger-webhook.v1", { kind: "start" }),
  stopTriggerWebhook: () => invoke("mody.trigger-webhook.v1", { kind: "stop" }),
  getAgentRuntimeStatus: () => invoke("mody.agent-session.v1", { kind: "status" }),
  runAgentSession: (payload) => invoke("mody.agent-session.v1", { kind: "run", ...payload }),
  getDesktopControlStatus: (payload = {}) =>
    invoke("mody.desktop-control.v1", { kind: "status", ...payload }),
  requestDesktopControlAction: (payload = {}) =>
    invoke("mody.desktop-control.v1", { kind: "request", ...payload }),
  confirmDesktopControlAction: (payload = {}) =>
    invoke("mody.desktop-control.v1", { kind: "confirm", ...payload }),
  getPublicTriggerRelayStatus: () =>
    invoke("mody.public-trigger-relay.v1", { kind: "status" }),
  pullPublicTriggerRelay: () =>
    invoke("mody.public-trigger-relay.v1", { kind: "pull" }),
  runUnifiedWorkSync: (payload = {}) =>
    invoke("mody.work-sync.v1", {
      kind: "run_today_check",
      suppressExternalNotifications: true,
      ...payload,
    }),
  getToolchainStatus: () => invoke("mody.toolchain.v1", { kind: "status" }),
  prepareToolchain: () => invoke("mody.toolchain.v1", { kind: "prepare" }),
  installCodexRecoveryTool: () => invoke("mody.toolchain.v1", { kind: "install_codex", approved: true }),
  getLocalMemoryStatus: () => invoke("mody.local-memory.v1", { kind: "status" }),
  chooseLocalMemoryRoot: () => invoke("mody.local-memory.v1", { kind: "choose_root" }),
  openWorkspaceWindow: (target) =>
    invoke("mody.desktop-bridge.v1", {
      kind: "open_workspace_window",
      target: String(target ?? ""),
    }),
  returnToMainWindow: () =>
    invoke("mody.desktop-bridge.v1", {
      kind: "return_to_main_window",
    }),
  onFocusWorkItem: (listener) => subscribe("mody.focus-work-item.v1", listener, sanitizeWorkItemFocus),
  takePendingWorkItemFocus: () =>
    invoke("mody.desktop-bridge.v1", { kind: "take_pending_work_item_focus" }).then((value) =>
      value && (value.workItemId || value.queue || value.kind) ? sanitizeWorkItemFocus(value) : null,
    ),
  onInboxChanged: (listener) => subscribe("mody.inbox.changed", listener, sanitizeInboxChange),
  getInboxAttention: () =>
    invoke("mody.desktop-bridge.v1", { kind: "inbox_attention" }).then(sanitizeInboxChange),
  openWorkerCompanionWindow: (options = {}) =>
    invoke("mody.desktop-bridge.v1", {
      kind: "open_worker_companion_window",
      options,
    }),
  openReleaseFieldGuide: () =>
    invoke("mody.desktop-bridge.v1", {
      kind: "open_release_field_guide",
    }),
  openFirstUserObservationKit: (target) =>
    invoke("mody.desktop-bridge.v1", {
      kind: "open_first_user_observation_kit",
      target: String(target ?? "scorecard"),
    }),
  openReleaseAIRuntimeLiveKit: (target) =>
    invoke("mody.desktop-bridge.v1", {
      kind: "open_release_ai_runtime_live_kit",
      target: String(target ?? "template"),
    }),
  openReleaseLiveSmokeKit: (target) =>
    invoke("mody.desktop-bridge.v1", {
      kind: "open_release_live_smoke_kit",
      target: String(target ?? "template"),
    }),
  openReleaseOperatorRunnerKit: (target) =>
    invoke("mody.desktop-bridge.v1", {
      kind: "open_release_operator_runner_kit",
      target: String(target ?? "runner"),
    }),
  openReleaseUnblockKit: (target) =>
    invoke("mody.desktop-bridge.v1", {
      kind: "open_release_unblock_kit",
      target: String(target ?? "guide"),
    }),
  loadChatThreads: () => invoke("mody.local-memory.v1", { kind: "load_chat_threads" }),
  loadWorkSessionWorkspace: (expectedRoot) => invoke("mody.local-memory.v1", { kind: "load_work_session_workspace", expectedRoot }),
  updateWorkSessionWorkspace: (command, expectedRoot) => invoke("mody.local-memory.v1", { kind: "update_work_session_workspace", command, expectedRoot }),
  saveChatThreads: (threads, expectedRoot) =>
    invoke("mody.local-memory.v1", {
      kind: "save_chat_threads",
      threads: Array.isArray(threads) ? threads : [],
      expectedRoot,
      deferPromptRefresh: true,
    }),
  loadAppProfile: () => invoke("mody.local-memory.v1", { kind: "load_app_profile" }),
  saveAppProfile: (profile) =>
    invoke("mody.local-memory.v1", {
      kind: "save_app_profile",
      profile: profile && typeof profile === "object" ? profile : {},
    }),
  inspectPortableMemory: () =>
    invoke("mody.local-memory.v1", {
      kind: "inspect_portable_memory",
    }),
  listWorkspaceSkillAcquisitionProposals: (workspaceId = "local_desktop") =>
    invoke("mody.local-memory.v1", {
      kind: "list_workspace_skill_acquisition_proposals",
      workspaceId: String(workspaceId ?? "local_desktop"),
    }),
  confirmWorkspaceSkillDownloadInstall: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "confirm_workspace_skill_download_install",
      workspaceId: String(payload.workspaceId ?? "local_desktop"),
      proposalId: String(payload.proposalId ?? ""),
      requestFingerprint: String(payload.requestFingerprint ?? ""),
      decisionId: String(payload.decisionId ?? ""),
      decision: payload.decision === "approve_once" ? "approve_once" : "decline",
    }),
  confirmWorkspaceSkillActivation: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "confirm_workspace_skill_activation",
      workspaceId: String(payload.workspaceId ?? "local_desktop"),
      proposalId: String(payload.proposalId ?? ""),
      requestFingerprint: String(payload.requestFingerprint ?? ""),
      decisionId: String(payload.decisionId ?? ""),
      decision: payload.decision === "activate" ? "activate" : "keep_inactive",
      targetAgentId: String(payload.targetAgentId ?? ""),
    }),
  saveWorkDecisions: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "save_work_decisions",
      decisions: Array.isArray(payload.decisions) ? payload.decisions : [],
      teammateId: String(payload.teammateId ?? ""),
      teammateName: String(payload.teammateName ?? ""),
      source: String(payload.source ?? ""),
    }),
  saveWorkLearning: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "save_work_learning",
      records: Array.isArray(payload.records) ? payload.records : [],
      sourceKind: String(payload.sourceKind ?? ""),
      sourceLabel: String(payload.sourceLabel ?? ""),
      teammateId: String(payload.teammateId ?? ""),
      teammateName: String(payload.teammateName ?? ""),
      summary: String(payload.summary ?? ""),
      signals: Array.isArray(payload.signals) ? payload.signals.map(String) : [],
      artifactPaths: Array.isArray(payload.artifactPaths) ? payload.artifactPaths.map(String) : [],
      metrics: payload.metrics && typeof payload.metrics === "object" ? payload.metrics : {},
    }),
  listWorkPatterns: () =>
    invoke("mody.local-memory.v1", {
      kind: "list_work_patterns",
    }),
  updateWorkPattern: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "update_work_pattern",
      id: String(payload.id ?? payload.patternId ?? ""),
      patch: payload.patch && typeof payload.patch === "object" ? payload.patch : {},
    }),
  removeWorkPattern: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "remove_work_pattern",
      id: String(payload.id ?? payload.patternId ?? ""),
    }),
  listLearningSources: () =>
    invoke("mody.local-memory.v1", {
      kind: "list_learning_sources",
    }),
  upsertLearningSources: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "upsert_learning_sources",
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      folders: Array.isArray(payload.folders) ? payload.folders : [],
      source: String(payload.source ?? ""),
    }),
  removeLearningSource: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "remove_learning_source",
      id: String(payload.id ?? payload.sourceId ?? ""),
      path: String(payload.path ?? ""),
    }),
  saveDelegationArtifact: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "save_delegation_artifact",
      artifactId: String(payload.artifactId ?? ""),
      artifactKind: String(payload.artifactKind ?? ""),
      title: String(payload.title ?? ""),
      body: String(payload.body ?? ""),
      requestText: String(payload.requestText ?? ""),
      sourceThreadId: String(payload.sourceThreadId ?? ""),
      sourceTeammateId: String(payload.sourceTeammateId ?? ""),
      teammateName: String(payload.teammateName ?? ""),
      createdAt: String(payload.createdAt ?? ""),
      rows: Array.isArray(payload.rows) ? payload.rows : [],
      metrics: payload.metrics && typeof payload.metrics === "object" ? payload.metrics : {},
    }),
  listDelegationArtifacts: () =>
    invoke("mody.local-memory.v1", {
      kind: "list_delegation_artifacts",
    }),
  openDelegationArtifact: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "open_delegation_artifact",
      artifactId: String(payload.artifactId ?? ""),
      relativePath: String(payload.relativePath ?? ""),
    }),
  openLocalMemoryFile: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "open_memory_file",
      relativePath: String(payload.relativePath ?? payload.path ?? ""),
    }),
  recordDelegationArtifactDecision: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "record_delegation_artifact_decision",
      artifactId: String(payload.artifactId ?? ""),
      decision: String(payload.decision ?? ""),
      decidedBy: String(payload.decidedBy ?? ""),
      note: String(payload.note ?? ""),
      revisionInstruction: String(payload.revisionInstruction ?? ""),
    }),
  recordHomeApprovalDecisionReceipt: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "record_home_approval_decision_receipt",
      receipt: payload.receipt && typeof payload.receipt === "object" ? payload.receipt : {},
      teammateId: String(payload.teammateId ?? ""),
      teammateName: String(payload.teammateName ?? ""),
      sourceThreadId: String(payload.sourceThreadId ?? ""),
    }),
  listHomeApprovalDecisionReceipts: () =>
    invoke("mody.local-memory.v1", {
      kind: "list_home_approval_decision_receipts",
    }),
  loadLocalMemoryPromptContext: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "load_prompt_context",
      teammateId: String(payload.teammateId ?? ""),
      maxChars: Number(payload.maxChars ?? 9000),
    }),
  // 지금까지 배운 것 — 사람이 보고 지울 수 있어야 "혼자 발전"이 안심이 된다.
  loadLearningLessons: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "load_learning_lessons",
      teammateId: String(payload.teammateId ?? ""),
    }),
  applyLearningLessons: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "apply_learning_lessons",
      edits: Array.isArray(payload.edits) ? payload.edits : [],
    }),
  rollbackLearningLessons: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "rollback_learning_lessons",
      applied: Array.isArray(payload.applied) ? payload.applied : [],
    }),
  // 확인을 기다리는 배움에 답한다. 승인해야 비로소 장부에 적힌다.
  decideLearningProposal: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "decide_learning_proposal",
      proposalId: String(payload.proposalId ?? ""),
      decision: payload.decision === "approve" ? "approve" : "reject",
    }),
  // 업무 원장 — 지금 무슨 일이 어디까지 됐는지.
  listTasks: () => invoke("mody.local-memory.v1", { kind: "list_tasks" }),
  runTask: (payload = {}) => invoke("mody.local-memory.v1", { ...payload, kind: "run_task" }),
  controlTaskExecution: (payload = {}) => invoke("mody.local-memory.v1", { ...payload, kind: "control_task_execution" }),
  upsertTasks: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "upsert_tasks",
      tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
    }),
  answerTaskQuestion: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "answer_task_question",
      taskId: String(payload.taskId ?? ""),
      answer: String(payload.answer ?? ""),
      askedAt: String(payload.askedAt ?? ""),
    }),
  completeTask: (payload = {}) =>
    invoke("mody.local-memory.v1", {
      kind: "complete_task",
      taskId: String(payload.taskId ?? ""),
      result: String(payload.result ?? ""),
    }),
  // 배경 정리 — 창을 닫아도 새로 들어온 것을 훑어 정리할지. 기본은 꺼짐.
  loadBackgroundDigestStatus: () =>
    invoke("mody.background-digest.v1", { kind: "status" }),
  setBackgroundDigestEnabled: (payload = {}) =>
    invoke("mody.background-digest.v1", {
      kind: "set_enabled",
      enabled: payload.enabled === true,
    }),
  chooseDocumentLearningFiles: () =>
    invoke("mody.document-learning.v1", { kind: "choose_files" }),
  importDocumentLearningFiles: (files, sourceKind) =>
    importRendererFiles(files, String(sourceKind ?? "renderer")),
  chooseDocumentLearningFolders: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "choose_folders",
      purpose: payload.purpose === "chat_attachment" ? "chat_attachment" : "learning",
      knownFolder: String(payload.knownFolder ?? ""),
      namedFolderHint: String(payload.namedFolderHint ?? ""),
      paths: Array.isArray(payload.paths) ? payload.paths.map(String) : [],
      maxFiles: Number(payload.maxFiles ?? 200),
      maxDepth: Number(payload.maxDepth ?? 5),
    }),
  chooseDocumentLearningRoot: () =>
    invoke("mody.document-learning.v1", { kind: "choose_root" }),
  classifyDocumentLearning: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "classify",
      purpose: payload.purpose === "chat_attachment" ? "chat_attachment" : "learning",
      localStorageRoot: String(payload.localStorageRoot ?? ""),
      selectedKinds: Array.isArray(payload.selectedKinds) ? payload.selectedKinds.map(String) : [],
      files: Array.isArray(payload.files) ? payload.files : [],
      searchQuery: String(payload.searchQuery ?? ""),
      activityEventId: String(payload.activityEventId ?? ""),
    }),
  createDocumentLearningFolderPlan: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "create_folder_plan",
      ...chatTidyPayload(payload),
      localStorageRoot: String(payload.localStorageRoot ?? ""),
      selectedKinds: Array.isArray(payload.selectedKinds) ? payload.selectedKinds.map(String) : [],
      files: Array.isArray(payload.files) ? payload.files : [],
    }),
  stageMailAttachmentFolderPlan: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "stage_mail_attachments_folder_plan",
      localStorageRoot: String(payload.localStorageRoot ?? ""),
      connectorId: String(payload.connectorId ?? ""),
      providerId: String(payload.providerId ?? ""),
      messageId: String(payload.messageId ?? ""),
      messageSubject: String(payload.messageSubject ?? payload.subject ?? ""),
      senderPreview: String(payload.senderPreview ?? payload.from ?? ""),
      mailboxLabel: String(payload.mailboxLabel ?? payload.mailbox ?? ""),
      selectedKinds: Array.isArray(payload.selectedKinds) ? payload.selectedKinds.map(String) : [],
      files: Array.isArray(payload.files) ? payload.files : [],
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    }),
  previewDocumentLearningFolderPlan: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "preview_folder_plan",
      ...chatTidyPayload(payload),
      localStorageRoot: String(payload.localStorageRoot ?? ""),
    }),
  applyDocumentLearningFolderPlan: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "apply_folder_plan",
      ...chatTidyPayload(payload),
      localStorageRoot: String(payload.localStorageRoot ?? ""),
      planPath: String(payload.planPath ?? ""),
      organizedRoot: String(payload.organizedRoot ?? ""),
      collisionPolicy: String(payload.collisionPolicy ?? ""),
      excludedOperationIds: Array.isArray(payload.excludedOperationIds) ? payload.excludedOperationIds.map(String) : [],
      excludedPathKeywords: Array.isArray(payload.excludedPathKeywords) ? payload.excludedPathKeywords.map(String) : [],
      confirmationText: String(payload.confirmationText ?? ""),
      finalApproval: payload.finalApproval === true,
    }),
  revertDocumentLearningFolderPlan: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "revert_folder_plan",
      ...chatTidyPayload(payload),
      localStorageRoot: String(payload.localStorageRoot ?? ""),
      manifestPath: String(payload.manifestPath ?? ""),
      confirmationText: String(payload.confirmationText ?? ""),
      finalApproval: payload.finalApproval === true,
    }),
  searchDocumentLearningIndex: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "search_index",
      localStorageRoot: String(payload.localStorageRoot ?? ""),
      query: String(payload.query ?? ""),
      // 정리함에서 훑어볼 때는 더 많이 가져온다. 안 주면 데스크톱 기본값.
      ...(Number(payload.limit) > 0 ? { limit: Number(payload.limit) } : {}),
    }),
  openDocumentLearningIndex: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "open_index",
      localStorageRoot: String(payload.localStorageRoot ?? ""),
    }),
  openDocumentLearningFile: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "open_file",
      path: String(payload.path ?? ""),
    }),
  getDocumentLearningSupervisorStatus: () =>
    invoke("mody.document-learning.v1", { kind: "supervisor_status" }),
  pauseDocumentLearningSupervisorSource: (sourceId) =>
    invoke("mody.document-learning.v1", {
      kind: "pause_supervisor_source",
      sourceId: String(sourceId ?? ""),
    }),
  resumeDocumentLearningSupervisorSource: (sourceId) =>
    invoke("mody.document-learning.v1", {
      kind: "resume_supervisor_source",
      sourceId: String(sourceId ?? ""),
    }),
  revokeDocumentLearningSupervisorSource: (sourceId) =>
    invoke("mody.document-learning.v1", {
      kind: "revoke_supervisor_source",
      sourceId: String(sourceId ?? ""),
    }),
  reconcileDocumentLearningSupervisorSource: (sourceId) =>
    invoke("mody.document-learning.v1", {
      kind: "reconcile_supervisor_source",
      sourceId: String(sourceId ?? ""),
    }),
  acknowledgeDocumentLearningSupervisorTeammateProposal: (
    sourceId,
    draftId,
    proposalId,
  ) =>
    invoke("mody.document-learning.v1", {
      kind: "ack_supervisor_teammate_proposal",
      sourceId: String(sourceId ?? ""),
      draftId: String(draftId ?? ""),
      proposalId: String(proposalId ?? ""),
    }),
  revealDocumentLearningPath: (payload = {}) =>
    invoke("mody.document-learning.v1", {
      kind: "reveal_path",
      path: String(payload.path ?? ""),
    }),
  loadAgentOrg: () => invoke("mody.agent-org.v1", { kind: "load_org" }),
  saveAgentOrg: (payload = {}) =>
    invoke("mody.agent-org.v1", {
      kind: "save_org",
      ...(payload.blueprint !== undefined ? { blueprint: payload.blueprint } : {}),
      ...(payload.specVersions !== undefined ? { specVersions: payload.specVersions } : {}),
      ...(payload.proposals !== undefined ? { proposals: payload.proposals } : {}),
    }),
  recordAgentOrgPerformance: (record = {}) =>
    invoke("mody.agent-org.v1", { kind: "record_performance", record }),
  stageAgentOrgProposal: (proposalCard = {}) =>
    invoke("mody.inbox.v1", { kind: "stage_agent_org_proposal", proposalCard }),
});

function getBrowserNotificationPermission() {
  try {
    const permission = globalThis.Notification?.permission;
    return typeof permission === "string" ? permission : "unknown";
  } catch {
    return "unknown";
  }
}

async function requestBrowserNotificationPermission() {
  try {
    const notification = globalThis.Notification;
    if (!notification) return "unknown";
    if (notification.permission !== "default") return getBrowserNotificationPermission();
    if (typeof notification.requestPermission !== "function") return getBrowserNotificationPermission();
    const permission = await notification.requestPermission();
    return typeof permission === "string" ? permission : getBrowserNotificationPermission();
  } catch {
    return getBrowserNotificationPermission();
  }
}

contextBridge.exposeInMainWorld("modyCrewReceiptAgent", {
  importFiles: (files) => importReceiptFiles(files),
  analyze: (payload = {}) =>
    invoke("mody.receipt-agent.v1", {
      kind: "analyze",
      grantId: String(payload.grantId ?? ""),
      fileIds: Array.isArray(payload.fileIds) ? payload.fileIds.map(String) : [],
      instruction: String(payload.instruction ?? ""),
      template: payload.template && typeof payload.template === "object" ? payload.template : {},
      provider: payload.provider === "gemini" ? "gemini" : "openai",
      receiptImageConsent: payload.receiptImageConsent === true,
    }),
  regenerate: (payload = {}) =>
    invoke("mody.receipt-agent.v1", {
      kind: "regenerate",
      artifactId: String(payload.artifactId ?? ""),
      receipt: payload.receipt && typeof payload.receipt === "object" ? payload.receipt : {},
      template: payload.template && typeof payload.template === "object" ? payload.template : {},
    }),
  list: () => invoke("mody.receipt-agent.v1", { kind: "list" }),
  open: (artifactId) => invoke("mody.receipt-agent.v1", { kind: "open", artifactId: String(artifactId ?? "") }),
  driveStatus: () => invoke("mody.receipt-agent.v1", { kind: "drive_status" }),
  connectDrive: () => invoke("mody.receipt-agent.v1", { kind: "connect_drive" }),
  listDriveFiles: (payload = {}) =>
    invoke("mody.receipt-agent.v1", {
      kind: "list_drive_files",
      parentId: String(payload.parentId ?? ""),
      driveId: String(payload.driveId ?? ""),
      pageSize: Number(payload.pageSize ?? 50),
    }),
  downloadDriveForLearning: (payload = {}) =>
    invoke("mody.receipt-agent.v1", {
      kind: "download_drive_for_learning",
      fileIds: Array.isArray(payload.fileIds) ? payload.fileIds.map(String) : [],
      driveId: String(payload.driveId ?? ""),
    }),
  previewUpload: (payload = {}) =>
    invoke("mody.receipt-agent.v1", {
      kind: "preview_upload",
      artifactId: String(payload.artifactId ?? ""),
      rootFolderId: String(payload.rootFolderId ?? ""),
      driveId: String(payload.driveId ?? ""),
    }),
  upload: (payload = {}) =>
    invoke("mody.receipt-agent.v1", {
      kind: "upload",
      artifactId: String(payload.artifactId ?? ""),
      approvalId: String(payload.approvalId ?? ""),
      confirmationText: String(payload.confirmationText ?? ""),
    }),
  previewOrganization: (payload = {}) =>
    invoke("mody.receipt-agent.v1", {
      kind: "preview_organization",
      fileIds: Array.isArray(payload.fileIds) ? payload.fileIds.map(String) : [],
      rootFolderId: String(payload.rootFolderId ?? ""),
      driveId: String(payload.driveId ?? ""),
    }),
  applyOrganization: (payload = {}) =>
    invoke("mody.receipt-agent.v1", {
      kind: "apply_organization",
      fileIds: Array.isArray(payload.fileIds) ? payload.fileIds.map(String) : [],
      rootFolderId: String(payload.rootFolderId ?? ""),
      driveId: String(payload.driveId ?? ""),
      approvalId: String(payload.approvalId ?? ""),
      confirmationText: String(payload.confirmationText ?? ""),
    }),
});
contextBridge.exposeInMainWorld("modyCrewAccount", {
  status: () => invoke("mody.account.v1", { kind: "status" }),
  googleSignInStatus: () => invoke("mody.google-auth.v1", { kind: "status" }),
  startGoogleSignIn: () => invoke("mody.google-auth.v1", { kind: "start_google_sign_in" }),
});

contextBridge.exposeInMainWorld("modyCrewDesktopUpdate", {
  status: () => invoke("mody.desktop-update.v1", { action: "status" }),
  check: () => invoke("mody.desktop-update.v1", { action: "check" }),
  download: () => invoke("mody.desktop-update.v1", { action: "download" }),
  installOnQuit: () => invoke("mody.desktop-update.v1", { action: "install_on_quit" }),
  installNow: () => invoke("mody.desktop-update.v1", { action: "install_now" }),
  ackUpdated: () => invoke("mody.desktop-update.v1", { action: "ack_updated" }),
  // 메인이 상태를 바꿀 때마다 밀어 준다(폴링 대기 없이 사이드바 버튼·띠가 바로 바뀐다).
  onChange: (listener) => subscribe("mody.desktop-update.changed", listener, sanitizeDesktopUpdateEvent),
});

contextBridge.exposeInMainWorld("modyCrewDesktopInfo", {
  platform: process.platform,
  contextIsolation: true,
  sandbox: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
