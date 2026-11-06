import { createHash } from "node:crypto";
import { classifyMailRow, isWorkCardNoise } from "./mail-category.mjs";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  loadConnectorWorkflowContext,
  loadSiteLoginConnectorReferences,
  loadSlackCommandContext,
  loadTelegramCommandContext,
} from "./connector-handler.mjs";
import {
  appendAutomationInboxItems,
  applyChannelDecisionToInbox,
  getAutomationInboxSnapshot,
  upsertAutomationInboxItem,
} from "./inbox-handler.mjs";
import { createJevMailWorkReport, isJevMailEnabled } from "./jev-mail-handler.mjs";
import {
  cleanOutgoingMailBody,
  createMailWorkCardId,
  readHiddenReplyToAddress,
  resolveOriginalMailSubject,
  sanitizeRfcMessageIdField,
  stripInternalDraftLabelLine,
} from "./mail-header-utils.mjs";
import { appendMailSignature, createMailSignatureResolver, mailAccountKeyFrom } from "./mail-writing-profile.mjs";
import { mergeAiReplyDraftsIntoExistingCards } from "./mail-draft-card-merge.mjs";
import {
  assignMailCandidatesToTeammates,
  mailCardTriageFields,
  sortMailCandidatesByPriority,
} from "./mail-card-assignment.mjs";
import { listTriggerSettings } from "./trigger-settings-handler.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..", "..", "..");
const stateFileName = "trigger-runner-state.json";
const reportFileName = "trigger-runner-latest-report.md";
const maxSeenCursorsPerRule = 240;
// 메일 규칙을 처음 켤 때, 켜기 직전 이 시간 안에 온 메일은 아직 처리하지 않았을 수 있어 새 메일로 본다.
// 그보다 오래된 메일은 이미 사용자가 본 것으로 보고 카드 없이 "본 메일"로만 기록한다.
const firstRunRecentMailGraceMs = 30 * 60_000;
// 배경 AI 답장 초안(선택 기능)이 한 번 점검에 쓰는 최대 메일 수.
const backgroundReplyDraftMaxCandidates = 3;

function resolveResourcePath(...segments) {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, ...segments);
    if (existsSync(packaged)) return packaged;
  }
  return null;
}

const domainEntryPath =
  resolveResourcePath("domain", "index.js") ??
  path.join(repoRoot, "packages", "domain", "dist", "index.js");

let domainModulePromise;
let loopRunning = false;
const stateOperations = new Map();
const dueOperations = new Map();

function serializeStateOperation(options, operation) {
  const key = path.resolve(statePath(options));
  const previous = stateOperations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  const settled = next.finally(() => {
    if (stateOperations.get(key) === settled) stateOperations.delete(key);
  });
  stateOperations.set(key, settled);
  return settled;
}

async function loadDomainRuntime() {
  if (!existsSync(domainEntryPath)) {
    throw new Error(`ModyCrew domain runtime was not found: ${domainEntryPath}`);
  }
  domainModulePromise ??= import(pathToFileURL(domainEntryPath).href);
  return domainModulePromise;
}

export async function handleTriggerRunnerMessage(_event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");

  if (kind === "status") {
    return getTriggerRunnerStatus(options);
  }

  if (kind === "notification_status") {
    return getScheduleNotificationStatus(options, payload);
  }

  if (kind === "request_notification_permission") {
    return requestScheduleNotificationPermission(options, payload);
  }

  if (kind === "run_due_checks") {
    return runDueTriggerChecks(options, {
      force: Boolean(payload.force),
      triggeredBy: String(payload.triggeredBy ?? "manual"),
      suppressExternalNotifications: payload.suppressExternalNotifications === true,
    });
  }

  if (kind === "open_latest_report") {
    return openLatestTriggerRunnerReport(options);
  }

  if (kind === "dispatch_event") {
    return serializeStateOperation(options, () => dispatchTriggerEvent(payload.event ?? payload, options));
  }

  throw new Error(`unsupported trigger-runner kind: ${kind}`);
}

export function startTriggerRunnerLoop(options = {}) {
  const intervalMs = Math.max(Number(options.intervalMs ?? 60_000) || 60_000, 30_000);
  const firstDelayMs = Math.max(Number(options.firstDelayMs ?? 10_000) || 10_000, 2_000);

  async function tick() {
    if (loopRunning) return;
    loopRunning = true;
    options.onHealth?.("checking");
    try {
      await runDueTriggerChecks(options, { force: false, triggeredBy: "background_loop" });
      options.onHealth?.("ready");
    } catch (error) {
      options.onHealth?.("error");
      console.warn(`[mody.trigger-runner] background check failed: ${String(error?.message ?? error)}`);
    } finally {
      loopRunning = false;
    }
  }

  const firstTimer = setTimeout(tick, firstDelayMs);
  const interval = setInterval(tick, intervalMs);
  firstTimer.unref?.();
  interval.unref?.();

  return () => {
    clearTimeout(firstTimer);
    clearInterval(interval);
  };
}

