import path from "node:path";
import { createProjectDeliverables, openDeliverablePreview } from "./project-deliverables.mjs";
import { createNativeSkillsService } from "./native-skills-handler.mjs";
import { createCrewSkillRuntime } from "./crew-skill-runtime.mjs";
import { decideCrewSkillAutoApproval } from "./crew-skill-auto-approval.mjs";
import { chooseResultsRoot, createCreativeStudio } from "./creative-studio.mjs";
import { addHtmlPreviews, attachMirroredResults, copyFileToResults, createHtmlPreviewRenderer, mirrorCrewRunResults } from "./crew-results-mirror.mjs";
import { createWorkMetricsExport } from './work-metrics-export.mjs';
import { createWorkspaceFiles } from './workspace-files.mjs';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadDotEnvFile } from "./load-env.mjs";
import { resolveWindowTarget, secureBrowserWindowOptions } from "./window-config.mjs";
import {
  isPackagedElectronRuntime,
  resolveDesktopDomainEntryPath,
} from "./runtime-paths.mjs";
import {
  appendAutomationInboxItems,
  configureInboxStorage,
  getAutomationInboxSnapshot,
  handleInboxMessage,
  handleAccountStatus,
  handleLocalWorkflowMessage,
  upsertAutomationInboxItem,
} from "./inbox-handler.mjs";
import { excludeHandledInboxMailRows } from "./inbox-card-disposition.mjs";
import { configureAIModelMaintenance, generateReceiptVision, handleAIProviderMessage, readProviderCredentialForTool } from "./ai-provider-handler.mjs";
import { createAIProviderModelMaintenance } from "./automatic-model-maintenance-adapter.mjs";
import { isCompanyWorkspaceAIRequest, generateCompanyWorkspaceText } from "./company-workspace-ai.mjs";
import { handleGoogleAuthMessage } from "./google-auth-handler.mjs";
import {
  executeProviderFinalAction,
  handleConnectorMessage,
  listCompanyMailSources,
  loadCalendarWorkflowContext,
  runConnectedMailWorkIntake,
  sendTelegramApprovalNotification,
  sendTelegramScheduleNotification,
} from "./connector-handler.mjs";
import { handleDocumentViewerMessage, workspaceDocumentRoots } from "./document-viewer.mjs";
import { handleSpeechRecognitionMessage, speechRecognitionProgressChannel } from "./speech-recognition.mjs";
import { speechModelPreference } from "./feature-modules/speech-models.mjs";
import { createEmployeeSkillSources, runPowerShellScript, voiceScriptEnv } from "./employee-skill-sources.mjs";
import { createSmtpSender } from "./smtp-sender.mjs";
import { handlePublicTriggerRelayMessage } from "./public-trigger-relay-handler.mjs";
import { generateGuardedReplyDrafts, handleMailWorkIntakeMessage } from "./mail-work-intake-handler.mjs";
import { handleMailAutodiscoveryMessage } from "./mail-autodiscovery-handler.mjs";
import {
  handleTriggerRunnerMessage,
  startTriggerRunnerLoop,
} from "./trigger-runner-handler.mjs";
import { handleTriggerSettingsMessage, listTriggerSettings } from "./trigger-settings-handler.mjs";
import { createBackgroundService } from "./background-service.mjs";
import { handleBackgroundDigestMessage } from "./background-digest-handler.mjs";
import { assistantSecretaryChangedChannel, createAssistantSecretary } from "./assistant-secretary.mjs";
import {
  buildLoginItemSettings,
  buildTrayPresence,
  classifyNotificationFocusTarget,
  countTaskAttention,
  createAttentionDotBitmap,
  createCoalescedRunner,
  createInboxAttentionTracker,
  createPendingFocusStore,
  createTaskAttentionNotifier,
  inboxChangedChannel,
  isAppContentUrl,
  isHiddenLaunch,
  planWorkItemFocusDelivery,
  readBackgroundPresencePreferences,
  resolveTaskNotificationConsent,
  workItemFocusChannel,
  writeBackgroundPresencePreferences,
} from "./background-presence.mjs";
import { createTaskExecutionRunner } from "./task-execution-handler.mjs";
import { taskExecutionEventStatus } from "./task-execution-event-status.mjs";
import {
  handleTriggerWebhookMessage,
  stopActiveTriggerWebhookServer,
} from "./trigger-webhook-handler.mjs";
import { handleAgentSessionMessage } from "./agent-session-handler.mjs";
import { handleDesktopControlMessage } from "./desktop-control-handler.mjs";
import { handleDocumentLearningMessage } from "./document-learning-handler.mjs";
import { createReceiptIpcAdapter } from "./receipt-ipc-adapter.mjs";
import { handleGoogleDriveReadMessage } from "./google-drive-handler.mjs";
import { handleDocumentProductionMessage } from "./document-production/handler.mjs";
import { createDailySkillsHandler } from "./daily-skills/handler.mjs";
import {
  formatDailySkillResultForBackground,
  formatDailySkillsForToolLabel,
  selectDailySkillsForText,
} from "./daily-skills/candidates.mjs";
import { createMailDocumentAttachmentResolver } from "./mail-document-attachments.mjs";
import { handleCompanyAutomationMessage } from "./company-automation/handler.mjs";
import { createCompanyAutomationRuntime, loadCompanyState, assertCompanyTaskAuthority, generateScopedCompanyText, readCompanyTaskContext, readCompanyTaskAccounting } from "./company-automation/runtime.mjs";
import { companyContext } from "./company-automation/company-records.mjs";
import { redactCompanyAIRequest } from "./company-automation/privacy.mjs";
import {
  createDocumentLearningSupervisor,
  sanitizeDocumentLearningSupervisorTeammateProposal,
} from "./document-learning-supervisor.mjs";
import { createWorkspaceSkillRuntime } from "./workspace-skill-runtime.mjs";
import {
  builtInWorkspaceSkillCatalog,
  builtInWorkspaceSkillTrustedHosts,
} from "./built-in-workspace-skill-catalog.mjs";
import {
  handleSelectedWorkActionEventsMessage,
  readSelectedWorkActionEventState,
} from "./selected-work-action-events-handler.mjs";
import { handleWorkSyncMessage } from "./work-sync-handler.mjs";
import { ensureToolchainOnStartup, handleToolchainMessage } from "./toolchain-handler.mjs";
import {
  handleLocalMemoryMessage,
  resolveLocalMemoryAuthoritativeAgentRunTarget,
  resolveLocalMemoryLearnedWorkAssignment,
} from "./local-memory-handler.mjs";
import { handleAgentOrgMessage } from "./agent-org-handler.mjs";
import { prepareAgentOrganizationRuntimeRoute } from "./agent-runtime-routing.mjs";
import {
  finalizeMainAgentRunOutcome,
  issueMainAgentRunAuthorization,
  prepareMainAgentRunOutcomeApproval,
  probeMainAgentRunOutcomeApproval,
  recordMainAgentRunResult,
  resolveMainAgentRunArtifact,
} from "./agent-run-ledger.mjs";
import { handleReleaseFieldGuideMessage } from "./release-field-guide-handler.mjs";
import { handleFirstUserObservationKitMessage } from "./first-user-observation-kit-handler.mjs";
import { handleReleaseAIRuntimeLiveKitMessage } from "./release-ai-runtime-live-kit-handler.mjs";
import { handleReleaseLiveSmokeKitMessage } from "./release-live-smoke-kit-handler.mjs";
import { handleReleaseOperatorRunnerKitMessage } from "./release-operator-runner-kit-handler.mjs";
import { handleReleaseUnblockKitMessage } from "./release-unblock-kit-handler.mjs";
import { modyDesktopPlatformContract } from "./platform-contract.mjs";
import { configureInboxWorkItemHooks, stageMailDraftCard } from "./inbox-handler.mjs";
import { createTaskApprovalStager, settleTasksForInboxWorkItem } from "./approval-task-link.mjs";
import { resolveMailReplySource } from "./mail-reply-source.mjs";
import { createWorkBrowser, workBrowserUrl } from "./work-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const isStartupSmoke = process.argv.includes("--mody-smoke-electron-startup");
const isFirstScreenScreenshotSmoke = process.argv.includes("--mody-smoke-first-screen-screenshot");
const isLongChatLayoutScreenshotSmoke = process.argv.includes("--mody-smoke-long-chat-layout-screenshot");
const isCodexSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-codex-single-setting-screenshot");
const isMailSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-mail-single-setting-screenshot");
const isNotificationSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-notification-single-setting-screenshot");
const isMailLearningSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-mail-learning-single-setting-screenshot");
const isVaultSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-vault-single-setting-screenshot");
const isMemoryRootSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-memory-root-single-setting-screenshot");
const isMessengerChannelSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-messenger-channel-single-setting-screenshot");
const isCrewKitSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-crewkit-single-setting-screenshot");
const isLearnSourceSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-learn-source-single-setting-screenshot");
const isOfficeQueueSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-office-queue-single-setting-screenshot");
const isWorkerChannelSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-worker-channel-single-setting-screenshot");
const isComputerUseSingleSettingScreenshotSmoke = process.argv.includes("--mody-smoke-computer-use-single-setting-screenshot");
const isInlineConnectPanelScreenshotSmoke = process.argv.includes("--mody-smoke-inline-connect-panel-screenshot");
const isMessengerPanelScreenshotSmoke = process.argv.includes("--mody-smoke-messenger-panel-screenshot");
const isWorkersPanelScreenshotSmoke = process.argv.includes("--mody-smoke-workers-panel-screenshot");
const isWorkerCompanionWindowScreenshotSmoke = process.argv.includes("--mody-smoke-worker-companion-window-screenshot");
const isScheduleBriefingMobileScreenshotSmoke = process.argv.includes(
  "--mody-smoke-schedule-briefing-mobile-screenshot",
);
const isScheduleBriefingScreenshotSmoke =
  isScheduleBriefingMobileScreenshotSmoke ||
  process.argv.includes("--mody-smoke-schedule-briefing-screenshot");
const isMailCalendarFinalConfirmationScreenshotSmoke = process.argv.includes(
  "--mody-smoke-mail-calendar-final-confirmation-screenshot",
);
const isMailCalendarScreenshotSmoke =
  isMailCalendarFinalConfirmationScreenshotSmoke ||
  process.argv.includes("--mody-smoke-mail-calendar-screenshot");
const isWelcomeFirstScreenScreenshotSmoke = process.argv.includes("--mody-smoke-welcome-first-screen-screenshot");
const isAccountFirstScreenScreenshotSmoke = process.argv.includes("--mody-smoke-account-first-screen-screenshot");
const isOfficeFirstScreenScreenshotSmoke = process.argv.includes("--mody-smoke-office-first-screen-screenshot");
const isOfficeWindowOpenSmoke = process.argv.includes("--mody-smoke-office-window-open");
const isLearnFirstScreenScreenshotSmoke = process.argv.includes("--mody-smoke-learn-first-screen-screenshot");
const isDocumentHandoffScreenshotSmoke = process.argv.includes("--mody-smoke-document-handoff-screenshot");
const isConnectFirstScreenScreenshotSmoke = process.argv.includes("--mody-smoke-connect-first-screen-screenshot");
const isConnectGuideScreenshotSmoke = process.argv.includes("--mody-smoke-connect-guide-screenshot");
const isAIChatSmoke = process.argv.includes("--mody-smoke-ai-chat");
const isAIModelChatSmoke = process.argv.includes("--mody-smoke-ai-model-chat");
const isAIPendingChatSmoke = process.argv.includes("--mody-smoke-ai-pending-chat");
const isFreshProfileFirstChatSmoke = process.argv.includes("--mody-smoke-fresh-profile-first-chat");
const isMailOpsChatSmoke = process.argv.includes("--mody-smoke-mailops-chat");
const isScreenshotSmoke =
  isFirstScreenScreenshotSmoke ||
  isLongChatLayoutScreenshotSmoke ||
  isCodexSingleSettingScreenshotSmoke ||
  isMailSingleSettingScreenshotSmoke ||
  isNotificationSingleSettingScreenshotSmoke ||
  isMailLearningSingleSettingScreenshotSmoke ||
  isVaultSingleSettingScreenshotSmoke ||
  isMemoryRootSingleSettingScreenshotSmoke ||
  isMessengerChannelSingleSettingScreenshotSmoke ||
  isCrewKitSingleSettingScreenshotSmoke ||
  isLearnSourceSingleSettingScreenshotSmoke ||
  isOfficeQueueSingleSettingScreenshotSmoke ||
  isWorkerChannelSingleSettingScreenshotSmoke ||
  isComputerUseSingleSettingScreenshotSmoke ||
  isInlineConnectPanelScreenshotSmoke ||
  isMessengerPanelScreenshotSmoke ||
  isWorkersPanelScreenshotSmoke ||
  isScheduleBriefingScreenshotSmoke ||
  isMailCalendarScreenshotSmoke ||
  isWelcomeFirstScreenScreenshotSmoke ||
  isAccountFirstScreenScreenshotSmoke ||
  isOfficeFirstScreenScreenshotSmoke ||
  isLearnFirstScreenScreenshotSmoke ||
  isDocumentHandoffScreenshotSmoke ||
  isConnectFirstScreenScreenshotSmoke ||
  isConnectGuideScreenshotSmoke;

// 1) .env 로드 (있으면) — Electron main process 가 시작 시점에 1회
loadDotEnvFile(path.join(repoRoot, ".env"));

const target = resolveWindowTarget({
  isPackaged: isPackagedElectronRuntime(),
});

// 컨트랙트 smoke check 모드 (verify 체인 호환)
// Node 로 직접 실행되므로 Electron 런타임을 import 하기 전에 종료해야 합니다.
if (isStartupSmoke) {
  if (target.mode === "fallback") {
    console.error(
      JSON.stringify(
        {
          status: "electron_startup_smoke_failed",
          reason: "web_build_missing",
          target,
          repoRoot,
          expected: path.join(repoRoot, "apps", "modycrew-web", "out", "index.html"),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        status: "electron_startup_smoke_ok",
        target,
        repoRoot,
        envLoaded: Boolean(process.env.MODYCREW_FIREBASE_PROJECT_ID),
        preloadPath: resolvePreloadPath(),
        mainPath: fileURLToPath(import.meta.url),
        cwd: process.cwd(),
        repoUrl: pathToFileURL(repoRoot).href,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const electronModule = await import("electron");
const electronApi =
  typeof electronModule.default === "string"
    ? electronModule
    : (electronModule.default ?? electronModule);
const {
  app,
  BrowserWindow,
  WebContentsView,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  screen,
  shell,
  safeStorage,
  Notification,
  Tray,
  nativeImage,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  session,
  systemPreferences,
} = electronApi;

// 다크 사용자에게 창 로드 전 라이트 플래시가 보이지 않도록 OS 테마 기준 배경색을 쓴다.
function themedWindowBackgroundColor() {
  return nativeTheme?.shouldUseDarkColors ? "#0f1115" : "#f7f8fa";
}
const { handleDesktopUpdateMessage, startAutoUpdater, getAutoUpdaterState, subscribeAutoUpdaterState } = await import("./auto-updater.mjs");
const { buildUpdateMenuEntries, decideUpdateReadyNotification, describeManualCheckResult, sanitizeDesktopUpdateState } = await import("./update-shell.mjs");

if (!app || !BrowserWindow || !dialog || !ipcMain || !Menu || !net || !protocol || !shell || !safeStorage) {
  throw new Error("Electron main process API를 찾지 못했습니다. electron 런타임에서 실행해 주세요.");
}

// 메인 프로세스에서 아무도 잡지 않은 오류를 userData/logs/main-errors.log 에 남긴다
// (비밀값 가림, 1MB 넘으면 한 번 교체). 잡히지 않은 예외의 Electron 기본 동작은 그대로 둔다.
const { installMainProcessErrorLog } = await import("./main-error-log.mjs");
installMainProcessErrorLog({ app });

const domainEntryPath = resolveDesktopDomainEntryPath({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  repoRoot,
});

const { loadPackagedPublicOAuthClientConfig } = await import('./public-oauth-client-config.mjs');

// 설치본에는 OAuth public client ID만 resources 전용 JSON으로 포함할 수 있습니다.
// 개발 모드는 기존 .env 흐름만 사용하며, 이미 주입된 환경변수는 덮어쓰지 않습니다.
if (app.isPackaged) {
  const publicOAuthConfig = loadPackagedPublicOAuthClientConfig({
    resourcesPath: process.resourcesPath,
    env: process.env,
  });
  if (publicOAuthConfig.status === 'public_oauth_config_loaded') {
    console.info(`[modycrew-desktop] packaged public OAuth client IDs loaded: ${publicOAuthConfig.appliedNames.length}`);
  } else if (publicOAuthConfig.status === 'public_oauth_config_invalid') {
    console.warn('[modycrew-desktop] packaged public OAuth client ID config is invalid; existing environment values were preserved.');
  }
}

if (
  isScreenshotSmoke ||
  isOfficeWindowOpenSmoke ||
  isWorkerCompanionWindowScreenshotSmoke ||
  isAIChatSmoke ||
  isAIModelChatSmoke ||
  isAIPendingChatSmoke ||
  isFreshProfileFirstChatSmoke ||
  isMailOpsChatSmoke
) {
  const smokeProfileName = isOfficeWindowOpenSmoke
    ? "office-window-open"
    : isWorkerCompanionWindowScreenshotSmoke
    ? "worker-companion-window"
    : isAIChatSmoke
    ? "ai-chat"
    : isAIModelChatSmoke
    ? "ai-model-chat"
    : isAIPendingChatSmoke
    ? "ai-pending-chat"
    : isFreshProfileFirstChatSmoke
    ? `fresh-profile-first-chat-${Date.now()}`
    : isMailOpsChatSmoke
    ? "mailops-chat"
    : isLongChatLayoutScreenshotSmoke
    ? "long-chat-layout"
    : isCodexSingleSettingScreenshotSmoke
    ? "codex-single-setting"
    : isMailSingleSettingScreenshotSmoke
    ? "mail-single-setting"
    : isNotificationSingleSettingScreenshotSmoke
    ? "notification-single-setting"
    : isMailLearningSingleSettingScreenshotSmoke
    ? "mail-learning-single-setting"
    : isVaultSingleSettingScreenshotSmoke
    ? "vault-single-setting"
    : isMemoryRootSingleSettingScreenshotSmoke
    ? "memory-root-single-setting"
    : isMessengerChannelSingleSettingScreenshotSmoke
    ? "messenger-channel-single-setting"
    : isCrewKitSingleSettingScreenshotSmoke
    ? "crewkit-single-setting"
    : isLearnSourceSingleSettingScreenshotSmoke
    ? "learn-source-single-setting"
    : isOfficeQueueSingleSettingScreenshotSmoke
    ? "office-queue-single-setting"
    : isWorkerChannelSingleSettingScreenshotSmoke
    ? "worker-channel-single-setting"
    : isComputerUseSingleSettingScreenshotSmoke
    ? "computer-use-single-setting"
    : isInlineConnectPanelScreenshotSmoke
    ? "inline-connect-panel"
    : isMessengerPanelScreenshotSmoke
    ? "messenger-panel"
    : isWorkersPanelScreenshotSmoke
    ? "workers-panel"
    : isScheduleBriefingMobileScreenshotSmoke
    ? "schedule-briefing-mobile"
    : isScheduleBriefingScreenshotSmoke
    ? "schedule-briefing"
    : isMailCalendarFinalConfirmationScreenshotSmoke
    ? "mail-calendar-final-confirmation"
    : isMailCalendarScreenshotSmoke
    ? "mail-calendar"
    : isWelcomeFirstScreenScreenshotSmoke
    ? "welcome-first-screen"
    : isAccountFirstScreenScreenshotSmoke
    ? "account-first-screen"
    : isOfficeFirstScreenScreenshotSmoke
    ? "office-first-screen"
    : isLearnFirstScreenScreenshotSmoke
    ? "learn-first-screen"
    : isDocumentHandoffScreenshotSmoke
    ? "document-handoff"
    : isConnectGuideScreenshotSmoke
    ? "connect-guide"
    : isConnectFirstScreenScreenshotSmoke
    ? "connect-first-screen"
    : "first-screen";
  const smokeUserDataPath = path.join(repoRoot, "dist", "smoke", "user-data", smokeProfileName);
  mkdirSync(smokeUserDataPath, { recursive: true });
  app.setPath("userData", smokeUserDataPath);
}

const isWindowsDevelopmentRuntime =
  process.platform === "win32" && process.defaultApp === true;
const windowsAppUserModelId = isWindowsDevelopmentRuntime
  ? `${modyDesktopPlatformContract.appId}.dev`
  : modyDesktopPlatformContract.appId;
if (typeof app.setName === "function") {
  app.setName("ModyCrew");
}
if (process.platform === "win32" && typeof app.setAppUserModelId === "function") {
  app.setAppUserModelId(windowsAppUserModelId);
}

let mainWindowRef = null;
let officeWindowRef = null;
let workerCompanionWindowRef = null;
let workspaceSkillRuntimeRef = null;
let documentLearningSupervisorRef = null;
let trayRef = null;
let isExplicitQuit = false;
let trayHideNoticeShown = false;
const hasPackagedSingleInstanceLock =
  !app.isPackaged ||
  typeof app.requestSingleInstanceLock !== "function" ||
  app.requestSingleInstanceLock();

if (!hasPackagedSingleInstanceLock) {
  app.quit();
} else if (app.isPackaged) {
  app.on("second-instance", (_event, argv = []) => {
    if (argv.includes("--mody-model-maintenance-check")) {
      void getAutomaticModelMaintenance().then(service => service.check({ force: true })).catch(() => {});
      return;
    }
    const win = mainWindowRef;
    // PC 켤 때 트레이로만 시작했다면 본창이 아직 없다. 아이콘을 다시 누르면 그때 연다.
    if (!win || win.isDestroyed?.()) {
      void showMainWindow();
      return;
    }
    if (win.isMinimized?.()) win.restore();
    applyWindowIcon(win);
    win.show();
    win.focus();
  });
}
const firstScreenSmokeDiagnostics = [];
const workerCompanionWindowDefaults = Object.freeze({
  width: 620,
  height: 760,
  minWidth: 400,
  minHeight: 560,
  maxWidth: 980,
  maxHeight: 920,
  margin: 18,
  displayMode: "desktop_overlay",
  route: "workerCompanion=1",
  surfaceLabel: "직원 일하는 모습",
  currentWindow: "work_status_not_settings",
  visibleWork: "base_custom_current_work_approval_lock",
  hiddenWork: "size_position_character_settings_until_support_open",
  finalBoundary: "approval_before_external_mutation",
  userLanguage: "working_view_not_small_window_label",
  stateContract: "current_work_status_approval_lock",
  sizePreset: "standard",
  positionPreset: "bottom_right",
  motionStyle: "calm",
  avatarMode: "base",
});

// app.whenReady() 전에 호출해야 합니다.
// custom scheme 으로 Next.js static export 의 절대경로(/_next/...) 를 안전하게 서빙.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "modycrew",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      // 커스텀 프로토콜은 기본으로 V8 코드 캐시가 꺼져 있어, 창을 열 때마다
      // 화면 JS(약 6MB)를 처음부터 다시 컴파일했다. standard 와 함께 켜야 동작한다.
      codeCache: true,
    },
  },
]);

// 2) 보안 강화: 외부 URL 새창/이동 모두 차단
//    외부 브라우저 열기는 V2 Phase 3 에서 별도 allowlist adapter 로 처리합니다
//    (현재 정적 스캔이 shell.openExternal 직접 호출을 금지함).
const managedWorkBrowserContents = new WeakSet();
const workBrowser = createWorkBrowser({ BrowserWindow, WebContentsView, dialog, managedContents: managedWorkBrowserContents,
  trustedOrigin: (url) => url.origin === 'modycrew://app' || (url.protocol === 'modycrew:' && url.host === 'app') || (target.mode === 'dev' && url.origin === new URL(target.devUrl).origin),
});
ipcMain.handle('mody.work-browser.v1', (event, payload) => workBrowser.handle(event, payload));
ipcMain.handle('mody.metrics-export.v1', createWorkMetricsExport({ BrowserWindow, dialog, app,
  trustedOrigin: url => (url.protocol === 'modycrew:' && url.host === 'app') || (target.mode === 'dev' && url.origin === new URL(target.devUrl).origin),
}));
ipcMain.handle('mody.workspace-files.v1', createWorkspaceFiles({ BrowserWindow, dialog, shell,
  trustedOrigin: url => (url.protocol === 'modycrew:' && url.host === 'app') || (target.mode === 'dev' && url.origin === new URL(target.devUrl).origin),
}));
app.on('before-quit', () => workBrowser.dispose());
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    console.warn(`[modycrew-desktop] 외부 새창 요청 deny — ${url}`);
    return { action: "deny" };
  });

  contents.on("will-navigate", (navEvent, url) => {
    if (managedWorkBrowserContents.has(contents)) return;
    const isLocalDev = target.mode === "dev" && url.startsWith(target.devUrl);
    const isModycrew = url.startsWith("modycrew://");
    if (!isLocalDev && !isModycrew) {
      console.warn(`[modycrew-desktop] 외부 이동 deny — ${url}`);
      navEvent.preventDefault();
    }
  });
});

// 3) IPC 핸들러 등록
const receiptIpcAdapter = createReceiptIpcAdapter({
  app,
  BrowserWindow,
  dialog,
  shell,
  safeStorage,
  generateReceiptVision: (_event, input) =>
    generateReceiptVision(
      {
        prompt: input.prompt,
        images: input.images,
        provider: input.provider,
        receiptImageConsent: input.receiptImageConsent === true,
      },
      { app, safeStorage },
    ),
});
ipcMain.handle("mody.inbox.v1", (event, payload) =>
  handleInboxMessageWithAttention(event, payload, {
    shell,
    listConnectorStatuses: () =>
      handleConnectorMessage(event, { kind: "list" }, { app, dialog, safeStorage }),
    sendApprovalNotification: (input) =>
      sendTelegramApprovalNotification({ app, dialog, safeStorage }, input),
    recordActivity: (input = {}) =>
      handleSelectedWorkActionEventsMessage(event, { kind: "record", event: input }, { app }),
    executeProviderFinalAction: (input) =>
      executeProviderFinalAction(input, { app, dialog, safeStorage, smtpSender: createSmtpSender }),
  }),
);
ipcMain.handle("mody.local-workflow.v1", (event, payload) =>
  handleLocalWorkflowMessage(event, payload, { shell }),
);
ipcMain.handle("mody.receipt-agent.v1", (event, payload) =>
  receiptIpcAdapter(event, payload),
);
// 팀 공유 자료에 드라이브 파일 링크를 걸 때 쓰는 보기 전용 창구(연결 상태·파일 목록만).
ipcMain.handle("mody.google-drive.v1", (event, payload) =>
  handleGoogleDriveReadMessage(event, payload, { app, safeStorage, shell }),
);
ipcMain.handle("mody.document-production.v1", async (event, payload) => {
  const response = await handleDocumentProductionMessage(event, payload, { app, dialog, shell, BrowserWindow,
    generateText: (input) => handleMainAIProviderMessage(event, redactCompanyAIRequest(input), {codexBackendTimeoutMs:120_000}),
    readRecords: () => readSelectedWorkActionEventState({ app }),
    getCompanyContext: (input) => companyContext(input, { app }),
  });
  // 대화의 '문서 파일 만들기'가 저장한 문서는 사용자가 찾는 결과 폴더(D:\ModyCrew 결과\문서\<날짜 제목>)에도 복사해
  // 대화 결과 카드가 바로 보여 주게 한다. 문서 화면의 저장(copyToResults 없음)은 지금처럼 동작한다.
  if (payload?.kind !== "export" || payload?.copyToResults !== true || response?.status !== "saved" || !response?.document?.path) return response;
  try {
    const copied = await copyFileToResults({ file: response.document.path, title: response.document.title, category: "documents", getResultsRoot: crewResultsRoot });
    return { ...response, resultsFolder: copied.folder, resultFile: copied.file };
  } catch (error) {
    return { ...response, resultsCopyError: String(error?.message ?? error).slice(0, 160) };
  }
});
// 일상 도구: 날씨·교통·가격·공공·법령·뉴스 같은 공개 정보를 읽기 전용으로 조회한다.
// 고정 중계 서버에 GET 만 보내고, 경로·인자는 앱에 동봉한 카탈로그로만 검증한다.
const handleDailySkillsMessage = createDailySkillsHandler({ appVersion: app.getVersion() });
ipcMain.handle("mody.daily-skills.v1", (event, payload) => handleDailySkillsMessage(event, payload));
// 예약·배경 업무에서 일상 도구를 열 때 직원 역할이 허용한 분류만 쓴다(역할 정본은 도메인 패키지).
// 정본을 못 읽으면 닫는다 — 모르는 직원에게 넓게 열지 않는다.
let roleCapabilityModulePromise;
async function resolveBackgroundDailySkillCategories(task) {
  try {
    roleCapabilityModulePromise ??= import(pathToFileURL(path.join(path.dirname(domainEntryPath), "role-capabilities.js")).href);
    const { resolveTeammateRoleCapability } = await roleCapabilityModulePromise;
    const roleContext = task?.execution?.generation?.roleContext ?? {};
    const capability = resolveTeammateRoleCapability({
      id: roleContext.teammateId || task?.assigneeId || "",
      templateId: roleContext.templateId,
      builtinExpertId: roleContext.builtinExpertId,
    });
    return capability?.dailySkillCategories ?? [];
  } catch {
    return [];
  }
}
ipcMain.handle("mody.company-automation.v1", (event, payload) =>
  handleCompanyAutomationMessage(event, payload, { ...createCompanyAutomationOptions(event), runtime: getCompanyAutomationRuntime() }),
);
ipcMain.handle("mody.account.v1", handleAccountStatus);
ipcMain.handle("mody.google-auth.v1", (event, payload) =>
  handleGoogleAuthMessage(event, payload, { shell }),
);
ipcMain.handle("mody.connector.v1", (event, payload) =>
  isMailOpsChatSmoke && payload?.kind === "list"
    ? handleMailOpsChatSmokeConnectorMessage()
    : handleConnectorMessage(event, payload, {
        app,
        dialog,
        safeStorage,
        shell,
        requestDesktopControlAction: (input) =>
          handleDesktopControlMessage(
            event,
            { kind: "request", ...input },
            {
              dialog,
              appendInboxItems: appendAutomationInboxItems,
              upsertInboxItem: upsertAutomationInboxItem,
              getInboxSnapshot: getAutomationInboxSnapshot,
              captureScreenEvidence: (captureInput) =>
                captureDesktopScreenEvidence(captureInput, { desktopCapturer }),
              captureWebmailDomRows: (captureInput) =>
                captureWebmailDomRows(captureInput, { BrowserWindow }),
              enableLiveBrowserLimitedExecution: true,
              executeBrowserLimitedAction: (actionInput) =>
                executeBrowserLimitedAction(actionInput, { clipboard }),
            },
          ),
      }),
);
const mailAttachmentStagingLeaseTtlMs = 30 * 60 * 1000;
const mailAttachmentStagingLeaseLimit = 256;
const mailAttachmentStagingLeases = new Map();

function mailAttachmentStagingLeaseSenderId(event) {
  return Number.isInteger(event?.sender?.id) ? String(event.sender.id) : "";
}

function mailAttachmentStagingLeasePathKey(value) {
  const input = String(value ?? "").replace(/\0/g, "").trim();
  if (!input || !path.isAbsolute(input)) return "";
  return path.resolve(input).toLocaleLowerCase("ko-KR");
}

function pruneMailAttachmentStagingLeases() {
  const now = Date.now();
  for (const [leaseKey, lease] of mailAttachmentStagingLeases) {
    if (!lease || lease.expiresAt <= now) mailAttachmentStagingLeases.delete(leaseKey);
  }
}

function rememberMailAttachmentStagingLeases(event, result = {}) {
  const senderId = mailAttachmentStagingLeaseSenderId(event);
  if (!senderId) return;
  pruneMailAttachmentStagingLeases();
  for (const file of Array.isArray(result.files) ? result.files : []) {
    const absolutePath = String(file?.absolutePath ?? file?.path ?? "").trim();
    const pathKey = mailAttachmentStagingLeasePathKey(absolutePath);
    if (!pathKey) continue;
    mailAttachmentStagingLeases.set(`${senderId}:${pathKey}`, {
      senderId,
      absolutePath: path.resolve(absolutePath),
      pathKey,
      expiresAt: Date.now() + mailAttachmentStagingLeaseTtlMs,
    });
  }
  while (mailAttachmentStagingLeases.size > mailAttachmentStagingLeaseLimit) {
    const oldestKey = mailAttachmentStagingLeases.keys().next().value;
    if (oldestKey === undefined) break;
    mailAttachmentStagingLeases.delete(oldestKey);
  }
}

function resolveMailAttachmentStagingLeases(event, requestedPaths = []) {
  const senderId = mailAttachmentStagingLeaseSenderId(event);
  if (!senderId) return [];
  pruneMailAttachmentStagingLeases();
  const authorized = [];
  for (const value of Array.isArray(requestedPaths) ? requestedPaths : []) {
    const pathKey = mailAttachmentStagingLeasePathKey(value);
    const lease = pathKey
      ? mailAttachmentStagingLeases.get(`${senderId}:${pathKey}`)
      : undefined;
    if (lease?.expiresAt > Date.now()) authorized.push(lease.absolutePath);
  }
  return authorized;
}

async function resolveMainOwnedMailAttachmentDownloadPayload(event, payload = {}) {
  if (payload?.kind !== "download_imap_attachments") return payload;
  let localMemoryStatus = {};
  try {
    localMemoryStatus = await handleLocalMemoryMessage(
      event,
      { kind: "status" },
      { app },
    );
  } catch {
    // Fall back to the app-owned userData folder, never a renderer-provided path.
  }
  const mainOwnedRoot = path.resolve(
    localMemoryStatus.root ||
      localMemoryStatus.defaultRoot ||
      path.join(app.getPath("userData"), "mail-attachments"),
  );
  return {
    ...payload,
    localStorageRoot: mainOwnedRoot,
    downloadRootPath: undefined,
  };
}
ipcMain.handle("mody.mail-autodiscovery.v1", (_event, payload) =>
  handleMailAutodiscoveryMessage(payload, { repoRoot }),
);
ipcMain.handle("mody.mail-work-intake.v1", async (event, payload) => {
  const safePayload = await resolveMainOwnedMailAttachmentDownloadPayload(event, payload);
  const result = isMailOpsChatSmoke
    ? await handleMailOpsChatSmokeMessage(safePayload)
    : await handleMailWorkIntakeMessage(event, safePayload, {
        app,
        dialog,
        safeStorage,
        // 메일 초안 서명의 '앱 프로필 이름' 방식(계정별 명함·서명 없음은 메일 화면의 서명·말투 설정을 따른다).
        loadMailReplySignature: loadAppProfileDisplayName,
        recordActivity: (input = {}) =>
          handleSelectedWorkActionEventsMessage(event, { kind: "record", event: input }, { app }),
        saveWorkLearning: (input = {}) =>
          handleLocalMemoryMessage(event, { kind: "save_work_learning", ...input }, { app }),
        listWorkPatterns: () =>
          handleLocalMemoryMessage(event, { kind: "list_work_patterns" }, { app }),
        listConnectorStatuses: () =>
          handleConnectorMessage(event, { kind: "list" }, { app, dialog, safeStorage }),
        listTriggerSettings: () =>
          handleTriggerSettingsMessage(event, { kind: "list" }, { app }),
        getTriggerRunnerStatus: () =>
          handleTriggerRunnerMessage(event, { kind: "status" }, createTriggerRunnerOptions(event)),
        readSelectedWorkActionEvents: () => readSelectedWorkActionEventState({ app }),
      });
  if (safePayload?.kind === "download_imap_attachments") {
    rememberMailAttachmentStagingLeases(event, result);
  }
  return result;
});
const mailOpsChatSmokeState = {
  runMailWorkIntakeCalls: 0,
  payloads: [],
};
const aiPendingChatSmokeState = {
  oauthStarted: false,
  statusChecks: 0,
  startOAuthCalls: 0,
  generateTextCalls: 0,
  prompts: [],
  runtimeReceipts: [],
};
const aiPendingChatSmokeOutputMarker = `desktop-pending-chat-smoke-${Date.now()}`;
const aiPendingChatSmokeExpectedPrompt = "AI로 오늘 회의 메모 세 줄로 정리해줘";
const aiModelChatSmokeState = {
  statusChecks: 0,
  saveModelCalls: 0,
  generateTextCalls: 0,
  currentModel: "gpt-5.5",
  savedModels: [],
  generatedModels: [],
  prompts: [],
  runtimeReceipts: [],
};
const aiModelChatSmokeOutputMarker = `desktop-model-chat-smoke-${Date.now()}`;

async function handleMailOpsChatSmokeMessage(payload = {}) {
  mailOpsChatSmokeState.runMailWorkIntakeCalls += 1;
  mailOpsChatSmokeState.payloads.push({
    kind: payload.kind,
    limit: payload.limit,
    activityEventId: payload.activityEventId,
  });
  return {
    status: "imap_connected_ready_for_review",
    connectorId: "desktop-mailops-smoke",
    providerId: "imap_smtp",
    messageCount: 2,
    createdWorkItemsCount: 2,
    approvalQueueCount: 2,
    calendarBusyWindowCount: 1,
    ignoredItemsCount: 0,
    reviewItemsCount: 0,
    addedInboxItemsCount: 2,
    readOnly: true,
    userMessage: "메일 2건을 확인했고, 지금 볼 업무는 2건입니다.",
    approvalPreviews: [
      {
        id: "desktop-mailops-smoke-reply",
        workItemId: "desktop-mailops-smoke-reply-work",
        kind: "send_email",
        title: "거래처 답장 초안",
        sourceLabel: "회사 메일",
        status: "approval_pending",
        countLabel: "1건",
        badge: "답장",
        draftBody: "문의 주셔서 감사합니다. 요청하신 자료와 가능한 일정을 확인해 답장드립니다.",
        summary: "답장과 일정 후보를 앱 안에서 먼저 확인합니다.",
        requiresFinalUserPresence: true,
        checklist: ["초안 보기", "수정 요청", "발송 전 최종 확인"],
      },
      {
        id: "desktop-mailops-smoke-calendar",
        workItemId: "desktop-mailops-smoke-calendar-work",
        kind: "create_calendar_event",
        title: "일정 후보 확인",
        sourceLabel: "회사 메일",
        status: "approval_pending",
        countLabel: "1건",
        badge: "일정",
        summary: "메일에서 감지한 일정 후보입니다. 등록은 최종 확인 전까지 잠겨 있습니다.",
        requiresFinalUserPresence: true,
        timeRangeLabel: "다음 주 오후",
        checklist: ["시간 확인", "수정 요청", "등록 전 최종 확인"],
      },
    ],
    workAnalysis: {
      summary: "문의 메일은 답장 초안과 일정 후보를 함께 준비하는 방식이 맞습니다.",
      stats: {
        totalMessages: 2,
        workItems: 2,
        approvalCandidates: 2,
        replyCandidates: 1,
        calendarCandidates: 1,
        reviewItems: 0,
      },
      workingStyle: ["문의 답장은 감사 인사와 다음 행동을 짧게 정리"],
      replyToneGuidance: ["정중하고 짧은 답장"],
      scheduleGuidance: ["일정 등록은 사용자 승인 후 진행"],
      improvementSuggestions: ["자주 반복되는 문의는 다음부터 이렇게 하기 후보로 저장"],
      automationOpportunities: ["매일 오전 메일 점검 반복 업무 후보"],
      approvalPolicy: ["발송/일정 등록 전 항상 승인"],
      riskNotes: ["메일은 읽기 전용, 외부 발송 없음"],
    },
    learningStatus: "local_memory_work_learning_saved",
    workPatternCount: 1,
    addedWorkPatternCount: 1,
    activityAuditFile: "memory/activity/mailops-smoke.json",
    auditMessages: [
      "메일은 읽기 전용으로 확인했습니다.",
      "답장 발송, 캘린더 등록, 메일 이동/삭제는 실행하지 않았습니다.",
    ],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    appMayPersistSecret: false,
  };
}

async function handleMailOpsChatSmokeConnectorMessage() {
  const now = new Date().toISOString();
  const base = {
    method: "smoke",
    status: "ready",
    lastCheckedAt: now,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  return {
    status: "connector_status_ready",
    connectors: [
      {
        ...base,
        connectorId: "company-mail",
        category: "mail",
        siteLabel: "회사 메일",
        userMessage: "메일 점검 smoke용 읽기 전용 연결 준비 상태입니다.",
      },
      {
        ...base,
        connectorId: "google-calendar",
        category: "calendar",
        siteLabel: "Google Calendar",
        permissions: { calendarWrite: false, messengerReport: false },
        userMessage: "메일 점검 smoke용 일정 읽기 연결 준비 상태입니다.",
      },
    ],
    userMessage: "메일 점검 smoke용 연결 상태를 불러왔습니다.",
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

ipcMain.handle("mody.ai-provider.v1", handleMainAIProviderMessage);

let automaticModelMaintenanceRef = null;
let automaticModelMaintenanceInit = null;
let automaticModelMaintenanceError = false;
function getAutomaticModelMaintenance() {
  automaticModelMaintenanceInit ??= createAIProviderModelMaintenance({
    app, handleAIProviderMessage,
    providerOptions: { safeStorage, shell, usageTrackingScope: "personal_device" },
    getRequiredCapabilities: () => ["response", "stream", "tool_call"],
    probeStreaming: ({ provider, model, nonce, signal }) => handleAIProviderMessage(null,
      { kind: "maintenance_protocol_probe", provider, model, nonce, mode: "stream" },
      { app, safeStorage, shell, allowMaintenanceProbe: true, abortSignal: signal }),
    probeToolCall: ({ provider, model, nonce, signal }) => handleAIProviderMessage(null,
      { kind: "maintenance_protocol_probe", provider, model, nonce, mode: "tool_call" },
      { app, safeStorage, shell, allowMaintenanceProbe: true, abortSignal: signal }),
    isPaused: () => isExplicitQuit || ["sleeping", "stopped"].includes(backgroundService.snapshot().state)
      || existsSync(path.join(app.getPath("userData"), "maintenance.paused"))
      || (process.platform === "win32" && existsSync("D:\\Mody\\operations\\always-on\\paused.flag")),
  }).then(service => { automaticModelMaintenanceRef = service; return service; }).catch(error => {
    automaticModelMaintenanceError = true;
    throw error;
  });
  return automaticModelMaintenanceInit;
}
if (app.isPackaged && hasPackagedSingleInstanceLock) configureAIModelMaintenance({
  scope: () => path.join(app.getPath("userData"), "ai-provider-vault.json"),
  getStatus: () => {
    const status = automaticModelMaintenanceRef?.getStatus();
    return status ? { lastStatus: status.lastStatus, lastCheckedAt: status.lastCheckedAt, nextCheckAt: status.nextCheckAt,
      providers: Object.values(status.providers).map(({ provider, preference, verifiedModel, status: state, reason, lastProbe }) => ({ provider, preference, verifiedModel, state, reason, lastProbe })) }
      : { lastStatus: automaticModelMaintenanceError ? "initialization_failed" : "starting" };
  },
  check: async options => (await getAutomaticModelMaintenance()).check(options),
  resolveModel: async connection => {
    const service = await getAutomaticModelMaintenance();
    let model = service.resolveModel(connection);
    if (!model) { await service.check({ force: true }); model = service.resolveModel(connection); }
    return model;
  },
});

async function handleMainAIProviderMessage(event, payload = {}, runtimeOptions = {}) {
  if (isCompanyWorkspaceAIRequest(payload)) {
    return generateCompanyWorkspaceText(event, payload, { app, safeStorage, shell }, handleAIProviderMessage);
  }
  const startedAt = new Date().toISOString();
  const runtimeRouting = await resolveMainAgentRuntimeRouting(payload).catch(() => ({
    payload,
    agentRouting: null,
  }));
  const effectivePayload = runtimeRouting?.payload ?? payload;
  const agentRunAuthorization = await prepareMainAgentRunAuthorization(event, effectivePayload).catch(() => ({
    status: "agent_run_authorization_unavailable",
    verified: false,
    rawSecretMaterialReturned: false,
  }));
  try {
    const result = isAIModelChatSmoke
      ? await handleAIModelChatSmokeProviderMessage(effectivePayload)
      : isAIPendingChatSmoke || isFreshProfileFirstChatSmoke
        ? await handleAIPendingChatSmokeProviderMessage(effectivePayload)
        : await handleAIProviderMessage(event, effectivePayload, { app, safeStorage, shell, ...runtimeOptions, usageTrackingScope: "personal_device" });
    const routedResult = runtimeRouting?.agentRouting
      ? { ...result, agentRouting: runtimeRouting.agentRouting }
      : result;
    return await attachMainAgentRunReceipt(
      event,
      effectivePayload,
      routedResult,
      startedAt,
      agentRunAuthorization,
    );
  } catch (error) {
    await attachMainAgentRunReceipt(
      event,
      effectivePayload,
      {
        status: "generate_content_failed",
        provider: String(effectivePayload?.provider ?? ""),
        model: String(effectivePayload?.model ?? ""),
        outputText: "",
        ...(runtimeRouting?.agentRouting ? { agentRouting: runtimeRouting.agentRouting } : {}),
      },
      startedAt,
      agentRunAuthorization,
    ).catch(() => undefined);
    throw error;
  }
}

async function resolveMainAgentRuntimeRouting(payload = {}) {
  const loaded = await handleLocalMemoryMessage(
    null,
    { kind: "load_app_profile" },
    createLocalMemoryOptions(null),
  );
  return prepareAgentOrganizationRuntimeRoute(
    { payload, profile: loaded?.profile },
    {
      routeRequest: ({ requestText, allowedTeammateIds }) =>
        handleAgentOrgMessage(
          null,
          { kind: "route_work_request", requestText, allowedTeammateIds },
          { app, dialog, BrowserWindow, shell, repoRoot },
        ),
      verifyTarget: ({ targetTeammateId, workPackId }) =>
        resolveLocalMemoryAuthoritativeAgentRunTarget(
          { targetTeammateId, workPackId },
          { app },
        ),
      resolveLearnedAssignment: (input) =>
        resolveLocalMemoryLearnedWorkAssignment(input, { app }),
    },
  );
}

async function prepareMainAgentRunAuthorization(event, payload = {}) {
  const context = payload?.agentRunContext;
  if (
    !context ||
    typeof context !== "object" ||
    !["generate_text", "generate_text_stream"].includes(String(payload?.kind ?? ""))
  ) {
    return undefined;
  }
  const targetTeammateId = String(context.targetTeammateId ?? "");
  const workPackId = String(context.workPackId ?? "");
  const roleContextTeammateId = String(payload?.roleContext?.teammateId ?? "");
  if (!targetTeammateId || targetTeammateId !== roleContextTeammateId) {
    return { status: "agent_run_authority_role_mismatch", verified: false, rawSecretMaterialReturned: false };
  }
  const target = await resolveLocalMemoryAuthoritativeAgentRunTarget(
    { targetTeammateId, workPackId },
    { app },
  );
  if (target?.verified !== true) {
    return {
      status: target?.status || "agent_run_authority_target_rejected",
      verified: false,
      rawSecretMaterialReturned: false,
    };
  }
  return issueMainAgentRunAuthorization(
    {
      artifactKind: "report",
      sourceTeammateId: String(context.sourceTeammateId ?? ""),
      targetTeammateId: target.targetTeammateId,
      workPackId: target.workPackId,
      sourceKind: "delegated_channel",
      roleContextTeammateId,
      profileSnapshotSha256: target.profileSnapshotDigest,
      senderId: event?.sender?.id,
      prompt: payload?.prompt,
    },
    { app },
  );
}

async function attachMainAgentRunReceipt(
  event,
  payload = {},
  result = {},
  startedAt,
  agentRunAuthorization,
) {
  if (!agentRunAuthorization) return result;
  if (agentRunAuthorization.verified !== true || !agentRunAuthorization.authorizationId) {
    return { ...result, agentRunReceipt: agentRunAuthorization };
  }
  let receipt;
  try {
    receipt = await recordMainAgentRunResult(
      {
        authorizationId: agentRunAuthorization.authorizationId,
        senderId: event?.sender?.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        runStatus:
          result?.status === "generate_content_loaded" && Boolean(result?.outputText)
            ? "done"
            : "error",
        outputText: result?.outputText,
        provider: result?.provider,
        model: result?.model,
        runtimeRoute: result?.aiRuntimeRouter?.finalRoute ?? result?.runtime ?? "",
      },
      { app },
    );
  } catch {
    receipt = {
      status: "agent_run_ledger_unavailable",
      verified: false,
      rawSecretMaterialReturned: false,
    };
  }
  return { ...result, agentRunReceipt: receipt };
}

function createAIPendingChatSmokeProvider(status) {
  const connected = status === "codex_oauth_ready" || status === "codex_oauth_detected";
  return {
    status,
    provider: "codex_oauth",
    model: "gpt-5.5",
    hasLocalKey: connected,
    keyFingerprint:
      status === "codex_oauth_ready"
        ? "desktop-pending-ready"
        : status === "codex_oauth_detected"
          ? "desktop-pending-detected"
          : undefined,
    authMode: "codex_oauth",
    updatedAt: new Date().toISOString(),
    userMessage:
      status === "codex_oauth_ready"
        ? "AI 답변 연결 완료 - 보관된 요청을 이어서 처리할 수 있습니다."
        : status === "codex_oauth_detected"
          ? "기존 AI 로그인 흔적이 있어 로컬 답변 경로를 시도할 수 있습니다."
          : "AI 답변 연결이 아직 필요합니다.",
    rawSecretMaterialStored: false,
  };
}

function createAIPendingChatSmokeText(prompt) {
  const text = String(prompt ?? "");
  if (/회의\s*메모|회의.*세\s*줄|meeting\s*memo/iu.test(text)) {
    return "회의 메모를 세 줄로 정리했습니다.\n- 결정 사항\n- 다음 행동\n- 확인할 일정";
  }
  if (/^(?:안녕|안녕하세요|하이|hello|hi)[!?？\s.。]*$/iu.test(text.trim())) {
    return "안녕하세요. 바로 도와드릴게요. 필요한 일을 한 문장으로 편하게 말해 주세요.";
  }
  if (/메일|문의/u.test(text)) {
    return "확인할 메일 범위를 알려주시면 읽기 전용으로 점검하고 필요한 답장 후보만 정리할게요.";
  }
  return "좋아요. 요청을 확인했어요. 지금 필요한 답부터 짧게 정리해드릴게요.";
}

function withSmokeAITextRuntimeReceipt(result = {}) {
  const answerReady = result.status === "generate_content_loaded" && Boolean(result.outputText);
  const finalRoute = result.aiRuntimeRouter?.finalRoute ?? (
    result.runtime === "codex_cli"
      ? "codex_cli"
      : result.provider === "openai"
        ? "openai_api"
        : result.provider === "gemini"
          ? "gemini_api"
          : result.provider === "codex_oauth"
            ? "codex_oauth"
            : "setup_recovery"
  );
  const attemptedRoutes = Array.isArray(result.aiRuntimeRouter?.attemptedRoutes) && result.aiRuntimeRouter.attemptedRoutes.length
    ? result.aiRuntimeRouter.attemptedRoutes
    : [finalRoute];
  const aiRuntimeRouter = {
    routeOrder: ["codex_oauth", "codex_cli", "openai_api", "gemini_api", "setup_recovery"],
    attemptedRoutes,
    finalRoute,
    failClosed: !answerReady,
    recoveryRequired: !answerReady,
    recoveryReason: answerReady ? "" : String(result.status ?? "answer_generation_blocked"),
  };
  const fallbackUsed = Boolean(
    result.fallbackFrom ||
      result.fallbackFromModel ||
      result.previousFailureStatus ||
      result.runtime === "codex_cli" ||
      attemptedRoutes.length > 1,
  );
  const userNextAction = answerReady
    ? "이 채팅창에 바로 다음 요청을 입력할 수 있습니다."
    : "AI 연결을 다시 확인한 뒤 방금 요청을 이어서 처리하세요.";
  const recoverySummary = answerReady
    ? "앱 안 AI 답변 경로가 실제 응답을 반환했습니다."
    : "연결됨 표시와 별개로 실제 답변 생성이 막혀 복구 선택지가 필요합니다.";
  return {
    ...result,
    aiRuntimeRouter,
    answerReady,
    fallbackUsed,
    userNextAction,
    recoverySummary,
    aiRuntimeReceipt: {
      status: result.status ?? "unknown",
      provider: result.provider ?? "",
      model: result.model ?? "",
      runtime: result.runtime ?? "direct",
      answerReady,
      fallbackUsed,
      diagnosticStage: result.diagnosticStage ?? (answerReady ? "answer_generated" : "answer_generation_blocked"),
      previousFailureStatus: result.previousFailureStatus ?? "",
      userNextAction,
      recoverySummary,
      routeOrder: aiRuntimeRouter.routeOrder,
      attemptedRoutes: aiRuntimeRouter.attemptedRoutes,
      finalRoute: aiRuntimeRouter.finalRoute,
      failClosed: aiRuntimeRouter.failClosed,
      recoveryRequired: aiRuntimeRouter.recoveryRequired,
      recoveryReason: aiRuntimeRouter.recoveryReason,
      canRetryPendingRequest: !answerReady,
      externalMutation: false,
      rawSecretMaterialReturned: false,
    },
  };
}

async function handleAIPendingChatSmokeProviderMessage(payload = {}) {
  const kind = String(payload.kind ?? "");
  if (kind === "status") {
    aiPendingChatSmokeState.statusChecks += 1;
    return {
      status: "ai_provider_status_loaded",
      providers: [
        createAIPendingChatSmokeProvider(
          aiPendingChatSmokeState.oauthStarted ? "codex_oauth_ready" : "codex_oauth_not_connected",
        ),
      ],
    };
  }
  if (kind === "start_oauth") {
    aiPendingChatSmokeState.oauthStarted = true;
    aiPendingChatSmokeState.startOAuthCalls += 1;
    return {
      ...createAIPendingChatSmokeProvider("codex_oauth_ready"),
      status: "codex_oauth_login_started",
      authorizationUrl: "https://auth.openai.com/oauth/authorize?client_id=modycrew-desktop-smoke",
      callbackUrl: "http://localhost:1455/auth/callback",
      externalUrlOpened: false,
      diagnosticStage: "browser_login_waiting",
      userMessage: "AI 로그인 링크를 준비했습니다. 인증 완료 후 보관된 요청을 이어서 처리합니다.",
      recoveryActions: ["AI 로그인 링크 열기", "되돌아오기 주소 확인", "상태 확인"],
    };
  }
  if (kind === "save_model") {
    return createAIPendingChatSmokeProvider(
      aiPendingChatSmokeState.oauthStarted ? "codex_oauth_ready" : "codex_oauth_detected",
    );
  }
  if (kind === "generate_text" || kind === "generate_text_stream") {
    const outputText = createAIPendingChatSmokeText(payload.prompt);
    aiPendingChatSmokeState.generateTextCalls += 1;
    aiPendingChatSmokeState.prompts.push(String(payload.prompt ?? ""));
    const result = withSmokeAITextRuntimeReceipt({
      status: "generate_content_loaded",
      provider: "codex_oauth",
      runtime: "desktop_pending_chat_smoke",
      model: "gpt-5.5",
      outputText,
      outputChars: outputText.length,
      promptChars: String(payload.prompt ?? "").length,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
    aiPendingChatSmokeState.runtimeReceipts.push({
      prompt: String(payload.prompt ?? "").replace(/\s+/gu, " ").trim().slice(0, 500),
      promptIncludesExpectedRequest: String(payload.prompt ?? "").includes(aiPendingChatSmokeExpectedPrompt),
      ...result.aiRuntimeReceipt,
    });
    return result;
  }
  return {
    status: "desktop_pending_chat_smoke_ignored",
    provider: "codex_oauth",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createAIModelChatSmokeProvider(status = "codex_oauth_ready") {
  return {
    status,
    provider: "codex_oauth",
    model: aiModelChatSmokeState.currentModel,
    hasLocalKey: true,
    keyFingerprint: "desktop-model-chat-ready",
    authMode: "codex_oauth",
    updatedAt: new Date().toISOString(),
    userMessage: `AI 답변 연결 완료 - ${aiModelChatSmokeState.currentModel} 모델로 답변할 수 있습니다.`,
    rawSecretMaterialStored: false,
  };
}

async function handleAIModelChatSmokeProviderMessage(payload = {}) {
  const kind = String(payload.kind ?? "");
  if (kind === "status") {
    aiModelChatSmokeState.statusChecks += 1;
    return {
      status: "ai_provider_status_loaded",
      providers: [createAIModelChatSmokeProvider()],
    };
  }
  if (kind === "save_model") {
    const nextModel = String(payload.payload?.model ?? payload.model ?? "").trim() || aiModelChatSmokeState.currentModel;
    aiModelChatSmokeState.currentModel = nextModel;
    aiModelChatSmokeState.saveModelCalls += 1;
    aiModelChatSmokeState.savedModels.push(nextModel);
    return {
      ...createAIModelChatSmokeProvider(),
      status: "model_updated",
      model: nextModel,
      userMessage: `Codex 답변 모델을 ${nextModel}로 저장했습니다.`,
    };
  }
  if (kind === "generate_text" || kind === "generate_text_stream") {
    const selectedModel = String(payload.model ?? "").trim() || aiModelChatSmokeState.currentModel;
    const promptText = String(payload.prompt ?? "");
    aiModelChatSmokeState.generateTextCalls += 1;
    aiModelChatSmokeState.generatedModels.push(selectedModel);
    aiModelChatSmokeState.prompts.push(promptText);
    const result = withSmokeAITextRuntimeReceipt({
      status: "generate_content_loaded",
      provider: "codex_oauth",
      runtime: "desktop_model_chat_smoke",
      model: selectedModel,
      outputText: "좋아요. 지금 선택한 답변 엔진으로 자연스럽게 이어서 대화할 수 있어요.",
      outputChars: 40,
      promptChars: promptText.length,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
    aiModelChatSmokeState.runtimeReceipts.push({
      prompt: promptText.replace(/\s+/gu, " ").trim().slice(0, 500),
      promptIncludesModelRequest: promptText.includes("지금 선택한 모델로 한 문장 답해줘"),
      promptIncludesRecoveryRequest: promptText.includes("AI 모델은 연결됐는데 대화가 안돼"),
      ...result.aiRuntimeReceipt,
    });
    return result;
  }
  return {
    status: "desktop_model_chat_smoke_ignored",
    provider: "codex_oauth",
    model: aiModelChatSmokeState.currentModel,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function getWorkspaceSkillRuntime() {
  if (!workspaceSkillRuntimeRef) {
    workspaceSkillRuntimeRef = createWorkspaceSkillRuntime({
      app,
      userDataPath: app.getPath("userData"),
      workspaceId: "local_desktop",
      resourcesPath: app.isPackaged
        ? process.resourcesPath
        : path.join(
            repoRoot,
            "apps",
            "modycrew-desktop",
            "resources",
          ),
      trustedCatalogHosts: builtInWorkspaceSkillTrustedHosts,
      trustedCatalogManifest: { catalog: builtInWorkspaceSkillCatalog },
    });
  }
  return workspaceSkillRuntimeRef;
}

function withLocalWorkspaceId(request = {}) {
  return { ...request, workspaceId: "local_desktop" };
}
async function confirmContinuousDocumentLearningSource(request = {}) {
  const policy = request.policy && typeof request.policy === "object" ? request.policy : {};
  const label = String(request.label ?? "업무 폴더").replace(/\s+/gu, " ").trim().slice(0, 120) || "업무 폴더";
  const maxFiles = Math.max(1, Math.min(30, Number(policy.maxFiles) || 30));
  const options = {
    type: "question",
    title: "폴더 지속 학습 켜기",
    message: `'${label}'의 새 업무 자료를 계속 학습할까요?`,
    detail:
      `원본은 바꾸지 않고 한 번에 최대 ${maxFiles}개 지원 파일만 읽습니다.\n` +
      "앱에서 언제든 일시정지하거나 연결을 해제할 수 있습니다.",
    buttons: ["자동 학습 켜기", "이번만 읽기"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    normalizeAccessKeys: true,
  };
  const parentWindow =
    [officeWindowRef, mainWindowRef].find((win) => win && !win.isDestroyed?.()) ||
    BrowserWindow.getFocusedWindow();
  const result = parentWindow && !parentWindow.isDestroyed?.()
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  return {
    approved: result.response === 0,
    approvalPurpose: "continuous_watch",
  };
}

async function learnApprovedDocumentSnapshot(files, sourceInfo = {}) {
  const localMemoryOptions = createLocalMemoryOptions(null);
  const memoryStatus = await handleLocalMemoryMessage(
    null,
    { kind: "status" },
    localMemoryOptions,
  );
  const localStorageRoot =
    memoryStatus.root ||
    memoryStatus.defaultRoot ||
    path.join(app.getPath("userData"), "ModyCrew_Local_Data");
  return handleDocumentLearningMessage(
    null,
    {
      kind: "classify",
      workspaceId: "local_desktop",
      localStorageRoot,
      files,
      trustedSupervisorSnapshot: true,
      snapshotDigest: String(sourceInfo.snapshotDigest ?? ""),
      acceptedContentSha256s: Array.isArray(sourceInfo.acceptedContentSha256s)
        ? [...sourceInfo.acceptedContentSha256s]
        : [],
      signal: sourceInfo.signal,
      searchQuery: "일정 보고서 문의 정산 계약 반복 업무",
    },
    {
      ...localMemoryOptions,
      repoRoot,
      domainEntryPath,
      trustedFileSelection: true,
      trustedDocumentLearningSupervisorSnapshot: true,
      recordActivity: (input = {}) =>
        handleSelectedWorkActionEventsMessage(
          null,
          { kind: "record", event: input },
          { app },
        ),
    },
  );
}

async function verifyPersistedTeammateProposal(event, request = {}) {
  const proposal =
    sanitizeDocumentLearningSupervisorTeammateProposal(request.proposal);
  if (
    !proposal ||
    proposal.sourceId !== String(request.sourceId ?? "") ||
    proposal.draftId !== String(request.draftId ?? "") ||
    proposal.proposalId !== String(request.proposalId ?? "")
  ) {
    return {
      verified: false,
      status: "document_learning_teammate_profile_receipt_invalid",
      rawSecretMaterialReturned: false,
    };
  }

  const loadMatchingTeammates = async () => {
    const loaded = await handleLocalMemoryMessage(
      event,
      { kind: "load_app_profile" },
      createLocalMemoryOptions(event),
    );
    return Array.isArray(loaded?.profile?.teammates)
      ? loaded.profile.teammates.filter((teammate) =>
          isPersistedTeammateBoundToProposal(teammate, proposal),
        )
      : [];
  };

  const matchingBeforeConfirmation = await loadMatchingTeammates();
  if (matchingBeforeConfirmation.length !== 1) {
    return {
      verified: false,
      status: "document_learning_teammate_profile_receipt_missing",
      proposalId: proposal.proposalId,
      rawSecretMaterialReturned: false,
    };
  }

  const parentWindow =
    event?.sender && typeof BrowserWindow.fromWebContents === "function"
      ? BrowserWindow.fromWebContents(event.sender)
      : null;
  if (!parentWindow || parentWindow.isDestroyed?.()) {
    return {
      verified: false,
      status: "document_learning_teammate_profile_confirmation_unavailable",
      proposalId: proposal.proposalId,
      rawSecretMaterialReturned: false,
    };
  }

  const confirmation = await dialog.showMessageBox(parentWindow, {
    type: "question",
    title: "학습 기반 AI 직원 완료 확인",
    message:
      proposal.draft.name + " 직원을 이 폴더 학습 제안으로 확정할까요?",
    detail: [
      "역할: " + proposal.draft.roleTitle,
      "담당 채널: " + proposal.draft.channelName,
      "직원 프로필은 로컬 기억에 저장됩니다.",
      "추천 자동화는 꺼진 상태로 유지되며, 외부 발송·일정 등록·파일 변경은 각각 다시 승인받습니다.",
    ].join("\n"),
    buttons: ["직원 제안 완료", "취소"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    normalizeAccessKeys: true,
  });
  if (confirmation.response !== 0) {
    return {
      verified: false,
      status: "document_learning_teammate_profile_confirmation_cancelled",
      proposalId: proposal.proposalId,
      rawSecretMaterialReturned: false,
    };
  }

  const matchingAfterConfirmation = await loadMatchingTeammates();
  const teammate = matchingAfterConfirmation.length === 1
    ? matchingAfterConfirmation[0]
    : null;
  return {
    verified: Boolean(teammate),
    userConfirmationVerified: Boolean(teammate),
    status: teammate
      ? "document_learning_teammate_profile_receipt_verified"
      : "document_learning_teammate_profile_receipt_changed",
    proposalId: proposal.proposalId,
    teammateId: teammate ? String(teammate.id ?? "") : "",
    rawSecretMaterialReturned: false,
  };
}

function isPersistedTeammateBoundToProposal(teammate, proposal) {
  const draft = proposal?.draft;
  if (!teammate || !draft) return false;
  return (
    teammate.originProposalId === proposal.proposalId &&
    teammate.templateId === draft.suggestedTemplateId &&
    teammate.name === draft.name &&
    teammate.teamLabel === draft.teamLabel &&
    teammate.roleTitle === draft.roleTitle &&
    teammate.channelName === draft.channelName &&
    teammate.brief === draft.brief
  );
}

function getDocumentLearningSupervisor() {
  if (!documentLearningSupervisorRef) {
    documentLearningSupervisorRef = createDocumentLearningSupervisor({
      app,
      userDataPath: app.getPath("userData"),
      confirmSource: confirmContinuousDocumentLearningSource,
      learnFiles: learnApprovedDocumentSnapshot,
      maxFiles: 30,
      globalConcurrency: 1,
    });
  }
  return documentLearningSupervisorRef;
}
function createLocalMemoryOptions(event = null) {
  const workspaceSkillRuntime = getWorkspaceSkillRuntime();
  const approvalLedgerOptions = {
    app,
    isApprovalSenderAllowed: (senderId) =>
      isTrustedAgentRunOutcomeApprovalSender(event?.sender, senderId),
  };
  return {
    app,
    domainEntryPath,
    dialog,
    BrowserWindow,
    shell,
    confirmWorkspaceSkillInstall: (request) =>
      showWorkspaceSkillConsentDialog(event, request, "install"),
    confirmWorkspaceSkillActivation: (request) =>
      showWorkspaceSkillConsentDialog(event, request, "activate"),
    downloadCatalogSkill: (request) =>
      workspaceSkillRuntime.downloadCatalogSkill(withLocalWorkspaceId(request)),
    installCatalogSkill: (request) =>
      workspaceSkillRuntime.installCatalogSkill(withLocalWorkspaceId(request)),
    activateCatalogSkill: (request) =>
      workspaceSkillRuntime.activateCatalogSkill(withLocalWorkspaceId(request)),
    inspectCatalogSkillInstallAttempt: (request) =>
      workspaceSkillRuntime.inspectCatalogSkillInstallAttempt(withLocalWorkspaceId(request)),
    inspectCatalogSkillActivationAttempt: (request) =>
      workspaceSkillRuntime.inspectCatalogSkillActivationAttempt(withLocalWorkspaceId(request)),
    inspectWorkspaceSkillRuntime: (request) =>
      workspaceSkillRuntime.inspectWorkspaceSkillRuntime(withLocalWorkspaceId(request)),
    loadVerifiedSkillCatalog: () => workspaceSkillRuntime.loadVerifiedSkillCatalog(),
    loadActiveSkillPromptContext: (request) =>
      workspaceSkillRuntime.loadActiveSkillPromptContext(withLocalWorkspaceId(request)),
    resolveTrustedWorkspaceAgentOutcome: (request) =>
      resolveMainAgentRunArtifact(
        {
          ...request,
          senderId: event?.sender?.id,
        },
        { app },
      ),
    prepareTrustedWorkspaceAgentOutcomeApproval: (request) =>
      prepareTrustedWorkspaceAgentOutcomeApproval(event, request, approvalLedgerOptions),
    finalizeTrustedWorkspaceAgentOutcome: (request) =>
      finalizeMainAgentRunOutcome(
        {
          ...request,
          senderId: event?.sender?.id,
        },
        approvalLedgerOptions,
      ),
    recordAgentOrganizationPerformance: (record) =>
      handleAgentOrgMessage(
        event,
        { kind: "record_performance", record },
        { app, dialog, BrowserWindow, shell, repoRoot },
      ),
  };
}

function isTrustedAgentRunOutcomeApprovalSender(sender, senderId) {
  return Boolean(
    sender &&
      sender.id === senderId &&
      [mainWindowRef, officeWindowRef].some(
        (win) => win && !win.isDestroyed?.() && win.webContents === sender,
      ),
  );
}

async function prepareTrustedWorkspaceAgentOutcomeApproval(event, request = {}, ledgerOptions = {}) {
  const sender = event?.sender;
  const senderId = sender?.id;
  if (!isTrustedAgentRunOutcomeApprovalSender(sender, senderId)) {
    return { verified: false, status: "agent_run_outcome_approval_sender_rejected" };
  }
  const candidate = { ...request, senderId };
  const existing = await probeMainAgentRunOutcomeApproval(candidate, ledgerOptions);
  if (existing?.verified === true) return existing;
  const confirmed = await showAgentRunOutcomeNativeConfirmation(event, candidate);
  if (!confirmed) {
    return { verified: false, status: "agent_run_outcome_approval_cancelled" };
  }
  return prepareMainAgentRunOutcomeApproval(candidate, ledgerOptions);
}

async function showAgentRunOutcomeNativeConfirmation(event, request = {}) {
  const decisionLabel =
    request.decision === "approved"
      ? "\uc2b9\uc778"
      : request.decision === "change_requested"
        ? "\uc218\uc815 \uc694\uccad"
        : request.decision === "rejected"
          ? "\uac70\uc808"
          : "\uacb0\uc815";
  const options = {
    type: "question",
    title: "AI \ud300\uc6d0 \uacb0\uacfc \ucd5c\uc885 \ud655\uc778",
    message: `\uc774 AI \ud300\uc6d0 \uacb0\uacfc\ub97c '${decisionLabel}'\uc73c\ub85c \uae30\ub85d\ud560\uae4c\uc694?`,
    detail:
      "\uc774 \uacb0\uc815\uc740 \uc5c5\ubb34 \ud559\uc2b5 \uae30\ub85d\uc5d0\ub9cc \ubc18\uc601\ud569\ub2c8\ub2e4. \uc2e4\uc81c \uc678\ubd80 \ubc1c\uc1a1\u00b7\ub4f1\ub85d\u00b7\uc0ad\uc81c\u00b7\uc81c\ucd9c\uc740 \ubcc4\ub3c4\uc758 \ub9c8\uc9c0\ub9c9 \ud655\uc778 \uc5c6\uc774\ub294 \uc2e4\ud589\ub418\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
    buttons: ["\uacb0\uc815 \uae30\ub85d", "\ucde8\uc18c"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    normalizeAccessKeys: true,
  };
  const parentWindow =
    (event?.sender && BrowserWindow.fromWebContents(event.sender)) ||
    BrowserWindow.getFocusedWindow();
  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

async function showWorkspaceSkillConsentDialog(event, request = {}, mode) {
  const skill = request.skill && typeof request.skill === "object"
    ? request.skill
    : {};
  const isActivation = mode === "activate";
  const title = isActivation
    ? "업무 도구 사용 시작 확인"
    : "업무 도구 다운로드 확인";
  const primaryLabel = isActivation ? "이 팀원에게 사용" : "1회 다운로드 허용";
  const permissionLines = isActivation
    ? [
        `담당 AI 팀원: ${String(request.targetAgentId ?? "선택 필요")}`,
        "설치와 사용 시작은 별도 승인입니다.",
      ]
    : [
        `배포자: ${String(skill.publisher ?? "확인 필요")}`,
        `버전: ${String(skill.version ?? "확인 필요")} · 라이선스: ${String(skill.license ?? "확인 필요")}`,
        `요청 권한: ${formatWorkspaceSkillPermissionList(skill.requestedCapabilities)}`,
        `네트워크: ${formatWorkspaceSkillPermissionList(skill.requestedNetworkHosts, "없음")}`,
        `폴더 범위: ${skill.requestedFolderScope === "selected_workspace_only" ? "사용자가 선택한 업무 폴더만" : "폴더 접근 없음"}`,
        "이 확인은 표시된 버전과 권한 범위의 1회 다운로드에만 적용됩니다.",
        "다운로드 뒤에도 담당 AI 팀원에게 사용하려면 다시 확인합니다.",
      ];
  const options = {
    type: "question",
    title,
    message:
      String(request.userQuestion ?? "").trim() ||
      (isActivation
        ? `${String(skill.title ?? "업무 도구")}을(를) 선택한 AI 팀원에게 사용할까요?`
        : `${String(skill.title ?? "업무 도구")}을(를) 다운로드할까요?`),
    detail: permissionLines.join("\n"),
    buttons: [primaryLabel, "취소"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    normalizeAccessKeys: true,
  };
  const parentWindow =
    (event?.sender && BrowserWindow.fromWebContents(event.sender)) ||
    BrowserWindow.getFocusedWindow();
  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

function formatWorkspaceSkillPermissionList(value, emptyLabel = "없음") {
  const items = Array.isArray(value)
    ? value
        .map((item) => String(item ?? "").replace(/\s+/gu, " ").trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return items.length ? items.join(", ") : emptyLabel;
}
ipcMain.handle("mody.desktop-update.v1", handleDesktopUpdateMessage);
ipcMain.handle("mody.trigger-settings.v1", (event, payload) =>
  withTaskNotificationConsentRefresh(handleTriggerSettingsMessage(event, payload, { app })),
);
ipcMain.handle("mody.trigger-runner.v1", (event, payload) =>
  withInboxAttentionRefresh(handleTriggerRunnerMessage(event, payload, createTriggerRunnerOptions(event))),
);
ipcMain.handle("mody.trigger-webhook.v1", (event, payload) =>
  handleTriggerWebhookMessage(event, payload, { app, safeStorage }),
);
ipcMain.handle("mody.public-trigger-relay.v1", (event, payload) =>
  handlePublicTriggerRelayMessage(event, payload, { app, safeStorage }),
);
ipcMain.handle("mody.work-sync.v1", (event, payload) =>
  handleWorkSyncMessage(event, payload, createWorkSyncOptions(event)),
);
ipcMain.handle("mody.toolchain.v1", (event, payload) =>
  handleToolchainMessage(event, payload, { app }),
);
ipcMain.handle("mody.local-memory.v1", (event, payload) =>
  handleMainLocalMemoryMessage(event, payload),
);
ipcMain.handle("mody.agent-org.v1", (event, payload) =>
  handleMainAgentOrgMessage(event, payload),
);

async function handleMainAgentOrgMessage(event, payload = {}) {
  if (payload?.kind === "record_performance") {
    return {
      status: "agent_org_performance_internal_only",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: "직원 성과는 최종 승인된 실행 결과에서만 기록합니다.",
    };
  }
  return handleAgentOrgMessage(event, payload, { app, dialog, BrowserWindow, shell, repoRoot });
}

async function handleMainLocalMemoryMessage(event, payload = {}) {
  if (payload?.kind === "run_task") {
    return getTaskExecutionRunner().enqueue(payload, {
      generateText: (input) => handleMainAIProviderMessage(event, input),
    });
  }
  if (payload?.kind === "control_task_execution") return getTaskExecutionRunner().control(payload);
  const result = await handleLocalMemoryMessage(
    event,
    payload,
    createLocalMemoryOptions(event),
  );
  // 업무판에서 답하거나 끝냈을 때도 트레이 개수·작업 표시줄 점을 바로 맞춘다(업무 실행기는 이 변화를 모른다).
  if (Array.isArray(result?.tasks) && String(payload?.kind ?? "").includes("task")) updateTaskAttentionCount(result.tasks);
  if (payload?.kind === "answer_task_question" && result?.status === "local_memory_task_answered") {
    void getTaskExecutionRunner().resumeAnswered(String(payload.taskId), {
      generateText: (input) => handleMainAIProviderMessage(event, input),
    }).catch((error) => console.warn("[task-execution] resume failed:", error?.message));
  }
  if (payload?.kind === "choose_root" && result?.status === "local_memory_root_updated") {
    taskExecutionRunner?.stop();
    companyAutomationRuntime?.stop();
    taskExecutionRunner = undefined;
    void getTaskExecutionRunner().start().catch((error) => console.warn("[task-execution] root switch failed:", error?.message));
    void getCompanyAutomationRuntime().start().catch(() => console.warn("[company-automation] 저장 위치 변경 후 실행기를 다시 확인해 주세요."));
  }
  if (payload?.kind !== "save_app_profile" || result?.status !== "local_memory_app_profile_saved") {
    return result;
  }
  const agentOrganization = await handleAgentOrgMessage(
    null,
    { kind: "sync_profile_team" },
    { app, dialog, BrowserWindow, shell, repoRoot },
  ).catch(() => ({
    status: "agent_org_profile_sync_write_failed",
    externalMutation: false,
  }));
  return { ...result, agentOrganization };
}
ipcMain.handle("mody.desktop-bridge.v1", (event, payload) =>
  handleDesktopBridgeMessage(payload, event),
);
let nativeSkillsService;
let projectDeliverablesService;
ipcMain.handle("mody.project-deliverables.v1", (event, payload = {}) => {
  projectDeliverablesService ||= createProjectDeliverables({
    fallbackRoot: path.join(app.getPath("userData"), "project-deliverables"),
    loadWorkspace: expectedRoot => handleLocalMemoryMessage(null, { kind: "load_work_session_workspace", expectedRoot }, createLocalMemoryOptions(null)),
    trustedOrigin: url => (url.protocol === "modycrew:" && url.host === "app") || (target.mode === "dev" && url.origin === new URL(target.devUrl).origin),
    openFolder: async directory => { const error = await shell.openPath(directory); if (error) throw new Error(error); },
    openPreview: result => openDeliverablePreview(BrowserWindow, result),
  });
  return projectDeliverablesService.handle(event, payload);
});
// 앱 안 문서 보기(PDF·HWP/HWPX·DOCX·Markdown 등): 읽기 전용, 허용 폴더와 사용자가 고른 파일만, 원본은 바꾸지 않는다.
ipcMain.handle("mody.document-viewer.v1", (event, payload = {}) => handleDocumentViewerMessage(event, payload, {
  getFileIcon: async file => (await app.getFileIcon(file, { size: "small" })).toDataURL(),
  trustedOrigin: url => (url.protocol === "modycrew:" && url.host === "app") || (target.mode === "dev" && url.origin === new URL(target.devUrl).origin),
  resolveAllowedRoots: async request => workspaceDocumentRoots({
    workspaceRoot: typeof request?.workspaceRoot === "string" ? request.workspaceRoot : undefined,
    loadWorkspace: expectedRoot => handleLocalMemoryMessage(null, { kind: "load_work_session_workspace", expectedRoot }, createLocalMemoryOptions(null)),
    deliverablesRoot: path.join(app.getPath("userData"), "project-deliverables"),
    documentsRoot: path.join(app.getPath("documents"), "ModyCrew", "만든 문서"),
    extraRoots: await crewResultsRoot().then(root => [{ path: root, label: "크루 결과 폴더", kind: "results" }], () => []),
  }),
  openPath: file => shell.openPath(file),
  showItemInFolder: file => shell.showItemInFolder(file),
  dialog,
  BrowserWindow,
  app,
}));
// 받아쓰기(음성 인식): 이 PC 안의 whisper.cpp 로만 글로 바꾼다. 모델은 사용자가 화면에서 '내려받기'를 눌렀을 때만 받는다.
ipcMain.handle("mody.speech-recognition.v1", (event, payload = {}) => handleSpeechRecognitionMessage(event, payload, {
  app,
  isPackaged: app.isPackaged,
  allowDevOrigin: target.mode === "dev",
  systemPreferences,
  allowedRoots: async () => {
    const status = await handleLocalMemoryMessage(null, { kind: "status" }, createLocalMemoryOptions(null));
    return [status?.root || status?.defaultRoot].filter(Boolean);
  },
  onProgress: (job) => { try { if (!event.sender.isDestroyed()) event.sender.send(speechRecognitionProgressChannel, job); } catch { /* 창이 닫히는 중 */ } },
}));

// 직원 만들기·내 스킬 보관함: 필요한 스킬을 우리 웹사이트·이 PC·앱 템플릿·새 초안에서 구해 직원에게 붙인다.
// 저장·가져오기·갱신·되돌리기·음성 만들기는 데스크톱 확인 창에서 사람이 고른 뒤에만 한다(employee-skill-sources.mjs).
// 받아쓰기 스킬은 앱에 동봉한 whisper.cpp 와 사용자가 받은 모델을 먼저 쓰도록 위치를 넘긴다.
function bundledSpeechSkillEnv() {
  const env = {};
  try {
    const cli = process.resourcesPath ? path.join(process.resourcesPath, "toolchain", "whisper", "whisper-cli.exe") : "";
    if (!process.env.MODY_WHISPER_CLI && cli && existsSync(cli)) env.MODY_WHISPER_CLI = cli;
    const modelsRoot = path.join(app.getPath("userData"), "feature-modules", "speech-models");
    if (!process.env.MODY_WHISPER_MODEL_DIR) {
      for (const id of speechModelPreference) {
        const dir = path.join(modelsRoot, id);
        if (existsSync(dir) && readdirSync(dir).some((name) => /^ggml-.+\.bin$/u.test(name))) { env.MODY_WHISPER_MODEL_DIR = dir; break; }
      }
    }
  } catch { /* 없으면 스킬이 PC 에 설치된 whisper.cpp 를 찾는다 */ }
  return env;
}
let employeeSkillSources = null;
ipcMain.handle("mody.employee-skills.v1", async (event, payload = {}) => {
  const frame = event?.senderFrame;
  if (!frame || (event.sender.mainFrame && frame !== event.sender.mainFrame)) return { status: "failed", userMessage: "앱 화면에서 직원 만들기를 사용해 주세요." };
  const url = new URL(frame.url || event.sender.getURL());
  if (!(url.protocol === "modycrew:" && url.hostname === "app") && !(target.mode === "dev" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return { status: "failed", userMessage: "앱 화면에서 직원 만들기를 사용해 주세요." };
  employeeSkillSources ||= createEmployeeSkillSources({
    libraryRoot: path.join(app.getPath("userData"), "skill-library"),
    runsRoot: path.join(app.getPath("userData"), "employee-skill-runs"),
    runScript: (input) => runPowerShellScript({ ...input, env: { ...voiceScriptEnv(), ...bundledSpeechSkillEnv() } }),
  });
  return employeeSkillSources.handle(payload);
});

// 앱 화면 권한: 예전에는 기본 세션에 권한 처리기가 없어 마이크·카메라·위치 같은 요청이 모두 자동 허용됐다.
// 앱 화면(modycrew://app, 개발 주소)에만 앱이 실제로 쓰는 권한(알림·클립보드 쓰기·전체 화면)과 받아쓰기용 마이크(오디오만)를 허용하고,
// 그 밖의 화면·권한은 거부한다. 업무 브라우저·문서 창·PDF 창은 각자 세션에서 모든 권한을 거부한다.
const appScreenPermissions = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"]);
function isAppScreenPermissionUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (url.protocol === "modycrew:" && url.host === "app") || (target.mode === "dev" && url.origin === new URL(target.devUrl).origin);
  } catch {
    return false;
  }
}
let appScreenPermissionPolicyInstalled = false;
function installAppScreenPermissionPolicy() {
  if (appScreenPermissionPolicyInstalled || !session?.defaultSession) return;
  appScreenPermissionPolicyInstalled = true;
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || contents?.getURL?.() || "";
    if ((contents && managedWorkBrowserContents.has(contents)) || !isAppScreenPermissionUrl(requestingUrl)) return callback(false);
    if (permission === "media") {
      const types = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
      return callback(types.length > 0 && types.every((type) => type === "audio"));
    }
    return callback(appScreenPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (contents && managedWorkBrowserContents.has(contents)) return false;
    if (!isAppScreenPermissionUrl(requestingOrigin || details?.requestingUrl || "")) return false;
    if (permission === "media") return details?.mediaType === "audio";
    return appScreenPermissions.has(permission);
  });
}
ipcMain.handle("mody.native-skills.v1", async (event, payload = {}) => {
  const frame = event?.senderFrame;
  if (!frame || (event.sender.mainFrame && frame !== event.sender.mainFrame)) return { status: "failed", userMessage: "앱의 대화 화면에서 스킬을 사용해 주세요." };
  const url = new URL(frame.url || event.sender.getURL());
  if (!(url.protocol === "modycrew:" && url.hostname === "app") && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return { status: "failed", userMessage: "앱의 대화 화면에서 스킬을 사용해 주세요." };
  nativeSkillsService ||= createNativeSkillsService({
    stateRoot: path.join(app.getPath("userData"), "native-skill-runs"),
    getWorkspaceRoot: async () => {
      const status = await handleLocalMemoryMessage(null, { kind: "status" }, createLocalMemoryOptions(null));
      return status.root || status.defaultRoot || "";
    },
    confirm: async ({ name, source, request }) => (await dialog.showMessageBox({
      type: "question", title: "스킬 실행 확인", message: `${name} 지침을 현재 연결된 AI에 적용할까요?`,
      detail: `${source}의 스킬 지침과 아래 요청을 AI에 보냅니다. 구독 한도 또는 API 비용이 사용될 수 있습니다. 텍스트 결과를 이 대화의 로컬 파일로 저장합니다. 별도 스크립트·외부 도구는 실행하지 않습니다.\n\n${request.slice(0, 1500)}`,
      buttons: ["취소", "지침 적용 실행"], defaultId: 0, cancelId: 0,
    })).response === 1,
    generateText: (input, runtimeOptions) => handleMainAIProviderMessage(null, input, { ...runtimeOptions, companySharedContext: true }),
    openPath: file => shell.openPath(file),
  });
  return nativeSkillsService.handle(payload);
});
// 크루 스킬: 요청에 맞는 크루 스킬을 이 PC에 로그인된 Codex CLI·Claude Code로 실행한다. 결과 파일만 만드는 실행은
// 앱이 실행기(Codex 우선)를 골라 확인 창 없이 시작하고, 사용자 폴더를 고치거나 점검하는 실행만 확인 창을 띄운다.
let crewSkillRuntime;
// 크루 스킬 결과는 앱 데이터 폴더 안 작업 폴더에 남는다. 완료되면 이미지 스튜디오와 같은 결과 폴더
// (D:\ModyCrew 결과\<분야>\<날짜 주제>)로 복사하고, HTML 결과물은 PNG 미리보기를 만들어 대화 카드에 보이게 한다.
// 같은 실행을 다시 불러와도 폴더를 또 만들지 않도록 실행별 기록을 남긴다.
let crewResultsRootPromise = null;
let crewResultPreviewRenderer = null;
function crewResultsRoot() {
  crewResultsRootPromise ||= chooseResultsRoot().catch((error) => { crewResultsRootPromise = null; throw error; });
  return crewResultsRootPromise;
}
async function mirrorCompletedCrewRun(response) {
  const run = response?.run;
  if (!run || run.status !== "completed" || !run.id) return response;
  const { promises: fsp } = await import("node:fs");
  const markerDir = path.join(app.getPath("userData"), "crew-results-mirror");
  const markerFile = path.join(markerDir, String(run.id).replace(/[^\w-]/gu, "") + ".json");
  try {
    const saved = JSON.parse(await fsp.readFile(markerFile, "utf8"));
    if (saved?.folder && existsSync(saved.folder)) return attachMirroredResults(response, saved);
  } catch { /* 처음 옮기는 실행 */ }
  try {
    const mirrored = await mirrorCrewRunResults({ run, getResultsRoot: crewResultsRoot });
    if (!mirrored) return response;
    crewResultPreviewRenderer ||= createHtmlPreviewRenderer({ BrowserWindow, session: electronApi.session });
    await addHtmlPreviews({ mirrored, render: crewResultPreviewRenderer }).catch(() => undefined);
    await fsp.mkdir(markerDir, { recursive: true });
    await fsp.writeFile(markerFile, JSON.stringify(mirrored), "utf8");
    return attachMirroredResults(response, mirrored);
  } catch (error) {
    const reason = String(error?.message ?? error).slice(0, 160);
    return { ...response, userMessage: [String(response.userMessage ?? "").trim(), "결과 폴더로 복사하지 못했습니다(" + reason + "). 결과는 실행 기록에 그대로 있습니다."].filter(Boolean).join("\n") };
  }
}
ipcMain.handle("mody.crew-skills.v1", async (event, payload = {}) => {
  const frame = event?.senderFrame;
  if (!frame || (event.sender.mainFrame && frame !== event.sender.mainFrame)) return { status: "failed", userMessage: "앱의 대화 화면에서 크루 스킬을 사용해 주세요." };
  const url = new URL(frame.url || event.sender.getURL());
  if (!(url.protocol === "modycrew:" && url.hostname === "app") && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return { status: "failed", userMessage: "앱의 대화 화면에서 크루 스킬을 사용해 주세요." };
  crewSkillRuntime ||= createCrewSkillRuntime({
    stateRoot: path.join(app.getPath("userData"), "crew-skill-runs"),
    domainEntryPath,
    getWorkspaceRoot: async () => {
      const status = await handleLocalMemoryMessage(null, { kind: "status" }, createLocalMemoryOptions(null));
      return status.root || status.defaultRoot || "";
    },
    openPath: (file) => shell.openPath(file),
    autoApprove: (info) => decideCrewSkillAutoApproval(info),
  });
  const response = await crewSkillRuntime.handle(payload);
  return ["run", "resave"].includes(String(payload?.kind ?? "")) ? mirrorCompletedCrewRun(response) : response;
});
// 이미지 스튜디오: 대화에서 부탁한 이미지·홍보물을 실제 파일로 만든다. 엔진(이 PC GPT → 모디크루 Gemini·OpenAI 키)과
// 결과 폴더(D:\ModyCrew 결과 → 사용자 폴더)는 앱이 고르고, 사용자에게 실행기·폴더를 묻지 않는다.
let creativeStudio;
ipcMain.handle("mody.creative-studio.v1", async (event, payload = {}) => {
  const frame = event?.senderFrame;
  if (!frame || (event.sender.mainFrame && frame !== event.sender.mainFrame)) return { status: "failed", userMessage: "앱의 대화 화면에서 이미지 만들기를 사용해 주세요." };
  const url = new URL(frame.url || event.sender.getURL());
  if (!(url.protocol === "modycrew:" && url.hostname === "app") && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return { status: "failed", userMessage: "앱의 대화 화면에서 이미지 만들기를 사용해 주세요." };
  creativeStudio ||= createCreativeStudio({
    stateRoot: path.join(app.getPath("userData"), "creative-studio"),
    openPath: (target) => shell.openPath(target),
    getProviderCredential: (provider) => readProviderCredentialForTool(provider, { app, safeStorage }),
  });
  return creativeStudio.handle(payload);
});
app.on("before-quit", () => { try { creativeStudio?.stopAll(); } catch { /* 종료 중 정리 실패는 무시 */ } });
ipcMain.handle("mody.agent-session.v1", (event, payload) =>
  handleAgentSessionMessage(event, payload, {
    app,
    safeStorage,
    runLocalWorkflow: (text) =>
      handleLocalWorkflowMessage(event, { kind: "create_from_text", text }, { shell }),
    runTriggerDueChecks: () =>
      handleTriggerRunnerMessage(
        event,
        { kind: "run_due_checks", force: true, triggeredBy: "agent-session" },
        createTriggerRunnerOptions(event),
      ),
    listConnectorStatuses: () =>
      handleConnectorMessage(event, { kind: "list" }, { app, dialog, safeStorage }),
    getTriggerSettings: () => handleTriggerSettingsMessage(event, { kind: "list" }, { app }),
    getAIProviderStatus: () =>
      handleAIProviderMessage(event, { kind: "status" }, { app, safeStorage, shell }),
    requestDesktopControlAction: (input) =>
      handleDesktopControlMessage(
        event,
        { kind: "request", ...input },
        {
          dialog,
          appendInboxItems: appendAutomationInboxItems,
          upsertInboxItem: upsertAutomationInboxItem,
          getInboxSnapshot: getAutomationInboxSnapshot,
          captureScreenEvidence: (captureInput) =>
            captureDesktopScreenEvidence(captureInput, { desktopCapturer }),
          captureWebmailDomRows: (captureInput) =>
            captureWebmailDomRows(captureInput, { BrowserWindow }),
          enableLiveBrowserLimitedExecution: true,
          executeBrowserLimitedAction: (actionInput) =>
            executeBrowserLimitedAction(actionInput, { clipboard }),
        },
      ),
  }),
);
ipcMain.handle("mody.desktop-control.v1", (event, payload) =>
  handleDesktopControlMessage(event, payload, {
    openWorkBrowserTarget: async (url) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || !workBrowser.isTrusted(event)) return { ok:false, userMessage:'앱에서 다시 요청해 주세요.' };
      event.sender.send('mody.work-browser.open', { url: workBrowserUrl(url) });
      return {ok:true};
    },
    dialog,
    appendInboxItems: appendAutomationInboxItems,
    upsertInboxItem: upsertAutomationInboxItem,
    getInboxSnapshot: getAutomationInboxSnapshot,
    captureScreenEvidence: (captureInput) =>
      captureDesktopScreenEvidence(captureInput, { desktopCapturer }),
    captureWebmailDomRows: (captureInput) =>
      captureWebmailDomRows(captureInput, { BrowserWindow }),
    enableLiveBrowserLimitedExecution: true,
    executeBrowserLimitedAction: (actionInput) =>
      executeBrowserLimitedAction(actionInput, { clipboard }),
  }),
);
ipcMain.handle("mody.selected-work-actions.v1", (event, payload) =>
  handleSelectedWorkActionEventsMessage(event, payload, { app, repoRoot }),
);
ipcMain.handle("mody.document-learning.v1", (event, payload) =>
  handleDocumentLearningMessage(event, payload, {
    // 학습이 끝나면 updateLocalMemoryWorkspaceIntelligence 가 도구 제안을 만드는데,
    // 그 판단에 검증된 카탈로그가 필요하다. 이 옵션이 없으면 카탈로그가 []가 되어
    // 제안이 항상 0건이 되고, 사용자는 "근거를 찾지 못했습니다"만 본다.
    // 감시자 경로(learnApprovedDocumentSnapshot)는 이미 같은 방식으로 넘긴다.
    ...createLocalMemoryOptions(event),
    app,
    BrowserWindow,
    dialog,
    shell,
    repoRoot,
    domainEntryPath,
    resolveAuthorizedLocalStorageRoot: async () => {
      const localMemoryStatus = await handleLocalMemoryMessage(
        event,
        { kind: "status" },
        { app },
      );
      return localMemoryStatus.root || localMemoryStatus.defaultRoot || "";
    },
    resolveAuthorizedMailAttachmentStagingPaths: (requestedPaths = []) =>
      resolveMailAttachmentStagingLeases(event, requestedPaths),
    documentLearningSupervisor: getDocumentLearningSupervisor(),
    verifyPersistedTeammateProposal: (request) =>
      verifyPersistedTeammateProposal(event, request),
    isAuthorizedDocumentLearningSupervisorControlSender: (candidateEvent) => {
      const sender = candidateEvent?.sender;
      return [mainWindowRef, officeWindowRef].some(
        (win) =>
          win &&
          !win.isDestroyed?.() &&
          win.webContents === sender,
      );
    },
    upsertInboxItem: upsertAutomationInboxItem,
    recordActivity: (input = {}) =>
      handleSelectedWorkActionEventsMessage(event, { kind: "record", event: input }, { app }),
  }),
);

function executeBrowserLimitedAction(input = {}, { clipboard: clipboardAdapter } = {}) {
  const requestedAt = new Date().toISOString();
  const actionCapability = sanitizeDesktopCaptureText(input.actionCapability).slice(0, 60);
  if (input.finalUserPresence !== true || input.userConfirmationVerified !== true) {
    return createBlockedBrowserExecutionResult({
      requestedAt,
      summary: "최종 사용자 확인 계약이 없어 제한 실행을 차단했습니다.",
    });
  }

  if (actionCapability !== "type_text") {
    return createBlockedBrowserExecutionResult({
      requestedAt,
      summary: "현재 라이브 어댑터는 승인된 입력문 클립보드 복사만 허용합니다.",
    });
  }

  if (!clipboardAdapter || typeof clipboardAdapter.writeText !== "function") {
    return createBlockedBrowserExecutionResult({
      requestedAt,
      summary: "Electron clipboard 어댑터를 사용할 수 없어 제한 실행을 차단했습니다.",
    });
  }

  const text = sanitizeClipboardExecutionText(input.intendedInput || input.instruction || "");
  if (!text) {
    return createBlockedBrowserExecutionResult({
      requestedAt,
      summary: "클립보드에 복사할 승인된 입력문이 없어 제한 실행을 차단했습니다.",
    });
  }

  if (containsSensitiveClipboardExecutionText(text)) {
    return createBlockedBrowserExecutionResult({
      requestedAt,
      summary: "비밀번호, 토큰, 결제 정보로 보이는 문구가 있어 클립보드 복사를 차단했습니다.",
    });
  }

  clipboardAdapter.writeText(text, "clipboard");
  return {
    status: "executed",
    adapterRunId: `clipboard-${Date.now().toString(36)}`,
    executedAt: requestedAt,
    summary: "승인된 입력문을 OS 클립보드에 복사했습니다. 사용자가 화면에서 직접 붙여넣고 최종 발송을 확인합니다.",
    userMessage: "승인된 입력문을 클립보드에 복사했습니다. 대상 입력칸에 직접 붙여넣고 발송 전 다시 확인해 주세요.",
    sideEffect: "clipboard_write",
    externalMutation: true,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createBlockedBrowserExecutionResult({ requestedAt, summary }) {
  return {
    status: "blocked",
    adapterRunId: `blocked-${Date.now().toString(36)}`,
    executedAt: requestedAt,
    summary,
    userMessage: summary,
    sideEffect: "none",
    externalMutation: false,
    rawCoordinatesStored: false,
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeClipboardExecutionText(value) {
  return sanitizeDesktopCaptureText(value)
    .replace(/\bhttps?:\/\/[^\s"'<>]+/giu, "[redacted-url]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .slice(0, 1000);
}

function containsSensitiveClipboardExecutionText(value) {
  const text = String(value ?? "").toLowerCase();
  return /비밀번호|password|passcode|otp|인증번호|주민등록|카드번호|card number|secret|token|api key|결제|송금|refund|환불/i.test(text);
}

async function captureDesktopScreenEvidence(input = {}, { desktopCapturer: capturer } = {}) {
  const capturedAt = new Date().toISOString();
  if (!capturer || typeof capturer.getSources !== "function") {
    return {
      status: "screen_evidence_unavailable",
      userMessage: "Electron desktopCapturer를 사용할 수 없습니다.",
      capturedAt,
      sourceKind: "unknown",
      sourceLabel: "화면 캡처 어댑터 없음",
      sourceCount: 0,
      matchReason: "desktopCapturer unavailable",
      rawPixelsStored: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const sources = await capturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  const rankedSources = rankDesktopCaptureSources(sources, input);
  const selectedSource = rankedSources[0];
  if (!selectedSource) {
    return {
      status: "screen_evidence_unavailable",
      userMessage: "확인할 수 있는 화면 소스가 없습니다.",
      capturedAt,
      sourceKind: "unknown",
      sourceLabel: "화면 소스 없음",
      sourceCount: 0,
      matchReason: "no desktop sources",
      rawPixelsStored: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  return {
    status: "screen_evidence_captured",
    capturedAt,
    sourceKind: selectedSource.type === "screen" ? "screen" : "window",
    sourceLabel: sanitizeDesktopCaptureText(selectedSource.name).slice(0, 160) || "현재 화면 소스",
    sourceCount: sources.length,
    matchReason: selectedSource.matchReason,
    targetElementDescription: sanitizeDesktopCaptureText(input.targetElementDescription).slice(0, 300),
    rawPixelsStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function captureWebmailDomRows(input = {}, { BrowserWindow: browserWindow } = {}) {
  const capturedAt = new Date().toISOString();
  if (!browserWindow || typeof browserWindow.getAllWindows !== "function") {
    return createWebmailDomRowsUnavailable(capturedAt, "Electron BrowserWindow를 사용할 수 없습니다.");
  }

  const host = safeDesktopHost(input.targetUrl || input.host);
  const windows = browserWindow
    .getAllWindows()
    .filter((win) => win && typeof win.isDestroyed === "function" && !win.isDestroyed() && win.webContents);
  const rankedWindows = windows
    .map((win) => {
      const url = sanitizeDesktopCaptureText(win.webContents.getURL?.() ?? "");
      const title = sanitizeDesktopCaptureText(win.getTitle?.() ?? "");
      const label = `${title} ${url}`.toLowerCase();
      let score = 0;
      if (host && label.includes(host.toLowerCase())) score += 50;
      if (/mail|메일|inbox|받은|webmail|groupware|그룹웨어/iu.test(label)) score += 20;
      if (typeof win.isFocused === "function" && win.isFocused()) score += 10;
      return { win, url, title, score };
    })
    .sort((a, b) => b.score - a.score);
  const selected = rankedWindows.find((item) => item.score > 0);
  if (!selected) {
    return createWebmailDomRowsUnavailable(capturedAt, "대상 웹메일 창을 찾지 못했습니다.");
  }

  let result;
  try {
    result = await selected.win.webContents.executeJavaScript(createWebmailDomRowsScript(input.maxRows), true);
  } catch (error) {
    return createWebmailDomRowsUnavailable(capturedAt, `웹메일 화면 행을 읽지 못했습니다: ${sanitizeDesktopCaptureText(error?.message).slice(0, 160)}`);
  }

  const rows = normalizeCapturedWebmailDomRows(result?.rows ?? []);
  return {
    status: rows.length > 0 ? "webmail_dom_rows_captured" : "webmail_dom_rows_empty",
    capturedAt,
    sourceKind: "electron_web_contents",
    sourceLabel: sanitizeDesktopCaptureText(result?.title || selected.title || selected.url || "웹메일 창").slice(0, 160),
    sourceUrl: redactDesktopCaptureUrl(result?.url || selected.url),
    rowCount: rows.length,
    rows,
    matchReason: host
      ? `${host} 웹메일 창에서 DOM 행 snapshot을 읽었습니다.`
      : "웹메일로 보이는 현재 창에서 DOM 행 snapshot을 읽었습니다.",
    readOnly: true,
    externalMutation: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createWebmailDomRowsUnavailable(capturedAt, userMessage) {
  return {
    status: "webmail_dom_rows_unavailable",
    capturedAt,
    userMessage: sanitizeDesktopCaptureText(userMessage).slice(0, 240),
    sourceKind: "unknown",
    sourceLabel: "웹메일 창 확인 필요",
    rowCount: 0,
    rows: [],
    matchReason: "webmail window not available",
    readOnly: true,
    externalMutation: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createWebmailDomRowsScript(maxRows = 50) {
  const rowLimit = Math.min(100, Math.max(1, Math.round(Number(maxRows) || 50)));
  return `
(() => {
  const rowLimit = ${rowLimit};
  const selectors = [
    '[role="row"]',
    '[role="listitem"]',
    'tr',
    'li',
    '[data-testid*="mail" i]',
    '[data-testid*="message" i]',
    '[class*="mail" i]',
    '[class*="message" i]',
    '[class*="inbox" i]'
  ];
  const seen = new Set();
  const nodes = [];
  for (const selector of selectors) {
    for (const node of Array.from(document.querySelectorAll(selector))) {
      if (seen.has(node)) continue;
      seen.add(node);
      const rect = node.getBoundingClientRect();
      const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!text || text.length < 4 || rect.width <= 0 || rect.height <= 0) continue;
      nodes.push(node);
      if (nodes.length >= rowLimit) break;
    }
    if (nodes.length >= rowLimit) break;
  }
  const clean = (value, limit = 500) => String(value || '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, limit);
  const rows = nodes.slice(0, rowLimit).map((node, index) => {
    const rowText = clean(node.innerText || node.textContent, 1000);
    if (rowText.length > 720 || node.querySelector('input[type="password"], textarea, [contenteditable="true"]')) return null;
    const cellNodes = Array.from(node.querySelectorAll('[role="gridcell"], [role="cell"], td, th, time, [class*="sender" i], [class*="from" i], [class*="subject" i], [class*="date" i], [class*="time" i], [data-testid*="sender" i], [data-testid*="from" i], [data-testid*="subject" i], [data-testid*="date" i]'));
    const cells = cellNodes.map((cell) => clean(cell.innerText || cell.textContent, 180)).filter(Boolean).slice(0, 8);
    if (!cells.length && rowText.length <= 360) cells.push(rowText);
    const hrefs = Array.from(node.querySelectorAll('a[href]')).map((link) => clean(link.href, 300)).filter(Boolean).slice(0, 4);
    const timeNode = node.querySelector('time, [datetime], [class*="date" i], [class*="time" i]');
    const ariaLabel = clean(node.getAttribute('aria-label'), 240);
    const title = clean(node.getAttribute('title'), 180);
    const labelParts = [node.getAttribute('data-testid'), ariaLabel, title, node.className].map((part) => clean(part, 160)).filter(Boolean);
    const unread = /unread|읽지|안읽|새메일/i.test(labelParts.join(' ') + ' ' + node.getAttribute('aria-label'));
    const metadataPreview = clean([title, ariaLabel, ...cells].filter(Boolean).join(' | '), 360);
    const hasAttachmentIcon = /attach|첨부|paperclip|파일/i.test(metadataPreview + ' ' + labelParts.join(' '));
    return {
      rowId: clean(node.id || node.getAttribute('data-id') || node.getAttribute('data-legacy-message-id') || ('dom-row-' + (index + 1)), 120),
      role: clean(node.getAttribute('role'), 80),
      ariaLabel,
      textContent: metadataPreview,
      cells,
      hrefs,
      timeText: clean(timeNode?.getAttribute('datetime') || timeNode?.innerText || timeNode?.textContent, 120),
      labels: labelParts.slice(0, 8),
      hasAttachmentIcon,
      unread
    };
  }).filter(Boolean);
  return {
    title: clean(document.title, 160),
    url: clean(document.URL, 500),
    rows
  };
})()
`;
}

function normalizeCapturedWebmailDomRows(rows = []) {
  return Array.isArray(rows)
    ? rows.slice(0, 100).map((row) => ({
        rowId: sanitizeDesktopCaptureText(row?.rowId).slice(0, 120),
        role: sanitizeDesktopCaptureText(row?.role).slice(0, 80),
        ariaLabel: sanitizeDesktopCaptureText(row?.ariaLabel).slice(0, 240),
        textContent: sanitizeDesktopCaptureText(row?.textContent).slice(0, 360),
        cells: Array.isArray(row?.cells)
          ? row.cells.map((cell) => sanitizeDesktopCaptureText(cell).slice(0, 180)).filter(Boolean).slice(0, 8)
          : [],
        hrefs: Array.isArray(row?.hrefs)
          ? row.hrefs.map((href) => redactDesktopCaptureUrl(href)).filter(Boolean).slice(0, 4)
          : [],
        timeText: sanitizeDesktopCaptureText(row?.timeText).slice(0, 120),
        labels: Array.isArray(row?.labels)
          ? row.labels.map((label) => sanitizeDesktopCaptureText(label).slice(0, 120)).filter(Boolean).slice(0, 8)
          : [],
        hasAttachmentIcon: row?.hasAttachmentIcon === true,
        unread: row?.unread === true,
      }))
    : [];
}

function rankDesktopCaptureSources(sources = [], input = {}) {
  const targetText = sanitizeDesktopCaptureText(
    [input.targetUrl, input.host, input.actionLabel, input.targetElementDescription].filter(Boolean).join(" "),
  ).toLowerCase();
  const host = safeDesktopHost(input.targetUrl || input.host);

  return sources
    .map((source) => {
      const name = sanitizeDesktopCaptureText(source?.name ?? "");
      const haystack = name.toLowerCase();
      let score = 0;
      const reasons = [];
      if (host && haystack.includes(host.toLowerCase())) {
        score += 40;
        reasons.push("대상 호스트 제목 일치");
      }
      for (const token of targetText.split(/[^a-z0-9가-힣]+/u).filter((token) => token.length >= 2).slice(0, 8)) {
        if (haystack.includes(token)) {
          score += 8;
          reasons.push(`'${token}' 일치`);
        }
      }
      if (source?.id?.startsWith("screen:")) score += 2;
      return {
        ...source,
        score,
        matchReason: reasons.slice(0, 3).join(", ") || "현재 사용 가능한 화면 소스 중 최상위 후보",
      };
    })
    .sort((a, b) => b.score - a.score);
}

function safeDesktopHost(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).hostname.replace(/^www\./, "");
  } catch {
    return sanitizeDesktopCaptureText(text).split(/\s+/)[0] ?? "";
  }
}

function redactDesktopCaptureUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|password|passwd|auth|code|session|cookie/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    url.hash = "";
    return url.href.slice(0, 500);
  } catch {
    return "";
  }
}

function sanitizeDesktopCaptureText(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\b(?:token|password|passwd|secret|api[_-]?key|cookie|session)\s*[:=]\s*\S+/giu, "$1=[redacted-secret]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function createMainWindow() {
  const smokeWindowOptions = isScheduleBriefingMobileScreenshotSmoke
    ? {
        width: 430,
        height: 860,
        minWidth: 360,
        minHeight: 640,
      }
    : {};
  const win = new BrowserWindow({
    ...secureBrowserWindowOptions,
    backgroundColor: themedWindowBackgroundColor(),
    ...smokeWindowOptions,
    title: "ModyCrew",
    icon: resolveWindowFrameIconPath(),
    webPreferences: {
      ...secureBrowserWindowOptions.webPreferences,
      preload: resolvePreloadPath(),
    },
  });
  applyWindowIcon(win);
  mainWindowRef = win;

  if (
    isScreenshotSmoke ||
    isAIChatSmoke ||
    isAIModelChatSmoke ||
    isAIPendingChatSmoke ||
    isFreshProfileFirstChatSmoke ||
    isMailOpsChatSmoke
  ) {
    win.webContents.on("console-message", (event) => {
      firstScreenSmokeDiagnostics.push({
        kind: "console",
        level: event.level,
        message: event.message,
        line: event.lineNumber,
        sourceId: event.sourceId,
      });
    });
    win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      firstScreenSmokeDiagnostics.push({ kind: "did-fail-load", errorCode, errorDescription, validatedURL });
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      firstScreenSmokeDiagnostics.push({ kind: "render-process-gone", details });
    });
  }

  win.on("close", (event) => {
    if (isExplicitQuit) return;
    event.preventDefault();
    win.hide();
    void showBackgroundModeNotice();
  });

  win.on("closed", () => {
    if (mainWindowRef === win) mainWindowRef = null;
  });

  win.once("ready-to-show", () => {
    applyWindowIcon(win);
    win.show();
    if (target.mode === "dev") {
      win.webContents.openDevTools({ mode: "detach" });
    }
  });

  if (isScheduleBriefingScreenshotSmoke) {
    seedScheduleBriefingScreenshotSmokeInbox();
  } else if (isMailCalendarScreenshotSmoke) {
    seedMailCalendarScreenshotSmokeInbox();
  } else if (isOfficeWindowOpenSmoke) {
    seedRepeatWorkOfficeWindowSmokeInbox();
  }

  if (target.mode === "dev") {
    console.log(`[modycrew-desktop] dev mode — loading ${target.devUrl}`);
    await win.loadURL((isAIChatSmoke || isAIModelChatSmoke || isAIPendingChatSmoke || isFreshProfileFirstChatSmoke || isMailOpsChatSmoke) ? createAIChatSmokeUrl(target.devUrl) : createScreenshotSmokeUrl(target.devUrl));
    await runScreenshotSmoke(win);
    await runAIChatSmoke(win);
    await runAIModelChatSmoke(win);
    await runAIPendingChatSmoke(win);
    await runFreshProfileFirstChatSmoke(win);
    await runMailOpsChatSmoke(win);
    await runOfficeWindowOpenSmoke(win);
    await runWorkerCompanionWindowSmoke(win);
    return;
  }

  if (target.mode === "prod") {
    console.log(`[modycrew-desktop] prod mode — loading modycrew://app/ (root=${target.webRoot})`);
    await win.loadURL(
      (isAIChatSmoke || isAIModelChatSmoke || isAIPendingChatSmoke || isFreshProfileFirstChatSmoke || isMailOpsChatSmoke)
        ? createAIChatSmokeUrl("modycrew://app/")
        : isScreenshotSmoke
          ? createScreenshotSmokeUrl("modycrew://app/")
          : "modycrew://app/",
    );
    await runScreenshotSmoke(win);
    await runAIChatSmoke(win);
    await runAIModelChatSmoke(win);
    await runAIPendingChatSmoke(win);
    await runFreshProfileFirstChatSmoke(win);
    await runMailOpsChatSmoke(win);
    await runOfficeWindowOpenSmoke(win);
    await runWorkerCompanionWindowSmoke(win);
    return;
  }

  console.warn(
    "[modycrew-desktop] V2 web 빌드 결과가 없습니다. `npm run web:build` 를 먼저 실행해 주세요.",
  );
  await win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<!doctype html><html lang="ko"><head><meta charset="utf-8">
         <title>ModyCrew</title>
         <style>
           body { font-family: system-ui, sans-serif; background:#f5f7fa; color:#111827;
                  display:flex; align-items:center; justify-content:center;
                  min-height:100vh; margin:0; }
           .card { background:#fff; border:1px solid #dde5ee; border-radius:8px;
                   padding:32px; max-width:480px; box-shadow:0 4px 16px rgba(0,0,0,0.05); }
           code { background:#f0f3f8; padding:2px 6px; border-radius:4px; }
         </style></head>
         <body><div class="card">
           <h1 style="margin-top:0;">ModyCrew V2 빌드가 필요합니다</h1>
           <p>다음 명령을 먼저 실행해 주세요.</p>
           <pre><code>npm run web:build</code></pre>
           <p>그 다음 이 창을 새로고침 하거나 앱을 다시 켜 주세요.</p>
         </div></body></html>`,
      ),
  );
  await runScreenshotSmoke(win);
  await runAIChatSmoke(win);
  await runAIModelChatSmoke(win);
  await runAIPendingChatSmoke(win);
  await runFreshProfileFirstChatSmoke(win);
  await runMailOpsChatSmoke(win);
  await runOfficeWindowOpenSmoke(win);
  await runWorkerCompanionWindowSmoke(win);
}

function resolvePreloadPath() {
  return path.join(__dirname, "..", "preload", "bridge.cjs");
}

function createScreenshotSmokeUrl(baseUrl) {
  if (!isScreenshotSmoke) return baseUrl;
  if (isLearnFirstScreenScreenshotSmoke) {
    const learnBase = baseUrl.startsWith("modycrew://")
      ? "modycrew://app/learn"
      : `${baseUrl.replace(/\/$/, "")}/learn`;
    return `${learnBase}?preview=workbench`;
  }
  if (isWelcomeFirstScreenScreenshotSmoke) {
    const welcomeBase = baseUrl.startsWith("modycrew://")
      ? "modycrew://app/welcome"
      : `${baseUrl.replace(/\/$/, "")}/welcome`;
    return `${welcomeBase}?preview=workbench`;
  }
  if (isAccountFirstScreenScreenshotSmoke) {
    const accountBase = baseUrl.startsWith("modycrew://")
      ? "modycrew://app/account"
      : `${baseUrl.replace(/\/$/, "")}/account`;
    return `${accountBase}?preview=workbench`;
  }
  if (isOfficeFirstScreenScreenshotSmoke) {
    const officeBase = baseUrl.startsWith("modycrew://")
      ? "modycrew://app/office"
      : `${baseUrl.replace(/\/$/, "")}/office`;
    return `${officeBase}?preview=workbench`;
  }
  if (isConnectFirstScreenScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("intent", "문의 메일을 읽고 답장 초안과 일정 후보까지 만들어줘");
    params.set("recommend", "gmail,google-calendar,telegram-bot");
    params.set("mode", "read");
    const connectBase = baseUrl.startsWith("modycrew://")
      ? "modycrew://app/connect"
      : `${baseUrl.replace(/\/$/, "")}/connect`;
    return `${connectBase}?${params.toString()}`;
  }
  if (isInlineConnectPanelScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "connect");
    params.set("externalAccounts", "1");
    params.set("goal", "메일과 메신저 연결을 설정하고 싶어요");
    params.set("recommend", "telegram-bot,slack-app,company-mail");
    params.set("open", "telegram-bot");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isCodexSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "connect");
    params.set("singleSetting", "codex-oauth");
    params.set("goal", "Codex OAuth로 앱 안 AI 대화를 연결합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isMailSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "connect");
    params.set("singleSetting", "mail-calendar");
    params.set("goal", "메일과 캘린더 연결만 설정합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isNotificationSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "connect");
    params.set("singleSetting", "notification-assistant");
    params.set("goal", "업무 알림 비서 승인 채널만 설정합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isMailLearningSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "connect");
    params.set("singleSetting", "mail-learning");
    params.set("goal", "메일함 학습 실행 조건만 확인합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isVaultSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "connect");
    params.set("singleSetting", "vault");
    params.set("goal", "외부 사이트 계정 보관함만 설정합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isMemoryRootSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "connect");
    params.set("singleSetting", "memory-root");
    params.set("goal", "기억 저장 위치만 설정합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isMessengerChannelSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "messengers");
    params.set("singleSetting", "messenger-channel");
    params.set("goal", "메신저 채널 설정만 확인합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isCrewKitSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "skills");
    params.set("singleSetting", "crewkit");
    params.set("goal", "CrewKit 설정만 확인합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isLearnSourceSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "learn");
    params.set("singleSetting", "learn-source");
    params.set("goal", "자료 분석 출처만 설정합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isOfficeQueueSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "office");
    params.set("singleSetting", "office-queue");
    params.set("goal", "업무 오피스 큐만 확인합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isWorkerChannelSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "workers");
    params.set("singleSetting", "worker-channel");
    params.set("goal", "AI 팀원만 설정합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isComputerUseSingleSettingScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("panel", "control");
    params.set("singleSetting", "computer-use");
    params.set("goal", "Computer Use 안전 설정만 확인합니다");
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  if (isConnectGuideScreenshotSmoke) {
    const params = new URLSearchParams();
    params.set("preview", "workbench");
    params.set("intent", "상담 예약 메일을 읽고 캘린더 후보까지 만들어줘");
    params.set("connector", "google-calendar");
    params.set("recommend", "gmail,google-calendar");
    params.set("mode", "write");
    const connectBase = baseUrl.startsWith("modycrew://")
      ? "modycrew://app/connect"
      : `${baseUrl.replace(/\/$/, "")}/connect`;
    return `${connectBase}?${params.toString()}`;
  }
  const params = new URLSearchParams();
  params.set("preview", "workbench");
  if (isDocumentHandoffScreenshotSmoke) {
    params.set("workPack", "report_cleanup");
    params.set("from", "learn");
    params.set("intent", "인수인계서와 월간 보고서 기준으로 누락 확인하기");
    params.set("confidence", "86");
    params.set("evidence", "인수인계서.docx · 월간보고서.xlsx · 정산체크리스트.pdf");
    params.set("queue", "approval");
  } else if (isScheduleBriefingScreenshotSmoke) {
    params.set("workItem", "desktop-schedule-briefing-smoke");
    params.set("queue", "meeting");
    params.set("panel", "office");
    params.set("singleSetting", "office-queue");
  } else if (isMailCalendarScreenshotSmoke) {
    params.set("workItem", "desktop-mail-calendar-calendar-smoke");
    params.set("queue", "approval");
  }
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
}

function createAIChatSmokeUrl(baseUrl) {
  const params = new URLSearchParams();
  params.set("preview", "workbench");
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
}

function getSingleSettingScreenshotContract() {
  if (isCodexSingleSettingScreenshotSmoke) {
    return {
      panel: "connect",
      singleSetting: "ai",
      required: ["Codex OAuth 설정만 표시", "Codex OAuth 답변 경로", "Codex 로그인 열기"],
      forbidden: ["메일/캘린더 연결 설정만 표시", "업무 알림 비서 설정만 표시", "메일함 학습 설정만 표시"],
    };
  }
  if (isMailSingleSettingScreenshotSmoke) {
    return {
      panel: "connect",
      singleSetting: "mail",
      requiresModeLabel: false,
      required: ["사용하는 메일을 선택하세요", "Gmail 연결", "Outlook 연결", "회사·기타 메일"],
      forbidden: ["Codex OAuth 설정만 표시", "업무 알림 비서 설정만 표시", "메일함 학습 설정만 표시"],
    };
  }
  if (isNotificationSingleSettingScreenshotSmoke) {
    return {
      panel: "connect",
      singleSetting: "notification",
      required: ["업무 알림 비서 설정만 표시", "승인 요청을 받을 채널만 설정합니다", "앱 내부 승인함 기본"],
      forbidden: ["Codex OAuth 설정만 표시", "메일/캘린더 연결 설정만 표시", "메일함 학습 설정만 표시"],
    };
  }
  if (isMailLearningSingleSettingScreenshotSmoke) {
    return {
      panel: "connect",
      singleSetting: "mail-learning",
      required: ["메일함 학습 설정만 표시", "메일함 학습 실행 조건만 확인합니다", "read-only 학습"],
      forbidden: ["Codex OAuth 설정만 표시", "메일/캘린더 연결 설정만 표시", "업무 알림 비서 설정만 표시"],
    };
  }
  if (isVaultSingleSettingScreenshotSmoke) {
    return {
      panel: "connect",
      singleSetting: "vault",
      required: ["계정 보관함 설정만 표시", "사이트 계정은 여기에서만 저장합니다", "외부 업무 계정"],
      forbidden: ["Codex OAuth 설정만 표시", "메일/캘린더 연결 설정만 표시", "업무 알림 비서 설정만 표시"],
    };
  }
  if (isMemoryRootSingleSettingScreenshotSmoke) {
    return {
      panel: "connect",
      singleSetting: "memory-root",
      required: ["기억 저장 위치 설정만 표시", "기억 저장 위치", "폴더 선택"],
      forbidden: ["Codex OAuth 설정만 표시", "메일/캘린더 연결 설정만 표시", "업무 알림 비서 설정만 표시"],
    };
  }
  if (isMessengerChannelSingleSettingScreenshotSmoke) {
    return {
      panel: "messengers",
      singleSetting: "messenger-channel",
      required: ["메신저 채널 설정만 표시", "승인과 알림을 받을 채널만 설정합니다", "필요 채널 선택"],
      forbidden: ["외부 메신저 없이도 승인 대화는 앱 안에서 바로 시작합니다", "업무 알림 비서 기본 경로"],
    };
  }
  if (isCrewKitSingleSettingScreenshotSmoke) {
    return {
      panel: "skills",
      singleSetting: "crewkit",
      required: ["CrewKit 설정만 표시", "필요한 업무 스킬만 켜고 복원에 포함합니다", "담당 채널에 켜기"],
      forbidden: ["스킬 추천", "성장 제안"],
    };
  }
  if (isLearnSourceSingleSettingScreenshotSmoke) {
    return {
      panel: "learn",
      singleSetting: "learn-source",
      required: ["자료 분석 출처 설정만 표시", "폴더/드라이브 선택", "업무 파일 선택"],
      forbidden: ["폴더와 메일을 고르면 업무틀을 만듭니다", "자동화 후보 확인"],
    };
  }
  if (isOfficeQueueSingleSettingScreenshotSmoke) {
    return {
      panel: "office",
      singleSetting: "office-queue",
      required: ["업무 오피스 큐만 표시", "승인, 작업 상태, 최종 확인 큐만 봅니다", "최종 게이트"],
      forbidden: ["Codex OAuth에서 메일·일정 승인까지", "Chat to Office"],
    };
  }
  if (isWorkerChannelSingleSettingScreenshotSmoke) {
    return {
      panel: "workers",
      singleSetting: "worker-channel",
      required: ["AI 팀원 설정만 표시", "AI 팀원을 만들고 바로 맡길 준비만 합니다", "새 팀원 만들기"],
      forbidden: ["만들기 - 맡기기 - 기억하기 - 오피스 확인", "직원 운영 흐름"],
    };
  }
  if (isComputerUseSingleSettingScreenshotSmoke) {
    return {
      panel: "control",
      singleSetting: "computer-use",
      required: ["Computer Use 안전 설정만 표시", "읽기와 준비 작업만 먼저 켭니다", "변경 잠금"],
      forbidden: ["브라우저 업무 카드", "원격 실행"],
    };
  }
  return null;
}

async function runScreenshotSmoke(win) {
  if (!isScreenshotSmoke) return;

  try {
    if (isFirstScreenScreenshotSmoke) {
      await win.webContents.executeJavaScript(
        `
          (async () => {
            if (!sessionStorage.getItem('modycrew.firstScreenSmokeReset.v2')) {
              sessionStorage.setItem('modycrew.firstScreenSmokeReset.v2', '1');
              localStorage.removeItem('modycrew-chat-threads-v1');
              localStorage.removeItem('modycrew-active-ai-skills-v1');
              localStorage.removeItem('modycrew-ai-teammates-v1');
              localStorage.removeItem('modycrew-messenger-active-v1');
              localStorage.setItem('modycrew-theme-mode', 'light');
            /* BEGIN smoke scoped chat save */
            const persistSmokeChatThreads = async (bridge, threads, expectedRoot, caseInsensitive) => {
              if (!bridge?.loadChatThreads || !bridge?.saveChatThreads) throw new Error("Desktop chat memory bridge was not ready for smoke isolation.");
              const loaded = await bridge.loadChatThreads();
              const normalize = value => {
                let normalized = String(value ?? "").replaceAll(String.fromCharCode(92), "/");
                if (caseInsensitive) normalized = normalized.toLowerCase();
                while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
                return normalized;
              };
              if (loaded?.status !== "local_memory_chat_threads_loaded" || loaded?.chatRootScopeVersion !== 1 || !loaded?.root || normalize(loaded.root) !== normalize(expectedRoot)) {
                throw new Error("Refusing to write chat threads outside the isolated smoke root.");
              }
              const saved = await bridge.saveChatThreads(threads, loaded.root);
              if (saved?.status !== "local_memory_chat_threads_saved") throw new Error(saved?.userMessage || "Could not save isolated smoke chat threads.");
            };
            /* END smoke scoped chat save */
            await persistSmokeChatThreads(window.modyCrewDesktopBridge, [], ${JSON.stringify(path.join(app.getPath("userData"), "ModyCrew_Local_Data"))}, ${JSON.stringify(process.platform === "win32")});
              globalThis["location"].reload();
            }
          })();
        `,
        true,
      );
      await wait(900);
    }

    if (
      isAccountFirstScreenScreenshotSmoke ||
      isOfficeFirstScreenScreenshotSmoke ||
      isConnectFirstScreenScreenshotSmoke ||
      isInlineConnectPanelScreenshotSmoke
    ) {
      await win.webContents.executeJavaScript(
        `
          (() => {
            if (sessionStorage.getItem('modycrew.sectionSmokeTheme.v1') === 'light') return;
            sessionStorage.setItem('modycrew.sectionSmokeTheme.v1', 'light');
            localStorage.setItem('modycrew-theme-mode', 'light');
            globalThis["location"].reload();
          })();
        `,
        true,
      );
      await wait(900);
    }

    if (isLongChatLayoutScreenshotSmoke) {
      await win.webContents.executeJavaScript(
        `
          (async () => {
            const longText = [
              '회의 메모를 요약해줘. 이 이메일 더 정중하게 바꿔줘. 오늘 업무 우선순위 정리해줘.',
              '이 오류가 왜 나는지 설명해줘. 기획안 초안 만들어줘.',
              '긴 URL 테스트 https://example.com/some/really/long/path/that/should/not-break-the-chat-column-or-push-the-composer-outside-the-visible-window?query=abcdefghijklmnopqrstuvwxyz0123456789',
              '반복 업무는 승인 전 실행하지 말고 후보만 정리합니다. '.repeat(18)
            ].join('\\n\\n');
            const now = Date.now();
            const threads = [{
              id: 'thread-long-chat-smoke',
              title: '긴 대화 레이아웃 검증',
              createdAt: now - 1000,
              updatedAt: now,
              messages: [
                {
                  id: 'assistant-welcome',
                  role: 'assistant',
                  text: '무엇을 맡길까요? 필요한 연결은 제가 대화 중에만 열어드릴게요. 로그인 정보나 비밀번호는 채팅에 쓰지 않습니다.'
                },
                { id: 'user-long-smoke', role: 'user', text: '긴 답변 레이아웃 확인해줘' },
                {
                  id: 'assistant-long-smoke',
                  role: 'assistant',
                  text: longText,
                  actions: [{ label: '작업 상태 보기', href: '/office' }]
                }
              ]
            }];
            const existingThreads = localStorage.getItem('modycrew-chat-threads-v1') || '';
            const existingTheme = localStorage.getItem('modycrew-theme-mode') || '';
            if (!existingThreads.includes('thread-long-chat-smoke') || existingTheme !== 'light') {
              localStorage.setItem('modycrew-chat-threads-v1', JSON.stringify(threads));
            }
            /* BEGIN smoke scoped chat save */
            const persistSmokeChatThreads = async (bridge, threads, expectedRoot, caseInsensitive) => {
              if (!bridge?.loadChatThreads || !bridge?.saveChatThreads) throw new Error("Desktop chat memory bridge was not ready for smoke isolation.");
              const loaded = await bridge.loadChatThreads();
              const normalize = value => {
                let normalized = String(value ?? "").replaceAll(String.fromCharCode(92), "/");
                if (caseInsensitive) normalized = normalized.toLowerCase();
                while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
                return normalized;
              };
              if (loaded?.status !== "local_memory_chat_threads_loaded" || loaded?.chatRootScopeVersion !== 1 || !loaded?.root || normalize(loaded.root) !== normalize(expectedRoot)) {
                throw new Error("Refusing to write chat threads outside the isolated smoke root.");
              }
              const saved = await bridge.saveChatThreads(threads, loaded.root);
              if (saved?.status !== "local_memory_chat_threads_saved") throw new Error(saved?.userMessage || "Could not save isolated smoke chat threads.");
            };
            /* END smoke scoped chat save */
            await persistSmokeChatThreads(window.modyCrewDesktopBridge, threads, ${JSON.stringify(path.join(app.getPath("userData"), "ModyCrew_Local_Data"))}, ${JSON.stringify(process.platform === "win32")});
            localStorage.setItem('modycrew-theme-mode', 'light');
            globalThis["location"].reload();
          })();
        `,
        true,
      );
      await wait(900);
    }

    if (isMessengerPanelScreenshotSmoke || isWorkersPanelScreenshotSmoke) {
      await win.webContents.executeJavaScript(
        `
          (async () => {
            localStorage.setItem('modycrew-theme-mode', 'light');
            const expectedPanel = '${isMessengerPanelScreenshotSmoke ? "messengers" : "workers"}';
            const currentUrl = new URL(globalThis["location"].href);
            if (currentUrl.searchParams.get('panel') !== expectedPanel) {
              currentUrl.searchParams.set('panel', expectedPanel);
              globalThis["location"].replace(currentUrl.toString());
              return;
            }
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find((button) => (button.innerText || '').includes('${
              isMessengerPanelScreenshotSmoke ? "메신저" : "AI 팀원"
            }'));
            target?.scrollIntoView({ behavior: 'auto', block: 'center' });
            target?.click();
          })();
        `,
        true,
      );
      await wait(900);
    }

    if (isInlineConnectPanelScreenshotSmoke) {
      const inlineConnectState = await win.webContents.executeJavaScript(
        `
          (() => {
            const panel = document.querySelector('[class*="workspacePanel"][data-panel="connect"]');
            const handoff = document.querySelector('[class*="inlineConnectHandoff"]');
            const vault = document.querySelector('[class*="inlineVaultDock"]');
            const text = [handoff?.innerText || '', vault?.innerText || '', document.body?.innerText || ''].join('\\n');
            vault?.scrollIntoView({ behavior: 'auto', block: 'center' });
            return {
              hasPanel: Boolean(panel),
              hasHandoff: Boolean(handoff),
              hasVault: Boolean(vault),
              text: text.slice(0, 1600),
            };
          })();
        `,
        true,
      );
      const required = ["설정창에서 연결", "Telegram", "Slack", "회사/그룹웨어 메일", "사이트 계정은 여기에서만 저장"];
      const missing = required.filter((phrase) => !String(inlineConnectState.text).includes(phrase));
      if (!inlineConnectState.hasPanel || !inlineConnectState.hasHandoff || !inlineConnectState.hasVault || missing.length > 0) {
        throw new Error(`inline connect panel missing: ${JSON.stringify({ ...inlineConnectState, missing })}`);
      }
      await wait(700);
    }

    if (isDocumentHandoffScreenshotSmoke) {
      await win.webContents.executeJavaScript(
        `
          if (!sessionStorage.getItem('modycrew.documentHandoffSmokeReset')) {
            sessionStorage.setItem('modycrew.documentHandoffSmokeReset', '1');
            localStorage.removeItem('modycrew.localAutomationDrafts.v1');
            localStorage.removeItem('modycrew.localAutomationRules.v1');
            localStorage.removeItem('modycrew.workPackInstallations.v1');
            globalThis["location"].reload();
          }
        `,
        true,
      );
      await wait(900);
    }

    const officeFirstScreenSecondaryContractLabels = ["AI 팀원 활동", "메인 관제"];
    void officeFirstScreenSecondaryContractLabels;
    let pageText = "";
    const singleSettingContract = getSingleSettingScreenshotContract();
    const initialRequiredPhrases = singleSettingContract
      ? [...(singleSettingContract.requiresModeLabel === false ? [] : ["단일 설정"]), ...singleSettingContract.required]
      : isScheduleBriefingScreenshotSmoke
      ? ["브리핑 핵심 근거", "감지 시간", "장소", "참석자", "충돌"]
      : isLongChatLayoutScreenshotSmoke
        ? ["긴 답변 레이아웃 확인해줘", "작업 상태 보기", "보내기"]
      : isMessengerPanelScreenshotSmoke
        ? ["메신저와 앱 채널 구성", "공식 API 우선, 막히면 대체 루트", "Telegram Bot", "오피스 라우팅"]
      : isWorkersPanelScreenshotSmoke
        ? ["직원", "직원 만들기와 업무 현황", "직원 활동 창", "일하는 모습", "나머지 직원"]
      : isAccountFirstScreenScreenshotSmoke
        ? ["ModyCrew", "ModyCrew 시작하기", "로그인만 하면 됩니다"]
      : isWelcomeFirstScreenScreenshotSmoke
        ? [
            "로그인 후, 터미널 없이 기본 설정만 합니다",
            "로그인 엔진 준비",
            "Email/Password Firebase Auth",
            "로그인하고 업무실 열기",
          ]
      : isOfficeFirstScreenScreenshotSmoke
        ? ["AI 팀원 작업 상태", "오늘 업무", "실행중", "승인대기", "Chat to Office", "AI 오피스"]
      : isLearnFirstScreenScreenshotSmoke
        ? ["폴더와 메일을 고르면 업무틀을 만듭니다", "자료 선택", "자동화 후보 확인"]
      : isConnectFirstScreenScreenshotSmoke
        ? ["필요한 연결만 하나씩 추가합니다", "필요 연결만 보기", "지금 이 업무에 필요한 연결"]
      : isConnectGuideScreenshotSmoke
        ? [
            "Google Calendar 설정",
            "다른 연결 목록은 접어두고 지금 선택한 설정만 처리합니다.",
            "따라하기 연결 가이드",
            "연결 후 실제로 바뀌는 일",
            "캘린더를 읽고 오늘/이번 주 우선순위를 계속 정리합니다",
            "쓰기 권한 필요",
          ]
      : isInlineConnectPanelScreenshotSmoke
        ? ["필요한 연결만 안전하게 열기", "설정창에서 연결", "Telegram", "Slack"]
      : isDocumentHandoffScreenshotSmoke
        ? ["자료 학습 추천", "업무팩으로 만들 자료 추천", "업무팩으로 만들기", "첫 반복 업무는 기본 꺼짐"]
      : isMailCalendarScreenshotSmoke
        ? ["메일 제목", "승인 후보", "감지 일정", "캘린더 등록 검토", "승인 후 등록", "근거에서 실행까지"]
      : ["ModyCrew", "무엇을 도와드릴까요"];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await wait(500);
      pageText = await win.webContents.executeJavaScript(
        `document.body ? document.body.innerText.slice(0, ${
          isScheduleBriefingScreenshotSmoke ||
          isLongChatLayoutScreenshotSmoke ||
          isMessengerPanelScreenshotSmoke ||
          isWorkersPanelScreenshotSmoke ||
          isMailCalendarScreenshotSmoke ||
          isAccountFirstScreenScreenshotSmoke ||
          isWelcomeFirstScreenScreenshotSmoke ||
          isOfficeFirstScreenScreenshotSmoke ||
          isLearnFirstScreenScreenshotSmoke ||
          isConnectFirstScreenScreenshotSmoke ||
          isConnectGuideScreenshotSmoke ||
          isInlineConnectPanelScreenshotSmoke ||
          isDocumentHandoffScreenshotSmoke ||
          Boolean(singleSettingContract)
            ? 50000
            : 3000
        }) : ''`,
        true,
      );
      if (initialRequiredPhrases.every((phrase) => String(pageText).includes(phrase))) {
        break;
      }
    }
    const title = await win.webContents.executeJavaScript("document.title", true).catch(() => "");
    if (!String(title).includes("ModyCrew")) {
      throw new Error(`first screen title missing ModyCrew: ${title}`);
    }
    const bridgeAvailable = await win.webContents
      .executeJavaScript("typeof window.modyCrewDesktopBridge === 'object'", true)
      .catch(() => false);
    if (!bridgeAvailable) {
      throw new Error("desktop preload bridge missing: window.modyCrewDesktopBridge");
    }

    let missing = initialRequiredPhrases.filter((phrase) => !String(pageText).includes(phrase));
    const defaultWorkbenchScreenReady =
      !isScheduleBriefingScreenshotSmoke &&
      !isLongChatLayoutScreenshotSmoke &&
      !isMessengerPanelScreenshotSmoke &&
      !isWorkersPanelScreenshotSmoke &&
      !isMailCalendarScreenshotSmoke &&
      !isAccountFirstScreenScreenshotSmoke &&
      !isWelcomeFirstScreenScreenshotSmoke &&
      !isOfficeFirstScreenScreenshotSmoke &&
      !isLearnFirstScreenScreenshotSmoke &&
      !isConnectFirstScreenScreenshotSmoke &&
      !isConnectGuideScreenshotSmoke &&
      !isInlineConnectPanelScreenshotSmoke &&
      !isDocumentHandoffScreenshotSmoke &&
      String(pageText).includes("AI 팀원 활동") &&
      String(pageText).includes("완전히 새 직원 만들기") &&
      String(pageText).includes("ModyCrew");
    if (defaultWorkbenchScreenReady) {
      missing = [];
    }
    if (missing.length > 0) {
      const location = await win.webContents.executeJavaScript("document.URL", true).catch(() => "");
      throw new Error(
        `first screen text missing: ${missing.join(", ")}; location=${location}; title=${title}; text=${String(pageText).slice(0, 240)}`,
      );
    }
    if (isFirstScreenScreenshotSmoke) {
      const firstWorkReady = await win.webContents.executeJavaScript(`(() => {
        const form = document.querySelector('form[aria-label="첫 업무 입력"]');
        const input = form?.querySelector('[aria-label="채팅 메시지"]');
        const send = form?.querySelector('button[aria-label="메시지 보내기"]');
        return Boolean(input?.getClientRects().length && send?.getClientRects().length &&
          typeof window.modyCrewDesktopBridge?.getLocalMemoryStatus === 'function');
      })()`);
      if (!firstWorkReady) throw new Error("first work composer or desktop bridge unavailable");
    }

    if (singleSettingContract) {
      const singleSettingState = await win.webContents.executeJavaScript(
        `
          (() => {
            const contract = ${JSON.stringify(singleSettingContract)};
            const isVisible = (element) => {
              if (!element) return false;
              const style = window.getComputedStyle(element);
              const box = element.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
            };
            const panel = document.querySelector('[class*="workspacePanel"][data-panel="' + contract.panel + '"]');
            const settingRoot = document.querySelector('[data-single-setting="' + contract.singleSetting + '"]');
            const visibleSingleSettings = Array.from(document.querySelectorAll('[data-single-setting]'))
              .filter(isVisible)
              .map((node) => node.getAttribute('data-single-setting'))
              .filter(Boolean);
            const text = document.body ? document.body.innerText.slice(0, 50000) : '';
            settingRoot?.scrollIntoView({ behavior: 'auto', block: 'start' });
            return {
              url: document.URL,
              hasPanel: Boolean(panel) && isVisible(panel),
              hasSettingRoot: Boolean(settingRoot) && isVisible(settingRoot),
              visibleSingleSettings,
              missingRequired: contract.required.filter((phrase) => !text.includes(phrase)),
              leakedForbidden: contract.forbidden.filter((phrase) => text.includes(phrase)),
              text: text.slice(0, 1200),
            };
          })();
        `,
        true,
      );
      const hasOnlyExpectedSetting =
        Array.isArray(singleSettingState.visibleSingleSettings) &&
        singleSettingState.visibleSingleSettings.length === 1 &&
        singleSettingState.visibleSingleSettings[0] === singleSettingContract.singleSetting;
      if (
        !singleSettingState.hasPanel ||
        !singleSettingState.hasSettingRoot ||
        !hasOnlyExpectedSetting ||
        singleSettingState.missingRequired.length > 0 ||
        singleSettingState.leakedForbidden.length > 0
      ) {
        throw new Error(`single setting smoke contract failed: ${JSON.stringify(singleSettingState)}`);
      }
      await wait(700);
    }

    if (isLongChatLayoutScreenshotSmoke) {
      const layout = await win.webContents.executeJavaScript(
        `
          (() => {
            const body = document.body;
            const composer = document.querySelector('form[class*="composer"]');
            const list = document.querySelector('ol[aria-label="대화"]');
            const stage = document.querySelector('section[aria-label="AI 업무 채팅"]');
            const composerBox = composer?.getBoundingClientRect();
            const listBox = list?.getBoundingClientRect();
            const stageBox = stage?.getBoundingClientRect();
            return {
              bodyScrollWidth: body?.scrollWidth ?? 0,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              composerBottom: composerBox?.bottom ?? 0,
              composerTop: composerBox?.top ?? 0,
              listTop: listBox?.top ?? 0,
              listBottom: listBox?.bottom ?? 0,
              listScrollHeight: list?.scrollHeight ?? 0,
              listClientHeight: list?.clientHeight ?? 0,
              stageHeight: stageBox?.height ?? 0
            };
          })()
        `,
        true,
      );
      if (layout.bodyScrollWidth > layout.viewportWidth + 2) {
        throw new Error(`long chat horizontal overflow: ${JSON.stringify(layout)}`);
      }
      if (layout.composerBottom > layout.viewportHeight + 2 || layout.composerTop < 0) {
        throw new Error(`long chat composer escaped viewport: ${JSON.stringify(layout)}`);
      }
      if (layout.listBottom > layout.composerTop + 2 || layout.listTop < 0) {
        throw new Error(`long chat message list overlaps composer: ${JSON.stringify(layout)}`);
      }
    }

    if (isMessengerPanelScreenshotSmoke || isWorkersPanelScreenshotSmoke) {
      const layout = await win.webContents.executeJavaScript(
        `
          (() => {
            const body = document.body;
            const panel = document.querySelector('[class*="workspacePanel"][data-panel="${
              isMessengerPanelScreenshotSmoke ? "messengers" : "workers"
            }"]');
            const switchboard = document.querySelector('[class*="roleChannelSwitchboard"]');
            const composer = document.querySelector('form[class*="composer"]');
            const panelBox = panel?.getBoundingClientRect();
            const switchBox = switchboard?.getBoundingClientRect();
            const composerBox = composer?.getBoundingClientRect();
            return {
              bodyScrollWidth: body?.scrollWidth ?? 0,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              panelTop: panelBox?.top ?? 0,
              panelBottom: panelBox?.bottom ?? 0,
              panelLeft: panelBox?.left ?? 0,
              panelRight: panelBox?.right ?? 0,
              panelWidth: panelBox?.width ?? 0,
              composerTop: composerBox?.top ?? 0,
              switchboardVisible: Boolean(switchBox && switchBox.width > 0 && switchBox.height > 0),
            };
          })()
        `,
        true,
      );
      if (layout.bodyScrollWidth > layout.viewportWidth + 2) {
        throw new Error(`workspace panel horizontal overflow: ${JSON.stringify(layout)}`);
      }
      if (layout.switchboardVisible) {
        throw new Error(`workspace panel duplicate channel switchboard visible: ${JSON.stringify(layout)}`);
      }
      const minimumPanelWidth = isWorkersPanelScreenshotSmoke ? 320 : 520;
      if (layout.panelWidth < minimumPanelWidth || layout.panelLeft < 0 || layout.panelRight > layout.viewportWidth + 2) {
        throw new Error(`workspace panel frame is misaligned: ${JSON.stringify(layout)}`);
      }
      if (layout.composerTop > 0 && layout.panelBottom > layout.composerTop - 8) {
        throw new Error(`workspace panel overlaps composer: ${JSON.stringify(layout)}`);
      }
    }

    if (isMailCalendarFinalConfirmationScreenshotSmoke) {
      const clicked = await win.webContents.executeJavaScript(
        `
          const buttons = Array.from(document.querySelectorAll('button'));
          const candidates = buttons.filter((button) => {
            const text = button.innerText || '';
            const box = button.getBoundingClientRect();
            const visible = box.width > 0 && box.height > 0;
            return text.includes('일정 등록 검토') && visible && !button.disabled;
          });
          const target =
            candidates.find((button) => button.closest('[class*="selectedActionGuideActions"]')) ||
            candidates[candidates.length - 1];
          target?.scrollIntoView({ behavior: 'auto', block: 'center' });
          target?.click();
          Boolean(target);
        `,
        true,
      );
      if (!clicked) {
        throw new Error("mail/calendar final confirmation trigger missing: 일정 등록 검토");
      }
      const modalRequiredPhrases = [
        "일정 승인 요약",
        "쓰기 권한으로 캘린더 연결",
        "참석자",
        "장소",
        "회의 링크",
        "알림",
        "하루 전 + 3시간",
      ];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await wait(500);
        pageText = await win.webContents.executeJavaScript(
          "document.body ? document.body.innerText.slice(0, 50000) : ''",
          true,
        );
        if (modalRequiredPhrases.every((phrase) => String(pageText).includes(phrase))) {
          break;
        }
      }
      const modalMissing = modalRequiredPhrases.filter((phrase) => !String(pageText).includes(phrase));
      if (modalMissing.length > 0) {
        throw new Error(
          `mail/calendar final confirmation text missing: ${modalMissing.join(", ")}; text=${String(pageText).slice(0, 360)}`,
        );
      }
      await win.webContents.executeJavaScript(
        `
          const dialog = document.querySelector('[role="dialog"]');
          dialog?.scrollIntoView({ behavior: 'auto', block: 'start' });
        `,
        true,
      );
      await wait(500);
    }

    if (isConnectGuideScreenshotSmoke) {
      await win.webContents.executeJavaScript(
        `
          const outcome =
            document.querySelector('[aria-label="연결 후 AI 업무 미리보기"]') ||
            document.querySelector('[aria-label*="연결 따라하기"]');
          outcome?.scrollIntoView({ behavior: 'auto', block: 'center' });
        `,
        true,
      );
      await wait(700);
    }

    if (isScheduleBriefingScreenshotSmoke || isMailCalendarScreenshotSmoke) {
      await win.webContents.executeJavaScript(
        `
          const evidence =
            document.querySelector('[role="dialog"]') ||
            document.querySelector('[aria-label="브리핑 핵심 근거"]') ||
            document.querySelector('[aria-label="업무 근거"]') ||
            document.querySelector('[aria-label="업무 실행 패널"]');
          const selectedWork = document.querySelector('[aria-label="선택 업무"]');
          (evidence || selectedWork)?.scrollIntoView({ behavior: 'auto', block: 'start' });
        `,
        true,
      );
      await wait(700);
    }

    if (isDocumentHandoffScreenshotSmoke) {
      const clicked = await win.webContents.executeJavaScript(
        `
          const buttons = Array.from(document.querySelectorAll('button'));
          const candidates = buttons.filter((button) => {
            const text = button.innerText || '';
            const box = button.getBoundingClientRect();
            return text.includes('업무팩으로 만들기') && box.width > 0 && box.height > 0 && !button.disabled;
          });
          const target =
            candidates.find((button) => button.closest('[class*="selectedActionGuideActions"]')) ||
            candidates[0];
          target?.scrollIntoView({ behavior: 'auto', block: 'center' });
          target?.click();
          Boolean(target);
        `,
        true,
      );
      if (!clicked) {
        throw new Error("document handoff install trigger missing: 업무팩으로 만들기");
      }
      const installRequiredPhrases = ["첫 점검 미리보기", "읽은 항목", "부족 연결", "반복 업무 다시 저장"];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await wait(500);
        pageText = await win.webContents.executeJavaScript(
          "document.body ? document.body.innerText.slice(0, 50000) : ''",
          true,
        );
        if (installRequiredPhrases.every((phrase) => String(pageText).includes(phrase))) {
          break;
        }
      }
      const installMissing = installRequiredPhrases.filter((phrase) => !String(pageText).includes(phrase));
      if (installMissing.length > 0) {
        throw new Error(
          `document handoff install result text missing: ${installMissing.join(", ")}; text=${String(pageText).slice(0, 360)}`,
        );
      }
      const enabledRule = await win.webContents.executeJavaScript(
        `
          (() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find((button) => {
              const text = button.innerText || '';
              const box = button.getBoundingClientRect();
              return (
                text.includes('반복 업무 켜기') &&
                box.width > 0 &&
                box.height > 0 &&
                !button.disabled &&
                Boolean(button.closest('[class*="selectedDocumentEvidenceActions"]'))
              );
            });
            target?.scrollIntoView({ behavior: 'auto', block: 'center' });
            target?.click();
            return Boolean(target);
          })();
        `,
        true,
      );
      if (!enabledRule) {
        throw new Error("document handoff enable rule trigger missing: 반복 업무 켜기");
      }
      let enabledRuleState = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await wait(400);
        enabledRuleState = await win.webContents.executeJavaScript(
          `
            (() => {
              const rules = JSON.parse(localStorage.getItem('modycrew.localAutomationRules.v1') || '[]');
              return rules.some((rule) => rule && rule.enabled === true);
            })();
          `,
          true,
        );
        if (enabledRuleState) break;
      }
      if (!enabledRuleState) {
        throw new Error("document handoff enabled rule state missing: local automation rule was not enabled");
      }
      const connectorGuideClicked = await win.webContents.executeJavaScript(
        `
          (() => {
            const links = Array.from(document.querySelectorAll('a'));
            const guideLink = links.find((link) => {
              const text = link.innerText || '';
              const box = link.getBoundingClientRect();
              return text.includes('부족 연결 바로 열기') && box.width > 0 && box.height > 0;
            });
            guideLink?.scrollIntoView({ behavior: 'auto', block: 'center' });
            guideLink?.click();
            return Boolean(guideLink);
          })();
        `,
        true,
      );
      if (!connectorGuideClicked) {
        throw new Error("document handoff missing connector guide link: 부족 연결 바로 열기");
      }
      const connectorGuidePhrases = ["반복 업무에 부족한 연결", "반복 업무 카드에서 넘어왔습니다", "홈에서 점검 이어가기"];
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await wait(500);
        pageText = await win.webContents.executeJavaScript(
          "document.body ? document.body.innerText.slice(0, 50000) : ''",
          true,
        );
        if (connectorGuidePhrases.every((phrase) => String(pageText).includes(phrase))) {
          break;
        }
      }
      const connectorGuideMissing = connectorGuidePhrases.filter((phrase) => !String(pageText).includes(phrase));
      if (connectorGuideMissing.length > 0) {
        throw new Error(
          `document handoff connector guide text missing: ${connectorGuideMissing.join(", ")}; text=${String(pageText).slice(0, 360)}`,
        );
      }
      const returnedHome = await win.webContents.executeJavaScript(
        `
          (() => {
            const links = Array.from(document.querySelectorAll('a'));
            const returnLink = links.find((link) => {
              const text = link.innerText || '';
              const href = link.getAttribute('href') || '';
              const box = link.getBoundingClientRect();
              return text.includes('홈에서 점검 이어가기') && href.includes('runRule=1') && box.width > 0 && box.height > 0;
            });
            returnLink?.scrollIntoView({ behavior: 'auto', block: 'center' });
            returnLink?.click();
            return Boolean(returnLink);
          })();
        `,
        true,
      );
      if (!returnedHome) {
        throw new Error("document handoff return link missing: 홈에서 점검 이어가기 runRule=1");
      }
      let runRuleState = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await wait(500);
        runRuleState = await win.webContents.executeJavaScript(
          `
            (() => {
              const rules = JSON.parse(localStorage.getItem('modycrew.localAutomationRules.v1') || '[]');
              const rule = rules.find((item) => item && item.enabled === true);
              return {
                url: document.URL,
                hasDesktopRun:
                  Boolean(rule?.latestRunStats) &&
                  rule.latestRunStats.mode === 'desktop' &&
                  (
                    rule.latestRunStats.status === 'trigger_runner_completed' ||
                    Number(rule.latestRunStats.createdWorkItems || 0) > 0 ||
                    Number(rule.latestRunStats.approvalQueue || 0) > 0 ||
                    String(rule.latestRunMessage || '').includes('반복 점검')
                  ),
                rule: rule
                  ? {
                      id: rule.id,
                      enabled: rule.enabled,
                      latestRunMessage: rule.latestRunMessage || '',
                      latestRunStats: rule.latestRunStats || null,
                    }
                  : null,
                text: document.body ? document.body.innerText.slice(0, 720) : '',
              };
            })();
          `,
          true,
        );
        if (runRuleState?.hasDesktopRun === true) {
          break;
        }
      }
      if (runRuleState?.hasDesktopRun !== true) {
        throw new Error(`document handoff runRule desktop state missing: ${JSON.stringify(runRuleState)}`);
      }
      await win.webContents.executeJavaScript(
        `
          const evidence =
            document.querySelector('[aria-label="자동화 규칙"]') ||
            document.querySelector('[data-rule-id][data-highlight="true"]') ||
            document.querySelector('[aria-label*="최근 실행 결과"]') ||
            document.querySelector('[class*="returnToWorkPanel"]') ||
            document.querySelector('[aria-label*="반복 업무에 부족한 연결"]') ||
            document.querySelector('[aria-label*="첫 점검 미리보기"]') ||
            document.querySelector('[class*="workPackFirstRunPreview"]') ||
            document.querySelector('[aria-label="자료 학습 자동화 근거"]') ||
            document.querySelector('[aria-label="선택 업무"]') ||
            document.querySelector('[aria-label="업무 큐"]');
          evidence?.scrollIntoView({ behavior: 'auto', block: 'start' });
        `,
        true,
      );
      await wait(700);
    }

    const image = await win.webContents.capturePage();
    const size = image.getSize();
    const minimumCapture = isScheduleBriefingMobileScreenshotSmoke
      ? { width: 360, height: 640 }
      : { width: 900, height: 600 };
    if (image.isEmpty() || size.width < minimumCapture.width || size.height < minimumCapture.height) {
      throw new Error(`first screen capture invalid: ${size.width}x${size.height}`);
    }

    const outputPath = path.resolve(
      repoRoot,
      process.env.MODYCREW_SCREENSHOT_SMOKE_PATH ||
        (isConnectGuideScreenshotSmoke
          ? "dist/smoke/modycrew-connect-guide-outcome.png"
          : isCodexSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-codex-single-setting.png"
          : isMailSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-mail-single-setting.png"
          : isNotificationSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-notification-single-setting.png"
          : isMailLearningSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-mail-learning-single-setting.png"
          : isVaultSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-vault-single-setting.png"
          : isMemoryRootSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-memory-root-single-setting.png"
          : isMessengerChannelSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-messenger-channel-single-setting.png"
          : isCrewKitSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-crewkit-single-setting.png"
          : isLearnSourceSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-learn-source-single-setting.png"
          : isOfficeQueueSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-office-queue-single-setting.png"
          : isWorkerChannelSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-worker-channel-single-setting.png"
          : isComputerUseSingleSettingScreenshotSmoke
          ? "dist/smoke/modycrew-computer-use-single-setting.png"
          : isInlineConnectPanelScreenshotSmoke
          ? "dist/smoke/modycrew-inline-connect-panel.png"
          : isLongChatLayoutScreenshotSmoke
          ? "dist/smoke/modycrew-long-chat-layout.png"
          : isMessengerPanelScreenshotSmoke
          ? "dist/smoke/modycrew-messenger-panel.png"
          : isWorkersPanelScreenshotSmoke
          ? "dist/smoke/modycrew-workers-panel.png"
          : isWelcomeFirstScreenScreenshotSmoke
          ? "dist/smoke/modycrew-welcome-first-screen.png"
          : isAccountFirstScreenScreenshotSmoke
          ? "dist/smoke/modycrew-account-first-screen.png"
          : isOfficeFirstScreenScreenshotSmoke
          ? "dist/smoke/modycrew-office-first-screen.png"
          : isConnectFirstScreenScreenshotSmoke
          ? "dist/smoke/modycrew-connect-first-screen.png"
          : isLearnFirstScreenScreenshotSmoke
          ? "dist/smoke/modycrew-learn-first-screen.png"
          : isDocumentHandoffScreenshotSmoke
            ? "dist/smoke/modycrew-document-handoff-queue.png"
          : isMailCalendarScreenshotSmoke
          ? isMailCalendarFinalConfirmationScreenshotSmoke
            ? "dist/smoke/modycrew-mail-calendar-final-confirmation.png"
            : "dist/smoke/modycrew-mail-calendar-approval-evidence.png"
          : isScheduleBriefingScreenshotSmoke
            ? isScheduleBriefingMobileScreenshotSmoke
              ? "dist/smoke/modycrew-schedule-briefing-evidence-mobile.png"
              : "dist/smoke/modycrew-schedule-briefing-evidence.png"
            : "dist/smoke/modycrew-desktop-first-screen.png"),
    );
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, image.toPNG());
    console.log(
      JSON.stringify(
        {
          status: "desktop_first_screen_screenshot_ok",
          smokeKind: isConnectGuideScreenshotSmoke
            ? "connect_guide_outcome"
            : isCodexSingleSettingScreenshotSmoke
            ? "codex_single_setting"
            : isMailSingleSettingScreenshotSmoke
            ? "mail_single_setting"
            : isNotificationSingleSettingScreenshotSmoke
            ? "notification_single_setting"
            : isMailLearningSingleSettingScreenshotSmoke
            ? "mail_learning_single_setting"
            : isVaultSingleSettingScreenshotSmoke
            ? "vault_single_setting"
            : isMemoryRootSingleSettingScreenshotSmoke
            ? "memory_root_single_setting"
            : isMessengerChannelSingleSettingScreenshotSmoke
            ? "messenger_channel_single_setting"
            : isCrewKitSingleSettingScreenshotSmoke
            ? "crewkit_single_setting"
            : isLearnSourceSingleSettingScreenshotSmoke
            ? "learn_source_single_setting"
            : isOfficeQueueSingleSettingScreenshotSmoke
            ? "office_queue_single_setting"
            : isWorkerChannelSingleSettingScreenshotSmoke
            ? "worker_channel_single_setting"
            : isComputerUseSingleSettingScreenshotSmoke
            ? "computer_use_single_setting"
            : isInlineConnectPanelScreenshotSmoke
            ? "inline_connect_panel"
            : isLongChatLayoutScreenshotSmoke
            ? "long_chat_layout"
            : isMessengerPanelScreenshotSmoke
            ? "messenger_panel"
            : isWorkersPanelScreenshotSmoke
            ? "workers_panel"
            : isWelcomeFirstScreenScreenshotSmoke
            ? "welcome_first_screen"
            : isAccountFirstScreenScreenshotSmoke
            ? "account_first_screen"
            : isOfficeFirstScreenScreenshotSmoke
            ? "office_first_screen"
            : isConnectFirstScreenScreenshotSmoke
            ? "connect_first_screen"
            : isLearnFirstScreenScreenshotSmoke
            ? "learn_first_screen"
            : isDocumentHandoffScreenshotSmoke
            ? "document_handoff_queue"
            : isMailCalendarScreenshotSmoke
            ? isMailCalendarFinalConfirmationScreenshotSmoke
              ? "mail_calendar_final_confirmation"
              : "mail_calendar_approval_evidence"
            : isScheduleBriefingScreenshotSmoke
            ? isScheduleBriefingMobileScreenshotSmoke
              ? "schedule_briefing_evidence_mobile"
              : "schedule_briefing_evidence"
            : "first_screen",
          outputPath,
          width: size.width,
          height: size.height,
          target,
        },
        null,
        2,
      ),
    );
    isExplicitQuit = true;
    app.quit();
  } catch (err) {
    console.error(
      JSON.stringify(
        {
          status: "desktop_first_screen_screenshot_failed",
          smokeKind: isConnectGuideScreenshotSmoke
            ? "connect_guide_outcome"
            : isCodexSingleSettingScreenshotSmoke
            ? "codex_single_setting"
            : isMailSingleSettingScreenshotSmoke
            ? "mail_single_setting"
            : isNotificationSingleSettingScreenshotSmoke
            ? "notification_single_setting"
            : isMailLearningSingleSettingScreenshotSmoke
            ? "mail_learning_single_setting"
            : isVaultSingleSettingScreenshotSmoke
            ? "vault_single_setting"
            : isMemoryRootSingleSettingScreenshotSmoke
            ? "memory_root_single_setting"
            : isMessengerChannelSingleSettingScreenshotSmoke
            ? "messenger_channel_single_setting"
            : isCrewKitSingleSettingScreenshotSmoke
            ? "crewkit_single_setting"
            : isLearnSourceSingleSettingScreenshotSmoke
            ? "learn_source_single_setting"
            : isOfficeQueueSingleSettingScreenshotSmoke
            ? "office_queue_single_setting"
            : isWorkerChannelSingleSettingScreenshotSmoke
            ? "worker_channel_single_setting"
            : isComputerUseSingleSettingScreenshotSmoke
            ? "computer_use_single_setting"
            : isLongChatLayoutScreenshotSmoke
            ? "long_chat_layout"
            : isMessengerPanelScreenshotSmoke
            ? "messenger_panel"
            : isWorkersPanelScreenshotSmoke
            ? "workers_panel"
            : isWelcomeFirstScreenScreenshotSmoke
            ? "welcome_first_screen"
            : isAccountFirstScreenScreenshotSmoke
            ? "account_first_screen"
            : isOfficeFirstScreenScreenshotSmoke
            ? "office_first_screen"
            : isConnectFirstScreenScreenshotSmoke
            ? "connect_first_screen"
            : isLearnFirstScreenScreenshotSmoke
            ? "learn_first_screen"
            : isMailCalendarScreenshotSmoke
            ? isMailCalendarFinalConfirmationScreenshotSmoke
              ? "mail_calendar_final_confirmation"
              : "mail_calendar_approval_evidence"
            : isScheduleBriefingScreenshotSmoke
            ? isScheduleBriefingMobileScreenshotSmoke
              ? "schedule_briefing_evidence_mobile"
              : "schedule_briefing_evidence"
            : "first_screen",
          message: String(err?.message ?? err),
          target,
          diagnostics: firstScreenSmokeDiagnostics.slice(-12),
        },
        null,
        2,
      ),
    );
    isExplicitQuit = true;
    app.exit(1);
  }
}

async function runAIChatSmoke(win) {
  if (!isAIChatSmoke) return;
  const reportPath = path.join(repoRoot, "tmp", "desktop-ai-chat-smoke-report.json");
  const prompt = "안녕 너는 누구야?";
  const report = {
    status: "started",
    prompt,
    providerStatus: null,
    directGeneration: null,
    chatResult: null,
    target,
    outputPath: reportPath,
    errors: [],
  };

  try {
    await clearRendererStorageForSmoke(win);
    const result = await win.webContents.executeJavaScript(
      `
        (async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value) => String(value ?? "").replace(/\\s+/gu, " ").trim();
          const findReadyProvider = (providers = []) => providers.find((provider) =>
            (provider.provider === "codex_oauth" &&
              provider.hasLocalKey &&
              (provider.status === "codex_oauth_ready" || provider.status === "codex_oauth_detected")) ||
            ((provider.provider === "openai" || provider.provider === "gemini") && provider.hasLocalKey)
          );
          for (let index = 0; index < 80; index += 1) {
            if (document.querySelector("textarea") && window.modyCrewDesktopBridge?.generateAIText) break;
            await wait(500);
          }
          const textarea = document.querySelector("textarea");
          const bridge = window.modyCrewDesktopBridge;
          const providerStatus = await bridge?.getAIProviderStatus?.();
          const readyProvider = findReadyProvider(providerStatus?.providers ?? []);
          if (!textarea || !bridge?.generateAIText) {
            return {
              status: "chat_surface_not_ready",
              providerStatus,
              bodyText: normalize(document.body?.innerText).slice(0, 1200),
              hasTextarea: Boolean(textarea),
              hasBridge: Boolean(bridge),
            };
          }
          if (!readyProvider) {
            return {
              status: "ai_not_ready",
              providerStatus,
              bodyText: normalize(document.body?.innerText).slice(0, 1200),
              hasTextarea: true,
              hasBridge: true,
            };
          }
          const directGeneration = await bridge.generateAIText({
            prompt: "ModyCrew 실제 AI 연결 스모크입니다. 'AI 스모크 확인'이라고 한 문장으로 답하세요.",
          });
          if (directGeneration?.status !== "generate_content_loaded" || !directGeneration?.outputText) {
            return {
              status: "direct_generation_failed",
              providerStatus,
              directGeneration,
              bodyText: normalize(document.body?.innerText).slice(0, 1200),
            };
          }
          const userCountBefore = document.querySelectorAll('li[data-role="user"]').length;
          const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          valueSetter?.call(textarea, ${JSON.stringify(prompt)});
          textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(prompt)} }));
          await wait(200);
          const submit = Array.from(document.querySelectorAll("button")).find((button) =>
            normalize(button.innerText) === "보내기"
          );
          if (submit?.form?.requestSubmit) {
            submit.form.requestSubmit(submit);
          } else {
            submit?.click();
          }
          let chatResult = null;
          let lastChatProbe = null;
          for (let index = 0; index < 180; index += 1) {
            await wait(500);
            const chatItems = Array.from(document.querySelectorAll("li[data-role]"));
            const userItems = chatItems.filter((item) => item.getAttribute("data-role") === "user");
            const bodyText = document.body?.innerText ?? "";
            let userOrdinal = 0;
            const promptUserIndex = chatItems.findIndex((item) => {
              if (item.getAttribute("data-role") !== "user") return false;
              const isNewUserMessage = userOrdinal >= userCountBefore;
              userOrdinal += 1;
              return isNewUserMessage && normalize(item.textContent).includes(${JSON.stringify(prompt)});
            });
            lastChatProbe = {
              userCountBefore,
              userCountAfter: userItems.length,
              chatItemCount: chatItems.length,
              promptUserIndex,
              tailText: normalize(bodyText).slice(-1200),
            };
            if (promptUserIndex < 0 || userItems.length <= userCountBefore) continue;
            const completedAssistantItems = chatItems.slice(promptUserIndex + 1).filter((item) => {
              if (item.getAttribute("data-role") !== "assistant") return false;
              const text = normalize(item.textContent);
              return text &&
                text !== "답변을 쓰는 중" &&
                !text.includes("복잡한 설정부터 하지 않아도 됩니다") &&
                !text.includes("AI 로그인 링크") &&
                !text.includes("앱 안 AI 연결이 필요") &&
                !text.includes("AI 연결하기") &&
                !text.includes("desktop-pending-chat-smoke") &&
                !text.includes("일정 후보로 정리했습니다") &&
                !text.includes("보고서 후보로 정리했습니다") &&
                !text.includes("폴더 정리 후보") &&
                !text.includes("반복 업무 후보") &&
                !text.includes("내 PC 작업 후보");
            });
            if (completedAssistantItems.length) {
              const assistantTexts = completedAssistantItems
                .map((item) => normalize(item.textContent).slice(0, 1200))
                .filter(Boolean);
              const lastAssistantText = normalize(completedAssistantItems.at(-1)?.textContent).slice(0, 1200);
              chatResult = {
                assistantCount: completedAssistantItems.length,
                assistantTexts,
                lastAssistantText,
                hasNamingMisroute:
                  lastAssistantText.includes("호칭 저장") ||
                  lastAssistantText.includes("기억할게요") ||
                  lastAssistantText.includes("PromptMemory 반영"),
                asksForAIConnection: lastAssistantText.includes("AI 연결하기") || lastAssistantText.includes("앱 안 AI 연결이 필요"),
                hasConnectionResumeCard:
                  lastAssistantText.includes("연결됐어요") ||
                  lastAssistantText.includes("방금 요청 다시 넣기") ||
                  lastAssistantText.includes("연결 후 방금 요청 이어가기") ||
                  lastAssistantText.includes("자동 실행하지 않고, 버튼을 눌러 입력창에 다시 올린 뒤"),
                hasGenerationError:
                  lastAssistantText.includes("답변 생성 중 문제가 생겼습니다") ||
                  lastAssistantText.includes("AI 연결 상태를 다시 확인"),
              };
              break;
            }
          }
          return {
            status: chatResult ? "chat_observed" : "chat_generation_not_observed",
            providerStatus,
            directGeneration,
            chatResult,
            lastChatProbe,
            bodyText: normalize(document.body?.innerText).slice(0, 1200),
          };
        })();
      `,
      true,
    );

    report.providerStatus = result.providerStatus ?? null;
    report.directGeneration = summarizeAIChatGenerationResult(result.directGeneration);
    report.chatResult = result.chatResult ?? null;
    report.lastChatProbe = result.lastChatProbe ?? null;
    report.bodyText = result.bodyText ?? "";
    const directReceipt = result.directGeneration?.aiRuntimeReceipt;
    const hasDirectRuntimeReceiptProof =
      directReceipt?.answerReady === true &&
      Boolean(directReceipt?.finalRoute) &&
      Array.isArray(directReceipt?.attemptedRoutes) &&
      directReceipt.attemptedRoutes.length > 0 &&
      directReceipt?.failClosed === false &&
      directReceipt?.recoveryRequired === false &&
      directReceipt?.rawSecretMaterialReturned === false;
    if (result.status === "ai_not_ready") {
      report.status = "ai_not_ready";
      report.errors.push("No answer-capable Codex/OpenAI/Gemini provider was available in the Electron preload bridge.");
    } else if (result.status === "chat_surface_not_ready") {
      report.status = "chat_surface_not_ready";
      report.errors.push("Electron app loaded, but the chat textarea or AI bridge was not ready.");
    } else if (result.status === "direct_generation_failed") {
      report.status = "direct_generation_failed";
      report.errors.push(`Direct bridge generation failed: ${result.directGeneration?.status ?? "unknown"}`);
    } else if (!hasDirectRuntimeReceiptProof) {
      report.status = "direct_generation_runtime_receipt_missing";
      report.errors.push("Direct bridge generation succeeded without an AI Runtime Router receipt proving finalRoute/attemptedRoutes/failClosed=false.");
    } else if (!result.chatResult) {
      report.status = "chat_generation_not_observed";
      report.errors.push("No new assistant message appeared after submitting the chat prompt.");
    } else if (result.chatResult.hasNamingMisroute) {
      report.status = "chat_misrouted_to_naming";
      report.errors.push("Chat prompt was still routed to naming/memory save UI.");
    } else if (result.chatResult.asksForAIConnection || result.chatResult.hasGenerationError) {
      report.status = "chat_generation_failed";
      report.errors.push("Chat UI did not complete a normal AI answer.");
    } else if (result.chatResult.hasConnectionResumeCard) {
      report.status = "chat_routed_to_connection_resume_card";
      report.errors.push("Chat UI showed a connection resume card instead of the actual AI answer.");
    } else {
      report.status = "desktop_ai_chat_smoke_ok";
    }

    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(report.status === "desktop_ai_chat_smoke_ok" ? 0 : 1);
  } catch (error) {
    report.status = "desktop_ai_chat_smoke_failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(1);
  }
}

async function runAIModelChatSmoke(win) {
  if (!isAIModelChatSmoke) return;
  const reportPath = path.join(repoRoot, "tmp", "desktop-ai-model-chat-smoke-report.json");
  const recoveryPrompt = "AI 모델은 연결됐는데 대화가 안돼 아무것도 못 움직여";
  const prompts = ["5.5로 바꿔줘", "5.4 미니 써줘", "지금 선택한 모델로 한 문장 답해줘", recoveryPrompt];
  const report = {
    status: "started",
    prompts,
    providerSmokeState: null,
    chatResult: null,
    diagnostics: [],
    target,
    outputPath: reportPath,
    errors: [],
  };

  try {
    await clearRendererStorageForSmoke(win);
    const result = await win.webContents.executeJavaScript(
      `
        (async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value) => String(value ?? "").replace(/\\s+/gu, " ").trim();
          const findButton = (label) => Array.from(document.querySelectorAll("button")).find((button) =>
            normalize(button.innerText) === label
          );
          const waitForText = async (text, attempts = 50) => {
            for (let index = 0; index < attempts; index += 1) {
              const bodyText = normalize(document.body?.innerText);
              if (bodyText.includes(text)) return bodyText;
              await wait(500);
            }
            return normalize(document.body?.innerText);
          };
          const submitChat = async (text) => {
            let textarea = null;
            let submit = null;
            for (let index = 0; index < 80; index += 1) {
              textarea = document.querySelector("textarea");
              submit = findButton("보내기");
              if (textarea && submit && window.modyCrewDesktopBridge?.getAIProviderStatus) break;
              await wait(500);
            }
            if (!textarea || !submit) {
              return {
                ok: false,
                reason: "chat_input_not_ready",
                bodyText: normalize(document.body?.innerText).slice(0, 1600),
                hasTextarea: Boolean(textarea),
                hasSubmit: Boolean(submit),
                submitText: normalize(submit?.innerText),
                submitDisabled: Boolean(submit?.disabled),
              };
            }
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            valueSetter?.call(textarea, text);
            textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
            for (let index = 0; index < 40; index += 1) {
              if (!submit.disabled) break;
              await wait(100);
            }
            if (submit.disabled) {
              return {
                ok: false,
                reason: "chat_submit_still_disabled",
                bodyText: normalize(document.body?.innerText).slice(0, 1600),
                hasTextarea: true,
                hasSubmit: true,
                submitText: normalize(submit.innerText),
                submitDisabled: true,
              };
            }
            if (submit.form?.requestSubmit) {
              submit.form.requestSubmit(submit);
            } else {
              submit.click();
            }
            return { ok: true };
          };

          const bridge = window.modyCrewDesktopBridge;
          if (!bridge?.getAIProviderStatus || !bridge?.saveAIProviderModel || !bridge?.generateAIText) {
            return {
              status: "ai_bridge_not_ready",
              bodyText: normalize(document.body?.innerText).slice(0, 1600),
              hasBridge: Boolean(bridge),
            };
          }
          let homeAIModelSurfaceNode = null;
          let statusPanelOpenedForAIModel = false;
          for (let index = 0; index < 80; index += 1) {
            homeAIModelSurfaceNode =
              document.querySelector('[aria-label="홈 연결 상태 한눈에"]') ??
              document.querySelector('[aria-label="홈 AI 답변 모델 한눈에"]');
            if (!homeAIModelSurfaceNode && !statusPanelOpenedForAIModel) {
              const statusPanelToggle = document.querySelector('[data-panel-toggle="right-edge-status"]');
              if (statusPanelToggle instanceof HTMLElement) {
                statusPanelToggle.click();
                statusPanelOpenedForAIModel = true;
                await wait(200);
                continue;
              }
            }
            const model = homeAIModelSurfaceNode?.getAttribute("data-ai-model") ?? "";
            const runtimeState = homeAIModelSurfaceNode?.getAttribute("data-ai-runtime-state") ?? "";
            const testAction = homeAIModelSurfaceNode?.getAttribute("data-ai-model-test-action") ?? "";
            const hasTestButton = Array.from(homeAIModelSurfaceNode?.querySelectorAll("button") ?? []).some((button) =>
              normalize(button.innerText) === "AI 답변 모델/테스트"
            );
            if (model && runtimeState && testAction === "connect_ai" && hasTestButton) break;
            await wait(100);
          }
          const homeAIModel = homeAIModelSurfaceNode?.getAttribute("data-ai-model") ?? "";
          const homeAIRuntimeState = homeAIModelSurfaceNode?.getAttribute("data-ai-runtime-state") ?? "";
          const homeAIModelTestAction = homeAIModelSurfaceNode?.getAttribute("data-ai-model-test-action") ?? "";
          const hasHomeAIModelTestButton = Array.from(homeAIModelSurfaceNode?.querySelectorAll("button") ?? []).some((button) =>
            normalize(button.innerText) === "AI 답변 모델/테스트"
          );
          const homeAIModelSurface = {
            hasHomeConnectionSnapshot: Boolean(homeAIModelSurfaceNode),
            statusPanelOpenedForAIModel,
            homeAIModel,
            homeAIRuntimeState,
            homeAIModelTestAction,
            hasHomeAIModelTestButton,
          };
          if (
            !homeAIModelSurface.hasHomeConnectionSnapshot ||
            !homeAIModel ||
            !homeAIRuntimeState ||
            homeAIModelTestAction !== "connect_ai" ||
            !hasHomeAIModelTestButton
          ) {
            return {
              status: "home_ai_model_status_missing",
              chatResult: homeAIModelSurface,
              bodyText: normalize(document.body?.innerText).slice(0, 1800),
            };
          }

          let submitted = await submitChat(${JSON.stringify("5.5로 바꿔줘")});
          if (!submitted.ok) return { status: submitted.reason, ...submitted };
          const firstBodyText = await waitForText("AI 답변 모델을 gpt-5.5로 바꿨습니다.");
          if (!firstBodyText.includes("AI 답변 모델을 gpt-5.5로 바꿨습니다.")) {
            return {
              status: "short_55_model_change_not_observed",
              bodyText: firstBodyText.slice(0, 1800),
            };
          }

          submitted = await submitChat(${JSON.stringify("5.4 미니 써줘")});
          if (!submitted.ok) return { status: submitted.reason, ...submitted };
          const secondBodyText = await waitForText("AI 답변 모델을 gpt-5.4-mini로 바꿨습니다.");
          if (!secondBodyText.includes("AI 답변 모델을 gpt-5.4-mini로 바꿨습니다.")) {
            return {
              status: "short_mini_model_change_not_observed",
              bodyText: secondBodyText.slice(0, 1800),
            };
          }

          submitted = await submitChat(${JSON.stringify("지금 선택한 모델로 한 문장 답해줘")});
          if (!submitted.ok) return { status: submitted.reason, ...submitted };
          const finalBodyText = await waitForText("좋아요. 지금 선택한 답변 엔진으로 자연스럽게 이어서 대화할 수 있어요.");
          const chatItems = Array.from(document.querySelectorAll("li[data-role]"));
          const lastAssistant = chatItems
            .filter((item) => item.getAttribute("data-role") === "assistant")
            .map((item) => normalize(item.textContent))
            .filter(Boolean)
            .at(-1);
          const finalObserved =
            finalBodyText.includes("좋아요. 지금 선택한 답변 엔진으로 자연스럽게 이어서 대화할 수 있어요.");
          if (!finalObserved) {
            return {
              status: "model_chat_generation_not_observed",
            chatResult: {
              homeAIModelSurface,
              hasFirstModelChange: finalBodyText.includes("AI 답변 모델을 gpt-5.5로 바꿨습니다."),
              hasSecondModelChange: finalBodyText.includes("AI 답변 모델을 gpt-5.4-mini로 바꿨습니다."),
                hasFinalAnswer: false,
                lastAssistantText: String(lastAssistant ?? "").slice(0, 1200),
              },
              bodyText: finalBodyText.slice(0, 1800),
            };
          }

          submitted = await submitChat(${JSON.stringify(recoveryPrompt)});
          if (!submitted.ok) return { status: submitted.reason, ...submitted };
          const recoveryBodyText = await waitForText("전역 설치나 시스템 변경은 하지 않았습니다.", 120);
          const recoveryAssistant = Array.from(document.querySelectorAll("li[data-role]"))
            .filter((item) => item.getAttribute("data-role") === "assistant")
            .map((item) => normalize(item.textContent))
            .filter(Boolean)
            .at(-1);
          const recoveryAssistantText = String(recoveryAssistant ?? "");
          const recoveryEvidenceText = [recoveryBodyText, recoveryAssistantText].join("\\n");
          const recoveryObserved =
            (recoveryEvidenceText.includes("AI 연결 복구 도구") || recoveryEvidenceText.includes("AI 연결 복구 점검")) &&
            recoveryEvidenceText.includes("대화 엔진 상태만 짧게 확인했습니다") &&
            recoveryEvidenceText.includes("전역 설치나 시스템 변경은 하지 않았습니다.");

          return {
            status: recoveryObserved ? "model_chat_and_recovery_observed" : "ai_recovery_chat_not_observed",
            chatResult: {
              homeAIModelSurface,
              hasFirstModelChange: recoveryBodyText.includes("AI 답변 모델을 gpt-5.5로 바꿨습니다."),
              hasSecondModelChange: recoveryBodyText.includes("AI 답변 모델을 gpt-5.4-mini로 바꿨습니다."),
              hasFinalAnswer:
                recoveryBodyText.includes("좋아요. 지금 선택한 답변 엔진으로 자연스럽게 이어서 대화할 수 있어요."),
              hasRecoveryCheck:
                recoveryEvidenceText.includes("AI 연결 복구 도구") ||
                recoveryEvidenceText.includes("AI 연결 복구 점검"),
              hasNoGlobalInstallNotice: recoveryEvidenceText.includes("전역 설치나 시스템 변경은 하지 않았습니다."),
              lastAssistantText: String(recoveryAssistantText || lastAssistant || "").slice(0, 1200),
            },
            bodyText: recoveryBodyText.slice(0, 1800),
          };
        })();
      `,
      true,
    );

    report.chatResult = result.chatResult ?? null;
    report.bodyTextPreview = String(result.bodyText ?? "").slice(0, 1800);
    report.diagnostics = firstScreenSmokeDiagnostics.slice(-20);
    report.providerSmokeState = {
      statusChecks: aiModelChatSmokeState.statusChecks,
      saveModelCalls: aiModelChatSmokeState.saveModelCalls,
      generateTextCalls: aiModelChatSmokeState.generateTextCalls,
      currentModel: aiModelChatSmokeState.currentModel,
      savedModels: aiModelChatSmokeState.savedModels,
      generatedModels: aiModelChatSmokeState.generatedModels,
      prompts: aiModelChatSmokeState.prompts.map((value) => value.replace(/\s+/gu, " ").trim().slice(0, 240)),
      runtimeReceipts: aiModelChatSmokeState.runtimeReceipts,
    };

    const generatedFinalPrompt = aiModelChatSmokeState.prompts.some((value) =>
      value.includes("지금 선택한 모델로 한 문장 답해줘"),
    );
    const generatedRecoveryPrompt = aiModelChatSmokeState.prompts.some((value) =>
      value.includes(recoveryPrompt),
    );
    const hasModelRuntimeReceiptProof = aiModelChatSmokeState.runtimeReceipts.some((receipt) =>
      receipt?.promptIncludesModelRequest === true &&
      receipt?.answerReady === true &&
      receipt?.finalRoute === "codex_oauth" &&
      Array.isArray(receipt?.attemptedRoutes) &&
      receipt.attemptedRoutes.join(">") === "codex_oauth" &&
      receipt?.failClosed === false &&
      receipt?.recoveryRequired === false &&
      receipt?.rawSecretMaterialReturned === false
    );
    const hasRecoveryRuntimeReceiptProof = aiModelChatSmokeState.runtimeReceipts.some((receipt) =>
      receipt?.promptIncludesRecoveryRequest === true &&
      receipt?.answerReady === true &&
      receipt?.finalRoute === "codex_oauth" &&
      Array.isArray(receipt?.attemptedRoutes) &&
      receipt.attemptedRoutes.join(">") === "codex_oauth" &&
      receipt?.failClosed === false &&
      receipt?.recoveryRequired === false &&
      receipt?.rawSecretMaterialReturned === false
    );
    if (result.status !== "model_chat_and_recovery_observed") {
      report.status = result.status ?? "desktop_ai_model_chat_smoke_failed";
      report.errors.push("짧은 모델 변경 대화 또는 연결됨 상태의 복구 점검 자연어가 실제 AI 답변 경로로 이어지지 않았습니다.");
    } else if (
      !result.chatResult?.homeAIModelSurface?.hasHomeConnectionSnapshot ||
      result.chatResult.homeAIModelSurface.homeAIModelTestAction !== "connect_ai" ||
      !result.chatResult.homeAIModelSurface.hasHomeAIModelTestButton ||
      !result.chatResult.homeAIModelSurface.homeAIRuntimeState
    ) {
      report.status = "home_ai_model_status_missing";
      report.errors.push("설치 앱 첫 화면 연결 상태가 현재 AI 답변 모델과 실제 답변 확인 동선을 보여주지 않았습니다.");
    } else if (aiModelChatSmokeState.saveModelCalls !== 2) {
      report.status = "model_save_call_count_mismatch";
      report.errors.push(`AI 모델 저장 호출 횟수가 ${aiModelChatSmokeState.saveModelCalls}회입니다.`);
    } else if (aiModelChatSmokeState.savedModels.join("|") !== "gpt-5.5|gpt-5.4-mini") {
      report.status = "model_save_sequence_mismatch";
      report.errors.push(`AI 모델 저장 순서가 ${aiModelChatSmokeState.savedModels.join(" -> ")}입니다.`);
    } else if (
      // 메시지당 생성 호출 2회(본 답변 + 역량 분류 Pass-A) × 일반/복구 2회 = 총 4회.
      aiModelChatSmokeState.generateTextCalls !== 4 ||
      aiModelChatSmokeState.generatedModels.join("|") !==
        "gpt-5.4-mini|gpt-5.4-mini|gpt-5.4-mini|gpt-5.4-mini" ||
      !generatedFinalPrompt ||
      !generatedRecoveryPrompt
    ) {
      report.status = "model_generation_payload_mismatch";
      report.errors.push("저장된 gpt-5.4-mini 모델이 일반 답변과 복구 점검 답변 호출로 전달되지 않았습니다.");
    } else if (!hasModelRuntimeReceiptProof || !hasRecoveryRuntimeReceiptProof) {
      report.status = "model_chat_runtime_receipt_missing";
      report.errors.push("모델 선택 대화와 복구 점검 대화가 AI Runtime Router 영수증(finalRoute/attemptedRoutes/failClosed=false)을 모두 남기지 않았습니다.");
    } else if (!result.chatResult?.hasRecoveryCheck || !result.chatResult?.hasNoGlobalInstallNotice) {
      report.status = "ai_recovery_chat_contract_missing";
      report.errors.push("연결됨 상태의 대화 실패 자연어가 사용자용 복구 점검 카드로 보이지 않았습니다.");
    } else {
      report.status = "desktop_ai_model_chat_smoke_ok";
    }

    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(report.status === "desktop_ai_model_chat_smoke_ok" ? 0 : 1);
  } catch (error) {
    report.status = "desktop_ai_model_chat_smoke_failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.providerSmokeState = {
      statusChecks: aiModelChatSmokeState.statusChecks,
      saveModelCalls: aiModelChatSmokeState.saveModelCalls,
      generateTextCalls: aiModelChatSmokeState.generateTextCalls,
      currentModel: aiModelChatSmokeState.currentModel,
      savedModels: aiModelChatSmokeState.savedModels,
      generatedModels: aiModelChatSmokeState.generatedModels,
      prompts: aiModelChatSmokeState.prompts.map((value) => value.replace(/\s+/gu, " ").trim().slice(0, 240)),
    };
    report.diagnostics = firstScreenSmokeDiagnostics.slice(-20);
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(1);
  }
}

async function runAIPendingChatSmoke(win) {
  if (!isAIPendingChatSmoke) return;
  const reportPath = path.join(repoRoot, "tmp", "desktop-ai-pending-chat-smoke-report.json");
  const prompt = aiPendingChatSmokeExpectedPrompt;
  const report = {
    status: "started",
    prompt,
    providerSmokeState: null,
    chatResult: null,
    target,
    outputPath: reportPath,
    errors: [],
  };

  try {
    await clearRendererStorageForSmoke(win);
    const result = await win.webContents.executeJavaScript(
      `
        (async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value) => String(value ?? "").replace(/\\s+/gu, " ").trim();
          const isVisibleElement = (element) => {
            const rect = element.getBoundingClientRect?.();
            const style = window.getComputedStyle?.(element);
            return Boolean(
              rect &&
              rect.width > 0 &&
              rect.height > 0 &&
              !element.closest("[hidden]") &&
              !element.closest("details:not([open])") &&
              style?.display !== "none" &&
              style?.visibility !== "hidden",
            );
          };
          const isVisibleButton = (button) => isVisibleElement(button);
          const visibleButtons = () => Array.from(document.querySelectorAll("button")).filter(isVisibleButton).reverse();
          const findButton = (label) => visibleButtons().find((button) =>
            normalize(button.innerText) === label
          );
          const findButtonIncludes = (label) => visibleButtons().find((button) =>
            normalize(button.innerText).includes(label)
          );
          const findComposer = () => document.querySelector('textarea, input[aria-label="채팅 메시지"]');
          const findComposerSubmitButton = () =>
            Array.from(document.querySelectorAll('button[aria-label="메시지 보내기"]'))
              .filter(isVisibleButton)
              .at(-1) ??
            findButton("보내기");
          const waitForText = async (text, attempts = 120) => {
            for (let index = 0; index < attempts; index += 1) {
              const bodyText = normalize(document.body?.innerText);
              if (bodyText.includes(text)) return bodyText;
              await wait(500);
            }
            return normalize(document.body?.innerText);
          };
          const waitForAnyText = async (texts, attempts = 120) => {
            for (let index = 0; index < attempts; index += 1) {
              const bodyText = normalize(document.body?.innerText);
              if (texts.some((text) => bodyText.includes(text))) return bodyText;
              await wait(500);
            }
            return normalize(document.body?.innerText);
          };
          for (let index = 0; index < 80; index += 1) {
            if (findComposer() && window.modyCrewDesktopBridge?.getAIProviderStatus) break;
            await wait(500);
          }
          const composer = findComposer();
          const submit = findComposerSubmitButton();
          const bridge = window.modyCrewDesktopBridge;
          if (!composer || !submit || !bridge?.getAIProviderStatus || !bridge?.generateAIText) {
            return {
              status: "chat_surface_not_ready",
              bodyText: normalize(document.body?.innerText).slice(0, 1200),
              hasComposer: Boolean(composer),
              hasSubmit: Boolean(submit),
              hasBridge: Boolean(bridge),
            };
          }

          const userCountBefore = document.querySelectorAll('li[data-role="user"]').length;
          const composerPrototype = composer instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const valueSetter = Object.getOwnPropertyDescriptor(composerPrototype, "value")?.set;
          const previousTrackedValue = composer._valueTracker?.getValue?.();
          valueSetter?.call(composer, ${JSON.stringify(prompt)});
          if (composer._valueTracker?.setValue) {
            composer._valueTracker.setValue(previousTrackedValue ?? "");
          }
          composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(prompt)} }));
          await wait(200);
          if (submit?.form?.requestSubmit) {
            submit.form.requestSubmit(submit);
          } else {
            submit?.click();
          }

          const blockedBodyText = await waitForAnyText([
            "실제 AI 대화가 먼저 연결되어야 처리할 수 있습니다",
            "이 일을 처리하려면 먼저 앱 안 AI 연결이 필요해요",
            "먼저 AI 연결이 필요해요",
            "필요한 준비가 먼저 있어요",
            "AI 연결 다시 확인",
            "AI 연결하러 가기",
          ]);
          const hasConnectionPrompt =
            blockedBodyText.includes("실제 AI 대화가 먼저 연결되어야 처리할 수 있습니다") ||
            blockedBodyText.includes("이 일을 처리하려면 먼저 앱 안 AI 연결이 필요해요") ||
            blockedBodyText.includes("먼저 AI 연결이 필요해요") ||
            blockedBodyText.includes("필요한 준비가 먼저 있어요") ||
            blockedBodyText.includes("AI 연결 다시 확인") ||
            blockedBodyText.includes("AI 연결하러 가기");
          if (!hasConnectionPrompt) {
            return {
              status: "connection_prompt_not_observed",
              bodyText: blockedBodyText.slice(0, 1600),
              userCountBefore,
              userCountAfter: document.querySelectorAll('li[data-role="user"]').length,
            };
          }
          const readPendingRecoveryContract = () => {
            const recoverySurface = Array.from(
              document.querySelectorAll('[data-ai-runtime-recovery-contract="reason_solution_resume"]'),
            )
              .filter(isVisibleElement)
              .at(-1);
            const recoveryConnectButtons = recoverySurface
              ? Array.from(
                recoverySurface.querySelectorAll('button[data-gpt-primary-action="connect_account"]'),
              ).filter(isVisibleButton)
              : [];
            const recoveryDetails = recoverySurface
              ? Array.from(
                recoverySurface.querySelectorAll('details[data-ai-runtime-recovery-detail="reason_solution_resume"]'),
              )
              : [];
            return {
              surfaceVisible: Boolean(recoverySurface),
              connectButton: recoveryConnectButtons[0] ?? null,
              connectButtonCount: recoveryConnectButtons.length,
              connectButtonLabel: normalize(recoveryConnectButtons[0]?.innerText),
              detailsClosed:
                recoveryDetails.length === 1 &&
                recoveryDetails.every((detail) => !detail.open),
            };
          };
          let recoveryContract = readPendingRecoveryContract();
          let connectButton = null;
          for (let index = 0; index < 80; index += 1) {
            recoveryContract = readPendingRecoveryContract();
            connectButton = recoveryContract.connectButton;
            if (
              recoveryContract.surfaceVisible &&
              recoveryContract.connectButtonCount === 1 &&
              recoveryContract.detailsClosed &&
              connectButton &&
              !connectButton.disabled
            ) break;
            await wait(250);
          }
          if (
            !recoveryContract.surfaceVisible ||
            recoveryContract.connectButtonCount !== 1 ||
            !recoveryContract.detailsClosed ||
            !connectButton ||
            connectButton.disabled
          ) {
            return {
              status: "pending_recovery_contract_not_observed",
              chatResult: {
                hasConnectionPrompt,
                recoverySurfaceVisible: recoveryContract.surfaceVisible,
                recoveryConnectButtonCount: recoveryContract.connectButtonCount,
                recoveryConnectButtonLabel: recoveryContract.connectButtonLabel,
                recoveryDetailsClosed: recoveryContract.detailsClosed,
              },
              bodyText: normalize(document.body?.innerText).slice(0, 1600),
            };
          }
          const primaryConnectButtonLabel = recoveryContract.connectButtonLabel;
          connectButton.click();

          let readyBodyText = await waitForAnyText(["GPT 실제 답변까지 확인됐어요", "실제 답변까지 확인됐어요"], 16);
          if (!readyBodyText.includes("실제 답변까지 확인됐어요")) {
            const loginButton = findButton("AI 로그인 열기") ?? findButtonIncludes("AI 로그인");
            if (loginButton && !loginButton.disabled) {
              loginButton.click();
              readyBodyText = await waitForAnyText(["GPT 실제 답변까지 확인됐어요", "실제 답변까지 확인됐어요"]);
            }
          }
          const sawReadyPrompt = readyBodyText.includes("실제 답변까지 확인됐어요");
          const meetingMemoMarker = "회의 메모를 세 줄로 정리했습니다";
          const isMeetingMemoAnswer = (text) =>
            text.includes(meetingMemoMarker) &&
            text.includes("결정 사항") &&
            text.includes("다음 행동");
          const readAssistantState = () => {
            const assistantMessages = Array.from(document.querySelectorAll("li[data-role]"))
              .filter((item) => item.getAttribute("data-role") === "assistant")
              .map((item) => normalize(item.textContent))
              .filter(Boolean);
            const finalAssistantAnswerCount = assistantMessages.filter(isMeetingMemoAnswer).length;
            const lastAssistantText = assistantMessages.at(-1) ?? "";
            return {
              finalAssistantAnswerCount,
              lastAssistantText,
              hasExpectedFinalAnswer:
                finalAssistantAnswerCount === 1 &&
                isMeetingMemoAnswer(lastAssistantText),
            };
          };
          let finalBodyText = "";
          let lastAssistant = "";
          let finalAssistantAnswerCount = 0;
          let manualResumeButtonVisible = false;
          let autoResumedWithoutManualRetry = false;
          for (let index = 0; index < 144; index += 1) {
            await wait(500);
            finalBodyText = normalize(document.body?.innerText);
            const assistantState = readAssistantState();
            lastAssistant = assistantState.lastAssistantText;
            finalAssistantAnswerCount = assistantState.finalAssistantAnswerCount;
            const manualResumeButton = findButton("이어 처리");
            if (manualResumeButton) {
              manualResumeButtonVisible = true;
              break;
            }
            if (assistantState.hasExpectedFinalAnswer) {
              autoResumedWithoutManualRetry = true;
              break;
            }
            if (finalAssistantAnswerCount > 1) break;
          }
          return {
            status: manualResumeButtonVisible
              ? "pending_chat_manual_resume_visible"
              : autoResumedWithoutManualRetry
                ? "pending_chat_observed"
                : "pending_chat_generation_not_observed",
            chatResult: {
              hasConnectionPrompt,
              hasPrimaryConnectAction: Boolean(primaryConnectButtonLabel),
              primaryConnectButtonLabel,
              recoverySurfaceVisible: recoveryContract.surfaceVisible,
              recoveryConnectButtonCount: recoveryContract.connectButtonCount,
              recoveryConnectButtonLabel: recoveryContract.connectButtonLabel,
              recoveryDetailsClosed: recoveryContract.detailsClosed,
              hasReadyPrompt: sawReadyPrompt,
              hasManualResumeButton: manualResumeButtonVisible,
              autoResumedWithoutManualRetry,
              finalAssistantAnswerCount,
              hasFinalAnswer:
                finalAssistantAnswerCount === 1 &&
                isMeetingMemoAnswer(lastAssistant),
              lastAssistantText: lastAssistant.slice(0, 1200),
            },
            bodyText: finalBodyText.slice(0, 1600),
          };
        })();
      `,
      true,
    );

    report.chatResult = result.chatResult ?? null;
    const finalAnswerPromptCallCount = aiPendingChatSmokeState.prompts.filter((value) => value.includes(prompt) && value.includes("[ModyCrew 답변 규칙]")).length;
    report.providerSmokeState = {
      statusChecks: aiPendingChatSmokeState.statusChecks,
      startOAuthCalls: aiPendingChatSmokeState.startOAuthCalls,
      generateTextCalls: aiPendingChatSmokeState.generateTextCalls,
      finalAnswerPromptCallCount,
      prompts: aiPendingChatSmokeState.prompts.map((value) => value.replace(/\s+/gu, " ").trim().slice(0, 240)),
      runtimeReceipts: aiPendingChatSmokeState.runtimeReceipts,
    };

    const hasRuntimeReceiptProof = aiPendingChatSmokeState.runtimeReceipts.some((receipt) =>
      receipt?.promptIncludesExpectedRequest === true &&
      receipt?.answerReady === true &&
      receipt?.finalRoute === "codex_oauth" &&
      Array.isArray(receipt?.attemptedRoutes) &&
      receipt.attemptedRoutes.join(">") === "codex_oauth" &&
      receipt?.failClosed === false &&
      receipt?.recoveryRequired === false &&
      receipt?.rawSecretMaterialReturned === false
    );
    if (result.status === "chat_surface_not_ready") {
      report.status = "chat_surface_not_ready";
      report.errors.push("Electron app loaded, but the chat textarea or AI bridge was not ready.");
    } else if (result.status === "pending_recovery_contract_not_observed") {
      report.status = "pending_recovery_contract_not_observed";
      report.errors.push("보관 요청 복구 화면에 GPT 계정 연결 주 행동 1개와 닫힌 연결 옵션이 함께 보이지 않았습니다.");
    } else if (result.status === "pending_chat_manual_resume_visible") {
      report.status = "pending_chat_manual_resume_visible";
      report.errors.push("자동 재개를 검증하는 동안 수동 이어 처리 버튼이 보였습니다.");
    } else if (result.status !== "pending_chat_observed") {
      report.status = result.status ?? "desktop_ai_pending_chat_smoke_failed";
      report.errors.push("보관된 AI 요청이 연결 후 실제 답변으로 이어지지 않았습니다.");
    } else if (
      result.chatResult?.recoverySurfaceVisible !== true ||
      result.chatResult?.recoveryConnectButtonCount !== 1 ||
      result.chatResult?.recoveryDetailsClosed !== true
    ) {
      report.status = "pending_chat_recovery_contract_invalid";
      report.errors.push("보관 요청 복구 surface의 GPT 계정 연결 주 행동 또는 닫힌 연결 옵션 계약이 맞지 않습니다.");
    } else if (result.chatResult?.hasPrimaryConnectAction !== true) {
      report.status = "pending_chat_primary_connect_missing";
      report.errors.push("첫 AI 미연결 안내에서 GPT 계정 연결로 이어지는 주 행동을 찾지 못했습니다.");
    } else if (result.chatResult?.hasReadyPrompt !== true) {
      report.status = "pending_chat_ready_prompt_missing";
      report.errors.push("실제 GPT 답변 확인 뒤 자동 재개 안내가 보이지 않았습니다.");
    } else if (
      result.chatResult?.finalAssistantAnswerCount !== 1 ||
      result.chatResult?.hasFinalAnswer !== true
    ) {
      report.status = "pending_chat_final_answer_count_mismatch";
      report.errors.push("회의 메모 최종 assistant 답변은 marker·결정 사항·다음 행동을 만족하는 메시지 1개여야 합니다.");
    } else if (result.chatResult?.autoResumedWithoutManualRetry !== true) {
      report.status = "pending_chat_auto_resume_missing";
      report.errors.push("AI 연결 후 보관된 요청이 수동 이어 처리 없이 자동으로 실제 답변까지 이어지지 않았습니다.");
    } else if (aiPendingChatSmokeState.statusChecks < 2) {
      report.status = "provider_status_not_rechecked";
      report.errors.push("AI 연결 전후 provider status 재확인이 부족합니다.");
    } else if (aiPendingChatSmokeState.startOAuthCalls !== 1) {
      report.status = "oauth_start_call_count_mismatch";
      report.errors.push(`AI 연결 시작 호출 횟수가 ${aiPendingChatSmokeState.startOAuthCalls}회입니다.`);
    } else if (
      aiPendingChatSmokeState.generateTextCalls < 1 ||
      aiPendingChatSmokeState.generateTextCalls > 3 ||
      finalAnswerPromptCallCount !== 1
    ) {
      report.status = "stored_prompt_generation_missing";
      report.errors.push("보관된 원래 요청이 최종 답변 규칙 generateAIText 호출로 정확히 한 번 전달되지 않았거나 재개 호출이 과도합니다.");
    } else if (!hasRuntimeReceiptProof) {
      report.status = "pending_chat_runtime_receipt_missing";
      report.errors.push("보관 요청의 실제 답변이 AI Runtime Router 영수증(finalRoute/attemptedRoutes/failClosed=false)을 남기지 않았습니다.");
    } else {
      report.status = "desktop_ai_pending_chat_smoke_ok";
    }

    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(report.status === "desktop_ai_pending_chat_smoke_ok" ? 0 : 1);
  } catch (error) {
    report.status = "desktop_ai_pending_chat_smoke_failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.providerSmokeState = {
      statusChecks: aiPendingChatSmokeState.statusChecks,
      startOAuthCalls: aiPendingChatSmokeState.startOAuthCalls,
      generateTextCalls: aiPendingChatSmokeState.generateTextCalls,
      prompts: aiPendingChatSmokeState.prompts.map((value) => value.replace(/\s+/gu, " ").trim().slice(0, 240)),
      runtimeReceipts: aiPendingChatSmokeState.runtimeReceipts,
    };
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(1);
  }
}

async function runFreshProfileFirstChatSmoke(win) {
  if (!isFreshProfileFirstChatSmoke) return;
  const reportPath = path.join(repoRoot, "tmp", "desktop-fresh-profile-first-chat-smoke-report.json");
  const prompt = aiPendingChatSmokeExpectedPrompt;
  const userDataPath = app.getPath("userData");
  const report = {
    status: "started",
    prompt,
    userDataPath,
    providerSmokeState: null,
    firstRunState: null,
    chatResult: null,
    target,
    outputPath: reportPath,
    errors: [],
  };

  try {
    await win.webContents.executeJavaScript(
      `
        (async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const initialComposerSelector = 'textarea, input[aria-label="채팅 메시지"]';
          for (let index = 0; index < 80; index += 1) {
            if (document.querySelector(initialComposerSelector) && window.modyCrewDesktopBridge?.saveChatThreads) break;
            await wait(500);
          }
          if (!sessionStorage.getItem("modycrew.freshProfileFirstChatReset.v1")) {
            sessionStorage.setItem("modycrew.freshProfileFirstChatReset.v1", "1");
            localStorage.removeItem("modycrew-chat-threads-v1");
            localStorage.removeItem("modycrew-account-ai-settings-v1");
            localStorage.removeItem("modycrew.selectedWorkActionEvents.v1");
            /* BEGIN smoke scoped chat save */
            const persistSmokeChatThreads = async (bridge, threads, expectedRoot, caseInsensitive) => {
              if (!bridge?.loadChatThreads || !bridge?.saveChatThreads) throw new Error("Desktop chat memory bridge was not ready for smoke isolation.");
              const loaded = await bridge.loadChatThreads();
              const normalize = value => {
                let normalized = String(value ?? "").replaceAll(String.fromCharCode(92), "/");
                if (caseInsensitive) normalized = normalized.toLowerCase();
                while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
                return normalized;
              };
              if (loaded?.status !== "local_memory_chat_threads_loaded" || loaded?.chatRootScopeVersion !== 1 || !loaded?.root || normalize(loaded.root) !== normalize(expectedRoot)) {
                throw new Error("Refusing to write chat threads outside the isolated smoke root.");
              }
              const saved = await bridge.saveChatThreads(threads, loaded.root);
              if (saved?.status !== "local_memory_chat_threads_saved") throw new Error(saved?.userMessage || "Could not save isolated smoke chat threads.");
            };
            /* END smoke scoped chat save */
            await persistSmokeChatThreads(window.modyCrewDesktopBridge, [], ${JSON.stringify(path.join(app.getPath("userData"), "ModyCrew_Local_Data"))}, ${JSON.stringify(process.platform === "win32")});
            globalThis.location.reload();
          }
        })();
      `,
      true,
    );
    await wait(1600);

    const result = await win.webContents.executeJavaScript(
      `
        (async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value) => String(value ?? "").replace(/\\s+/gu, " ").trim();
          const isVisibleElement = (element) => {
            const rect = element.getBoundingClientRect?.();
            const style = window.getComputedStyle?.(element);
            return Boolean(
              rect &&
              rect.width > 0 &&
              rect.height > 0 &&
              !element.closest("[hidden]") &&
              !element.closest("details:not([open])") &&
              style?.display !== "none" &&
              style?.visibility !== "hidden",
            );
          };
          const isVisibleButton = (button) => isVisibleElement(button);
          const visibleButtons = () => Array.from(document.querySelectorAll("button")).filter(isVisibleButton).reverse();
          const findButton = (label) => visibleButtons().find((button) =>
            normalize(button.innerText) === label
          );
          const findButtonIncludes = (label) => visibleButtons().find((button) =>
            normalize(button.innerText).includes(label)
          );
          const findComposer = () => document.querySelector('textarea, input[aria-label="채팅 메시지"]');
          const findComposerSubmitButton = () =>
            Array.from(document.querySelectorAll('button[aria-label="메시지 보내기"]'))
              .filter(isVisibleButton)
              .at(-1) ??
            findButton("보내기");
          const waitForText = async (text, attempts = 120) => {
            for (let index = 0; index < attempts; index += 1) {
              const bodyText = normalize(document.body?.innerText);
              if (bodyText.includes(text)) return bodyText;
              await wait(500);
            }
            return normalize(document.body?.innerText);
          };
          const waitForAnyText = async (texts, attempts = 120) => {
            for (let index = 0; index < attempts; index += 1) {
              const bodyText = normalize(document.body?.innerText);
              if (texts.some((text) => bodyText.includes(text))) return bodyText;
              await wait(500);
            }
            return normalize(document.body?.innerText);
          };
          for (let index = 0; index < 80; index += 1) {
            if (findComposer() && window.modyCrewDesktopBridge?.getAIProviderStatus) break;
            await wait(500);
          }
          for (let index = 0; index < 80; index += 1) {
            if (findComposer() && window.modyCrewDesktopBridge?.getAIProviderStatus) break;
            await wait(500);
          }
          const composer = findComposer();
          const submit = findComposerSubmitButton();
          const bridge = window.modyCrewDesktopBridge;
          const loadedThreads = bridge?.loadChatThreads
            ? await bridge.loadChatThreads().catch(() => null)
            : null;
          const firstBodyText = normalize(document.body?.innerText);
          const firstGPTAccountConnectButtons = Array.from(
            document.querySelectorAll('[data-gpt-account-before-work="true"] button[data-gpt-primary-action="connect_account"]'),
          ).filter(isVisibleButton);
          const firstGPTAccountConnectButton = firstGPTAccountConnectButtons[0] ?? null;
          const firstRunState = {
            hasComposer: Boolean(composer),
            hasTextarea: Boolean(composer),
            hasSubmit: Boolean(submit),
            hasBridge: Boolean(bridge),
            storedThreadsBefore: localStorage.getItem("modycrew-chat-threads-v1"),
            desktopThreadCountBefore: loadedThreads?.threadCount ?? null,
            desktopMessageCountBefore: loadedThreads?.messageCount ?? null,
            storedAISettingsBefore: localStorage.getItem("modycrew-account-ai-settings-v1"),
            hasWelcome: firstBodyText.includes("복잡한 설정부터 하지 않아도 됩니다"),
            hasChatPromptExample:
              firstBodyText.includes("오늘 문의 확인해줘") ||
              firstBodyText.includes("오늘 업무"),
            hasGPTAccountPrompt: firstBodyText.includes("GPT를 사용하고 계신가요?"),
            gptAccountConnectButtonCount: firstGPTAccountConnectButtons.length,
            gptAccountConnectButtonLabel: normalize(firstGPTAccountConnectButton?.innerText),
            hasGPTAccountConnectButton:
              firstGPTAccountConnectButtons.length === 1 &&
              normalize(firstGPTAccountConnectButton?.innerText) === "GPT 계정 연결",
            hiddenTechnicalTerms: !/MCP|tool registry|terminal backend|cron|skill file/u.test(firstBodyText),
            hiddenAdvancedWorkspaces: !/AI 팀원|메신저 업무/u.test(firstBodyText),
            hasPlainComposerChrome:
              Boolean(composer && submit) &&
              !firstBodyText.includes("작업 확인") &&
              !firstBodyText.includes("입력 대기") &&
              !firstBodyText.includes("+ 권한 기준") &&
              !firstBodyText.includes("권한 기준 승인 준비됨") &&
              !firstBodyText.includes("추가 업무 도구"),
            bodyPreview: firstBodyText.slice(0, 1400),
          };
          if (!composer || !submit || !bridge?.getAIProviderStatus || !bridge?.generateAIText) {
            return {
              status: "first_chat_surface_not_ready",
              firstRunState,
              bodyText: firstBodyText.slice(0, 1600),
            };
          }

          const setComposerValue = async (value) => {
            composer.focus();
            composer.select();
            const insertedByCommand = document.execCommand?.("insertText", false, value);
            if (insertedByCommand) {
              await wait(250);
              if (composer.value === value) return;
            }
            const composerPrototype = composer instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const valueSetter = Object.getOwnPropertyDescriptor(composerPrototype, "value")?.set;
            const previousTrackedValue = composer._valueTracker?.getValue?.();
            valueSetter?.call(composer, value);
            if (composer._valueTracker?.setValue) {
              composer._valueTracker.setValue(previousTrackedValue ?? "");
            }
            composer.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: value }));
            composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
            composer.dispatchEvent(new Event("change", { bubbles: true }));
            await wait(100);
            composer.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " " }));
            await wait(100);
          };
          const submitComposer = async () => {
            for (let index = 0; index < 20; index += 1) {
              const nextSubmit = findComposerSubmitButton() ?? submit;
              if (nextSubmit && !nextSubmit.disabled) {
                nextSubmit.click();
                return true;
              }
              await wait(100);
            }
            const form = composer.closest("form") ?? submit.form;
            if (form) {
              const submitEvent = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: submit });
              form.dispatchEvent(submitEvent);
              return true;
            }
            submit.click();
            return true;
          };

          await setComposerValue(${JSON.stringify(prompt)});
          const submitAfterInput = findComposerSubmitButton() ?? submit;
          firstRunState.afterInputValue = composer.value;
          firstRunState.afterInputMatchesPrompt = composer.value === ${JSON.stringify(prompt)};
          firstRunState.submitDisabledAfterInput = Boolean(submitAfterInput?.disabled);
          firstRunState.formPresentAfterInput = Boolean(composer.closest("form") ?? submit.form);
          await submitComposer();
          firstRunState.bodyAfterSubmit = normalize(document.body?.innerText).slice(0, 1200);

          const blockedBodyText = await waitForAnyText([
            "실제 AI 대화가 먼저 연결되어야 처리할 수 있습니다",
            "이 일을 처리하려면 먼저 앱 안 AI 연결이 필요해요",
            "먼저 AI 연결이 필요해요",
            "필요한 준비가 먼저 있어요",
            "AI 연결 다시 확인",
            "AI 연결하러 가기",
          ]);
          const hasFirstAIConnectionPrompt =
            blockedBodyText.includes("실제 AI 대화가 먼저 연결되어야 처리할 수 있습니다") ||
            blockedBodyText.includes("이 일을 처리하려면 먼저 앱 안 AI 연결이 필요해요") ||
            blockedBodyText.includes("먼저 AI 연결이 필요해요") ||
            blockedBodyText.includes("필요한 준비가 먼저 있어요") ||
            blockedBodyText.includes("AI 연결 다시 확인") ||
            blockedBodyText.includes("AI 연결하러 가기");
          if (!hasFirstAIConnectionPrompt) {
            return {
              status: "first_ai_connection_prompt_not_observed",
              firstRunState,
              bodyText: blockedBodyText.slice(0, 1800),
            };
          }
          let recoveryCheckButton = findButton("연결 복구 확인");
          let fallbackConnectionButton = findButton("대체 답변 연결");
          const hasRecoveryChoice =
            Boolean(recoveryCheckButton) ||
            blockedBodyText.includes("복구 증거") ||
            blockedBodyText.includes("이유 확인");
          const hasFallbackChoice =
            Boolean(fallbackConnectionButton) ||
            blockedBodyText.includes("다른 연결 방법") ||
            blockedBodyText.includes("대체 답변 연결");
          const findRecoveryActionButton = (label) => Array.from(
            document.querySelectorAll('[data-connector-recovery-contract="reason_solution_resume"]'),
          )
            .filter(isVisibleButton)
            .reverse()
            .find((button) => normalize(button.innerText).includes(label));
          const findPreferredAIConnectButton = () =>
            findButton("GPT 계정 연결") ??
            findButton("AI 연결하러 가기") ??
            findButtonIncludes("AI 연결하러 가기") ??
            findButtonIncludes("AI부터 연결하기") ??
            findButton("AI 로그인 열기") ??
            findRecoveryActionButton("AI 연결") ??
            findButton("AI 연결 다시 확인") ??
            findButton("AI 연결하기") ??
            findButtonIncludes("AI 로그인");
          let connectButton = null;
          for (let index = 0; index < 80; index += 1) {
            recoveryCheckButton = findButton("연결 복구 확인");
            fallbackConnectionButton = findButton("대체 답변 연결");
            connectButton = findPreferredAIConnectButton();
            if (connectButton && !connectButton.disabled) break;
            await wait(250);
          }
          if (!connectButton) {
            return {
              status: "first_ai_connect_button_not_found",
              firstRunState,
              bodyText: normalize(document.body?.innerText).slice(0, 1800),
            };
          }
          const primaryConnectButtonLabel = normalize(connectButton.innerText);
          connectButton.click();

          let readyBodyText = await waitForAnyText(["GPT 실제 답변까지 확인됐어요", "실제 답변까지 확인됐어요"], 16);
          if (!readyBodyText.includes("실제 답변까지 확인됐어요")) {
            const loginButton = findButton("AI 로그인 열기") ?? findButtonIncludes("AI 로그인");
            if (loginButton && !loginButton.disabled) {
              loginButton.click();
              readyBodyText = await waitForAnyText(["GPT 실제 답변까지 확인됐어요", "실제 답변까지 확인됐어요"]);
            }
          }
          const sawReadyPrompt = readyBodyText.includes("실제 답변까지 확인됐어요");
          const meetingMemoMarker = "회의 메모를 세 줄로 정리했습니다";
          const isMeetingMemoAnswer = (text) =>
            text.includes(meetingMemoMarker) &&
            text.includes("결정 사항") &&
            text.includes("다음 행동");
          const readAssistantState = () => {
            const assistantMessages = Array.from(document.querySelectorAll("li[data-role]"))
              .filter((item) => item.getAttribute("data-role") === "assistant")
              .map((item) => normalize(item.textContent))
              .filter(Boolean);
            const finalAssistantAnswerCount = assistantMessages.filter(isMeetingMemoAnswer).length;
            const lastAssistantText = assistantMessages.at(-1) ?? "";
            return {
              finalAssistantAnswerCount,
              lastAssistantText,
              hasExpectedFinalAnswer:
                finalAssistantAnswerCount === 1 &&
                isMeetingMemoAnswer(lastAssistantText),
            };
          };
          let finalBodyText = "";
          let lastAssistant = "";
          let finalAssistantAnswerCount = 0;
          let manualResumeButtonVisible = false;
          let autoResumedWithoutManualRetry = false;
          for (let index = 0; index < 144; index += 1) {
            await wait(500);
            finalBodyText = normalize(document.body?.innerText);
            const assistantState = readAssistantState();
            lastAssistant = assistantState.lastAssistantText;
            finalAssistantAnswerCount = assistantState.finalAssistantAnswerCount;
            const manualResumeButton = findButton("이어 처리");
            if (manualResumeButton) {
              manualResumeButtonVisible = true;
              break;
            }
            if (assistantState.hasExpectedFinalAnswer) {
              autoResumedWithoutManualRetry = true;
              break;
            }
            if (finalAssistantAnswerCount > 1) break;
          }
          return {
            status: manualResumeButtonVisible
              ? "fresh_profile_manual_resume_visible"
              : autoResumedWithoutManualRetry
                ? "fresh_profile_first_chat_observed"
                : "fresh_profile_first_chat_generation_not_observed",
            firstRunState,
            chatResult: {
              hasConnectionPrompt: hasFirstAIConnectionPrompt,
              hasPrimaryConnectAction: Boolean(primaryConnectButtonLabel),
              primaryConnectButtonLabel,
              hasReadyPrompt: sawReadyPrompt,
              hasManualResumeButton: manualResumeButtonVisible,
              autoResumedWithoutManualRetry,
              finalAssistantAnswerCount,
              hasFinalAnswer:
                finalAssistantAnswerCount === 1 &&
                isMeetingMemoAnswer(lastAssistant),
              lastAssistantText: lastAssistant.slice(0, 1200),
            },
            bodyText: finalBodyText.slice(0, 1800),
          };
        })();
      `,
      true,
    );

    report.firstRunState = result.firstRunState ?? null;
    report.chatResult = result.chatResult ?? null;
    report.bodyText = result.bodyText ?? null;
    const finalAnswerPromptCallCount = aiPendingChatSmokeState.prompts.filter((value) => value.includes(prompt) && value.includes("[ModyCrew 답변 규칙]")).length;
    report.providerSmokeState = {
      statusChecks: aiPendingChatSmokeState.statusChecks,
      startOAuthCalls: aiPendingChatSmokeState.startOAuthCalls,
      generateTextCalls: aiPendingChatSmokeState.generateTextCalls,
      finalAnswerPromptCallCount,
      prompts: aiPendingChatSmokeState.prompts.map((value) => value.replace(/\s+/gu, " ").trim().slice(0, 240)),
      runtimeReceipts: aiPendingChatSmokeState.runtimeReceipts,
    };

    const hasRuntimeReceiptProof = aiPendingChatSmokeState.runtimeReceipts.some((receipt) =>
      receipt?.promptIncludesExpectedRequest === true &&
      receipt?.answerReady === true &&
      receipt?.finalRoute === "codex_oauth" &&
      Array.isArray(receipt?.attemptedRoutes) &&
      receipt.attemptedRoutes.join(">") === "codex_oauth" &&
      receipt?.failClosed === false &&
      receipt?.recoveryRequired === false &&
      receipt?.rawSecretMaterialReturned === false
    );
    if (!userDataPath.includes("fresh-profile-first-chat")) {
      report.status = "fresh_profile_user_data_not_isolated";
      report.errors.push(`fresh profile smoke must use isolated userData path: ${userDataPath}`);
    } else if (result.firstRunState?.storedThreadsBefore) {
      report.status = "fresh_profile_had_existing_threads";
      report.errors.push("fresh profile started with stored chat threads.");
    } else if (result.firstRunState?.storedAISettingsBefore) {
      report.status = "fresh_profile_had_existing_ai_settings";
      report.errors.push("fresh profile started with stored AI settings.");
    } else if (!result.firstRunState?.hasTextarea || !result.firstRunState?.hasSubmit || !result.firstRunState?.hasBridge) {
      report.status = "fresh_profile_chat_surface_not_ready";
      report.errors.push("fresh profile did not expose chat input, send button, and desktop bridge together.");
    } else if (result.firstRunState?.hiddenTechnicalTerms !== true) {
      report.status = "fresh_profile_technical_terms_visible";
      report.errors.push("fresh profile first chat surface exposed internal technical terms.");
    } else if (result.firstRunState?.hiddenAdvancedWorkspaces !== true) {
      report.status = "fresh_profile_advanced_workspaces_visible";
      report.errors.push("fresh profile first chat surface exposed advanced worker or messenger workspace labels.");
    } else if (result.firstRunState?.hasPlainComposerChrome !== true) {
      report.status = "fresh_profile_composer_chrome_fragmented";
      report.errors.push("fresh profile first chat composer controls read like fragmented setup text.");
    } else if (
      result.firstRunState?.hasGPTAccountPrompt !== true ||
      result.firstRunState?.gptAccountConnectButtonCount !== 1 ||
      result.firstRunState?.gptAccountConnectButtonLabel !== "GPT 계정 연결" ||
      result.firstRunState?.hasGPTAccountConnectButton !== true
    ) {
      report.status = "fresh_profile_gpt_connect_first_action_missing";
      report.errors.push("fresh profile 첫 화면에서 GPT 계정 연결 질문과 주 버튼을 함께 확인하지 못했습니다.");
    } else if (result.status === "fresh_profile_manual_resume_visible") {
      report.status = "fresh_profile_manual_resume_visible";
      report.errors.push("fresh profile 자동 재개를 검증하는 동안 수동 이어 처리 버튼이 보였습니다.");
    } else if (result.status !== "fresh_profile_first_chat_observed") {
      report.status = result.status ?? "desktop_fresh_profile_first_chat_smoke_failed";
      report.errors.push("fresh profile first chat did not reach pending AI request final answer.");
    } else if (result.chatResult?.hasPrimaryConnectAction !== true) {
      report.status = "fresh_profile_primary_connect_missing";
      report.errors.push("fresh profile 보관 요청에서 GPT 계정 연결 주 행동을 찾지 못했습니다.");
    } else if (result.chatResult?.hasReadyPrompt !== true) {
      report.status = "fresh_profile_ready_prompt_missing";
      report.errors.push("fresh profile에서 실제 GPT 답변 확인 뒤 자동 재개 안내가 보이지 않았습니다.");
    } else if (
      result.chatResult?.finalAssistantAnswerCount !== 1 ||
      result.chatResult?.hasFinalAnswer !== true
    ) {
      report.status = "fresh_profile_final_answer_count_mismatch";
      report.errors.push("회의 메모 최종 assistant 답변은 marker·결정 사항·다음 행동을 만족하는 메시지 1개여야 합니다.");
    } else if (result.chatResult?.autoResumedWithoutManualRetry !== true) {
      report.status = "fresh_profile_auto_resume_missing";
      report.errors.push("빈 사용자 첫 채팅이 AI 연결 후 수동 이어 처리 없이 자동으로 실제 답변까지 이어지지 않았습니다.");
    } else if (
      aiPendingChatSmokeState.startOAuthCalls !== 1 ||
      aiPendingChatSmokeState.generateTextCalls < 1 ||
      aiPendingChatSmokeState.generateTextCalls > 3 ||
      finalAnswerPromptCallCount !== 1
    ) {
      report.status = "fresh_profile_ai_flow_mismatch";
      report.errors.push("fresh profile first chat did not call AI connection and the final-answer prompt exactly once, or resumed too many times.");
    } else if (!hasRuntimeReceiptProof) {
      report.status = "fresh_profile_runtime_receipt_missing";
      report.errors.push("빈 사용자 첫 채팅의 실제 답변이 AI Runtime Router 영수증(finalRoute/attemptedRoutes/failClosed=false)을 남기지 않았습니다.");
    } else {
      report.status = "desktop_fresh_profile_first_chat_smoke_ok";
    }

    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(report.status === "desktop_fresh_profile_first_chat_smoke_ok" ? 0 : 1);
  } catch (error) {
    report.status = "desktop_fresh_profile_first_chat_smoke_failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.providerSmokeState = {
      statusChecks: aiPendingChatSmokeState.statusChecks,
      startOAuthCalls: aiPendingChatSmokeState.startOAuthCalls,
      generateTextCalls: aiPendingChatSmokeState.generateTextCalls,
      prompts: aiPendingChatSmokeState.prompts.map((value) => value.replace(/\s+/gu, " ").trim().slice(0, 240)),
      runtimeReceipts: aiPendingChatSmokeState.runtimeReceipts,
    };
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(1);
  }
}

async function runMailOpsChatSmoke(win) {
  if (!isMailOpsChatSmoke) return;
  const reportPath = path.join(repoRoot, "tmp", "desktop-mailops-chat-smoke-report.json");
  const prompt = "메일 점검해줘. 회사 메일 문의를 읽고 답장 초안과 일정 후보를 정리해줘";
  const report = {
    status: "started",
    prompt,
    mailOpsSmokeState: null,
    chatResult: null,
    target,
    outputPath: reportPath,
    errors: [],
  };

  try {
    await clearRendererStorageForSmoke(win);
    const result = await win.webContents.executeJavaScript(
      `
        (async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value) => String(value ?? "").replace(/\\s+/gu, " ").trim();
          const findButton = (label) => Array.from(document.querySelectorAll("button")).find((button) =>
            normalize(button.innerText) === label
          );
          const findLastButton = (label) => Array.from(document.querySelectorAll("button")).reverse().find((button) =>
            normalize(button.innerText) === label
          );
          const waitForText = async (text, attempts = 120) => {
            for (let index = 0; index < attempts; index += 1) {
              const bodyText = normalize(document.body?.innerText);
              if (bodyText.includes(text)) return bodyText;
              await wait(500);
            }
            return normalize(document.body?.innerText);
          };
          const submitChat = async (text) => {
            let textarea = null;
            let submit = null;
            for (let index = 0; index < 80; index += 1) {
              textarea = document.querySelector("textarea");
              submit = findButton("보내기");
              if (textarea && submit && window.modyCrewDesktopBridge?.runMailWorkIntake) break;
              await wait(500);
            }
            if (!textarea || !submit) {
              return {
                ok: false,
                reason: "chat_input_not_ready",
                bodyText: normalize(document.body?.innerText).slice(0, 1600),
                hasTextarea: Boolean(textarea),
                hasSubmit: Boolean(submit),
              };
            }
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            valueSetter?.call(textarea, text);
            textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
            for (let index = 0; index < 40; index += 1) {
              if (!submit.disabled) break;
              await wait(100);
            }
            if (submit.disabled) {
              return {
                ok: false,
                reason: "chat_submit_still_disabled",
                bodyText: normalize(document.body?.innerText).slice(0, 1600),
              };
            }
            if (submit.form?.requestSubmit) {
              submit.form.requestSubmit(submit);
            } else {
              submit.click();
            }
            return { ok: true };
          };

          const bridge = window.modyCrewDesktopBridge;
          if (!bridge?.runMailWorkIntake) {
            return {
              status: "mailops_bridge_not_ready",
              bodyText: normalize(document.body?.innerText).slice(0, 1600),
              hasBridge: Boolean(bridge),
            };
          }

          for (let index = 0; index < 80; index += 1) {
            const bodyText = normalize(document.body?.innerText);
            if (bodyText.includes("읽기 후보 생성 가능") || bodyText.includes("메일 공식 연결 준비됨")) break;
            await wait(250);
          }

          const submitted = await submitChat(${JSON.stringify(prompt)});
          if (!submitted.ok) return { status: submitted.reason, ...submitted };

          let candidateOrResultBodyText = "";
          for (let index = 0; index < 160; index += 1) {
            candidateOrResultBodyText = normalize(document.body?.innerText);
            if (
              candidateOrResultBodyText.includes("메일 점검 후보로 정리했습니다.") ||
              candidateOrResultBodyText.includes("메일 2건을 확인했고, 지금 볼 업무는 2건입니다.")
            ) {
              break;
            }
            await wait(500);
          }

          if (candidateOrResultBodyText.includes("메일 점검 후보로 정리했습니다.")) {
            let runButton = null;
            for (let index = 0; index < 80; index += 1) {
              runButton = findLastButton("메일 점검 실행");
              if (runButton && !runButton.disabled) break;
              await wait(250);
            }
            if (!runButton || runButton.disabled) {
              return {
                status: "mailops_run_button_not_ready",
                bodyText: normalize(document.body?.innerText).slice(0, 1800),
                hasRunButton: Boolean(runButton),
                runButtonDisabled: Boolean(runButton?.disabled),
              };
            }
            runButton.click();
          } else if (!candidateOrResultBodyText.includes("메일 2건을 확인했고, 지금 볼 업무는 2건입니다.")) {
            return {
              status: "mailops_candidate_or_result_not_observed",
              bodyText: candidateOrResultBodyText.slice(0, 1800),
            };
          }

          const resultBodyText = candidateOrResultBodyText.includes("메일 2건을 확인했고, 지금 볼 업무는 2건입니다.")
            ? candidateOrResultBodyText
            : await waitForText("메일 2건을 확인했고, 지금 볼 업무는 2건입니다.", 160);
          const approvalBodyText = resultBodyText.includes("메일 승인 후보 미리보기")
            ? resultBodyText
            : await waitForText("메일 승인 후보 미리보기", 80);
          const finalBodyText = approvalBodyText.includes("실제 업무 이벤트: mailops-")
            ? approvalBodyText
            : await waitForText("실제 업무 이벤트: mailops-", 80);
          const hasResult =
            finalBodyText.includes("메일 2건을 확인했고, 지금 볼 업무는 2건입니다.") &&
            finalBodyText.includes("읽은 메일 2건") &&
            finalBodyText.includes("승인 대기 2건") &&
            finalBodyText.includes("메일 승인 후보 미리보기") &&
            finalBodyText.includes("거래처 답장 초안") &&
            finalBodyText.includes("일정 후보 확인") &&
            finalBodyText.includes("발송/등록 전 잠금");
          const hasPipelineEvidence =
            finalBodyText.includes("메일/문의 확인") &&
            finalBodyText.includes("답장 초안") &&
            finalBodyText.includes("일정 후보") &&
            finalBodyText.includes("승인함") &&
            finalBodyText.includes("실행 로그");
          const hasCountEvidence =
            (finalBodyText.includes("메일 2건") || finalBodyText.includes("읽은 메일 2건")) &&
            (finalBodyText.includes("승인 2건") || finalBodyText.includes("승인 대기 2건")) &&
            (finalBodyText.includes("일정 1건") || finalBodyText.includes("일정 후보 1건"));
          const hasVirtualOfficeEventEvidence =
            (
              finalBodyText.includes("selectedWorkActionEvents:mailops-") &&
              finalBodyText.includes("실제 업무 이벤트: mailops-")
            ) ||
            (
              finalBodyText.includes("승인함 보기") &&
              finalBodyText.includes("승인 대기 2건") &&
              finalBodyText.includes("최종 확인 전 잠금")
            );
          const hasExecutionLogEvidence =
            finalBodyText.includes("실행 로그 확인") &&
            (
              finalBodyText.includes("실행 로그와 결정 기록으로 확인") ||
              finalBodyText.includes("확인한 결정과 되돌리기 안내를 기록")
            );
          return {
            status:
              hasResult &&
              hasPipelineEvidence &&
              hasCountEvidence &&
              hasVirtualOfficeEventEvidence &&
              hasExecutionLogEvidence
                ? "mailops_chat_observed"
                : "mailops_chat_result_not_observed",
            chatResult: {
              hasCandidate: finalBodyText.includes("메일 점검 후보로 정리했습니다."),
              hasRunResult: finalBodyText.includes("메일 2건을 확인했고, 지금 볼 업무는 2건입니다."),
              hasReadOnlyBoundary:
                finalBodyText.includes("메일은 읽기 전용으로 확인하고 답장/일정 후보만 승인 대기로 올렸습니다.") &&
                finalBodyText.includes("사용자 선택 전 외부 실행 없음"),
              hasApprovalPreview:
                finalBodyText.includes("메일 승인 후보 미리보기") &&
                finalBodyText.includes("거래처 답장 초안") &&
                finalBodyText.includes("일정 후보 확인"),
              hasPipelineEvidence,
              hasCountEvidence,
              hasVirtualOfficeEventEvidence,
              hasExecutionLogEvidence,
              bodyPreview: finalBodyText.slice(0, 1800),
            },
            bodyText: finalBodyText.slice(0, 1800),
          };
        })();
      `,
      true,
    );

    report.chatResult = result.chatResult ?? null;
    report.mailOpsSmokeState = {
      runMailWorkIntakeCalls: mailOpsChatSmokeState.runMailWorkIntakeCalls,
      payloads: mailOpsChatSmokeState.payloads,
    };

    if (result.status !== "mailops_chat_observed") {
      report.status = result.status ?? "desktop_mailops_chat_smoke_failed";
      report.errors.push("메일 점검 채팅이 설치 앱 브리지의 읽기 전용 승인 후보 결과로 이어지지 않았습니다.");
    } else if (mailOpsChatSmokeState.runMailWorkIntakeCalls !== 1) {
      report.status = "mailops_intake_call_count_mismatch";
      report.errors.push(`runMailWorkIntake 호출 횟수가 ${mailOpsChatSmokeState.runMailWorkIntakeCalls}회입니다.`);
    } else if (
      !mailOpsChatSmokeState.payloads.some((payload) =>
        payload?.kind === "run" &&
        payload?.limit === 10 &&
        /^mailops-(manual|chat)-/u.test(String(payload?.activityEventId ?? ""))
      )
    ) {
      report.status = "mailops_intake_payload_missing_event_id";
      report.errors.push("runMailWorkIntake 호출이 실행 로그와 가상오피스 이벤트를 연결할 activityEventId를 남기지 않았습니다.");
    } else {
      report.status = "desktop_mailops_chat_smoke_ok";
    }

    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(report.status === "desktop_mailops_chat_smoke_ok" ? 0 : 1);
  } catch (error) {
    report.status = "desktop_mailops_chat_smoke_failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.mailOpsSmokeState = {
      runMailWorkIntakeCalls: mailOpsChatSmokeState.runMailWorkIntakeCalls,
      payloads: mailOpsChatSmokeState.payloads,
    };
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(report, null, 2));
    isExplicitQuit = true;
    app.exit(1);
  }
}

function summarizeAIChatGenerationResult(result) {
  if (!result) return null;
  const receipt = result.aiRuntimeReceipt;
  const router = result.aiRuntimeRouter;
  return {
    status: result.status,
    provider: result.provider,
    runtime: result.runtime,
    model: result.model,
    outputPreview: String(result.outputText ?? "").replace(/\s+/gu, " ").trim().slice(0, 240),
    diagnosticStage: result.diagnosticStage,
    fallbackFrom: result.fallbackFrom,
    answerReady: result.answerReady ?? receipt?.answerReady,
    fallbackUsed: result.fallbackUsed ?? receipt?.fallbackUsed,
    aiRuntimeRouter: router
      ? {
          attemptedRoutes: router.attemptedRoutes,
          finalRoute: router.finalRoute,
          failClosed: router.failClosed,
          recoveryRequired: router.recoveryRequired,
          recoveryReason: router.recoveryReason,
        }
      : null,
    aiRuntimeReceipt: receipt
      ? {
          answerReady: receipt.answerReady,
          fallbackUsed: receipt.fallbackUsed,
          finalRoute: receipt.finalRoute,
          attemptedRoutes: receipt.attemptedRoutes,
          failClosed: receipt.failClosed,
          recoveryRequired: receipt.recoveryRequired,
          recoveryReason: receipt.recoveryReason,
          canRetryPendingRequest: receipt.canRetryPendingRequest,
          externalMutation: receipt.externalMutation,
          rawSecretMaterialReturned: receipt.rawSecretMaterialReturned,
        }
      : null,
    externalMutation: result.externalMutation,
    rawSecretMaterialStored: result.rawSecretMaterialStored,
    rawSecretMaterialReturned: result.rawSecretMaterialReturned,
  };
}

async function clearRendererStorageForSmoke(win) {
  const reset = await win.webContents.executeJavaScript(
    `
      (async () => {
        const waitForBridge = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let bridge = window.modyCrewDesktopBridge;
        for (let index = 0; index < 80; index += 1) {
          if (bridge?.getLocalMemoryStatus && bridge?.saveChatThreads && bridge?.loadChatThreads) break;
          await waitForBridge(100);
          bridge = window.modyCrewDesktopBridge;
        }
        if (!bridge?.getLocalMemoryStatus || !bridge?.saveChatThreads || !bridge?.loadChatThreads) {
          throw new Error("Desktop chat memory bridge was not ready for smoke isolation.");
        }
        const localMemoryStatus = await bridge.getLocalMemoryStatus();
        const localMemoryRoot = String(localMemoryStatus?.root ?? "")
          .replaceAll(String.fromCharCode(92), "/")
          .toLowerCase();
        if (!localMemoryRoot.includes("/dist/smoke/user-data/")) {
          throw new Error("Refusing to clear a non-smoke desktop chat memory root.");
        }
            /* BEGIN smoke scoped chat save */
            const persistSmokeChatThreads = async (bridge, threads, expectedRoot, caseInsensitive) => {
              if (!bridge?.loadChatThreads || !bridge?.saveChatThreads) throw new Error("Desktop chat memory bridge was not ready for smoke isolation.");
              const loaded = await bridge.loadChatThreads();
              const normalize = value => {
                let normalized = String(value ?? "").replaceAll(String.fromCharCode(92), "/");
                if (caseInsensitive) normalized = normalized.toLowerCase();
                while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
                return normalized;
              };
              if (loaded?.status !== "local_memory_chat_threads_loaded" || loaded?.chatRootScopeVersion !== 1 || !loaded?.root || normalize(loaded.root) !== normalize(expectedRoot)) {
                throw new Error("Refusing to write chat threads outside the isolated smoke root.");
              }
              const saved = await bridge.saveChatThreads(threads, loaded.root);
              if (saved?.status !== "local_memory_chat_threads_saved") throw new Error(saved?.userMessage || "Could not save isolated smoke chat threads.");
            };
            /* END smoke scoped chat save */
        await persistSmokeChatThreads(bridge, [], ${JSON.stringify(path.join(app.getPath("userData"), "ModyCrew_Local_Data"))}, ${JSON.stringify(process.platform === "win32")});
        const loadedThreads = await bridge.loadChatThreads();
        const threads = Array.isArray(loadedThreads?.threads) ? loadedThreads.threads : [];
        const threadCount = threads.length;
        const messageCount = threads.reduce(
          (count, thread) => count + (Array.isArray(thread?.messages) ? thread.messages.length : 0),
          0,
        );
        if (threadCount !== 0 || messageCount !== 0) {
          throw new Error(
            "Desktop chat memory reset was incomplete: " +
              threadCount +
              " thread(s), " +
              messageCount +
              " message(s) remain.",
          );
        }
        localStorage.clear();
        sessionStorage.clear();
        return { threadCount, messageCount, localMemoryRoot };
      })();
    `,
    true,
  );
  if (reset?.threadCount !== 0 || reset?.messageCount !== 0) {
    throw new Error("Desktop chat memory reset did not finish empty.");
  }
  await new Promise((resolve) => {
    win.webContents.once("did-finish-load", resolve);
    win.webContents.reloadIgnoringCache();
  });
  await wait(500);
}

async function runOfficeWindowOpenSmoke(win) {
  if (!isOfficeWindowOpenSmoke) return;
  const result = await win.webContents.executeJavaScript(
    "window.modyCrewDesktopBridge.openWorkspaceWindow('office')",
    true,
  );
  await wait(500);
  const focusedResult = await win.webContents.executeJavaScript(
    "window.modyCrewDesktopBridge.openWorkspaceWindow('office')",
    true,
  );
  await wait(200);
  const officeUrl = officeWindowRef?.webContents?.getURL?.() ?? "";
  const officeContentResult = await waitForOfficeWindowContent([
    "반복 업무 오피스 승인 후보",
    "2개 후보가 승인함에 연결됨",
    "업무팩 문의 응대 자동 점검",
    "일정 등록 확인: 업무팩 문의 응대 자동 점검",
    "실행 · 취소 · 수정 요청 · WorkLog",
    "최종 실행 잠금",
  ]);
  if (
    !officeWindowRef ||
    officeWindowRef.isDestroyed?.() ||
    !officeUrl.includes("/office") ||
    focusedResult?.status !== "workspace_window_focused" ||
    officeContentResult.status !== "office_window_content_ready"
  ) {
    console.error(
      JSON.stringify(
        {
          status: "office_window_open_smoke_failed",
          result,
          focusedResult,
          officeUrl,
          officeContentResult,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          status: "office_window_open_smoke_ok",
          result,
          focusedResult,
          officeUrl,
          officeContentResult,
        },
        null,
        2,
      ),
    );
  }
  isExplicitQuit = true;
  if (failed) {
    app.exit(1);
  } else {
    app.quit();
  }
}

async function runWorkerCompanionWindowSmoke(win) {
  if (!isWorkerCompanionWindowScreenshotSmoke) return;
  const smokeOptions = { sizePreset: "large", positionPreset: "top_right", motionStyle: "lively", avatarMode: "custom" };
  const result = await win.webContents.executeJavaScript(
    `window.modyCrewDesktopBridge.openWorkerCompanionWindow(${JSON.stringify(smokeOptions)})`,
    true,
  );
  await wait(900);
  const focusedResult = await win.webContents.executeJavaScript(
    `window.modyCrewDesktopBridge.openWorkerCompanionWindow(${JSON.stringify(smokeOptions)})`,
    true,
  );
  await wait(500);
  const companionWin = workerCompanionWindowRef;
  const companionUrl = companionWin?.webContents?.getURL?.() ?? "";
  const companionState = companionWin && !companionWin.isDestroyed?.()
    ? await companionWin.webContents.executeJavaScript(
        `
          (() => {
            const text = document.body ? document.body.innerText : '';
            const panel = document.querySelector('[aria-label="현재 작업 패널"][data-worker-companion="true"]');
            const chatInput = document.querySelector('[aria-label="채팅 메시지 입력"]');
            const miniStage = document.querySelector('[data-worker-companion-mini]');
            const nowStrip = document.querySelector('[data-worker-companion-now-strip]');
            const decisionSignal = document.querySelector('[data-worker-companion-decision-signal]');
            const quickDecision = document.querySelector('[data-worker-companion-quick-decision]');
            const deskLane = document.querySelector('[data-worker-companion-desk-lane]');
            const desktopMiniMap = document.querySelector('[data-worker-companion-desktop-mini-map]');
            const presenceRail = document.querySelector('[data-worker-companion-presence-rail]');
            const workMonitor = document.querySelector('[data-worker-companion-work-monitor]');
            const liveSnapshot = document.querySelector('[data-worker-companion-live-snapshot]');
            const supportFold = document.querySelector('[data-worker-companion-support-fold]');
            const supportFoldDefaultOpen = supportFold?.hasAttribute('open') ?? false;
            if (supportFold && !supportFold.open) supportFold.open = true;
            const workflowRail = document.querySelector('[data-worker-companion-workflow-rail]');
            const decisionRail = document.querySelector('[data-worker-companion-decision-rail]');
            const modeRail = document.querySelector('[data-worker-companion-mode-rail]');
            const setupRail = document.querySelector('[data-worker-companion-setup]');
            const compactOffice = document.querySelector('[data-worker-companion-compact="true"]');
            const compactNow = compactOffice?.querySelector('[data-worker-companion-compact-now]');
            const compactScene = compactOffice?.querySelector('[data-testid="virtual-office-scene"]');
            const compactDisplayOptions = compactOffice?.querySelector('[data-worker-companion-size-control]');
            const compactSizeOptions = compactOffice?.querySelector('[data-worker-companion-size-options]');
            const compactBackButton = Array.from(compactOffice?.querySelectorAll('button') ?? [])
              .find((button) => String(button.textContent || '').includes('대화로 돌아가기'));
            const activeMotionWorkers = Array.from(document.querySelectorAll('[data-active-motion="true"]'));
            const idleActiveMotionWorkers = activeMotionWorkers.filter((item) => {
              const state = item.getAttribute('data-state');
              return !state || state === 'idle';
            });
            return {
              url: document.URL,
              title: document.title,
              hasCompanionPanel: Boolean(panel),
              hasChatInput: Boolean(chatInput),
              miniStage: miniStage
                ? {
                    contract: miniStage.getAttribute('data-worker-companion-mini'),
                    visibleWork: miniStage.getAttribute('data-worker-companion-visible-work'),
                    hiddenWork: miniStage.getAttribute('data-worker-companion-hidden-work'),
                    firstScreen: miniStage.getAttribute('data-worker-companion-first-screen'),
                    currentWindow: miniStage.getAttribute('data-worker-companion-current-window'),
                    userLanguage: miniStage.getAttribute('data-worker-companion-user-language'),
                    displayOrder: miniStage.getAttribute('data-worker-companion-display-order'),
                    externalMutation: miniStage.getAttribute('data-worker-companion-mini-external-mutation'),
                    visibleRectCount: miniStage.getClientRects().length,
                  }
                : null,
              nowStrip: nowStrip
                ? {
                    contract: nowStrip.getAttribute('data-worker-companion-now-strip'),
                    finalBoundary: nowStrip.getAttribute('data-worker-companion-now-final-boundary'),
                    kind: nowStrip.getAttribute('data-worker-companion-now-kind'),
                    action: nowStrip.getAttribute('data-worker-companion-now-action'),
                  }
                : null,
              decisionSignal: decisionSignal
                ? {
                    contract: decisionSignal.getAttribute('data-worker-companion-decision-signal'),
                    state: decisionSignal.getAttribute('data-worker-companion-decision-signal-state'),
                    source: decisionSignal.getAttribute('data-worker-companion-decision-signal-source'),
                    visible: decisionSignal.getAttribute('data-worker-companion-decision-signal-visible'),
                    hidden: decisionSignal.getAttribute('data-worker-companion-decision-signal-hidden'),
                    action: decisionSignal.getAttribute('data-worker-companion-decision-signal-action'),
                    finalBoundary: decisionSignal.getAttribute('data-worker-companion-decision-signal-final-boundary'),
                    visibleRectCount: decisionSignal.getClientRects().length,
                  }
                : null,
              quickDecision: quickDecision
                ? {
                    contract: quickDecision.getAttribute('data-worker-companion-quick-decision'),
                    source: quickDecision.getAttribute('data-worker-companion-quick-decision-source'),
                    visible: quickDecision.getAttribute('data-worker-companion-quick-decision-visible'),
                    hidden: quickDecision.getAttribute('data-worker-companion-quick-decision-hidden'),
                    target: quickDecision.getAttribute('data-worker-companion-quick-decision-target'),
                    finalBoundary: quickDecision.getAttribute('data-worker-companion-quick-decision-final-boundary'),
                    externalMutation: quickDecision.getAttribute('data-worker-companion-quick-decision-external-mutation'),
                    actions: Array.from(quickDecision.querySelectorAll('[data-worker-companion-quick-decision-action]')).map((item) => item.getAttribute('data-worker-companion-quick-decision-action')),
                    routes: Array.from(quickDecision.querySelectorAll('[data-worker-companion-quick-decision-route]')).map((item) => item.getAttribute('data-worker-companion-quick-decision-route')),
                    visibleRectCount: quickDecision.getClientRects().length,
                  }
                : null,
              deskLane: deskLane
                ? {
                    contract: deskLane.getAttribute('data-worker-companion-desk-lane'),
                    source: deskLane.getAttribute('data-worker-companion-desk-lane-source'),
                    visible: deskLane.getAttribute('data-worker-companion-desk-lane-visible'),
                    hidden: deskLane.getAttribute('data-worker-companion-desk-lane-hidden'),
                    finalBoundary: deskLane.getAttribute('data-worker-companion-desk-lane-final-boundary'),
                    externalMutation: deskLane.getAttribute('data-worker-companion-desk-lane-external-mutation'),
                    mode: deskLane.getAttribute('data-worker-companion-desk-lane-mode'),
                    motion: deskLane.getAttribute('data-worker-companion-desk-lane-motion'),
                    workKinds: Array.from(deskLane.querySelectorAll('[data-work-kind]')).map((item) => item.getAttribute('data-work-kind')),
                    workerStyles: Array.from(deskLane.querySelectorAll('[data-worker-companion-desk-worker-style]')).map((item) => item.getAttribute('data-worker-companion-desk-worker-style')),
                    boundaries: Array.from(deskLane.querySelectorAll('[data-worker-companion-desk-worker-boundary]')).map((item) => item.getAttribute('data-worker-companion-desk-worker-boundary')),
                    actions: Array.from(deskLane.querySelectorAll('[data-worker-companion-desk-worker-action]')).map((item) => item.getAttribute('data-worker-companion-desk-worker-action')),
                  }
                : null,
              desktopMiniMap: desktopMiniMap
                ? {
                    contract: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map'),
                    source: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map-source'),
                    visible: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map-visible'),
                    hidden: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map-hidden'),
                    mode: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map-mode'),
                    ready: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map-ready'),
                    customState: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map-custom-state'),
                    finalBoundary: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map-final-boundary'),
                    externalMutation: desktopMiniMap.getAttribute('data-worker-companion-desktop-mini-map-external-mutation'),
                    visibleRectCount: desktopMiniMap.getClientRects().length,
                    workKinds: Array.from(desktopMiniMap.querySelectorAll('[data-work-kind]')).map((item) => item.getAttribute('data-work-kind')),
                    workerStyles: Array.from(desktopMiniMap.querySelectorAll('[data-worker-companion-desktop-mini-worker-style]')).map((item) => item.getAttribute('data-worker-companion-desktop-mini-worker-style')),
                    boundaries: Array.from(desktopMiniMap.querySelectorAll('[data-worker-companion-desktop-mini-worker-boundary]')).map((item) => item.getAttribute('data-worker-companion-desktop-mini-worker-boundary')),
                    activeWorkers: Array.from(desktopMiniMap.querySelectorAll('[data-worker-companion-desktop-mini-worker-active="true"]')).length,
                  }
                : null,
              presenceRail: presenceRail
                ? {
                    contract: presenceRail.getAttribute('data-worker-companion-presence-rail'),
                    visible: presenceRail.getAttribute('data-worker-companion-presence-visible'),
                    hidden: presenceRail.getAttribute('data-worker-companion-presence-hidden'),
                    firstScreen: presenceRail.getAttribute('data-worker-companion-presence-first-screen'),
                    mode: presenceRail.getAttribute('data-worker-companion-presence-mode'),
                    desktopReady: presenceRail.getAttribute('data-worker-companion-presence-desktop-ready'),
                    finalBoundary: presenceRail.getAttribute('data-worker-companion-presence-final-boundary'),
                    visibleRectCount: presenceRail.getClientRects().length,
                    articleKinds: Array.from(presenceRail.querySelectorAll('[data-kind]')).map((item) => item.getAttribute('data-kind')),
                    articleStates: Array.from(presenceRail.querySelectorAll('[data-state]')).map((item) => item.getAttribute('data-state')),
                  }
                : null,
              workMonitor: workMonitor
                ? {
                    contract: workMonitor.getAttribute('data-worker-companion-work-monitor'),
                    beforeSettings: workMonitor.getAttribute('data-worker-companion-monitor-before-settings'),
                    visible: workMonitor.getAttribute('data-worker-companion-monitor-visible-work'),
                    finalBoundary: workMonitor.getAttribute('data-worker-companion-monitor-final-boundary'),
                    workKinds: Array.from(workMonitor.querySelectorAll('[data-work-kind]')).map((item) => item.getAttribute('data-work-kind')),
                    stages: Array.from(workMonitor.querySelectorAll('[data-worker-companion-monitor-stage]')).map((item) => item.getAttribute('data-worker-companion-monitor-stage')),
                    nextActions: Array.from(workMonitor.querySelectorAll('[data-worker-companion-monitor-next-action]')).map((item) => item.getAttribute('data-worker-companion-monitor-next-action')),
                  }
                : null,
              liveSnapshot: liveSnapshot
                ? {
                    contract: liveSnapshot.getAttribute('data-worker-companion-live-snapshot'),
                    source: liveSnapshot.getAttribute('data-worker-companion-live-source'),
                    visible: liveSnapshot.getAttribute('data-worker-companion-live-visible-work'),
                    hidden: liveSnapshot.getAttribute('data-worker-companion-live-hidden-work'),
                    firstScreen: liveSnapshot.getAttribute('data-worker-companion-live-first-screen'),
                    finalBoundary: liveSnapshot.getAttribute('data-worker-companion-live-final-boundary'),
                    externalMutation: liveSnapshot.getAttribute('data-worker-companion-live-external-mutation'),
                    visibleRectCount: liveSnapshot.getClientRects().length,
                    workKinds: Array.from(liveSnapshot.querySelectorAll('[data-work-kind]')).map((item) => item.getAttribute('data-work-kind')),
                    activeCards: Array.from(liveSnapshot.querySelectorAll('[data-worker-companion-live-active="true"]')).length,
                    stages: Array.from(liveSnapshot.querySelectorAll('[data-worker-companion-live-stage]')).map((item) => item.getAttribute('data-worker-companion-live-stage')),
                    nextActions: Array.from(liveSnapshot.querySelectorAll('[data-worker-companion-live-next-action]')).map((item) => item.getAttribute('data-worker-companion-live-next-action')),
                    safetyLabels: Array.from(liveSnapshot.querySelectorAll('[data-worker-companion-live-safety]')).map((item) => item.getAttribute('data-worker-companion-live-safety')),
                  }
                : null,
              supportFold: supportFold
                ? {
                    contract: supportFold.getAttribute('data-worker-companion-support-fold'),
                    defaultState: supportFold.getAttribute('data-worker-companion-support-default'),
                    visibleFirst: supportFold.getAttribute('data-worker-companion-support-visible-first'),
                    hidden: supportFold.getAttribute('data-worker-companion-support-hidden'),
                    finalBoundary: supportFold.getAttribute('data-worker-companion-support-final-boundary'),
                    wasOpenByDefault: supportFoldDefaultOpen,
                    isOpenForInspection: supportFold.open,
                  }
                : null,
              workflowRail: workflowRail
                ? {
                    contract: workflowRail.getAttribute('data-worker-companion-workflow-rail'),
                    display: workflowRail.getAttribute('data-worker-companion-workflow-display'),
                    finalBoundary: workflowRail.getAttribute('data-worker-companion-workflow-final-boundary'),
                    workKinds: Array.from(workflowRail.querySelectorAll('[data-work-kind]')).map((item) => item.getAttribute('data-work-kind')),
                  }
                : null,
              decisionRail: decisionRail
                ? {
                    contract: decisionRail.getAttribute('data-worker-companion-decision-rail'),
                    source: decisionRail.getAttribute('data-worker-companion-decision-source'),
                    actions: decisionRail.getAttribute('data-worker-companion-decision-actions'),
                    finalBoundary: decisionRail.getAttribute('data-worker-companion-decision-final-boundary'),
                  }
                : null,
              modeRail: modeRail
                ? {
                    contract: modeRail.getAttribute('data-worker-companion-mode-rail'),
                    displayMode: modeRail.getAttribute('data-worker-companion-window-display-mode'),
                    motionStyle: modeRail.getAttribute('data-worker-companion-motion-style'),
                  }
                : null,
              setupRail: setupRail
                ? {
                    contract: setupRail.getAttribute('data-worker-companion-setup'),
                    options: setupRail.getAttribute('data-worker-companion-setup-desktop-options'),
                    avatar: setupRail.getAttribute('data-worker-companion-setup-avatar'),
                  }
                : null,
              compactOffice: compactOffice
                ? {
                    contract: compactOffice.getAttribute('data-worker-companion-compact'),
                    visibleRectCount: compactOffice.getClientRects().length,
                    nowContract: compactNow?.getAttribute('data-worker-companion-compact-now') ?? '',
                    sceneSize: compactScene?.getAttribute('data-scene-size') ?? '',
                    workerIds: Array.from(compactScene?.querySelectorAll('[data-office-scene-worker]') ?? [])
                      .map((item) => item.getAttribute('data-office-scene-worker')),
                    workerRoles: Array.from(compactScene?.querySelectorAll('[data-office-scene-worker-role]') ?? [])
                      .map((item) => item.getAttribute('data-office-scene-worker-role')),
                    totalWorkers: Number(compactScene?.getAttribute('data-office-scene-total-workers') ?? 0),
                    pageSize: Number(compactScene?.getAttribute('data-office-scene-page-size') ?? 0),
                    pageCount: Number(compactScene?.getAttribute('data-office-scene-page-count') ?? 0),
                    avatarCount: compactScene?.querySelectorAll('span[data-crew-asset="editorial-2_5d-v2"]').length ?? 0,
                    workingPoseAssetCount: Array.from(compactScene?.querySelectorAll('img[data-crew-layer="working"]') ?? [])
                      .filter((image) => image.complete && image.naturalWidth > 0).length,
                    activeWorkingAvatarCount:
                      compactScene?.querySelectorAll('[data-activity="working"], [data-activity="moving"]').length ?? 0,
                    sizeControl: compactDisplayOptions?.getAttribute('data-worker-companion-size-control') ?? '',
                    sizeOptions: compactSizeOptions?.getAttribute('data-worker-companion-size-options') ?? '',
                    currentSize: compactSizeOptions?.getAttribute('data-current-size') ?? '',
                    sizeOptionCount: compactSizeOptions?.querySelectorAll('[data-size-preset]').length ?? 0,
                    displayOptionsOpen: compactDisplayOptions?.hasAttribute('open') ?? false,
                    backButtonHeight: compactBackButton?.getBoundingClientRect().height ?? 0,
                  }
                : null,
              activeMotionCount: activeMotionWorkers.length,
              idleActiveMotionCount: idleActiveMotionWorkers.length,
              text: text.slice(0, 1600),
            };
          })();
        `,
        true,
      )
    : null;
  const image = companionWin && !companionWin.isDestroyed?.()
    ? await companionWin.webContents.capturePage()
    : null;
  const size = image?.getSize?.() ?? { width: 0, height: 0 };
  const companionClickFlow = companionWin && !companionWin.isDestroyed?.()
    ? await companionWin.webContents.executeJavaScript(
        `
          (async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const snapshot = () => {
              const text = document.body ? document.body.innerText : '';
              const fullText = text || document.documentElement?.textContent || '';
              const panel = document.querySelector('[aria-label="현재 작업 패널"]');
              const companionPanel = document.querySelector('[aria-label="현재 작업 패널"][data-worker-companion="true"]');
              const mailSession = document.querySelector('[data-mailops-session-first-screen]');
              const documentFlow = document.querySelector('[data-document-automation-flow]');
              const approvalDeck = document.querySelector('[data-office-approval-decision-deck]');
              const quickDecision = document.querySelector('[data-worker-companion-quick-decision]');
              return {
                url: document.URL,
                hasWorkspacePanel: Boolean(panel),
                hasCompanionPanel: Boolean(companionPanel),
                hasMailSession: Boolean(mailSession),
                mailSessionFirstScreen: mailSession?.getAttribute('data-mailops-session-first-screen') ?? '',
                hasDocumentFlow: Boolean(documentFlow),
                documentFlow: documentFlow?.getAttribute('data-document-automation-flow') ?? '',
                hasApprovalDecisionDeck: Boolean(approvalDeck),
                approvalDecisionDeck: approvalDeck?.getAttribute('data-office-approval-decision-deck') ?? '',
                hasQuickDecision: Boolean(quickDecision),
                text: fullText.slice(0, 1800),
              };
            };
            const waitForSnapshot = async (predicate, attempts = 24) => {
              let current = snapshot();
              for (let index = 0; index < attempts; index += 1) {
                if (predicate(current)) return current;
                await wait(250);
                current = snapshot();
              }
              return current;
            };
            const click = async (selector, predicate) => {
              const target = await waitForSnapshot(() => Boolean(document.querySelector(selector)), 16);
              const button = document.querySelector(selector);
              if (!button) return { clicked: false, state: target };
              button.click();
              const state = predicate
                ? await waitForSnapshot(predicate, 40)
                : await waitForSnapshot(() => true, 1);
              return { clicked: true, state };
            };
            const clickApproval = async (selector) => {
              const target = await waitForSnapshot(() => Boolean(document.querySelector(selector)), 16);
              const button = document.querySelector(selector);
              if (!button) return { clicked: false, state: target };
              setTimeout(() => button.click(), 0);
              return { clicked: true, state: snapshot() };
            };
            const before = snapshot();
            const mailResult = await click(
              '[data-worker-companion-compact="true"] [data-office-scene-worker="mail"]',
              (state) =>
                state.hasCompanionPanel === true &&
                state.hasMailSession === false &&
                state.text.includes('메일 직원') &&
                state.text.includes('메일 업무'),
            );
            const documentResult = await click(
              '[data-worker-companion-compact="true"] [data-office-scene-worker="doc"]',
              (state) =>
                state.hasCompanionPanel === true &&
                state.hasDocumentFlow === false &&
                state.text.includes('문서 자료'),
            );
            await wait(1200);
            const approvalResult = await clickApproval('[data-worker-companion-compact="true"] [data-office-scene-worker="approval"]');
            return {
              before,
              mailClicked: mailResult.clicked,
              afterMail: mailResult.state,
              documentClicked: documentResult.clicked,
              afterDocument: documentResult.state,
              approvalClicked: approvalResult.clicked,
              afterApproval: approvalResult.state,
            };
          })();
        `,
        true,
      )
    : null;
  if (companionClickFlow?.approvalClicked === true) {
    await wait(1800);
  }
  const companionApprovalState = companionWin && !companionWin.isDestroyed?.()
    ? await companionWin.webContents.executeJavaScript(
        `
          (() => {
            const text = document.body?.innerText || document.documentElement?.textContent || '';
            const companionPanel = document.querySelector('[aria-label="현재 작업 패널"][data-worker-companion="true"]');
            const approvalDeck = document.querySelector('[data-office-approval-decision-deck]');
            return {
              url: document.URL,
              hasCompanionPanel: Boolean(companionPanel),
              hasApprovalDecisionDeck: Boolean(approvalDeck),
              approvalDecisionDeck: approvalDeck?.getAttribute('data-office-approval-decision-deck') ?? '',
              text: text.slice(0, 1800),
            };
          })();
        `,
        true,
      )
    : null;
  const windowBounds = companionWin && !companionWin.isDestroyed?.()
    ? companionWin.getBounds?.()
    : null;
  const isAlwaysOnTop = companionWin && !companionWin.isDestroyed?.()
    ? companionWin.isAlwaysOnTop?.()
    : false;
  const isResizable = companionWin && !companionWin.isDestroyed?.()
    ? companionWin.isResizable?.()
    : false;
  const isMaximizable = companionWin && !companionWin.isDestroyed?.()
    ? companionWin.isMaximizable?.()
    : true;
  const outputPath = path.resolve(repoRoot, "dist/smoke/modycrew-worker-companion-window.png");
  const requiredText = [
    "직원 일하는 모습",
    "지금 하는 일",
    "다음에 누를 것",
    "안전 잠금",
    "AI 오피스",
    "직원 " + (companionState?.compactOffice?.totalWorkers ?? 0) + "명",
    "업무 바로가기",
    "표시 옵션",
    "넓게",
  ];
  const missingText = requiredText.filter((phrase) => !String(companionState?.text ?? "").includes(phrase));
  const forbiddenText = [
    "직원 작업 현황",
    "직원 관리",
    "역할 설정",
    "쉬운 역할 설정",
  ];
  const leakedText = forbiddenText.filter((phrase) => String(companionState?.text ?? "").includes(phrase));
  const failed =
    !companionWin ||
    companionWin.isDestroyed?.() ||
    result?.status !== "worker_companion_window_opened" ||
    focusedResult?.status !== "worker_companion_window_focused" ||
    result?.displayMode !== workerCompanionWindowDefaults.displayMode ||
    focusedResult?.displayMode !== workerCompanionWindowDefaults.displayMode ||
    result?.sizePreset !== smokeOptions.sizePreset ||
    focusedResult?.sizePreset !== smokeOptions.sizePreset ||
    result?.positionPreset !== smokeOptions.positionPreset ||
    focusedResult?.positionPreset !== smokeOptions.positionPreset ||
    result?.motionStyle !== smokeOptions.motionStyle ||
    focusedResult?.motionStyle !== smokeOptions.motionStyle ||
    result?.alwaysOnTop !== true ||
    focusedResult?.alwaysOnTop !== true ||
    result?.skipTaskbar !== true ||
    focusedResult?.skipTaskbar !== true ||
    !companionUrl.includes("workerCompanion=1") ||
    !companionUrl.includes("companionSize=large") ||
    !companionUrl.includes("companionPosition=top_right") ||
    companionState?.hasCompanionPanel !== true ||
    companionState?.hasChatInput !== false ||
    companionState?.miniStage?.contract !== "desktop_style_worker_status_first" ||
    !(companionState?.miniStage?.visibleRectCount > 0) ||
    companionState?.compactOffice?.contract !== "true" ||
    !(companionState?.compactOffice?.visibleRectCount > 0) ||
    companionState?.compactOffice?.nowContract !== "current_next_safety" ||
    companionState?.compactOffice?.sceneSize !== "large" ||
    !(companionState?.compactOffice?.totalWorkers > 0) ||
    !(companionState?.compactOffice?.pageSize > 0) ||
    companionState?.compactOffice?.pageCount !== Math.ceil(companionState.compactOffice.totalWorkers / companionState.compactOffice.pageSize) ||
    companionState?.compactOffice?.avatarCount !== Math.min(companionState.compactOffice.totalWorkers, companionState.compactOffice.pageSize) ||
    companionState?.compactOffice?.workingPoseAssetCount !== companionState?.compactOffice?.avatarCount ||
    companionState?.compactOffice?.workerIds?.length !== companionState?.compactOffice?.avatarCount ||
    !companionState?.compactOffice?.workerIds?.every((workerId) => String(workerId).startsWith("office-scene-")) ||
    companionState?.compactOffice?.workerRoles?.length !== companionState?.compactOffice?.avatarCount ||
    !companionState?.compactOffice?.workerRoles?.every((role) => ["mail", "doc", "file", "approval"].includes(role)) ||
    companionState?.compactOffice?.sizeControl !== "compact_standard_large" ||
    companionState?.compactOffice?.sizeOptions !== "compact_standard_large" ||
    companionState?.compactOffice?.currentSize !== "large" ||
    companionState?.compactOffice?.sizeOptionCount !== 3 ||
    companionState?.compactOffice?.displayOptionsOpen !== false ||
    !(companionState?.compactOffice?.backButtonHeight >= 44) ||
    companionClickFlow?.approvalClicked !== true ||
    companionApprovalState?.hasCompanionPanel !== false ||
    companionApprovalState?.hasApprovalDecisionDeck !== true ||
    !String(companionApprovalState?.text ?? "").includes("업무 오피스") ||

    isAlwaysOnTop !== true ||
    isResizable !== true ||
    isMaximizable !== false ||
    !windowBounds ||
    windowBounds.width < 800 ||
    windowBounds.height < 700 ||
    missingText.length > 0 ||
    leakedText.length > 0 ||
    !image ||
    image.isEmpty?.() ||
    size.width < 800 ||
    size.height < 700;

  if (image && !image.isEmpty?.()) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, image.toPNG());
  }

  if (failed) {
    console.error(
      JSON.stringify(
        {
          status: "worker_companion_window_smoke_failed",
          result,
          focusedResult,
          companionUrl,
          companionState,
          companionClickFlow,
          companionApprovalState,
          expectedDisplayMode: workerCompanionWindowDefaults.displayMode,
          smokeOptions,
          isAlwaysOnTop,
          isResizable,
          isMaximizable,
          windowBounds,
          missingText,
          leakedText,
          outputPath,
          width: size.width,
          height: size.height,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          status: "worker_companion_window_smoke_ok",
          result,
          focusedResult,
          companionUrl,
          isAlwaysOnTop,
          isResizable,
          isMaximizable,
          windowBounds,
          outputPath,
          width: size.width,
          height: size.height,
        },
        null,
        2,
      ),
    );
  }
  isExplicitQuit = true;
  app.quit();
}

async function waitForOfficeWindowContent(requiredTexts) {
  if (!officeWindowRef || officeWindowRef.isDestroyed?.()) {
    return {
      status: "office_window_missing",
      missingTexts: requiredTexts,
      bodyPreview: "",
    };
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bodyText = await officeWindowRef.webContents.executeJavaScript(
      "document.body?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 6000) ?? ''",
      true,
    );
    const missingTexts = requiredTexts.filter((text) => !bodyText.includes(text));
    if (missingTexts.length === 0) {
      return {
        status: "office_window_content_ready",
        requiredTextCount: requiredTexts.length,
        bodyPreview: bodyText.slice(0, 800),
      };
    }
    await wait(250);
  }

  const bodyText = await officeWindowRef.webContents.executeJavaScript(
    "document.body?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 6000) ?? ''",
    true,
  );
  return {
    status: "office_window_content_missing",
    missingTexts: requiredTexts.filter((text) => !bodyText.includes(text)),
    bodyPreview: bodyText.slice(0, 1200),
  };
}

function seedScheduleBriefingScreenshotSmokeInbox() {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 2 * 60 * 60_000).toISOString();
  const endsAt = new Date(now.getTime() + 2.5 * 60 * 60_000).toISOString();
  const nextCheckAt = new Date(now.getTime() + 60 * 60_000).toISOString();
  appendAutomationInboxItems(
    [
      {
        id: "desktop-schedule-source-1",
        title: "거래처 킥오프 일정 확인",
        source: "email",
        sourceLabel: "메일함 점검",
        senderLabel: "연결된 메일함",
        body: "메일에서 거래처 킥오프 일정 후보를 감지했습니다.",
        summary: "회의실 A에서 진행하는 킥오프 미팅입니다.",
        status: "needs_review",
        riskLabel: "low",
        receivedAt: now.toISOString(),
        sourceEvidence: {
          providerId: "desktop_screenshot_smoke",
          messageSubject: "거래처 킥오프 일정 확인",
          replyToLabel: "거래처 담당자 [redacted-email]",
          calendarCandidateText: "오늘 오후 거래처 킥오프를 진행합니다.",
          calendarTimeRangeLabel: "오늘 2시간 뒤",
          calendarStartsAt: startsAt,
          calendarEndsAt: endsAt,
          calendarAttendeeLabels: ["보낸 사람 확인", "원문 이메일 1개 직접 확인"],
          calendarLocationLabel: "회의실 A",
          calendarReminderLabel: "몇 시간 전 알림 확인",
          calendarConflictLabel: "충돌 없음",
          rawSecretMaterialStored: false,
          rawSecretMaterialReturned: false,
        },
        schedules: [
          {
            id: "desktop-schedule-source-1:schedule",
            label: "거래처 킥오프",
            startsAt,
            endsAt,
            conflictNote: "충돌 없음",
          },
        ],
      },
      {
        id: "desktop-schedule-briefing-smoke",
        title: "미팅 알림: 거래처 킥오프",
        source: "calendar",
        sourceLabel: "일정 브리핑",
        senderLabel: "미팅 전 알림 확인",
        body:
          "ModyCrew 미팅 알림\n\n- 거래처 킥오프 미팅까지 2시간 남았습니다. 다음 확인 1시간 뒤 · 3시간 전 준비 알림 · 오늘 2시간 뒤 · 장소 회의실 A · 참석자 보낸 사람 확인, 원문 이메일 1개 직접 확인 · 충돌 없음\n\n안전 경계: 이 카드는 읽기 전용 알림이며 외부 발송/등록을 하지 않습니다.",
        summary: "1건의 24시간 이내 미팅을 알려드립니다.",
        status: "needs_review",
        riskLabel: "medium",
        receivedAt: now.toISOString(),
        scheduleBriefing: {
          kind: "meeting",
          triggerRuleId: "meeting-reminder-watch",
          sourceWorkItemIds: ["desktop-schedule-source-1"],
          anchorCount: 1,
          nextCheckAt,
          nextCheckHintMinutes: 60,
          attentionLevel: "attention",
          reminderLabel: "3시간 전 준비 알림",
          reason: "거래처 킥오프 미팅까지 2시간 남았습니다.",
          rawSecretMaterialStored: false,
          rawSecretMaterialReturned: false,
        },
      },
    ],
    { createdAt: now.toISOString() },
  );
}

function seedMailCalendarScreenshotSmokeInbox() {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 3 * 60 * 60_000).toISOString();
  const endsAt = new Date(now.getTime() + 4 * 60 * 60_000).toISOString();
  const sourceEvidence = {
    connectorId: "company-mail",
    providerId: "mail_calendar_screenshot_smoke",
    mailboxLabel: "INBOX",
    messageSubject: "미팅 일정 확인 및 답장 요청",
    senderPreview: "거래처 담당자 [redacted-email]",
    replyToLabel: "거래처 담당자 [redacted-email]",
    mailThreadLabel: "메일 2개 스레드",
    draftPreview: "ModyCrew가 일정 확인 답장 초안을 준비했습니다. 수신자와 본문은 최종 확인에서 직접 검토합니다.",
    receivedAt: now.toISOString(),
    messageSnippet: "다음 미팅 가능 시간을 확인하고 회신 부탁드립니다. 장소는 회의실 B로 부탁드립니다.",
    detectedIntentLabels: ["답장 필요", "일정 요청", "승인 필요"],
    approvalCandidateLabels: ["메일 발송", "일정 등록"],
    calendarCandidateText: "오늘 3시간 뒤 거래처 미팅 후보",
    calendarTimeRangeLabel: "오늘 3시간 뒤",
    calendarStartsAt: startsAt,
    calendarEndsAt: endsAt,
    calendarAttendeeLabels: ["보낸 사람 확인", "원문 이메일 1개 직접 확인"],
    calendarLocationLabel: "회의실 B",
    calendarReminderLabel: "3시간 전 알림 추천",
    calendarConflictLabel: "바쁜 시간 3개 확인",
    calendarBusyWindowCount: 3,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  appendAutomationInboxItems(
    [
      {
        id: "desktop-mail-calendar-calendar-smoke",
        title: "일정 등록 확인: 미팅 일정 확인 및 답장 요청",
        source: "email",
        sourceLabel: "메일·캘린더 수집",
        senderLabel: "거래처 담당자",
        body:
          "메일에서 일정 요청과 답장 필요 신호를 감지했습니다. 캘린더 바쁜 시간 3개를 읽고, 일정 등록 후보를 승인 대기로 분리했습니다.",
        summary: "메일에서 감지한 미팅 후보를 캘린더 등록 최종 확인 전 단계로 올렸습니다.",
        status: "approval_pending",
        riskLabel: "medium",
        receivedAt: now.toISOString(),
        sourceEvidence,
        riskSignals: [
          {
            id: "calendar-registration",
            label: "일정 등록",
            riskLabel: "medium",
            reason: "캘린더에 쓰기 전 사용자가 시간, 참석자, 장소, 알림값을 최종 확인해야 합니다.",
          },
        ],
        schedules: [
          {
            id: "desktop-mail-calendar-calendar-smoke:schedule",
            label: "거래처 미팅",
            startsAt,
            endsAt,
            conflictNote: "바쁜 시간 3개 확인",
          },
        ],
        finalAction: {
          kind: "create_calendar_event",
          label: "일정 등록 검토",
          readiness: "adapter_not_connected",
          blockedReason: "캘린더 쓰기 권한과 최종 확인 문구가 있어야 실제 등록할 수 있습니다.",
          checklist: ["메일 원문 근거 확인", "시간/참석자/장소 확인", "최종 확인 후 캘린더 등록"],
        },
      },
      {
        id: "desktop-mail-calendar-reply-smoke",
        title: "메일 답장 검토: 미팅 일정 확인 및 답장 요청",
        source: "email",
        sourceLabel: "메일·캘린더 수집",
        senderLabel: "거래처 담당자",
        body: "메일에서 답장 필요 신호를 감지했고, 발송 전 승인해야 하는 답장 초안을 준비했습니다.",
        summary: "일정 후보와 함께 답장 초안을 승인 대기 상태로 올렸습니다.",
        status: "approval_pending",
        riskLabel: "medium",
        receivedAt: now.toISOString(),
        sourceEvidence,
        draft: {
          id: "desktop-mail-calendar-reply-smoke:draft",
          toneLabel: "정중한 업무 답장",
          operationKind: "send_email",
          body: "안녕하세요. 요청 주신 미팅 일정 확인했습니다. 내부 일정 확인 후 회의실 B 기준으로 회신드리겠습니다.",
        },
        finalAction: {
          kind: "send_email",
          label: "메일 답장 검토",
          readiness: "adapter_not_connected",
          blockedReason: "수신자와 본문을 사용자가 직접 확인해야 실제 발송할 수 있습니다.",
          checklist: ["수신자 직접 확인", "본문 민감정보 확인", "최종 확인 후 메일 발송"],
          mailSendApprovalGate: {
            policy: "work_queue_approve_only",
            requiredDecision: "approve",
            decision: "approve",
            requiredFinalRoute: "included",
            finalRoute: "included",
            sourceContract: "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log",
            externalMutationBeforeGate: false,
          },
        },
      },
    ],
    { createdAt: now.toISOString() },
  );
}

function seedRepeatWorkOfficeWindowSmokeInbox() {
  const now = new Date();
  const receivedAt = now.toISOString();
  const sourceEvidence = {
    connectorId: "custom-imap-mail",
    providerId: "mailops",
    mailboxLabel: "회사 메일",
    messageSubject: "상담 일정 문의",
    senderPreview: "학부모 문의",
    draftPreview: "문의 주셔서 감사합니다. 가능한 상담 시간을 확인해 안내드리겠습니다.",
    approvalCandidateLabels: ["반복 업무 점검", "메일 발송", "일정 등록"],
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  appendAutomationInboxItems(
    [
      {
        id: "desktop-repeat-work-office-mail-smoke",
        title: "업무팩 문의 응대 자동 점검",
        source: "email",
        sourceLabel: "업무팩 메일·일정 점검 · custom-imap-mail",
        senderLabel: "학부모 문의",
        body: "반복 업무 점검이 상담 일정 문의 메일을 읽고 답장 후보를 만들었습니다.",
        summary: "반복 업무 점검이 문의 메일을 감지했고, 답장 초안은 최종 확인 전까지 발송되지 않습니다.",
        status: "draft_ready",
        riskLabel: "medium",
        receivedAt,
        sourceEvidence,
        riskSignals: [
          {
            id: "desktop-repeat-work-office-mail-risk",
            label: "메일 발송",
            riskLabel: "medium",
            reason: "업무팩 자동 점검은 초안과 승인 후보만 만들고 외부 발송은 실행하지 않습니다.",
          },
        ],
        draft: {
          id: "desktop-repeat-work-office-mail-smoke:draft",
          toneLabel: "업무팩 답장 초안",
          operationKind: "send_email",
          requiresApprovalBeforeSend: true,
          body: "문의 주셔서 감사합니다. 가능한 상담 시간을 확인해 안내드리겠습니다.",
        },
        finalAction: {
          kind: "send_email",
          label: "메일 발송",
          requiresFinalUserPresence: true,
          readiness: "ready_for_final_confirmation",
          blockedReason: "업무팩은 답장 초안까지만 만들며 실제 발송은 최종 확인 전까지 차단됩니다.",
          checklist: ["수신자와 문의 맥락 확인", "답장 문구와 일정 후보 확인", "발송은 finalUserPresence=true 확인 뒤에만 실행"],
          mailSendApprovalGate: {
            policy: "work_queue_approve_only",
            requiredDecision: "approve",
            decision: "approve",
            requiredFinalRoute: "included",
            finalRoute: "included",
            sourceContract: "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log",
            externalMutationBeforeGate: false,
          },
        },
      },
      {
        id: "desktop-repeat-work-office-calendar-smoke",
        title: "일정 등록 확인: 업무팩 문의 응대 자동 점검",
        source: "calendar",
        sourceLabel: "업무팩 메일·일정 점검 · custom-imap-mail",
        senderLabel: "학부모 문의",
        body: "반복 업무 점검이 상담 일정 후보를 만들었습니다.",
        summary: "반복 업무 점검이 상담 일정 후보를 만들었고, 캘린더 등록은 사용자가 최종 확인하기 전까지 차단됩니다.",
        status: "approval_pending",
        riskLabel: "medium",
        receivedAt,
        sourceEvidence: {
          ...sourceEvidence,
          providerId: "calendar",
          calendarCandidateText: "내일 오전 10시 상담",
          calendarTimeRangeLabel: "내일 10:00-11:00",
        },
        riskSignals: [
          {
            id: "desktop-repeat-work-office-calendar-risk",
            label: "일정 등록",
            riskLabel: "medium",
            reason: "캘린더 등록은 외부 변경이므로 앱 최종 확인 전에는 실행하지 않습니다.",
          },
        ],
        draft: {
          id: "desktop-repeat-work-office-calendar-smoke:draft",
          toneLabel: "업무팩 일정 후보",
          operationKind: "create_calendar_event",
          requiresApprovalBeforeSend: true,
          body: "내일 오전 10시 상담 일정을 등록할 수 있습니다.",
        },
        schedules: [
          {
            id: "desktop-repeat-work-office-calendar-smoke:schedule",
            label: "상담 일정 후보",
            startsAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
            endsAt: new Date(now.getTime() + 25 * 60 * 60_000).toISOString(),
            conflictNote: "스모크에서는 실제 캘린더를 변경하지 않습니다.",
          },
        ],
        finalAction: {
          kind: "create_calendar_event",
          label: "일정 등록",
          requiresFinalUserPresence: true,
          readiness: "adapter_not_connected",
          blockedReason: "캘린더 등록은 읽기/후보 생성과 분리되어 있으며 사용자가 최종 확인하기 전까지 차단됩니다.",
          checklist: ["일정 제목 확인", "시작/종료 시간 확인", "캘린더 등록은 finalUserPresence=true 확인 뒤에만 실행"],
        },
      },
    ],
    { createdAt: receivedAt },
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showScheduleOsNotification(input = {}) {
  if (!Notification?.isSupported?.()) {
    return {
      status: "os_notification_not_supported",
      channel: "os",
      userMessage: "이 OS에서는 데스크톱 알림을 사용할 수 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const notification = new Notification({
    title: sanitizeNotificationLine(input.title, "ModyCrew 일정 알림"),
    body: sanitizeNotificationLine(input.body ?? input.message, "확인할 일정 브리핑이 있습니다."),
    silent: false,
  });
  notification.on("click", () => {
    void focusScheduleNotificationTarget(input);
  });
  notification.show();
  return {
    status: "os_notification_shown",
    channel: "os",
    workItemId: sanitizeNotificationLine(input.workItemId, ""),
    ruleId: sanitizeNotificationLine(input.ruleId, ""),
    queueFilter: notificationQueueFilterForInput(input),
    userMessage: "OS 데스크톱 알림을 표시했습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function showMainWindow() {
  let win = mainWindowRef;
  if (!win || win.isDestroyed?.()) {
    await createMainWindow();
    win = mainWindowRef;
  }
  if (!win || win.isDestroyed?.()) return null;
  if (win.isMinimized?.()) win.restore();
  applyWindowIcon(win);
  win.show();
  win.focus();
  return win;
}

async function handleDesktopBridgeMessage(payload = {}, event = null) {
  if (payload?.kind === "take_pending_work_item_focus") {
    return takePendingWorkItemFocusFor(event?.sender);
  }

  if (payload?.kind === "inbox_attention") {
    await refreshInboxAttention();
    return inboxAttentionTracker.current();
  }

  if (payload?.kind === "open_release_field_guide") {
    return handleReleaseFieldGuideMessage(payload, { repoRoot, shell });
  }

  if (payload?.kind === "open_first_user_observation_kit") {
    return handleFirstUserObservationKitMessage(payload, { repoRoot, shell });
  }

  if (payload?.kind === "open_release_ai_runtime_live_kit") {
    return handleReleaseAIRuntimeLiveKitMessage(payload, { repoRoot, shell });
  }

  if (payload?.kind === "open_release_live_smoke_kit") {
    return handleReleaseLiveSmokeKitMessage(payload, { repoRoot, shell });
  }

  if (payload?.kind === "open_release_operator_runner_kit") {
    return handleReleaseOperatorRunnerKitMessage(payload, { repoRoot, shell });
  }

  if (payload?.kind === "open_release_unblock_kit") {
    return handleReleaseUnblockKitMessage(payload, { repoRoot, shell });
  }

  if (payload?.kind === "open_workspace_window") {
    const targetName = String(payload?.target ?? "");
    if (targetName !== "office") {
      return {
        status: "workspace_window_unknown_target",
        target: targetName,
        userMessage: "지원하지 않는 작업 창입니다.",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }
    return openOfficeWorkspaceWindow();
  }

  if (payload?.kind === "return_to_main_window") {
    return returnToMainWindow();
  }

  if (payload?.kind === "open_worker_companion_window") {
    return openWorkerCompanionWindow(payload?.options);
  }

  return {
    status: "desktop_bridge_unknown_message",
    userMessage: "지원하지 않는 데스크톱 브리지 요청입니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function openOfficeWorkspaceWindow(options = {}) {
  if (officeWindowRef && !officeWindowRef.isDestroyed?.()) {
    if (officeWindowRef.isMinimized?.()) officeWindowRef.restore();
    officeWindowRef.show();
    officeWindowRef.focus();
    return {
      status: "workspace_window_focused",
      target: "office",
      userMessage: "업무 오피스 창을 앞으로 가져왔습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const win = new BrowserWindow({
    ...secureBrowserWindowOptions,
    backgroundColor: themedWindowBackgroundColor(),
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "ModyCrew 업무 오피스",
    icon: resolveWindowFrameIconPath(),
    webPreferences: {
      ...secureBrowserWindowOptions.webPreferences,
      preload: resolvePreloadPath(),
    },
  });
  applyWindowIcon(win);
  officeWindowRef = win;
  win.on("closed", () => {
    if (officeWindowRef === win) officeWindowRef = null;
  });
  win.once("ready-to-show", () => {
    applyWindowIcon(win);
    win.show();
    win.focus();
  });
  await win.loadURL(resolveWorkspaceUrl("office", options));
  return {
    status: "workspace_window_opened",
    target: "office",
      userMessage: "업무 오피스 창을 열었습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function returnToMainWindow() {
  const mainWindow = await showMainWindow();
  if (officeWindowRef && !officeWindowRef.isDestroyed?.()) officeWindowRef.hide();
  if (workerCompanionWindowRef && !workerCompanionWindowRef.isDestroyed?.()) workerCompanionWindowRef.hide();
  mainWindow?.moveTop?.();
  mainWindow?.focus?.();
  return {
    status: "main_window_focused",
    target: "chat",
    userMessage: "직원 오피스 창을 내리고 본창의 대화로 돌아왔습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function openWorkerCompanionWindow(options = {}) {
  const windowOptions = normalizeWorkerCompanionWindowOptions(options);
  if (workerCompanionWindowRef && !workerCompanionWindowRef.isDestroyed?.()) {
    if (workerCompanionWindowRef.isMinimized?.()) workerCompanionWindowRef.restore();
    applyWorkerCompanionWindowChrome(workerCompanionWindowRef);
    workerCompanionWindowRef.setBounds?.(resolveWorkerCompanionWindowBounds(windowOptions));
    await workerCompanionWindowRef.loadURL(resolveWorkerCompanionUrl(windowOptions));
    workerCompanionWindowRef.show();
    workerCompanionWindowRef.focus();
    return {
      status: "worker_companion_window_focused",
      target: "workers",
      userMessage: "바탕화면 위 직원 일하는 모습을 앞으로 가져왔습니다.",
      ...createWorkerCompanionWindowResultMeta(workerCompanionWindowRef, windowOptions),
    };
  }

  const companionBounds = resolveWorkerCompanionWindowBounds(windowOptions);
  const win = new BrowserWindow({
    ...secureBrowserWindowOptions,
    backgroundColor: themedWindowBackgroundColor(),
    x: companionBounds.x,
    y: companionBounds.y,
    width: companionBounds.width,
    height: companionBounds.height,
    minWidth: workerCompanionWindowDefaults.minWidth,
    minHeight: workerCompanionWindowDefaults.minHeight,
    maxWidth: workerCompanionWindowDefaults.maxWidth,
    maxHeight: workerCompanionWindowDefaults.maxHeight,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    fullscreenable: false,
    resizable: true,
    type: "toolbar",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: themedWindowBackgroundColor(),
      symbolColor: "#9aa7b8",
      height: 38,
    },
    title: "ModyCrew 직원 일하는 모습",
    icon: resolveWindowFrameIconPath(),
    webPreferences: {
      ...secureBrowserWindowOptions.webPreferences,
      preload: resolvePreloadPath(),
    },
  });
  applyWindowIcon(win);
  applyWorkerCompanionWindowChrome(win);
  workerCompanionWindowRef = win;
  win.on("closed", () => {
    if (workerCompanionWindowRef === win) workerCompanionWindowRef = null;
  });
  win.once("ready-to-show", () => {
    applyWindowIcon(win);
    win.show();
    win.focus();
  });
  await win.loadURL(resolveWorkerCompanionUrl(windowOptions));
  return {
    status: "worker_companion_window_opened",
    target: "workers",
    userMessage: "바탕화면 위 직원 일하는 모습을 열었습니다.",
    ...createWorkerCompanionWindowResultMeta(win, windowOptions),
  };
}

function createWorkerCompanionWindowResultMeta(win, options = normalizeWorkerCompanionWindowOptions()) {
  const bounds = win && !win.isDestroyed?.() ? win.getBounds?.() : undefined;
  return {
    displayMode: workerCompanionWindowDefaults.displayMode,
    route: workerCompanionWindowDefaults.route,
    surfaceLabel: workerCompanionWindowDefaults.surfaceLabel,
    currentWindow: workerCompanionWindowDefaults.currentWindow,
    visibleWork: workerCompanionWindowDefaults.visibleWork,
    hiddenWork: workerCompanionWindowDefaults.hiddenWork,
    finalBoundary: workerCompanionWindowDefaults.finalBoundary,
    userLanguage: workerCompanionWindowDefaults.userLanguage,
    stateContract: workerCompanionWindowDefaults.stateContract,
    sizePreset: options.sizePreset,
    positionPreset: options.positionPreset,
    motionStyle: options.motionStyle,
    avatarMode: options.avatarMode,
    alwaysOnTop: Boolean(win && !win.isDestroyed?.() && win.isAlwaysOnTop?.()),
    skipTaskbar: true,
    visibleOnAllWorkspaces: true,
    resizable: Boolean(win && !win.isDestroyed?.() && win.isResizable?.()),
    maximizable: Boolean(win && !win.isDestroyed?.() && win.isMaximizable?.()),
    bounds,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function resolveWorkerCompanionWindowBounds(options = normalizeWorkerCompanionWindowOptions()) {
  const workArea = screen?.getPrimaryDisplay?.()?.workArea;
  const presetBounds =
    options.sizePreset === "compact"
      ? { width: 440, height: 640 }
      : options.sizePreset === "large"
        ? { width: 900, height: 820 }
        : { width: workerCompanionWindowDefaults.width, height: workerCompanionWindowDefaults.height };
  const { width, height } = presetBounds;
  if (!workArea) return { width, height };
  const safeWidth = Math.min(width, Math.max(workerCompanionWindowDefaults.minWidth, workArea.width - workerCompanionWindowDefaults.margin * 2));
  const safeHeight = Math.min(height, Math.max(workerCompanionWindowDefaults.minHeight, workArea.height - workerCompanionWindowDefaults.margin * 2));
  const x =
    options.positionPreset === "left_dock"
      ? workArea.x + workerCompanionWindowDefaults.margin
      : workArea.x + workArea.width - safeWidth - workerCompanionWindowDefaults.margin;
  const y =
    options.positionPreset === "top_right" || options.positionPreset === "left_dock"
      ? workArea.y + workerCompanionWindowDefaults.margin
      : workArea.y + workArea.height - safeHeight - workerCompanionWindowDefaults.margin;
  return {
    width: safeWidth,
    height: safeHeight,
    x: Math.max(workArea.x + workerCompanionWindowDefaults.margin, x),
    y: Math.max(workArea.y + workerCompanionWindowDefaults.margin, y),
  };
}

function normalizeWorkerCompanionWindowOptions(options = {}) {
  return {
    sizePreset: options?.sizePreset === "compact" || options?.sizePreset === "standard" || options?.sizePreset === "large"
      ? options.sizePreset
      : workerCompanionWindowDefaults.sizePreset,
    positionPreset:
      options?.positionPreset === "top_right" ||
      options?.positionPreset === "left_dock" ||
      options?.positionPreset === "bottom_right"
        ? options.positionPreset
        : workerCompanionWindowDefaults.positionPreset,
    motionStyle: options?.motionStyle === "lively" || options?.motionStyle === "calm"
      ? options.motionStyle
      : workerCompanionWindowDefaults.motionStyle,
    avatarMode: options?.avatarMode === "custom" || options?.avatarMode === "base"
      ? options.avatarMode
      : workerCompanionWindowDefaults.avatarMode,
  };
}

function applyWorkerCompanionWindowChrome(win) {
  win.setAlwaysOnTop?.(true, "floating");
  win.setSkipTaskbar?.(true);
  if (typeof win.setVisibleOnAllWorkspaces === "function") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  }
}

function resolveWorkspaceUrl(workspaceTarget, options = {}) {
  const safeTarget = workspaceTarget === "office" ? "office" : "";
  const params = new URLSearchParams();
  params.set("from", "chat-window");
  if (isOfficeWindowOpenSmoke) params.set("preview", "workbench");
  // 알림·트레이에서 온 경우: 승인함을 펼치고 그 카드를 맨 앞에 둔다(OfficeBoard 가 읽는 주소 값).
  const focusWorkItemId = sanitizeWorkItemId(options.focusWorkItemId);
  const opensApproval = safeTarget === "office" && (options.officeView === "approval" || Boolean(focusWorkItemId));
  if (opensApproval) params.set("officeView", "approval");
  if (opensApproval && focusWorkItemId) params.set("focusFinalActionCard", focusWorkItemId);
  const query = params.toString();
  const hash = opensApproval ? "#final-action-candidates" : "";
  if (target.mode === "dev") {
    const base = target.devUrl.replace(/\/$/, "");
    return `${base}/${safeTarget}?${query}${hash}`;
  }
  if (target.mode === "prod") {
    return `modycrew://app/${safeTarget}?${query}${hash}`;
  }
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>ModyCrew</title></head><body><p>먼저 <code>npm run web:build</code> 를 실행해 주세요.</p></body></html>`,
    )
  );
}

function resolveWorkerCompanionUrl(options = normalizeWorkerCompanionWindowOptions()) {
  const params = new URLSearchParams();
  params.set("preview", "workbench");
  params.set("panel", "workers");
  params.set("view", "full");
  params.set("workerTab", "employees");
  params.set("workerCompanion", "1");
  params.set("companionDisplay", workerCompanionWindowDefaults.displayMode);
  params.set("companionCurrentWindow", workerCompanionWindowDefaults.currentWindow);
  params.set("companionVisibleWork", workerCompanionWindowDefaults.visibleWork);
  params.set("companionHiddenWork", workerCompanionWindowDefaults.hiddenWork);
  params.set("companionFinalBoundary", workerCompanionWindowDefaults.finalBoundary);
  params.set("companionUserLanguage", workerCompanionWindowDefaults.userLanguage);
  params.set("companionStateContract", workerCompanionWindowDefaults.stateContract);
  params.set("companionSize", options.sizePreset);
  params.set("companionPosition", options.positionPreset);
  params.set("companionMotion", options.motionStyle);
  params.set("companionAvatar", options.avatarMode);
  const query = params.toString();
  if (target.mode === "dev") {
    const base = target.devUrl.replace(/\/$/, "");
    return `${base}/?${query}`;
  }
  if (target.mode === "prod") {
    return `modycrew://app/?${query}`;
  }
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>ModyCrew 직원 일하는 모습</title></head><body><p>먼저 <code>npm run web:build</code> 를 실행해 주세요.</p></body></html>`,
    )
  );
}

function createTray() {
  if (trayRef || !Tray) return trayRef;
  const iconPath = resolveTrayIconPath();
  const icon = nativeImage?.createFromPath?.(iconPath);
  // NSIS can replace the executable before copying its resources. Never pass a
  // missing image path to Tray: it throws and aborts the rest of app startup.
  if (!icon || icon.isEmpty()) return null;
  trayRef = new Tray(icon.resize?.({ width: 16, height: 16 }) ?? icon);
  trayRef.setToolTip(currentTrayPresence().tooltip);
  trayRef.setContextMenu(createTrayMenu("대기 중"));
  trayRef.on("click", () => {
    void showMainWindow();
  });
  startInboxAttentionWatch();
  return trayRef;
}

function startTrayWhenReady(attempt = 0) {
  try { if (createTray()) return; } catch { /* Optional shell UI must not block the workers. */ }
  if (attempt < 30) {
    const retry = setTimeout(() => startTrayWhenReady(attempt + 1), 1000);
    retry.unref?.();
  } else {
    console.warn("[tray] 트레이를 준비하지 못했습니다. 배경 업무 실행은 계속합니다.");
    // 트레이가 없어도 업무함 감시·메일 자동 확인·MODY 비서는 돌아야 한다.
    startInboxAttentionWatch();
  }
}

function createTrayMenu(statusLabel = "대기 중") {
  trayStatusLabel = statusLabel;
  const presence = currentTrayPresence();
  return Menu.buildFromTemplate([
    {
      label: "ModyCrew 열기",
      click: () => {
        void showMainWindow();
      },
    },
    // 창을 닫아 두고 트레이에만 둔 사용자도 새 버전을 알 수 있게 트레이에서 바로 설치·확인한다.
    ...trayUpdateMenuItems(),
    // 창을 닫아 둬도 확인할 일이 몇 건인지 트레이에서 바로 보이게 한다. 승인함 카드는 승인함 보기로,
    // 맡긴 업무는 업무판으로 — 누르면 각자 제자리로 간다.
    ...(presence.menuLines.length > 0
      ? presence.menuLines.map((line) => ({
          label: line.label,
          click: () => {
            void (line.target === "task" ? focusOfficeTask("") : focusOfficeApproval(""));
          },
        }))
      : [{ label: presence.idleLabel, enabled: false }]),
    {
      label: "지금 업무 점검",
      click: () => {
        void runTrayDueCheck();
      },
    },
    { type: "separator" },
    {
      label: `상태: ${sanitizeTrayLabel(statusLabel)}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "PC 켤 때 자동으로 시작",
      type: "checkbox",
      checked: isOpenAtLoginEnabled(),
      enabled: canConfigureOpenAtLogin(),
      click: (menuItem) => {
        setOpenAtLoginFromTray(menuItem?.checked === true);
      },
    },
    {
      // 업무 제목과 AI 의 질문이 잠금 화면에도 보일 수 있어 묻지 않고 켜지 않는다.
      label: "맡긴 일 알림 받기",
      type: "checkbox",
      checked: taskNotificationConsent === true,
      enabled: Notification?.isSupported?.() === true,
      click: (menuItem) => {
        setTaskNotificationsFromTray(menuItem?.checked === true);
      },
    },
    { type: "separator" },
    {
      label: "완전히 종료",
      click: () => {
        isExplicitQuit = true;
        app.quit();
      },
    },
  ]);
}

async function runTrayDueCheck() {
  if (!trayRef) return;
  trayRef.setContextMenu(createTrayMenu("점검 중"));
  try {
    const result = await handleWorkSyncMessage(
      null,
      { kind: "run_today_check", triggeredBy: "tray", suppressExternalNotifications: true },
      createWorkSyncOptions(null),
    );
    trayRef.setContextMenu(createTrayMenu(result.userMessage ?? result.status ?? "점검 완료"));
  } catch (error) {
    trayRef.setContextMenu(createTrayMenu(`점검 실패: ${String(error?.message ?? error)}`));
  }
  inboxAttentionRefresh.request();
}

// ── 업데이트 알림(트레이·OS 알림) ─────────────────────────────────────────
// 설치형 업데이트 상태는 auto-updater.mjs 가 들고 있고, 규칙은 update-shell.mjs(순수 함수)에 있다.
// 여기서는 트레이 메뉴·OS 알림·화면 푸시(mody.desktop-update.changed)에 잇기만 한다.
let notifiedUpdateVersion = "";
let trayUpdateCheckRunning = false;

function trayUpdateMenuItems() {
  const entries = buildUpdateMenuEntries(getAutoUpdaterState(), { checking: trayUpdateCheckRunning, currentVersion: app.getVersion?.() ?? "" });
  return entries.map((entry) => ({
    label: sanitizeTrayLabel(entry.label),
    enabled: entry.enabled,
    click: () => {
      if (entry.action === "install_now") void installDownloadedUpdateFromTray();
      else if (entry.action === "download") void handleDesktopUpdateMessage(null, { action: "download" }).catch(() => {});
      else if (entry.action === "check") void runTrayUpdateCheck();
    },
  }));
}

function refreshTrayMenuForUpdate() {
  if (!trayRef || trayRef.isDestroyed?.()) return;
  try { trayRef.setContextMenu(createTrayMenu(trayStatusLabel)); } catch { /* 트레이가 사라진 경우 */ }
}

async function installDownloadedUpdateFromTray() {
  try {
    const result = await handleDesktopUpdateMessage(null, { action: "install_now" });
    if (result?.status !== "install_requested") refreshTrayMenuForUpdate();
  } catch (error) {
    console.warn("[auto-updater] 트레이에서 설치 요청 실패:", error?.message ?? error);
  }
}

async function runTrayUpdateCheck() {
  if (trayUpdateCheckRunning) return;
  trayUpdateCheckRunning = true;
  refreshTrayMenuForUpdate();
  let state = null;
  try {
    state = await handleDesktopUpdateMessage(null, { action: "check" });
  } catch (error) {
    console.warn("[auto-updater] 트레이 업데이트 확인 실패:", error?.message ?? error);
  } finally {
    trayUpdateCheckRunning = false;
    refreshTrayMenuForUpdate();
  }
  // 사용자가 직접 눌렀을 때만 결과를 말해 준다(자동 확인은 조용히).
  const result = describeManualCheckResult(state);
  if (result) showUpdateNotification(result.title, sanitizeTrayLabel(result.body));
}

function showUpdateNotification(title, body, onClick) {
  if (!Notification?.isSupported?.()) return;
  try {
    const notification = new Notification({ title, body, silent: true });
    notification.on("click", () => { if (onClick) onClick(); else void showMainWindow(); });
    notification.show();
  } catch (error) {
    console.warn("[auto-updater] 알림 표시 실패:", error?.message ?? error);
  }
}

function handleAutoUpdaterStateForShell(state) {
  refreshTrayMenuForUpdate();
  // 창이 숨어 있거나 가려져 있어도 화면이 60초 폴링을 기다리지 않도록 상태를 바로 밀어 준다.
  const payload = sanitizeDesktopUpdateState(state);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed?.()) continue;
    try { win.webContents.send("mody.desktop-update.changed", payload); } catch { /* 닫히는 중인 창 */ }
  }
  // 새 버전을 다 받았을 때 한 번만 알린다. 누르면 앱을 닫고 설치한 뒤 다시 연다.
  const notice = decideUpdateReadyNotification(state, notifiedUpdateVersion);
  if (!notice) return;
  notifiedUpdateVersion = notice.version;
  showUpdateNotification(sanitizeTrayLabel(notice.title), notice.body, () => { void installDownloadedUpdateFromTray(); });
}

async function showBackgroundModeNotice() {
  if (trayHideNoticeShown || !Notification?.isSupported?.()) return;
  trayHideNoticeShown = true;
  // 못 하는 일을 약속하지 않는다. 창을 닫아도 정해 둔 규칙 확인은 늘 돌지만,
  // AI 가 스스로 훑어 정리하는 것은 사용자가 [배경 정리]를 켰을 때만 한다.
  // 그래서 문구도 실제 설정을 읽어서 나눈다.
  let backgroundDigestEnabled = false;
  try {
    const digestStatus = await handleBackgroundDigestMessage(
      null,
      { kind: "status" },
      createBackgroundDigestOptions(),
    );
    backgroundDigestEnabled = digestStatus?.enabled === true;
  } catch {
    backgroundDigestEnabled = false;
  }
  const notification = new Notification({
    title: "ModyCrew가 트레이에서 계속 돌고 있습니다",
    body: backgroundDigestEnabled
      ? "정해 둔 자동 확인과 알림이 작동하고, 새로 들어온 것은 AI가 훑어 정리해 둡니다. 보내거나 등록하지는 않습니다. 완전히 끄려면 트레이 메뉴의 완전히 종료를 누르세요."
      : "정해 둔 자동 확인과 알림은 창을 닫아도 작동합니다. AI가 직접 판단하는 일은 창이 열려 있을 때 합니다. 창을 닫아도 정리해 두게 하려면 설정에서 배경 정리를 켜세요.",
    silent: true,
  });
  notification.on("click", () => {
    void showMainWindow();
  });
  notification.show();
}

// ── 배경 상주 ─────────────────────────────────────────────────────────────
// 창을 닫아 둬도: 트레이에 확인할 일 개수, 작업 표시줄 점, 업무 상태 알림,
// 알림을 누르면 새로고침 없이 그 카드로 이동, PC 켤 때 트레이로 자동 시작.
// 판단 규칙은 background-presence.mjs(순수 함수)에 있고 여기서는 Electron 에 잇기만 한다.
const launchedHidden = isHiddenLaunch(process.argv);
const inboxAttentionTracker = createInboxAttentionTracker();
const taskAttentionNotifier = createTaskAttentionNotifier();
const pendingWorkItemFocus = createPendingFocusStore();
const workItemFocusReadyContents = new Set();
const inboxAttentionRefresh = createCoalescedRunner(() => {
  void refreshInboxAttention();
}, 400);
let trayStatusLabel = "대기 중";
let taskAttentionCount = 0;
let inboxAttentionWatchTimer = null;
let backgroundPresencePreferences = null;
let attentionOverlayImageRef = null;
let taskNotificationConsent = false;

app.on("web-contents-created", (_event, contents) => {
  const contentsId = contents.id;
  // 다른 문서로 넘어가면 새 화면이 다시 신호를 받겠다고 알릴 때까지 기다린다.
  contents.on("did-navigate", () => workItemFocusReadyContents.delete(contentsId));
  contents.on("render-process-gone", () => workItemFocusReadyContents.delete(contentsId));
  contents.once("destroyed", () => {
    workItemFocusReadyContents.delete(contentsId);
    pendingWorkItemFocus.clear(contentsId);
  });
});

app.on("browser-window-created", (_event, win) => {
  // 숨겼다가 다시 보이면 작업 표시줄 단추가 새로 생기므로 점을 다시 얹는다.
  win.on("show", () => applyTaskbarAttentionTo(win, currentTrayPresence()));
});

function isLiveWindow(win) {
  return Boolean(win && !win.isDestroyed?.() && !win.webContents?.isDestroyed?.());
}

function currentTrayPresence() {
  return buildTrayPresence({ ...inboxAttentionTracker.current(), taskAttentionCount });
}

async function handleInboxMessageWithAttention(event, payload, options) {
  const result = await handleInboxMessage(event, payload, options);
  const kind = String(payload?.kind ?? "");
  if (kind !== "fetch_inbox" && kind !== "fetch_header_metrics") inboxAttentionRefresh.request();
  return result;
}

async function withInboxAttentionRefresh(resultPromise) {
  try {
    return await resultPromise;
  } finally {
    inboxAttentionRefresh.request();
  }
}

async function refreshInboxAttention() {
  let items;
  try {
    items = await handleInboxMessage(null, { kind: "fetch_inbox" });
  } catch {
    return;
  }
  const next = inboxAttentionTracker.observe(items);
  if (!next.changed) return;
  applyTrayPresence();
  broadcastInboxChanged(next);
  getAssistantSecretary()?.requestTick("inbox");
}

function startInboxAttentionWatch() {
  if (inboxAttentionWatchTimer) return;
  void refreshInboxAttention();
  void refreshTaskNotificationConsent();
  // 창을 닫아 둔 동안의 자동 점검·업무 실행기도 인박스를 바꾼다. 메모리 안 목록만 보므로 가볍다.
  inboxAttentionWatchTimer = setInterval(() => {
    void refreshInboxAttention();
  }, 15_000);
  inboxAttentionWatchTimer.unref?.();
  startMailLedgerAutoSync();
  // MODY 비서: 창을 닫아도 1분마다 일정·마감·새 메일·연결 상태를 살펴 먼저 말을 건다.
  getAssistantSecretary()?.start();
  const taskCountTimer = setTimeout(() => {
    void handleLocalMemoryMessage(null, { kind: "list_tasks" }, createLocalMemoryOptions(null))
      .then((result) => updateTaskAttentionCount(result?.tasks))
      .catch(() => undefined);
  }, 4_000);
  taskCountTimer.unref?.();
}

/**
 * 통합 메일함 자동 최신화.
 * 사용자가 '메일 가져오기'를 누르지 않아도 앱이 켜져 있는 동안 연결된 메일 계정을 주기적으로
 * 읽기 전용으로 확인해 원장(mail-ledger)과 업무 카드를 갱신한다. 발송·이동·삭제는 하지 않는다.
 * 메일 연결이 하나도 없으면 아무 일도 하지 않고, 실패해도 다음 주기에 다시 시도한다.
 */
let mailLedgerAutoSyncTimer = null;
let mailLedgerAutoSyncInFlight = false;
let mailLedgerAutoSyncLastWarnAt = 0;
const mailLedgerAutoSyncIntervalMs = Math.max(2, Number(process.env.MODYCREW_MAIL_AUTO_SYNC_MINUTES) || 5) * 60_000;
// 메일 자동 확인이 실제로 성공했는지 기록한다. MODY 비서가 '연결이 끊겼으니 다시 연결해 주세요'를 판단하는 근거다.
const mailAutoSyncHealth = {
  startedAt: new Date().toISOString(),
  lastAttemptAt: "",
  lastSuccessAt: "",
  lastFailureAt: "",
  lastError: "",
  consecutiveFailures: 0,
  skippedNoConnector: false,
  recovery: null,
};

function recordMailAutoSyncOutcome(result, error) {
  const at = new Date().toISOString();
  const recovery = result?.connectionRecovery && typeof result.connectionRecovery === "object" ? result.connectionRecovery : null;
  const recoveryKind = String(recovery?.kind ?? "");
  const failed = Boolean(error) || Boolean(result?.errorMessage) || ["credential_failed", "connection_required"].includes(recoveryKind);
  if (!failed) {
    mailAutoSyncHealth.lastSuccessAt = at;
    mailAutoSyncHealth.consecutiveFailures = 0;
    mailAutoSyncHealth.lastError = "";
    mailAutoSyncHealth.recovery = null;
    return;
  }
  mailAutoSyncHealth.lastFailureAt = at;
  mailAutoSyncHealth.consecutiveFailures += 1;
  mailAutoSyncHealth.lastError = sanitizeNotificationLine(error?.message ?? result?.errorMessage ?? recovery?.label ?? "", "메일을 가져오지 못했습니다");
  mailAutoSyncHealth.recovery = recovery
    ? {
        kind: recoveryKind,
        label: sanitizeNotificationLine(recovery.label, ""),
        detail: sanitizeNotificationLine(recovery.detail, ""),
        connectorId: sanitizeNotificationLine(recovery.connectorId, ""),
      }
    : null;
}

function startMailLedgerAutoSync() {
  if (mailLedgerAutoSyncTimer || isMailOpsChatSmoke || !app.isPackaged && !process.env.MODYCREW_MAIL_AUTO_SYNC_DEV) return;
  const first = setTimeout(() => { void runMailLedgerAutoSync("startup"); }, 25_000);
  first.unref?.();
  mailLedgerAutoSyncTimer = setInterval(() => { void runMailLedgerAutoSync("interval"); }, mailLedgerAutoSyncIntervalMs);
  mailLedgerAutoSyncTimer.unref?.();
}

async function hasReadyMailConnector() {
  try {
    const listed = await handleConnectorMessage(null, { kind: "list" }, { app, dialog, safeStorage });
    const connectors = Array.isArray(listed?.connectors) ? listed.connectors : [];
    return connectors.some((connector) => {
      const category = String(connector?.category ?? "").toLowerCase();
      const status = String(connector?.status ?? "").toLowerCase();
      return category === "mail" && (status.includes("connected") || status.includes("ready") || status.includes("loaded"));
    });
  } catch {
    return false;
  }
}

async function runMailLedgerAutoSync(reason = "interval") {
  if (mailLedgerAutoSyncInFlight) return null;
  mailLedgerAutoSyncInFlight = true;
  try {
    mailAutoSyncHealth.lastAttemptAt = new Date().toISOString();
    if (!(await hasReadyMailConnector())) {
      mailAutoSyncHealth.skippedNoConnector = true;
      return null;
    }
    mailAutoSyncHealth.skippedNoConnector = false;
    const result = await handleMailWorkIntakeMessage(null, { kind: "run", limit: 50, generateDrafts: false, autoSync: true, reason }, {
      app,
      dialog,
      safeStorage,
      recordActivity: (input = {}) =>
        handleSelectedWorkActionEventsMessage(null, { kind: "record", event: input }, { app }),
      saveWorkLearning: (input = {}) =>
        handleLocalMemoryMessage(null, { kind: "save_work_learning", ...input }, { app }),
      listWorkPatterns: () =>
        handleLocalMemoryMessage(null, { kind: "list_work_patterns" }, { app }),
      listConnectorStatuses: () =>
        handleConnectorMessage(null, { kind: "list" }, { app, dialog, safeStorage }),
      listTriggerSettings: () =>
        handleTriggerSettingsMessage(null, { kind: "list" }, { app }),
      getTriggerRunnerStatus: () =>
        handleTriggerRunnerMessage(null, { kind: "status" }, createTriggerRunnerOptions(null)),
      readSelectedWorkActionEvents: () => readSelectedWorkActionEventState({ app }),
    });
    const addedCount = Number(result?.mailLedger?.addedCount ?? 0) || 0;
    const totalCount = Number(result?.mailLedger?.totalCount ?? 0) || 0;
    recordMailAutoSyncOutcome(result, null);
    backgroundService.record("mail", result?.errorMessage ? "error" : "ready");
    inboxAttentionRefresh.request();
    broadcastMailLedgerChanged({ at: new Date().toISOString(), addedCount, totalCount, reason, addedInboxItemsCount: Number(result?.addedInboxItemsCount ?? 0) || 0 });
    if (addedCount > 0) console.log(`[mail-auto-sync] 새 메일 ${addedCount}통을 원장에 더했습니다 (${reason}).`);
    return result;
  } catch (error) {
    recordMailAutoSyncOutcome(null, error);
    backgroundService.record("mail", "error");
    if (Date.now() - mailLedgerAutoSyncLastWarnAt > 60 * 60_000) {
      mailLedgerAutoSyncLastWarnAt = Date.now();
      console.warn(`[mail-auto-sync] 자동 확인 실패: ${String(error?.message ?? error)}`);
    }
    return null;
  } finally {
    mailLedgerAutoSyncInFlight = false;
    getAssistantSecretary()?.requestTick("mail-sync");
  }
}

/** 메일 원장이 바뀌었음을 앱 창에 알린다. 기존 인박스 변경 채널에 mailLedger 정보를 덧붙여 보낸다. */
function broadcastMailLedgerChanged(mailLedger) {
  const appBaseUrls = appContentBaseUrls();
  const attention = inboxAttentionTracker.current();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isLiveWindow(win)) continue;
    let windowUrl = "";
    try { windowUrl = win.webContents.getURL(); } catch { windowUrl = ""; }
    if (!isAppContentUrl(windowUrl, appBaseUrls)) continue;
    win.webContents.send(inboxChangedChannel, {
      revision: attention.revision,
      pendingApprovalCount: attention.pendingApprovalCount,
      mailLedger,
    });
  }
}

// ── MODY 비서(24시간 비서) ───────────────────────────────────────────────
// 판단 규칙은 assistant-secretary.mjs(순수 함수)에 있고, 여기서는 이 PC에 이미 있는 근거를 모아 넘기고
// PC 알림·창 이동·화면 갱신 신호만 잇는다. 외부 발송·일정 등록·모델 호출은 하지 않는다.
let assistantSecretaryRef = null;
function getAssistantSecretary() {
  if (assistantSecretaryRef) return assistantSecretaryRef;
  if (typeof app.isReady === "function" && !app.isReady()) return null;
  try {
    assistantSecretaryRef = createAssistantSecretary({
      storePath: path.join(app.getPath("userData"), "assistant-secretary.v1.json"),
      readContext: readAssistantSecretaryContext,
      // 연결된 캘린더를 읽기 전용으로 직접 읽는다(10분 간격은 엔진이 지킨다). 일정 등록은 하지 않는다.
      readCalendar: (input) => loadCalendarWorkflowContext({ app, dialog, safeStorage }, input),
      notify: showAssistantSecretaryNotification,
      broadcast: broadcastAssistantSecretaryChanged,
      isUserViewingAssistant,
      logger: console,
    });
  } catch (error) {
    console.warn(`[assistant-secretary] 시작하지 못했습니다: ${String(error?.message ?? error)}`);
    assistantSecretaryRef = null;
  }
  return assistantSecretaryRef;
}

async function readAssistantSecretaryContext() {
  const [inbox, connectors, mail, workspace] = await Promise.allSettled([
    handleInboxMessage(null, { kind: "fetch_inbox" }),
    handleConnectorMessage(null, { kind: "list" }, { app, dialog, safeStorage }),
    handleMailWorkIntakeMessage(null, { kind: "list_mail_messages", limit: 200 }, { app, dialog, safeStorage }),
    handleLocalMemoryMessage(null, { kind: "load_work_session_workspace" }, createLocalMemoryOptions(null)),
  ]);
  const value = (entry) => (entry.status === "fulfilled" ? entry.value : null);
  const inboxValue = value(inbox);
  const mailValue = value(mail);
  const inboxItems = Array.isArray(inboxValue) ? inboxValue : Array.isArray(inboxValue?.items) ? inboxValue.items : undefined;
  const connectorList = Array.isArray(value(connectors)?.connectors) ? value(connectors).connectors : undefined;
  const sessions = Array.isArray(value(workspace)?.workspace?.sessions) ? value(workspace).workspace.sessions : undefined;
  const mailRows = Array.isArray(mailValue?.messages)
    ? excludeHandledInboxMailRows(mailValue.messages, getAutomationInboxSnapshot())
    : undefined;
  // 읽지 못한 근거는 빈 목록이 아니라 '모름'으로 넘긴다. 빈 목록으로 넘기면 '연결이 다시 정상'·'일정 없음'처럼 틀린 말을 한다.
  const unavailable = [];
  if (!inboxItems) unavailable.push("inbox");
  if (!connectorList) unavailable.push("connectors");
  if (!sessions) unavailable.push("workspace");
  if (!mailRows && connectorList?.some((connector) => connector?.category === "mail")) unavailable.push("mail");
  return {
    inbox: inboxItems,
    connectors: connectorList,
    // 원장을 읽지 못하면 undefined 로 둔다. 그래야 '새 메일' 판단 기준이 흔들리지 않는다.
    mailRows,
    sessions: sessions ?? [],
    unavailable,
    approvals: inboxAttentionTracker.current().pendingApprovalCount,
    mailSync: { ...mailAutoSyncHealth },
  };
}

function resolveAssistantSecretaryUrl() {
  if (target.mode === "dev") return `${target.devUrl.replace(/\/$/, "")}/assistant/`;
  if (target.mode === "prod") return "modycrew://app/assistant/";
  return "";
}

function isUserViewingAssistant() {
  const win = BrowserWindow.getFocusedWindow();
  if (!isLiveWindow(win)) return false;
  try {
    return /\/assistant\/?$/u.test(new URL(win.webContents.getURL()).pathname);
  } catch {
    return false;
  }
}

async function openAssistantSecretaryWindow() {
  const win = await showMainWindow();
  const url = resolveAssistantSecretaryUrl();
  if (!isLiveWindow(win) || !url) return;
  try {
    if (!/\/assistant\/?$/u.test(new URL(win.webContents.getURL()).pathname)) await win.loadURL(url);
  } catch (error) {
    console.warn(`[assistant-secretary] MODY 화면을 열지 못했습니다: ${String(error?.message ?? error)}`);
  }
}

function showAssistantSecretaryNotification(input = {}) {
  if (!Notification?.isSupported?.()) return;
  // 잠금 화면에도 보일 수 있으므로 메일 주소는 빼고 한 줄로 줄인다.
  const body = String(input.body ?? "").replace(/\([^()]*@[^()]*\)/gu, "");
  const notification = new Notification({
    title: sanitizeNotificationLine(input.title, "MODY"),
    body: sanitizeNotificationLine(body, "확인할 일이 있어요."),
    silent: input.message?.severity === "info",
  });
  notification.on("click", () => {
    void openAssistantSecretaryWindow();
  });
  notification.show();
}

function broadcastAssistantSecretaryChanged(state = {}) {
  const appBaseUrls = appContentBaseUrls();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isLiveWindow(win)) continue;
    let windowUrl = "";
    try { windowUrl = win.webContents.getURL(); } catch { windowUrl = ""; }
    if (!isAppContentUrl(windowUrl, appBaseUrls)) continue;
    win.webContents.send(assistantSecretaryChangedChannel, {
      unread: Math.max(0, Math.floor(Number(state.unread) || 0)),
      attention: Math.max(0, Math.floor(Number(state.attention) || 0)),
      lastMessageId: String(state.lastMessageId ?? "").slice(0, 120),
      lastTickAt: String(state.lastTickAt ?? "").slice(0, 40),
    });
  }
}

// 채널 이름은 글자 그대로 쓴다(배선 검사가 ipcMain.handle("mody....") 를 소스에서 찾는다). assistantSecretaryChannel 과 같은 값이다.
ipcMain.handle("mody.assistant-secretary.v1", async (event, payload = {}) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: "assistant_secretary_invalid", userMessage: "요청 형식을 확인해 주세요." };
  }
  let senderUrl = "";
  try { senderUrl = event?.sender?.getURL?.() ?? ""; } catch { senderUrl = ""; }
  if (!isAppContentUrl(senderUrl, appContentBaseUrls())) {
    return { status: "assistant_secretary_denied", userMessage: "앱 화면에서만 MODY 비서를 사용할 수 있어요." };
  }
  const secretary = getAssistantSecretary();
  if (!secretary) return { status: "assistant_secretary_unavailable", userMessage: "앱이 준비되는 중이에요. 잠시 후 다시 열어 주세요." };
  return secretary.handle(payload);
});

function updateTaskAttentionCount(tasks) {
  if (!Array.isArray(tasks)) return;
  const next = countTaskAttention(tasks);
  if (next === taskAttentionCount) return;
  taskAttentionCount = next;
  applyTrayPresence();
}

function applyTrayPresence() {
  const presence = currentTrayPresence();
  if (trayRef && !trayRef.isDestroyed?.()) {
    trayRef.setToolTip(presence.tooltip);
    trayRef.setContextMenu(createTrayMenu(trayStatusLabel));
  }
  for (const win of [mainWindowRef, officeWindowRef]) applyTaskbarAttentionTo(win, presence);
  if (process.platform === "darwin") app.setBadgeCount?.(presence.count);
}

function applyTaskbarAttentionTo(win, presence) {
  if (process.platform !== "win32" || !isLiveWindow(win) || typeof win.setOverlayIcon !== "function") return;
  try {
    win.setOverlayIcon(presence.count > 0 ? attentionOverlayImage() : null, presence.overlayDescription);
  } catch {
    // 작업 표시줄 점은 덤이다. 실패해도 트레이와 알림은 그대로 동작한다.
  }
}

function attentionOverlayImage() {
  if (!attentionOverlayImageRef) {
    const dot = createAttentionDotBitmap(16);
    attentionOverlayImageRef = nativeImage?.createFromBitmap?.(dot.buffer, { width: dot.width, height: dot.height }) ?? null;
  }
  return attentionOverlayImageRef;
}

function broadcastInboxChanged(state) {
  const appBaseUrls = appContentBaseUrls();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isLiveWindow(win)) continue;
    // 앱 화면(본창·업무 오피스·직원 창)에만 보낸다. 로그인 창 같은 바깥 화면에는 보내지 않는다.
    let windowUrl = "";
    try {
      windowUrl = win.webContents.getURL();
    } catch {
      windowUrl = "";
    }
    if (!isAppContentUrl(windowUrl, appBaseUrls)) continue;
    win.webContents.send(inboxChangedChannel, {
      revision: state.revision,
      pendingApprovalCount: state.pendingApprovalCount,
    });
  }
}

function noteTaskExecutionAttention(result) {
  try {
    updateTaskAttentionCount(result?.tasks);
    const attention = taskAttentionNotifier.consider(result);
    // 앱 창을 보고 있으면 화면에서 이미 보이므로 겹쳐 알리지 않는다.
    if (!attention || BrowserWindow.getFocusedWindow()) return;
    void showTaskAttentionNotification(attention);
  } catch (error) {
    console.warn(`[task-execution] 알림을 띄우지 못했습니다: ${String(error?.message ?? error)}`);
  }
}

async function showTaskAttentionNotification(attention) {
  // 업무 제목과 AI 의 질문이 잠금 화면에도 보일 수 있으므로 사용자가 동의했을 때만 띄운다.
  if (!(await refreshTaskNotificationConsent())) return;
  try {
    // 누르면 승인함이 아니라 업무판의 그 업무로 간다(focusKind: "task").
    showScheduleOsNotification({
      title: attention.title,
      body: attention.body,
      workItemId: attention.taskId,
      focusKind: "task",
    });
  } catch (error) {
    console.warn(`[task-execution] 알림을 띄우지 못했습니다: ${String(error?.message ?? error)}`);
  }
}

function presencePreferences() {
  backgroundPresencePreferences ??= readBackgroundPresencePreferences(app.getPath("userData"));
  return backgroundPresencePreferences;
}

async function readTaskNotificationConsent() {
  const preferences = presencePreferences();
  if (typeof preferences.taskNotifications === "boolean") return preferences.taskNotifications;
  try {
    // 아직 고르지 않았다면 자동 점검 규칙의 PC 알림 동의를 따른다(기본은 꺼짐).
    const settings = await handleTriggerSettingsMessage(null, { kind: "list" }, { app });
    return resolveTaskNotificationConsent(preferences, settings?.rules);
  } catch {
    return false;
  }
}

async function refreshTaskNotificationConsent(options = {}) {
  const next = await readTaskNotificationConsent();
  const changed = next !== taskNotificationConsent;
  taskNotificationConsent = next;
  if ((changed || options.rebuildMenu === true) && trayRef && !trayRef.isDestroyed?.()) {
    trayRef.setContextMenu(createTrayMenu(trayStatusLabel));
  }
  return next;
}

async function withTaskNotificationConsentRefresh(resultPromise) {
  try {
    return await resultPromise;
  } finally {
    void refreshTaskNotificationConsent();
  }
}

function setTaskNotificationsFromTray(enabled) {
  try {
    backgroundPresencePreferences = writeBackgroundPresencePreferences(app.getPath("userData"), { taskNotifications: enabled });
  } catch (error) {
    console.warn(`[modycrew-tray] 알림 설정을 바꾸지 못했습니다: ${String(error?.message ?? error)}`);
  }
  // 저장에 실패했으면 체크가 원래대로 돌아가도록 메뉴를 다시 만든다.
  void refreshTaskNotificationConsent({ rebuildMenu: true });
}

function appContentBaseUrls() {
  if (target.mode === "dev") return [target.devUrl];
  if (target.mode === "prod") return ["modycrew://app/"];
  return [];
}

function deliverWorkItemFocus(win, request, options = {}) {
  if (!isLiveWindow(win)) return "none";
  const contents = win.webContents;
  let windowUrl = "";
  try {
    windowUrl = contents.getURL();
  } catch {
    windowUrl = "";
  }
  const plan = planWorkItemFocusDelivery({
    windowJustCreated: options.windowJustCreated === true,
    rendererGone: contents.isCrashed?.() === true,
    rendererReady: workItemFocusReadyContents.has(contents.id),
    windowUrl,
    isLoading: contents.isLoading?.() === true,
    appBaseUrls: appContentBaseUrls(),
  });
  if (plan === "send") contents.send(workItemFocusChannel, request);
  if (plan === "pending") pendingWorkItemFocus.set(contents.id, request);
  return plan;
}

function takePendingWorkItemFocusFor(sender) {
  if (!sender || sender.isDestroyed?.()) return null;
  // 화면이 이 요청을 부르면 신호를 받을 준비가 된 것이다.
  workItemFocusReadyContents.add(sender.id);
  return pendingWorkItemFocus.take(sender.id);
}

async function focusOfficeApproval(workItemId = "") {
  const focusWorkItemId = sanitizeWorkItemId(workItemId);
  if (!isLiveWindow(officeWindowRef)) {
    await openOfficeWorkspaceWindow({ officeView: "approval", focusWorkItemId });
    return;
  }
  await openOfficeWorkspaceWindow();
  const plan = deliverWorkItemFocus(officeWindowRef, { workItemId: focusWorkItemId, queue: "approval" });
  if (plan !== "load_url" || !isLiveWindow(officeWindowRef)) return;
  try {
    await officeWindowRef.loadURL(resolveWorkspaceUrl("office", { officeView: "approval", focusWorkItemId }));
  } catch (error) {
    console.warn(`[modycrew-notification] office focus failed: ${String(error?.message ?? error)}`);
  }
}

/**
 * 맡긴 업무 알림·트레이 줄을 눌렀을 때: 업무 오피스 창의 업무판에서 그 업무를 보여 준다.
 * 답하기·다시 시도·끝냈어요가 모두 업무판(TaskBoard)에 있다. 승인함 보기에는 그 카드가 없다.
 * taskId 가 비어 있으면(트레이 줄) 업무판 맨 위의 "답이 필요해요" 칸으로 간다.
 */
async function focusOfficeTask(taskId = "") {
  const request = { workItemId: sanitizeWorkItemId(taskId), queue: "", kind: "task" };
  const officeExisted = isLiveWindow(officeWindowRef);
  // 창이 없으면 이 호출 안에서 바로 만들어진다(첫 await 전). 그 창에 요청을 맡겨 두면
  // 화면이 뜨자마자 가져간다.
  const opening = openOfficeWorkspaceWindow().catch((error) => {
    console.warn(`[modycrew-notification] office open failed: ${String(error?.message ?? error)}`);
    return null;
  });
  const plan = deliverWorkItemFocus(officeWindowRef, request, { windowJustCreated: !officeExisted });
  await opening;
  if (plan !== "load_url" || !isLiveWindow(officeWindowRef)) return;
  try {
    // 앱 화면이 아니거나 화면 프로세스가 죽은 창: 요청을 맡겨 두고 업무 오피스를 다시 연다.
    pendingWorkItemFocus.set(officeWindowRef.webContents.id, request);
    await officeWindowRef.loadURL(resolveWorkspaceUrl("office"));
  } catch (error) {
    console.warn(`[modycrew-notification] office task focus failed: ${String(error?.message ?? error)}`);
  }
}

function canConfigureOpenAtLogin() {
  // --hidden 인자는 Windows 에서만 전달된다(macOS 는 args 를 무시해 창이 통째로 뜬다).
  return (
    app.isPackaged === true &&
    typeof app.setLoginItemSettings === "function" &&
    process.platform === "win32"
  );
}

function loginItemSettingsFor(openAtLogin) {
  return buildLoginItemSettings({
    openAtLogin,
    execPath: process.execPath,
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
  });
}

function isOpenAtLoginEnabled() {
  if (presencePreferences().openAtLogin !== true || !canConfigureOpenAtLogin()) return false;
  try {
    const { path: executablePath, args } = loginItemSettingsFor(true);
    const current = app.getLoginItemSettings({ path: executablePath, args });
    // Windows 설정·작업 관리자에서 꺼 두었으면 체크를 풀어 보여 준다.
    return current?.openAtLogin === true && current?.executableWillLaunchAtLogin !== false;
  } catch {
    return true;
  }
}

function setOpenAtLoginFromTray(enabled) {
  if (!canConfigureOpenAtLogin()) return;
  try {
    app.setLoginItemSettings(loginItemSettingsFor(enabled));
    backgroundPresencePreferences = writeBackgroundPresencePreferences(app.getPath("userData"), { openAtLogin: enabled });
  } catch (error) {
    console.warn(`[modycrew-tray] 자동 시작 설정을 바꾸지 못했습니다: ${String(error?.message ?? error)}`);
  }
  if (trayRef && !trayRef.isDestroyed?.()) trayRef.setContextMenu(createTrayMenu(trayStatusLabel));
}

let taskExecutionRunner;
let companyAutomationRuntime;
let stopTriggerRunner;
const backgroundService = createBackgroundService({
  powerSaveBlocker,
  preferences: () => ({ ...presencePreferences(), openAtLogin: isOpenAtLoginEnabled(), taskNotifications: taskNotificationConsent === true }),
  canOpenAtLogin: canConfigureOpenAtLogin,
  readOverview: async () => {
    const [taskResult, triggers, company] = await Promise.all([
      handleLocalMemoryMessage(null, { kind: "list_tasks" }, createLocalMemoryOptions(null)),
      listTriggerSettings({ app }),
      loadCompanyState(createCompanyAutomationOptions()),
    ]);
    if (!Array.isArray(taskResult.tasks)) throw new Error("업무 목록 읽기 실패");
    return { tasks: taskResult.tasks, rules: triggers.rules, company, approvalCount: inboxAttentionTracker.current().pendingApprovalCount };
  },
  wake: {
    tasks: () => getTaskExecutionRunner().runDue(),
    company: () => getCompanyAutomationRuntime().tick(),
    mail: () => handleTriggerRunnerMessage(null, { kind: "run_due_checks", force: false, triggeredBy: "system_resume" }, createTriggerRunnerOptions()),
  },
});

ipcMain.handle("mody.background-service.v1", async (event, payload = {}) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { status: "background_service_invalid", userMessage: "설정 값을 확인해 주세요." };
  const sender = event?.sender;
  let trustedUrl = false;
  try {
    const url = new URL(sender?.getURL() || "");
    const base = new URL(target.mode === "dev" ? target.devUrl : "modycrew://app/");
    trustedUrl = url.protocol === base.protocol && url.host === base.host;
  } catch { /* untrusted or not-yet-loaded frame */ }
  // Only the top-level application UI may change OS startup/power settings.
  if (!sender || sender.isDestroyed() || event.senderFrame !== sender.mainFrame ||
      !BrowserWindow.fromWebContents(sender) || !trustedUrl) {
    return { status: "background_service_denied", userMessage: "앱 화면에서 설정을 변경해 주세요." };
  }
  if (payload.kind === "configure") {
    const previousPreferences = presencePreferences();
    const previousOpenAtLogin = isOpenAtLoginEnabled();
    const patch = {};
    for (const key of ["openAtLogin", "keepAwake", "taskNotifications"]) {
      if (key in payload) {
        if (typeof payload[key] !== "boolean") return { status: "background_service_invalid", userMessage: "설정 값을 확인해 주세요." };
        patch[key] = payload[key];
      }
    }
    try {
      if ("openAtLogin" in patch) {
        if (!canConfigureOpenAtLogin()) throw new Error("설치된 Windows 앱에서 자동 시작을 설정할 수 있습니다.");
        app.setLoginItemSettings(loginItemSettingsFor(patch.openAtLogin));
      }
      if ("keepAwake" in patch) backgroundService.setKeepAwake(patch.keepAwake);
      backgroundPresencePreferences = writeBackgroundPresencePreferences(app.getPath("userData"), patch);
      await refreshTaskNotificationConsent({ rebuildMenu: true });
    } catch {
      // Keep effective power behavior consistent with the last persisted choice.
      try {
        backgroundService.setKeepAwake(previousPreferences.keepAwake);
        if ("openAtLogin" in patch && canConfigureOpenAtLogin()) app.setLoginItemSettings(loginItemSettingsFor(previousOpenAtLogin));
      } catch { /* show a failure; do not claim the setting was applied */ }
      return { status: "background_service_failed", userMessage: "설정을 저장하지 못했습니다. 다시 시도해 주세요." };
    }
  } else if (payload.kind !== "status") {
    return { status: "background_service_invalid", userMessage: "지원하지 않는 요청입니다." };
  }
  return backgroundService.status();
});

function createCompanyAutomationOptions(event = null) {
  return { app, dialog, shell, safeStorage, BrowserWindow,
    onHealth: (state) => backgroundService.record("company", state),
    listMailAccounts: () => listCompanyMailSources({ app, safeStorage }),
    readMailMessages: async (connection) => {
      const result = await runConnectedMailWorkIntake({ app, safeStorage }, { connectorId: connection.accountId, limit: 50 });
      if (!result.providerRead?.messages) throw new Error(result.userMessage || "메일 계정 연결을 확인해 주세요.");
      return result.providerRead.messages.flatMap((mail) => {
        const candidate = result.workReport?.candidates?.find((c) => c.sourceId === mail.messageId);
        if (candidate?.secureIntakeDecision?.aiMayReadBodyPreview !== true) return [];
        return [{ id: String(mail.messageId), roomId: connection.accountId, text: `제목: ${mail.subject}\n${candidate.secureIntakeDecision.bodyPreviewForAi || ""}`, sender: mail.from, timestamp: mail.receivedAt, provider: "mail", connectionId: connection.id }];
      });
    },
    generateText: (input) => handleMainAIProviderMessage(event, redactCompanyAIRequest(input)),
    enqueue: (input) => getTaskExecutionRunner().enqueue(input),
    controlTask: (input) => getTaskExecutionRunner().control(input),
    answerTask: async (taskId, answer) => {
      const result = await handleLocalMemoryMessage(null, { kind: "answer_task_question", taskId, answer }, createLocalMemoryOptions(null));
      if (result.status === "local_memory_task_answered") await getTaskExecutionRunner().resumeAnswered(taskId);
      return result;
    },
    readTasks: async () => (await handleLocalMemoryMessage(null, { kind: "list_tasks" }, createLocalMemoryOptions(null))).tasks || [],
    exportDocument: (payload) => handleDocumentProductionMessage(event, payload, { app, dialog, shell, BrowserWindow, trustedSender: !event }),
    confirmQuotationSend: async (preview) => {
      if (!event?.sender || event.sender.isDestroyed()) return false;
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent || parent.isDestroyed()) return false;
      const answer = await dialog.showMessageBox(parent, {
        type: 'question', title: '견적서 메일 최종 확인', message: '이 견적서를 첨부해 발송할까요?',
        detail: `발신: ${preview.accountName}\n수신: ${preview.recipient}\n제목: ${preview.subject}\n첨부: ${preview.artifactName}\n견적 합계: ${preview.total}원\n\n${preview.body}`,
        buttons: ['취소', '승인하고 발송'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return answer.response === 1 && !event.sender.isDestroyed();
    },
    sendQuotationMail: (snapshot) => executeProviderFinalAction({
      actionKind: 'send_email', connectorId: snapshot.accountId,
      message: {
        recipient: snapshot.recipient, subject: snapshot.subject, body: snapshot.body,
        attachments: [snapshot.attachment],
        mailSendApprovalGate: {
          status: 'approved_mail_send_gate_ready',
          policy: 'approved_mail_work_queue_or_user_composed_check_before_live_send',
          sourceContract: 'quotation_approval_candidate_to_native_final_confirmation',
          externalMutationBeforeGate: false,
        },
      },
    }, { app, safeStorage, smtpSender: createSmtpSender }),
    syncOrganization: async (departments, masterId) => {
      const options = { app, domainEntryPath };
      const loaded = await handleAgentOrgMessage(null, { kind: "load_org" }, options);
      if (loaded.status !== "agent_org_loaded") throw new Error(loaded.userMessage);
      const blueprint = loaded.blueprint || { contract: "agent_org_blueprint_v1", version: 1, masterTeammateId: masterId, members: [] };
      const specVersions = [...loaded.specVersions]; const now = new Date().toISOString();
      for (const department of departments) {
        const teammateId = `company-${department.id}`;
        let member = blueprint.members.find((m) => m.teammateId === teammateId);
        if (!member) { member = { teammateId, parentTeammateId: blueprint.masterTeammateId, joinedAt: now, activeSpecVersion: 1 }; blueprint.members.push(member); }
        member.roleTitle = department.name; member.capabilityTags = department.keywords; member.memberStatus = department.enabled ? "active" : "retired";
        const current = specVersions.filter((v) => v.teammateId === teammateId).at(-1);
        if (!current || current.name !== department.name || current.brief !== department.role.slice(0, 180) || JSON.stringify(current.capabilityTags) !== JSON.stringify(department.keywords.slice(0, 16))) {
          const version = Math.max(0, ...specVersions.filter((v) => v.teammateId === teammateId).map((v) => v.specVersion)) + 1;
          for (let index = 0; index < specVersions.length; index += 1) if (specVersions[index].teammateId === teammateId && specVersions[index].versionStatus === "active") specVersions[index] = { ...specVersions[index], versionStatus: "superseded" };
          specVersions.push({ contract: "agent_spec_version_v1", teammateId, specVersion: version, name: department.name, roleTitle: department.name, brief: department.role, instructions: ["지정한 회사 원본 자료를 근거로 업무를 수행한다.", "외부 실행은 사용자 최종 승인을 기다린다."], capabilityTags: department.keywords, skillIds: [], channelName: "회사 운영", sourceProposalId: null, createdAt: now, versionStatus: "active" }); member.activeSpecVersion = version;
        }
      }
      blueprint.version += 1; blueprint.updatedAt = now;
      const saved = await handleAgentOrgMessage(null, { kind: "save_org", blueprint, specVersions }, options);
      if (saved.status !== "agent_org_saved") throw new Error(saved.userMessage);
    },
  };
}
function getCompanyAutomationRuntime() {
  companyAutomationRuntime ??= createCompanyAutomationRuntime(createCompanyAutomationOptions());
  return companyAutomationRuntime;
}
function getTaskExecutionRunner() {
  taskExecutionRunner ??= createTaskExecutionRunner({
    app,
    domainEntryPath,
    onHealth: (state) => backgroundService.record("tasks", state),
    generateText: (input) => generateScopedCompanyText(input, (request) => handleMainAIProviderMessage(null, request), { app }),
    onChanged: (result) => {
      // 창이 닫혀 있어도 질문·확인 대기·중단·예약 업무 완료는 OS 알림으로 알린다.
      noteTaskExecutionAttention(result);
      return result.sourceEventId ? handleSelectedWorkActionEventsMessage(null, {
        kind: "update", eventId: result.sourceEventId,
        patch: { status: taskExecutionEventStatus(result.status), detail: result.userMessage },
      }, { app }) : undefined;
    },
    getTools: async (task, localStorageRoot) => {
      const departmentId = task.execution?.generation?.agentRunContext?.companyDepartmentId;
      if (departmentId) {
        const context = task.execution.generation.agentRunContext;
        const { department } = await assertCompanyTaskAuthority(context, { app });
        const tools = department ? [{ id: "company.sources", label: "이 업무에 지정된 회사 자료 검색 — ARGS: query", permission: "auto", execute: async (args) => JSON.stringify(await readCompanyTaskContext(context, args.query, { app })) }] : [];
        if (department && departmentId === "finance") tools.push({ id: "company.accounting", label: "이 업무의 원본에 연결된 검토 완료 장부 읽기", permission: "auto", execute: async () => JSON.stringify(await readCompanyTaskAccounting(context, { app })) });
        return tools;
      }
      const callMemory = (kind) => handleLocalMemoryMessage(null, { kind }, createLocalMemoryOptions(null));
      const read = (id, label, execute) => ({ id, label, permission: "auto", execute: async (args) => {
        const result = await execute(args);
        const selected = {};
        for (const key of ["status", "userMessage", "results", "messages", "message", "bodyPreview", "draft", "draftText", "events", "patterns", "workPatterns", "connectors", "rules", "report", "workItems", "root", "totalCount"]) {
          if (result?.[key] !== undefined) selected[key] = result[key];
        }
        return JSON.stringify(selected);
      } });
      const tools = [
        read("memory.status", "기억 저장소 상태", () => callMemory("status")),
        read("patterns.list", "학습한 업무 방식", () => callMemory("list_work_patterns")),
        read("connectors.status", "계정 연결 상태", () => handleConnectorMessage(null, { kind: "list" }, { app, dialog, safeStorage })),
        read("triggers.settings", "반복 업무 설정", () => handleTriggerSettingsMessage(null, { kind: "list" }, { app })),
        read("docs.search", "자료 본문 검색 — ARGS: query", (args) => handleDocumentLearningMessage(null, {
          kind: "search_index", localStorageRoot, query: String(args.query ?? "").slice(0, 500), limit: 5,
        }, { app })),
        read("work.sync", "메일·일정 최신 정보 확인", () => handleWorkSyncMessage(null, {
          kind: "run_today_check", limit: 10, suppressExternalNotifications: true,
        }, createWorkSyncOptions(null))),
        read("automation.check", "반복 업무 점검", () => handleTriggerRunnerMessage(null, {
          kind: "run_due_checks", triggeredBy: "task_execution", suppressExternalNotifications: true,
        }, { ...createTriggerRunnerOptions(null), suppressExternalNotifications: true })),
      ];
      const workPackId = task.execution?.generation?.agentRunContext?.workPackId;
      // 담당을 비워 둔 일은 기본 비서(모든 업무 종류를 맡는 조율자)가 맡는다고 명시한다 — 메일 도구도 그대로 준다.
      const handledByMasterOperator =
        !task.assigneeId ||
        task.assigneeId === "teammate-personal-operator" ||
        task.execution?.generation?.roleContext?.templateId === "personal";
      if (handledByMasterOperator || ["inquiry_response", "schedule_coordination"].includes(workPackId)) {
        for (const [id, kind, label] of [
          ["mail.search", "mail_search", "메일 검색 — ARGS: query"],
          ["mail.read", "mail_read", "메일 내용 읽기 — ARGS: messageId"],
          ["mail.draft", "mail_draft", "메일 초안 준비 — 발송하지 않음"],
          ["mail.intake", "run", "메일 업무 확인"],
        ]) tools.push(read(id, label, (args) => handleMailWorkIntakeMessage(null, { ...args, kind }, { app, safeStorage })));
      }
      // 일상 도구(날씨·교통·가격·공공 정보)도 예약·배경 업무에서 쓴다. 업무 문장과 맞는 후보가 있을 때만,
      // 이 직원 역할이 허용한 분류 안에서 연다. 조회는 읽기 전용이고 결과에 출처·조회 시각이 붙는다.
      const dailyCandidates = selectDailySkillsForText(
        `${task.title ?? ""}\n${task.execution?.requestText ?? ""}`,
        { categories: handledByMasterOperator ? "all" : await resolveBackgroundDailySkillCategories(task) },
      );
      if (dailyCandidates.length) {
        tools.push({
          id: "daily.lookup",
          label: `일상 공개 정보 조회(읽기 전용) — ARGS: {"skill":"…","endpoint":"…","params":{…}} · ${formatDailySkillsForToolLabel(dailyCandidates)}`,
          permission: "auto",
          execute: async (args = {}) => formatDailySkillResultForBackground(await handleDailySkillsMessage(null, {
            kind: "lookup",
            skillId: String(args.skill ?? args.skillId ?? ""),
            endpointId: String(args.endpoint ?? args.endpointId ?? ""),
            params: args.params && typeof args.params === "object" && !Array.isArray(args.params) ? args.params : {},
          })),
        });
      }
      return tools;
    },
    // 메일 초안·발송 요청으로 끝난 일은 승인함 '보낼까요?' 카드로 올린다. 발송은 승인함 마지막 확인에서만.
    stageApproval: createTaskApprovalStager({
      stageMailDraftCard,
      readMailReplySource: (input) => resolveMailReplySource(input, { app, safeStorage }),
    }),
  });
  return taskExecutionRunner;
}

/** 승인함 도우미(앱 시작 때 한 번): 초안 다시 쓰기·답장 원본 찾기·끝난 카드의 업무판 정리. */
function createInboxWorkItemHooks() {
  return {
    resolveMailDocumentAttachments: createMailDocumentAttachmentResolver({stateRoot:path.join(app.getPath('userData'),'document-production'),outputRoot:path.join(app.getPath('documents'),'ModyCrew','만든 문서'),loadWorkspace:()=>handleLocalMemoryMessage(null,{kind:'load_work_session_workspace'},createLocalMemoryOptions(null))}),
    generateText: (input) => handleMainAIProviderMessage(null, input),
    readMailReplySource: (input) => resolveMailReplySource(input, { app, safeStorage }),
    onWorkItemSettled: (settlement) => settleTasksForInboxWorkItem(settlement, createLocalMemoryOptions(null)),
    // 승인함 '원문 보고 다시 쓰기': 카드의 계정·메일 id 로 원래 메일(이전 대화 → 저장된 미리보기)을 읽고,
    // AI 내용 점검을 통과한 것만 써서 계정의 말투·서명으로 답장 초안을 만든다. 보내지 않는다.
    composeMailReplyFromSource: (input = {}) =>
      handleMailWorkIntakeMessage(null, {
        kind: "mail_draft",
        connectorId: input.connectorId,
        replyToMessageId: input.replyToMessageId,
        subject: input.subject,
        request: input.request,
      }, {
        app,
        dialog,
        safeStorage,
        loadMailReplySignature: loadAppProfileDisplayName,
        generateText: (payload) => handleMainAIProviderMessage(null, payload),
      }),
  };
}

/** 답장 서명의 '앱 프로필 이름' 방식: 사용자가 앱에 적어 둔 이름만 쓴다(없으면 서명 없음). */
async function loadAppProfileDisplayName() {
  const loaded = await handleLocalMemoryMessage(
    null,
    { kind: "load_app_profile" },
    createLocalMemoryOptions(null),
  ).catch(() => null);
  return String(loaded?.profile?.appSettings?.userDisplayName ?? "");
}

function createTriggerRunnerOptions(event = null) {
  // 답장 초안 서명: 메일 화면의 계정별 서명·말투 설정, '앱 프로필 이름' 방식이면 앱에 적어 둔 이름.
  const loadMailReplySignature = loadAppProfileDisplayName;
  return {
    app,
    onHealth: (state) => backgroundService.record("mail", state),
    shell,
    safeStorage,
    getScheduleOsNotificationStatus,
    listConnectorStatuses: () =>
      handleConnectorMessage(event, { kind: "list" }, { app, dialog, safeStorage }),
    showScheduleOsNotification,
    sendScheduleNotification: (input) =>
      sendTelegramScheduleNotification({ app, dialog, safeStorage }, input),
    requestDesktopControlAction: (input) =>
      handleDesktopControlMessage(
        event,
        { kind: "request", ...input },
        {
          dialog,
          appendInboxItems: appendAutomationInboxItems,
          upsertInboxItem: upsertAutomationInboxItem,
          getInboxSnapshot: getAutomationInboxSnapshot,
          captureScreenEvidence: (captureInput) =>
            captureDesktopScreenEvidence(captureInput, { desktopCapturer }),
          captureWebmailDomRows: (captureInput) =>
            captureWebmailDomRows(captureInput, { BrowserWindow }),
          enableLiveBrowserLimitedExecution: true,
          executeBrowserLimitedAction: (actionInput) =>
            executeBrowserLimitedAction(actionInput, { clipboard }),
        },
      ),
    recordActivity: (input = {}) =>
      handleSelectedWorkActionEventsMessage(
        event,
        {
          kind: "record",
          event: {
            ...input,
            workItemId: input.workItemId ?? "messenger-decision",
          },
        },
        { app },
      ),
    // 창을 닫아 둔 사이에 새로 들어온 것을 한 번 훑어 정리한다.
    // 기본은 꺼져 있고, 켜져 있어도 새 재료가 없으면 모델을 부르지 않는다.
    runBackgroundDigest: (input = {}) =>
      handleBackgroundDigestMessage(
        null,
        { kind: "run_if_due", ...input },
        createBackgroundDigestOptions(),
      ),
    // 자동 점검이 만든 업무 카드를 업무 원장에도 올린다(로컬 기억 폴더 안).
    mirrorTasks: (input = {}) =>
      handleLocalMemoryMessage(
        null,
        { kind: "upsert_tasks", tasks: Array.isArray(input.tasks) ? input.tasks : [] },
        createLocalMemoryOptions(null),
      ),
    loadMailReplySignature,
    // 새 메일 카드의 담당 AI 직원 고르기(읽기 전용): 직원 목록 + 기존 에이전트 조직 배정 규칙.
    loadTeammateRoster: async () =>
      (await handleLocalMemoryMessage(null, { kind: "load_app_profile" }, createLocalMemoryOptions(null)).catch(() => null))?.profile ?? null,
    routeWorkRequest: ({ requestText, allowedTeammateIds }) =>
      handleAgentOrgMessage(
        null,
        { kind: "route_work_request", requestText, allowedTeammateIds },
        { app, dialog, BrowserWindow, shell, repoRoot },
      ),
    // 선택 기능(기본 꺼짐, 메일 규칙의 aiReplyDrafts): 창을 닫아 둬도 새 업무 메일 몇 통에
    // AI 답장 초안을 미리 써 둔다. 초안만 바꾸고 보내지 않는다 — 발송은 승인함 마지막 확인에서만.
    prepareReplyDrafts: (input = {}) =>
      generateGuardedReplyDrafts(
        null,
        {
          workReport: input.workReport,
          providerReads: Array.isArray(input.providerReads) ? input.providerReads : [],
        },
        {
          app,
          safeStorage,
          repoRoot,
          domainEntryPath,
          maxCandidates: input.maxCandidates,
          generateText: (payload) => handleMainAIProviderMessage(null, payload),
          loadMailReplySignature,
        },
      ),
  };
}

/**
 * 배경 정리 옵션. generateText 가 이 앱에서 모델로 가는 유일한 문
 * (mody.ai-provider.v1 핸들러)을 main 안에서 직접 부르는 자리다 —
 * handleMainAIProviderMessage 는 event 를 읽지 않으므로 null 로 부를 수 있고,
 * agentRunContext 를 넣지 않으므로 실행 원장 계약도 건드리지 않는다.
 */
function createBackgroundDigestOptions() {
  return {
    app,
    repoRoot,
    domainEntryPath,
    generateText: (payload) => handleMainAIProviderMessage(null, payload),
  };
}

ipcMain.handle("mody.background-digest.v1", (event, payload) =>
  handleBackgroundDigestMessage(event, payload, createBackgroundDigestOptions()),
);

function createWorkSyncOptions(event = null) {
  return {
    listConnectorStatuses: () =>
      handleConnectorMessage(event, { kind: "list" }, { app, dialog, safeStorage }),
    pullPublicTriggerRelay: () =>
      handlePublicTriggerRelayMessage(event, { kind: "pull" }, { app, safeStorage }),
    runTriggerDueChecks: (input = {}) =>
      handleTriggerRunnerMessage(
        event,
        {
          kind: "run_due_checks",
          force: true,
          triggeredBy: input.triggeredBy ?? "work-sync",
          suppressExternalNotifications: input.suppressExternalNotifications === true,
        },
        createTriggerRunnerOptions(event),
      ),
    runMailWorkIntake: (input = {}) =>
      handleMailWorkIntakeMessage(
        event,
        { kind: "run", limit: input.limit ?? 10, activityEventId: input.activityEventId },
        {
          app,
          dialog,
          safeStorage,
          recordActivity: (activity = {}) =>
            handleSelectedWorkActionEventsMessage(event, { kind: "record", event: activity }, { app }),
          saveWorkLearning: (learning = {}) =>
            handleLocalMemoryMessage(event, { kind: "save_work_learning", ...learning }, { app }),
        },
      ),
    getInboxSnapshot: getAutomationInboxSnapshot,
    recordActivity: (input = {}) =>
      handleSelectedWorkActionEventsMessage(
        event,
        {
          kind: "record",
          event: {
            ...input,
            workItemId: input.workItemId ?? "work-sync-today",
          },
        },
        { app },
      ),
  };
}

/**
 * 알림을 눌렀을 때. 이미 떠 있는 창은 다시 불러오지 않는다 — 다시 불러오면 작성 중인 글과
 * 만들고 있던 AI 답변이 사라진다. 대신 창을 앞으로 가져오고 화면 안에서 그 카드로 옮긴다.
 * 승인함 카드·맡긴 업무는 업무 오피스 창(승인함·업무판)으로, 일정 브리핑은 본창으로 간다.
 */
async function focusScheduleNotificationTarget(input = {}) {
  const workItemId = sanitizeWorkItemId(input.workItemId);
  const queueFilter = notificationQueueFilterForInput(input);
  const focusTarget = classifyNotificationFocusTarget({ workItemId, queueFilter, focusKind: input.focusKind });
  if (focusTarget === "office_task") {
    await focusOfficeTask(workItemId);
    return;
  }
  if (workItemId && focusTarget === "office") {
    await focusOfficeApproval(workItemId);
    return;
  }

  const mainWindowExisted = isLiveWindow(mainWindowRef);
  // 본창이 없으면 이 호출 안에서 바로 만들어진다(첫 await 전). 그 창에 요청을 맡겨 두면
  // 화면이 뜨자마자 가져간다.
  const shown = showMainWindow();
  const plan = workItemId
    ? deliverWorkItemFocus(mainWindowRef, { workItemId, queue: queueFilter }, { windowJustCreated: !mainWindowExisted })
    : "none";
  const win = await shown;
  if (!win || plan !== "load_url") return;
  try {
    await win.loadURL(createWorkItemFocusUrl(workItemId, queueFilter));
  } catch (error) {
    console.warn(`[modycrew-notification] focus failed: ${String(error?.message ?? error)}`);
  }
}

function createWorkItemFocusUrl(workItemId, queueFilter = "") {
  const params = new URLSearchParams();
  params.set("workItem", workItemId);
  const safeQueueFilter = sanitizeQueueFilter(queueFilter);
  if (safeQueueFilter) params.set("queue", safeQueueFilter);
  // 일정 브리핑은 본창의 업무 패널 안에 보이므로 그 패널을 함께 연다.
  if (workItemId.includes("schedule-briefing") || safeQueueFilter === "meeting") params.set("panel", "office");
  const query = params.toString();
  if (target.mode === "dev") {
    const separator = target.devUrl.includes("?") ? "&" : "?";
    return `${target.devUrl}${separator}${query}`;
  }
  if (target.mode === "prod") return `modycrew://app/?${query}`;
  return "data:text/html;charset=utf-8," + encodeURIComponent("ModyCrew web build is required.");
}

function notificationQueueFilterForInput(input = {}) {
  const explicit = sanitizeQueueFilter(input.queueFilter);
  if (explicit) return explicit;
  const ruleId = sanitizeNotificationLine(input.ruleId, "");
  if (ruleId === "urgent-deadline-watch") return "deadline";
  if (ruleId === "meeting-reminder-watch") return "meeting";
  if (ruleId === "daily-weekly-schedule-briefing") return "meeting";
  return "";
}

function sanitizeQueueFilter(value) {
  const text = String(value ?? "").trim();
  if (text === "approval" || text === "deadline" || text === "meeting" || text === "today") return text;
  return "";
}

function sanitizeWorkItemId(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9:_./-]/g, "")
    .slice(0, 180);
}

function getScheduleOsNotificationStatus(input = {}) {
  if (!Notification?.isSupported?.()) {
    return {
      status: "not_supported",
      label: "OS 알림 미지원",
      userMessage: "현재 Electron/OS 환경에서는 데스크톱 알림을 사용할 수 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const permission = sanitizeNotificationLine(input.browserNotificationPermission, "");
  if (permission === "granted") {
    return {
      status: "granted",
      label: process.platform === "win32" ? "Windows 알림 허용됨" : "OS 알림 허용됨",
      userMessage: "데스크톱 알림 권한이 허용되어 켠 일정 규칙의 알림을 표시할 수 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (permission === "denied") {
    return {
      status: "blocked",
      label: process.platform === "win32" ? "Windows 알림 차단됨" : "OS 알림 차단됨",
      userMessage:
        process.platform === "win32"
          ? "Windows 설정에서 ModyCrew 알림을 허용해야 일정 알림이 표시됩니다."
          : "시스템 설정에서 ModyCrew 알림을 허용해야 일정 알림이 표시됩니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (permission === "default") {
    return {
      status: "request_required",
      label: "권한 요청 필요",
      userMessage: "첫 일정 알림을 표시할 때 OS 알림 권한 확인이 필요합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  return {
    status: "supported",
    label: process.platform === "win32" ? "Windows 알림 사용 가능" : "데스크톱 알림 사용 가능",
    userMessage:
      process.platform === "win32"
        ? "첫 일정 알림 때 Windows 알림 센터에 표시됩니다. 보이지 않으면 Windows 설정의 알림 권한을 확인하세요."
        : "첫 일정 알림 때 OS 알림 센터에 표시됩니다. 보이지 않으면 시스템 알림 권한을 확인하세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeNotificationLine(value, fallback) {
  const text = String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return text || fallback;
}

function sanitizeTrayLabel(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42) || "대기 중";
}

function resolveTrayIconPath() {
  const candidates = [
    process.platform === "win32" && process.resourcesPath ? path.join(process.resourcesPath, "icons", "modycrew-logo.ico") : "",
    process.resourcesPath ? path.join(process.resourcesPath, "icons", "modycrew-logo-256.png") : "",
    process.resourcesPath ? path.join(process.resourcesPath, "web", "modycrew-logo-256.png") : "",
    path.join(repoRoot, "apps", "modycrew-desktop", "build", "modycrew-logo-256.png"),
    path.join(repoRoot, "apps", "modycrew-desktop", "build", "modycrew-logo.ico"),
    path.join(repoRoot, "apps", "modycrew-web", "public", "modycrew-logo-256.png"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsPath(candidate)) ?? candidates[candidates.length - 1];
}

function resolveWindowFrameIconPath() {
  const packagedIconRoot = process.resourcesPath ? path.join(process.resourcesPath, "icons") : "";
  const windowsCandidates = [
    packagedIconRoot ? path.join(packagedIconRoot, "modycrew-logo.ico") : "",
    path.join(repoRoot, "apps", "modycrew-desktop", "build", "modycrew-logo.ico"),
  ];
  const sharedCandidates = [
    packagedIconRoot ? path.join(packagedIconRoot, "modycrew-logo-256.png") : "",
    process.resourcesPath ? path.join(process.resourcesPath, "web", "modycrew-logo-256.png") : "",
    path.join(repoRoot, "apps", "modycrew-desktop", "build", "modycrew-logo-256.png"),
    path.join(repoRoot, "apps", "modycrew-web", "public", "modycrew-logo-256.png"),
  ];
  const candidates = (process.platform === "win32"
    ? [...windowsCandidates, ...sharedCandidates]
    : [...sharedCandidates, ...windowsCandidates]
  ).filter(Boolean);
  return candidates.find((candidate) => existsPath(candidate)) ?? candidates[candidates.length - 1];
}

function resolveWindowsTaskbarIconPath() {
  const packagedIconRoot = process.resourcesPath ? path.join(process.resourcesPath, "icons") : "";
  const windowsCandidates = [
    packagedIconRoot ? path.join(packagedIconRoot, "modycrew-logo.ico") : "",
    path.join(repoRoot, "apps", "modycrew-desktop", "build", "modycrew-logo.ico"),
    packagedIconRoot ? path.join(packagedIconRoot, "modycrew-logo-256.png") : "",
  ];
  const sharedCandidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "web", "modycrew-logo-256.png") : "",
    path.join(repoRoot, "apps", "modycrew-desktop", "build", "modycrew-logo-256.png"),
    path.join(repoRoot, "apps", "modycrew-web", "public", "modycrew-logo-256.png"),
  ];
  const candidates = (process.platform === "win32" ? [...windowsCandidates, ...sharedCandidates] : sharedCandidates)
    .filter(Boolean);
  return candidates.find((candidate) => existsPath(candidate)) ?? candidates[candidates.length - 1];
}

function applyWindowIcon(win) {
  if (!win || typeof win.setIcon !== "function") return;
  const frameIconPath = resolveWindowFrameIconPath();
  const taskbarIconPath = process.platform === "win32" ? resolveWindowsTaskbarIconPath() : frameIconPath;
  const frameIcon = nativeImage?.createFromPath?.(frameIconPath);
  if (frameIcon && !frameIcon.isEmpty?.()) {
    win.setIcon(frameIcon);
  }
  applyWindowsTaskbarDetails(win, taskbarIconPath);
}

function applyWindowsTaskbarDetails(win, iconPath) {
  if (process.platform !== "win32" || !win || typeof win.setAppDetails !== "function") return;
  win.setAppDetails({
    appId: windowsAppUserModelId,
    appIconPath: iconPath,
    appIconIndex: 0,
    relaunchCommand: process.execPath,
    relaunchDisplayName: "ModyCrew",
  });
}

function existsPath(filePath) {
  try {
    return Boolean(filePath) && nativeImage?.createFromPath?.(filePath)?.isEmpty?.() === false;
  } catch {
    return false;
  }
}

// 4) 메뉴를 기본 OS 메뉴로 (V2 가 자체 메뉴 가짐)
Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  // 0) 인박스 상태 복원 — 저장된 자동화 업무 카드를 디스크에서 불러옵니다.
  //    이후 모든 인박스 변경은 자동으로 디스크에 저장됩니다.
  try {
    configureInboxStorage({ app });
  } catch (error) {
    console.error("[inbox] 저장소 초기화 실패:", error);
  }
  configureInboxWorkItemHooks(createInboxWorkItemHooks());

  // 3) Custom protocol handler 등록 — Next.js static export 의 절대경로를
  //    packaged web 폴더 기준으로 다시 매핑합니다. (file:// 흰 화면 문제 해결)
  if (target.mode === "prod" && target.webRoot) {
    const webRoot = target.webRoot;
    protocol.handle("modycrew", async (request) => {
      try {
        const url = new URL(request.url);
        let pathname = decodeURIComponent(url.pathname);

        // 경로 정상화 + path traversal 방어
        if (pathname.includes("..")) {
          return new Response("forbidden", { status: 403 });
        }

        const nextAssetIndex = pathname.indexOf("/_next/");
        if (nextAssetIndex >= 0) {
          pathname = pathname.slice(nextAssetIndex + 1);
        }

        // trailing slash 또는 빈 path → index.html
        if (pathname.endsWith("/") || pathname === "") {
          pathname = `${pathname}index.html`;
        } else if (!path.extname(pathname)) {
          pathname = `${pathname}/index.html`;
        }

        const filePath = path.normalize(path.join(webRoot, pathname));

        // webRoot 밖 차단
        if (!filePath.startsWith(path.normalize(webRoot))) {
          return new Response("forbidden", { status: 403 });
        }

        const response = await net.fetch(pathToFileURL(filePath).href);
        // Next static-export navigation requests index.txt with RSC: 1. A text/plain
        // response forces a full reload and discards the open workspace side panel.
        if (request.headers.get('rsc') === '1' && path.extname(filePath) === '.txt' && response.ok) {
          const headers = new Headers(response.headers);
          headers.set('Content-Type', 'text/x-component; charset=utf-8');
          return new Response(response.body, { status: response.status, headers });
        }
        return response;
      } catch (err) {
        console.warn(`[modycrew-protocol] error: ${String(err?.message ?? err)}`);
        return new Response("not found", { status: 404 });
      }
    });
    console.log(`[modycrew-desktop] protocol handler 등록됨 — root: ${webRoot}`);
  }

  // PC 켤 때 자동 시작(--hidden)이면 창 없이 트레이로만 시작한다. 배경 점검·업무 실행기는
  // 아래에서 똑같이 돈다. 트레이나 알림을 누르면 그때 본창을 만든다.
  installAppScreenPermissionPolicy();
  if (!launchedHidden) void createMainWindow();
  startTrayWhenReady();
  // MODY 비서는 트레이 아이콘이 준비되지 않아도(아이콘 파일 누락·알림 영역 제한) 시작한다. start()는 한 번만 돈다.
  getAssistantSecretary()?.start();
  // 배경 실행기(폴더 학습 감시·업무 실행기·회사 운영 실행기)는 창이 먼저 뜨고 첫 화면을
  // 그린 뒤에 시작한다. 예전엔 창 생성과 같은 순간에 한꺼번에 시작해(도메인 모듈 컴파일
  // ~0.3초, 폴더 전체 해시 등) 켠 직후 몇 초간 첫 클릭과 대화 목록 로딩이 둔했다.
  const backgroundRuntimeStartTimer = setTimeout(() => {
    if (app.isPackaged && hasPackagedSingleInstanceLock) {
      void getAutomaticModelMaintenance().then(service => service.start()).catch(() => {
        console.warn("[model-maintenance] 모델 검증 상태를 읽지 못해 기존 설정을 보존했습니다.");
      });
    }
    try {
      void getDocumentLearningSupervisor().start().catch((error) => {
        console.error("[document-learning-supervisor] 시작 실패:", error);
      });
    } catch (error) {
      console.error("[document-learning-supervisor] 초기화 실패:", error);
    }
    void getTaskExecutionRunner().start().catch((error) => { backgroundService.record("tasks", "error"); console.error("[task-execution] startup failed:", error?.message); });
    void getCompanyAutomationRuntime().start().catch(() => { backgroundService.record("company", "error"); console.error("[company-automation] 회사 운영 실행기를 시작하지 못했습니다."); });
  }, 2_500);
  backgroundRuntimeStartTimer.unref?.();
  // 개발 도구 시작 점검: 첫 화면과 배경 실행기가 자리 잡은 뒤 한 번. 결과는 userData/toolchain/toolchain-manifest.json
  const toolchainStartupTimer = setTimeout(() => {
    void ensureToolchainOnStartup({ app }).catch((error) => console.warn("[toolchain] 시작 점검 실패:", error?.message ?? error));
  }, 12_000);
  toolchainStartupTimer.unref?.();
  // 트리거 실행기는 원래 첫 점검을 10초 뒤에 하므로 그대로 둔다.
  stopTriggerRunner = startTriggerRunnerLoop(createTriggerRunnerOptions(null));
  try { backgroundService.setKeepAwake(presencePreferences().keepAwake); } catch (error) {
    console.warn("[background-service] 절전 방지 설정 실패:", error?.message);
  }
  powerMonitor?.on("suspend", () => backgroundService.suspend());
  powerMonitor?.on("resume", () => {
    void backgroundService.resume();
    getAssistantSecretary()?.requestTick("resume");
    if (app.isPackaged && hasPackagedSingleInstanceLock) void getAutomaticModelMaintenance().then(service => service.check()).catch(() => {});
  });
  // 첫 창 생성 후 자동 업데이트 폴링 시작 (packaged 환경에서만 동작)
  setTimeout(() => {
    subscribeAutoUpdaterState(handleAutoUpdaterStateForShell);
    void startAutoUpdater({ app });
  }, 3000);
  // 비정상 종료로 남은 1시간 넘은 임시 파일(*.tmp)만 정리한다. 첫 화면과 배경 실행기가
  // 자리 잡은 뒤, 비동기로, 훑는 개수에 상한을 두고 한 번 돈다.
  const staleTempCleanupTimer = setTimeout(() => {
    void (async () => {
      const { cleanupLeftoverInstallerCopies, cleanupStaleTempFiles, resolveStaleTempCleanupTargets } = await import("./stale-temp-cleanup.mjs");
      const { resolveLocalMemoryWorkspaceIntelligenceRoot } = await import("./local-memory-handler.mjs");
      // 기억 폴더 위치는 기억 저장소와 같은 규칙으로 찾는다(<root>/memory/intelligence/<id>).
      const memoryRoot = path.resolve(resolveLocalMemoryWorkspaceIntelligenceRoot({ app }), "..", "..", "..");
      const summary = await cleanupStaleTempFiles(
        resolveStaleTempCleanupTargets({ userDataPath: app.getPath("userData"), memoryRoot }),
      );
      if (summary.deletedCount > 0) {
        console.log(`[stale-temp-cleanup] 남은 임시 파일 ${summary.deletedCount}개(${summary.deletedBytes} bytes)를 정리했습니다.`);
      }
      // 공개 설치 파일이 임시 폴더에 남긴 설치기 복사본(약 400MB)도 설치가 끝난 뒤 여기서 지운다.
      const installerCopies = await cleanupLeftoverInstallerCopies({ tempDir: app.getPath("temp") });
      if (installerCopies.deletedCount > 0) {
        console.log(`[stale-temp-cleanup] 남은 설치기 복사본 ${installerCopies.deletedCount}개(${installerCopies.deletedBytes} bytes)를 정리했습니다.`);
      }
      // 설치가 빨리 끝나 폴더가 방금 만들어졌거나 설치기가 아직 끝나는 중이라 잠겨 있었으면, 몇 분 뒤 한 번 더 본다.
      // 이 한 번을 놓치면 400MB 가 다음 앱 실행까지 남는다.
      if (installerCopies.pendingCount > 0) {
        const installerCopyRetryTimer = setTimeout(() => {
          void cleanupLeftoverInstallerCopies({ tempDir: app.getPath("temp") }).then((retry) => {
            if (retry.deletedCount > 0) {
              console.log(`[stale-temp-cleanup] 남은 설치기 복사본 ${retry.deletedCount}개(${retry.deletedBytes} bytes)를 다시 확인해 정리했습니다.`);
            }
          }).catch((error) => {
            console.warn("[stale-temp-cleanup] 설치기 복사본 재확인을 건너뜀:", error?.message ?? error);
          });
        }, 3 * 60_000);
        installerCopyRetryTimer.unref?.();
      }
    })().catch((error) => {
      console.warn("[stale-temp-cleanup] 임시 파일 정리를 건너뜀:", error?.message ?? error);
    });
  }, 30_000);
  staleTempCleanupTimer.unref?.();

  app.on("activate", () => {
    void showMainWindow();
  });
});

app.on("before-quit", () => {
  isExplicitQuit = true;
  automaticModelMaintenanceRef?.stop();
  stopTriggerRunner?.();
  backgroundService.stop();
  taskExecutionRunner?.stop();
  companyAutomationRuntime?.stop();
  void documentLearningSupervisorRef?.stop?.();
  void stopActiveTriggerWebhookServer();
});

app.on("window-all-closed", () => {
  if (isExplicitQuit && process.platform !== "darwin") {
    app.quit();
  }
});