async function getTriggerRunnerStatus(options) {
  const [settings, state] = await Promise.all([listTriggerSettings(options), readState(options)]);
  return {
    status: "trigger_runner_status_ready",
    running: loopRunning,
    enabledRuleCount: settings.rules.filter((rule) => rule.enabled).length,
    latestReport: sanitizeLatestReport(state.latestReport),
    latestMailAutomationReport: sanitizeLatestReport(state.latestMailAutomationReport),
    mailAutomationHistory: sanitizeMailAutomationHistory(state.mailAutomationHistory),
    mailAutomationEvidenceWindow: summarizeMailAutomationEvidenceWindow(state.mailAutomationHistory),
    userMessage: state.latestReport
      ? `마지막 자동 확인: ${state.latestReport.userMessage}`
      : "아직 자동 확인 실행 기록이 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function openLatestTriggerRunnerReport(options = {}) {
  const filePath = reportPath(options);
  if (!existsSync(filePath)) {
    return {
      status: "trigger_runner_report_missing",
      reportPath: filePath,
      userMessage: "아직 열 수 있는 반복 업무 실행 로그가 없습니다. 먼저 반복 업무 점검을 실행해 주세요.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  if (typeof options.shell?.openPath !== "function") {
    return {
      status: "trigger_runner_report_open_unavailable",
      reportPath: filePath,
      userMessage: `실행 로그 위치: ${filePath}`,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  const openError = await options.shell.openPath(filePath);
  return {
    status: openError ? "trigger_runner_report_open_failed" : "trigger_runner_report_opened",
    reportPath: filePath,
    userMessage: openError
      ? `실행 로그를 자동으로 열지 못했습니다. 위치: ${filePath}`
      : "반복 업무 실행 로그를 열었습니다.",
    errorMessage: openError || undefined,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function getScheduleNotificationStatus(options = {}, payload = {}) {
  const [settings, connectorList] = await Promise.all([
    listTriggerSettings(options),
    typeof options.listConnectorStatuses === "function"
      ? options.listConnectorStatuses()
      : Promise.resolve({ status: "connector_status_unavailable", connectors: [] }),
  ]);
  const scheduleRules = settings.rules.filter(isScheduleBriefingRule);
  const os = normalizeOsNotificationStatus(
    typeof options.getScheduleOsNotificationStatus === "function"
      ? options.getScheduleOsNotificationStatus({
          browserNotificationPermission: payload.browserNotificationPermission,
        })
      : {
          status: "unknown",
          label: "확인 필요",
          userMessage: "데스크톱 알림 상태를 확인할 수 없습니다.",
        },
  );
  const telegramRecord = (connectorList.connectors ?? []).find((record) => record.connectorId === "telegram-bot");
  const telegramConnected = isTelegramNotificationConnected(telegramRecord);
  const telegram = {
    status: telegramConnected ? "connected" : "needs_connection",
    connected: telegramConnected,
    connectorStatus: sanitizeText(telegramRecord?.status ?? "missing"),
    label: telegramConnected ? "Telegram 연결됨" : "Telegram 연결 필요",
    userMessage: telegramConnected
      ? "Telegram Bot과 chat_id가 준비되어 켠 규칙의 일정 알림을 받을 수 있습니다."
      : "Telegram 일정 알림을 받으려면 Bot token과 chat_id를 연결해야 합니다.",
  };
  const enabledChannelCount = scheduleRules.reduce(
    (total, rule) =>
      total +
      (rule.notificationChannels?.os === true ? 1 : 0) +
      (rule.notificationChannels?.telegram === true ? 1 : 0),
    0,
  );

  return {
    status: "schedule_notification_status_ready",
    os,
    telegram,
    scheduleRuleCount: scheduleRules.length,
    enabledChannelCount,
    userMessage:
      enabledChannelCount > 0
        ? `일정 알림 채널 ${enabledChannelCount}개가 켜져 있습니다.`
        : "일정 알림은 기본 앱 인박스만 사용 중입니다. 필요한 채널만 켜세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function requestScheduleNotificationPermission(options = {}, payload = {}) {
  const result = await getScheduleNotificationStatus(options, payload);
  return {
    ...result,
    status: "schedule_notification_permission_checked",
    requestedAt: nowIso(options),
    userMessage: result.os.canNotify
      ? "OS 알림 권한이 확인되었습니다. 켠 일정 규칙의 마감/미팅 알림을 데스크톱으로 받을 수 있습니다."
      : result.os.userMessage,
  };
}

function normalizeOsNotificationStatus(value = {}) {
  const status = sanitizeText(value.status ?? "unknown");
  if (status === "granted" || status === "permission_granted") {
    return {
      status: "granted",
      label: sanitizeText(value.label ?? "OS 알림 허용됨"),
      canNotify: true,
      userMessage: sanitizeText(value.userMessage ?? "데스크톱 알림 권한이 허용되어 일정 알림을 표시할 수 있습니다."),
    };
  }
  if (status === "blocked" || status === "denied" || status === "permission_denied") {
    return {
      status: "blocked",
      label: sanitizeText(value.label ?? "OS 알림 차단됨"),
      canNotify: false,
      userMessage: sanitizeText(value.userMessage ?? "시스템 알림 권한이 차단되어 있습니다. OS 설정에서 알림을 허용해야 합니다."),
    };
  }
  if (status === "request_required" || status === "default" || status === "permission_default") {
    return {
      status: "request_required",
      label: sanitizeText(value.label ?? "권한 요청 필요"),
      canNotify: false,
      userMessage: sanitizeText(value.userMessage ?? "첫 알림 표시 전에 OS 알림 권한 확인이 필요합니다."),
    };
  }
  if (status === "supported" || status === "ready" || status === "needs_first_notification") {
    return {
      status: "supported",
      label: sanitizeText(value.label ?? "OS 알림 사용 가능"),
      canNotify: true,
      userMessage: sanitizeText(value.userMessage ?? "첫 일정 알림 때 Windows/macOS 알림 센터에 표시합니다."),
    };
  }
  if (status === "not_supported" || status === "unsupported" || status === "os_notification_not_supported") {
    return {
      status: "not_supported",
      label: sanitizeText(value.label ?? "OS 알림 미지원"),
      canNotify: false,
      userMessage: sanitizeText(value.userMessage ?? "현재 환경에서는 데스크톱 알림을 사용할 수 없습니다."),
    };
  }
  return {
    status: "unknown",
    label: sanitizeText(value.label ?? "확인 필요"),
    canNotify: false,
    userMessage: sanitizeText(value.userMessage ?? "데스크톱 앱에서 알림 가능 여부를 다시 확인해야 합니다."),
  };
}

function isTelegramNotificationConnected(record) {
  if (!record) return false;
  if (record.permissions?.messengerReport === true) return true;
  return [
    "telegram_command_inbox_ready",
    "telegram_connected",
    "schedule_notification_ready",
    "connector_ready",
    "connected",
    "ready",
  ].includes(String(record.status ?? ""));
}

function runDueTriggerChecks(options = {}, input = {}) {
  const key = `${path.resolve(statePath(options))}:${Boolean(input.force)}:${Boolean(input.suppressExternalNotifications)}`;
  if (dueOperations.has(key)) return dueOperations.get(key);
  const operation = serializeStateOperation(options, () => runDueTriggerChecksOnce(options, input));
  const settled = operation.finally(() => { if (dueOperations.get(key) === settled) dueOperations.delete(key); });
  dueOperations.set(key, settled);
  return settled;
}

async function runDueTriggerChecksOnce(options = {}, input = {}) {
  const now = nowIso(options);
  const settings = await listTriggerSettings(options);
  const enabledRules = settings.rules.filter((rule) => rule.enabled);
  const state = await readState(options);
  const dueRules = enabledRules.filter((rule) => isRuleDue(rule, state.rules?.[rule.id], now, input.force));

  if (dueRules.length === 0) {
    const latestReport = {
      id: `trigger_runner_idle_${compactDate(now)}`,
      status: "trigger_runner_idle",
      createdAt: now,
      triggeredBy: input.triggeredBy ?? "manual",
      dueRuleCount: 0,
      signalsProcessed: 0,
      queuedWorkItemsCount: 0,
      providerReadCount: 0,
      messengerCommandCount: 0,
      userMessage: "지금 확인할 자동 작동 규칙은 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
    state.latestReport = latestReport;
    state.updatedAt = now;
    await writeState(options, state);
    return {
      status: "trigger_runner_idle",
      report: latestReport,
      userMessage: latestReport.userMessage,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const connectorContext = needsConnectorRead(dueRules)
    ? await (options.loadConnectorWorkflowContext ?? loadConnectorWorkflowContext)(options, {})
    : createEmptyConnectorContext();
  const messengerCommandReads = await loadMessengerCommandReads({
    rules: dueRules,
    state,
    options,
  });
  const providerReads = connectorContext.providerReads ?? [];
  const siteLoginConnectorReferences = await loadSiteLoginConnectorReferences(options);
  const webmailFallbackResults = await runWebmailFallbackChecks({
    rules: dueRules,
    providerReads,
    siteLoginConnectorReferences,
    options,
    now,
  });
  const {
    signals,
    newMessageIds,
    nextRuleStates,
    newMailSignalCount,
    duplicateMailSuppressedCount,
    firstRunSkippedMailCount,
  } = createSignalsFromDueRules({
    rules: dueRules,
    providerReads,
    messengerCommandReads,
    state,
    now,
  });
  const domainReport = await createConnectedTriggerReport(dueRules, signals, now);
  const providerReadsForAiReview = filterProviderReadsBySignalCursors({
    reads: providerReads,
    signals,
    rules: dueRules,
    allowedActionPolicy: "queue_ai_review",
  });
  const providerIntakeReport = newMessageIds.size > 0 && providerReadsForAiReview.length > 0
    ? await createProviderIntakeReport(providerReadsForAiReview, now, options)
    : null;
  // 새 메일 카드마다 맡을 AI 직원을 붙인다(카드 표시·답장 초안 말투용). 보내거나 실행하지 않는다.
  // 직원 목록·배정이 실패하면 메인 비서가 맡는다.
  if (providerIntakeReport) {
    await assignMailCandidatesToTeammates(providerIntakeReport, options).catch(() => null);
  }
  // 선택 기능(기본 꺼짐): 켜 두면 새 업무 메일 몇 통에 AI 답장 초안을 미리 써 둔다.
  // 초안만 바꿀 뿐 보내지 않는다. 실패하면 규칙 초안을 그대로 둔다.
  const replyDraftPreparation = await prepareBackgroundReplyDrafts({
    rules: dueRules,
    report: providerIntakeReport,
    providerReads: providerReadsForAiReview,
    options,
  });
  const messengerCommandInboxItems = await mapMessengerCommandSignalsToInboxItems(
    signals.filter((signal) => signal.triggerKind === "messenger_command"),
    now,
  );
  const messengerSignalIds = new Set(
    signals
      .filter((signal) => signal.triggerKind === "messenger_command")
      .map((signal) => signal.id),
  );
  // 메일 한 통 = 승인 카드 한 장. 업무팩 점검이 이미 다룬 메일에는 신호 카드(trigger:)를 따로 만들지 않는다.
  const providerIntakeCursors = createProviderIntakeCursorSet(providerIntakeReport, providerReadsForAiReview);
  const signalCursorById = new Map(signals.map((signal) => [signal.id, signal.cursor]));
  const domainWorkItems = domainReport.workItems.filter((item) => {
    const signalId = signalIdForWorkItem(item);
    if (messengerSignalIds.has(signalId)) return false;
    return !providerIntakeCursors.has(signalCursorById.get(signalId));
  });
  // 서명은 카드로 옮길 때 메일을 받은 계정 기준으로 붙인다(계정마다 명함·서명 없음이 다를 수 있다).
  const signatureFor = await createMailSignatureResolver(options).catch(() => null);
  const providerMailInboxItems = mapProviderCandidatesToInboxItems(providerIntakeReport, now, providerReadsForAiReview, { signatureFor });
  const webmailFallbackInboxItems = mapWebmailFallbackResultsToInboxItems(webmailFallbackResults, now);
  const inboxItemsBeforeBriefing = [
    ...providerMailInboxItems,
    ...messengerCommandInboxItems,
    ...webmailFallbackInboxItems,
    ...mapTriggerWorkItemsToInboxItems(domainWorkItems, now, signals, dueRules),
  ];
  const scheduleBriefingResult = await createScheduleBriefingInboxItems({
    rules: dueRules,
    now,
    newInboxItems: inboxItemsBeforeBriefing,
  });
  const scheduleBriefingInboxItems = scheduleBriefingResult.items;
  const existingInboxIds = new Set(getAutomationInboxSnapshot().map((item) => item.id));
  const scheduleItemsToNotify = scheduleBriefingInboxItems.filter((item) => !existingInboxIds.has(item.id));
  const suppressExternalNotifications = input.suppressExternalNotifications === true;
  const scheduleNotificationDispatches = suppressExternalNotifications
    ? []
    : await dispatchScheduleBriefingNotifications({
        rules: dueRules,
        now,
        items: scheduleItemsToNotify,
        options,
      });
  const inboxItems = [
    ...inboxItemsBeforeBriefing,
    ...scheduleBriefingInboxItems,
  ];
  const inboxResult = appendAutomationInboxItems(dedupeInboxItems(inboxItems), { createdAt: now });
  // 채팅 점검이 먼저 만든 같은 메일 카드에는 담당이 비어 있을 수 있다 — 비어 있을 때만 채운다.
  fillMissingMailCardAssignees(providerMailInboxItems, existingInboxIds, now);
  // AI 초안이 준비됐는데 그 메일 카드가 이미 있으면(예: 채팅에서 먼저 점검) 카드의 초안을 바꾼다.
  const aiReplyDraftStore = Number(replyDraftPreparation?.generated ?? 0) > 0
    ? mergeAiReplyDraftsIntoExistingCards(inboxItems, { existingIds: existingInboxIds, createdAt: now })
    : null;
  // 업무 카드가 확정된 다음, 아직 아무것도 밖으로 나가기 전에 한 번 정리한다.
  // 기본은 꺼져 있고, 켜져 있어도 새 재료가 없거나 지난번과 같으면 모델을 부르지 않는다.
  // 실패해도 자동 점검 자체는 계속 간다 — 정리는 있으면 좋은 것이지 필수가 아니다.
  const backgroundDigest = await runBackgroundDigestForRun(options, inboxItems, inboxResult);
  // 같은 카드를 업무 원장에도 올린다 — 메일·자동 점검·대화에서 온 일이 한 곳에 모이도록.
  // 원장에 못 올려도 자동 점검은 계속 간다.
  await mirrorInboxItemsToTaskLedger(options, inboxItems);
  const messengerDecisionItems = inboxItems.filter((item) => item.channelDecision);
  if (messengerDecisionItems.length > 0 && typeof options.recordActivity === "function") {
    await Promise.all(
      messengerDecisionItems.slice(0, 8).map((item, index) =>
        options.recordActivity({
          id: `messenger-decision-${compactDate(now)}-${index}`,
          workItemId: item.id,
          label: item.channelDecision.workerEventLabel || "메신저 결정 기록",
          detail: `${item.sourceLabel || "업무 채널"}에서 ${item.channelDecision.decisionLabel || messengerDecisionLabel(item.channelDecision.decision)} 의사를 기록했고 ${item.channelDecision.approvalInboxRouteLabel || "앱 승인함"}으로 보냈습니다.`,
          status: item.channelDecision.requiresAppReconfirm ? "needs_desktop" : "done",
          createdAt: now,
          kind: "messenger_decision",
          sourceLabel: item.sourceLabel || "메신저 결정",
          metrics: {
            decision: item.channelDecision.decision,
            decisionLabel: item.channelDecision.decisionLabel || messengerDecisionLabel(item.channelDecision.decision),
            channel: item.channelDecision.channel,
            targetCode: item.channelDecision.targetCode || "",
            targetWorkItemId: item.channelDecision.targetWorkItemId || item.id,
            notificationTargetMatch: item.channelDecision.notificationTargetMatch === true,
            notificationTargetMatchLabel: item.channelDecision.notificationTargetMatchLabel || "",
            notificationTargetMatchContract: item.channelDecision.notificationTargetMatchContract || "",
            approvalInboxRouteLabel: item.channelDecision.approvalInboxRouteLabel || "ModyCrew > 오피스 > 승인함",
            appReconfirmLabel: item.channelDecision.appReconfirmLabel || "앱 최종 확인 필요",
            workerEventLabel: item.channelDecision.workerEventLabel || "",
            finalExecutionBoundary: item.channelDecision.finalExecutionBoundary || "앱 최종 확인 전 외부 실행 없음",
            requiresAppReconfirm: item.channelDecision.requiresAppReconfirm,
            externalMutation: false,
          },
          auditTrail: [
            "메신저 답장 수신",
            `대상 고정: ${item.channelDecision.targetCode || item.channelDecision.targetWorkItemId || item.id}`,
            "업무 카드 channelDecision 반영",
            item.channelDecision.approvalInboxRouteLabel || "ModyCrew > 오피스 > 승인함",
            item.channelDecision.finalExecutionBoundary || "앱 최종 확인 전 외부 실행 없음",
            item.channelDecision.requiresAppReconfirm ? item.channelDecision.appReconfirmLabel || "앱 최종 확인 필요" : "채널 기록 완료",
          ],
        }),
      ),
    );
  }
  applyScheduleAdaptiveNextRuleStates({
    rules: dueRules,
    nextRuleStates,
    now,
    notificationPlan: scheduleBriefingResult.notificationPlan,
  });

  for (const [ruleId, ruleState] of Object.entries(nextRuleStates)) {
    state.rules[ruleId] = ruleState;
  }

  const secureMailPollingRuleCount = dueRules.filter(isSecureMailPollingRule).length;
  const ignoredMailCount =
    Number(providerIntakeReport?.ignoredItemsCount ?? providerIntakeReport?.stats?.ignoredItemsCount ?? 0) +
    webmailFallbackResults.reduce((sum, result) => sum + Number(result.ignoredItemsCount ?? 0), 0);
  const mailAutomationRan =
    secureMailPollingRuleCount > 0 ||
    webmailFallbackResults.length > 0 ||
    providerReadsForAiReview.length > 0;
  const mailAutomationNotice = mailAutomationRan
    ? [
        `메일 자동 점검: 새 메일 신호 ${newMailSignalCount}건`,
        `광고/뉴스레터/스팸 제외 ${ignoredMailCount}건`,
        `승인함 후보 ${inboxResult.addedCount}건`,
        firstRunSkippedMailCount > 0 ? `켜기 전에 받은 메일 ${firstRunSkippedMailCount}통은 건너뜀` : "",
        "발송/일정/첨부 이동은 사용자 최종 승인 전 잠금",
      ].filter(Boolean).join(" · ")
    : "";
  const mailAutomationTriageSummary = summarizeMailAutomationTriage({
    providerIntakeReport,
    webmailFallbackResults,
    approvalQueueCount: inboxResult.addedCount,
    ignoredMailCount,
  });
  const mailLearningRuleEvidence = summarizeMailLearningRuleEvidence(dueRules);
  const mailAutomationNotificationDraft = mailAutomationRan
    ? createMailAutomationNotificationDraft({
        dueRules,
        mailAutomationNotice,
        newMailSignalCount,
        duplicateMailSuppressedCount,
        ignoredMailCount,
        approvalQueueCount: inboxResult.addedCount,
        calendarCandidateCount:
          (providerIntakeReport?.candidates?.filter((candidate) => candidate.shouldCreateWorkItem && Boolean(candidate.calendarDraft)).length ?? 0) +
          webmailFallbackResults.reduce((sum, result) => sum + Number(result.calendarCandidateCount ?? 0), 0),
        attachmentCandidateCount:
          countAttachmentReviewCandidates(providerIntakeReport, providerReadsForAiReview) +
          webmailFallbackResults.reduce((sum, result) => sum + Number(result.attachmentCandidateCount ?? 0), 0),
        triageDistributionLabel: mailAutomationTriageSummary.triageDistributionLabel,
        importantWorkLabel: mailAutomationTriageSummary.importantWorkLabel,
        bodyPreviewPolicy: mailAutomationTriageSummary.bodyPreviewPolicy,
        ignoredCandidateLabels: mailAutomationTriageSummary.ignoredCandidateLabels,
        importantCandidateLabels: mailAutomationTriageSummary.importantCandidateLabels,
        learningRuleEvidence: mailLearningRuleEvidence,
      })
    : null;
  // 점검 결과 카드는 새 메일이나 새 카드가 있을 때만 만들고, 하루 한 장을 갱신한다.
  // 예전에는 5분마다 새 카드가 쌓여 80칸 인박스에서 답장 승인 카드가 밀려났다.
  // "새 소식"은 메일에서 온 것만 센다 — 일정 브리핑·메신저 카드 때문에 메일 결과 카드를 다시 쓰지 않는다.
  const addedMailCardCount = new Set(
    [...providerMailInboxItems, ...webmailFallbackInboxItems]
      .map((item) => item.id)
      .filter((id) => !existingInboxIds.has(id)),
  ).size;
  const mailAutomationHasNews = newMailSignalCount > 0 || addedMailCardCount > 0;
  const mailAutomationNotificationInboxItem = mailAutomationNotificationDraft && mailAutomationHasNews
    ? keepUserDecidedStatus(createMailAutomationNotificationInboxItem(mailAutomationNotificationDraft, now))
    : null;
  const mailAutomationNotificationInboxResult = mailAutomationNotificationInboxItem
    ? upsertAutomationInboxItem(mailAutomationNotificationInboxItem, { createdAt: now })
    : null;
  const mailAutomationNotificationDispatches = suppressExternalNotifications
    ? []
    : await dispatchMailAutomationOsNotification({
        dueRules,
        draft: mailAutomationNotificationDraft,
        inboxItem: mailAutomationNotificationInboxItem,
        options,
      });
  const webmailFallbackApprovalQueueCount = webmailFallbackResults.reduce(
    (sum, result) => sum + Number(result.approvalQueueCount ?? 0),
    0,
  );
  const webmailFallbackCalendarCandidateCount = webmailFallbackResults.reduce(
    (sum, result) => sum + Number(result.calendarCandidateCount ?? 0),
    0,
  );
  const webmailFallbackAttachmentCandidateCount = webmailFallbackResults.reduce(
    (sum, result) => sum + Number(result.attachmentCandidateCount ?? 0),
    0,
  );
  const webmailDomEvidence = summarizeWebmailDomEvidence(webmailFallbackResults);
  const webmailDomRecovery = summarizeWebmailDomRecovery(webmailFallbackResults);
  const webmailCredentialReferenceEvidence = summarizeWebmailCredentialReferences(webmailFallbackResults);
  const providerApprovalQueueCount = providerIntakeReport?.approvalQueue?.length ?? 0;
  const providerCalendarCandidateCount =
    providerIntakeReport?.candidates?.filter((candidate) => candidate.shouldCreateWorkItem && Boolean(candidate.calendarDraft)).length ?? 0;
  const providerAttachmentCandidateCount = countAttachmentReviewCandidates(providerIntakeReport, providerReadsForAiReview);

  const mailAutomationHistory = mailAutomationRan
    ? updateMailAutomationHistory(state.mailAutomationHistory, {
        createdAt: now,
        reportId: `trigger_runner_${compactDate(now)}`,
        triggeredBy: input.triggeredBy ?? "manual",
        newMailSignalCount,
        ignoredMailCount,
        approvalQueueCount: providerApprovalQueueCount + webmailFallbackApprovalQueueCount,
        webmailFallbackCheckCount: webmailFallbackResults.length,
        webmailDomExtractedCount: webmailDomEvidence.extractedCount,
        webmailBodyPreviewAllowedCount: webmailDomEvidence.bodyPreviewAllowedCount,
        webmailBodyPreviewSkippedBeforeBodyCount: webmailDomEvidence.bodyPreviewSkippedBeforeBodyCount,
      })
    : sanitizeMailAutomationHistory(state.mailAutomationHistory);
  const latestReport = {
    id: `trigger_runner_${compactDate(now)}`,
    status: domainReport.status === "ai_jobs_ready" || inboxResult.addedCount > 0
      ? "trigger_runner_completed"
      : "trigger_runner_quiet",
    createdAt: now,
    triggeredBy: input.triggeredBy ?? "manual",
    dueRuleCount: dueRules.length,
    signalsProcessed: signals.length,
    newMailSignalCount,
    duplicateMailSuppressedCount,
    firstRunSkippedMailCount,
    aiReplyDraftStatus: String(replyDraftPreparation?.status ?? "ai_reply_drafts_off"),
    aiReplyDraftCount: aiReplyDraftStore ? aiReplyDraftStore.storedIds.length : 0,
    mailPollingContract: "new_mail_metadata_only_seen_cursor_dedupe_approval_queue",
    secureMailPollingRuleCount,
    ignoredMailCount,
    mailAutomationNotice,
    mailLearningRuleEvidenceLabel: mailLearningRuleEvidence.label,
    mailLearningRuleEvidenceLabels: mailLearningRuleEvidence.evidenceLabels,
    mailLearningRuleEvidenceContract: mailLearningRuleEvidence.contract,
    mailLearningRuleSafePersistPolicy: mailLearningRuleEvidence.safePersistPolicy,
    mailAutomationNotificationDraft,
    mailAutomationNotificationInboxItemId: mailAutomationNotificationInboxItem?.id ?? "",
    mailAutomationNotificationInboxStatus: mailAutomationNotificationInboxResult?.status ?? "",
    mailAutomationNotificationDispatchCount: mailAutomationNotificationDispatches.length,
    mailAutomationNotificationDispatchStatuses: mailAutomationNotificationDispatches.map((dispatch) => dispatch.status).slice(0, 4),
    approvalSafetyContract: "external_send_calendar_attachment_mutation_locked_until_user_final_approval",
    secretHandlingContract: "credentialReferenceId_or_browserSessionReferenceId_only_no_raw_secret_returned",
    queuedWorkItemsCount: inboxResult.addedCount,
    // 배경 정리가 켜져 있고 실제로 돌았을 때만 채워진다. 꺼져 있으면 빈 문자열이다.
    backgroundDigestStatus: String(backgroundDigest?.status ?? "background_digest_not_run"),
    backgroundDigestText: String(backgroundDigest?.digestText ?? ""),
    approvalQueueCount: providerApprovalQueueCount + webmailFallbackApprovalQueueCount,
    mailCandidateCount:
      providerIntakeReport?.candidates?.filter((candidate) => candidate.sourceKind === "mail" && candidate.shouldCreateWorkItem).length ?? 0,
    calendarCandidateCount: providerCalendarCandidateCount + webmailFallbackCalendarCandidateCount,
    attachmentCandidateCount: providerAttachmentCandidateCount + webmailFallbackAttachmentCandidateCount,
    attachmentStagingStatus:
      providerAttachmentCandidateCount + webmailFallbackAttachmentCandidateCount > 0
        ? "ready_for_download_review"
        : "no_attachment_candidate",
    attachmentStagingContract: "download_message_attachments_to_local_staging_then_folder_plan_approval",
    providerReadCount: providerReads.reduce((sum, read) => sum + Number(read.messages?.length ?? read.events?.length ?? 0), 0),
    webmailFallbackCheckCount: webmailFallbackResults.length,
    webmailFallbackQueuedCount: webmailFallbackResults.reduce((sum, result) => sum + Number(result.addedInboxItemsCount ?? 0), 0),
    webmailFallbackBlockedCount: webmailFallbackResults.filter((result) => result.blocked === true).length,
    webmailFallbackApprovalQueueCount,
    webmailCredentialReferenceCount: webmailCredentialReferenceEvidence.count,
    webmailCredentialReferenceIds: webmailCredentialReferenceEvidence.ids,
    webmailCredentialReferencePolicy: webmailCredentialReferenceEvidence.policy,
    webmailAiSecretReadable: false,
    webmailDomCaptureStatus: webmailDomEvidence.captureStatus,
    webmailDomExtractionStatus: webmailDomEvidence.extractionStatus,
    webmailDomRowCount: webmailDomEvidence.rowCount,
    webmailDomExtractedCount: webmailDomEvidence.extractedCount,
    webmailDomRecoveryStatus: webmailDomRecovery.status,
    webmailDomRecoveryReasonLabel: webmailDomRecovery.reasonLabel,
    webmailDomRecoveryNextAction: webmailDomRecovery.nextUserAction,
    webmailBodyPreviewAllowedCount: webmailDomEvidence.bodyPreviewAllowedCount,
    webmailBodyPreviewSkippedBeforeBodyCount: webmailDomEvidence.bodyPreviewSkippedBeforeBodyCount,
    mailAutomationRunCount: mailAutomationHistory.length,
    mailAutomationLastRunAt: mailAutomationHistory[0]?.createdAt ?? "",
    mailAutomationEvidenceWindow: summarizeMailAutomationEvidenceWindow(mailAutomationHistory),
    messengerCommandCount: messengerCommandInboxItems.length,
    triggerReportStatus: domainReport.status,
    providerIntakeStatus: providerIntakeReport?.status ?? "not_run",
    scheduleBriefingCount: scheduleBriefingInboxItems.length,
    scheduleNotificationCount: scheduleNotificationDispatches.length,
    scheduleNotificationSuppressedCount:
      scheduleBriefingInboxItems.length - scheduleItemsToNotify.length +
      (suppressExternalNotifications ? scheduleItemsToNotify.length : 0),
    scheduleNotificationSuppressedByWorkSync: suppressExternalNotifications,
    scheduleNotificationStatuses: scheduleNotificationDispatches.map((dispatch) => dispatch.status).slice(0, 8),
    scheduleAdaptiveNextChecks: createScheduleAdaptiveNextCheckSummary(dueRules, nextRuleStates),
    reportPath: reportPath(options),
    userMessage:
      scheduleNotificationDispatches.length > 0
        ? mailAutomationRan
          ? `${mailAutomationNotice} · 일정/마감 브리핑 ${scheduleBriefingInboxItems.length}건을 만들고 알림 ${scheduleNotificationDispatches.length}건을 보냈습니다.`
          : `일정/마감 브리핑 ${scheduleBriefingInboxItems.length}건을 만들고 알림 ${scheduleNotificationDispatches.length}건을 보냈습니다.`
        :
      scheduleBriefingInboxItems.length > 0
        ? mailAutomationRan
          ? scheduleItemsToNotify.length === 0
            ? `${mailAutomationNotice} · 일정/마감 브리핑 ${scheduleBriefingInboxItems.length}건은 이미 같은 알림 구간에 있어 중복 발송하지 않았습니다.`
            : `${mailAutomationNotice} · 일정/마감 브리핑 ${scheduleBriefingInboxItems.length}건을 인박스에 올렸습니다.`
          : scheduleItemsToNotify.length === 0
            ? `일정/마감 브리핑 ${scheduleBriefingInboxItems.length}건은 이미 같은 알림 구간에 있어 중복 발송하지 않았습니다.`
            : `일정/마감 브리핑 ${scheduleBriefingInboxItems.length}건을 인박스에 올렸습니다.`
        :
      messengerCommandInboxItems.length > 0
        ? `메신저 명령 ${messengerCommandInboxItems.length}건을 상태/승인 대화 카드로 올렸습니다.`
        : mailAutomationRan && inboxResult.addedCount > 0
          ? mailAutomationNotice
        : inboxResult.addedCount > 0
          ? `자동 확인으로 새 업무 ${inboxResult.addedCount}건을 인박스에 올렸습니다.`
        : "자동 확인을 실행했지만 새 업무 후보는 없습니다.",
    externalMutation: scheduleNotificationDispatches.some((dispatch) => dispatch.externalMutation === true),
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  state.latestReport = latestReport;
  state.mailAutomationHistory = mailAutomationHistory;
  if (mailAutomationRan) state.latestMailAutomationReport = latestReport;
  state.updatedAt = now;
  await writeState(options, state);
  await writeReport(options, {
    latestReport,
    dueRules,
    signals,
    domainReport,
    providerIntakeReport,
    connectorContext,
    webmailFallbackResults,
    messengerCommandReads,
    scheduleNotificationDispatches,
  });

  return {
    status: latestReport.status,
    report: latestReport,
    userMessage: latestReport.userMessage,
    externalMutation: latestReport.externalMutation === true,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function dispatchTriggerEvent(input, options = {}) {
  const now = nowIso(options);
  const settings = await listTriggerSettings(options);
  const state = await readState(options);
  const rule = findEventRule(settings.rules, input);

  if (!rule) {
    return {
      status: "trigger_event_not_matched",
      userMessage: "켜진 자동 작동 규칙 중 이 이벤트를 받을 규칙이 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const signal = isMessengerCommandRule(rule) && input.channelMessage
    ? createMessengerCommandSignal(
        rule,
        {
          connectorId: rule.connectorId,
          providerId: providerIdForMessengerConnector(rule.connectorId),
          cursorPrefix: providerIdForMessengerConnector(rule.connectorId),
        },
        normalizeWebhookChannelMessage(input.channelMessage, input, now),
        input.cursor || `${providerIdForMessengerConnector(rule.connectorId)}:${input.channelMessage.updateId ?? compactDate(now)}`,
        now,
      )
    : createEventSignal(rule, input, now);
  const domainReport = await createConnectedTriggerReport([rule], [signal], now);
  const inboxItems = signal.triggerKind === "messenger_command"
    ? await mapMessengerCommandSignalsToInboxItems([signal], now)
    : mapTriggerWorkItemsToInboxItems(domainReport.workItems, now, [signal], [rule]);
  const inboxResult = appendAutomationInboxItems(inboxItems, { createdAt: now });
  const previousRuleState = state.rules[rule.id] ?? createEmptyRuleState();
  state.rules[rule.id] = updateRuleStateAfterRun(rule, previousRuleState, now, [signal.cursor]);
  const latestReport = {
    id: `trigger_event_${compactDate(now)}`,
    status: "trigger_event_processed",
    createdAt: now,
    triggeredBy: "event",
    dueRuleCount: 1,
    signalsProcessed: 1,
    queuedWorkItemsCount: inboxResult.addedCount,
    providerReadCount: 0,
    triggerReportStatus: domainReport.status,
    providerIntakeStatus: "not_run",
    reportPath: reportPath(options),
    messengerCommandCount: signal.triggerKind === "messenger_command" ? inboxItems.length : 0,
    userMessage: signal.triggerKind === "messenger_command"
      ? `${rule.label} 메신저 답장 ${inboxResult.addedCount}건을 앱 최종 확인 카드로 반영했습니다.`
      : `${rule.label} 이벤트를 받아 업무 카드 ${inboxResult.addedCount}건을 인박스에 올렸습니다.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  state.latestReport = latestReport;
  state.updatedAt = now;
  await writeState(options, state);
  await writeReport(options, {
    latestReport,
    dueRules: [rule],
    signals: [signal],
    domainReport,
    providerIntakeReport: null,
    connectorContext: createEmptyConnectorContext(),
  });

  return {
    status: "trigger_event_processed",
    report: latestReport,
    userMessage: latestReport.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createSignalsFromDueRules(input) {
  const signals = [];
  const newMessageIds = new Set();
  const nextRuleStates = {};
  let newMailSignalCount = 0;
  let duplicateMailSuppressedCount = 0;
  const firstRunSkippedCursors = new Set();

  for (const rule of input.rules) {
    const previousRuleState = input.state.rules?.[rule.id] ?? createEmptyRuleState();
    const seen = new Set(previousRuleState.seenCursors ?? []);
    const ruleSignals = [];
    const ruleSeededCursors = [];
    const ruleProviderReads = providerReadsForRule(rule, input.providerReads);
    const ruleMessengerReads = messengerReadsForRule(rule, input.messengerCommandReads);
    // 메일 규칙을 처음 켰거나(점검 기록 없음) 껐다 다시 켰으면, 켜기 전에 이미 와 있던 메일은
    // 카드 없이 "본 메일"로만 기록한다. 켜자마자 지난 메일 10통에 답장 카드가 쏟아지지 않게 한다.
    const firstRunSeedCutoffMs = isMessageTriggerRule(rule)
      ? firstRunMailSeedCutoffMs(rule, previousRuleState, input.now)
      : null;

    for (const read of ruleProviderReads) {
      for (const message of read.messages ?? []) {
        const cursor = `${read.connectorId}:${message.messageId}`;
        if (seen.has(cursor)) {
          if (isMessageTriggerRule(rule)) duplicateMailSuppressedCount += 1;
          continue;
        }
        if (!isMessageTriggerRule(rule)) continue;
        if (firstRunSeedCutoffMs !== null && receivedAtMs(message) < firstRunSeedCutoffMs) {
          seen.add(cursor);
          ruleSeededCursors.push(cursor);
          firstRunSkippedCursors.add(cursor);
          continue;
        }
        const signal = createMailSignal(rule, read, message, cursor, input.now);
        signals.push(signal);
        ruleSignals.push(signal);
        newMessageIds.add(message.messageId);
        newMailSignalCount += 1;
      }
    }

    for (const read of ruleMessengerReads) {
      for (const update of read.updates ?? []) {
        const cursor = `${read.cursorPrefix ?? read.providerId ?? "messenger"}:${update.updateId}`;
        if (seen.has(cursor)) continue;
        if (!isMessengerCommandRule(rule)) continue;
        const signal = createMessengerCommandSignal(rule, read, update, cursor, input.now);
        signals.push(signal);
        ruleSignals.push(signal);
      }
    }

    if (rule.mode === "scheduled" && ruleSignals.length === 0) {
      const totalItems = ruleProviderReads.reduce((sum, read) => sum + Number(read.messages?.length ?? 0), 0);
      if (totalItems > 0) {
        const signal = createDigestSignal(rule, totalItems, input.now);
        signals.push(signal);
        ruleSignals.push(signal);
      }
    }

    nextRuleStates[rule.id] = updateRuleStateAfterRun(
      rule,
      previousRuleState,
      input.now,
      ruleSignals.map((signal) => signal.cursor),
      ruleSeededCursors,
    );
    // 첫 기록이 필요한 점검인데 메일을 한 통도 읽지 못했으면(로그인 실패·연결 끊김 등) 기준 시각을
    // 남겨 두고 다음 점검에서 다시 기록한다. 예전에는 실패한 점검도 "점검함"으로 남아, 다음에 읽힌
    // 지난 메일 전부에 답장 카드가 쏟아졌다.
    const ruleReadMail = ruleProviderReads.some((read) => Array.isArray(read.messages));
    if (firstRunSeedCutoffMs !== null && !ruleReadMail) {
      nextRuleStates[rule.id].pendingMailSeedAt = new Date(firstRunSeedCutoffMs + firstRunRecentMailGraceMs).toISOString();
    } else {
      delete nextRuleStates[rule.id].pendingMailSeedAt;
    }
  }

  return {
    signals,
    newMessageIds,
    nextRuleStates,
    newMailSignalCount,
    duplicateMailSuppressedCount,
    firstRunSkippedMailCount: firstRunSkippedCursors.size,
  };
}

/**
 * 첫 점검에서 "이미 와 있던 메일"로 볼 기준 시각(ms). 첫 점검이 아니면 null.
 * 기준은 규칙을 켠 시각(enabledAt, 없으면 지금)에서 조금 앞이다 — 켜기 직전에 막 온 메일은
 * 아직 처리 전일 수 있어 새 메일로 본다.
 */
function firstRunMailSeedCutoffMs(rule, previousRuleState, now) {
  const enabledAtMs = Date.parse(String(rule.enabledAt ?? ""));
  const lastCheckedMs = Date.parse(String(previousRuleState?.lastCheckedAt ?? ""));
  const pendingSeedMs = Date.parse(String(previousRuleState?.pendingMailSeedAt ?? ""));
  const hasPriorRun = Number.isFinite(lastCheckedMs);
  const reEnabledAfterLastRun = Number.isFinite(enabledAtMs) && hasPriorRun && enabledAtMs > lastCheckedMs;
  let startMs;
  if (reEnabledAfterLastRun) startMs = enabledAtMs;
  // 지난 점검이 메일을 못 읽어 첫 기록을 미뤘으면 그때의 기준 시각을 그대로 쓴다.
  else if (Number.isFinite(pendingSeedMs)) startMs = pendingSeedMs;
  else if (hasPriorRun) return null;
  else startMs = Number.isFinite(enabledAtMs) ? enabledAtMs : Date.parse(now);
  return Number.isFinite(startMs) ? startMs - firstRunRecentMailGraceMs : null;
}

function receivedAtMs(message) {
  const value = Date.parse(String(message?.receivedAt ?? ""));
  // 받은 시각을 모르면 새 메일로 본다(놓치는 것보다 한 번 더 보여 주는 편이 낫다).
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

async function loadMessengerCommandReads(input) {
  const reads = [];
  for (const rule of input.rules.filter(isTelegramCommandRule)) {
    const previous = input.state.rules?.[rule.id] ?? createEmptyRuleState();
    const offset = nextTelegramOffset(previous.lastCursor);
    const context = await loadTelegramCommandContext(input.options, {
      ...(offset ? { offset } : {}),
      limit: 20,
    });
    reads.push({
      ruleId: rule.id,
      connectorId: rule.connectorId,
      providerId: "telegram",
      cursorPrefix: "telegram",
      status: context.status,
      updates: context.updates ?? [],
      nextOffset: context.nextOffset,
      userMessage: context.userMessage,
      auditMessages: context.auditMessages ?? [],
    });
  }
  for (const rule of input.rules.filter(isSlackCommandRule)) {
    const context = await loadSlackCommandContext(input.options, {
      updates: input.options.slackCommandUpdates,
      limit: 20,
    });
    reads.push({
      ruleId: rule.id,
      connectorId: rule.connectorId,
      providerId: "slack",
      cursorPrefix: "slack",
      status: context.status,
      updates: context.updates ?? [],
      userMessage: context.userMessage,
      auditMessages: context.auditMessages ?? [],
    });
  }
  return reads;
}

async function createConnectedTriggerReport(rules, signals, now) {
  const domain = await loadDomainRuntime();
  const runtime = new domain.ModyConnectedWorkTriggerRuntime({
    now: () => new Date(now),
  });
  return runtime.createReport({
    workspaceLabel: "ModyCrew 자동 확인",
    appDeepLinkBase: "modycrew://trigger",
    createdAt: now,
    triggers: rules.map(toDomainTrigger),
    signals,
  });
}

async function createProviderIntakeReport(reads, now, options = {}) {
  const safeReads = reads.filter((read) => (read.messages?.length ?? read.events?.length ?? 0) > 0);
  if (safeReads.length === 0) return null;
  const domain = await loadDomainRuntime();
  const planner = new domain.ModyProviderWorkIntakePlanner({
    now: () => new Date(now),
  });
  // 여러 계정 메일을 한 번에 점검하므로 규칙 초안에는 서명을 넣지 않는다. 카드로 옮길 때 계정별 서명을 붙인다
  // (mapProviderCandidatesToInboxItems). 형식/말투 라벨은 내부 표기라 초안 본문에 들어가지 않는다.
  const input = {
    reads: safeReads,
    writingProfile: {
      toneLabel: "짧고 정중한 업무 담당자 말투",
      formatLabel: "메일/문의 답장 초안",
      calendarPreference: "평일 10:00-17:00, 기존 일정 충돌 제외",
    },
    reportChannelId: "telegram",
    appDeepLinkBase: "modycrew://trigger/provider",
  };
  // Jev 메일 분류 보조는 사용자가 켰을 때만 쓴다(기본 꺼짐). 실패하면 규칙 판단 그대로.
  let jevEnabled = false;
  try {
    jevEnabled = await isJevMailEnabled(options);
  } catch {
    jevEnabled = false;
  }
  if (!jevEnabled) return planner.createReport(input);
  try {
    return await createJevMailWorkReport({ domain, planner, input, scopeKey: jevScopeForProviderRead }, options);
  } catch {
    return planner.createReport(input);
  }
}

function jevScopeForProviderRead(read) {
  return createHash("sha256")
    .update(JSON.stringify(["trigger-runner", read?.providerId, read?.connectorId, read?.credentialReferenceId]))
    .digest("hex");
}

/**
 * 배경 AI 답장 초안(선택 기능, 기본 꺼짐). 메일 규칙에 aiReplyDrafts 가 켜져 있을 때만
 * 주입된 준비기(options.prepareReplyDrafts)에 이번에 새로 온 업무 메일 보고서를 넘긴다.
 * 준비기는 후보의 초안만 바꾼다 — 보내거나 설정을 바꾸지 않는다. 실패하면 규칙 초안을 그대로 둔다.
 */
async function prepareBackgroundReplyDrafts({ rules = [], report, providerReads = [], options = {} }) {
  if (!rules.some((rule) => isMessageTriggerRule(rule) && rule.aiReplyDrafts === true)) return null;
  const replyCandidates = (report?.candidates ?? []).filter(
    (candidate) => candidate?.sourceKind === "mail" && candidate.shouldCreateWorkItem && candidate.draftReply,
  );
  if (replyCandidates.length === 0) return { status: "ai_reply_drafts_no_candidate", generated: 0 };
  if (typeof options.prepareReplyDrafts !== "function") {
    return { status: "ai_reply_drafts_unavailable", generated: 0 };
  }
  try {
    const result = await options.prepareReplyDrafts({
      // 급한 메일부터 초안을 쓴다(한 번에 몇 통만 쓰므로). 후보 객체는 그대로라 초안이 카드에 실린다.
      workReport: { ...report, candidates: sortMailCandidatesByPriority(report.candidates) },
      providerReads,
      maxCandidates: backgroundReplyDraftMaxCandidates,
    });
    return {
      status: String(result?.status ?? "ai_reply_drafts_prepared"),
      generated: Math.max(0, Math.min(backgroundReplyDraftMaxCandidates, Number(result?.generated ?? 0) || 0)),
    };
  } catch {
    return { status: "ai_reply_drafts_failed", generated: 0 };
  }
}

/**
 * 이미 있던 같은 메일 카드(예: 채팅에서 먼저 점검)에 담당·우선순위가 없으면 채운다.
 * 사용자가 고른 담당이나 이미 있는 값은 건드리지 않고, 초안·발송 상태도 바꾸지 않는다.
 */
function fillMissingMailCardAssignees(items = [], existingIds = new Set(), createdAt) {
  const incoming = items.filter((item) => item?.assigneeTeammateId && existingIds.has(item.id));
  if (!incoming.length) return 0;
  const snapshot = new Map(getAutomationInboxSnapshot().map((item) => [item.id, item]));
  let filled = 0;
  for (const item of incoming) {
    const existing = snapshot.get(item.id);
    if (!existing || existing.assigneeTeammateId) continue;
    const triage = Object.fromEntries(
      Object.entries(item).filter(([key]) =>
        key.startsWith("assignee") || (!existing.priority && (key.startsWith("priority") || key.startsWith("jev") || key.startsWith("mailCategory")))),
    );
    const result = upsertAutomationInboxItem({ ...existing, ...triage }, { createdAt });
    if (result?.status === "automation_inbox_item_updated") filled += 1;
  }
  return filled;
}

/** 이번 점검에서 업무팩 메일 점검(provider intake)이 다룬 메일의 커서 목록. */
function createProviderIntakeCursorSet(report, providerReads = []) {
  if (!report) return new Set();
  return new Set(
    providerReads.flatMap((read) =>
      (read.messages ?? []).map((message) => `${read.connectorId}:${message.messageId}`),
    ),
  );
}

async function runWebmailFallbackChecks({ rules = [], providerReads = [], siteLoginConnectorReferences = [], options = {}, now }) {
  if (typeof options.requestDesktopControlAction !== "function") return [];
  const domain = await loadDomainRuntime();
  const results = [];
  for (const rule of rules.filter((rule) => shouldRunWebmailFallback(rule, providerReads))) {
    const fallback = createWebmailFallbackPayloadForRule(rule, now, siteLoginConnectorReferences, domain);
    if (fallback.blockedBeforeDesktopControl) {
      results.push(normalizeWebmailFallbackResult(rule, {
        status: "webmail_metadata_read_blocked",
        userMessage: fallback.userMessage,
        webmailPlan: fallback.webmailPlan,
        observedAt: now,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      }, now));
      continue;
    }
    let result;
    try {
      result = await options.requestDesktopControlAction({
        capability: "read_webmail_metadata",
        featureEnabled: true,
        target: fallback.loginUrl,
        instruction: `${rule.label} 자동 점검: 웹메일 목록 메타데이터만 읽고 중요 후보만 승인함에 올립니다.`,
        webmailFallback: fallback,
      });
    } catch (error) {
      result = {
        status: "webmail_metadata_read_blocked",
        userMessage: `웹메일 자동 점검을 실행하지 못했습니다: ${sanitizeText(error instanceof Error ? error.message : String(error))}`,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }
    results.push(normalizeWebmailFallbackResult(rule, {
      ...result,
      webmailPlan: result?.webmailPlan ?? fallback.webmailPlan ?? null,
      credentialReferenceId: result?.credentialReferenceId ?? fallback.credentialReferenceId ?? "",
      credentialReferencePolicy:
        result?.credentialReferencePolicy ?? fallback.credentialReferencePolicy ?? "os_keychain_reference_only_ai_secret_unreadable",
      aiSecretReadable: result?.aiSecretReadable === true ? true : false,
    }, now));
  }
  return results;
}

function shouldRunWebmailFallback(rule, providerReads = []) {
  if (!isMessageTriggerRule(rule)) return false;
  const text = `${rule.id} ${rule.label} ${rule.connectorId} ${rule.sourceKind}`.toLowerCase();
  const explicitlyWebmail = /webmail|웹메일|site-login|site_login|groupware|그룹웨어/u.test(text);
  const secureMailFallbackWithoutRead =
    rule.id === "local-rule-secure-mail-polling-5m" &&
    providerReadsForRule(rule, providerReads).length === 0;
  return explicitlyWebmail || secureMailFallbackWithoutRead;
}

function createWebmailFallbackPayloadForRule(rule, now, siteLoginConnectorReferences = [], domain = {}) {
  const connectorId = sanitizeText(rule.connectorId || "company-webmail");
  const safeConnectorId = connectorId || "company-webmail";
  const siteLoginRecord = findSiteLoginReferenceForRule(rule, siteLoginConnectorReferences);
  if (siteLoginRecord && typeof domain.createWebmailFallbackPollingPlanFromVaultRecord === "function") {
    const twoFactorMode = webmailTwoFactorModeForRule(rule, "manual_once_then_session");
    const plan = domain.createWebmailFallbackPollingPlanFromVaultRecord(
      {
        ...siteLoginRecord,
        connectorId: siteLoginRecord.connectorId || safeConnectorId,
        cadenceMinutes: Number(rule.cadenceMinutes ?? 5) || 5,
        mailboxLabel: "받은메일함",
        twoFactorMode,
      },
      {
        createdAt: now,
        defaultTwoFactorMode: twoFactorMode,
        assumeBrowserSessionReference: true,
      },
    );
    const credentialReferences = plan.credentialReferences ?? {};
    return {
      connectorId: plan.connectorId,
      providerLabel: plan.providerLabel,
      loginUrl: plan.loginUrl,
      accountReferenceId: credentialReferences.accountReferenceId,
      passwordReferenceId: credentialReferences.passwordReferenceId,
      browserSessionReferenceId: credentialReferences.browserSessionReferenceId,
      credentialReferenceId: credentialReferences.passwordReferenceId || siteLoginRecord.credentialReferenceId,
      credentialStorage: sanitizeText(siteLoginRecord.credentialStorage || "os_keychain"),
      aiSecretReadable: false,
      twoFactorMode,
      cadenceMinutes: plan.cadenceMinutes,
      mailboxLabel: plan.mailboxLabel,
      reportChannelId: "desktop",
      writingProfile: {
        toneLabel: "짧고 정중한 업무 담당자 말투",
        formatLabel: "메일 답장과 일정 후보",
        calendarPreference: "평일 10:00-17:00, 기존 일정 충돌 제외",
      },
      createdAt: now,
      vaultRecordSource: "site_login_connector_vault",
      webmailPlanStatus: plan.status,
      webmailPlan: plan,
      blockedBeforeDesktopControl: plan.status !== "ready_for_metadata_polling",
      userMessage: plan.userMessage,
    };
  }

  const loginUrl = webmailLoginUrlForRule(rule);
  return {
    connectorId: safeConnectorId,
    providerLabel: sanitizeText(rule.label || "회사 웹메일"),
    loginUrl,
    browserSessionReferenceId: `os-keychain:/modycrew/${safeId(safeConnectorId)}/browser-session`,
    twoFactorMode: "manual_once_then_session",
    cadenceMinutes: Number(rule.cadenceMinutes ?? 5) || 5,
    mailboxLabel: "받은메일함",
    reportChannelId: "desktop",
    writingProfile: {
      toneLabel: "짧고 정중한 업무 담당자 말투",
      formatLabel: "메일 답장과 일정 후보",
      calendarPreference: "평일 10:00-17:00, 기존 일정 충돌 제외",
    },
    createdAt: now,
  };
}

function findSiteLoginReferenceForRule(rule, siteLoginConnectorReferences = []) {
  const connectorId = sanitizeText(rule.connectorId).toLowerCase();
  const label = sanitizeText(rule.label).toLowerCase();
  const text = `${connectorId} ${label}`.trim();
  return siteLoginConnectorReferences.find((record) => {
    const recordConnectorId = sanitizeText(record.connectorId).toLowerCase();
    const recordHost = sanitizeText(record.siteHost).toLowerCase();
    const recordLabel = sanitizeText(record.siteLabel).toLowerCase();
    return (
      (connectorId && isEquivalentMailConnectorId(connectorId, recordConnectorId)) ||
      (connectorId && recordHost.includes(connectorId)) ||
      (recordHost && text.includes(recordHost)) ||
      (recordLabel && text.includes(recordLabel))
    );
  });
}

function isEquivalentMailConnectorId(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const aliases = new Set(["custom-imap-mail", "company-mail", "company-webmail"]);
  return aliases.has(left) && aliases.has(right);
}

function webmailTwoFactorModeForRule(rule, fallback = "manual_once_then_session") {
  const value = sanitizeText(rule.twoFactorMode ?? rule.webmailTwoFactorMode ?? rule.metadata?.twoFactorMode);
  if (
    value === "disabled_by_user" ||
    value === "manual_once_then_session" ||
    value === "enabled_needs_user_presence" ||
    value === "unknown"
  ) {
    return value;
  }
  return fallback;
}

function webmailLoginUrlForRule(rule) {
  const text = `${rule.connectorId} ${rule.label}`;
  const explicit = text.match(/https:\/\/[^\s"'<>]+/u)?.[0];
  if (explicit) return explicit;
  const id = String(rule.connectorId ?? "").toLowerCase();
  if (id.includes("naver")) return "https://mail.naver.com";
  if (id.includes("daum") || id.includes("kakao")) return "https://mail.daum.net";
  if (id.includes("gmail")) return "https://mail.google.com";
  if (id.includes("outlook") || id.includes("office365")) return "https://outlook.office.com/mail/";
  return "https://mail.company.example/login";
}

function normalizeWebmailFallbackResult(rule, result = {}, now) {
  const status = sanitizeText(result.status ?? "webmail_metadata_read_blocked");
  const blocked = status === "webmail_metadata_read_blocked" || status === "capability_missing" || status === "desktop_control_disabled";
  return {
    ruleId: rule.id,
    ruleLabel: sanitizeText(rule.label),
    connectorId: sanitizeText(rule.connectorId),
    status,
    blocked,
    messageCount: Number(result.messageCount ?? 0),
    createdWorkItemsCount: Number(result.createdWorkItemsCount ?? 0),
    approvalQueueCount: Number(result.approvalQueueCount ?? 0),
    ignoredItemsCount: Number(result.ignoredItemsCount ?? 0),
    calendarCandidateCount: Number(result.calendarCandidateCount ?? 0),
    attachmentCandidateCount: Number(result.attachmentCandidateCount ?? 0),
    addedInboxItemsCount: Number(result.inboxResult?.addedCount ?? result.addedInboxItemsCount ?? 0),
    userMessage: sanitizeText(result.userMessage ?? ""),
    webmailPlan: result.webmailPlan ?? null,
    credentialReferenceId: firstNonEmptyText(
      result.credentialReferenceId,
      result.webmailPlan?.credentialReferences?.passwordReferenceId,
      result.webmailPlan?.credentialReferences?.browserSessionReferenceId,
      result.webmailPlan?.credentialReferences?.accountReferenceId,
    ),
    credentialReferenceCount: Math.max(
      countCredentialReferences(result.webmailPlan?.credentialReferences),
      firstNonEmptyText(
        result.credentialReferenceId,
        result.webmailPlan?.credentialReferences?.passwordReferenceId,
        result.webmailPlan?.credentialReferences?.browserSessionReferenceId,
        result.webmailPlan?.credentialReferences?.accountReferenceId,
      )
        ? 1
        : 0,
    ),
    credentialReferencePolicy: "os_keychain_reference_only_ai_secret_unreadable",
    aiSecretReadable: false,
    webmailDomCapture: result.webmailDomCapture ?? null,
    webmailDomExtraction: result.webmailDomExtraction ?? null,
    webmailDomRecoveryGuide: sanitizeWebmailDomRecoveryGuide(result.webmailDomRecoveryGuide),
    bodyPreviewAllowedCount: Number(result.bodyPreviewAllowedCount ?? result.webmailDomExtraction?.bodyPreviewAllowedCount ?? 0),
    bodyPreviewSkippedBeforeBodyCount: Number(
      result.bodyPreviewSkippedBeforeBodyCount ?? result.webmailDomExtraction?.bodyPreviewSkippedBeforeBodyCount ?? 0,
    ),
    checkedAt: sanitizeIso(result.observedAt, now),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeWebmailDomRecoveryGuide(value) {
  if (!value || typeof value !== "object") return null;
  const checklist = Array.isArray(value.checklist)
    ? value.checklist.map((item) => sanitizeText(item)).filter(Boolean).slice(0, 5)
    : [];
  return {
    status: sanitizeText(value.status ?? ""),
    reasonLabel: sanitizeText(value.reasonLabel ?? ""),
    nextUserAction: sanitizeText(value.nextUserAction ?? ""),
    checklist,
    readOnly: true,
    externalMutation: false,
    rawSelectorStored: false,
    rawPageHtmlStored: false,
    rawBodyStored: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function summarizeWebmailDomEvidence(results = []) {
  const captured = results.find((result) => result.webmailDomCapture?.status === "webmail_dom_rows_captured") ?? null;
  const extracted = results.find((result) => result.webmailDomExtraction?.status === "metadata_extracted") ?? null;
  const firstCapture = captured ?? results.find((result) => result.webmailDomCapture) ?? null;
  const firstExtraction = extracted ?? results.find((result) => result.webmailDomExtraction) ?? null;
  return {
    captureStatus: sanitizeText(firstCapture?.webmailDomCapture?.status ?? ""),
    extractionStatus: sanitizeText(firstExtraction?.webmailDomExtraction?.status ?? ""),
    rowCount: results.reduce(
      (sum, result) => sum + Number(result.webmailDomCapture?.rowCount ?? result.webmailDomExtraction?.rowCount ?? 0),
      0,
    ),
    extractedCount: results.reduce((sum, result) => sum + Number(result.webmailDomExtraction?.extractedCount ?? 0), 0),
    bodyPreviewAllowedCount: results.reduce(
      (sum, result) => sum + Number(result.bodyPreviewAllowedCount ?? result.webmailDomExtraction?.bodyPreviewAllowedCount ?? 0),
      0,
    ),
    bodyPreviewSkippedBeforeBodyCount: results.reduce(
      (sum, result) =>
        sum + Number(result.bodyPreviewSkippedBeforeBodyCount ?? result.webmailDomExtraction?.bodyPreviewSkippedBeforeBodyCount ?? 0),
      0,
    ),
  };
}

function summarizeWebmailDomRecovery(results = []) {
  const guides = results.map((result) => result.webmailDomRecoveryGuide).filter(Boolean);
  const guide =
    guides.find((item) => /needs|unsafe|rejected|unavailable|blocked|login|2fa|auth/iu.test(item.status)) ??
    guides.find((item) => item.status === "rows_ready") ??
    guides[0] ??
    null;
  return {
    status: sanitizeText(guide?.status ?? ""),
    reasonLabel: sanitizeText(guide?.reasonLabel ?? ""),
    nextUserAction: sanitizeText(guide?.nextUserAction ?? ""),
  };
}

function summarizeWebmailCredentialReferences(results = []) {
  const ids = [];
  for (const result of results) {
    const references = result.webmailPlan?.credentialReferences ?? {};
    for (const id of [
      result.credentialReferenceId,
      references.passwordReferenceId,
      references.browserSessionReferenceId,
      references.accountReferenceId,
    ]) {
      const safeId = sanitizeText(id ?? "");
      if (safeId && !ids.includes(safeId)) ids.push(safeId);
    }
  }
  return {
    count: ids.length,
    ids: ids.slice(0, 5),
    policy: "os_keychain_reference_only_ai_secret_unreadable",
  };
}

function countCredentialReferences(references = {}) {
  return [
    references.accountReferenceId,
    references.passwordReferenceId,
    references.browserSessionReferenceId,
  ].filter((id) => sanitizeText(id ?? "")).length;
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = sanitizeText(value ?? "");
    if (text) return text;
  }
  return "";
}

function mapWebmailFallbackResultsToInboxItems(results = [], now) {
  return results
    .filter((result) => result.blocked || Number(result.approvalQueueCount ?? 0) > 0 || Number(result.createdWorkItemsCount ?? 0) > 0)
    .map((result) => ({
      id: `webmail-fallback:${result.ruleId}:${compactDate(result.checkedAt || now)}`,
      title: result.blocked
        ? `웹메일 확인 필요: ${result.ruleLabel || result.connectorId || "메일 자동 점검"}`
        : `웹메일 자동 점검 결과: ${result.ruleLabel || result.connectorId || "메일 자동 점검"}`,
      source: "webmail",
      sourceLabel: "웹메일 자동 점검",
      senderLabel: result.connectorId || "웹메일",
      body: result.blocked
        ? [
            result.userMessage || "웹메일 자동 점검을 계속하려면 사용자가 로그인/2차 인증/세션 참조를 확인해야 합니다.",
            "안전 경계: 아이디, 비밀번호, 세션 쿠키 원문은 저장하거나 AI에게 전달하지 않습니다.",
            "자동 점검은 보낸 사람, 제목, 시간, 첨부 여부 같은 목록 메타데이터만 읽습니다.",
          ].join("\n")
        : [
            result.userMessage || "웹메일 자동 점검이 업무 후보를 승인함에 올렸습니다.",
            `답장/승인 후보 ${Number(result.approvalQueueCount ?? 0)}건, 일정 후보 ${Number(result.calendarCandidateCount ?? 0)}건, 첨부 후보 ${Number(result.attachmentCandidateCount ?? 0)}건을 분리했습니다.`,
            `본문 preview는 업무 후보 ${Number(result.bodyPreviewAllowedCount ?? 0)}건만 제한 확인했고, 광고/스팸 ${Number(result.bodyPreviewSkippedBeforeBodyCount ?? 0)}건은 preview 전에 제외했습니다.`,
            "메일 발송, 캘린더 등록, 첨부 이동/삭제는 사용자 마지막 확인 전까지 잠겨 있습니다.",
          ].join("\n"),
      summary: result.blocked
        ? "웹메일 세션 또는 2차 인증 확인이 필요해 자동 점검을 승인함에서 멈췄습니다."
        : `웹메일 목록 ${Number(result.messageCount ?? 0)}건 중 승인 후보 ${Number(result.approvalQueueCount ?? 0)}건을 오피스 승인함에 올렸습니다.`,
      status: result.blocked ? "needs_review" : "approval_pending",
      riskLabel: result.blocked ? "medium" : "low",
      riskSignals: [
        {
          id: `webmail-fallback:${result.ruleId}:credential-reference`,
          label: result.blocked ? "웹메일 세션 확인 필요" : "웹메일 읽기 전용 점검",
          riskLabel: "medium",
          reason: result.blocked
            ? "웹메일 점검은 브라우저 세션 참조가 준비된 뒤에만 목록 메타데이터를 읽습니다."
            : "웹메일 점검은 목록 메타데이터와 제한 preview만 사용하며 외부 발송/등록/파일 이동은 하지 않습니다.",
        },
      ],
      receivedAt: result.checkedAt || now,
      finalAction: {
        kind: result.blocked ? "connect_mailbox" : "scenario_review",
        label: result.blocked ? "웹메일 세션 확인" : "웹메일 자동 점검 결과 검토",
        requiresFinalUserPresence: true,
        readiness: result.blocked ? "user_presence_required" : "ready_for_review",
        blockedReason: result.blocked
          ? "2차 인증 또는 브라우저 세션 참조 확인 전에는 웹메일 자동 점검을 실행하지 않습니다."
          : "자동 점검 결과는 승인함 검토까지만 진행했고 실제 발송, 등록, 첨부 이동은 마지막 확인 전까지 차단됩니다.",
        checklist: result.blocked
          ? [
              "웹메일 로그인 창에서 사용자가 직접 로그인/2차 인증 완료",
              "브라우저 세션 참조만 저장",
              "자동 점검은 목록 메타데이터만 읽도록 유지",
            ]
          : [
              "답장 후보와 일정 후보 확인",
              "첨부 후보는 로컬 사본 정리 승인 카드에서 확인",
              "업무 후보만 제한 preview, 광고/스팸은 본문 전 제외",
              "외부 실행은 마지막 확인 전까지 잠금",
            ],
      },
      webmailFallback: {
        status: result.status,
        planStatus: result.webmailPlan?.status ?? "",
        checkedAt: result.checkedAt || now,
        domCaptureStatus: result.webmailDomCapture?.status ?? "",
        domExtractionStatus: result.webmailDomExtraction?.status ?? "",
        domRecoveryStatus: result.webmailDomRecoveryGuide?.status ?? "",
        domRecoveryReasonLabel: result.webmailDomRecoveryGuide?.reasonLabel ?? "",
        domRecoveryNextAction: result.webmailDomRecoveryGuide?.nextUserAction ?? "",
        domRecoveryChecklist: Array.isArray(result.webmailDomRecoveryGuide?.checklist)
          ? result.webmailDomRecoveryGuide.checklist.slice(0, 5)
          : [],
        messageCount: Number(result.messageCount ?? 0),
        ignoredItemsCount: Number(result.ignoredItemsCount ?? 0),
        approvalQueueCount: Number(result.approvalQueueCount ?? 0),
        attachmentCandidateCount: Number(result.attachmentCandidateCount ?? 0),
        calendarCandidateCount: Number(result.calendarCandidateCount ?? 0),
        bodyPreviewAllowedCount: Number(result.bodyPreviewAllowedCount ?? 0),
        bodyPreviewSkippedBeforeBodyCount: Number(result.bodyPreviewSkippedBeforeBodyCount ?? 0),
        credentialReferenceId: result.credentialReferenceId ?? "",
        credentialReferenceCount: Number(result.credentialReferenceCount ?? 0),
        credentialReferencePolicy: result.credentialReferencePolicy ?? "os_keychain_reference_only_ai_secret_unreadable",
        aiSecretReadable: false,
        classificationSummary: `목록 ${Number(result.messageCount ?? 0)}건 · 승인 후보 ${Number(result.approvalQueueCount ?? 0)}건 · 제외 ${Number(result.ignoredItemsCount ?? 0)}건`,
        filterEvidenceLabel: `광고/뉴스레터/스팸 ${Number(result.ignoredItemsCount ?? 0)}건은 본문 preview 전 제외`,
        approvalEvidenceLabel: `답장 후보 ${Number(result.approvalQueueCount ?? 0)}건 · 일정 ${Number(result.calendarCandidateCount ?? 0)}건 · 첨부 ${Number(result.attachmentCandidateCount ?? 0)}건`,
        finalActionLockLabel: "메일 발송, 캘린더 등록, 첨부 이동/삭제는 사용자 마지막 확인 전 잠금",
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
    }));
}

export function mapProviderCandidatesToInboxItems(report, now, providerReads = [], { signatureFor = null } = {}) {
  if (!report?.candidates) return [];
  const messageById = createProviderMessageMap(providerReads);
  const messageByConnectorAndId = createProviderMessageByConnectorMap(providerReads);
  return report.candidates
    .filter((candidate) => candidate.shouldCreateWorkItem)
    .flatMap((candidate) => {
      // 계정이 여러 개면 제공사 메일 id 가 겹칠 수 있어, 받은 연결까지 맞춰 원문 메일을 찾는다.
      const located = candidate.sourceConnectorId
        ? messageByConnectorAndId.get(`${candidate.sourceConnectorId}\u0000${candidate.sourceId}`)
        : null;
      const message = located?.message ?? messageById.get(candidate.sourceId);
      const connectorId = located?.connectorId ?? candidate.sourceConnectorId ?? "";
      if (candidate.sourceKind === "mail" && isWorkCardNoise(message ?? {}, classifyMailRow(message ?? {}, candidate))) return [];
      // 답장 초안 끝에 받은 계정의 서명(명함·이름·없음)을 붙인다. AI 초안은 이미 같은 서명을 붙였으면 다시 붙지 않는다.
      const signed = candidate.sourceKind === "mail" && candidate.draftReply && typeof signatureFor === "function"
        ? { ...candidate, draftReply: appendMailSignature(candidate.draftReply, signatureFor(mailAccountKeyFrom({
            accountId: message?.sourceAccountId,
            messageId: message?.messageId ?? candidate.sourceId,
            connectorId: connectorId || candidate.sourceConnectorId || report?.connectorIds?.[0] || "",
          }))) }
        : candidate;
      return mapProviderCandidateToInboxItems(signed, message, report, now, connectorId).map(item => candidate.sourceKind === "mail" ? { ...item, cardOrigin: "mail_scan" } : item);
    });
}

function countAttachmentReviewCandidates(report, providerReads = []) {
  if (!report?.candidates) return 0;
  const messageById = createProviderMessageMap(providerReads);
  return report.candidates.filter((candidate) => {
    if (candidate.sourceKind !== "mail" || candidate.shouldCreateWorkItem !== true) return false;
    const message = messageById.get(candidate.sourceId);
    if (message?.hasAttachments === true) return true;
    return isAttachmentReviewText([
      candidate.title,
      candidate.summary,
      candidate.reportText,
      candidate.draftReply,
      message?.subject,
      message?.snippet,
    ].filter(Boolean).join(" "));
  }).length;
}

function mapProviderCandidateToInboxItems(candidate, message, report, now, messageConnectorId = "") {
  // 메일 한 통에 카드 한 장: 배경 점검과 수동 점검이 같은 id(mail:<연결>:<메일 지문>)를 만든다.
  const sourceConnectorId = sanitizeText(
    messageConnectorId || candidate.sourceConnectorId || report?.connectorIds?.[0] || candidate.sourceProviderId || "mail",
  );
  const baseId = candidate.sourceKind === "mail"
    ? createMailWorkCardId(sourceConnectorId, {
        rfcMessageId: message?.rfcMessageId,
        messageId: message?.messageId ?? candidate.sourceId,
      })
    : `automation:${candidate.id}`;
  const receivedAt = sanitizeIso(message?.receivedAt, now);
  const approvalQueue = candidate.approvalQueue ?? [];
  const operations = approvalQueue.map((request) => request.operationKind);
  const replyOperation = approvalQueue.find((request) => request.operationKind === "send_email");
  const calendarOperation = approvalQueue.find((request) => request.operationKind === "create_calendar_event");
  const riskSignals = approvalQueue.map((request, index) => ({
    id: `${candidate.id}:risk:${index}`,
    label: operationLabel(request.operationKind),
    riskLabel: "medium",
    reason: "업무팩 자동 점검은 초안과 승인 후보만 만들고 외부 발송, 일정 등록, 파일 공유는 실행하지 않습니다.",
  }));
  const sourceLabel = sourceLabelForProviderCandidate(candidate, report);
  const scheduleCandidate = candidate.calendarDraft
    ? createProviderScheduleCandidate(baseId, candidate, receivedAt, report)
    : null;
  const sourceEvidence = createProviderMailWorkSourceEvidence({
    candidate,
    message,
    report,
    receivedAt,
    sourceLabel,
    scheduleCandidate,
    operations,
    connectorId: sourceConnectorId,
  });
  const aiDrafted = candidate.draftSource === "ai_draft_guarded";
  // 먼저 볼 순서(급함/보통/낮음)·업무 종류·담당 AI 직원. 같은 메일에서 나온 카드는 모두 같은 값을 쓴다.
  const triageFields = mailCardTriageFields(candidate);

  const mainItem = {
    id: baseId,
    title: sanitizeText(candidate.title || message?.subject || "자동 업무 점검"),
    ...triageFields,
    source: sourceForProviderCandidate(candidate.sourceProviderId),
    sourceLabel,
    senderLabel: sanitizeText(message?.from ?? providerLabel(candidate.sourceProviderId)),
    body: sanitizeTextBlock(candidate.reportText || message?.snippet || candidate.summary || candidate.title),
    summary: sanitizeText(candidate.summary),
    status: candidate.draftReply ? "draft_ready" : "needs_review",
    riskLabel: operations.length > 0 ? "medium" : "low",
    riskSignals,
    receivedAt,
    ...(candidate.draftReply
      ? {
          draft: {
            id: `${candidate.id}:draft`,
            toneLabel: aiDrafted ? "AI 답장 초안" : "업무팩 답장 초안",
            // body 는 화면·알림용 가린 사본, sendBody 는 실제로 나갈 본문(주소·전화번호 유지, 키/토큰만 제거).
            body: sanitizeTextBlock(candidate.draftReply),
            sendBody: cleanOutgoingMailBody(stripInternalDraftLabelLine(candidate.draftReply)),
            draftSource: aiDrafted ? "ai_draft_guarded" : "rule_template",
            operationKind: replyOperation?.operationKind ?? "send_email",
            requiresApprovalBeforeSend: true,
          },
          finalAction: {
            kind: "send_email",
            label: "메일 발송",
            requiresFinalUserPresence: true,
            readiness: "ready_for_final_confirmation",
            blockedReason: "업무팩은 답장 초안까지만 만들며 실제 발송은 최종 확인 전까지 차단됩니다.",
            mailSendApprovalGate: {
              policy: "work_queue_approve_only",
              decision: "approve",
              finalRoute: "included",
              sourceContract: "work_queue_review_to_approval_candidate_to_final_confirmation_to_execution_log",
              draftBodySource: "approval_preview",
              sendCheckSummary: "업무팩 자동 점검이 승인 후보로 올린 메일 초안입니다.",
              externalMutationBeforeGate: false,
            },
            checklist: [
              "수신자와 문의 맥락 확인",
              "답장 문구와 일정 후보 확인",
              "개인정보와 첨부 여부 확인",
              "발송은 finalUserPresence=true 확인 뒤에만 실행",
            ],
          },
        }
      : {}),
    ...(sourceEvidence ? { sourceEvidence } : {}),
    ...(scheduleCandidate ? { schedules: [scheduleCandidate] } : {}),
  };

  const items = [mainItem];
  if (calendarOperation && candidate.calendarDraft) {
    items.push({
      id: `${baseId}:calendar`,
      title: `일정 등록 확인: ${sanitizeText(candidate.title || message?.subject || "자동 일정 후보")}`.slice(0, 120),
      ...triageFields,
      source: sourceForProviderCandidate(candidate.sourceProviderId),
      sourceLabel,
      senderLabel: sanitizeText(message?.from ?? providerLabel(candidate.sourceProviderId)),
      body: sanitizeTextBlock(candidate.calendarDraft),
      summary: calendarProviderSummary(report),
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [
        {
          id: `${candidate.id}:calendar-risk`,
          label: "일정 등록",
          riskLabel: "medium",
          reason: "캘린더 등록은 외부 변경이므로 앱 최종 확인 전에는 실행하지 않습니다.",
        },
      ],
      receivedAt,
      draft: {
        id: `${candidate.id}:calendar-draft`,
        toneLabel: "업무팩 일정 후보",
        body: sanitizeTextBlock(candidate.calendarDraft),
        operationKind: "create_calendar_event",
        requiresApprovalBeforeSend: true,
      },
      schedules: [createProviderScheduleCandidate(`${baseId}:calendar`, candidate, receivedAt, report)],
      finalAction: {
        kind: "create_calendar_event",
        label: "일정 등록",
        requiresFinalUserPresence: true,
        readiness: "adapter_not_connected",
        blockedReason: "캘린더 등록은 읽기/후보 생성과 분리되어 있으며 사용자가 최종 확인하기 전까지 차단됩니다.",
        checklist: [
          "일정 제목 확인",
          "시작/종료 시간 확인",
          "참석자와 알림 설정 확인",
          "캘린더 등록은 finalUserPresence=true 확인 뒤에만 실행",
        ],
      },
    });
  }

  if (shouldCreateAttachmentDownloadReviewItem(candidate, message)) {
    const connectorId = sourceConnectorId;
    const messageSubject = sanitizeText(candidate.title || message?.subject || "메일 첨부 후보");
    items.push({
      id: `${baseId}:attachment-download-review`,
      title: `첨부 다운로드 검토: ${messageSubject}`.slice(0, 120),
      ...triageFields,
      source: sourceForProviderCandidate(candidate.sourceProviderId),
      sourceLabel,
      senderLabel: sanitizeText(message?.from ?? providerLabel(candidate.sourceProviderId)),
      body: [
        sanitizeTextBlock(candidate.reportText || message?.snippet || candidate.summary || messageSubject),
        "",
        "첨부 후보가 감지됐지만 이 단계에서는 다운로드, 파일 이동, 삭제, 덮어쓰기, 외부 공유를 실행하지 않습니다.",
        "사용자가 검토하면 IMAP 첨부를 로컬 임시 폴더에만 내려받고, 내려받은 사본만 폴더 정리 승인 카드로 넘깁니다.",
      ].filter(Boolean).join("\n"),
      summary: "메일 첨부 후보를 다운로드 검토 카드로 분리했습니다. 로컬 사본 정리와 원본 메일 변경은 사용자 승인 전까지 잠겨 있습니다.",
      status: "approval_pending",
      riskLabel: "medium",
      riskSignals: [
        {
          id: `${candidate.id}:attachment-download-risk`,
          label: "첨부 다운로드/정리",
          riskLabel: "medium",
          reason: "첨부 다운로드와 로컬 폴더 정리는 파일 변경 후보이므로 사용자 승인 전에는 실행하지 않습니다.",
        },
      ],
      receivedAt,
      sourceEvidence: {
        connectorId,
        providerId: sanitizeText(candidate.sourceProviderId || "mail"),
        mailboxLabel: sanitizeText(message?.mailboxId ?? "INBOX") || "INBOX",
        messageSubject,
        senderPreview: sanitizeText(message?.from ?? providerLabel(candidate.sourceProviderId)),
        receivedAt,
        messageSnippet: sanitizeTextBlock(message?.snippet || candidate.summary || ""),
        detectedIntentLabels: ["메일 첨부", "다운로드 검토", "로컬 사본 정리"],
        approvalCandidateLabels: ["첨부 다운로드 검토", "폴더 정리 승인 카드", "원본 메일 유지"],
        mailAttachmentOrganizer: {
          contract: "mail_attachment_download_to_local_folder_plan_approval",
          connectorId,
          providerId: sanitizeText(candidate.sourceProviderId || "mail"),
          sourceMessageId: sanitizeText(candidate.sourceId || message?.messageId || ""),
          messageSubject,
          attachmentCandidateCount: 1,
          downloadedAttachmentCount: 0,
          downloadStatus: "approval_required_before_download",
          stagingHandoffKind: "stage_mail_attachments_folder_plan",
          originalMailMutation: false,
          externalShareBeforeApproval: false,
        },
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
      draft: {
        id: `${candidate.id}:attachment-download-review-draft`,
        toneLabel: "첨부 다운로드 검토",
        operationKind: "stage_approval",
        requiresApprovalBeforeSend: true,
        body: [
          "첨부 다운로드 검토",
          "",
          `메일: ${messageSubject}`,
          `연결: ${connectorId}`,
          "실행 잠금: 다운로드, 이동, 삭제, 덮어쓰기, 외부 공유는 사용자 승인 전까지 차단",
          "다음 단계: 승인 후 로컬 임시 폴더에 내려받은 사본만 폴더 정리 승인 카드로 넘김",
        ].join("\n"),
      },
      finalAction: {
        kind: "scenario_review",
        label: "첨부 다운로드 및 폴더 정리 검토",
        requiresFinalUserPresence: true,
        readiness: "ready_for_review",
        blockedReason: "첨부 다운로드와 로컬 파일 정리는 사용자가 검토하기 전까지 실행하지 않습니다.",
        checklist: [
          "다운로드할 첨부 후보 확인",
          "로컬 임시 폴더 저장만 허용",
          "원본 메일/첨부 삭제 금지",
          "내려받은 사본만 폴더 정리 승인 카드로 전달",
        ],
      },
    });
  }

  return items;
}

function shouldCreateAttachmentDownloadReviewItem(candidate, message) {
  if (candidate.sourceKind !== "mail") return false;
  if (message?.hasAttachments === true) return true;
  return isAttachmentReviewText([
    candidate.title,
    candidate.summary,
    candidate.reportText,
    candidate.draftReply,
    message?.subject,
    message?.snippet,
  ].filter(Boolean).join(" "));
}

function isAttachmentReviewText(value) {
  return /첨부|파일|자료|문서|계약서|견적서|제안서|세금계산서|청구서|송장|invoice|receipt|quote|proposal|contract|attachment|attached|document|report|spreadsheet|xlsx|xls|pdf|csv|docx/iu.test(
    String(value ?? ""),
  );
}

function createProviderMessageMap(providerReads = []) {
  const messageById = new Map();
  for (const read of providerReads) {
    for (const message of read.messages ?? []) {
      messageById.set(message.messageId, message);
    }
  }
  return messageById;
}

function createProviderMessageByConnectorMap(providerReads = []) {
  const located = new Map();
  for (const read of providerReads) {
    for (const message of read.messages ?? []) {
      located.set(`${read.connectorId}\u0000${message.messageId}`, { message, connectorId: read.connectorId });
    }
  }
  return located;
}

function createProviderScheduleCandidate(baseId, candidate, receivedAt, report) {
  const start = new Date(receivedAt);
  if (!Number.isFinite(start.getTime())) start.setTime(Date.now());
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1);
  const busyCount = report?.calendarBusyWindows?.length ?? 0;

  return {
    id: `${baseId}:schedule`,
    label: sanitizeText(candidate.calendarDraft ?? "업무팩이 감지한 일정 후보"),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    conflictNote:
      busyCount > 0
        ? `연결된 캘린더의 바쁜 시간 ${busyCount}개를 함께 읽었습니다. 최종 등록 전 다시 확인합니다.`
        : "개인/업무 캘린더 가능 시간은 최종 등록 전 다시 확인합니다.",
  };
}

function createProviderMailWorkSourceEvidence({
  candidate,
  message,
  report,
  receivedAt,
  sourceLabel,
  scheduleCandidate,
  operations,
  connectorId: messageConnectorId = "",
}) {
  if (candidate.sourceKind !== "mail") return null;
  // 이 메일을 실제로 받은 연결 — 답장은 이 연결에서 나가야 한다(계정이 여럿이어도 첫 계정이 아니라).
  const connectorId = sanitizeText(
    messageConnectorId || candidate.sourceConnectorId || report?.connectorIds?.[0] || candidate.sourceProviderId || "mail",
  );
  // 답장 받을 주소 원문은 승인 카드에만 싣는다. AI 프롬프트·알림·요약·로그에는 쓰지 않는다.
  const replyToAddress = readHiddenReplyToAddress(message);
  // 실제 제목 원문(`Re: 원제목`의 재료). 배경 읽기의 보이는 subject 는 전화번호·주소를 가린 사본이라
  // 숨겨 나른 원문을 쓴다. 가린 사본밖에 없으면 비워 둔다.
  const originalSubject = resolveOriginalMailSubject(message);
  const providerId = sanitizeText(candidate.sourceProviderId || "mail");
  const messageSubject = sanitizeText(candidate.title || message?.subject || "메일 업무 후보");
  const senderPreview = sanitizeText(message?.from ?? providerLabel(candidate.sourceProviderId));
  const calendarBusyWindowCount = Math.max(0, Math.min(99, Math.round(Number(report?.calendarBusyWindows?.length ?? 0))));
  const operationKinds = Array.from(new Set((operations ?? []).map((operation) => sanitizeText(operation)).filter(Boolean)));
  const approvalCandidateLabels = operationKinds.map(operationLabel).filter(Boolean);
  const hasReplyDraft = Boolean(candidate.draftReply);
  const hasCalendarCandidate = Boolean(candidate.calendarDraft);
  const reviewItems = [
    {
      id: "reply-draft",
      label: "답장 초안",
      state: hasReplyDraft ? "needs_review" : "missing",
      detail: hasReplyDraft
        ? "AI가 답장 초안만 준비했고 실제 발송은 최종 확인 전까지 잠겨 있습니다."
        : "답장 초안은 아직 준비되지 않았습니다.",
    },
    {
      id: "calendar-candidate",
      label: "일정 후보",
      state: hasCalendarCandidate ? "needs_review" : "missing",
      detail: hasCalendarCandidate
        ? scheduleCandidate?.conflictNote || "일정 후보는 캘린더 충돌 확인과 함께 최종 검토합니다."
        : "메일 안에서 일정 후보가 감지되지 않았습니다.",
    },
    {
      id: "recipient",
      label: "수신자",
      state: "needs_review",
      detail: "원문 이메일 주소는 가리고, 답장 대상은 최종 승인 단계에서 다시 확인합니다.",
    },
  ];

  return {
    connectorId,
    providerId,
    mailboxLabel: sanitizeText(message?.mailboxId ?? "INBOX") || "INBOX",
    messageSubject,
    senderPreview,
    replyToLabel: senderPreview,
    mailThreadLabel: sourceLabel,
    ...(originalSubject ? { originalSubject } : {}),
    ...(replyToAddress ? { replyToAddress } : {}),
    // 답장 스레딩용 기계 필드 — normalizeSourceEvidence 화이트리스트와 짝.
    // 이메일 가림 정규식을 쓰면 진짜 Message-ID 가 `[redacted-email]`이 되어 스레딩이 끊긴다.
    rfcMessageId: sanitizeRfcMessageIdField(message?.rfcMessageId),
    messageId: message?.messageId ?? candidate.sourceId,
    inReplyTo: sanitizeRfcMessageIdField(message?.inReplyTo),
    draftPreview: sanitizeTextBlock(candidate.draftReply || ""),
    receivedAt,
    messageSnippet: sanitizeTextBlock(message?.snippet || candidate.summary || candidate.reportText || ""),
    detectedIntentLabels: [
      "메일 업무 후보",
      ...(hasReplyDraft ? ["답장 초안"] : []),
      ...(hasCalendarCandidate ? ["일정 후보", "캘린더 충돌 확인"] : []),
    ],
    approvalCandidateLabels,
    calendarCandidateText: sanitizeText(candidate.calendarDraft || ""),
    calendarTimeRangeLabel: scheduleCandidate ? "내일 10:00-11:00 후보" : "",
    calendarStartsAt: scheduleCandidate?.startsAt,
    calendarEndsAt: scheduleCandidate?.endsAt,
    calendarAttendeeLabels: hasCalendarCandidate ? ["보낸 사람 확인"] : [],
    calendarReminderLabel: hasCalendarCandidate ? "등록 전 알림 설정 확인" : "",
    calendarConflictLabel:
      calendarBusyWindowCount > 0 ? `바쁜 시간 ${calendarBusyWindowCount}개 확인` : "최종 등록 전 캘린더 다시 확인",
    calendarBusyWindowCount,
    scheduleWindowLabel: scheduleCandidate ? scheduleCandidate.conflictNote : "",
    mailThreadRecipientDecision: {
      replyTargetLabel: "보낸 사람 확인",
      recipientDecisionSummary: "답장 후보는 만들었지만 원문 수신자와 참조자는 최종 확인 전까지 자동 발송하지 않습니다.",
      sendCandidateLabels: hasReplyDraft ? ["답장 후보"] : [],
      holdCandidateLabels: ["원문 이메일 주소 가림", "관련 담당자 최종 확인"],
      excludeCandidateLabels: [],
      learningDecisionHints: ["저장된 수신자 습관은 참고만 하며 최종 확인이 우선입니다."],
      privacyBoundary: "메일 주소, 비밀번호, 로그인 승인 정보는 표시하거나 AI 본문에 넣지 않습니다.",
    },
    mailWorkReview: {
      proof: "mail_work_review_to_final_confirmation",
      workScenarioLabel: hasCalendarCandidate ? "메일 답장 + 일정 후보" : "메일 답장 후보",
      actionCandidateLabel: approvalCandidateLabels.join(" / ") || "검토 후보",
      originalSummary: sanitizeTextBlock(message?.snippet || candidate.summary || "메일 원문 요약 확인 필요"),
      draftSummary: sanitizeTextBlock(candidate.draftReply || candidate.calendarDraft || "초안 확인 필요"),
      replyMethodLabel: hasReplyDraft ? "답장 초안 수정 후 승인 발송" : "업무 후보 검토",
      sendDecisionReason: "중요 업무 메일로 분류됐지만 외부 발송과 캘린더 등록은 최종 확인 전까지 실행하지 않습니다.",
      editFocusLabel: "수신자, 답장 문구, 일정 시간, 충돌 여부",
      attachmentSummary: "첨부/링크 후보는 별도 다운로드 검토 카드에서 원본을 건드리지 않고 확인합니다.",
      finalApprovalBoundary: "메일 발송과 캘린더 등록은 각각 사용자 최종 확인 전까지 잠겨 있습니다.",
      privacyBoundary: "원문 이메일 주소와 계정 비밀번호는 마스킹하고, 승인 화면에는 필요한 요약만 표시합니다.",
      reviewChecklistLabels: ["원문 맥락", "수신자", "답장 문구", "일정 시간", "캘린더 충돌", "첨부/링크"],
      decisionReasonChips: [
        {
          id: "decision",
          label: "AI 판단",
          value: hasCalendarCandidate ? "답장+일정 후보" : "답장 후보",
          detail: "자동 실행 없이 검토 후보만 만들었습니다.",
          state: "review",
        },
        {
          id: "calendar",
          label: "캘린더",
          value: calendarBusyWindowCount > 0 ? `바쁜 시간 ${calendarBusyWindowCount}개` : "최종 확인 필요",
          detail: "연결된 캘린더는 후보 시간 충돌 확인에만 사용했습니다.",
          state: "locked",
        },
      ],
      reviewItems,
    },
    mailWorkBundle: {
      contract: "mail_reply_calendar_conflict_approval_bundle",
      bundleLabel: "답장 초안 + 일정 후보 + 캘린더 충돌 확인",
      replyDraftReady: hasReplyDraft,
      calendarCandidateReady: hasCalendarCandidate,
      calendarBusyWindowCount,
      approvalOperationKinds: operationKinds,
      finalActionBoundary: "메일 발송과 캘린더 등록은 각각 사용자 최종 확인 전까지 잠금",
      nextUserAction: "답장 문구, 일정 시간, 충돌 여부를 한 카드에서 확인한 뒤 필요한 실행만 승인합니다.",
      externalMutation: false,
    },
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function calendarProviderSummary(report) {
  const busyCount = report?.calendarBusyWindows?.length ?? 0;
  if (busyCount > 0) {
    return `업무팩이 메일 내용에서 일정 후보를 감지했고 캘린더 바쁜 시간 ${busyCount}개를 함께 읽었습니다. 등록은 최종 승인 후에만 가능합니다.`;
  }
  return "업무팩이 메일 내용에서 일정 후보를 감지했습니다. 캘린더 등록은 최종 승인 후에만 가능합니다.";
}

function sourceLabelForProviderCandidate(candidate, report) {
  const connectorLabel = report?.connectorIds?.length ? report.connectorIds.slice(0, 2).join(", ") : "";
  if (candidate.calendarDraft) {
    return connectorLabel ? `업무팩 메일·일정 점검 · ${connectorLabel}` : "업무팩 메일·일정 점검";
  }
  return connectorLabel ? `업무팩 메일 점검 · ${connectorLabel}` : "업무팩 메일 점검";
}

function sourceForProviderCandidate(providerId) {
  if (providerId === "imap_smtp") return "imap_smtp";
  if (providerId === "gmail") return "gmail";
  if (providerId === "outlook") return "outlook";
  return "email";
}

function mapTriggerWorkItemsToInboxItems(items = [], now, signals = [], rules = []) {
  const ruleBySignalId = new Map(
    signals.map((signal) => [signal.id, rules.find((rule) => rule.id === signal.triggerId)]),
  );

  return items.map((item) => {
    const signalId = signalIdForWorkItem(item);
    const rule = signalId ? ruleBySignalId.get(signalId) : null;
    const actionPolicy = rule?.actionPolicy ?? "queue_ai_review";
    const shouldCreateDraft = actionPolicy === "queue_ai_review" && item.status === "draft_ready";
    const sourceLabel = sourceLabelForActionPolicy(actionPolicy);

    return {
      id: `trigger:${item.id}`,
      title: item.title,
      source: sourceForInbox(item.source),
      sourceLabel,
      senderLabel: rule?.label ?? "연결된 업무 도구",
      body: bodyForActionPolicy(item.body, actionPolicy),
      summary: summaryForActionPolicy(actionPolicy),
      status: shouldCreateDraft ? "draft_ready" : "needs_review",
      riskLabel: item.riskLabel,
      riskSignals: (item.riskSignals ?? []).map((signal, index) => ({
        id: signal.id ?? `${item.id}:risk:${index}`,
        label: "승인 전 확인",
        riskLabel: signal.riskLabel ?? "medium",
        reason: signal.reason ?? "외부 실행 전 앱에서 확인합니다.",
      })),
      receivedAt: item.createdAt ?? now,
      ...(shouldCreateDraft
        ? {
            draft: {
              id: `${item.id}:trigger-draft`,
              toneLabel: "AI 검토 후보",
              body: `${item.title}\n\n${item.body}\n\n외부 발송, 일정 등록, 제출은 승인 전 실행하지 않습니다.`,
              operationKind: "send_email",
              requiresApprovalBeforeSend: true,
            },
          }
        : {}),
    };
  });
}

async function createScheduleBriefingInboxItems(input) {
  const scheduleRules = input.rules.filter(isScheduleBriefingRule);
  if (scheduleRules.length === 0) return { items: [], notificationPlan: [] };

  const domain = await loadDomainRuntime();
  const planner = new domain.ModyWorkScheduleBriefingPlanner({
    now: () => new Date(input.now),
  });
  const report = planner.createReport({
    createdAt: input.now,
    workItems: [
      ...getAutomationInboxSnapshot(),
      ...(input.newInboxItems ?? []),
    ]
      .filter((item) => item.sourceLabel !== "일정 브리핑")
      .map(toScheduleBriefingWorkItem),
    horizonDays: 7,
  });

  if (report.status !== "schedule_briefing_ready") {
    return { items: [], notificationPlan: report.notificationPlan ?? [] };
  }

  const items = [];
  const weeklyRule = scheduleRules.find((rule) => rule.id === "daily-weekly-schedule-briefing");
  const urgentRule = scheduleRules.find((rule) => rule.id === "urgent-deadline-watch");
  const meetingRule = scheduleRules.find((rule) => rule.id === "meeting-reminder-watch");

  if (weeklyRule && (report.weeklyTimeline.length > 0 || report.dateConfirmationItems?.length > 0)) {
    items.push(createScheduleBriefingInboxItem({
      id: `schedule-briefing:weekly:${scheduleBriefingBucket(input.now, "daily_weekly_briefing")}`,
      title: "오늘의 1주일 일정 브리핑",
      summary: report.userMessage,
      body: report.briefingText,
      riskLabel: report.urgentDeadlineItems.length > 0 ? "medium" : "low",
      rule: weeklyRule,
      receivedAt: input.now,
      triggerRuleId: weeklyRule.id,
      scheduleBriefing: createScheduleBriefingMeta({
        kind: "weekly",
        triggerRuleId: weeklyRule.id,
        anchors: report.weeklyTimeline,
        dateConfirmationItems: report.dateConfirmationItems,
        notificationPlan: report.notificationPlan,
      }),
    }));
  }

  if (weeklyRule && report.dateConfirmationItems?.length > 0) {
    const top = report.dateConfirmationItems[0];
    items.push(createScheduleBriefingInboxItem({
      id: `schedule-briefing:date-confirmation:${safeId(top.workItemId)}:${scheduleBriefingBucket(input.now, "daily_weekly_briefing")}`,
      title: `일정 확인 필요: ${top.title}`,
      summary: `${report.dateConfirmationItems.length}건의 애매한 날짜 표현을 확인해야 알림을 정확히 잡을 수 있습니다.`,
      body: renderDateConfirmationBriefing(report.dateConfirmationItems),
      riskLabel: "medium",
      rule: weeklyRule,
      receivedAt: input.now,
      triggerRuleId: weeklyRule.id,
      scheduleBriefing: createScheduleBriefingMeta({
        kind: "date_confirmation",
        triggerRuleId: weeklyRule.id,
        dateConfirmationItems: report.dateConfirmationItems,
        notificationPlan: report.notificationPlan,
        reason: top.userMessage,
      }),
      scheduleConfirmation: {
        kind: "date_confirmation",
        sourceWorkItemId: top.workItemId,
        sourceTitle: top.title,
        sourceText: top.sourceText,
        reason: top.reason,
        question: top.userMessage,
      },
    }));
  }

  if (urgentRule && report.urgentDeadlineItems.length > 0) {
    const top = report.urgentDeadlineItems[0];
    items.push(createScheduleBriefingInboxItem({
      id: `schedule-briefing:deadline:${safeId(top.workItemId)}:${scheduleBriefingBucket(input.now, top.cadence)}`,
      title: `마감 임박: ${top.title}`,
      summary: `${report.urgentDeadlineItems.length}건의 24시간 이내 마감을 더 자주 확인해야 합니다.`,
      body: renderFocusedScheduleBriefing("마감 임박", report.urgentDeadlineItems, report.notificationPlan),
      riskLabel: top.urgency === "critical" ? "high" : "medium",
      rule: urgentRule,
      receivedAt: input.now,
      triggerRuleId: urgentRule.id,
      scheduleBriefing: createScheduleBriefingMeta({
        kind: "deadline",
        triggerRuleId: urgentRule.id,
        anchors: report.urgentDeadlineItems,
        notificationPlan: report.notificationPlan,
      }),
    }));
  }

  if (meetingRule && report.meetingReminders.length > 0) {
    const top = report.meetingReminders[0];
    items.push(createScheduleBriefingInboxItem({
      id: `schedule-briefing:meeting:${safeId(top.workItemId)}:${scheduleBriefingBucket(input.now, top.cadence)}`,
      title: `미팅 알림: ${top.title}`,
      summary: `${report.meetingReminders.length}건의 24시간 이내 미팅을 알려드립니다.`,
      body: renderFocusedScheduleBriefing("미팅 알림", report.meetingReminders, report.notificationPlan),
      riskLabel: "medium",
      rule: meetingRule,
      receivedAt: input.now,
      triggerRuleId: meetingRule.id,
      scheduleBriefing: createScheduleBriefingMeta({
        kind: "meeting",
        triggerRuleId: meetingRule.id,
        anchors: report.meetingReminders,
        notificationPlan: report.notificationPlan,
      }),
    }));
  }

  return {
    items,
    notificationPlan: report.notificationPlan ?? [],
  };
}

function applyScheduleAdaptiveNextRuleStates(input) {
  const scheduleRules = input.rules.filter(isScheduleBriefingRule);
  if (scheduleRules.length === 0 || !Array.isArray(input.notificationPlan)) return;

  const deadlineMinutes = minPlanMinutes(input.notificationPlan, [
    "deadline_critical_15m",
    "deadline_urgent_30m",
    "deadline_soon_2h",
  ]);
  const meetingMinutes = minPlanMinutes(input.notificationPlan, [
    "meeting_30m_before",
    "meeting_3h_before",
    "meeting_day_before",
  ]);
  const weeklyMinutes = minPlanMinutes(input.notificationPlan, ["daily_weekly_briefing"]);

  for (const rule of scheduleRules) {
    const minutes =
      rule.id === "urgent-deadline-watch"
        ? deadlineMinutes
        : rule.id === "meeting-reminder-watch"
          ? meetingMinutes
          : rule.id === "daily-weekly-schedule-briefing"
            ? weeklyMinutes
            : undefined;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    const previous = input.nextRuleStates[rule.id] ?? createEmptyRuleState();
    input.nextRuleStates[rule.id] = {
      ...previous,
      adaptiveCadenceMinutes: minutes,
      nextCheckAt: nextCheckIso(input.now, minutes),
    };
  }
}

function minPlanMinutes(notificationPlan, cadences) {
  const cadenceSet = new Set(cadences);
  const minutes = notificationPlan
    .filter((plan) => cadenceSet.has(plan.cadence))
    .map((plan) => Number(plan.nextCheckHintMinutes))
    .filter((value) => Number.isFinite(value) && value > 0);
  return minutes.length > 0 ? Math.min(...minutes) : undefined;
}

function scheduleBriefingBucket(now, cadence) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return compactDate(String(now));
  if (cadence === "daily_weekly_briefing" || cadence === "relaxed_daily") {
    return compactDate(date.toISOString()).slice(0, 8);
  }
  const minutes = scheduleCadenceMinutes(cadence);
  const bucketStart = Math.floor(date.getTime() / (minutes * 60_000)) * minutes * 60_000;
  return `${compactDate(new Date(bucketStart).toISOString()).slice(0, 12)}-${minutes}m`;
}

function scheduleCadenceMinutes(cadence) {
  if (cadence === "deadline_critical_15m") return 15;
  if (cadence === "deadline_urgent_30m") return 30;
  if (cadence === "deadline_soon_2h") return 120;
  if (cadence === "meeting_30m_before") return 15;
  if (cadence === "meeting_3h_before") return 60;
  if (cadence === "meeting_day_before") return 180;
  return 1440;
}

function createScheduleAdaptiveNextCheckSummary(rules, nextRuleStates) {
  return rules
    .filter(isScheduleBriefingRule)
    .map((rule) => ({
      ruleId: rule.id,
      nextCheckAt: nextRuleStates[rule.id]?.nextCheckAt ?? "",
      adaptiveCadenceMinutes: Number(nextRuleStates[rule.id]?.adaptiveCadenceMinutes ?? rule.cadenceMinutes),
    }))
    .filter((item) => item.nextCheckAt)
    .slice(0, 6);
}

function createScheduleBriefingInboxItem(input) {
  return {
    id: input.id,
    title: input.title,
    source: "calendar",
    sourceLabel: "일정 브리핑",
    senderLabel: input.rule.label,
    body: input.body,
    summary: input.summary,
    status: "needs_review",
    riskLabel: input.riskLabel,
    riskSignals: [
      {
        id: `${input.id}:read-only`,
        label: "읽기 전용 브리핑",
        riskLabel: input.riskLabel === "high" ? "high" : "medium",
        reason: "마감/일정 알림은 앱 안의 현황 카드만 만들고 외부 발송이나 일정 등록은 하지 않습니다.",
      },
    ],
    receivedAt: input.receivedAt,
    triggerRuleId: input.triggerRuleId,
    ...(input.scheduleBriefing ? { scheduleBriefing: input.scheduleBriefing } : {}),
    ...(input.scheduleConfirmation ? { scheduleConfirmation: input.scheduleConfirmation } : {}),
  };
}

function createScheduleBriefingMeta(input) {
  const anchors = Array.isArray(input.anchors) ? input.anchors : [];
  const dateConfirmationItems = Array.isArray(input.dateConfirmationItems) ? input.dateConfirmationItems : [];
  const topAnchor = anchors[0] ?? null;
  const plan = scheduleNotificationPlanForMeta(input.kind, topAnchor, input.notificationPlan ?? []);
  const sourceWorkItemIds = [
    ...anchors.map((anchor) => anchor.workItemId),
    ...dateConfirmationItems.map((item) => item.workItemId),
  ]
    .filter(Boolean)
    .filter((id, index, list) => list.indexOf(id) === index)
    .slice(0, 12);

  return {
    kind: input.kind,
    triggerRuleId: input.triggerRuleId,
    sourceWorkItemIds,
    anchorCount: Math.max(anchors.length, dateConfirmationItems.length),
    nextCheckAt: topAnchor?.nextReminderAt ?? plan?.nextCheckAt,
    nextCheckHintMinutes:
      Number(plan?.nextCheckHintMinutes) ||
      (topAnchor?.cadence ? scheduleCadenceMinutes(topAnchor.cadence) : undefined),
    attentionLevel: topAnchor?.attentionLevel ?? plan?.attentionLevel ?? "digest",
    reminderLabel: topAnchor?.reminderLabel ?? plan?.label ?? "",
    reason:
      input.reason ??
      topAnchor?.userMessage ??
      plan?.reason ??
      "앞으로의 일정과 마감을 읽기 전용으로 정리했습니다.",
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function scheduleNotificationPlanForMeta(kind, topAnchor, notificationPlan) {
  if (!Array.isArray(notificationPlan)) return null;
  if (kind === "deadline") {
    return notificationPlan.find((plan) => plan.cadence === topAnchor?.cadence) ??
      notificationPlan.find((plan) => String(plan.cadence).startsWith("deadline_")) ??
      null;
  }
  if (kind === "meeting") {
    return notificationPlan.find((plan) => plan.cadence === topAnchor?.cadence) ??
      notificationPlan.find((plan) => String(plan.cadence).startsWith("meeting_")) ??
      null;
  }
  return notificationPlan.find((plan) => plan.cadence === "daily_weekly_briefing") ?? null;
}

async function dispatchScheduleBriefingNotifications(input) {
  if (input.items.length === 0) return [];
  const dispatches = [];
  for (const item of input.items) {
    const rule = input.rules.find((candidate) => candidate.id === item.triggerRuleId);
    const channels = rule?.notificationChannels ?? {};
    const message = renderScheduleNotificationMessage(item, input.now);
    if (channels.os === true) {
      if (typeof input.options.showScheduleOsNotification === "function") {
        dispatches.push(await input.options.showScheduleOsNotification({
          title: item.title,
          body: item.summary,
          message,
          workItemId: item.id,
          ruleId: rule.id,
          queueFilter: queueFilterForScheduleRule(rule.id),
        }));
      } else {
        dispatches.push({
          status: "os_notification_unavailable",
          channel: "os",
          ruleId: rule?.id,
          externalMutation: false,
        });
      }
    }
    if (channels.telegram === true) {
      if (typeof input.options.sendScheduleNotification === "function") {
        dispatches.push(await input.options.sendScheduleNotification({
          channel: "telegram",
          allowExternalSend: true,
          title: item.title,
          message,
          workItemId: item.id,
          ruleId: rule.id,
          queueFilter: queueFilterForScheduleRule(rule.id),
        }));
      } else {
        dispatches.push({
          status: "telegram_notification_unavailable",
          channel: "telegram",
          ruleId: rule?.id,
          externalMutation: false,
        });
      }
    }
  }
  return dispatches;
}

function renderScheduleNotificationMessage(item, now) {
  return [
    "ModyCrew 일정 알림",
    "",
    item.title,
    item.summary,
    "",
    cleanNotificationBody(item.body).slice(0, 1200),
    "",
    `기준 시각: ${now}`,
    "앱에서 확인하고 필요한 발송/등록은 최종 승인 후 실행됩니다.",
  ]
    .filter(Boolean)
    .join("\n");
}

function queueFilterForScheduleRule(ruleId) {
  if (ruleId === "urgent-deadline-watch") return "deadline";
  if (ruleId === "meeting-reminder-watch") return "meeting";
  if (ruleId === "daily-weekly-schedule-briefing") return "meeting";
  return "";
}

function cleanNotificationBody(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

function renderFocusedScheduleBriefing(title, anchors, notificationPlan) {
  const planText = notificationPlan
    .map((plan) => `- ${plan.label}: ${plan.reason} 다음 확인 ${formatScheduleTime(plan.nextCheckAt)}`)
    .join("\n");
  const itemText = anchors
    .slice(0, 8)
    .map((anchor) => {
      const nextReminder = anchor.nextReminderAt
        ? ` 다음 확인 ${formatScheduleTime(anchor.nextReminderAt)} · ${sanitizeText(anchor.reminderLabel ?? "")}`
        : "";
      const context = anchor.contextLabel ? ` · ${sanitizeText(anchor.contextLabel)}` : "";
      return `- ${anchor.userMessage}${nextReminder}${context}`;
    })
    .join("\n");
  return [
    `ModyCrew ${title}`,
    "",
    itemText || "- 확인할 항목이 없습니다.",
    "",
    "알림 방식",
    planText || "- 기본 일정 브리핑으로 묶어 보여줍니다.",
    "",
    "안전 경계: 이 카드는 읽기 전용 알림이며 외부 발송/등록을 하지 않습니다.",
  ].join("\n");
}

function formatScheduleTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return sanitizeText(value ?? "확인 필요");
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function renderDateConfirmationBriefing(items) {
  const itemText = items
    .slice(0, 8)
    .map((item) => `- ${sanitizeText(item.title)}: ${sanitizeText(item.userMessage)} (${sanitizeText(item.reason)})`)
    .join("\n");
  return [
    "ModyCrew 일정 확인 필요",
    "",
    "아래 업무는 날짜 표현이 애매해 임의로 마감/알림 시각을 확정하지 않았습니다.",
    "",
    itemText || "- 확인할 항목이 없습니다.",
    "",
    "사용자가 날짜와 시간을 확인하면 그때 마감 알림과 캘린더 후보를 만들 수 있습니다.",
    "안전 경계: 이 카드는 읽기 전용이며 외부 발송/등록을 하지 않습니다.",
  ].join("\n");
}

function toScheduleBriefingWorkItem(item) {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    body: item.body,
    sourceLabel: item.sourceLabel,
    senderLabel: item.senderLabel,
    status: item.status,
    riskLabel: item.riskLabel,
    receivedAt: item.receivedAt,
    dueAt: item.dueAt,
    deadlineAt: item.deadlineAt,
    ...(item.sourceEvidence ? { sourceEvidence: normalizeScheduleBriefingSourceEvidence(item.sourceEvidence) } : {}),
    schedules: item.schedules,
  };
}

function normalizeScheduleBriefingSourceEvidence(value) {
  if (!value || typeof value !== "object") return undefined;
  const calendarAttendeeLabels = Array.isArray(value.calendarAttendeeLabels)
    ? value.calendarAttendeeLabels.map((label) => sanitizeText(label)).filter(Boolean).slice(0, 4)
    : [];
  const calendarStartsAt = sanitizeIsoCandidate(value.calendarStartsAt);
  const calendarEndsAt = sanitizeIsoCandidate(value.calendarEndsAt);
  return {
    providerId: sanitizeText(value.providerId).slice(0, 80),
    messageSubject: sanitizeText(value.messageSubject).slice(0, 160),
    senderPreview: sanitizeText(value.senderPreview).slice(0, 120),
    replyToLabel: sanitizeText(value.replyToLabel).slice(0, 120),
    mailThreadLabel: sanitizeText(value.mailThreadLabel).slice(0, 120),
    draftPreview: sanitizeText(value.draftPreview).slice(0, 240),
    messageSnippet: sanitizeText(value.messageSnippet).slice(0, 500),
    calendarCandidateText: sanitizeText(value.calendarCandidateText).slice(0, 240),
    calendarTimeRangeLabel: sanitizeText(value.calendarTimeRangeLabel).slice(0, 120),
    ...(calendarStartsAt ? { calendarStartsAt } : {}),
    ...(calendarEndsAt ? { calendarEndsAt } : {}),
    calendarAttendeeLabels,
    calendarLocationLabel: sanitizeText(value.calendarLocationLabel).slice(0, 120),
    calendarReminderLabel: sanitizeText(value.calendarReminderLabel).slice(0, 120),
    calendarConflictLabel: sanitizeText(value.calendarConflictLabel).slice(0, 160),
    scheduleWindowLabel: sanitizeText(value.scheduleWindowLabel).slice(0, 120),
  };
}

function sanitizeIsoCandidate(value) {
  const text = sanitizeText(value).slice(0, 40);
  if (!text) return "";
  return Number.isFinite(new Date(text).getTime()) ? text : "";
}

function isScheduleBriefingRule(rule) {
  return rule.triggerKind === "scheduled_check" &&
    (rule.sourceKind === "work_schedule" ||
      rule.connectorId === "mody-work-schedule" ||
      ["daily-weekly-schedule-briefing", "urgent-deadline-watch", "meeting-reminder-watch"].includes(rule.id));
}

function providerReadsForRule(rule, providerReads) {
  if (rule.mode === "scheduled") return providerReads;
  return providerReads.filter((read) => {
    if (read.connectorId === rule.connectorId) return true;
    return rule.sourceKind === "mailbox" && read.action === "list_mail_messages";
  });
}

function messengerReadsForRule(rule, messengerCommandReads = []) {
  if (!isMessengerCommandRule(rule)) return [];
  return messengerCommandReads.filter((read) => read.ruleId === rule.id || read.connectorId === rule.connectorId);
}

function filterProviderReadsBySignalCursors(input) {
  const ruleById = new Map(input.rules.map((rule) => [rule.id, rule]));
  const allowedCursors = new Set(
    input.signals
      .filter((signal) => ruleById.get(signal.triggerId)?.actionPolicy === input.allowedActionPolicy)
      .map((signal) => signal.cursor),
  );

  if (allowedCursors.size === 0) return [];

  return input.reads
    .map((read) => ({
      ...read,
      messages: (read.messages ?? []).filter((message) =>
        allowedCursors.has(`${read.connectorId}:${message.messageId}`),
      ),
    }))
    .filter((read) => read.messages.length > 0);
}

function filterProviderReadsByMessageIds(reads, messageIds) {
  return reads
    .map((read) => ({
      ...read,
      messages: (read.messages ?? []).filter((message) => messageIds.has(message.messageId)),
    }))
    .filter((read) => read.messages.length > 0);
}

function isMessageTriggerRule(rule) {
  return ["mail_arrived", "inquiry_arrived"].includes(rule.triggerKind);
}

function isSecureMailPollingRule(rule) {
  return rule.id === "local-rule-secure-mail-polling-5m";
}

function isMessengerCommandRule(rule) {
  return rule.triggerKind === "messenger_command" || rule.sourceKind === "message_channel";
}

function isTelegramCommandRule(rule) {
  return isMessengerCommandRule(rule) && rule.connectorId === "telegram-bot" && rule.mode === "polling";
}

function isSlackCommandRule(rule) {
  return isMessengerCommandRule(rule) && rule.connectorId === "slack-app";
}

function providerIdForMessengerConnector(connectorId) {
  if (connectorId === "slack-app") return "slack";
  if (connectorId === "discord-app") return "discord";
  if (connectorId === "telegram-bot") return "telegram";
  return "messenger";
}

function normalizeWebhookChannelMessage(value = {}, event = {}, now) {
  const providerId = providerIdForMessengerConnector(event.connectorId);
  const updateId = sanitizeText(value.updateId ?? value.id ?? event.cursor ?? compactDate(now));
  const channelId = sanitizeText(value.channelId ?? value.chatId ?? providerId);
  return {
    updateId,
    text: sanitizeText(value.text ?? value.messageText ?? event.summary ?? "메신저 명령"),
    senderId: sanitizeText(value.senderId ?? value.userId ?? `${providerId}-user`),
    channelId,
    chatId: sanitizeText(value.chatId ?? channelId),
    threadId: sanitizeText(value.threadId ?? channelId),
    receivedAt: sanitizeIso(value.receivedAt ?? event.occurredAt, now),
  };
}

function createMailSignal(rule, read, message, cursor, now) {
  return {
    id: `signal_${safeId(rule.id)}_${safeId(message.messageId)}`,
    triggerId: rule.id,
    occurredAt: message.receivedAt ?? now,
    title: sanitizeText(message.subject || "새 메일/문의"),
    summary: `${sanitizeText(message.from || providerLabel(read.providerId))}에서 ${sanitizeText(message.subject || "새 업무")} 신호가 들어왔습니다.`,
    cursor,
    externalMutation: false,
    rawSecretMaterialStored: false,
    dataSensitivity: "customer_contact",
    changedFieldLabels: ["제목", "보낸 사람", "수신 시각"],
  };
}

function createMessengerCommandSignal(rule, read, update, cursor, now) {
  const receivedAt = sanitizeIso(update.receivedAt, now);
  const text = sanitizeText(update.text || "메신저 명령");
  const channelId = sanitizeText(read.providerId || read.connectorId || "messenger");
  const channelLabel = messengerChannelLabel(channelId);
  const channelMessage = {
    id: `${safeId(channelId)}_update_${update.updateId}`,
    channelId,
    category: messengerChannelCategory(channelId),
    direction: "inbound",
    senderId: String(update.senderId ?? `${channelId}-user`),
    threadId: String(update.threadId ?? update.chatId ?? update.channelId ?? ""),
    text,
    receivedAt,
    trustLevel: messengerChannelTrustLevel(channelId),
  };

  return {
    id: `signal_${safeId(rule.id)}_${safeId(cursor)}`,
    triggerId: rule.id,
    triggerKind: "messenger_command",
    occurredAt: receivedAt,
    title: `${channelLabel} 명령: ${text.slice(0, 42)}`,
    summary: `사용자가 ${channelLabel}에서 업무 상태 또는 승인 의사를 물었습니다.`,
    cursor,
    externalMutation: false,
    rawSecretMaterialStored: false,
    dataSensitivity: "normal",
    changedFieldLabels: ["메시지", "보낸 사람", "채팅"],
    channelMessage,
  };
}

async function mapMessengerCommandSignalsToInboxItems(signals, now) {
  if (signals.length === 0) return [];

  const inboxItems = [];
  const commandSignals = signals.filter((signal) => signal.channelMessage);
  for (const signal of commandSignals) {
    const decisionResult = applyChannelDecisionToInbox({
      channel: signal.channelMessage.channelId,
      messageText: signal.channelMessage.text,
      senderId: signal.channelMessage.senderId,
      receivedAt: signal.channelMessage.receivedAt,
    });
    if (decisionResult.status === "channel_decision_recorded") {
      inboxItems.push(createMessengerDecisionInboxItem(signal, decisionResult));
      continue;
    }

    const domain = await loadDomainRuntime();
    const loop = new domain.ModyWorkCommandLoop({
      now: () => new Date(now),
    });
      const result = loop.process({
        message: signal.channelMessage,
        appDeepLinkBase: "modycrew://work-command",
      });
      inboxItems.push({
        id: `messenger:${result.id}`,
        title: result.workItem.title,
        source: "messaging_command",
        sourceLabel: `${messengerChannelLabel(signal.channelMessage.channelId)} 명령`,
        senderLabel: `${messengerChannelLabel(signal.channelMessage.channelId)} ${signal.channelMessage.senderId}`,
        body: `${result.workItem.body}\n\n메신저 답장 후보: ${result.outboundReport.text}`,
        summary: result.outboundReport.text,
        status: result.workItem.status,
        riskLabel: result.workItem.riskLabel,
        riskSignals: result.approvalQueue.map((request, index) => ({
          id: `${result.id}:approval:${index}`,
          label: operationLabel(request.operationKind),
          riskLabel: request.riskLabel === "low" ? "medium" : request.riskLabel,
          reason: "메신저에서는 승인 의사만 기록하고 실제 외부 실행은 앱에서 최종 확인합니다.",
        })),
        receivedAt: signal.channelMessage.receivedAt,
      });
  }

  return inboxItems;
}

function createMessengerDecisionInboxItem(signal, decisionResult) {
  const decisionLabel = messengerDecisionLabel(decisionResult.decision);
  const decidedAt = signal.channelMessage.receivedAt ?? new Date().toISOString();
  const channelLabel = messengerChannelLabel(signal.channelMessage.channelId);
  return {
    id: `messenger-decision:${safeId(signal.channelMessage.id)}:${safeId(decisionResult.targetWorkItemId)}`,
    title: `${channelLabel} ${decisionLabel}: ${decisionResult.targetTitle}`,
    source: "messaging_command",
    sourceLabel: `${channelLabel} 승인`,
    senderLabel: `${channelLabel} ${signal.channelMessage.senderId}`,
    body: `${decisionResult.userMessage}\n\n받은 답장: ${signal.channelMessage.text}`,
    summary: `${decisionLabel} 의사를 업무 카드 ${decisionResult.targetCode || decisionResult.targetWorkItemId}에 기록했습니다.`,
    status: "completed",
    riskLabel: "medium",
    riskSignals: [
      {
        id: `${safeId(signal.channelMessage.id)}:app-final-confirmation`,
        label: "앱 최종 확인 필요",
        riskLabel: "medium",
        reason: "메신저 답장은 승인 의사만 기록하고 실제 외부 실행은 앱에서 최종 확인합니다.",
      },
    ],
    receivedAt: decidedAt,
    channelDecision: {
      channel: signal.channelMessage.channelId,
      decision: decisionResult.decision,
      decisionLabel: decisionResult.channelDecision?.decisionLabel || decisionLabel,
      decidedBy: `${channelLabel} ${signal.channelMessage.senderId}`,
      decidedAt,
      messagePreview: signal.channelMessage.text,
      targetCode: decisionResult.targetCode || decisionResult.channelDecision?.targetCode || "",
      targetWorkItemId: decisionResult.targetWorkItemId || decisionResult.channelDecision?.targetWorkItemId || "",
      notificationTargetMatch: decisionResult.channelDecision?.notificationTargetMatch === true,
      notificationTargetMatchLabel: decisionResult.channelDecision?.notificationTargetMatchLabel || "",
      notificationTargetMatchContract: decisionResult.channelDecision?.notificationTargetMatchContract || "",
      approvalInboxRouteLabel: decisionResult.channelDecision?.approvalInboxRouteLabel || "ModyCrew > 오피스 > 승인함",
      appReconfirmLabel: decisionResult.channelDecision?.appReconfirmLabel || "앱 최종 확인 필요",
      workerEventLabel:
        decisionResult.channelDecision?.workerEventLabel ||
        `${signal.channelMessage.channelId}에서 ${decisionLabel} 의사 수신`,
      finalExecutionBoundary:
        decisionResult.channelDecision?.finalExecutionBoundary ||
        "휴대폰 답장은 의사 기록만, 실제 메일 발송/일정 등록/파일 공유는 앱 최종 확인 후 실행",
      requiresAppReconfirm: true,
      externalMutation: false,
      ...(decisionResult.revisionInstruction
        ? { revisionInstruction: decisionResult.revisionInstruction }
        : {}),
    },
  };
}

function messengerDecisionLabel(decision) {
  if (decision === "approved") return "승인 기록";
  if (decision === "change_requested") return "수정 요청";
  if (decision === "held") return "보류";
  return "거절";
}

function messengerChannelLabel(channelId) {
  if (channelId === "telegram") return "Telegram";
  if (channelId === "slack") return "Slack";
  if (channelId === "discord") return "Discord";
  return "메신저";
}

function messengerChannelCategory(channelId) {
  if (channelId === "slack") return "workspace_messenger";
  if (channelId === "discord") return "community_messenger";
  return "messenger_bot";
}

function messengerChannelTrustLevel(channelId) {
  if (channelId === "slack") return "workspace_member";
  return "verified_user";
}

function createDigestSignal(rule, totalItems, now) {
  return {
    id: `signal_${safeId(rule.id)}_digest_${compactDate(now)}`,
    triggerId: rule.id,
    occurredAt: now,
    title: `${rule.label} 정기 요약`,
    summary: `연결된 업무 도구에서 읽기 전용으로 ${totalItems}건을 확인했습니다. 요약 알림 후보만 만듭니다.`,
    cursor: `digest:${compactDate(now)}`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    dataSensitivity: "normal",
    changedFieldLabels: ["정기 확인", "읽은 항목 수"],
  };
}

function createEventSignal(rule, input, now) {
  const cursor = sanitizeText(input.cursor ?? input.id ?? `event:${compactDate(now)}`);
  return {
    id: `signal_${safeId(rule.id)}_${safeId(cursor)}`,
    triggerId: rule.id,
    occurredAt: sanitizeIso(input.occurredAt, now),
    title: sanitizeText(input.title ?? `${rule.label} 새 이벤트`),
    summary: sanitizeText(input.summary ?? "연결된 앱에서 새 이벤트가 들어왔습니다."),
    cursor,
    externalMutation: false,
    rawSecretMaterialStored: false,
    dataSensitivity: dataSensitivityFor(rule),
    changedFieldLabels: Array.isArray(input.changedFieldLabels)
      ? input.changedFieldLabels.map((label) => sanitizeText(label)).filter(Boolean).slice(0, 8)
      : ["이벤트 수신"],
  };
}

function findEventRule(rules, input) {
  const ruleId = String(input.ruleId ?? "").trim();
  const connectorId = String(input.connectorId ?? "").trim();
  return rules.find((rule) => rule.enabled && rule.id === ruleId) ??
    rules.find((rule) => rule.enabled && connectorId && rule.connectorId === connectorId) ??
    rules.find((rule) => rule.enabled && rule.mode === "webhook");
}

function toDomainTrigger(rule) {
  return {
    id: rule.id,
    connectorId: rule.connectorId,
    label: rule.label,
    sourceKind: sourceKindForDomain(rule.sourceKind),
    triggerKind: triggerKindForDomain(rule.triggerKind),
    mode: ["webhook", "polling", "scheduled"].includes(rule.mode) ? rule.mode : "polling",
    enabled: Boolean(rule.enabled),
    cadenceMinutes: Number(rule.cadenceMinutes ?? 10),
    ...(rule.lastCursor ? { lastCursor: rule.lastCursor } : {}),
  };
}

function sourceKindForDomain(sourceKind) {
  if (["mailbox", "business_inquiry", "message_channel", "sales_system", "inventory_system"].includes(sourceKind)) {
    return sourceKind;
  }
  if (sourceKind === "business_system") return "sales_system";
  return "business_inquiry";
}

function triggerKindForDomain(triggerKind) {
  if (triggerKind === "mail_arrived") return "mail_received";
  if (triggerKind === "inquiry_arrived") return "inquiry_received";
  if (triggerKind === "messenger_command") return "messenger_command";
  if (triggerKind === "inventory_low") return "inventory_threshold_changed";
  if (triggerKind === "booking_changed" || triggerKind === "calendar_event") return "scheduled_check";
  if (triggerKind === "scheduled_check") return "scheduled_check";
  return "inquiry_received";
}

function dataSensitivityFor(rule) {
  if (["sales_system", "inventory_system", "business_system"].includes(rule.sourceKind)) {
    return "business_financial";
  }
  if (["mail_arrived", "inquiry_arrived", "messenger_command"].includes(rule.triggerKind)) {
    return "customer_contact";
  }
  return "normal";
}

function updateRuleStateAfterRun(rule, previous, now, cursors, seededCursors = []) {
  const nextSeen = [...new Set([...(cursors ?? []), ...(seededCursors ?? []), ...(previous.seenCursors ?? [])])]
    .filter(Boolean)
    .slice(0, maxSeenCursorsPerRule);
  return {
    lastCheckedAt: now,
    nextCheckAt: nextCheckIso(now, rule.cadenceMinutes),
    lastCursor: cursors[cursors.length - 1] ?? previous.lastCursor,
    seenCursors: nextSeen,
    // 메일을 읽지 못해 미뤄 둔 첫 기록 기준 — 메일 점검(createSignalsFromDueRules)만 지우거나 새로 쓴다.
    ...(previous.pendingMailSeedAt ? { pendingMailSeedAt: previous.pendingMailSeedAt } : {}),
  };
}

function isRuleDue(rule, ruleState, now, force) {
  if (!rule.enabled) return false;
  if (force) return true;
  if (!ruleState?.lastCheckedAt) return true;
  const nextCheckAt = ruleState.nextCheckAt ?? nextCheckIso(ruleState.lastCheckedAt, rule.cadenceMinutes);
  return new Date(nextCheckAt).getTime() <= new Date(now).getTime();
}

function createEmptyRuleState() {
  return {
    lastCheckedAt: "",
    nextCheckAt: "",
    seenCursors: [],
  };
}

function nextTelegramOffset(lastCursor) {
  const match = /^telegram:(\d+)$/u.exec(String(lastCursor ?? ""));
  if (!match) return undefined;
  const updateId = Number(match[1]);
  return Number.isFinite(updateId) ? updateId + 1 : undefined;
}

/**
 * 메일·캘린더 서버에 로그인해 읽을 필요가 있는지. 읽은 결과를 실제로 쓰는 규칙이 있을 때만 읽는다.
 * 예전에는 기본으로 켜진 Telegram 규칙 때문에 메일 점검을 꺼 둬도 5분마다 모든 메일 계정에 로그인했다.
 */
function needsConnectorRead(rules) {
  return rules.some(ruleConsumesProviderReads);
}

function ruleConsumesProviderReads(rule) {
  // 일정 브리핑은 승인함 카드를 읽는다. 메일 서버에 로그인할 이유가 없다.
  if (isScheduleBriefingRule(rule)) return false;
  // 정기 요약은 연결된 도구에서 읽은 건수를 요약에 쓴다.
  if (rule.mode === "scheduled") return true;
  // 메신저 명령 규칙은 자기 읽기(loadMessengerCommandReads)를 쓴다.
  if (isMessengerCommandRule(rule)) return false;
  // 메일/문의 도착 규칙만 메일·캘린더 읽기 결과를 소비한다(웹훅 문의는 메일함을 보지 않는다).
  if (isMessageTriggerRule(rule)) return rule.sourceKind === "mailbox" || rule.mode !== "webhook";
  return false;
}

function createEmptyConnectorContext() {
  return {
    status: "no_connector_context",
    localFolders: [],
    mailReads: [],
    providerReads: [],
    contextMarkdown: "",
    auditMessages: [],
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function updateMailAutomationHistory(existingHistory, entry) {
  const sanitizedEntry = sanitizeMailAutomationHistoryEntry(entry);
  return [sanitizedEntry, ...sanitizeMailAutomationHistory(existingHistory)]
    .filter((item, index, list) => list.findIndex((candidate) => candidate.reportId === item.reportId) === index)
    .slice(0, 12);
}

function sanitizeMailAutomationHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(sanitizeMailAutomationHistoryEntry)
    .filter((entry) => entry.createdAt)
    .slice(0, 12);
}

function sanitizeMailAutomationHistoryEntry(value) {
  const entry = value && typeof value === "object" ? value : {};
  return {
    createdAt: sanitizeText(entry.createdAt ?? ""),
    reportId: sanitizeText(entry.reportId ?? "mail-automation-run"),
    triggeredBy: sanitizeText(entry.triggeredBy ?? ""),
    newMailSignalCount: Number(entry.newMailSignalCount ?? 0),
    ignoredMailCount: Number(entry.ignoredMailCount ?? 0),
    approvalQueueCount: Number(entry.approvalQueueCount ?? 0),
    webmailFallbackCheckCount: Number(entry.webmailFallbackCheckCount ?? 0),
    webmailDomExtractedCount: Number(entry.webmailDomExtractedCount ?? 0),
    webmailBodyPreviewAllowedCount: Number(entry.webmailBodyPreviewAllowedCount ?? 0),
    webmailBodyPreviewSkippedBeforeBodyCount: Number(entry.webmailBodyPreviewSkippedBeforeBodyCount ?? 0),
  };
}

function summarizeMailAutomationEvidenceWindow(history) {
  const safeHistory = sanitizeMailAutomationHistory(history);
  if (safeHistory.length === 0) return "no_mail_automation_runs";
  const totals = safeHistory.reduce(
    (summary, item) => ({
      newMailSignalCount: summary.newMailSignalCount + Number(item.newMailSignalCount ?? 0),
      ignoredMailCount: summary.ignoredMailCount + Number(item.ignoredMailCount ?? 0),
      approvalQueueCount: summary.approvalQueueCount + Number(item.approvalQueueCount ?? 0),
      webmailDomExtractedCount: summary.webmailDomExtractedCount + Number(item.webmailDomExtractedCount ?? 0),
      webmailBodyPreviewAllowedCount:
        summary.webmailBodyPreviewAllowedCount + Number(item.webmailBodyPreviewAllowedCount ?? 0),
      webmailBodyPreviewSkippedBeforeBodyCount:
        summary.webmailBodyPreviewSkippedBeforeBodyCount + Number(item.webmailBodyPreviewSkippedBeforeBodyCount ?? 0),
    }),
    {
      newMailSignalCount: 0,
      ignoredMailCount: 0,
      approvalQueueCount: 0,
      webmailDomExtractedCount: 0,
      webmailBodyPreviewAllowedCount: 0,
      webmailBodyPreviewSkippedBeforeBodyCount: 0,
    },
  );
  return [
    `runs=${safeHistory.length}`,
    `latest=${safeHistory[0]?.createdAt ?? ""}`,
    `newMail=${totals.newMailSignalCount}`,
    `ignored=${totals.ignoredMailCount}`,
    `approval=${totals.approvalQueueCount}`,
    `webmailDom=${totals.webmailDomExtractedCount}`,
    `webmailPreview=${totals.webmailBodyPreviewAllowedCount}`,
    `webmailPreviewSkipped=${totals.webmailBodyPreviewSkippedBeforeBodyCount}`,
  ].join(" ");
}

function summarizeMailAutomationTriage(input = {}) {
  const providerSummary = input.providerIntakeReport?.triageSummary ?? null;
  const webmailFallbackResults = Array.isArray(input.webmailFallbackResults) ? input.webmailFallbackResults : [];
  const webmailApprovalQueueCount = webmailFallbackResults.reduce(
    (sum, result) => sum + Number(result.approvalQueueCount ?? 0),
    0,
  );
  const webmailIgnoredItemsCount = webmailFallbackResults.reduce(
    (sum, result) => sum + Number(result.ignoredItemsCount ?? 0),
    0,
  );
  const businessMailCount =
    Number(providerSummary?.businessMailCount ?? 0) +
    webmailApprovalQueueCount;
  const ignoredNoiseCount = providerSummary
    ? Number(providerSummary.ignoredNoiseCount ?? 0) + webmailIgnoredItemsCount
    : Math.max(Number(input.ignoredMailCount ?? 0), webmailIgnoredItemsCount);
  const needsReviewCount =
    Number(providerSummary?.needsReviewCount ?? 0) +
    webmailApprovalQueueCount;
  const approvalCandidateCount = Math.max(
    Number(input.approvalQueueCount ?? 0),
    Number(providerSummary?.approvalCandidateCount ?? 0) +
      webmailApprovalQueueCount,
  );
  const replyDraftCandidateCount =
    Number(providerSummary?.replyDraftCandidateCount ?? 0) +
    webmailApprovalQueueCount;
  const calendarDraftCandidateCount =
    Number(providerSummary?.calendarDraftCandidateCount ?? 0) +
    webmailFallbackResults.reduce((sum, result) => sum + Number(result.calendarCandidateCount ?? 0), 0);
  const attachmentSignalCandidateCount =
    Number(providerSummary?.attachmentSignalCandidateCount ?? 0) +
    webmailFallbackResults.reduce((sum, result) => sum + Number(result.attachmentCandidateCount ?? 0), 0);
  const skippedBeforeBodyCount =
    Number(providerSummary?.skippedBeforeBodyCount ?? 0) +
    webmailFallbackResults.reduce((sum, result) => sum + Number(result.webmailBodyPreviewSkippedBeforeBodyCount ?? 0), 0);
  const bodyPreviewAllowedCount =
    Number(providerSummary?.bodyPreviewAllowedCount ?? 0) +
    webmailFallbackResults.reduce((sum, result) => sum + Number(result.webmailBodyPreviewAllowedCount ?? 0), 0);
  const triageDistributionLabel = `업무 ${businessMailCount}건 · 확인 ${needsReviewCount}건 · 광고 제외 ${ignoredNoiseCount}건`;
  const importantWorkLabel =
    `답장 ${replyDraftCandidateCount}건 · 일정 ${calendarDraftCandidateCount}건 · 첨부 ${attachmentSignalCandidateCount}건 · 승인 ${approvalCandidateCount}건`;
  return {
    triageDistributionLabel,
    importantWorkLabel,
    bodyPreviewPolicy:
      providerSummary?.bodyPreviewPolicy || "metadata_first_noise_skipped_before_body_business_preview_only",
    ignoredCandidateLabels: sanitizeLabelList([
      ...(Array.isArray(providerSummary?.ignoredCandidateLabels) ? providerSummary.ignoredCandidateLabels : []),
      ignoredNoiseCount > 0 ? `광고/뉴스레터/스팸 ${ignoredNoiseCount}건` : "",
      skippedBeforeBodyCount > 0 ? `본문 preview 전 제외 ${skippedBeforeBodyCount}건` : "",
    ]),
    importantCandidateLabels: sanitizeLabelList([
      ...(Array.isArray(providerSummary?.importantCandidateLabels) ? providerSummary.importantCandidateLabels : []),
      approvalCandidateCount > 0 ? `승인 필요 ${approvalCandidateCount}건` : "",
      calendarDraftCandidateCount > 0 ? `일정 후보 ${calendarDraftCandidateCount}건` : "",
      attachmentSignalCandidateCount > 0 ? `첨부 후보 ${attachmentSignalCandidateCount}건` : "",
      bodyPreviewAllowedCount > 0 ? `업무 후보 preview ${bodyPreviewAllowedCount}건` : "",
    ]),
  };
}

function summarizeMailLearningRuleEvidence(rules = []) {
  const safeLabels = sanitizeLabelList(
    rules.flatMap((rule) => [
      ...(Array.isArray(rule.learningProfileEvidenceLabels) ? rule.learningProfileEvidenceLabels : []),
      rule.learningProfileSummary ?? "",
    ]),
  ).filter((label) => /initial|profile|learning|학습|tone|말투|noise|광고|뉴스레터|bulk|대량|approval|승인|sample|샘플|safe_labels/iu.test(label));
  const evidenceLabels = [...new Set(safeLabels)].slice(0, 6);
  const contract = rules.some((rule) => rule.learningProfileContract)
    ? "initial_profile_to_secure_mail_polling_rule_goal_output_provenance"
    : "";
  const safePersistPolicy = rules.some((rule) => rule.learningProfilePersistPolicy === "safe_labels_only_user_approved")
    ? "safe_labels_only_user_approved"
    : "";
  return {
    label: evidenceLabels.length > 0 ? `초기 학습 기준 ${evidenceLabels.length}개 반영` : "",
    evidenceLabels,
    contract,
    safePersistPolicy,
  };
}

async function dispatchMailAutomationOsNotification(input = {}) {
  const draft = input.draft;
  const inboxItem = input.inboxItem;
  if (!draft || !inboxItem) return [];
  if (Number(draft.newMailSignalCount ?? 0) <= 0 && Number(draft.approvalQueueCount ?? 0) <= 0) return [];

  const rule = (Array.isArray(input.dueRules) ? input.dueRules : []).find(
    (candidate) => isSecureMailPollingRule(candidate) && candidate.notificationChannels?.os === true,
  );
  if (!rule) return [];

  if (typeof input.options?.showScheduleOsNotification !== "function") {
    return [{
      status: "os_notification_unavailable",
      channel: "os",
      ruleId: rule.id,
      workItemId: inboxItem.id,
      externalMutation: false,
    }];
  }

  try {
    return [await input.options.showScheduleOsNotification({
      title: draft.title,
      body: draft.body,
      workItemId: inboxItem.id,
      ruleId: rule.id,
      queueFilter: "approval",
    })];
  } catch (error) {
    return [{
      status: "os_notification_failed",
      channel: "os",
      ruleId: rule.id,
      workItemId: inboxItem.id,
      userMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
      externalMutation: false,
    }];
  }
}
function createMailAutomationNotificationDraft(input = {}) {
  const rules = Array.isArray(input.dueRules) ? input.dueRules : [];
  const appInboxEnabled = rules.some((rule) => rule.notificationChannels?.appInbox !== false);
  const osEnabledCount = rules.filter((rule) => rule.notificationChannels?.os === true).length;
  const telegramEnabledCount = rules.filter((rule) => rule.notificationChannels?.telegram === true).length;
  const channelLabels = [
    appInboxEnabled ? "앱 승인함" : "",
    osEnabledCount > 0 ? `OS 알림 후보 ${osEnabledCount}개` : "",
    telegramEnabledCount > 0 ? `Telegram 후보 ${telegramEnabledCount}개` : "",
  ].filter(Boolean);
  const approvalQueueCount = Number(input.approvalQueueCount ?? 0);
  const newMailSignalCount = Number(input.newMailSignalCount ?? 0);
  const ignoredMailCount = Number(input.ignoredMailCount ?? 0);
  const calendarCandidateCount = Number(input.calendarCandidateCount ?? 0);
  const attachmentCandidateCount = Number(input.attachmentCandidateCount ?? 0);
  const triageDistributionLabel = sanitizeText(input.triageDistributionLabel ?? "");
  const importantWorkLabel = sanitizeText(input.importantWorkLabel ?? "");
  const bodyPreviewPolicy = sanitizeText(input.bodyPreviewPolicy ?? "metadata_first_noise_skipped_before_body_business_preview_only");
  const ignoredCandidateLabels = sanitizeLabelList(input.ignoredCandidateLabels);
  const importantCandidateLabels = sanitizeLabelList(input.importantCandidateLabels);
  const learningRuleEvidence = input.learningRuleEvidence && typeof input.learningRuleEvidence === "object"
    ? input.learningRuleEvidence
    : {};
  const learningRuleEvidenceLabel = sanitizeText(learningRuleEvidence.label ?? "");
  const learningRuleEvidenceLabels = sanitizeLabelList(learningRuleEvidence.evidenceLabels);
  const learningRuleEvidenceContract = sanitizeText(learningRuleEvidence.contract ?? "");
  const learningRuleSafePersistPolicy = sanitizeText(learningRuleEvidence.safePersistPolicy ?? "");
  const title = approvalQueueCount > 0
    ? `메일 자동 점검: 승인 후보 ${approvalQueueCount}건`
    : newMailSignalCount > 0
      ? `메일 자동 점검: 새 메일 ${newMailSignalCount}건`
      : "메일 자동 점검 완료";
  const body = [
    `새 메일 ${newMailSignalCount}건, 중복 제외 ${Number(input.duplicateMailSuppressedCount ?? 0)}건을 확인했습니다.`,
    triageDistributionLabel ? `분류: ${triageDistributionLabel}` : "",
    importantWorkLabel ? `중요 후보: ${importantWorkLabel}` : "",
    learningRuleEvidenceLabel ? `학습 기준: ${learningRuleEvidenceLabel}.` : "",
    ignoredMailCount > 0 ? `광고/뉴스레터/스팸 ${ignoredMailCount}건은 본문 preview 전에 제외했습니다.` : "",
    approvalQueueCount > 0 ? `오피스 승인함에 확인할 후보 ${approvalQueueCount}건이 있습니다.` : "이번 점검에서 승인 후보는 없습니다.",
    calendarCandidateCount > 0 ? `일정 후보 ${calendarCandidateCount}건은 캘린더 등록 전 확인 카드로 분리됩니다.` : "",
    attachmentCandidateCount > 0 ? `첨부 후보 ${attachmentCandidateCount}건은 다운로드 전 검토 카드로 분리됩니다.` : "",
    "메일 발송, 일정 등록, 첨부 이동/삭제는 앱의 마지막 확인 전까지 잠겨 있습니다.",
  ].filter(Boolean).join(" ");
  return sanitizeMailAutomationNotificationDraft({
    contract: "mail_polling_to_app_approval_notification_draft",
    title,
    body,
    routeLabel: "오피스 승인함",
    actionLabel: approvalQueueCount > 0 ? "승인함에서 확인" : "실행 로그 확인",
    channelSummary: channelLabels.length ? channelLabels.join(" · ") : "앱 승인함",
    dispatchPolicy: "app_inbox_draft_only_external_notification_requires_user_channel_setup",
    newMailSignalCount,
    ignoredMailCount,
    approvalQueueCount,
    calendarCandidateCount,
    attachmentCandidateCount,
    triageDistributionLabel,
    importantWorkLabel,
    bodyPreviewPolicy,
    ignoredCandidateLabels,
    importantCandidateLabels,
    learningRuleEvidenceLabel,
    learningRuleEvidenceLabels,
    learningRuleEvidenceContract,
    learningRuleSafePersistPolicy,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  });
}

// 사용자가 카드에서 직접 정한 상태. 하루 한 장인 점검 결과 카드를 갱신해도 이 상태는 되돌리지 않는다
// (보류·완료한 결과 카드가 새 점검마다 다시 '확인 필요'로 튀어나오지 않게). 새 메일 자체는 답장 카드로 따로 올라온다.
const userDecidedInboxStatuses = new Set(["completed", "held", "rejected", "change_requested"]);

function keepUserDecidedStatus(item) {
  if (!item?.id) return item;
  const existing = getAutomationInboxSnapshot().find((current) => current.id === item.id);
  return existing && userDecidedInboxStatuses.has(String(existing.status ?? ""))
    ? { ...item, status: existing.status }
    : item;
}

function createMailAutomationNotificationInboxItem(draft, now) {
  const approvalQueueCount = Number(draft?.approvalQueueCount ?? 0);
  const calendarCandidateCount = Number(draft?.calendarCandidateCount ?? 0);
  const attachmentCandidateCount = Number(draft?.attachmentCandidateCount ?? 0);
  const ignoredMailCount = Number(draft?.ignoredMailCount ?? 0);
  // 하루에 한 장을 갱신한다(같은 id 로 upsert). 점검마다 새 카드를 쌓지 않는다.
  const notificationId = `mail-automation-notification:${localDayKey(now)}`;
  return {
    id: notificationId,
    title: sanitizeText(draft?.title || "메일 자동 점검 알림 초안"),
    source: "email",
    sourceLabel: "메일 자동 점검",
    senderLabel: "ModyCrew 자동 점검",
    body: sanitizeTextBlock(draft?.body || "메일 자동 점검 결과를 앱 승인함에서 확인합니다."),
    summary: [
      approvalQueueCount > 0 ? `승인 후보 ${approvalQueueCount}건` : "승인 후보 없음",
      ignoredMailCount > 0 ? `제외 ${ignoredMailCount}건` : "",
      calendarCandidateCount > 0 ? `일정 ${calendarCandidateCount}건` : "",
      attachmentCandidateCount > 0 ? `첨부 ${attachmentCandidateCount}건` : "",
    ].filter(Boolean).join(" · "),
    status: approvalQueueCount > 0 ? "approval_pending" : "needs_review",
    riskLabel: approvalQueueCount > 0 || calendarCandidateCount > 0 || attachmentCandidateCount > 0 ? "medium" : "low",
    riskSignals: [
      {
        id: `${notificationId}:final-lock`,
        label: "앱 최종 확인 잠금",
        riskLabel: "medium",
        reason: "알림은 승인 후보 안내만 하며 메일 발송, 일정 등록, 첨부 이동은 앱 마지막 확인 전까지 실행하지 않습니다.",
      },
    ],
    receivedAt: now,
    draft: {
      id: `${notificationId}:draft`,
      toneLabel: "앱 알림 초안",
      body: sanitizeTextBlock(draft?.body || ""),
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    sourceEvidence: {
      providerId: "mail_automation_runner",
      connectorId: "mail-automation-notification",
      messageSubject: sanitizeText(draft?.title || "메일 자동 점검 알림 초안"),
      detectedIntentLabels: ["메일 자동 점검", "앱 승인함", "알림 초안"],
      approvalCandidateLabels: ["승인 후보 안내", "최종 확인 잠금"],
      mobileReceiveFilterIds: approvalQueueCount > 0
        ? ["approval_waiting", ...(calendarCandidateCount > 0 ? ["calendar_candidate"] : []), ...(attachmentCandidateCount > 0 ? ["follow_up"] : [])]
        : ["digest_only"],
      mobileReceiveFilterLabels: approvalQueueCount > 0
        ? ["승인 대기", ...(calendarCandidateCount > 0 ? ["일정 후보"] : []), ...(attachmentCandidateCount > 0 ? ["후속 확인"] : [])]
        : ["요약만"],
      mailAutomationNotificationDraft: {
        contract: sanitizeText(draft?.contract || "mail_polling_to_app_approval_notification_draft"),
        dispatchPolicy: sanitizeText(draft?.dispatchPolicy || "app_inbox_draft_only_external_notification_requires_user_channel_setup"),
        channelSummary: sanitizeText(draft?.channelSummary || "앱 승인함"),
        routeLabel: sanitizeText(draft?.routeLabel || "오피스 승인함"),
        actionLabel: sanitizeText(draft?.actionLabel || "승인함에서 확인"),
        approvalQueueCount,
        ignoredMailCount,
        calendarCandidateCount,
        attachmentCandidateCount,
        triageDistributionLabel: sanitizeText(draft?.triageDistributionLabel ?? ""),
        importantWorkLabel: sanitizeText(draft?.importantWorkLabel ?? ""),
        bodyPreviewPolicy: sanitizeText(draft?.bodyPreviewPolicy ?? "metadata_first_noise_skipped_before_body_business_preview_only"),
        ignoredCandidateLabels: sanitizeLabelList(draft?.ignoredCandidateLabels),
        importantCandidateLabels: sanitizeLabelList(draft?.importantCandidateLabels),
        learningRuleEvidenceLabel: sanitizeText(draft?.learningRuleEvidenceLabel ?? ""),
        learningRuleEvidenceLabels: sanitizeLabelList(draft?.learningRuleEvidenceLabels),
        learningRuleEvidenceContract: sanitizeText(draft?.learningRuleEvidenceContract ?? ""),
        learningRuleSafePersistPolicy: sanitizeText(draft?.learningRuleSafePersistPolicy ?? ""),
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      },
    },
  };
}

/**
 * 이번 실행에서 새로 생긴 것을 배경 정리에 넘긴다.
 *
 * 지문은 **개수가 아니라 항목 식별자**로 만든다. 하나 들어오고 하나 나가면 개수는
 * 그대로라서, 개수만 보면 새 일을 놓친다.
 */
async function runBackgroundDigestForRun(options, inboxItems, inboxResult) {
  if (typeof options.runBackgroundDigest !== "function") return null;
  const addedCount = Number(inboxResult?.addedCount ?? 0);
  const pendingApprovalCount = inboxItems.filter(
    (item) => item?.status === "pending" || item?.status === "needs_approval",
  ).length;
  const identifiers = inboxItems
    .map((item) => String(item?.id ?? ""))
    .filter(Boolean)
    .sort();
  try {
    return await options.runBackgroundDigest({
      material: {
        newWorkItemCount: addedCount,
        pendingApprovalCount,
        newLearnedDocumentCount: 0,
        fingerprint: identifiers.join("|").slice(0, 2_000),
      },
      itemTitles: inboxItems.map((item) => String(item?.title ?? "")).filter(Boolean),
    });
  } catch {
    // 정리에 실패해도 자동 점검은 계속 간다.
    return null;
  }
}

/**
 * 승인함 카드 상태 → 업무판 상태. 끝난 카드(보냄·완료·보내지 않음)는 끝남, 보류·승인 대기는 답이 필요해요.
 * 원장은 이미 있는 일의 상태를 이 값으로 덮지 않으므로(upsert_tasks) 끝난 일이 '할 일'로 되돌아가지 않는다.
 * 카드를 처리한 순간의 닫기는 승인함 쪽(approval-task-link)이 맡는다.
 */
export function mirroredTaskStatusForInboxItem(item = {}) {
  const status = String(item?.status ?? "");
  const finished = Boolean(item?.finalAction?.sentAt) || item?.finalAction?.readiness === "sent";
  if (finished || status === "completed" || status === "rejected") return "done";
  if (status === "held" || status === "approval_pending") return "blocked";
  return "todo";
}

/**
 * 업무 카드를 원장 카드로 옮긴다. 같은 id 는 원장 쪽이 덮어쓰기(upsert)로 막으므로
 * 자동 점검이 같은 메일을 다시 봐도 카드가 둘이 되지 않는다.
 */
async function mirrorInboxItemsToTaskLedger(options, inboxItems) {
  if (typeof options.mirrorTasks !== "function") return;
  const tasks = inboxItems
    .filter((item) => item && typeof item === "object" && item.id && item.title)
    .slice(0, 80)
    .map((item) => ({
      id: `inbox:${String(item.id)}`,
      title: String(item.title),
      description: String(item.summary || item.body || "").slice(0, 2000),
      createdAt: String(item.receivedAt || ""),
      status: mirroredTaskStatusForInboxItem(item),
      origin:
        item.source === "mail" || String(item.sourceLabel || "").includes("메일")
          ? { kind: "mail", messageId: String(item.id) }
          : { kind: "trigger", triggerId: String(item.source || "automation") },
    }));
  if (tasks.length === 0) return;
  try {
    await options.mirrorTasks({ tasks });
  } catch {
    // 원장 쓰기 실패는 자동 점검을 막지 않는다.
  }
}

function normalizeTriggerRunnerState(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  return {
    version: 1,
    updatedAt: String(parsed.updatedAt ?? ""),
    rules: parsed.rules && typeof parsed.rules === "object" ? parsed.rules : {},
    latestReport: sanitizeLatestReport(parsed.latestReport),
    latestMailAutomationReport: sanitizeLatestReport(parsed.latestMailAutomationReport),
    mailAutomationHistory: sanitizeMailAutomationHistory(parsed.mailAutomationHistory),
  };
}

async function readTriggerRunnerStateFile(filePath) {
  try {
    return normalizeTriggerRunnerState(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

/**
 * 이 파일에는 규칙마다 "어디까지 봤는지"(seenCursors)가 들어 있다. 이걸 잃으면 다음
 * 실행이 처음부터 다시 처리해서, 이미 처리한 메일로 업무 카드와 승인 요청이 또 생긴다.
 * 그래서 찢어진 파일을 만나면 곧바로 빈 상태로 시작하지 않고 직전 사본을 먼저 본다.
 */
async function readState(options) {
  const filePath = statePath(options);
  const current = await readTriggerRunnerStateFile(filePath);
  if (current) return current;
  const previous = await readTriggerRunnerStateFile(`${filePath}.previous`);
  if (previous) return previous;
  return { version: 1, updatedAt: "", rules: {}, latestReport: null, latestMailAutomationReport: null, mailAutomationHistory: [] };
}

/**
 * 임시 파일에 쓰고 바꿔 끼운다. 예전에는 대상 파일에 곧바로 써서, 쓰는 도중 앱이
 * 죽으면 반쯤 쓰인 JSON 이 남고 다음 읽기가 그걸 버리면서 전 규칙의 진행 지점이
 * 통째로 사라졌다. 직전 사본도 같이 남겨 두 겹으로 막는다.
 */
async function writeState(options, state) {
  const filePath = statePath(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, serialized, "utf8");
  if (existsSync(filePath)) {
    try {
      await copyFile(filePath, `${filePath}.previous`);
    } catch {
      // 사본을 못 남겨도 원자적 교체 자체는 진행한다.
    }
  }
  await rename(tempPath, filePath);
}

async function writeReport(options, input) {
  const filePath = reportPath(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, renderReportMarkdown(input), "utf8");
}

function renderReportMarkdown(input) {
  const lines = [
    "# Trigger Runner Report",
    "",
    `- status: ${input.latestReport.status}`,
    `- createdAt: ${input.latestReport.createdAt}`,
    `- dueRuleCount: ${input.latestReport.dueRuleCount}`,
    `- signalsProcessed: ${input.latestReport.signalsProcessed}`,
    `- newMailSignalCount: ${input.latestReport.newMailSignalCount ?? 0}`,
    `- duplicateMailSuppressedCount: ${input.latestReport.duplicateMailSuppressedCount ?? 0}`,
    `- mailPollingContract: ${input.latestReport.mailPollingContract ?? "new_mail_metadata_only_seen_cursor_dedupe_approval_queue"}`,
    `- secureMailPollingRuleCount: ${input.latestReport.secureMailPollingRuleCount ?? 0}`,
    `- ignoredMailCount: ${input.latestReport.ignoredMailCount ?? 0}`,
    `- mailAutomationNotice: ${sanitizeText(input.latestReport.mailAutomationNotice ?? "")}`,
    `- mailLearningRuleEvidence: ${sanitizeText(input.latestReport.mailLearningRuleEvidenceLabel ?? "")}`,
    `- mailLearningRuleEvidenceContract: ${sanitizeText(input.latestReport.mailLearningRuleEvidenceContract ?? "")}`,
    `- mailLearningRuleSafePersistPolicy: ${sanitizeText(input.latestReport.mailLearningRuleSafePersistPolicy ?? "")}`,
    `- mailAutomationNotificationDraft: ${sanitizeText(input.latestReport.mailAutomationNotificationDraft?.title ?? "")} / ${sanitizeText(input.latestReport.mailAutomationNotificationDraft?.channelSummary ?? "")}`,
    `- mailAutomationNotificationContract: ${sanitizeText(input.latestReport.mailAutomationNotificationDraft?.contract ?? "")}`,
    `- mailAutomationNotificationInboxItem: ${sanitizeText(input.latestReport.mailAutomationNotificationInboxItemId ?? "")} / ${sanitizeText(input.latestReport.mailAutomationNotificationInboxStatus ?? "")}`,
    `- approvalSafetyContract: ${input.latestReport.approvalSafetyContract ?? "external_send_calendar_attachment_mutation_locked_until_user_final_approval"}`,
    `- secretHandlingContract: ${input.latestReport.secretHandlingContract ?? "credentialReferenceId_or_browserSessionReferenceId_only_no_raw_secret_returned"}`,
    `- queuedWorkItemsCount: ${input.latestReport.queuedWorkItemsCount}`,
    `- approvalQueueCount: ${input.latestReport.approvalQueueCount ?? 0}`,
    `- mailCandidateCount: ${input.latestReport.mailCandidateCount ?? 0}`,
    `- calendarCandidateCount: ${input.latestReport.calendarCandidateCount ?? 0}`,
    `- attachmentCandidateCount: ${input.latestReport.attachmentCandidateCount ?? 0}`,
    `- attachmentStagingStatus: ${input.latestReport.attachmentStagingStatus ?? "no_attachment_candidate"}`,
    `- attachmentStagingContract: ${input.latestReport.attachmentStagingContract ?? "download_message_attachments_to_local_staging_then_folder_plan_approval"}`,
    `- providerReadCount: ${input.latestReport.providerReadCount}`,
    `- webmailFallbackCheckCount: ${input.latestReport.webmailFallbackCheckCount ?? 0}`,
    `- webmailFallbackQueuedCount: ${input.latestReport.webmailFallbackQueuedCount ?? 0}`,
    `- webmailFallbackBlockedCount: ${input.latestReport.webmailFallbackBlockedCount ?? 0}`,
    `- webmailFallbackApprovalQueueCount: ${input.latestReport.webmailFallbackApprovalQueueCount ?? 0}`,
    `- webmailCredentialReferenceCount: ${input.latestReport.webmailCredentialReferenceCount ?? 0}`,
    `- webmailCredentialReferenceIds: ${(input.latestReport.webmailCredentialReferenceIds ?? []).map((id) => sanitizeText(id)).join(", ")}`,
    `- webmailCredentialReferencePolicy: ${sanitizeText(input.latestReport.webmailCredentialReferencePolicy ?? "os_keychain_reference_only_ai_secret_unreadable")}`,
    `- webmailAiSecretReadable: ${input.latestReport.webmailAiSecretReadable === true ? "true" : "false"}`,
    `- webmailDomCaptureStatus: ${input.latestReport.webmailDomCaptureStatus ?? ""}`,
    `- webmailDomExtractionStatus: ${input.latestReport.webmailDomExtractionStatus ?? ""}`,
    `- webmailDomRowCount: ${input.latestReport.webmailDomRowCount ?? 0}`,
    `- webmailDomExtractedCount: ${input.latestReport.webmailDomExtractedCount ?? 0}`,
    `- webmailDomRecoveryStatus: ${sanitizeText(input.latestReport.webmailDomRecoveryStatus ?? "")}`,
    `- webmailDomRecoveryReasonLabel: ${sanitizeText(input.latestReport.webmailDomRecoveryReasonLabel ?? "")}`,
    `- webmailDomRecoveryNextAction: ${sanitizeText(input.latestReport.webmailDomRecoveryNextAction ?? "")}`,
    `- webmailBodyPreviewAllowedCount: ${input.latestReport.webmailBodyPreviewAllowedCount ?? 0}`,
    `- webmailBodyPreviewSkippedBeforeBodyCount: ${input.latestReport.webmailBodyPreviewSkippedBeforeBodyCount ?? 0}`,
    `- mailAutomationRunCount: ${input.latestReport.mailAutomationRunCount ?? 0}`,
    `- mailAutomationLastRunAt: ${input.latestReport.mailAutomationLastRunAt ?? ""}`,
    `- mailAutomationEvidenceWindow: ${input.latestReport.mailAutomationEvidenceWindow ?? ""}`,
    `- messengerCommandCount: ${input.latestReport.messengerCommandCount ?? 0}`,
    "- externalMutation: false",
    "- rawSecretMaterialStored: false",
    "",
    "## Due Rules",
    "",
    ...input.dueRules.map((rule) => `- ${rule.label} (${rule.mode}, ${rule.connectorId}, ${rule.actionPolicy ?? "queue_ai_review"})`),
    "",
    "## Signals",
    "",
  ];

  if (input.signals.length === 0) lines.push("- 새 신호 없음");
  for (const signal of input.signals) {
    lines.push(`- ${signal.title}: ${signal.summary}`);
  }

  lines.push("", "## Safety", "", input.domainReport.safetyBoundary, "");
  if (input.providerIntakeReport?.summary) {
    lines.push("## Provider Intake", "", input.providerIntakeReport.summary, "");
  }
  if ((input.webmailFallbackResults ?? []).length > 0) {
    lines.push("## Webmail Fallback", "");
    for (const result of input.webmailFallbackResults) {
      lines.push(
        `- ${sanitizeText(result.ruleLabel || result.connectorId)}: ${sanitizeText(result.status)}, messages=${Number(result.messageCount ?? 0)}, queued=${Number(result.addedInboxItemsCount ?? 0)}, blocked=${result.blocked === true}`,
        `  - Credential: refs=${Number(result.credentialReferenceCount ?? 0)}, id=${sanitizeText(result.credentialReferenceId ?? "")}, aiSecretReadable=${result.aiSecretReadable === true ? "true" : "false"}`,
        `  - DOM: capture=${sanitizeText(result.webmailDomCapture?.status ?? "")}, extraction=${sanitizeText(result.webmailDomExtraction?.status ?? "")}, rows=${Number(result.webmailDomCapture?.rowCount ?? result.webmailDomExtraction?.rowCount ?? 0)}, extracted=${Number(result.webmailDomExtraction?.extractedCount ?? 0)}`,
        `  - Recovery: status=${sanitizeText(result.webmailDomRecoveryGuide?.status ?? "")}, reason=${sanitizeText(result.webmailDomRecoveryGuide?.reasonLabel ?? "")}, next=${sanitizeText(result.webmailDomRecoveryGuide?.nextUserAction ?? "")}`,
      );
    }
    lines.push("");
  }
  if ((input.messengerCommandReads ?? input.telegramCommandReads ?? []).length > 0) {
    lines.push("## Messenger Commands", "");
    for (const read of input.messengerCommandReads ?? input.telegramCommandReads) {
      lines.push(`- ${read.connectorId}: ${read.status}, updates=${read.updates?.length ?? 0}`);
    }
    lines.push("");
  }
  lines.push("## Connector Audit", "");
  for (const message of input.connectorContext.auditMessages ?? []) {
    lines.push(`- ${sanitizeText(message)}`);
  }
  return `${lines.join("\n")}\n`;
}

function signalIdForWorkItem(item) {
  const actionWithSignal = (item.toolActionRequests ?? []).find((request) => request.metadata?.signalId);
  if (actionWithSignal?.metadata?.signalId) return String(actionWithSignal.metadata.signalId);
  const match = /^work_trigger_(.+)$/u.exec(String(item.id ?? ""));
  return match?.[1] ?? "";
}

function sourceLabelForActionPolicy(actionPolicy) {
  if (actionPolicy === "notify_only") return "자동 알림";
  if (actionPolicy === "digest_report") return "자동 요약";
  return "자동 트리거";
}

function summaryForActionPolicy(actionPolicy) {
  if (actionPolicy === "notify_only") {
    return "자동 작동 규칙이 새 신호를 받아 알림과 확인 카드만 만들었습니다.";
  }
  if (actionPolicy === "digest_report") {
    return "자동 작동 규칙이 새 신호를 받아 내부 요약 보고 후보를 만들었습니다.";
  }
  return "자동 작동 규칙이 새 신호를 받아 AI 검토 후보로 올렸습니다.";
}

function bodyForActionPolicy(body, actionPolicy) {
  if (actionPolicy === "notify_only") {
    return `${body} 설정이 '알림만'이어서 답장 초안이나 외부 실행 후보는 만들지 않았습니다.`;
  }
  if (actionPolicy === "digest_report") {
    return `${body} 설정이 '요약 보고서'여서 내부 확인용 보고 후보로만 남깁니다.`;
  }
  return body;
}

function statePath(options) {
  if (!options.app?.getPath) throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  return path.join(options.app.getPath("userData"), stateFileName);
}

function reportPath(options) {
  if (!options.app?.getPath) throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  return path.join(options.app.getPath("userData"), reportFileName);
}

function sanitizeLatestReport(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: sanitizeText(value.id ?? "trigger-runner-report"),
    status: sanitizeText(value.status ?? "unknown"),
    createdAt: sanitizeText(value.createdAt ?? ""),
    triggeredBy: sanitizeText(value.triggeredBy ?? ""),
    dueRuleCount: Number(value.dueRuleCount ?? 0),
    signalsProcessed: Number(value.signalsProcessed ?? 0),
    newMailSignalCount: Number(value.newMailSignalCount ?? 0),
    duplicateMailSuppressedCount: Number(value.duplicateMailSuppressedCount ?? 0),
    mailPollingContract: sanitizeText(value.mailPollingContract ?? "new_mail_metadata_only_seen_cursor_dedupe_approval_queue"),
    secureMailPollingRuleCount: Number(value.secureMailPollingRuleCount ?? 0),
    ignoredMailCount: Number(value.ignoredMailCount ?? 0),
    mailAutomationNotice: sanitizeText(value.mailAutomationNotice ?? ""),
    mailLearningRuleEvidenceLabel: sanitizeText(value.mailLearningRuleEvidenceLabel ?? ""),
    mailLearningRuleEvidenceLabels: sanitizeLabelList(value.mailLearningRuleEvidenceLabels),
    mailLearningRuleEvidenceContract: sanitizeText(value.mailLearningRuleEvidenceContract ?? ""),
    mailLearningRuleSafePersistPolicy: sanitizeText(value.mailLearningRuleSafePersistPolicy ?? ""),
    mailAutomationNotificationDraft: sanitizeMailAutomationNotificationDraft(value.mailAutomationNotificationDraft),
    mailAutomationNotificationInboxItemId: sanitizeText(value.mailAutomationNotificationInboxItemId ?? ""),
    // 배경 정리 결과. 다시 읽을 수 있어야 "내가 없는 동안"에 쓸 수 있다.
    backgroundDigestStatus: sanitizeText(value.backgroundDigestStatus ?? ""),
    backgroundDigestText: sanitizeTextBlock(value.backgroundDigestText ?? ""),
    mailAutomationNotificationInboxStatus: sanitizeText(value.mailAutomationNotificationInboxStatus ?? ""),
    mailAutomationNotificationDispatchCount: Number(value.mailAutomationNotificationDispatchCount ?? 0),
    mailAutomationNotificationDispatchStatuses: sanitizeLabelList(value.mailAutomationNotificationDispatchStatuses),
    approvalSafetyContract: sanitizeText(
      value.approvalSafetyContract ?? "external_send_calendar_attachment_mutation_locked_until_user_final_approval",
    ),
    secretHandlingContract: sanitizeText(
      value.secretHandlingContract ?? "credentialReferenceId_or_browserSessionReferenceId_only_no_raw_secret_returned",
    ),
    queuedWorkItemsCount: Number(value.queuedWorkItemsCount ?? 0),
    approvalQueueCount: Number(value.approvalQueueCount ?? 0),
    mailCandidateCount: Number(value.mailCandidateCount ?? 0),
    calendarCandidateCount: Number(value.calendarCandidateCount ?? 0),
    attachmentCandidateCount: Number(value.attachmentCandidateCount ?? 0),
    attachmentStagingStatus: sanitizeText(value.attachmentStagingStatus ?? "no_attachment_candidate"),
    attachmentStagingContract: sanitizeText(
      value.attachmentStagingContract ?? "download_message_attachments_to_local_staging_then_folder_plan_approval",
    ),
    providerReadCount: Number(value.providerReadCount ?? 0),
    webmailFallbackCheckCount: Number(value.webmailFallbackCheckCount ?? 0),
    webmailFallbackQueuedCount: Number(value.webmailFallbackQueuedCount ?? 0),
    webmailFallbackBlockedCount: Number(value.webmailFallbackBlockedCount ?? 0),
    webmailFallbackApprovalQueueCount: Number(value.webmailFallbackApprovalQueueCount ?? 0),
    webmailCredentialReferenceCount: Number(value.webmailCredentialReferenceCount ?? 0),
    webmailCredentialReferenceIds: Array.isArray(value.webmailCredentialReferenceIds)
      ? value.webmailCredentialReferenceIds.map((id) => sanitizeText(id)).filter(Boolean).slice(0, 5)
      : [],
    webmailCredentialReferencePolicy: sanitizeText(
      value.webmailCredentialReferencePolicy ?? "os_keychain_reference_only_ai_secret_unreadable",
    ),
    webmailAiSecretReadable: value.webmailAiSecretReadable === true ? true : false,
    webmailDomCaptureStatus: sanitizeText(value.webmailDomCaptureStatus ?? ""),
    webmailDomExtractionStatus: sanitizeText(value.webmailDomExtractionStatus ?? ""),
    webmailDomRowCount: Number(value.webmailDomRowCount ?? 0),
    webmailDomExtractedCount: Number(value.webmailDomExtractedCount ?? 0),
    webmailDomRecoveryStatus: sanitizeText(value.webmailDomRecoveryStatus ?? ""),
    webmailDomRecoveryReasonLabel: sanitizeText(value.webmailDomRecoveryReasonLabel ?? ""),
    webmailDomRecoveryNextAction: sanitizeText(value.webmailDomRecoveryNextAction ?? ""),
    webmailBodyPreviewAllowedCount: Number(value.webmailBodyPreviewAllowedCount ?? 0),
    webmailBodyPreviewSkippedBeforeBodyCount: Number(value.webmailBodyPreviewSkippedBeforeBodyCount ?? 0),
    mailAutomationRunCount: Number(value.mailAutomationRunCount ?? 0),
    mailAutomationLastRunAt: sanitizeText(value.mailAutomationLastRunAt ?? ""),
    mailAutomationEvidenceWindow: sanitizeText(value.mailAutomationEvidenceWindow ?? ""),
    messengerCommandCount: Number(value.messengerCommandCount ?? 0),
    triggerReportStatus: sanitizeText(value.triggerReportStatus ?? ""),
    providerIntakeStatus: sanitizeText(value.providerIntakeStatus ?? ""),
    reportPath: sanitizeText(value.reportPath ?? ""),
    userMessage: sanitizeText(value.userMessage ?? ""),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function sanitizeMailAutomationNotificationDraft(value) {
  if (!value || typeof value !== "object") return null;
  return {
    contract: sanitizeText(value.contract ?? "mail_polling_to_app_approval_notification_draft"),
    title: sanitizeText(value.title ?? "메일 자동 점검 알림"),
    body: sanitizeText(value.body ?? ""),
    routeLabel: sanitizeText(value.routeLabel ?? "오피스 승인함"),
    actionLabel: sanitizeText(value.actionLabel ?? "승인함에서 확인"),
    channelSummary: sanitizeText(value.channelSummary ?? "앱 승인함"),
    dispatchPolicy: sanitizeText(value.dispatchPolicy ?? "app_inbox_draft_only_external_notification_requires_user_channel_setup"),
    newMailSignalCount: Number(value.newMailSignalCount ?? 0),
    ignoredMailCount: Number(value.ignoredMailCount ?? 0),
    approvalQueueCount: Number(value.approvalQueueCount ?? 0),
    calendarCandidateCount: Number(value.calendarCandidateCount ?? 0),
    attachmentCandidateCount: Number(value.attachmentCandidateCount ?? 0),
    triageDistributionLabel: sanitizeText(value.triageDistributionLabel ?? ""),
    importantWorkLabel: sanitizeText(value.importantWorkLabel ?? ""),
    bodyPreviewPolicy: sanitizeText(value.bodyPreviewPolicy ?? "metadata_first_noise_skipped_before_body_business_preview_only"),
    ignoredCandidateLabels: sanitizeLabelList(value.ignoredCandidateLabels),
    importantCandidateLabels: sanitizeLabelList(value.importantCandidateLabels),
    learningRuleEvidenceLabel: sanitizeText(value.learningRuleEvidenceLabel ?? ""),
    learningRuleEvidenceLabels: sanitizeLabelList(value.learningRuleEvidenceLabels),
    learningRuleEvidenceContract: sanitizeText(value.learningRuleEvidenceContract ?? ""),
    learningRuleSafePersistPolicy: sanitizeText(value.learningRuleSafePersistPolicy ?? ""),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function dedupeInboxItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function sourceForInbox(source) {
  if (source === "email") return "email";
  if (source === "business_system") return "business_system";
  if (source === "web_page") return "naver_inquiry";
  return "messaging_command";
}

function providerLabel(providerId) {
  if (providerId === "imap_smtp") return "IMAP 메일";
  if (providerId === "gmail") return "Gmail";
  if (providerId === "outlook") return "Outlook";
  return "연결된 도구";
}

function operationLabel(operationKind) {
  if (operationKind === "send_email") return "메일 발송";
  if (operationKind === "create_calendar_event") return "일정 등록";
  if (operationKind === "share_file") return "파일 공유";
  if (operationKind === "send_sms_message") return "문자 발송";
  return "외부 실행 전 확인";
}

function nextCheckIso(now, cadenceMinutes) {
  const minutes = Math.max(Number(cadenceMinutes ?? 10) || 10, 1);
  return new Date(new Date(now).getTime() + minutes * 60_000).toISOString();
}

function nowIso(options) {
  const value = typeof options.now === "function" ? options.now() : new Date();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function sanitizeIso(value, fallback) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function localDayKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return compactDate(value).slice(0, 8) || "today";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function compactDate(value) {
  return String(value).replace(/[^0-9]/g, "").slice(0, 14);
}

function safeId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function sanitizeTextBlock(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 5000);
}

function sanitizeLabelList(value, fallback = []) {
  const source = Array.isArray(value) && value.length > 0 ? value : fallback;
  const labels = [];
  for (const item of source) {
    const label = sanitizeText(item);
    if (!label || labels.includes(label)) continue;
    labels.push(label);
    if (labels.length >= 6) break;
  }
  return labels;
}
