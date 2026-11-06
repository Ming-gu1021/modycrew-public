import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 무거운 문서 라이브러리(exceljs·mammoth·pdf-parse)는 실제로 쓸 때 불러온다.
// 예전엔 앱을 켤 때마다 전부 읽어 창이 뜨기까지 0.6~0.9초를 더 기다렸다(실측).
let excelModulePromise;
const loadExcelJS = () => (excelModulePromise ??= import("exceljs").then((module) => module.default ?? module));
import { discoverMailServerSettings } from "./mail-server-discovery.mjs";
import { createJevMailWorkReport, isJevMailEnabled } from "./jev-mail-handler.mjs";
import {
  attachHiddenOriginalSubject,
  attachHiddenReplyToAddress,
  carryHiddenMailFields,
  resolveMailReplySignature,
} from "./mail-header-utils.mjs";
import { describeSmtpFailure, prepareMailAttachments, renderMailMimeContent } from "./smtp-sender.mjs";
import { mailRecipientLists, mailAddressHeader } from './mail-recipient-list.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..", "..", "..");
const connectorVaultFileName = "connector-status-vault.json";
// Direct Outlook attachments require files under 3 MB; larger files need an upload session.
// https://learn.microsoft.com/en-us/graph/outlook-large-attachments
// Use conservative decimal byte caps, including Base64 + JSON overhead in the request cap.
// Graph REST 4 MB guidance: https://learn.microsoft.com/en-us/graph/onenote-images-files#size-limitations-for-post-pages-requests
const outlookDirectAttachmentLimitBytes = 3_000_000;
const outlookDirectRequestMaxBytes = 4_000_000;

const defaultConnectorOAuthPort = 1455;
const connectorOAuthLoopbackHost = "127.0.0.1";

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
let googleCalendarOAuthSession = null;
let outlookCalendarOAuthSession = null;
let gmailOAuthSession = null;
let outlookMailOAuthSession = null;
const registeredConnectorOAuthCallbackServers = new Map();
const registeredConnectorOAuthCallbackServerOpenings = new Map();
const registeredConnectorOAuthCallbackServerClosings = new Map();
const connectorExternalLaunchCooldownMs = 90_000;
const connectorExternalLaunchGuards = new Map();

async function loadDomainRuntime() {
  if (!existsSync(domainEntryPath)) {
    throw new Error(`ModyCrew domain runtime was not found: ${domainEntryPath}`);
  }
  domainModulePromise ??= import(pathToFileURL(domainEntryPath).href);
  return domainModulePromise;
}

export async function handleConnectorMessage(_event, payload = {}, options = {}) {
  if (payload.kind === "connect") {
    return connectLiveProvider(payload, options);
  }

  if (payload.kind === "list") {
    return listConnectors(options);
  }

  if (payload.kind === "disconnect") {
    return disconnectConnectorRecord(payload, options);
  }

  if (payload.kind === "preflight") {
    return runProviderOAuthPreflight(payload, options);
  }

  // 연결된 메일·캘린더에서 **실제로 읽은 내용**을 채팅이 쓸 수 있는 모양으로 넘긴다.
  // 지금까지 이 데이터는 데스크톱 안에서만 살아 있었다(웹 사용처 0곳, 브리지 통로 0곳).
  if (payload.kind === "chat_context") {
    return loadConnectorChatContext(payload, options);
  }

  throw new Error(`unsupported connector kind: ${String(payload.kind)}`);
}

async function runProviderOAuthPreflight(_payload = {}, options = {}) {
  const { ModyProviderOAuthPreflight } = await loadDomainRuntime();
  const preflight = new ModyProviderOAuthPreflight();
  const report = preflight.createReport({
    env: process.env,
    callbackPort: resolveConfiguredConnectorOAuthPort(options),
  });

  return {
    ...report,
    userMessage:
      report.summary.readyForAuthorization > 0
        ? "OAuth 앱 준비 상태를 확인했습니다. 준비된 provider는 동의 창을 열 수 있습니다."
        : "Google/Microsoft OAuth client id가 아직 없어 OAuth 동의 창을 열기 전 앱 등록이 필요합니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 프롬프트가 부풀지 않게 자르는 한도. 넘치면 모델이 정작 질문을 못 읽는다. */
const chatContextMaxMails = 12;
const chatContextMaxBusyWindows = 20;

/**
 * 연결된 곳에서 읽은 것을 **채팅이 쓸 수 있는 모양**으로 돌려준다.
 *
 * 왜 새로 만드나: renderConnectorContextMarkdown 은 개수만 적는다
 * ("- google_calendar: 3개 캘린더 busy window 읽기 완료"). 그것은 영수증이지
 * 데이터가 아니라서, 모델에 줘도 "이번 주 언제 비어?" 에 답할 수 없다.
 * 여기서는 실제 제목·보낸사람·시각을 담는다.
 *
 * 읽기 전용이다. 어떤 것도 바꾸지 않는다.
 */
async function loadConnectorChatContext(payload = {}, options = {}) {
  // 이 경로는 실제 IMAP·Google 계정이 있어야만 데이터가 나온다. 주입 지점이 없으면
  // 계정 없이는 검증 자체가 불가능해져 영원히 못 잠근다(같은 이유로 이 저장소는
  // options.fetch · trustedDriveHandlerForTest 를 이미 쓰고 있다).
  const context = options.workflowContextForTest ?? (await loadConnectorWorkflowContext(options));

  const reads = context.providerReads ?? [];
  const calendarReads = reads.filter((read) => read.action === "list_calendar_events");
  const mailReads = reads.filter((read) => read.action !== "list_calendar_events");

  const busyWindows = [];
  for (const read of calendarReads) {
    for (const event of read.events ?? []) {
      if (busyWindows.length >= chatContextMaxBusyWindows) break;
      busyWindows.push({
        providerId: read.providerId,
        // Google 은 freeBusy 만 읽어 제목이 항상 "바쁨" 이다. Outlook 은 실제 제목이 온다.
        // 이 차이를 숨기면 모델이 "바쁨" 을 진짜 일정 이름으로 착각해 지어낸다.
        title: String(event.title ?? "").trim() || "바쁨",
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        titleIsPlaceholder: String(event.title ?? "").trim() === "바쁨",
      });
    }
  }

  /*
   * 메일은 계정을 **번갈아** 담는다.
   *
   * 앞에서부터 채우면 메일이 많은 계정 하나가 12칸을 다 먹고 나머지 계정은 통째로
   * 안 보인다. 회사 메일에 광고가 쌓여 있으면 개인 메일의 중요한 한 통이 사라지는
   * 식이다. 계정이 몇 개든 각자 몫이 있어야 "몇 개가 붙어도 업무가 되는" 것이 된다.
   */
  const mails = [];
  const cursors = mailReads.map(() => 0);
  while (mails.length < chatContextMaxMails) {
    let addedThisRound = false;
    for (let index = 0; index < mailReads.length; index += 1) {
      if (mails.length >= chatContextMaxMails) break;
      const read = mailReads[index];
      const message = (read.messages ?? [])[cursors[index]];
      if (!message) continue;
      cursors[index] += 1;
      addedThisRound = true;
      mails.push({
        providerId: read.providerId,
        // 어느 메일함에서 왔는지 — 계정이 여럿이면 이것이 없으면 답이 뒤섞인다.
        connectorId: read.connectorId,
        accountLabel: String(read.accountLabel ?? read.connectorId ?? "").trim(),
        subject: String(message.subject ?? "").trim(),
        from: String(message.from ?? "").trim(),
        receivedAt: message.receivedAt,
        snippet: String(message.snippet ?? "").trim().slice(0, 220),
      });
    }
    if (!addedThisRound) break;
  }

  return {
    status: mails.length || busyWindows.length ? "connector_chat_context_ready" : "connector_chat_context_empty",
    mails,
    busyWindows,
    connectedCount: (context.providerReads ?? []).length,
    userMessage:
      mails.length || busyWindows.length
        ? `연결된 곳에서 메일 ${mails.length}건, 일정 ${busyWindows.length}건을 읽었습니다.`
        : "아직 읽어올 메일·일정이 없습니다. 메일이나 캘린더를 연결하면 여기에 쌓입니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

export async function loadConnectorWorkflowContext(options = {}) {
  const vault = await readConnectorVault(options);
  const records = Object.values(vault.connectors);
  const context = {
    status: records.length > 0 ? "connector_context_ready" : "no_connector_context",
    localFolders: [],
    mailReads: [],
    providerReads: [],
    contextMarkdown: "",
    auditMessages: [],
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  for (const record of records) {
    if (record.category !== "mail") continue;
    const mailContext = record.method === "imap_smtp"
      ? await buildMailWorkflowContext(record, options)
      : await buildOAuthMailWorkflowContext(record, options);
    context.mailReads.push(mailContext);
    if (mailContext.providerRead) context.providerReads.push(mailContext.providerRead);
    context.auditMessages.push(...mailContext.auditMessages);
  }

  const calendarContext = await loadCalendarWorkflowContext(options);
  if (calendarContext.providerReads.length > 0) {
    context.providerReads.push(...calendarContext.providerReads);
    context.auditMessages.push(...calendarContext.auditMessages);
  }

  context.contextMarkdown = renderConnectorContextMarkdown(context);
  return context;
}

export async function loadCalendarWorkflowContext(options = {}, input = {}) {
  const vault = await readConnectorVault(options);
  const records = Object.values(vault.connectors).filter(
    (record) =>
      record.category === "calendar" &&
      (record.providerId === "google_calendar" || record.providerId === "outlook_calendar"),
  );
  const context = {
    status: records.length > 0 ? "calendar_context_ready" : "calendar_not_connected",
    providerReads: [],
    calendarReads: [],
    auditMessages: [],
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  for (const record of records) {
    const calendarContext =
      record.providerId === "outlook_calendar"
        ? await buildOutlookCalendarWorkflowContext(record, options, input)
        : await buildGoogleCalendarWorkflowContext(record, options, input);
    context.calendarReads.push(calendarContext);
    if (calendarContext.providerRead) context.providerReads.push(calendarContext.providerRead);
    context.auditMessages.push(...calendarContext.auditMessages);
  }

  return context;
}

export async function loadSiteLoginConnectorReferences(options = {}) {
  const vault = await readConnectorVault(options);
  return Object.values(vault.connectors)
    .filter((record) => record.method === "site_login")
    .map((record) => {
      const statusRecord = toConnectorStatusRecord(record, options);
      return {
        connectorId: statusRecord.connectorId,
        method: "site_login",
        category: statusRecord.category,
        status: statusRecord.status,
        siteUrl: statusRecord.siteUrl,
        siteHost: statusRecord.siteHost,
        siteLabel: statusRecord.siteLabel,
        appPath: statusRecord.appPath,
        userMessage: statusRecord.userMessage,
        credentialReferenceId: statusRecord.credentialReferenceId,
        credentialStorage: statusRecord.credentialStorage,
        aiSecretReadable: false,
        secretFingerprint: statusRecord.secretFingerprint ? "stored_in_os_vault" : "",
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    });
}

export async function loadTelegramCommandContext(options = {}, input = {}) {
  const vault = await readConnectorVault(options);
  const record = Object.values(vault.connectors).find(
    (candidate) => candidate.connectorId === "telegram-bot" && candidate.method === "bot_token",
  );
  const base = {
    connectorId: "telegram-bot",
    providerId: "telegram",
    status: "telegram_not_connected",
    updates: [],
    auditMessages: [],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  if (!record) {
    return {
      ...base,
      userMessage: "Telegram Bot이 아직 연결되지 않아 명령 수신을 건너뜁니다.",
      auditMessages: ["Telegram Bot connector record not found"],
    };
  }

  const credential = decryptVaultValue(record.secretCiphertext, options.safeStorage, "Telegram Bot token");
  if (credential.status !== "credential_ready") {
    return {
      ...base,
      status: credential.status,
      userMessage: credential.userMessage,
      auditMessages: [`Telegram Bot credential unavailable: ${credential.status}`],
    };
  }

  const domain = await loadDomainRuntime();
  const connector = new domain.ModyTelegramBotLiveConnector(
    options.fetch ? { fetch: options.fetch } : {},
  );
  const polled = await connector.pollCommandUpdates({
    botToken: credential.value,
    offset: normalizeOptionalNumber(input.offset),
    limit: normalizeOptionalNumber(input.limit) ?? 20,
  });

  return {
    ...base,
    status: polled.status,
    updates: polled.updates ?? [],
    nextOffset: polled.nextOffset,
    userMessage: polled.userMessage,
    auditMessages: polled.auditMessages ?? [],
  };
}

export async function loadSlackCommandContext(options = {}, input = {}) {
  const vault = await readConnectorVault(options);
  const record = Object.values(vault.connectors).find(
    (candidate) => candidate.connectorId === "slack-app" && candidate.method === "bot_token",
  );
  const base = {
    connectorId: "slack-app",
    providerId: "slack",
    status: "slack_not_connected",
    updates: [],
    auditMessages: [],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  if (!record) {
    return {
      ...base,
      userMessage: "Slack 앱이 아직 연결되지 않아 명령 수신을 건너뜁니다.",
      auditMessages: ["Slack app connector record not found"],
    };
  }

  const credential = decryptVaultValue(record.secretCiphertext, options.safeStorage, "Slack Bot token");
  if (credential.status !== "credential_ready") {
    return {
      ...base,
      status: credential.status,
      userMessage: credential.userMessage,
      auditMessages: [`Slack Bot credential unavailable: ${credential.status}`],
    };
  }

  const updates = normalizeSlackCommandUpdates(
    input.updates ?? options.slackCommandUpdates ?? options.mockSlackCommandUpdates ?? [],
    record,
  );
  return {
    ...base,
    status: updates.length > 0 ? "slack_command_ingestion_ready" : "slack_command_waiting_for_webhook",
    updates,
    userMessage:
      updates.length > 0
        ? "Slack 앱 연결과 명령 payload를 확인했고 앱 인박스 승인 대화로 넘길 준비가 됐습니다."
        : "Slack Bot token은 저장되어 있습니다. Slash command, Events API, 또는 Socket Mode에서 들어온 명령 payload가 필요합니다.",
    auditMessages: [
      "Slack Bot token decrypted for availability check only; raw token was not returned",
      updates.length > 0
        ? `Slack command payloads normalized: ${updates.length}`
        : "Slack command payload source not provided",
    ],
  };
}

export async function sendTelegramApprovalNotification(options = {}, input = {}) {
  const vault = await readConnectorVault(options);
  const record = Object.values(vault.connectors).find(
    (candidate) => candidate.connectorId === "telegram-bot" && candidate.method === "bot_token",
  );
  const base = {
    connectorId: "telegram-bot",
    providerId: "telegram",
    status: "telegram_not_connected",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  if (!record) {
    return {
      ...base,
      userMessage: "Telegram Bot이 아직 연결되지 않아 승인 알림을 보낼 수 없습니다.",
      auditMessages: ["Telegram Bot connector record not found for approval notification"],
    };
  }

  const chatId = sanitizeTelegramChatId(input.chatId ?? record.chatId ?? record.defaultChatId);
  if (!chatId) {
    return {
      ...base,
      status: "telegram_report_target_missing",
      userMessage: "승인 알림을 받을 Telegram chat_id가 없습니다. Telegram 연결에서 보고 받을 chat_id를 함께 저장해 주세요.",
      auditMessages: ["Telegram Bot connector exists without report chat_id"],
    };
  }

  const credential = decryptVaultValue(record.secretCiphertext, options.safeStorage, "Telegram Bot token");
  if (credential.status !== "credential_ready") {
    return {
      ...base,
      status: credential.status,
      userMessage: credential.userMessage,
      auditMessages: [`Telegram Bot credential unavailable: ${credential.status}`],
    };
  }

  const domain = await loadDomainRuntime();
  const connector = new domain.ModyTelegramBotLiveConnector(
    options.fetch ? { fetch: options.fetch } : {},
  );
  const result = await connector.sendReportMessage({
    botToken: credential.value,
    chatId,
    message: sanitizeTelegramNotificationMessage(input.message),
    allowExternalSend: input.allowExternalSend === true,
  });

  return {
    ...base,
    status: result.status === "message_sent" ? "approval_notification_sent" : result.status,
    chatIdPreview: previewTelegramChatId(chatId),
    providerMessageId: result.messageId ? String(result.messageId) : undefined,
    userMessage:
      result.status === "message_sent"
        ? "Telegram으로 승인 대기 알림을 보냈습니다. 실제 발송/일정 등록은 앱 최종 확인에서만 실행됩니다."
        : result.userMessage,
    auditMessages: [
      ...(result.auditMessages ?? []),
      "승인 알림은 사용자 버튼 클릭으로만 발송하며 외부 실행 승인을 대신하지 않습니다.",
    ],
    externalMutation: result.externalMutation === true,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

export async function sendTelegramScheduleNotification(options = {}, input = {}) {
  const vault = await readConnectorVault(options);
  const record = Object.values(vault.connectors).find(
    (candidate) => candidate.connectorId === "telegram-bot" && candidate.method === "bot_token",
  );
  const base = {
    connectorId: "telegram-bot",
    providerId: "telegram",
    status: "telegram_not_connected",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  if (input.allowExternalSend !== true) {
    return {
      ...base,
      status: "schedule_notification_blocked",
      userMessage: "일정 Telegram 알림은 사용자가 Telegram 채널을 켠 경우에만 보낼 수 있습니다.",
      auditMessages: ["Schedule Telegram notification blocked without explicit opt-in"],
    };
  }

  if (!record) {
    return {
      ...base,
      userMessage: "Telegram Bot이 아직 연결되지 않아 일정 알림을 보낼 수 없습니다.",
      auditMessages: ["Telegram Bot connector record not found for schedule notification"],
    };
  }

  const chatId = sanitizeTelegramChatId(input.chatId ?? record.chatId ?? record.defaultChatId);
  if (!chatId) {
    return {
      ...base,
      status: "telegram_report_target_missing",
      userMessage: "일정 알림을 받을 Telegram chat_id가 없습니다. Telegram 연결에서 보고 받을 chat_id를 함께 저장해 주세요.",
      auditMessages: ["Telegram Bot connector exists without report chat_id"],
    };
  }

  const credential = decryptVaultValue(record.secretCiphertext, options.safeStorage, "Telegram Bot token");
  if (credential.status !== "credential_ready") {
    return {
      ...base,
      status: credential.status,
      userMessage: credential.userMessage,
      auditMessages: [`Telegram Bot credential unavailable: ${credential.status}`],
    };
  }

  const domain = await loadDomainRuntime();
  const connector = new domain.ModyTelegramBotLiveConnector(
    options.fetch ? { fetch: options.fetch } : {},
  );
  const result = await connector.sendReportMessage({
    botToken: credential.value,
    chatId,
    message: sanitizeTelegramNotificationMessage(input.message),
    allowExternalSend: true,
  });

  return {
    ...base,
    status: result.status === "message_sent" ? "schedule_notification_sent" : result.status,
    chatIdPreview: previewTelegramChatId(chatId),
    providerMessageId: result.messageId ? String(result.messageId) : undefined,
    userMessage:
      result.status === "message_sent"
        ? "Telegram으로 일정 브리핑 알림을 보냈습니다. 외부 발송/일정 등록은 실행하지 않았습니다."
        : result.userMessage,
    auditMessages: [
      ...(result.auditMessages ?? []),
      "일정 알림은 사용자가 켠 알림 채널에만 발송하며 외부 실행 승인을 대신하지 않습니다.",
    ],
    externalMutation: result.externalMutation === true,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function resolveMailConnectorRecord(vault, connectorId) {
  const records = Object.values(vault.connectors).filter((candidate) => candidate.category === "mail");
  if (connectorId) {
    const matching = collectMailConnectorRecords(vault, connectorId);
    return { record: matching.length === 1 ? matching[0] : null, selectionRequired: matching.length > 1, count: records.length };
  }
  return {
    record: records.length === 1 ? records[0] : null,
    selectionRequired: records.length > 1,
    count: records.length,
  };
}

/** 연결된 메일 계정 목록. connectorId/accountId 를 주면 그 계정만. */
function collectMailConnectorRecords(vault, requestedId) {
  const records = Object.values(vault.connectors ?? {}).filter(
    (candidate) => candidate?.category === "mail",
  );
  if (!requestedId) return records;
  return records.filter(
    (candidate) =>
      candidate.accountId === requestedId || candidate.connectorId === requestedId,
  );
}

export async function listCompanyMailSources(options = {}) {
  const vault = await readConnectorVault(options);
  return collectMailConnectorRecords(vault).map((record) => ({ id: record.accountId || record.connectorId, name: mailAccountLabelOf(record), status: record.status }));
}

export async function readConnectedMailBody(options={},input={}) {
  return readConnectedGmailContent(options,input,'body');
}
export async function readConnectedMailConversation(options={},input={}) {
  return readConnectedGmailContent(options,input,'conversation');
}
export async function readConnectedMailAttachment(options={},input={}) {
  return readConnectedGmailContent(options,input,'attachment');
}
async function readConnectedGmailContent(options,input,kind) {
  const requested=String(input.connectorId||'').trim();
  const records=collectMailConnectorRecords(await readConnectorVault(options),requested);
  if(!requested||records.length!==1) return {status:'mail_account_required',userMessage:'본문을 읽을 메일 계정을 하나 선택해 주세요.',externalMutation:false};
  const record=records[0];const accountId=record.accountId||record.connectorId;
  if(record.providerId!=='gmail')return {status:'mail_full_body_unsupported',userMessage:'이 계정은 현재 저장된 미리보기를 제공합니다. 전체 본문은 원래 메일함에서 확인해 주세요.',externalMutation:false};
  let messageId=String(input.messageId||'');const prefix=`${accountId}::`;
  if(messageId.startsWith(prefix))messageId=messageId.slice(prefix.length);
  if(messageId.includes('::')||!/^gmail-[A-Za-z0-9_-]{1,220}$/.test(messageId))return {status:'mail_message_invalid',userMessage:'선택한 계정의 메일인지 다시 확인해 주세요.',externalMutation:false};
  const token=await resolveOAuthAccessToken(record,options,'Gmail access token');
  if(token.status!=='credential_ready')return {status:token.status,userMessage:'Gmail 연결을 다시 확인해 주세요.',externalMutation:false};
  const domain=await loadDomainRuntime();
  const connector=new domain.ModyGmailMailLiveConnector({...options.fetch?{fetch:options.fetch}:{},...options.now?{now:options.now}:{}});
  const request={accessToken:token.value,messageId};
  const result=kind==='conversation'?await connector.readConversation(request):kind==='attachment'?await connector.readAttachment({...request,attachmentKey:String(input.attachmentKey||'')}):await connector.readMessage(request);
  const namespace=message=>({...message,messageId:`${prefix}${message.messageId}`});
  return {...result,accountId,...result.message?{message:namespace(result.message)}:{},...result.messages?{messages:result.messages.map(item=>({...item,message:namespace(item.message)}))}:{}};
}

/** 계정을 사람이 알아볼 이름으로. 통합 목록의 출처 배지에 쓴다. */
function mailAccountLabelOf(record) {
  return (
    sanitizeText(record?.accountLabel ?? "") ||
    sanitizeEmailAddress(record?.accountEmail) ||
    sanitizeEmailAddress(record?.emailAddress) ||
    sanitizeText(record?.connectorId ?? "").slice(0, 80) ||
    "메일"
  );
}

/**
 * 메일 하나가 어느 계정에서 왔는지 잃지 않도록 id 앞에 계정을 붙인다.
 * IMAP UID 는 계정 안에서만 유효한 번호라, 계정을 합치면 이 구분이 없을 때
 * 다른 계정의 같은 번호 메일을 잘못 여는 사고가 난다.
 */
function namespaceMailIntakeResult(result, record) {
  const accountId = sanitizeText(record?.accountId ?? record?.connectorId ?? "").slice(0, 160);
  if (!accountId) return result;
  const prefix = `${accountId}::`;
  const withPrefix = (value) => {
    const text = sanitizeText(value ?? "");
    return text && !text.startsWith(prefix) ? `${prefix}${text}` : text;
  };
  const sourceConnectorId = sanitizeText(record?.connectorId ?? "").slice(0, 120);
  // 펼치기({...message})는 숨겨 둔 답장 주소·실제 제목을 버리므로 다시 붙인다.
  const messages = (result?.providerRead?.messages ?? []).map((message) => carryHiddenMailFields({
    ...message,
    messageId: withPrefix(message.messageId),
    sourceAccountId: accountId,
    ...(sourceConnectorId ? { sourceConnectorId } : {}),
  }, message));
  const candidates = (result?.workReport?.candidates ?? []).map((candidate) => ({
    ...candidate,
    ...(candidate.sourceId ? { sourceId: withPrefix(candidate.sourceId) } : {}),
    sourceAccountId: accountId,
  }));
  return {
    ...result,
    connectorId: accountId,
    accountLabel: mailAccountLabelOf(record),
    ...(result?.providerRead ? { providerRead: { ...result.providerRead, connectorId: accountId, accountLabel: mailAccountLabelOf(record), messages } } : {}),
    ...(result?.workReport ? { workReport: { ...result.workReport, candidates } } : {}),
  };
}

function mergeMailTriageSummaries(reports) {
  const summaries = reports.map((report) => report?.triageSummary).filter(Boolean);
  if (!summaries.length) return undefined;
  const merged = { ...summaries[0] };
  for (const key of ["totalMailMessages", "businessMailCount", "ignoredNoiseCount", "needsReviewCount",
    "calendarContextCount", "replyDraftCandidateCount", "calendarDraftCandidateCount", "attachmentSignalCandidateCount",
    "immediateNotificationCount", "approvalCandidateCount", "bodyPreviewAllowedCount", "skippedBeforeBodyCount", "metadataOnlyReviewCount"]) {
    merged[key] = summaries.reduce((total, summary) => total + (Number(summary[key]) || 0), 0);
  }
  for (const key of ["ignoredCandidateLabels", "reviewCandidateLabels", "importantCandidateLabels"]) {
    merged[key] = summaries.flatMap((summary) => summary[key] ?? []).slice(0, 5);
  }
  merged.distributionLabel = `업무 ${merged.businessMailCount} · 확인 ${merged.needsReviewCount} · 제외 ${merged.ignoredNoiseCount} · 캘린더 참고 ${merged.calendarContextCount}`;
  merged.importantWorkLabel = `답장 ${merged.replyDraftCandidateCount} · 일정 ${merged.calendarDraftCandidateCount} · 첨부 ${merged.attachmentSignalCandidateCount} · 승인 ${merged.approvalCandidateCount}`;
  return merged;
}

/** 계정별 결과를 하나의 통합 결과로 합친다. */
function mergeMailIntakeResults(results) {
  const ok = results.filter((entry) => entry?.providerRead);
  const failed = results.filter((entry) => !entry?.providerRead);
  const accountResults = results.map((entry) => ({
    connectorId: entry.connectorId,
    accountLabel: entry.accountLabel,
    status: entry.status,
    messageCount: entry.providerRead?.messages?.length ?? 0,
    userMessage: entry.userMessage ?? entry.errorMessage ?? "",
  }));
  const failedSummary = failed.map((entry) =>
    `${entry.accountLabel}: ${entry.userMessage ?? entry.errorMessage ?? "연결을 확인해 주세요."}`,
  ).join(" / ");
  if (!ok.length) return {
    status: "mail_all_accounts_failed",
    providerId: "mail",
    connectorId: "",
    connectorCount: results.length,
    accountCount: 0,
    accountResults,
    userMessage: `연결된 메일 ${results.length}개를 모두 열지 못했습니다. ${failedSummary}`,
    auditMessages: ["Mail intake attempted every connected account; none could be read"],
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    appMayPersistSecret: false,
  };
  const messages = ok.flatMap((entry) => entry.providerRead.messages ?? []);
  const candidates = ok.flatMap((entry) => entry.workReport?.candidates ?? []);
  const approvalQueue = ok.flatMap((entry) => entry.workReport?.approvalQueue ?? []);
  const busyWindows = ok.flatMap((entry) => entry.workReport?.calendarBusyWindows ?? []);
  const sum = (pick) => ok.reduce((total, entry) => total + (Number(pick(entry)) || 0), 0);
  const base = ok[0];
  const readyForReview = ok.find((entry) => entry.workReport?.status === "ready_for_review");
  return {
    ...base,
    status: readyForReview?.status ?? base.status,
    connectorId: "",
    accountCount: ok.length,
    connectorCount: results.length,
    accountResults,
    accountIds: ok.map((entry) => entry.connectorId).filter(Boolean),
    providerReads: ok.map((entry) => entry.providerRead),
    workReports: ok.map((entry) => entry.workReport).filter(Boolean),
    providerRead: { ...base.providerRead, messages },
    ...(base.workReport
      ? {
          workReport: {
            ...base.workReport,
            status: readyForReview ? "ready_for_review" : base.workReport.status,
            triageSummary: mergeMailTriageSummaries(ok.map((entry) => entry.workReport)),
            candidates,
            approvalQueue,
            calendarBusyWindows: busyWindows,
            createdWorkItemsCount: sum((entry) => entry.workReport?.createdWorkItemsCount),
            ignoredItemsCount: sum((entry) => entry.workReport?.ignoredItemsCount),
            reviewItemsCount: sum((entry) => entry.workReport?.reviewItemsCount),
            auditMessages: ok.flatMap((entry) => entry.workReport?.auditMessages ?? []),
          },
        }
      : {}),
    messageCount: messages.length,
    userMessage: `연결된 메일 ${ok.length}곳에서 ${messages.length}건을 읽었습니다.` +
      (failed.length ? ` 열지 못한 계정 ${failed.length}개: ${failedSummary}` : ""),
    auditMessages: [
      `메일 계정 ${ok.length}곳을 순회해 읽기 전용으로 확인했습니다.`,
      ...ok.flatMap((entry) => entry.auditMessages ?? []),
    ],
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    appMayPersistSecret: false,
  };
}

export async function runConnectedMailWorkIntake(options = {}, input = {}) {
  const vault = await readConnectorVault(options);
  const connectorId = sanitizeText(input.connectorId ?? "");
  const records = collectMailConnectorRecords(vault, connectorId);

  // 계정이 여러 개면 전부 돌아 합친다. 예전에는 여기서 "계정을 고르라"며
  // 한 통도 읽지 않고 멈췄고, 고를 UI 도 없어 사실상 막다른 길이었다.
  if (records.length > 1) {
    const results = [];
    for (const candidate of records) {
      const single = await runSingleMailConnectorIntake(candidate, options, input).catch((error) => ({
        status: "mail_account_read_failed",
        connectorId: candidate.accountId ?? candidate.connectorId,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
      results.push(namespaceMailIntakeResult(single, candidate));
    }
    return mergeMailIntakeResults(results);
  }

  const record = records[0] ?? null;

  if (!record || record.category !== "mail") {
    return {
      status: "mail_connector_missing",
      providerId: "imap_smtp",
      connectorId: connectorId || "company-mail",
      readOnly: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      appMayPersistSecret: false,
      userMessage: "연결된 메일함이 없습니다. 메일 연결에서 Gmail, NAVER, Outlook, 회사 IMAP을 먼저 연결해 주세요.",
      auditMessages: ["IMAP/SMTP connector record not found for mail work intake"],
    };
  }

  return namespaceMailIntakeResult(await runSingleMailConnectorIntake(record, options, input), record);
}

/**
 * 메일 점검이 쓰는 답장 초안 기준. 형식/말투 라벨은 내부 표기라 초안 본문에 들어가지 않고,
 * 서명은 사용자가 정한 이름만 붙인다(없으면 비워 둔다 — 제품 이름을 붙이지 않는다).
 */
async function createMailIntakeWritingProfile(options = {}, connectorId = "") {
  // 계정마다 다른 명함(또는 서명 없음)을 쓸 수 있어, 읽는 연결의 id 로 서명을 고른다.
  const signature = await resolveMailReplySignature(options, { connectorId });
  return {
    toneLabel: "정중하지만 짧은 운영 담당자 말투",
    formatLabel: "메일 일정 확인/답장 초안",
    ...(signature ? { signature } : {}),
    calendarPreference: "개인/업무 캘린더의 기존 일정 충돌 제외, 평일 10:00-17:00 우선",
  };
}

/** 계정 하나를 읽는다(기존 동작 그대로). */
function jevMailScope(record) {
  // Account identity remains local; ciphertext also invalidates the cache after reconnecting.
  return createHash("sha256").update(JSON.stringify([
    record.accountId, record.providerId, record.connectorId,
    record.credentialReferenceId, record.usernameCiphertext,
  ])).digest("hex");
}

async function runSingleMailConnectorIntake(record, options = {}, input = {}) {
  if (record.method !== "imap_smtp") {
    return runOAuthMailWorkIntake(record, options, input);
  }

  const writingProfile = await createMailIntakeWritingProfile(options, record?.accountId || record?.connectorId);
  const username = decryptVaultValue(record.usernameCiphertext, options.safeStorage, "IMAP username");
  const password = decryptVaultValue(record.secretCiphertext, options.safeStorage, "IMAP password");
  if (username.status !== "credential_ready" || password.status !== "credential_ready") {
    return {
      status: "needs_credentials",
      providerId: "imap_smtp",
      connectorId: record.connectorId,
      readOnly: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      appMayPersistSecret: false,
      userMessage: "메일 credential을 OS 보안 저장소에서 열 수 없습니다. 메일 연결을 다시 확인해 주세요.",
      auditMessages: [`IMAP credential unavailable for ${record.connectorId}`],
    };
  }

  const domain = await loadDomainRuntime();
  const runner = new domain.ModyMailImapWorkIntakeRunner({
    imapConnector: new domain.ModyMailImapLiveConnector(
      options.imapClientFactory ? { imapClientFactory: options.imapClientFactory } : {},
    ),
    ...(options.now ? { now: options.now } : {}),
  });

  const mailResult = await runner.run({
    providerId: "imap_smtp",
    host: record.imapHost,
    port: Number(record.imapPort ?? 993),
    secure: record.imapSecure !== false,
    startTls: record.imapStartTls === true,
    username: username.value,
    password: password.value,
    mailbox: sanitizeText(input.mailbox ?? "INBOX") || "INBOX",
    limit: normalizeOptionalNumber(input.limit) ?? 10,
    connectorId: record.connectorId,
    credentialReferenceId: sanitizeCredentialReferenceId(record.credentialReferenceId) || `${record.connectorId}:os-vault`,
    reportChannelId: "desktop",
    appDeepLinkBase: "modycrew://mail-intake",
    writingProfile,
  });

  if (!mailResult.providerRead) return mailResult;

  const calendarContext = await loadCalendarWorkflowContext(options, {
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    timeZone: input.timeZone,
  });
  const calendarReads = calendarContext.providerReads ?? [];
  if (calendarReads.length === 0 && !(await isJevMailEnabled(options))) {
    return {
      ...mailResult,
      calendarContext,
      auditMessages: [...(mailResult.auditMessages ?? []), ...(calendarContext.auditMessages ?? [])],
    };
  }

  const planner = new domain.ModyProviderWorkIntakePlanner({
    ...(options.now ? { now: options.now } : {}),
  });
  const workReport = await createJevMailWorkReport({ domain, planner, scopeKey: jevMailScope(record), input: {
    reads: [mailResult.providerRead, ...calendarReads],
    writingProfile,
    reportChannelId: "desktop",
    appDeepLinkBase: "modycrew://mail-intake",
  } }, options);
  const workAnalysis = domain.analyzeMailWorkPattern({
    providerRead: mailResult.providerRead,
    workReport,
  });
  const initialLearningProfile = domain.createMailInitialLearningProfile({
    providerReads: [mailResult.providerRead],
    workReports: [workReport],
    workAnalysis,
    writingProfile,
    createdAt: options.now ? options.now().toISOString() : new Date().toISOString(),
    sourceScopes: ["inbox_metadata", "sent_history_metadata"],
  });
  const attachmentOrganizerPlan = domain.createMailAttachmentOrganizerPlan({
    providerReads: [mailResult.providerRead],
    workReports: [workReport],
    workAnalysis,
    createdAt: options.now ? options.now().toISOString() : new Date().toISOString(),
  });

  return {
    ...mailResult,
    status: workReport.status === "ready_for_review" ? "imap_connected_ready_for_review" : "imap_connected_quiet",
    workReport,
    workAnalysis,
    initialLearningProfile,
    attachmentOrganizerPlan,
    calendarContext,
    userMessage: `${mailResult.imapRead.userMessage} 캘린더 바쁜 시간 ${workReport.calendarBusyWindows.length}개를 함께 확인했습니다. ${workAnalysis.summary} 제안: ${workAnalysis.improvementSuggestions[0]}`,
    auditMessages: [
      ...(mailResult.auditMessages ?? []),
      ...(calendarContext.auditMessages ?? []),
      "메일 업무 분석이 집계 신호로 작업 방식과 개선 제안을 만들었습니다.",
      "초기 메일 프로필 학습이 말투, 광고 제외, 대량 발송, 일정, 승인 습관을 비밀값 없이 저장 후보로 요약했습니다.",
      ...(attachmentOrganizerPlan.auditMessages ?? []),
      "메일 업무 후보와 Google Calendar freeBusy 읽기 context를 같은 provider intake report로 합쳤습니다.",
    ],
  };
}

export async function downloadConnectedImapAttachments(options = {}, input = {}) {
  const vault = await readConnectorVault(options);
  const connectorId = sanitizeText(input.connectorId ?? "");
  const selection = resolveMailConnectorRecord(vault, connectorId);
  const record = selection.record;
  const uid = normalizeMailAttachmentUid(input.uid ?? input.messageUid ?? input.messageId);
  const mailbox = sanitizeText(input.mailbox ?? input.mailboxLabel ?? "INBOX") || "INBOX";
  const downloadRootPath = resolveMailAttachmentDownloadRoot(options, input.downloadRootPath ?? input.localStorageRoot);

  if (selection.selectionRequired) {
    return createMailAttachmentDownloadBridgeResult({
      status: "mail_connector_selection_required",
      providerId: "imap_smtp",
      connectorId: "",
      mailbox,
      userMessage: "첨부를 확인할 메일 계정 하나를 먼저 선택해 주세요.",
      auditMessages: ["Attachment download stopped before reading because connector selection is required"],
    });
  }

  if (!record || record.category !== "mail") {
    return createMailAttachmentDownloadBridgeResult({
      status: "mail_connector_missing",
      providerId: "imap_smtp",
      connectorId: connectorId || "company-mail",
      mailbox,
      userMessage: "첨부를 내려받을 메일 연결이 없습니다. 메일 연결에서 회사 IMAP을 먼저 연결해 주세요.",
      auditMessages: ["IMAP connector record not found for attachment download"],
    });
  }

  if (record.method !== "imap_smtp") {
    return createMailAttachmentDownloadBridgeResult({
      status: "imap_attachment_download_not_supported",
      providerId: record.providerId || "oauth_mail",
      connectorId: record.connectorId,
      mailbox,
      userMessage: "현재 자동 첨부 임시저장은 회사 IMAP 연결에서 먼저 지원합니다. 이 계정은 파일 선택으로 승인 카드를 만들 수 있습니다.",
      auditMessages: [`Attachment download skipped for non-IMAP connector ${record.connectorId}`],
    });
  }

  const username = decryptVaultValue(record.usernameCiphertext, options.safeStorage, "IMAP username");
  const password = decryptVaultValue(record.secretCiphertext, options.safeStorage, "IMAP password");
  if (username.status !== "credential_ready" || password.status !== "credential_ready") {
    return createMailAttachmentDownloadBridgeResult({
      status: "needs_credentials",
      providerId: "imap_smtp",
      connectorId: record.connectorId,
      mailbox,
      userMessage: "메일 credential을 OS 보안 저장소에서 열 수 없습니다. 메일 연결을 다시 확인해 주세요.",
      auditMessages: [`IMAP credential unavailable for ${record.connectorId}`],
    });
  }

  const domain = await loadDomainRuntime();
  const connector = new domain.ModyMailImapLiveConnector(
    options.imapClientFactory ? { imapClientFactory: options.imapClientFactory } : {},
  );
  const result = await connector.downloadMessageAttachments({
    providerId: "imap_smtp",
    host: record.imapHost,
    port: Number(record.imapPort ?? 993),
    secure: record.imapSecure !== false,
    startTls: record.imapStartTls === true,
    username: username.value,
    password: password.value,
    mailbox,
    uid,
    downloadRootPath,
    maxAttachments: normalizeOptionalNumber(input.maxAttachments) ?? 8,
    maxBytesPerAttachment: normalizeOptionalNumber(input.maxBytesPerAttachment) ?? 20 * 1024 * 1024,
  });
  const files = (result.attachments ?? []).map((attachment, index) => ({
    id: attachment.id || `imap-attachment-${Date.now()}-${index}`,
    absolutePath: attachment.savedPath,
    path: attachment.savedPath,
    fileName: sanitizeText(attachment.filename) || `mail-attachment-${index + 1}`,
    name: sanitizeText(attachment.filename) || `mail-attachment-${index + 1}`,
    sizeBytes: Number(attachment.sizeBytes ?? 0),
    mimeType: sanitizeText(attachment.contentType),
    modifiedAt: new Date().toISOString(),
    selected: true,
    sourceKind: "mail_attachment",
    sourceFolderPath: path.dirname(attachment.savedPath),
    sourceFolderLabel: "메일 첨부 임시저장",
  }));

  return {
    ...result,
    connectorId: record.connectorId,
    providerId: "imap_smtp",
    files,
    userMessage:
      files.length > 0
        ? `${result.userMessage} 기존 폴더 정리 승인 카드로 이어갈 수 있습니다.`
        : result.userMessage,
    auditMessages: [
      ...(result.auditMessages ?? []),
      "OS 보안 저장소에서 credential을 복호화했지만 결과에는 원문을 포함하지 않았습니다.",
      "다운로드한 로컬 임시 파일만 renderer에 전달합니다.",
    ].map(sanitizeText),
  };
}

export async function executeProviderFinalAction(input = {}, options = {}) {
  const actionKind = sanitizeText(input.actionKind ?? "");
  if (actionKind === "send_email") {
    return executeMailFinalAction(input, options);
  }

  if (actionKind === "send_bulk_email") {
    return executeBulkMailFinalAction(input, options);
  }

  if (actionKind === "create_calendar_event") {
    return executeCalendarFinalAction(input, options);
  }

  if (actionKind !== "send_email") {
    return {
      status: "provider_action_not_ready",
      actionKind,
      userMessage: "현재 live provider 실행 어댑터는 메일 발송과 캘린더 등록 후보부터 지원합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  return executeMailFinalAction(input, options);
}

async function runOAuthMailWorkIntake(record, options = {}, input = {}) {
  const writingProfile = await createMailIntakeWritingProfile(options, record?.accountId || record?.connectorId);
  const mailContext = await buildOAuthMailWorkflowContext(record, options, input);
  if (!mailContext.providerRead) {
    return {
      status: mailContext.status === "credential_unavailable" ? "needs_credentials" : "oauth_mail_connect_failed",
      providerId: record.providerId,
      connectorId: record.connectorId,
      readOnly: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      appMayPersistSecret: false,
      mailRead: mailContext.mailRead,
      userMessage: mailContext.userMessage ?? "OAuth 메일 연결을 읽을 수 없습니다. 연결을 다시 확인해 주세요.",
      auditMessages: mailContext.auditMessages ?? [],
    };
  }

  const calendarContext = await loadCalendarWorkflowContext(options, {
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    timeZone: input.timeZone,
  });
  const calendarReads = calendarContext.providerReads ?? [];
  const domain = await loadDomainRuntime();
  const planner = new domain.ModyProviderWorkIntakePlanner({
    ...(options.now ? { now: options.now } : {}),
  });
  const workReport = await createJevMailWorkReport({ domain, planner, scopeKey: jevMailScope(record), input: {
    reads: [mailContext.providerRead, ...calendarReads],
    writingProfile,
    reportChannelId: "desktop",
    appDeepLinkBase: "modycrew://mail-intake",
  } }, options);
  const workAnalysis = domain.analyzeMailWorkPattern({
    providerRead: mailContext.providerRead,
    workReport,
  });
  const initialLearningProfile = domain.createMailInitialLearningProfile({
    providerReads: [mailContext.providerRead],
    workReports: [workReport],
    workAnalysis,
    writingProfile,
    createdAt: options.now ? options.now().toISOString() : new Date().toISOString(),
    sourceScopes: ["inbox_metadata", "sent_history_metadata"],
  });
  const attachmentOrganizerPlan = domain.createMailAttachmentOrganizerPlan({
    providerReads: [mailContext.providerRead],
    workReports: [workReport],
    workAnalysis,
    createdAt: options.now ? options.now().toISOString() : new Date().toISOString(),
  });

  return {
    status: workReport.status === "ready_for_review"
      ? "oauth_mail_connected_ready_for_review"
      : "oauth_mail_connected_quiet",
    providerId: record.providerId,
    connectorId: record.connectorId,
    readOnly: true,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    appMayPersistSecret: false,
    mailRead: mailContext.mailRead,
    providerRead: mailContext.providerRead,
    workReport,
    workAnalysis,
    initialLearningProfile,
    attachmentOrganizerPlan,
    userMessage: `${mailContext.userMessage ?? "OAuth 메일함 확인 완료"} 캘린더 바쁜 시간 ${workReport.calendarBusyWindows.length}개를 함께 확인했습니다. ${workAnalysis.summary} 제안: ${workAnalysis.improvementSuggestions[0]}`,
    auditMessages: [
      ...(mailContext.auditMessages ?? []),
      ...(calendarContext.auditMessages ?? []),
      "메일 업무 분석이 집계 신호로 작업 방식과 개선 제안을 만들었습니다.",
      "초기 메일 프로필 학습이 말투, 광고 제외, 대량 발송, 일정, 승인 습관을 비밀값 없이 저장 후보로 요약했습니다.",
      ...(attachmentOrganizerPlan.auditMessages ?? []),
      "OAuth 메일 읽기 결과와 캘린더 읽기 context를 같은 provider intake report로 합쳤습니다.",
    ],
  };
}

/**
 * 발송·등록에 쓸 연결 기록 찾기. 메일 계정을 여러 개 붙일 수 있게 되면서 저장 키가 '제품__주소'
 * (buildConnectorAccountKey)가 됐는데, 발송은 제품 이름(company-mail·gmail)으로만 찾아서
 * 주소가 있는 계정은 늘 '연결 기록을 찾지 못했습니다'로 멈췄습니다.
 * 찾는 순서: 계정 키(accountId) > 그 이름의 저장 키 > 같은 제품 계정이 하나뿐일 때 그 계정.
 * 같은 제품 계정이 여럿인데 어느 계정인지 모르면 아무 계정이나 고르지 않습니다.
 */
function resolveFinalActionVaultRecord(vault, connectorId, accountId) {
  const connectors = vault?.connectors && typeof vault.connectors === "object" ? vault.connectors : {};
  const records = Object.values(connectors).filter((record) => record && typeof record === "object");
  const findByKey = (key) => {
    if (!key) return null;
    if (connectors[key]) return connectors[key];
    return records.find((record) => record.accountId === key) ?? null;
  };
  const requestedAccountId = sanitizeConnectorAccountKey(accountId);
  if (requestedAccountId) {
    // 계정을 정해서 보냈으면 그 계정만 씁니다(없어졌다고 다른 계정으로 대신 보내지 않음).
    return { record: findByKey(requestedAccountId), ambiguous: false };
  }
  const direct = findByKey(connectorId);
  if (direct) return { record: direct, ambiguous: false };
  const sameProduct = records.filter((record) => record.connectorId === connectorId);
  if (sameProduct.length === 1) return { record: sameProduct[0], ambiguous: false };
  return { record: null, ambiguous: sameProduct.length > 1 };
}

function sanitizeConnectorAccountKey(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9._-]{1,160}$/.test(text) ? text : "";
}

async function executeMailFinalAction(input, options = {}) {
  const vault = await readConnectorVault(options);
  const connectorId = sanitizeText(input.connectorId ?? "company-mail") || "company-mail";
  const resolvedRecord = resolveFinalActionVaultRecord(vault, connectorId, input.accountId);
  const record = resolvedRecord.record;
  const message = input.message && typeof input.message === "object" ? input.message : {};
  const recipient = sanitizeEmailAddress(message.recipient);
  // 실제로 나갈 제목·본문은 가림 처리하지 않습니다(전화번호·주소가 [redacted-…]로 바뀌어 발송되는 사고 방지).
  const subject = sanitizeOutgoingMailSubject(message.subject);
  // 발송 본문 한도는 인박스의 발송 원문 한도(20000자)와 같게 둡니다 — 더 짧으면 긴 답장이 말없이 잘립니다.
  const body = sanitizeTextBlock(message.body).slice(0, OUTGOING_MAIL_BODY_MAX_CHARS);
  const mailSendApprovalGate = normalizeProviderMailSendApprovalGate(message.mailSendApprovalGate);
  const mailSendApprovalGateCheck = validateProviderMailSendApprovalGate(mailSendApprovalGate);

  if (!record || record.category !== "mail") {
    return {
      status: "provider_connector_missing",
      providerDispatchAttempted: false,
      connectorId,
      userMessage: resolvedRecord.ambiguous
        ? "같은 종류의 메일 계정이 여러 개라 어느 계정에서 보낼지 정하지 못했어요. 보낼 계정을 확인한 뒤 다시 시도해 주세요."
        : "메일 provider 연결 기록을 찾지 못했습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!mailSendApprovalGateCheck.ok) {
    return {
      status: "provider_mail_send_approval_gate_required",
      providerDispatchAttempted: false,
      connectorId,
      userMessage: mailSendApprovalGateCheck.userMessage,
      missingRequirements: mailSendApprovalGateCheck.missingRequirements,
      mailSendApprovalGate: mailSendApprovalGateCheck.summary,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  let copies;
  try { copies = mailRecipientLists(recipient, message.cc, message.bcc); }
  catch (error) { return { status:'provider_payload_invalid',connectorId,userMessage:error.message,externalMutation:false,providerDispatchAttempted:false }; }
  let attachments;
  try {
    attachments = prepareMailAttachments(message.attachments);
  } catch (error) {
    return {
      status: "provider_payload_invalid",
      providerDispatchAttempted: false,
      connectorId,
      userMessage: "첨부파일 이름, 형식, 내용 또는 용량이 올바르지 않아 메일을 발송하지 않았습니다.",
      attachmentValidationCode: /^mail_attachment[a-z_]+$/u.test(String(error?.message ?? ""))
        ? error.message
        : "mail_attachment_invalid",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const gmailThreadId = sanitizeGmailThreadId(message.threadId);
  const threadingFields = {
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    ...(Array.isArray(message.references) ? { references: message.references } : {}),
    ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
  };

  if (record.method === "gmail_access_token" || record.providerId === "gmail") {
    return executeOAuthMailFinalAction(
      record,
      { connectorId, recipient, cc:copies.cc, bcc:copies.bcc, subject, body, attachments, mailSendApprovalGate, ...threadingFields },
      options,
    );
  }

  if (record.method === "outlook_mail_access_token" || record.providerId === "outlook") {
    return executeOAuthMailFinalAction(
      record,
      { connectorId, recipient, cc:copies.cc, bcc:copies.bcc, subject, body, attachments, mailSendApprovalGate, ...threadingFields },
      options,
    );
  }

  if (record.method !== "imap_smtp") {
    return {
      status: "provider_live_adapter_unavailable",
      providerDispatchAttempted: false,
      connectorId,
      userMessage: "이 메일 연결 방식의 발송 어댑터가 아직 준비되지 않았습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const username = decryptVaultValue(record.usernameCiphertext, options.safeStorage, "SMTP username");
  const password = decryptVaultValue(record.secretCiphertext, options.safeStorage, "SMTP password");
  if (username.status !== "credential_ready" || password.status !== "credential_ready") {
    return {
      status: "provider_credential_unavailable",
      providerDispatchAttempted: false,
      connectorId,
      userMessage: "메일 발송 credential을 OS 보안 저장소에서 열 수 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!recipient || !subject || !body) {
    return {
      status: "provider_payload_invalid",
      providerDispatchAttempted: false,
      connectorId,
      userMessage: "수신자, 제목, 본문이 모두 있어야 메일 발송 어댑터를 실행할 수 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (typeof options.smtpSender !== "function") {
    return {
      status: "provider_live_adapter_unavailable",
      providerDispatchAttempted: false,
      connectorId,
      userMessage: "SMTP sender 어댑터가 아직 연결되지 않았습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  // 보내는 주소는 계정의 메일 주소입니다. 네이버·다음·일부 학교처럼 아이디로만 로그인하는 계정은
  // 아이디를 보내는 주소로 쓰면 발송이 깨지므로, 주소를 알 수 없으면 보내기 전에 멈추고 알려 줍니다.
  const from = resolveSmtpFromAddress(record, username.value);
  if (!from) {
    return {
      status: "provider_payload_invalid",
      providerDispatchAttempted: false,
      connectorId,
      failureKind: "payload_invalid",
      payloadIssue: "sender_address_missing",
      userMessage: "보내는 메일 주소를 확인해 주세요. 이 계정은 아이디로만 연결돼 있어 어떤 주소로 보낼지 알 수 없어요. 메일 연결에서 메일 주소를 함께 넣어 주세요.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  let sent;
  try {
    sent = await options.smtpSender({
      host: record.smtpHost || inferSmtpHost(record.imapHost),
      port: Number(record.smtpPort ?? inferSmtpPort(record.imapPort)),
      secure: record.smtpSecure ?? Number(record.smtpPort ?? inferSmtpPort(record.imapPort)) === 465,
      startTls: record.smtpStartTls ?? Number(record.smtpPort ?? inferSmtpPort(record.imapPort)) === 587,
      username: username.value,
      password: password.value,
      from,
      to: recipient,
      cc: copies.cc,
      bcc: copies.bcc,
      subject,
      text: body,
      ...(attachments.length ? { attachments } : {}),
      // 답장 스레딩 메타데이터(있을 때만) — 상대 메일함에서 스레드 유지용.
      // 값 검증/정리는 smtp-sender의 sanitizeRfcMessageId가 담당한다.
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(Array.isArray(message.references) ? { references: message.references } : {}),
    });
  } catch (error) {
    // 발송기가 예외를 던져도 감사 기록과 한국어 안내가 남도록 실패 결과로 바꿉니다.
    sent = {
      status: "failed",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)).slice(0, 240),
      ...describeSmtpFailure({ errorCode: error?.code, errorMessage: error?.message, smtpStage: error?.smtpStage }),
    };
  }

  if (sent?.status === "sent") {
    return {
      status: "provider_action_sent",
      connectorId,
      providerMessageId: sanitizeMailMessageIdValue(sent?.messageId) || undefined,
      ...(attachments.length ? {
        attachmentCount: attachments.length,
        attachmentBytes: attachments.reduce((total, attachment) => total + attachment.byteLength, 0),
      } : {}),
      userMessage: "메일을 보냈어요. 보낸편지함에서도 확인할 수 있어요.",
      externalMutation: true,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const failure = sent?.failureKind && sent?.userMessage
    ? { failureKind: sent.failureKind, userMessage: sent.userMessage }
    : describeSmtpFailure({ errorCode: sent?.errorCode, smtpCode: sent?.smtpCode, smtpStage: sent?.smtpStage, errorMessage: sent?.errorMessage });
  return {
    status: "provider_action_failed",
    connectorId,
    ...(['payload','connect','greeting','ehlo','starttls','auth','mail_from','rcpt_to'].includes(sent?.smtpStage) ? { providerDispatchAttempted:false } : {}),
    failureKind: sanitizeText(failure.failureKind).slice(0, 40) || "unknown",
    userMessage: sanitizeText(failure.userMessage).slice(0, 240),
    errorMessage: sanitizeText(sent?.errorMessage ?? "").slice(0, 240) || undefined,
    ...(sent?.errorCode ? { errorCode: sanitizeText(sent.errorCode).slice(0, 40) } : {}),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/** 한 통짜리 답장 본문 최대 길이(인박스 draft.sendBody 한도와 같음). */
const OUTGOING_MAIL_BODY_MAX_CHARS = 20000;

/** SMTP 보내는 주소: 계정에 저장된 메일 주소 > 로그인 아이디가 메일 주소일 때만 그 아이디. */
function resolveSmtpFromAddress(record = {}, username = "") {
  return sanitizeEmailAddress(record.emailAddress) || sanitizeEmailAddress(username);
}

/** 발송용 제목: 줄바꿈·제어문자와 비밀값만 지우고 180자까지(가림 처리 없음). */
function sanitizeOutgoingMailSubject(value) {
  return String(value ?? "")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, "[redacted-google-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function sanitizeGmailThreadId(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9._~+/=-]{1,220}$/.test(text) ? text : "";
}

/** 발송 결과 Message-ID 는 '@'가 들어 있어도 가리지 않고, 공백·제어문자만 지웁니다. */
function sanitizeMailMessageIdValue(value) {
  return String(value ?? "").replace(/[\u0000- \u007f]/g, "").slice(0, 160);
}

async function executeOAuthMailFinalAction(record, message, options = {}) {
  const connectorId = message.connectorId;
  if (!hasMailSendScope(record)) {
    return {
      status: "provider_permission_required",
      providerDispatchAttempted: false,
      connectorId,
      userMessage:
        record.providerId === "outlook"
          ? "현재 Outlook 연결은 읽기 전용입니다. 최종 발송을 실행하려면 Mail.Send 권한으로 다시 연결해야 합니다."
          : "현재 Gmail 연결은 읽기 전용입니다. 최종 발송을 실행하려면 gmail.send 권한으로 다시 연결해야 합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!message.recipient || !message.subject || !message.body) {
    return {
      status: "provider_payload_invalid",
      connectorId,
      userMessage: "수신자, 제목, 본문이 모두 있어야 OAuth 메일 발송 어댑터를 실행할 수 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  // Validate the exact JSON sent below before reading or refreshing an OAuth token.
  // Upload sessions are not implemented by this direct-send adapter.
  let outlookRequestBody;
  if (record.providerId === "outlook") {
    if (message.attachments?.some((attachment) => attachment.byteLength >= outlookDirectAttachmentLimitBytes)) {
      return {
        status: "provider_payload_invalid",
        connectorId,
        attachmentValidationCode: "outlook_attachment_size_exceeded",
        userMessage: "Outlook 직접 발송은 첨부파일당 3 MB 미만만 지원합니다. 파일 크기를 줄여 다시 확인해 주세요.",
        maxAttachmentBytes: outlookDirectAttachmentLimitBytes - 1,
        providerDispatchAttempted: false,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }
    outlookRequestBody = renderOutlookMailRequestBody(message);
    const requestBytes = Buffer.byteLength(outlookRequestBody, "utf8");
    if (requestBytes > outlookDirectRequestMaxBytes) {
      return {
        status: "provider_payload_invalid",
        connectorId,
        attachmentValidationCode: "outlook_request_size_exceeded",
        userMessage: "Outlook 직접 발송 요청이 4 MB를 넘습니다. 첨부 개수나 파일 크기를 줄여 다시 확인해 주세요.",
        requestBytes,
        maxRequestBytes: outlookDirectRequestMaxBytes,
        providerDispatchAttempted: false,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }
  }

  const token = await resolveOAuthAccessToken(record, options, `${record.providerId} mail access token`);
  if (token.status !== "credential_ready") {
    return {
      status: "provider_credential_unavailable",
      connectorId,
      userMessage: token.userMessage ?? "메일 access token을 OS 보안 저장소에서 열 수 없습니다.",
      auditMessages: token.auditMessages ?? [],
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const result =
    record.providerId === "outlook"
      ? await sendOutlookMailMessage({
          accessToken: token.value,
          requestBody: outlookRequestBody,
          fetch: options.fetch,
        })
      : await sendGmailMailMessage({
          accessToken: token.value,
          // 가림 처리된 값("[redacted-email]")이 아니라 실제 계정 주소를 씁니다(없으면 Gmail 이 채움).
          from: sanitizeEmailAddress(record.emailAddress) || sanitizeEmailAddress(record.username),
          recipient: message.recipient,
          cc: message.cc,
          bcc: message.bcc,
          subject: message.subject,
          body: message.body,
          attachments: message.attachments,
          ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
          ...(Array.isArray(message.references) ? { references: message.references } : {}),
          ...(message.threadId ? { threadId: message.threadId } : {}),
          fetch: options.fetch,
        });

  return {
    status: result.status === "mail_message_sent" ? "provider_action_sent" : result.status,
    connectorId,
    providerMessageId: result.messageId,
    ...(message.attachments?.length ? {
      attachmentCount: message.attachments.length,
      attachmentBytes: message.attachments.reduce((total, attachment) => total + attachment.byteLength, 0),
    } : {}),
    userMessage:
      result.status === "mail_message_sent"
        ? `메일을 보냈어요. ${record.providerId === "outlook" ? "Outlook" : "Gmail"} 보낸편지함에서도 확인할 수 있어요.`
        : result.userMessage,
    errorMessage: result.errorMessage,
    auditMessages: [...(token.auditMessages ?? []), ...(result.auditMessages ?? [])].map(sanitizeText),
    externalMutation: result.status === "mail_message_sent",
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function normalizeProviderMailSendApprovalGate(value = {}) {
  const gate = value && typeof value === "object" ? value : {};
  return {
    status: sanitizeText(gate.status).slice(0, 120),
    policy: sanitizeText(gate.policy).slice(0, 160),
    sourceContract: sanitizeText(gate.sourceContract).slice(0, 180),
    externalMutationBeforeGate: gate.externalMutationBeforeGate === false ? false : gate.externalMutationBeforeGate,
  };
}

function validateProviderMailSendApprovalGate(gate = {}) {
  const missingRequirements = [];
  if (gate.status !== "approved_mail_send_gate_ready") {
    missingRequirements.push("approvedMailSendGate");
  }
  if (gate.policy !== "approved_mail_work_queue_or_user_composed_check_before_live_send") {
    missingRequirements.push("mailSendApprovalPolicy");
  }
  if (!/work_queue_review|user_composed_mail_check|approval_candidate/u.test(gate.sourceContract || "")) {
    missingRequirements.push("mailSendApprovalSource");
  }
  if (gate.externalMutationBeforeGate !== false) {
    missingRequirements.push("externalMutationBeforeGateFalse");
  }
  return {
    ok: missingRequirements.length === 0,
    missingRequirements,
    summary: {
      status: gate.status || "missing",
      policy: gate.policy || "missing",
      sourceContract: gate.sourceContract || "missing",
      externalMutationBeforeGate: gate.externalMutationBeforeGate === false ? false : true,
    },
    userMessage:
      "승인된 메일 업무대장 결정 또는 작성 메일 점검 승인 영수증 없이는 provider 메일 발송 어댑터를 실행하지 않습니다.",
  };
}

function normalizeProviderBulkMailApprovalGate(value = {}) {
  const gate = value && typeof value === "object" ? value : {};
  return {
    status: sanitizeText(gate.status).slice(0, 120),
    policy: sanitizeText(gate.policy).slice(0, 180),
    sourceContract: sanitizeText(gate.sourceContract).slice(0, 220),
    recipientCountConfirmed: normalizePositiveInteger(gate.recipientCountConfirmed),
    expectedRecipientCount: normalizePositiveInteger(gate.expectedRecipientCount),
    exclusionsReviewed: gate.exclusionsReviewed === true,
    sampleReviewed: gate.sampleReviewed === true,
    recipientReviewContract: sanitizeText(gate.recipientReviewContract).slice(0, 220),
    externalMutationBeforeGate: gate.externalMutationBeforeGate === false ? false : gate.externalMutationBeforeGate,
  };
}

function validateProviderBulkMailApprovalGate(gate = {}) {
  const missingRequirements = [];
  if (gate.status !== "approved_bulk_mail_gate_ready") {
    missingRequirements.push("approvedBulkMailGate");
  }
  if (gate.policy !== "approved_bulk_mail_recipient_review_sample_before_live_send") {
    missingRequirements.push("bulkMailApprovalPolicy");
  }
  if (!/recipient_list_review/u.test(gate.sourceContract || "")) {
    missingRequirements.push("recipientListReviewSource");
  }
  if (!/bulk_mail_candidate/u.test(gate.sourceContract || "")) {
    missingRequirements.push("bulkMailCandidateSource");
  }
  if (!/final_confirmation/u.test(gate.sourceContract || "")) {
    missingRequirements.push("finalConfirmationSource");
  }
  if (!/execution_log/u.test(gate.sourceContract || "")) {
    missingRequirements.push("executionLogSource");
  }
  if (!gate.recipientCountConfirmed) {
    missingRequirements.push("recipientCountConfirmed");
  }
  if (!gate.expectedRecipientCount) {
    missingRequirements.push("expectedRecipientCount");
  }
  if (
    gate.recipientCountConfirmed &&
    gate.expectedRecipientCount &&
    gate.recipientCountConfirmed !== gate.expectedRecipientCount
  ) {
    missingRequirements.push("recipientCountGateMatch");
  }
  if (gate.exclusionsReviewed !== true) {
    missingRequirements.push("exclusionsReviewed");
  }
  if (gate.sampleReviewed !== true) {
    missingRequirements.push("sampleReviewed");
  }
  if (!/bulk_mail_review_to_recipient_sample_personalization_final_confirmation|recipient_sample/u.test(
    gate.recipientReviewContract || "",
  )) {
    missingRequirements.push("recipientReviewContract");
  }
  if (gate.externalMutationBeforeGate !== false) {
    missingRequirements.push("externalMutationBeforeGateFalse");
  }
  return {
    ok: missingRequirements.length === 0,
    missingRequirements,
    summary: {
      status: gate.status || "missing",
      policy: gate.policy || "missing",
      sourceContract: gate.sourceContract || "missing",
      recipientCountConfirmed: gate.recipientCountConfirmed || 0,
      expectedRecipientCount: gate.expectedRecipientCount || 0,
      exclusionsReviewed: gate.exclusionsReviewed === true,
      sampleReviewed: gate.sampleReviewed === true,
      recipientReviewContract: gate.recipientReviewContract || "missing",
      externalMutationBeforeGate: gate.externalMutationBeforeGate === false ? false : true,
    },
    userMessage:
      "승인된 대량 메일 명단 검토, 샘플 확인, 최종 확인 영수증 없이는 provider 대량 발송 어댑터를 실행하지 않습니다.",
  };
}

async function executeBulkMailFinalAction(input, options = {}) {
  const vault = await readConnectorVault(options);
  const connectorId = sanitizeText(input.connectorId ?? "company-mail") || "company-mail";
  const record = resolveFinalActionVaultRecord(vault, connectorId, input.accountId).record;
  const message = input.message && typeof input.message === "object" ? input.message : {};
  const subject = sanitizeText(message.subject).slice(0, 180);
  const body = sanitizeTextBlock(message.body).slice(0, 12000);
  const expectedRecipientCount = normalizePositiveInteger(message.recipientCount);
  const recipientSource =
    message.recipientSource && typeof message.recipientSource === "object" ? message.recipientSource : {};
  const sourcePath = sanitizeLocalRecipientListPath(recipientSource.localFilePath);
  const sourceType = inferRecipientListSourceType(sourcePath, recipientSource.sourceType);

  if (!record || record.category !== "mail" || record.method !== "imap_smtp") {
    return {
      status: "provider_connector_missing",
      connectorId,
      userMessage: "메일 provider 연결 기록을 찾지 못했습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const bulkApprovalGate = normalizeProviderBulkMailApprovalGate(message.bulkMailApprovalGate);
  const bulkApprovalGateValidation = validateProviderBulkMailApprovalGate(bulkApprovalGate);
  if (!bulkApprovalGateValidation.ok) {
    return {
      status: "provider_bulk_mail_approval_gate_required",
      connectorId,
      userMessage: bulkApprovalGateValidation.userMessage,
      missingRequirements: bulkApprovalGateValidation.missingRequirements,
      bulkMailApprovalGate: bulkApprovalGateValidation.summary,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const username = decryptVaultValue(record.usernameCiphertext, options.safeStorage, "SMTP username");
  const password = decryptVaultValue(record.secretCiphertext, options.safeStorage, "SMTP password");
  if (username.status !== "credential_ready" || password.status !== "credential_ready") {
    return {
      status: "provider_credential_unavailable",
      connectorId,
      userMessage: "메일 발송 credential을 OS 보안 저장소에서 열 수 없습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!sourcePath || !subject || !body) {
    return {
      status: "provider_payload_invalid",
      connectorId,
      userMessage: "명단 원본 파일, 제목, 본문이 모두 있어야 대량 메일 어댑터를 실행할 수 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const recipientList = await loadBulkMailRecipientsFromFile(sourcePath, sourceType);
  if (recipientList.status !== "bulk_recipients_ready") {
    return {
      status: recipientList.status,
      connectorId,
      userMessage: recipientList.userMessage,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!expectedRecipientCount) {
    // 최종 확인한 발송 후보 수가 없으면 원본 재검증 자체가 불가능하므로 발송을 차단합니다.
    // (예전에는 후보 수가 비어 있으면 수 일치 검증을 통째로 건너뛰어, 명단 파일이
    //  바뀌어도 그대로 대량 발송될 수 있었습니다.)
    return {
      status: "provider_recipient_count_required",
      connectorId,
      userMessage:
        "대량 메일은 최종 확인한 발송 후보 수가 있어야 발송할 수 있습니다. 발송 후보 수를 확인한 뒤 다시 시도해 주세요.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (recipientList.recipients.length !== expectedRecipientCount) {
    return {
      status: "provider_payload_mismatch",
      connectorId,
      userMessage: `최종 확인한 발송 후보 수 ${expectedRecipientCount}건과 원본 재검증 결과 ${recipientList.recipients.length}건이 일치하지 않아 발송을 차단했습니다.`,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const maxRecipients = normalizePositiveInteger(options.maxBulkMailRecipients) || 500;
  if (recipientList.recipients.length > maxRecipients) {
    return {
      status: "provider_bulk_recipient_limit",
      connectorId,
      userMessage: `현재 안전 게이트는 1회 대량 발송을 ${maxRecipients}건까지 허용합니다. 명단을 나누거나 발송 한도를 조정해야 합니다.`,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const bulkSender =
    typeof options.smtpBulkSender === "function"
      ? options.smtpBulkSender
      : typeof options.smtpSender === "function"
        ? createSequentialBulkSmtpSender(options.smtpSender)
        : null;
  if (!bulkSender) {
    return {
      status: "provider_live_adapter_unavailable",
      connectorId,
      userMessage: "SMTP bulk sender 어댑터가 아직 연결되지 않았습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const bulkFrom = resolveSmtpFromAddress(record, username.value);
  if (!bulkFrom) {
    return {
      status: "provider_payload_invalid",
      connectorId,
      failureKind: "payload_invalid",
      payloadIssue: "sender_address_missing",
      userMessage: "보내는 메일 주소를 확인해 주세요. 이 계정은 아이디로만 연결돼 있어 어떤 주소로 보낼지 알 수 없어요. 메일 연결에서 메일 주소를 함께 넣어 주세요.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const sent = await bulkSender({
    host: record.smtpHost || inferSmtpHost(record.imapHost),
    port: Number(record.smtpPort ?? inferSmtpPort(record.imapPort)),
    secure: record.smtpSecure ?? Number(record.smtpPort ?? inferSmtpPort(record.imapPort)) === 465,
    startTls: record.smtpStartTls ?? Number(record.smtpPort ?? inferSmtpPort(record.imapPort)) === 587,
    username: username.value,
    password: password.value,
    from: bulkFrom,
    recipients: recipientList.recipients,
    subject,
    text: body,
  });
  const sentCount = normalizePositiveInteger(sent?.sentCount) || 0;
  const failedCount = normalizePositiveInteger(sent?.failedCount) || 0;
  const allSent = sent?.status === "sent" && sentCount === recipientList.recipients.length && failedCount === 0;

  return {
    status: allSent
      ? "provider_action_sent"
      : sentCount > 0
        ? "provider_action_partial"
        : "provider_action_failed",
    connectorId,
    providerMessageId: sanitizeText(sent?.messageId ?? `bulk-${sentCount}-${failedCount}`).slice(0, 160) || undefined,
    userMessage: allSent
      ? `SMTP bulk sender 어댑터가 대량 메일 ${sentCount}건 발송을 완료했습니다.`
      : sentCount > 0
        ? `SMTP bulk sender 어댑터가 ${sentCount}건을 발송했고 ${failedCount}건은 실패했습니다.`
        : "SMTP bulk sender 어댑터가 대량 메일 발송에 실패했습니다.",
    sentCount,
    failedCount,
    recipientCount: recipientList.recipients.length,
    externalMutation: sentCount > 0,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createSequentialBulkSmtpSender(smtpSender) {
  return async (input = {}) => {
    const recipients = Array.isArray(input.recipients) ? input.recipients : [];
    let sentCount = 0;
    let failedCount = 0;
    const messageIds = [];

    for (const recipient of recipients) {
      const result = await smtpSender({
        host: input.host,
        port: input.port,
        startTls: input.startTls,
        secure: input.secure,
        username: input.username,
        password: input.password,
        from: input.from,
        to: recipient,
        subject: input.subject,
        text: input.text,
      });
      if (result?.status === "sent") {
        sentCount += 1;
        if (result.messageId) messageIds.push(result.messageId);
      } else {
        failedCount += 1;
      }
    }

    return {
      status: sentCount === recipients.length && failedCount === 0 ? "sent" : sentCount > 0 ? "partial" : "failed",
      sentCount,
      failedCount,
      messageId: messageIds.length === 1 ? messageIds[0] : `bulk-${sentCount}-${failedCount}`,
      externalMutation: sentCount > 0,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  };
}

async function loadBulkMailRecipientsFromFile(sourcePath, sourceType) {
  const rows =
    sourceType === "xlsx"
      ? await readBulkRecipientWorkbookRows(sourcePath)
      : sourceType === "csv" || sourceType === "tsv"
        ? await readBulkRecipientDelimitedRows(sourcePath, sourceType)
        : [];
  if (rows.length === 0) {
    return {
      status: "provider_recipient_list_empty",
      recipients: [],
      userMessage: "명단 원본에서 발송할 행을 찾지 못했습니다.",
    };
  }

  const headers = uniqueText(rows.flatMap((row) => Object.keys(row)));
  const addressColumn = findRecipientHeader(headers, /(email|e-mail|메일|이메일|주소|수신자|연락처)/iu);
  const excludeColumn = findRecipientHeader(headers, /(exclude|opt.?out|unsubscribe|수신거부|제외|발송제외|거부|중지)/iu);
  if (!addressColumn) {
    return {
      status: "provider_recipient_columns_missing",
      recipients: [],
      userMessage: "명단 원본에서 이메일/주소 열을 찾지 못해 발송을 차단했습니다.",
    };
  }

  const seen = new Set();
  const recipients = [];
  let excludedCount = 0;
  let duplicateCount = 0;
  let missingAddressCount = 0;

  for (const row of rows) {
    const address = sanitizeEmailAddress(row[addressColumn]);
    const excluded = recipientRowIsExcluded(row[excludeColumn]);
    if (!address) {
      missingAddressCount += 1;
      continue;
    }
    if (excluded) {
      excludedCount += 1;
      seen.add(address.toLowerCase());
      continue;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    recipients.push(address);
  }

  if (recipients.length === 0) {
    return {
      status: "provider_recipient_list_empty",
      recipients: [],
      userMessage: "제외/중복/주소 누락을 반영한 뒤 발송 후보가 없어 발송을 차단했습니다.",
    };
  }

  return {
    status: "bulk_recipients_ready",
    recipients,
    excludedCount,
    duplicateCount,
    missingAddressCount,
    userMessage: "명단 원본을 main process에서 재검증했습니다.",
  };
}

async function readBulkRecipientWorkbookRows(sourcePath) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const headers = worksheet.getRow(1).values
    .slice(1)
    .map((value, index) => sanitizeText(value || `열${index + 1}`));
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    for (let columnIndex = 1; columnIndex <= headers.length; columnIndex += 1) {
      record[headers[columnIndex - 1]] = bulkRecipientCellToString(row.getCell(columnIndex).value);
    }
    if (Object.values(record).some((value) => sanitizeText(value))) rows.push(record);
  });
  return rows.slice(0, 5000);
}

async function readBulkRecipientDelimitedRows(sourcePath, sourceType) {
  const raw = await readFile(sourcePath, "utf8");
  const delimiter = sourceType === "tsv" ? "\t" : ",";
  const records = parseBulkRecipientDelimitedText(raw, delimiter);
  if (records.length === 0) return [];
  const headers = records[0].map((value, index) => sanitizeText(value || `열${index + 1}`));
  return records.slice(1, 5001)
    .map((values) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = bulkRecipientCellToString(values[index] ?? "");
      });
      return row;
    })
    .filter((row) => Object.values(row).some((value) => sanitizeText(value)));
}

function parseBulkRecipientDelimitedText(raw, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

function bulkRecipientCellToString(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (typeof value.result !== "undefined") return bulkRecipientCellToString(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? "").join("").trim();
    return "";
  }
  return String(value).trim();
}

function sanitizeLocalRecipientListPath(value) {
  const resolved = path.resolve(String(value ?? "").trim());
  const extension = path.extname(resolved).toLowerCase();
  if (![".csv", ".tsv", ".xlsx", ".xlsm", ".xls"].includes(extension)) return "";
  if (!existsSync(resolved)) return "";
  return resolved;
}

function inferRecipientListSourceType(sourcePath, fallback) {
  const fromFallback = sanitizeText(fallback).toLowerCase();
  if (["csv", "tsv", "xlsx"].includes(fromFallback)) return fromFallback;
  const extension = path.extname(String(sourcePath ?? "")).toLowerCase();
  if (extension === ".csv") return "csv";
  if (extension === ".tsv") return "tsv";
  if (extension === ".xlsx" || extension === ".xlsm" || extension === ".xls") return "xlsx";
  return "";
}

function recipientRowIsExcluded(value) {
  return /^(1|true|yes|y|exclude|excluded|opt.?out|unsubscribe|수신거부|제외|거부|중지|발송제외)$/iu.test(
    String(value ?? "").trim(),
  );
}

function uniqueText(values) {
  return Array.from(new Set(values.map((value) => sanitizeText(value)).filter(Boolean)));
}

function findRecipientHeader(headers, pattern) {
  return headers.find((header) => pattern.test(header));
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

async function executeCalendarFinalAction(input, options = {}) {
  const vault = await readConnectorVault(options);
  const connectorId = sanitizeText(input.connectorId ?? "google-calendar") || "google-calendar";
  const record = resolveFinalActionVaultRecord(vault, connectorId, input.accountId).record;
  const message = input.message && typeof input.message === "object" ? input.message : {};
  const calendarId = sanitizeCalendarId(message.calendarId ?? message.calendar ?? "primary");
  const summary = sanitizeText(message.summary ?? message.subject ?? "ModyCrew 일정").slice(0, 180);
  const description = sanitizeTextBlock(message.description ?? message.body ?? "").slice(0, 6000);
  const startsAt = sanitizeOptionalIso(message.startsAt);
  const endsAt = sanitizeOptionalIso(message.endsAt);
  const attendees = normalizeCalendarAttendees(message.attendees);
  const reminderMinutes = normalizeCalendarReminderMinutes(message.reminderMinutes ?? message.reminder_minutes);
  const location = sanitizeCalendarLocation(message.location);
  const meetingUrl = sanitizeCalendarMeetingUrl(message.meetingUrl ?? message.meeting_url);
  const timeZone = sanitizeTimeZone(message.timeZone ?? record?.timeZone ?? "Asia/Seoul");
  const calendarWriteApprovalGate = normalizeProviderCalendarWriteApprovalGate(message.calendarWriteApprovalGate);
  const calendarWriteApprovalGateCheck = validateProviderCalendarWriteApprovalGate(calendarWriteApprovalGate);

  if (!record || record.category !== "calendar") {
    return {
      status: "provider_connector_missing",
      connectorId,
      userMessage: "캘린더 provider 연결 기록을 찾지 못했습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!calendarWriteApprovalGateCheck.ok) {
    return {
      status: "provider_calendar_write_approval_gate_required",
      connectorId,
      userMessage: calendarWriteApprovalGateCheck.userMessage,
      missingRequirements: calendarWriteApprovalGateCheck.missingRequirements,
      calendarWriteApprovalGate: calendarWriteApprovalGateCheck.summary,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!hasCalendarWriteScope(record)) {
    return {
      status: "provider_permission_required",
      connectorId,
      userMessage:
        "현재 캘린더 연결은 읽기 전용입니다. 일정 등록을 실행하려면 캘린더 쓰기 권한으로 다시 연결해야 합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!summary || !startsAt || !endsAt || new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    return {
      status: "provider_payload_invalid",
      connectorId,
      userMessage: "일정 제목, 시작 시각, 종료 시각을 올바르게 확인해야 캘린더 등록을 실행할 수 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const token = await resolveOAuthAccessToken(record, options, `${record.providerId} calendar access token`);
  if (token.status !== "credential_ready") {
    return {
      status: "provider_credential_unavailable",
      connectorId,
      userMessage: token.userMessage ?? "캘린더 access token을 OS 보안 저장소에서 열 수 없습니다.",
      auditMessages: token.auditMessages ?? [],
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const result =
    record.providerId === "outlook_calendar"
      ? await createOutlookCalendarEvent({
          accessToken: token.value,
          calendarId,
          summary,
          description,
          startsAt,
          endsAt,
          attendees,
          reminderMinutes,
          location,
          meetingUrl,
          timeZone,
          fetch: options.fetch,
        })
      : await createGoogleCalendarEvent({
          accessToken: token.value,
          calendarId,
          summary,
          description,
          startsAt,
          endsAt,
          attendees,
          reminderMinutes,
          location,
          meetingUrl,
          timeZone,
          fetch: options.fetch,
        });

  return {
    status: result.status === "calendar_event_created" ? "provider_action_sent" : result.status,
    connectorId,
    providerMessageId: result.eventId,
    userMessage:
      result.status === "calendar_event_created"
        ? "캘린더 provider 어댑터가 일정 등록을 완료했습니다."
        : result.userMessage,
    errorMessage: result.errorMessage,
    auditMessages: [...(token.auditMessages ?? []), ...(result.auditMessages ?? [])].map(sanitizeText),
    externalMutation: result.status === "calendar_event_created",
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function normalizeProviderCalendarWriteApprovalGate(value = {}) {
  const gate = value && typeof value === "object" ? value : {};
  return {
    status: sanitizeText(gate.status).slice(0, 120),
    policy: sanitizeText(gate.policy).slice(0, 180),
    sourceContract: sanitizeText(gate.sourceContract).slice(0, 220),
    dryRunRequired: gate.dryRunRequired === true,
    finalUserPresenceRequired: gate.finalUserPresenceRequired === true,
    externalMutationBeforeGate: gate.externalMutationBeforeGate === false ? false : gate.externalMutationBeforeGate,
  };
}

function validateProviderCalendarWriteApprovalGate(gate = {}) {
  const missingRequirements = [];
  if (gate.status !== "approved_calendar_write_gate_ready") {
    missingRequirements.push("approvedCalendarWriteGate");
  }
  if (gate.policy !== "approved_calendar_work_queue_final_confirmation_before_live_insert") {
    missingRequirements.push("calendarWriteApprovalPolicy");
  }
  if (!/calendar_candidate|final_confirmation|work_queue_review/u.test(gate.sourceContract || "")) {
    missingRequirements.push("calendarWriteApprovalSource");
  }
  if (gate.dryRunRequired !== true) {
    missingRequirements.push("calendarDryRunRequired");
  }
  if (gate.finalUserPresenceRequired !== true) {
    missingRequirements.push("calendarFinalUserPresenceRequired");
  }
  if (gate.externalMutationBeforeGate !== false) {
    missingRequirements.push("externalMutationBeforeGateFalse");
  }
  return {
    ok: missingRequirements.length === 0,
    missingRequirements,
    summary: {
      status: gate.status || "missing",
      policy: gate.policy || "missing",
      sourceContract: gate.sourceContract || "missing",
      dryRunRequired: gate.dryRunRequired === true,
      finalUserPresenceRequired: gate.finalUserPresenceRequired === true,
      externalMutationBeforeGate: gate.externalMutationBeforeGate === false ? false : true,
    },
    userMessage:
      "승인된 일정 후보, dry-run, 사용자 최종 확인 영수증 없이는 provider 캘린더 등록 어댑터를 실행하지 않습니다.",
  };
}

async function connectLiveProvider(payload, options) {
  const connectorId = String(payload.connectorId ?? "").trim();
  const input = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
  const method = String(input.method ?? "").trim();

  try {
    if (method === "imap_smtp") {
      const normalizedInput = normalizeImapConnectionInput(connectorId, input);
      if (normalizedInput.status !== "imap_input_ready") {
        if (normalizedInput.status === "imap_host_is_web_login_url") {
          return {
            ...normalizedInput,
            recovery: createConnectorRecoveryHint(
              createSyntheticConnectorRecord(
                connectorId,
                "imap_smtp",
                normalizedInput.status,
                normalizedInput.userMessage,
              ),
              { calendarWrite: false, messengerReport: false },
              options,
            ),
          };
        }
        return normalizedInput;
      }
      const connection = await connectDiscoveredImapProvider(connectorId, normalizedInput.input, input, options);
      const result = connection.result;
      if (result.status === "imap_connected") {
        try {
          // 저장하는 값은 자동탐색으로 교정된 connection.input 이다(원본 normalizedInput.input 아님).
          await upsertConnectorRecord(options, createImapRecord(connectorId, connection.input, result, options));
        } catch (storageError) {
          // IMAP 접속은 됐지만 자격증명 암호화/저장이 실패한 경우(예: OS 보안 저장소 없음).
          // 이걸 일반 연결 실패로 뭉개면 사용자가 서버/비밀번호를 계속 의심하게 되므로 별도 상태로 분리한다.
          return imapStorageUnavailableResult(connectorId, storageError, options);
        }
      }
      return result.status === "imap_connected" || result.status === "imap_server_discovery_confirmation_required"
        ? result
        : withImapRecoveryHint(connectorId, result, "IMAP live check 실패");
    }

    if (method === "bot_token" && connectorId === "telegram-bot") {
      const result = await verifyTelegramBot(input, options);
      if (result.status === "telegram_command_inbox_ready") {
        await upsertConnectorRecord(options, createTelegramRecord(input, result, options));
      }
      return result;
    }

    if (method === "bot_token" && connectorId === "slack-app") {
      const result = await verifySlackBot(input, options);
      if (result.status === "slack_command_inbox_ready") {
        await upsertConnectorRecord(options, createMessengerBotRecord("slack-app", "slack", input, result, options));
      }
      return result;
    }

    if (method === "bot_token" && connectorId === "discord-app") {
      const result = await verifyDiscordBot(input, options);
      if (result.status === "discord_command_inbox_ready") {
        await upsertConnectorRecord(options, createMessengerBotRecord("discord-app", "discord", input, result, options));
      }
      return result;
    }

    if (method === "oauth" && connectorId === "gmail") {
      return beginGmailOAuth(input, options);
    }

    if (method === "oauth" && connectorId === "outlook") {
      return beginOutlookMailOAuth(input, options);
    }

    if (method === "oauth" && connectorId === "google-calendar") {
      return beginGoogleCalendarOAuth(input, options);
    }

    if (method === "oauth" && connectorId === "outlook-calendar") {
      return beginOutlookCalendarOAuth(input, options);
    }

    if (
      (method === "google_calendar_access_token" || method === "oauth_access_token") &&
      connectorId === "google-calendar"
    ) {
      const result = await verifyGoogleCalendarAccessToken(input, options);
      if (result.status === "freebusy_loaded") {
        await upsertConnectorRecord(options, createGoogleCalendarRecord(input, result, options));
      }
      return result;
    }

    if (
      (method === "gmail_access_token" || method === "oauth_access_token") &&
      connectorId === "gmail"
    ) {
      const result = await verifyGmailAccessToken(input, options);
      if (result.status === "mail_loaded") {
        await upsertConnectorRecord(options, createOAuthMailRecord("gmail", "gmail", input, result, options));
      }
      return result;
    }

    if (
      (method === "outlook_mail_access_token" || method === "oauth_access_token") &&
      connectorId === "outlook"
    ) {
      const result = await verifyOutlookMailAccessToken(input, options);
      if (result.status === "mail_loaded") {
        await upsertConnectorRecord(options, createOAuthMailRecord("outlook", "outlook", input, result, options));
      }
      return result;
    }

    if (
      (method === "outlook_calendar_access_token" || method === "oauth_access_token") &&
      connectorId === "outlook-calendar"
    ) {
      const result = await verifyOutlookCalendarAccessToken(input, options);
      if (result.status === "freebusy_loaded") {
        await upsertConnectorRecord(options, createOutlookCalendarRecord(input, result, options));
      }
      return result;
    }

    if (method === "api_key" && connectorId === "google-gemini") {
      return verifyGeminiApiKey(input);
    }

    if (method === "site_login") {
      const result = createSiteLoginRecord(connectorId, input, options);
      if (result.status === "site_login_stored") {
        await upsertConnectorRecord(options, result.record);
      }
      const { record: _record, ...publicResult } = result;
      const stagedFallback = result.status === "site_login_stored"
        ? await stageSiteLoginFallbackWorkItem(result.record, options)
        : null;
      return {
        ...publicResult,
        ...(stagedFallback?.stagedWorkItem ? { stagedWorkItem: stagedFallback.stagedWorkItem } : {}),
        ...(stagedFallback?.status ? { fallbackStageStatus: stagedFallback.status } : {}),
      };
    }

    const recovery = createConnectorRecoveryHint(
      createSyntheticConnectorRecord(connectorId, method, "connector_method_not_ready", "이 연결 방식은 아직 안전한 실제 핸들러가 준비되지 않았습니다."),
      { calendarWrite: false, messengerReport: false },
      options,
    );
    return {
      status: "connector_method_not_ready",
      connectorId,
      method,
      userMessage:
        "이 연결 방식은 아직 안전한 실제 핸들러가 준비되지 않았습니다. 성공처럼 표시하지 않습니다.",
      recovery,
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  } catch (error) {
    const recovery = createConnectorRecoveryHint(
      createSyntheticConnectorRecord(connectorId, method, "connector_live_check_failed", "실제 연결 확인 중 오류가 발생했습니다."),
      { calendarWrite: false, messengerReport: false },
      options,
    );
    return {
      status: "connector_live_check_failed",
      connectorId,
      method,
      userMessage: "실제 연결 확인 중 오류가 발생했습니다.",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
      recovery,
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
}

function imapStorageUnavailableResult(connectorId, storageError, options) {
  const userMessage =
    "IMAP 메일함에는 정상 접속했지만, 이 PC의 OS 보안 저장소를 사용할 수 없어 연결 정보를 저장하지 못했습니다. 서버 주소나 앱 비밀번호 문제가 아니라 저장 단계 문제입니다. 앱을 다시 시작하거나 Windows 로그인 계정 상태를 확인한 뒤 다시 시도해 주세요.";
  const recovery = createConnectorRecoveryHint(
    createSyntheticConnectorRecord(connectorId, "imap_smtp", "connector_secure_storage_unavailable", userMessage),
    { calendarWrite: false, messengerReport: false },
    options,
  );
  return {
    status: "connector_secure_storage_unavailable",
    connectorId,
    method: "imap_smtp",
    userMessage,
    errorMessage: sanitizeText(storageError instanceof Error ? storageError.message : String(storageError)),
    recovery,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function stageSiteLoginFallbackWorkItem(record, options = {}) {
  if (typeof options.requestDesktopControlAction !== "function") return null;
  try {
    return await options.requestDesktopControlAction({
      capability: "stage_browser_work_item",
      featureEnabled: true,
      target: record.siteUrl,
      instruction: [
        `${record.siteLabel || record.siteHost || "외부 사이트"} 연결이 공식 API/OAuth 대신 사이트 로그인 보관함으로 저장되었습니다.`,
        "Computer Use 읽기 모드로 화면과 업무 후보를 확인하고, 클릭·입력·발송·삭제는 최종 승인 전 실행하지 마세요.",
        record.appPath ? `앱 위치 후보: ${record.appPath}` : "",
      ].filter(Boolean).join(" "),
    });
  } catch (error) {
    return {
      status: "fallback_work_item_stage_failed",
      userMessage: "사이트 로그인 대체 업무 카드를 만들지 못했습니다.",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
}

function createSyntheticConnectorRecord(connectorId, method, status, userMessage) {
  return {
    connectorId: sanitizeConnectorId(connectorId),
    method: sanitizeConnectorMethod(method),
    category: inferConnectorCategory(connectorId, method),
    providerId: sanitizeConnectorId(connectorId),
    status,
    userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function beginGmailOAuth(input = {}, options = {}) {
  const settings = readGmailOAuthSettings(input, options);
  if (!settings.clientId) {
    return createOAuthConfigurationMissingResult({
      connectorId: "gmail",
      providerId: "gmail",
      providerLabel: "Gmail",
    });
  }

  if (gmailOAuthSession?.callbackInFlight) {
    return createOAuthCallbackInProgressResult({
      connectorId: "gmail",
      providerId: "gmail",
      providerLabel: "Gmail",
      session: gmailOAuthSession,
    });
  }
  closeGmailOAuthSession();
  let session;
  try {
    session = await createConnectorOAuthSession({
      callbackPath: "/connector/gmail/oauth/callback",
      settings,
      options,
      handler: handleGmailOAuthCallback,
      extraAuthorizationParams: {
        access_type: "offline",
        prompt: "consent",
      },
    });
  } catch {
    return createOAuthCallbackUnavailableResult({
      connectorId: "gmail",
      providerId: "gmail",
      providerLabel: "Gmail",
      settings,
    });
  }
  gmailOAuthSession = {
    ...session,
    connectorId: "gmail",
    providerId: "gmail",
    requestedActions: ["list_mail_messages"],
    mailboxId: settings.mailboxId,
    query: settings.query,
  };
  const externalUrlOpened = await openAllowedConnectorExternalUrl(options.shell, session.authorizationUrl, options);

  return {
    status: "oauth_authorization_ready",
    connectorId: "gmail",
    method: "oauth",
    providerId: "gmail",
    authorizationUrl: session.authorizationUrl,
    callbackUrl: session.callbackUrl,
    callbackMode: session.callbackMode,
    callbackPort: session.callbackPort,
    state: session.state,
    externalUrlOpened,
    userMessage: externalUrlOpened
      ? "Gmail 동의 창을 열었습니다. 동의가 끝나면 앱이 access token을 OS 보안 저장소에 저장합니다."
      : "Gmail 동의 URL을 만들었습니다. 브라우저를 자동으로 열 수 없으면 URL을 직접 열어 주세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function handleGmailOAuthCallback(request, response, options = {}) {
  await handleMailOAuthCallback({
    request,
    response,
    options,
    session: gmailOAuthSession,
    closeSession: closeGmailOAuthSession,
    connectorId: "gmail",
    providerId: "gmail",
    providerLabel: "Gmail",
    exchangeCode: exchangeGoogleOAuthCode,
    verifyAccessToken: verifyGmailAccessToken,
    createRecord: (exchange, verified, session) =>
      createOAuthMailRecord(
        "gmail",
        "gmail",
        {
          secret: exchange.accessToken,
          refreshToken: exchange.refreshToken,
          accessTokenExpiresAt: exchange.accessTokenExpiresAt,
          clientId: session.clientId,
          tokenEndpoint: session.tokenEndpoint,
          scope: session.scope,
          credentialReferenceId: exchange.credentialReferenceId,
          mailboxId: session.mailboxId,
          query: session.query,
        },
        verified,
        options,
      ),
    inputFromSession: (accessToken, session) => ({
      method: "gmail_access_token",
      secret: accessToken,
      mailboxId: session.mailboxId,
      query: session.query,
    }),
    successMessage: "Gmail 연결이 완료되었습니다. 이제 앱 비밀번호 없이 메일 업무 점검에 Gmail 최신 메일이 반영됩니다.",
  });
}

async function beginOutlookMailOAuth(input = {}, options = {}) {
  const settings = readOutlookMailOAuthSettings(input, options);
  if (!settings.clientId) {
    return createOAuthConfigurationMissingResult({
      connectorId: "outlook",
      providerId: "outlook",
      providerLabel: "Outlook Mail",
    });
  }

  if (outlookMailOAuthSession?.callbackInFlight) {
    return createOAuthCallbackInProgressResult({
      connectorId: "outlook",
      providerId: "outlook",
      providerLabel: "Outlook Mail",
      session: outlookMailOAuthSession,
    });
  }
  closeOutlookMailOAuthSession();
  let session;
  try {
    session = await createConnectorOAuthSession({
      callbackPath: "/connector/outlook/oauth/callback",
      settings,
      options,
      handler: handleOutlookMailOAuthCallback,
      extraAuthorizationParams: {
        response_mode: "query",
      },
    });
  } catch {
    return createOAuthCallbackUnavailableResult({
      connectorId: "outlook",
      providerId: "outlook",
      providerLabel: "Outlook Mail",
      settings,
    });
  }
  outlookMailOAuthSession = {
    ...session,
    connectorId: "outlook",
    providerId: "outlook",
    requestedActions: ["list_mail_messages"],
    mailboxId: settings.mailboxId,
  };
  const externalUrlOpened = await openAllowedConnectorExternalUrl(options.shell, session.authorizationUrl, options);

  return {
    status: "oauth_authorization_ready",
    connectorId: "outlook",
    method: "oauth",
    providerId: "outlook",
    authorizationUrl: session.authorizationUrl,
    callbackUrl: session.callbackUrl,
    callbackMode: session.callbackMode,
    callbackPort: session.callbackPort,
    state: session.state,
    externalUrlOpened,
    userMessage: externalUrlOpened
      ? "Outlook Mail 동의 창을 열었습니다. 동의가 끝나면 앱이 access token을 OS 보안 저장소에 저장합니다."
      : "Outlook Mail 동의 URL을 만들었습니다. 브라우저를 자동으로 열 수 없으면 URL을 직접 열어 주세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function handleOutlookMailOAuthCallback(request, response, options = {}) {
  await handleMailOAuthCallback({
    request,
    response,
    options,
    session: outlookMailOAuthSession,
    closeSession: closeOutlookMailOAuthSession,
    connectorId: "outlook",
    providerId: "outlook",
    providerLabel: "Outlook Mail",
    exchangeCode: exchangeOutlookCalendarOAuthCode,
    verifyAccessToken: verifyOutlookMailAccessToken,
    createRecord: (exchange, verified, session) =>
      createOAuthMailRecord(
        "outlook",
        "outlook",
        {
          secret: exchange.accessToken,
          refreshToken: exchange.refreshToken,
          accessTokenExpiresAt: exchange.accessTokenExpiresAt,
          clientId: session.clientId,
          tokenEndpoint: session.tokenEndpoint,
          scope: session.scope,
          credentialReferenceId: exchange.credentialReferenceId,
          mailboxId: session.mailboxId,
        },
        verified,
        options,
      ),
    inputFromSession: (accessToken, session) => ({
      method: "outlook_mail_access_token",
      secret: accessToken,
      mailboxId: session.mailboxId,
    }),
    successMessage: "Outlook Mail 연결이 완료되었습니다. 이제 앱 비밀번호 없이 메일 업무 점검에 Microsoft 365 최신 메일이 반영됩니다.",
  });
}

async function handleMailOAuthCallback({
  request,
  response,
  options,
  session,
  closeSession,
  connectorId,
  providerId,
  providerLabel,
  exchangeCode,
  verifyAccessToken,
  createRecord,
  inputFromSession,
  successMessage,
}) {
  try {
    if (request.method !== "GET") {
      writeOAuthResponse(response, 405, {
        status: "oauth_callback_method_not_allowed",
        userMessage: `${providerLabel} OAuth callback은 GET만 처리합니다.`,
      });
      return;
    }

    if (!session) {
      writeOAuthResponse(response, 400, {
        status: "oauth_session_missing",
        userMessage: `${providerLabel} OAuth session이 없습니다. 앱에서 다시 연결을 시작하세요.`,
      });
      return;
    }

    const callbackUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (callbackUrl.pathname !== session.callbackPath) {
      writeOAuthResponse(response, 400, {
        status: "oauth_callback_path_mismatch",
        userMessage: `${providerLabel} OAuth callback path가 일치하지 않습니다.`,
      });
      return;
    }

    const returnedState = callbackUrl.searchParams.get("state") || "";
    const code = callbackUrl.searchParams.get("code") || "";
    const error = callbackUrl.searchParams.get("error") || "";
    if (!returnedState || returnedState !== session.state) {
      writeOAuthResponse(response, 400, {
        status: "oauth_state_mismatch",
        userMessage: `${providerLabel} OAuth state가 일치하지 않아 이 요청을 무시했습니다. 열린 브라우저에서 인증을 계속하거나 앱에서 다시 연결을 시작해 주세요.`,
      });
      return;
    }

    if (error) {
      writeOAuthResponse(response, 400, {
        status: "oauth_provider_error",
        userMessage: `${providerLabel} OAuth provider가 오류를 반환했습니다: ${sanitizeText(error)}`,
      });
      closeSession();
      return;
    }

    if (!code) {
      writeOAuthResponse(response, 400, {
        status: "oauth_code_missing",
        userMessage: `${providerLabel} authorization code가 없어 연결할 수 없습니다.`,
      });
      closeSession();
      return;
    }

    if (session.callbackInFlight) {
      writeOAuthResponse(response, 409, {
        status: "oauth_callback_in_progress",
        userMessage: `${providerLabel} OAuth 인증 결과를 이미 확인하고 있습니다. 잠시 기다려 주세요.`,
      });
      return;
    }
    session.callbackInFlight = true;

    const exchange = await exchangeCode(code, session, options);
    if (exchange.status !== "token_exchanged" || !exchange.accessToken) {
      writeOAuthResponse(response, 502, {
        status: exchange.status,
        userMessage: exchange.userMessage,
        errorMessage: exchange.errorMessage,
      });
      closeSession();
      return;
    }

    const verified = await verifyAccessToken(inputFromSession(exchange.accessToken, session), options);
    if (verified.status === "mail_loaded") {
      await upsertConnectorRecord(options, createRecord(exchange, verified, session));
    }

    writeOAuthResponse(response, verified.status === "mail_loaded" ? 200 : 502, {
      status: verified.status === "mail_loaded" ? "oauth_token_ready" : verified.status,
      connectorId,
      providerId,
      userMessage: verified.status === "mail_loaded" ? successMessage : verified.userMessage,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
    closeSession();
  } catch (error) {
    writeOAuthResponse(response, 500, {
      status: "oauth_callback_failed",
      userMessage: `${providerLabel} OAuth callback 처리 중 오류가 발생했습니다.`,
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
    });
    closeSession();
  }
}

async function beginGoogleCalendarOAuth(input = {}, options = {}) {
  const settings = readGoogleCalendarOAuthSettings(input, options);
  if (!settings.clientId) {
    return createOAuthConfigurationMissingResult({
      connectorId: "google-calendar",
      providerId: "google_calendar",
      providerLabel: "Google Calendar",
    });
  }

  if (googleCalendarOAuthSession?.callbackInFlight) {
    return createOAuthCallbackInProgressResult({
      connectorId: "google-calendar",
      providerId: "google_calendar",
      providerLabel: "Google Calendar",
      session: googleCalendarOAuthSession,
    });
  }
  closeGoogleCalendarOAuthSession();
  let session;
  try {
    session = await createConnectorOAuthSession({
      callbackPath: "/connector/google-calendar/oauth/callback",
      settings,
      options,
      handler: handleGoogleCalendarOAuthCallback,
      extraAuthorizationParams: {
        access_type: "offline",
        prompt: "consent",
      },
    });
  } catch {
    return createOAuthCallbackUnavailableResult({
      connectorId: "google-calendar",
      providerId: "google_calendar",
      providerLabel: "Google Calendar",
      settings,
    });
  }

  googleCalendarOAuthSession = {
    ...session,
    connectorId: "google-calendar",
    providerId: "google_calendar",
    requestedActions: ["list_calendar_events"],
    calendarIds: settings.calendarIds,
    timeZone: settings.timeZone,
  };

  const externalUrlOpened = await openAllowedConnectorExternalUrl(
    options.shell,
    googleCalendarOAuthSession.authorizationUrl,
    options,
  );

  return {
    status: "oauth_authorization_ready",
    connectorId: "google-calendar",
    method: "oauth",
    providerId: "google_calendar",
    authorizationUrl: googleCalendarOAuthSession.authorizationUrl,
    callbackUrl: session.callbackUrl,
    callbackMode: session.callbackMode,
    callbackPort: session.callbackPort,
    state: session.state,
    externalUrlOpened,
    userMessage: externalUrlOpened
      ? "Google Calendar 동의 창을 열었습니다. 동의가 끝나면 앱이 access token을 OS 보안 저장소에 저장합니다."
      : "Google Calendar 동의 URL을 만들었습니다. 브라우저를 자동으로 열 수 없으면 URL을 직접 열어 주세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function handleGoogleCalendarOAuthCallback(request, response, options = {}) {
  try {
    if (request.method !== "GET") {
      writeOAuthResponse(response, 405, {
        status: "oauth_callback_method_not_allowed",
        userMessage: "Google Calendar OAuth callback은 GET만 처리합니다.",
      });
      return;
    }

    const session = googleCalendarOAuthSession;
    if (!session) {
      writeOAuthResponse(response, 400, {
        status: "oauth_session_missing",
        userMessage: "Google Calendar OAuth session이 없습니다. 앱에서 다시 연결을 시작하세요.",
      });
      return;
    }

    const callbackUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (callbackUrl.pathname !== session.callbackPath) {
      writeOAuthResponse(response, 400, {
        status: "oauth_callback_path_mismatch",
        userMessage: "Google Calendar OAuth callback path가 일치하지 않습니다.",
      });
      return;
    }

    const returnedState = callbackUrl.searchParams.get("state") || "";
    const code = callbackUrl.searchParams.get("code") || "";
    const error = callbackUrl.searchParams.get("error") || "";
    if (!returnedState || returnedState !== session.state) {
      writeOAuthResponse(response, 400, {
        status: "oauth_state_mismatch",
        userMessage: "Google Calendar OAuth state가 일치하지 않아 이 요청을 무시했습니다. 열린 브라우저에서 인증을 계속하거나 앱에서 다시 연결을 시작해 주세요.",
      });
      return;
    }

    if (error) {
      writeOAuthResponse(response, 400, {
        status: "oauth_provider_error",
        userMessage: `Google Calendar OAuth provider가 오류를 반환했습니다: ${sanitizeText(error)}`,
      });
      closeGoogleCalendarOAuthSession();
      return;
    }

    if (!code) {
      writeOAuthResponse(response, 400, {
        status: "oauth_code_missing",
        userMessage: "Google Calendar authorization code가 없어 연결할 수 없습니다.",
      });
      closeGoogleCalendarOAuthSession();
      return;
    }

    if (session.callbackInFlight) {
      writeOAuthResponse(response, 409, {
        status: "oauth_callback_in_progress",
        userMessage: "Google Calendar OAuth 인증 결과를 이미 확인하고 있습니다. 잠시 기다려 주세요.",
      });
      return;
    }
    session.callbackInFlight = true;

    const exchange = await exchangeGoogleCalendarOAuthCode(code, session, options);
    if (exchange.status !== "token_exchanged" || !exchange.accessToken) {
      writeOAuthResponse(response, 502, {
        status: exchange.status,
        userMessage: exchange.userMessage,
        errorMessage: exchange.errorMessage,
      });
      closeGoogleCalendarOAuthSession();
      return;
    }

    const verified = await verifyGoogleCalendarAccessToken(
      {
        method: "google_calendar_access_token",
        secret: exchange.accessToken,
        calendarIds: session.calendarIds,
        timeZone: session.timeZone,
      },
      options,
    );
    if (verified.status === "freebusy_loaded") {
      await upsertConnectorRecord(
        options,
        createGoogleCalendarRecord(
          {
            secret: exchange.accessToken,
            refreshToken: exchange.refreshToken,
            accessTokenExpiresAt: exchange.accessTokenExpiresAt,
            clientId: session.clientId,
            tokenEndpoint: session.tokenEndpoint,
            scope: session.scope,
            credentialReferenceId: exchange.credentialReferenceId,
            calendarIds: session.calendarIds,
            timeZone: session.timeZone,
          },
          verified,
          options,
        ),
      );
    }

    writeOAuthResponse(response, verified.status === "freebusy_loaded" ? 200 : 502, {
      status: verified.status === "freebusy_loaded" ? "oauth_token_ready" : verified.status,
      connectorId: "google-calendar",
      providerId: "google_calendar",
      userMessage:
        verified.status === "freebusy_loaded"
          ? "Google Calendar 연결이 완료되었습니다. 이제 메일 일정 후보에 캘린더 바쁜 시간이 반영됩니다."
          : verified.userMessage,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
    closeGoogleCalendarOAuthSession();
  } catch (error) {
    writeOAuthResponse(response, 500, {
      status: "oauth_callback_failed",
      userMessage: "Google Calendar OAuth callback 처리 중 오류가 발생했습니다.",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
    });
    closeGoogleCalendarOAuthSession();
  }
}

async function exchangeGoogleCalendarOAuthCode(code, session, options = {}) {
  return exchangeProviderOAuthCodeWithDomainContract(code, session, options);
}

async function exchangeGoogleOAuthCode(code, session, options = {}) {
  return exchangeGoogleCalendarOAuthCode(code, session, options);
}

async function beginOutlookCalendarOAuth(input = {}, options = {}) {
  const settings = readOutlookCalendarOAuthSettings(input, options);
  if (!settings.clientId) {
    return createOAuthConfigurationMissingResult({
      connectorId: "outlook-calendar",
      providerId: "outlook_calendar",
      providerLabel: "Outlook Calendar",
    });
  }

  if (outlookCalendarOAuthSession?.callbackInFlight) {
    return createOAuthCallbackInProgressResult({
      connectorId: "outlook-calendar",
      providerId: "outlook_calendar",
      providerLabel: "Outlook Calendar",
      session: outlookCalendarOAuthSession,
    });
  }
  closeOutlookCalendarOAuthSession();
  let session;
  try {
    session = await createConnectorOAuthSession({
      callbackPath: "/connector/outlook-calendar/oauth/callback",
      settings,
      options,
      handler: handleOutlookCalendarOAuthCallback,
      extraAuthorizationParams: {
        response_mode: "query",
      },
    });
  } catch {
    return createOAuthCallbackUnavailableResult({
      connectorId: "outlook-calendar",
      providerId: "outlook_calendar",
      providerLabel: "Outlook Calendar",
      settings,
    });
  }

  outlookCalendarOAuthSession = {
    ...session,
    connectorId: "outlook-calendar",
    providerId: "outlook_calendar",
    requestedActions: ["list_calendar_events"],
    scheduleIds: settings.scheduleIds,
    timeZone: settings.timeZone,
  };

  const externalUrlOpened = await openAllowedConnectorExternalUrl(
    options.shell,
    outlookCalendarOAuthSession.authorizationUrl,
    options,
  );

  return {
    status: "oauth_authorization_ready",
    connectorId: "outlook-calendar",
    method: "oauth",
    providerId: "outlook_calendar",
    authorizationUrl: outlookCalendarOAuthSession.authorizationUrl,
    callbackUrl: session.callbackUrl,
    callbackMode: session.callbackMode,
    callbackPort: session.callbackPort,
    state: session.state,
    externalUrlOpened,
    userMessage: externalUrlOpened
      ? "Outlook Calendar 동의 창을 열었습니다. 동의가 끝나면 앱이 access token을 OS 보안 저장소에 저장합니다."
      : "Outlook Calendar 동의 URL을 만들었습니다. 브라우저를 자동으로 열 수 없으면 URL을 직접 열어 주세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function handleOutlookCalendarOAuthCallback(request, response, options = {}) {
  try {
    if (request.method !== "GET") {
      writeOAuthResponse(response, 405, {
        status: "oauth_callback_method_not_allowed",
        userMessage: "Outlook Calendar OAuth callback은 GET만 처리합니다.",
      });
      return;
    }

    const session = outlookCalendarOAuthSession;
    if (!session) {
      writeOAuthResponse(response, 400, {
        status: "oauth_session_missing",
        userMessage: "Outlook Calendar OAuth session이 없습니다. 앱에서 다시 연결을 시작하세요.",
      });
      return;
    }

    const callbackUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (callbackUrl.pathname !== session.callbackPath) {
      writeOAuthResponse(response, 400, {
        status: "oauth_callback_path_mismatch",
        userMessage: "Outlook Calendar OAuth callback path가 일치하지 않습니다.",
      });
      return;
    }

    const returnedState = callbackUrl.searchParams.get("state") || "";
    const code = callbackUrl.searchParams.get("code") || "";
    const error = callbackUrl.searchParams.get("error") || "";
    if (!returnedState || returnedState !== session.state) {
      writeOAuthResponse(response, 400, {
        status: "oauth_state_mismatch",
        userMessage: "Outlook Calendar OAuth state가 일치하지 않아 이 요청을 무시했습니다. 열린 브라우저에서 인증을 계속하거나 앱에서 다시 연결을 시작해 주세요.",
      });
      return;
    }

    if (error) {
      writeOAuthResponse(response, 400, {
        status: "oauth_provider_error",
        userMessage: `Outlook Calendar OAuth provider가 오류를 반환했습니다: ${sanitizeText(error)}`,
      });
      closeOutlookCalendarOAuthSession();
      return;
    }

    if (!code) {
      writeOAuthResponse(response, 400, {
        status: "oauth_code_missing",
        userMessage: "Outlook Calendar authorization code가 없어 연결할 수 없습니다.",
      });
      closeOutlookCalendarOAuthSession();
      return;
    }

    if (session.callbackInFlight) {
      writeOAuthResponse(response, 409, {
        status: "oauth_callback_in_progress",
        userMessage: "Outlook Calendar OAuth 인증 결과를 이미 확인하고 있습니다. 잠시 기다려 주세요.",
      });
      return;
    }
    session.callbackInFlight = true;

    const exchange = await exchangeOutlookCalendarOAuthCode(code, session, options);
    if (exchange.status !== "token_exchanged" || !exchange.accessToken) {
      writeOAuthResponse(response, 502, {
        status: exchange.status,
        userMessage: exchange.userMessage,
        errorMessage: exchange.errorMessage,
      });
      closeOutlookCalendarOAuthSession();
      return;
    }

    const verified = await verifyOutlookCalendarAccessToken(
      {
        method: "outlook_calendar_access_token",
        secret: exchange.accessToken,
        scheduleIds: session.scheduleIds,
        timeZone: session.timeZone,
      },
      options,
    );
    if (verified.status === "freebusy_loaded") {
      await upsertConnectorRecord(
        options,
        createOutlookCalendarRecord(
          {
            secret: exchange.accessToken,
            refreshToken: exchange.refreshToken,
            accessTokenExpiresAt: exchange.accessTokenExpiresAt,
            clientId: session.clientId,
            tokenEndpoint: session.tokenEndpoint,
            scope: session.scope,
            credentialReferenceId: exchange.credentialReferenceId,
            scheduleIds: session.scheduleIds,
            timeZone: session.timeZone,
          },
          verified,
          options,
        ),
      );
    }

    writeOAuthResponse(response, verified.status === "freebusy_loaded" ? 200 : 502, {
      status: verified.status === "freebusy_loaded" ? "oauth_token_ready" : verified.status,
      connectorId: "outlook-calendar",
      providerId: "outlook_calendar",
      userMessage:
        verified.status === "freebusy_loaded"
          ? "Outlook Calendar 연결이 완료되었습니다. 이제 메일 일정 후보에 Microsoft 365 바쁜 시간이 반영됩니다."
          : verified.userMessage,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    });
    closeOutlookCalendarOAuthSession();
  } catch (error) {
    writeOAuthResponse(response, 500, {
      status: "oauth_callback_failed",
      userMessage: "Outlook Calendar OAuth callback 처리 중 오류가 발생했습니다.",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
    });
    closeOutlookCalendarOAuthSession();
  }
}

async function exchangeOutlookCalendarOAuthCode(code, session, options = {}) {
  return exchangeProviderOAuthCodeWithDomainContract(code, session, options);
}

async function exchangeProviderOAuthCodeWithDomainContract(code, session, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      status: "token_exchange_unavailable",
      userMessage: "이 환경에서 OAuth token 교환용 fetch runtime을 찾지 못했습니다.",
    };
  }

  try {
    const domain = await loadDomainRuntime();
    const planner = new domain.ModyProviderOAuthPlanner();
    const providerId = session.providerId ?? "google_calendar";
    const connectorId = session.connectorId ?? providerId;
    const requestedActions =
      Array.isArray(session.requestedActions) && session.requestedActions.length > 0
        ? session.requestedActions
        : providerId.includes("calendar")
          ? ["list_calendar_events"]
          : ["list_mail_messages"];
    const plan = planner.createAuthorizationPlan({
      connectorId,
      providerId,
      clientId: session.clientId,
      redirectUri: session.callbackUrl,
      state: session.state,
      requestedActions,
      ...(session.codeChallenge ? { codeChallenge: session.codeChallenge } : {}),
    });
    let tokenMaterial = null;
    const exchange = await new domain.ModyProviderOAuthTokenExchange({ fetch: fetchImpl })
      .exchangeCodeForCredentialReference({
        connectorId,
        providerId,
        plan,
        authorizationCode: code,
        codeVerifier: session.codeVerifier,
        clientId: session.clientId,
        ...(session.clientSecret ? { clientSecret: session.clientSecret } : {}),
        redirectUri: session.callbackUrl,
        grantedScopes: sanitizeStoredOAuthScope(session.scope).split(/\s+/).filter(Boolean),
        exchangedAt: new Date().toISOString(),
        storage: "os_keychain",
        credentialReferenceId: `${connectorId}:os-vault`,
        tokenMaterialSink: (material) => {
          tokenMaterial = material;
        },
      });

    if (exchange.status !== "token_exchange_completed" || !tokenMaterial?.accessToken) {
      return {
        status: exchange.status === "blocked" ? "token_exchange_failed" : exchange.status,
        userMessage: exchange.userMessage,
        errorMessage: sanitizeText(exchange.errorMessage ?? ""),
        tokenExchange: summarizeTokenExchange(exchange),
      };
    }

    return {
      status: "token_exchanged",
      accessToken: sanitizeAccessToken(tokenMaterial.accessToken),
      refreshToken: sanitizeAccessToken(tokenMaterial.refreshToken),
      accessTokenExpiresAt: computeTokenExpiresAt(tokenMaterial.expiresInSeconds, options),
      credentialReferenceId: exchange.credentialReferenceId,
      grantedScopes: exchange.grantedScopes,
      tokenExchange: summarizeTokenExchange(exchange),
      userMessage: `${providerId} OAuth token을 보안 저장소 reference로 교환했습니다. token 원문은 renderer로 반환하지 않습니다.`,
    };
  } catch (error) {
    return {
      status: "token_exchange_failed",
      userMessage: "OAuth token 교환 중 오류가 발생했습니다.",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
    };
  }
}

function summarizeTokenExchange(exchange) {
  return {
    status: sanitizeText(exchange?.status),
    tokenEndpoint: sanitizeStoredTokenEndpoint(exchange?.tokenEndpoint),
    credentialReferenceId: sanitizeText(exchange?.credentialReferenceId),
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    tokenMaterialStoredInApp: false,
    tokenMaterialReturnedToRenderer: false,
  };
}

async function listConnectors(options) {
  const vault = await readConnectorVault(options);
  const connectors = Object.values(vault.connectors)
    .map((record) => toConnectorStatusRecord(record, options))
    .sort((a, b) => String(b.lastCheckedAt).localeCompare(String(a.lastCheckedAt)));

  return {
    status: connectors.length > 0 ? "connector_status_ready" : "no_persisted_connectors",
    connectors,
    userMessage:
      connectors.length > 0
        ? "이 PC에 저장된 연결 상태를 불러왔습니다."
        : "저장된 연결 목록은 아직 없습니다. 연결 버튼을 눌러 실제 읽기 테스트부터 진행하세요.",
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function toConnectorStatusRecord(record, options = {}) {
  const permissions = {
    calendarWrite: record.category === "calendar" ? hasCalendarWriteScope(record) : false,
    mailSend: record.category === "mail" ? hasMailSendScope(record) : false,
    messengerReport: record.category === "messenger"
      ? Boolean(sanitizeTelegramChatId(record.chatId) || sanitizeChannelTargetId(record.channelTargetId))
      : false,
  };

  return {
    connectorId: record.connectorId,
    // 계정 단위 저장 키(같은 제품 계정이 여럿일 때 어느 계정인지 구분). 없으면 connectorId 가 곧 저장 키입니다.
    ...(sanitizeConnectorAccountKey(record.accountId) ? { accountId: sanitizeConnectorAccountKey(record.accountId) } : {}),
    method: record.method,
    category: record.category,
    status: record.status,
    lastCheckedAt: record.lastCheckedAt,
    secretFingerprint: record.secretFingerprint,
    credentialReferenceId: record.credentialReferenceId,
    credentialStorage: record.credentialStorage,
    aiSecretReadable: record.aiSecretReadable === true ? true : false,
    emailAddress: sanitizeEmailAddress(record.emailAddress),
    siteUrl: record.siteUrl,
    siteHost: record.siteHost,
    siteLabel: record.siteLabel,
    appPath: record.appPath,
    channelTargetId: record.channelTargetId,
    permissions,
    recovery: createConnectorRecoveryHint(record, permissions, options),
    userMessage: record.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createConnectorRecoveryHint(record, permissions = {}, options = {}) {
  const oauthIssue = classifyOAuthRecoveryIssue(record, permissions, options);
  if (oauthIssue) {
    return buildOAuthRecoveryHint(record, oauthIssue);
  }

  if (isOAuthAccessTokenExpired(record, options)) {
    return {
      kind: "credential_failed",
      label: "토큰 만료",
      detail: record.refreshTokenCiphertext
        ? "OAuth access token이 만료 임박 상태입니다. 실행 시 main process가 refresh를 시도하고, 실패하면 재연결이 필요합니다."
        : "OAuth access token이 만료되었고 refresh token이 없습니다. 다시 연결해 주세요.",
      actionLabel: "OAuth 재연결",
      fallbackRoutes: buildConnectorFallbackRoutes(record, "credential_failed"),
      fallbackConnectorIds: buildFallbackConnectorIds(record),
      safeNextActions: buildSafeNextActions(record, "credential_failed"),
    };
  }

  if (isReadyConnectorStatus(record.status)) {
    if (record.method === "site_login") {
      return {
        kind: "ready",
        label: "보관함 저장됨",
        detail: "공식 API/OAuth가 없을 때 사용할 사이트 링크, 계정 참조, 앱 위치 후보를 OS 보안 저장소와 연결 기록에 저장했습니다. 실제 클릭·입력은 Computer Use 승인 뒤에만 진행합니다.",
        actionLabel: "Computer Use 준비",
        fallbackRoutes: buildConnectorFallbackRoutes(record, "ready"),
        fallbackConnectorIds: buildFallbackConnectorIds(record),
        safeNextActions: buildSafeNextActions(record, "ready"),
      };
    }
    if (record.category === "calendar" && !permissions.calendarWrite) {
      return {
        kind: "oauth_write_scope_required",
        label: "쓰기 권한 없음",
        detail: "캘린더 바쁜 시간 읽기는 가능하지만 일정 등록은 쓰기 scope를 따로 연결해야 합니다. 최종 승인 카드 전에는 등록을 실행하지 않습니다.",
        actionLabel: "쓰기 권한 연결",
        fallbackRoutes: buildConnectorFallbackRoutes(record, "oauth_write_scope_required"),
        fallbackConnectorIds: buildFallbackConnectorIds(record),
        safeNextActions: buildSafeNextActions(record, "oauth_write_scope_required"),
      };
    }
    if (record.category === "mail" && record.method !== "imap_smtp" && !permissions.mailSend) {
      return {
        kind: "oauth_write_scope_required",
        label: "발송 권한 없음",
        detail: "메일 읽기는 가능하지만 최종 발송에는 Gmail send 또는 Microsoft Mail.Send 권한이 필요합니다. 앱 최종 확인 전에는 발송을 실행하지 않습니다.",
        actionLabel: "발송 권한 연결",
        fallbackRoutes: buildConnectorFallbackRoutes(record, "oauth_write_scope_required"),
        fallbackConnectorIds: buildFallbackConnectorIds(record),
        safeNextActions: buildSafeNextActions(record, "oauth_write_scope_required"),
      };
    }
    if (record.category === "messenger" && !permissions.messengerReport) {
      return {
        kind: "permission_required",
        label: "명령 수신 준비",
        detail: "메신저 token 확인은 됐지만 승인 알림을 받으려면 chat_id 또는 channel id를 추가로 저장해야 합니다.",
        actionLabel: "알림 대상",
        fallbackRoutes: buildConnectorFallbackRoutes(record, "permission_required"),
        fallbackConnectorIds: buildFallbackConnectorIds(record),
        safeNextActions: buildSafeNextActions(record, "permission_required"),
      };
    }
    return {
      kind: "ready",
      label: "연결됨",
      detail: "이 PC의 보안 저장소에서 연결 상태를 확인했습니다. 자동화 점검에 사용할 수 있습니다.",
      actionLabel: "확인",
      fallbackRoutes: buildConnectorFallbackRoutes(record, "ready"),
      fallbackConnectorIds: buildFallbackConnectorIds(record),
      safeNextActions: buildSafeNextActions(record, "ready"),
    };
  }

  if (isPermissionConnectorStatus(record.status)) {
    return {
      kind: "permission_required",
      label: "권한 필요",
      detail: "OAuth 동의, 관리자 승인, 캘린더 쓰기 권한 같은 추가 권한 확인이 필요합니다.",
      actionLabel: "권한 확인",
      fallbackRoutes: buildConnectorFallbackRoutes(record, "permission_required"),
      fallbackConnectorIds: buildFallbackConnectorIds(record),
      safeNextActions: buildSafeNextActions(record, "permission_required"),
    };
  }

  if (isCredentialConnectorStatus(record.status)) {
    return {
      kind: "credential_failed",
      label: "인증 실패",
      detail: "토큰 만료, 앱 비밀번호 오류, OS 보안 저장소 해제 실패 가능성이 있습니다.",
      actionLabel: "인증 복구",
      fallbackRoutes: buildConnectorFallbackRoutes(record, "credential_failed"),
      fallbackConnectorIds: buildFallbackConnectorIds(record),
      safeNextActions: buildSafeNextActions(record, "credential_failed"),
    };
  }

  return {
    kind: "connection_required",
    label: "연결 필요",
    detail: record.userMessage || "연결 가이드에서 계정과 권한을 다시 확인하세요.",
    actionLabel: "연결 확인",
    fallbackRoutes: buildConnectorFallbackRoutes(record, "connection_required"),
    fallbackConnectorIds: buildFallbackConnectorIds(record),
    safeNextActions: buildSafeNextActions(record, "connection_required"),
  };
}

function classifyOAuthRecoveryIssue(record, permissions = {}, options = {}) {
  if (!isOAuthConnectorRecord(record)) return null;
  const status = sanitizeText(record.status).toLowerCase();
  const message = `${sanitizeText(record.userMessage)} ${sanitizeText(record.errorMessage)}`.toLowerCase();
  const text = `${status} ${message}`;

  if (isOAuthAccessTokenExpired(record, options) || /expired|revoked|invalid_grant|refresh token/u.test(text)) {
    return "oauth_token_expired";
  }

  if (/redirect_uri_mismatch|redirect uri|reply url|invalid_client|client id|oauth_config_missing|token_refresh_config_missing/u.test(text)) {
    return "oauth_app_registration_required";
  }

  if (/admin|tenant|aadsts65001|aadsts65004|aadsts700016|admin_consent|administrator/u.test(text)) {
    return "oauth_admin_consent_required";
  }

  if (/insufficient|missing scope|scope|permission|forbidden|unauthorized|consent|denied/u.test(text)) {
    return (record.category === "calendar" && !permissions.calendarWrite) ||
      (record.category === "mail" && record.method !== "imap_smtp" && !permissions.mailSend)
      ? "oauth_write_scope_required"
      : "oauth_read_scope_required";
  }

  if (record.category === "calendar" && isReadyConnectorStatus(record.status) && !permissions.calendarWrite) {
    return "oauth_write_scope_required";
  }

  if (record.category === "mail" && record.method !== "imap_smtp" && isReadyConnectorStatus(record.status) && !permissions.mailSend) {
    return "oauth_write_scope_required";
  }

  return null;
}

function isOAuthConnectorRecord(record) {
  const method = sanitizeText(record.method).toLowerCase();
  const providerId = sanitizeText(record.providerId).toLowerCase();
  return method.includes("oauth") || /gmail|google_calendar|outlook|microsoft/u.test(providerId);
}

function buildOAuthRecoveryHint(record, issue) {
  const templates = {
    oauth_token_expired: {
      label: "토큰 만료",
      detail: record.refreshTokenCiphertext
        ? "OAuth access token이 만료되었습니다. 보안 저장소 안에서 refresh를 먼저 시도하고 실패하면 같은 provider만 다시 연결합니다."
        : "OAuth access token이 만료되었고 refresh token이 없습니다. 이 연결 하나만 다시 승인해 주세요.",
      actionLabel: "OAuth 재연결",
    },
    oauth_read_scope_required: {
      label: "읽기 권한 부족",
      detail: "메일/캘린더 내용을 읽는 scope가 부족합니다. 발송이나 일정 등록 권한이 아니라 읽기 권한만 다시 허용합니다.",
      actionLabel: "읽기 권한 다시 허용",
    },
    oauth_write_scope_required: {
      label: record.category === "mail" ? "발송 권한 없음" : "쓰기 권한 없음",
      detail: record.category === "mail"
        ? "메일 읽기는 가능하지만 최종 발송 scope가 없습니다. 승인 카드에서 최종 확인한 뒤에만 Gmail send 또는 Microsoft Mail.Send 권한을 연결합니다."
        : "읽기는 가능하지만 일정 등록 같은 최종 실행 scope가 없습니다. 승인 카드에서 최종 확인한 뒤에만 쓰기 권한을 연결합니다.",
      actionLabel: record.category === "mail" ? "발송 권한 연결" : "쓰기 권한 연결",
    },
    oauth_admin_consent_required: {
      label: "관리자 승인 필요",
      detail: "조직 테넌트 정책 때문에 사용자가 단독으로 동의할 수 없습니다. Microsoft/Google 관리자 승인 상태만 확인하면 됩니다.",
      actionLabel: "관리자 승인 확인",
    },
    oauth_app_registration_required: {
      label: "OAuth 앱 등록값 오류",
      detail: "client id, redirect URI, callback URL, token endpoint 중 하나가 등록값과 맞지 않습니다. 계정 비밀번호를 다시 묻지 않고 앱 등록값만 확인합니다.",
      actionLabel: "앱 등록값 확인",
    },
  };
  const template = templates[issue] ?? templates.oauth_read_scope_required;
  return {
    kind: issue,
    ...template,
    fallbackRoutes: buildConnectorFallbackRoutes(record, issue),
    fallbackConnectorIds: buildFallbackConnectorIds(record),
    safeNextActions: buildSafeNextActions(record, issue),
  };
}

function buildConnectorFallbackRoutes(record, reason = "connection_required") {
  const routes = [];
  if (record.method !== "site_login") {
    routes.push("공식 API/OAuth/IMAP 연결을 먼저 다시 확인합니다.");
  }
  if (record.category === "messenger") {
    routes.push("Bot/OAuth가 막히면 앱 메인 컨트롤 채널에서 승인·수정 요청을 유지합니다.");
  }
  if (record.category === "mail") {
    routes.push("IMAP이 실패하면 웹 로그인 URL을 보관함에 저장하고 메일 전달/수동 확인 카드로 시작합니다.");
  }
  if (record.category === "calendar") {
    routes.push("쓰기 권한이 없으면 일정 후보만 만들고 등록은 앱 최종 확인에서 멈춥니다.");
  }
  if (record.method === "site_login" || record.category === "business_system" || record.category === "booking") {
    routes.push("사이트 링크, 계정 참조, 앱 위치 후보를 보관함에 두고 Computer Use 승인 뒤 읽기부터 진행합니다.");
  }
  if (reason === "oauth_app_registration_required") {
    routes.push("OAuth 앱 등록 화면에서 callback URL, client id, token endpoint만 다시 맞춥니다.");
  }
  if (reason === "oauth_admin_consent_required") {
    routes.push("조직 관리자 승인 전에는 메일 발송, 일정 등록, 외부 변경 자동화를 잠급니다.");
  }
  if (reason === "oauth_read_scope_required") {
    routes.push("읽기 scope만 다시 허용하고 쓰기 scope는 최종 승인 카드 전까지 요청하지 않습니다.");
  }
  if (reason === "oauth_write_scope_required") {
    routes.push("읽기 연결은 유지하고 일정 등록 scope만 별도 승인 단계로 분리합니다.");
  }
  if (reason === "credential_failed" || reason === "oauth_token_expired") {
    routes.push("저장된 계정 정보가 틀릴 수 있으니 보관함에서 다시 저장합니다.");
  }
  routes.push("외부 발송, 일정 등록, 파일 변경은 어떤 대체 루트에서도 사용자 최종 승인 전 실행하지 않습니다.");
  return [...new Set(routes)].slice(0, 5);
}

function buildFallbackConnectorIds(record) {
  const ids = [];
  if (record.category === "mail") ids.push("company-mail", "gmail", "outlook");
  if (record.category === "calendar") ids.push("google-calendar", "outlook-calendar");
  if (record.category === "messenger") ids.push(record.connectorId || "telegram-bot", "app-main-control");
  if (record.method === "site_login" || record.category === "business_system" || record.category === "booking") {
    ids.push(record.connectorId || "external-site-account", "desktop-bridge");
  }
  ids.push("external-account-vault", "computer-use");
  return [...new Set(ids)].slice(0, 8);
}

function buildSafeNextActions(record, reason = "connection_required") {
  const actions = [];
  if (reason === "credential_failed") actions.push("계정 보관함에서 아이디, 앱 비밀번호, token을 다시 저장");
  if (reason === "oauth_token_expired") actions.push("같은 provider OAuth만 다시 연결하고 다른 설정 화면은 열지 않음");
  if (reason === "oauth_read_scope_required") actions.push("메일/캘린더 읽기 scope 동의만 다시 진행");
  if (reason === "oauth_write_scope_required") actions.push("승인 카드 최종 확인 뒤 쓰기 scope만 별도 연결");
  if (reason === "oauth_admin_consent_required") actions.push("조직 관리자 승인 상태만 확인");
  if (reason === "oauth_app_registration_required") actions.push("client id, redirect URI, callback URL 등록값만 확인");
  if (reason === "permission_required") actions.push("관리자 승인 또는 쓰기 권한이 필요한지 확인");
  if (record.method === "site_login") actions.push("앱 위치나 사이트 링크를 확인한 뒤 Computer Use 읽기 모드로 테스트");
  if (record.category === "messenger") actions.push("승인 알림 대상 chat_id/channel id를 추가 저장");
  actions.push("수동 확인 카드로 업무 오피스에 남기고 자동 실행은 잠금");
  return [...new Set(actions)].slice(0, 5);
}

function isReadyConnectorStatus(status) {
  const text = sanitizeText(status).toLowerCase();
  if (/missing|unavailable|failed|invalid|required|not_connected|blocked|denied|expired/u.test(text)) {
    return false;
  }
  return /connected|ready|loaded|stored|token_exchanged|context_ready|imap_connected|mail_loaded|freebusy_loaded|verified/u.test(text);
}

function isPermissionConnectorStatus(status) {
  return /permission|scope|consent|oauth_config_missing|unauthorized|forbidden|denied|admin_required|write_required/u.test(
    sanitizeText(status).toLowerCase(),
  );
}

function isCredentialConnectorStatus(status) {
  return /credential|token|secret|password|failed|invalid|expired|revoked|blocked|auth_error|token_error|secret_error|password_error/u.test(
    sanitizeText(status).toLowerCase(),
  );
}

function normalizeImapConnectionInput(connectorId, input = {}) {
  const user = String(input.imapUser ?? input.username ?? "").trim();
  const emailAddress = sanitizeEmailAddress(input.emailAddress ?? input.email ?? user);
  const inferredServer = inferImapServerFromAddress(emailAddress || user, connectorId);
  const rawHost = String(input.imapHost ?? input.host ?? inferredServer?.host ?? "").trim();
  const host = normalizeStrictImapHost(rawHost);
  const port = Number(input.imapPort ?? input.port ?? inferredServer?.port ?? 993);
  const secret = String(input.secret ?? input.password ?? "").trim();
  const siteUrl = sanitizeWebmailReferenceUrl(
    input.siteUrl ?? input.webmailUrl ?? input.loginUrl ?? input.url,
  );
  const base = {
    connectorId,
    method: "imap_smtp",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  if (!host.ok) {
    return {
      ...base,
      status: host.status,
      userMessage: host.userMessage,
      errorMessage: host.errorMessage,
      auditMessages: ["IMAP 입력값 검증에서 차단되어 외부 메일 서버에 접속하지 않았습니다."],
    };
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return {
      ...base,
      status: "imap_port_invalid",
      userMessage: "IMAP 포트가 올바르지 않습니다. SSL IMAP은 보통 993을 사용합니다.",
      errorMessage: `Invalid IMAP port: ${sanitizeText(input.imapPort ?? input.port ?? "")}`,
      auditMessages: ["IMAP port validation failed before network connection"],
    };
  }

  if (!user || !secret) {
    return {
      ...base,
      status: "imap_credentials_required",
      userMessage: "메일 아이디와 앱 비밀번호가 필요합니다. 일반 웹 로그인 비밀번호가 아니라 IMAP/앱 비밀번호를 입력하세요.",
      auditMessages: ["IMAP credential fields are missing; secret value is not returned"],
    };
  }

  return {
    status: "imap_input_ready",
    input: {
      ...input,
      imapHost: host.value,
      imapPort: port,
      imapSecure: input.imapSecure ?? port !== 143,
      imapStartTls: input.imapStartTls ?? port === 143,
      imapUser: user,
      secret,
      ...(emailAddress ? { emailAddress } : {}),
      ...(siteUrl ? { siteUrl } : {}),
    },
  };
}

function inferImapServerFromAddress(value, connectorId = "company-mail") {
  const email = sanitizeEmailAddress(value);
  const domain = email.includes("@") ? email.split("@").pop() : "";
  if (!domain) return null;

  const knownProviders = {
    "gmail.com": { host: "imap.gmail.com", port: 993 },
    "googlemail.com": { host: "imap.gmail.com", port: 993 },
    "naver.com": { host: "imap.naver.com", port: 993 },
    "daum.net": { host: "imap.daum.net", port: 993 },
    "hanmail.net": { host: "imap.daum.net", port: 993 },
    "kakao.com": { host: "imap.kakao.com", port: 993 },
    "outlook.com": { host: "outlook.office365.com", port: 993 },
    "hotmail.com": { host: "outlook.office365.com", port: 993 },
    "live.com": { host: "outlook.office365.com", port: 993 },
  };
  if (knownProviders[domain]) return knownProviders[domain];
  if (connectorId === "naver-mail") return knownProviders["naver.com"];
  if (connectorId === "daum-kakao-mail") return knownProviders["daum.net"];

  return {
    host: `imap.${domain}`,
    port: 993,
  };
}

function withImapRecoveryHint(connectorId, result = {}, label = "IMAP 연결 확인") {
  const status = sanitizeText(result.status || "imap_connect_failed");
  const detail = buildImapFailureDetail(result);
  const record = createSyntheticConnectorRecord(
    connectorId || "company-mail",
    "imap_smtp",
    status,
    detail,
  );
  return {
    ...result,
    connectorId,
    method: "imap_smtp",
    userMessage: detail,
    recovery: {
      ...createConnectorRecoveryHint(record, { calendarWrite: false, messengerReport: false }, {}),
      label: "메일 연결 복구가 필요합니다",
      detail,
      actionLabel: "IMAP 다시 확인",
      fallbackRoutes: [
        "먼저 IMAP 서버명, 포트 993, 메일 아이디 형식, 앱 비밀번호를 다시 확인합니다.",
        "회사/학교 포털 로그인 URL만 알고 있다면 계정 보관함에 URL, 아이디, 앱 위치를 저장해 Computer Use 읽기 후보로 넘깁니다.",
        "외부 IMAP이 조직 정책으로 막힌 경우 관리자 허용, VPN/사내망 필요 여부, 전달 메일 주소를 확인합니다.",
        "메일 원문 발송과 일정 등록은 연결 성공 후에도 오피스 승인 카드에서 최종 확인 전 실행하지 않습니다.",
      ],
      safeNextActions: [
        "웹메일 URL은 IMAP 서버가 아니므로 보관함 대체 루트로 저장",
        "앱 비밀번호 또는 별도 IMAP 암호 재발급",
        "업무 오피스에 수동 확인 카드로 남기고 자동 실행 잠금",
      ],
    },
    auditMessages: [
      ...(Array.isArray(result.auditMessages) ? result.auditMessages : []),
      `${label}: 실패 결과를 IMAP 복구 handoff로 변환했습니다.`,
      "비밀번호 원문은 결과에 포함하지 않고 보관함/OS 보안 저장소 루트만 안내합니다.",
    ],
  };
}

function buildImapFailureDetail(result = {}) {
  const base = sanitizeText(result.userMessage || "IMAP 메일함 연결에 실패했습니다.");
  const diagnostic = sanitizeText(result.errorMessage || "");
  if (/authentication|auth|login|password|credential|invalid/i.test(diagnostic)) {
    return `${base} 앱 비밀번호 또는 IMAP 전용 암호가 맞는지 다시 확인하세요. 일반 웹 로그인 비밀번호가 막힌 계정일 수 있습니다.`;
  }
  if (/timeout|timed out|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|network|dns/i.test(diagnostic)) {
    return `${base} 서버 주소, 포트 993, 회사/학교 외부 접속 허용 여부, VPN/사내망 필요 여부를 확인하세요.`;
  }
  if (/certificate|tls|ssl|self-signed/i.test(diagnostic)) {
    return `${base} 회사 메일 서버의 SSL/TLS 인증서 정책을 확인해야 합니다. 관리자 안내문에 있는 IMAP 서버명을 그대로 사용하세요.`;
  }
  return `${base} 서버, 포트, 아이디 형식, 앱 비밀번호를 확인하고, 모르면 웹메일 URL을 계정 보관함에 저장해 대체 루트로 진행하세요.`;
}

function normalizeStrictImapHost(value) {
  const host = String(value ?? "").trim().toLowerCase();
  if (!host) {
    return {
      ok: false,
      status: "imap_host_required",
      userMessage: "IMAP 서버 주소가 필요합니다. 회사/학교 웹메일 로그인 주소가 아니라 IMAP 서버명을 입력하세요.",
    };
  }

  if (/^https?:\/\//u.test(host) || /[/?#]/u.test(host)) {
    return {
      ok: false,
      status: "imap_host_is_web_login_url",
      userMessage:
        "입력한 값은 웹 로그인 URL입니다. IMAP 연결에는 `imap.example.com` 같은 서버명만 필요합니다. 회사/학교 메일은 관리자에게 IMAP 서버, 포트, 앱 비밀번호 사용 가능 여부를 확인하세요.",
      errorMessage: "IMAP host contained URL protocol or path",
    };
  }

  if (!/^[a-z0-9.-]{3,253}$/u.test(host) || host.includes("..") || host.startsWith(".") || host.endsWith(".") || !host.includes(".")) {
    return {
      ok: false,
      status: "imap_host_invalid",
      userMessage: "IMAP 서버 주소 형식이 올바르지 않습니다. 예: imap.naver.com, imap.gmail.com, imap.company.com",
      errorMessage: `Invalid IMAP host format: ${sanitizeText(value)}`,
    };
  }

  return { ok: true, value: host };
}

async function testImapConnection(connectorId, input, options = {}) {
  const writingProfile = await createMailIntakeWritingProfile(options, connectorId);
  const domain = await loadDomainRuntime();
  const connector = new domain.ModyMailImapLiveConnector(
    options.imapClientFactory ? { imapClientFactory: options.imapClientFactory } : {},
  );
  const result = await connector.readLatestMessages({
    providerId: connectorId || "imap_smtp",
    host: input.imapHost,
    port: input.imapPort,
    secure: input.imapSecure !== false,
    startTls: input.imapStartTls === true,
    username: input.imapUser,
    password: input.secret,
    mailbox: "INBOX",
    limit: input.limit ?? 3,
  });
  if (result.status !== "imap_connected") {
    return {
      ...result,
      connectorId,
      method: "imap_smtp",
    };
  }

  const createdAt = options.now ? options.now().toISOString() : new Date().toISOString();
  const normalizedConnectorId = connectorId || "imap_smtp";
  const providerRead = domain.createProviderMailReadFromImapResult({
    imapRead: result,
    connectorId: normalizedConnectorId,
    credentialReferenceId: `${normalizedConnectorId}:os-vault`,
    createdAt,
  });
  const planner = new domain.ModyProviderWorkIntakePlanner({
    ...(options.now ? { now: options.now } : {}),
  });
  const workReport = planner.createReport({
    reads: [providerRead],
    writingProfile,
    reportChannelId: "desktop",
    appDeepLinkBase: "modycrew://mail-intake",
  });
  const workAnalysis = domain.analyzeMailWorkPattern({ providerRead, workReport });

  return {
    ...result,
    connectorId,
    method: "imap_smtp",
    workAnalysis,
    userMessage: `${result.userMessage} ${workAnalysis.summary} 제안: ${workAnalysis.improvementSuggestions[0]}`,
    auditMessages: [
      ...(result.auditMessages ?? []),
      "IMAP 연결 직후 최신 메일 envelope를 업무 패턴 분석으로 변환했습니다.",
      "메일 업무 분석은 집계 신호만 반환하고 메일 원문/주소/비밀번호를 노출하지 않습니다.",
    ],
  };
}

async function verifyTelegramBot(input, options = {}) {
  const domain = await loadDomainRuntime();
  const connector = new domain.ModyTelegramBotLiveConnector(
    options.fetch ? { fetch: options.fetch } : {},
  );
  const verified = await connector.verifyBot({
    botToken: input.secret,
  });

  if (verified.status !== "token_verified") {
    return {
      ...verified,
      connectorId: "telegram-bot",
      method: "bot_token",
    };
  }

  return {
    ...verified,
    status: "telegram_command_inbox_ready",
    connectorId: "telegram-bot",
    method: "bot_token",
    userMessage: sanitizeTelegramChatId(input.channelTargetId ?? input.chatId ?? input.siteUserId)
      ? "Telegram Bot token을 확인했고 명령 수신과 승인 알림 전송 대상까지 저장했습니다."
      : "Telegram Bot token을 확인했고 명령 수신 준비 상태로 저장했습니다. 승인 알림을 받으려면 chat_id도 저장해 주세요.",
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function verifySlackBot(input, options = {}) {
  const token = String(input.secret ?? "").trim();
  if (!token || token.length < 8) {
    return {
      status: "slack_token_required",
      connectorId: "slack-app",
      method: "bot_token",
      userMessage: "Slack Bot User OAuth Token이 필요합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      status: "slack_live_check_unavailable",
      connectorId: "slack-app",
      method: "bot_token",
      userMessage: "이 환경에서 Slack token 확인용 fetch runtime을 찾지 못했습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  try {
    const response = await fetchImpl("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok !== true) {
      return {
        status: "slack_token_verification_failed",
        connectorId: "slack-app",
        method: "bot_token",
        userMessage: `Slack token 확인에 실패했습니다${json?.error ? `: ${sanitizeText(json.error)}` : "."}`,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }
    const channelTargetId = sanitizeChannelTargetId(input.channelTargetId ?? input.chatId ?? input.siteUserId);
    return {
      status: "slack_command_inbox_ready",
      connectorId: "slack-app",
      method: "bot_token",
      teamName: sanitizeText(json.team ?? json.team_id ?? "Slack workspace"),
      bot: {
        username: sanitizeText(json.user ?? json.user_id ?? "slack-bot"),
      },
      userMessage: channelTargetId
        ? "Slack Bot token을 확인했고 승인/보고 대상 채널까지 저장했습니다."
        : "Slack Bot token을 확인했습니다. 승인 알림을 받으려면 channel id도 저장해 주세요.",
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  } catch (error) {
    return {
      status: "slack_token_verification_failed",
      connectorId: "slack-app",
      method: "bot_token",
      userMessage: "Slack token 확인 중 오류가 발생했습니다.",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
}

async function verifyDiscordBot(input, options = {}) {
  const token = String(input.secret ?? "").trim();
  if (!token || token.length < 8) {
    return {
      status: "discord_token_required",
      connectorId: "discord-app",
      method: "bot_token",
      userMessage: "Discord Bot token이 필요합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      status: "discord_live_check_unavailable",
      connectorId: "discord-app",
      method: "bot_token",
      userMessage: "이 환경에서 Discord bot 확인용 fetch runtime을 찾지 못했습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  try {
    const response = await fetchImpl("https://discord.com/api/v10/users/@me", {
      headers: {
        authorization: `Bot ${token}`,
      },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.id || json.bot !== true) {
      return {
        status: "discord_token_verification_failed",
        connectorId: "discord-app",
        method: "bot_token",
        userMessage: `Discord Bot token 확인에 실패했습니다${json?.message ? `: ${sanitizeText(json.message)}` : "."}`,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }
    const channelTargetId = sanitizeChannelTargetId(input.channelTargetId ?? input.chatId ?? input.siteUserId);
    return {
      status: "discord_command_inbox_ready",
      connectorId: "discord-app",
      method: "bot_token",
      bot: {
        username: sanitizeText(json.username ?? "discord-bot"),
        id: sanitizeText(json.id),
      },
      userMessage: channelTargetId
        ? "Discord Bot token을 확인했고 승인/보고 대상 채널까지 저장했습니다."
        : "Discord Bot token을 확인했습니다. 승인 알림을 받으려면 channel id도 저장해 주세요.",
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  } catch (error) {
    return {
      status: "discord_token_verification_failed",
      connectorId: "discord-app",
      method: "bot_token",
      userMessage: "Discord Bot token 확인 중 오류가 발생했습니다.",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
}

async function verifyGeminiApiKey(input) {
  const domain = await loadDomainRuntime();
  const connector = new domain.ModyGeminiLiveConnector();
  const result = await connector.generateContent({
    apiKey: input.secret,
    model: "gemini-2.5-flash",
    prompt: "ModyCrew 연결 테스트입니다. 한 문장으로 응답해 주세요.",
  });

  return {
    ...result,
    connectorId: "google-gemini",
    method: "api_key",
  };
}

/**
 * OAuth 메일 계정의 소유 주소를 확인한다. 같은 제공사에 계정을 여러 개
 * 연결할 때 서로를 구분하는 안정적인 키가 되어 준다.
 * 조회에 실패해도 연결을 막지 않는다(빈 문자열 반환).
 */
async function fetchOAuthMailAccountAddress(providerId, accessToken, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function" || !accessToken) return "";
  const url =
    providerId === "outlook"
      ? "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName"
      : "https://gmail.googleapis.com/gmail/v1/users/me/profile";
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response?.ok) return "";
    const json = await response.json();
    const candidate =
      providerId === "outlook" ? json?.mail || json?.userPrincipalName : json?.emailAddress;
    return sanitizeEmailAddress(candidate);
  } catch {
    // 주소 조회 실패는 연결 실패가 아니다. 계정 구분만 나중으로 미룬다.
    return "";
  }
}

async function verifyGmailAccessToken(input, options = {}) {
  const domain = await loadDomainRuntime();
  const connector = new domain.ModyGmailMailLiveConnector({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const result = await connector.listLatestMessages({
    accessToken: input.secret,
    mailboxId: input.mailboxId,
    query: input.query,
    limit: input.limit ?? 5,
  });

  const accountEmail = await fetchOAuthMailAccountAddress("gmail", input.secret, options);

  return {
    ...result,
    connectorId: "gmail",
    method: "gmail_access_token",
    category: "mail",
    ...(accountEmail ? { accountEmail } : {}),
  };
}

async function verifyOutlookMailAccessToken(input, options = {}) {
  const domain = await loadDomainRuntime();
  const connector = new domain.ModyOutlookMailLiveConnector({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const result = await connector.listLatestMessages({
    accessToken: input.secret,
    mailboxId: input.mailboxId,
    limit: input.limit ?? 5,
  });

  const accountEmail = await fetchOAuthMailAccountAddress("outlook", input.secret, options);

  return {
    ...result,
    connectorId: "outlook",
    method: "outlook_mail_access_token",
    category: "mail",
    ...(accountEmail ? { accountEmail } : {}),
  };
}

async function verifyGoogleCalendarAccessToken(input, options = {}) {
  const domain = await loadDomainRuntime();
  const now = options.now ? options.now() : new Date();
  const connector = new domain.ModyGoogleCalendarLiveConnector({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const result = await connector.queryFreeBusy({
    accessToken: input.secret,
    calendarIds: normalizeCalendarIds(input.calendarIds),
    timeMin: sanitizeOptionalIso(input.timeMin) ?? now.toISOString(),
    timeMax: sanitizeOptionalIso(input.timeMax) ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    timeZone: sanitizeTimeZone(input.timeZone),
  });

  return {
    ...result,
    connectorId: "google-calendar",
    method: "google_calendar_access_token",
    category: "calendar",
  };
}

async function verifyOutlookCalendarAccessToken(input, options = {}) {
  const domain = await loadDomainRuntime();
  const now = options.now ? options.now() : new Date();
  const connector = new domain.ModyOutlookCalendarLiveConnector({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const result = await connector.querySchedule({
    accessToken: input.secret,
    scheduleIds: normalizeOutlookScheduleIds(input.scheduleIds),
    timeMin: sanitizeOptionalIso(input.timeMin) ?? now.toISOString(),
    timeMax: sanitizeOptionalIso(input.timeMax) ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    timeZone: sanitizeTimeZone(input.timeZone),
  });

  return {
    ...result,
    connectorId: "outlook-calendar",
    method: "outlook_calendar_access_token",
    category: "calendar",
  };
}

async function createGoogleCalendarEvent(input) {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      status: "calendar_event_adapter_unavailable",
      userMessage: "이 환경에서 Google Calendar 일정 등록용 fetch runtime을 찾지 못했습니다.",
      externalMutation: false,
    };
  }

  const endpoint = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId || "primary")}/events`,
  );
  endpoint.searchParams.set("sendUpdates", "none");
  const body = {
    summary: input.summary,
    description: appendMeetingUrlToDescription(input.description, input.meetingUrl),
    ...(input.location ? { location: input.location } : {}),
    start: { dateTime: input.startsAt, timeZone: input.timeZone },
    end: { dateTime: input.endsAt, timeZone: input.timeZone },
    ...(input.attendees.length > 0
      ? { attendees: input.attendees.map((email) => ({ email })) }
      : {}),
    ...(input.reminderMinutes.length > 0
      ? {
          reminders: {
            useDefault: false,
            overrides: input.reminderMinutes.map((minutes) => ({ method: "popup", minutes })),
          },
        }
      : {}),
  };

  try {
    const response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "calendar_event_create_failed",
        userMessage: "Google Calendar 일정 등록 호출에 실패했습니다.",
        errorMessage: redactOAuthSecret(json.error?.message ?? response.statusText, input.accessToken),
        externalMutation: false,
      };
    }

    return {
      status: "calendar_event_created",
      eventId: sanitizeText(json.id ?? json.htmlLink ?? "").slice(0, 180) || "google-calendar-event",
      auditMessages: ["Google Calendar events.insert 호출 완료"],
      externalMutation: true,
    };
  } catch (error) {
    return {
      status: "calendar_event_create_failed",
      userMessage: "Google Calendar 일정 등록 중 오류가 발생했습니다.",
      errorMessage: redactOAuthSecret(error instanceof Error ? error.message : String(error), input.accessToken),
      externalMutation: false,
    };
  }
}

async function createOutlookCalendarEvent(input) {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      status: "calendar_event_adapter_unavailable",
      userMessage: "이 환경에서 Outlook Calendar 일정 등록용 fetch runtime을 찾지 못했습니다.",
      externalMutation: false,
    };
  }

  const isDefaultCalendar = !input.calendarId || ["primary", "me", "default"].includes(input.calendarId);
  const endpoint = isDefaultCalendar
    ? "https://graph.microsoft.com/v1.0/me/calendar/events"
    : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(input.calendarId)}/events`;
  const body = {
    subject: input.summary,
    body: {
      contentType: "text",
      content: appendMeetingUrlToDescription(input.description, input.meetingUrl),
    },
    ...(input.location
      ? {
          location: {
            displayName: input.location,
          },
        }
      : {}),
    start: {
      dateTime: input.startsAt,
      timeZone: input.timeZone,
    },
    end: {
      dateTime: input.endsAt,
      timeZone: input.timeZone,
    },
    ...(input.attendees.length > 0
      ? {
          attendees: input.attendees.map((email) => ({
            emailAddress: { address: email },
            type: "required",
          })),
        }
      : {}),
    ...(input.reminderMinutes.length > 0
      ? {
          isReminderOn: true,
          reminderMinutesBeforeStart: Math.min(...input.reminderMinutes),
        }
      : {}),
  };

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "calendar_event_create_failed",
        userMessage: "Outlook Calendar 일정 등록 호출에 실패했습니다.",
        errorMessage: redactOAuthSecret(json.error?.message ?? response.statusText, input.accessToken),
        externalMutation: false,
      };
    }

    return {
      status: "calendar_event_created",
      eventId: sanitizeText(json.id ?? json.webLink ?? "").slice(0, 180) || "outlook-calendar-event",
      auditMessages: ["Microsoft Graph calendar event create 호출 완료"],
      externalMutation: true,
    };
  } catch (error) {
    return {
      status: "calendar_event_create_failed",
      userMessage: "Outlook Calendar 일정 등록 중 오류가 발생했습니다.",
      errorMessage: redactOAuthSecret(error instanceof Error ? error.message : String(error), input.accessToken),
      externalMutation: false,
    };
  }
}

async function sendGmailMailMessage(input) {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      status: "mail_send_adapter_unavailable",
      userMessage: "이 환경에서 Gmail 발송용 fetch runtime을 찾지 못했습니다.",
      externalMutation: false,
    };
  }

  const raw = renderGmailRawMessage(input);
  if (!raw) {
    return {
      status: "mail_send_payload_invalid",
      userMessage: "Gmail 발송 메시지를 만들 수 없습니다. 수신자, 제목, 본문을 다시 확인해 주세요.",
      externalMutation: false,
    };
  }

  try {
    const response = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      // threadId 를 함께 보내면 Gmail 이 답장을 원래 대화에 붙입니다.
      body: JSON.stringify({ raw, ...(sanitizeGmailThreadId(input.threadId) ? { threadId: sanitizeGmailThreadId(input.threadId) } : {}) }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "mail_send_failed",
        userMessage: "Gmail API 메일 발송 호출에 실패했습니다.",
        errorMessage: redactOAuthSecret(json.error?.message ?? response.statusText, input.accessToken),
        externalMutation: false,
      };
    }

    return {
      status: "mail_message_sent",
      messageId: sanitizeText(json.id ?? json.threadId ?? "").slice(0, 180) || "gmail-message-sent",
      auditMessages: ["Gmail users.messages.send 호출 완료"],
      externalMutation: true,
    };
  } catch (error) {
    return {
      status: "mail_send_failed",
      userMessage: "Gmail API 메일 발송 중 오류가 발생했습니다.",
      errorMessage: redactOAuthSecret(error instanceof Error ? error.message : String(error), input.accessToken),
      externalMutation: false,
    };
  }
}

function renderOutlookMailRequestBody(input) {
  return JSON.stringify({
    message: {
      subject: input.subject,
      body: {
        contentType: "Text",
        content: input.body,
      },
      toRecipients: [
        {
          emailAddress: {
            address: input.recipient,
          },
        },
      ],
      ...(input.cc?.length ? { ccRecipients: input.cc.map(address=>({ emailAddress:{ address } })) } : {}),
      ...(input.bcc?.length ? { bccRecipients: input.bcc.map(address=>({ emailAddress:{ address } })) } : {}),
      ...(input.attachments?.length ? {
        attachments: input.attachments.map((attachment) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.filename,
          contentType: attachment.contentType,
          contentBytes: attachment.contentBase64,
        })),
      } : {}),
    },
    saveToSentItems: true,
  });
}

async function sendOutlookMailMessage(input) {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      status: "mail_send_adapter_unavailable",
      userMessage: "이 환경에서 Outlook 발송용 fetch runtime을 찾지 못했습니다.",
      externalMutation: false,
    };
  }

  try {
    const response = await fetchImpl("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: input.requestBody,
    });
    const json = response.status === 202 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "mail_send_failed",
        userMessage: "Outlook Graph 메일 발송 호출에 실패했습니다.",
        errorMessage: redactOAuthSecret(json.error?.message ?? response.statusText, input.accessToken),
        externalMutation: false,
      };
    }

    return {
      status: "mail_message_sent",
      messageId: sanitizeText(json.id ?? response.headers?.get?.("request-id") ?? "").slice(0, 180) || "outlook-message-sent",
      auditMessages: ["Microsoft Graph me/sendMail 호출 완료"],
      externalMutation: true,
    };
  } catch (error) {
    return {
      status: "mail_send_failed",
      userMessage: "Outlook Graph 메일 발송 중 오류가 발생했습니다.",
      errorMessage: redactOAuthSecret(error instanceof Error ? error.message : String(error), input.accessToken),
      externalMutation: false,
    };
  }
}

function renderGmailRawMessage(input) {
  const to = sanitizeEmailAddress(input.recipient);
  const from = sanitizeEmailAddress(input.from);
  const subject = sanitizeOutgoingMailSubject(input.subject);
  const body = sanitizeTextBlock(input.body).slice(0, OUTGOING_MAIL_BODY_MAX_CHARS);
  if (!to || !subject || !body) return "";
  const inReplyTo = sanitizeRfcMessageIdHeaderValue(input.inReplyTo);
  const references = (Array.isArray(input.references) ? input.references : [])
    .map(sanitizeRfcMessageIdHeaderValue)
    .filter(Boolean)
    .slice(0, 20);
  const mime = renderMailMimeContent(body, input.attachments);
  const headers = [
    from ? `From: <${from}>` : "",
    `To: <${to}>`,
    mailAddressHeader('Cc', input.cc || []),
    // Gmail extracts Bcc recipients from raw MIME and removes this header when delivering.
    mailAddressHeader('Bcc', input.bcc || []),
    `Subject: ${encodeMailHeader(subject)}`,
    // 답장 스레딩 헤더 — 있으면 상대 메일함/Gmail 스레드에 답장이 붙는다.
    inReplyTo ? `In-Reply-To: <${inReplyTo}>` : "",
    references.length ? `References: ${references.map((reference) => `<${reference}>`).join(" ")}` : "",
    ...mime.headers,
  ].filter(Boolean);
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${mime.body}`, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeMailHeader(value) {
  const text = sanitizeText(value);
  return /^[\x00-\x7f]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/** RFC message-id 헤더 값 정리 — 꺾쇠/공백 제거(CRLF 주입 차단), @ 필수, 길이 제한. */
function sanitizeRfcMessageIdHeaderValue(value) {
  const text = String(value ?? "").trim().replace(/[<>\s]/g, "").slice(0, 160);
  return text.includes("@") && /^[\x21-\x7e]+$/.test(text) ? text : "";
}

async function buildGoogleCalendarWorkflowContext(record, options = {}, input = {}) {
  const token = await resolveOAuthAccessToken(record, options, "Google Calendar access token");
  if (token.status !== "credential_ready") {
    return {
      status: token.status,
      connectorId: record.connectorId,
      providerId: "google_calendar",
      providerRead: null,
      auditMessages: token.auditMessages ?? [`Google Calendar credential unavailable: ${token.status}`],
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const now = options.now ? options.now() : new Date();
  const domain = await loadDomainRuntime();
  const connector = new domain.ModyGoogleCalendarLiveConnector({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const result = await connector.queryFreeBusy({
    accessToken: token.value,
    calendarIds: normalizeCalendarIds(record.calendarIds),
    timeMin: sanitizeOptionalIso(input.timeMin) ?? now.toISOString(),
    timeMax:
      sanitizeOptionalIso(input.timeMax) ??
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    timeZone: sanitizeTimeZone(input.timeZone ?? record.timeZone),
  });

  if (result.status !== "freebusy_loaded") {
    return {
      status: result.status,
      connectorId: record.connectorId,
      providerId: "google_calendar",
      providerRead: null,
      auditMessages: (result.auditMessages ?? []).map(sanitizeText),
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const providerRead = {
    status: "read_completed",
    action: "list_calendar_events",
    connectorId: record.connectorId,
    providerId: "google_calendar",
    externalMutation: false,
    rawSecretMaterialStored: false,
    credentialReferenceId: sanitizeCredentialReferenceId(record.credentialReferenceId) || `${record.connectorId}:os-vault`,
    events: (result.busyWindows ?? []).map((window, index) => ({
      eventId: `freebusy-${safeId(window.calendarId)}-${index}`,
      calendarId: sanitizeText(window.calendarId) || "primary",
      providerId: "google_calendar",
      title: "바쁨",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      sourceMetadata: {
        connectorName: "Google Calendar freeBusy",
        sourceUri: `google-calendar:freebusy:${safeId(window.calendarId)}`,
      },
    })),
    sourceMetadata: {
      connectorName: "Google Calendar freeBusy",
      sourceUri: "google-calendar:freebusy",
    },
    auditMessage: `Google Calendar freeBusy에서 바쁜 시간 ${result.busyWindows?.length ?? 0}개를 읽기 전용으로 확인했습니다.`,
  };

  return {
    status: "calendar_context_ready",
    connectorId: record.connectorId,
    providerId: "google_calendar",
    providerRead,
    auditMessages: [...(token.auditMessages ?? []), ...(result.auditMessages ?? []), providerRead.auditMessage].map(sanitizeText),
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function buildOAuthMailWorkflowContext(record, options = {}, input = {}) {
  const token = await resolveOAuthAccessToken(record, options, `${record.providerId} access token`);
  if (token.status !== "credential_ready") {
    return {
      status: token.status,
      connectorId: record.connectorId,
      providerId: record.providerId,
      providerRead: null,
      auditMessages: token.auditMessages ?? [`OAuth mail credential unavailable: ${token.status}`],
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const result =
    record.providerId === "outlook"
      ? await verifyOutlookMailAccessToken(
          {
            secret: token.value,
            mailboxId: input.mailbox ?? record.mailboxId,
            limit: input.limit,
          },
          options,
        )
      : await verifyGmailAccessToken(
          {
            secret: token.value,
            mailboxId: input.mailbox ?? record.mailboxId,
            query: record.query,
            limit: input.limit,
          },
          options,
        );

  if (result.status !== "mail_loaded") {
    return {
      status: result.status,
      connectorId: record.connectorId,
      providerId: record.providerId,
      providerRead: null,
      mailRead: result,
      userMessage: result.userMessage,
      auditMessages: [...(token.auditMessages ?? []), ...(result.auditMessages ?? [])].map(sanitizeText),
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const providerRead = {
    status: "read_completed",
    action: "list_mail_messages",
    connectorId: record.connectorId,
    providerId: record.providerId,
    externalMutation: false,
    rawSecretMaterialStored: false,
    credentialReferenceId: sanitizeCredentialReferenceId(record.credentialReferenceId) || `${record.connectorId}:os-vault`,
    messages: result.messages ?? [],
    sourceMetadata: {
      connectorName: record.providerId === "outlook" ? "Microsoft Graph Mail" : "Gmail API",
      mailboxId: record.mailboxId ?? "INBOX",
      sourceUri: `${record.providerId}:mail:${record.connectorId}`,
    },
    auditMessage: `${record.providerId === "outlook" ? "Outlook Mail" : "Gmail"}에서 메일 ${result.messageCount ?? 0}건을 읽기 전용으로 확인했습니다.`,
  };

  return {
    status: "mail_context_ready",
    connectorId: record.connectorId,
    providerId: record.providerId,
    providerRead,
    mailRead: result,
    userMessage: result.userMessage,
    auditMessages: [...(token.auditMessages ?? []), ...(result.auditMessages ?? []), providerRead.auditMessage].map(sanitizeText),
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function buildOutlookCalendarWorkflowContext(record, options = {}, input = {}) {
  const token = await resolveOAuthAccessToken(record, options, "Outlook Calendar access token");
  if (token.status !== "credential_ready") {
    return {
      status: token.status,
      connectorId: record.connectorId,
      providerId: "outlook_calendar",
      providerRead: null,
      auditMessages: token.auditMessages ?? [`Outlook Calendar credential unavailable: ${token.status}`],
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const now = options.now ? options.now() : new Date();
  const domain = await loadDomainRuntime();
  const connector = new domain.ModyOutlookCalendarLiveConnector({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const result = await connector.querySchedule({
    accessToken: token.value,
    scheduleIds: normalizeOutlookScheduleIds(record.scheduleIds),
    timeMin: sanitizeOptionalIso(input.timeMin) ?? now.toISOString(),
    timeMax:
      sanitizeOptionalIso(input.timeMax) ??
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    timeZone: sanitizeTimeZone(input.timeZone ?? record.timeZone),
  });

  if (result.status !== "freebusy_loaded") {
    return {
      status: result.status,
      connectorId: record.connectorId,
      providerId: "outlook_calendar",
      providerRead: null,
      auditMessages: [...(token.auditMessages ?? []), ...(result.auditMessages ?? [])].map(sanitizeText),
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const providerRead = {
    status: "read_completed",
    action: "list_calendar_events",
    connectorId: record.connectorId,
    providerId: "outlook_calendar",
    externalMutation: false,
    rawSecretMaterialStored: false,
    credentialReferenceId: sanitizeCredentialReferenceId(record.credentialReferenceId) || `${record.connectorId}:os-vault`,
    events: (result.busyWindows ?? []).map((window, index) => ( {
      eventId: `graph-freebusy-${safeId(window.scheduleId)}-${index}`,
      calendarId: sanitizeText(window.scheduleId) || "me",
      providerId: "outlook_calendar",
      title: `바쁨(${sanitizeText(window.status) || "busy"})`,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      sourceMetadata: {
        connectorName: "Outlook Calendar getSchedule",
        sourceUri: `outlook-calendar:getschedule:${safeId(window.scheduleId)}`,
      },
    })),
    sourceMetadata: {
      connectorName: "Outlook Calendar getSchedule",
      sourceUri: "outlook-calendar:getschedule",
    },
    auditMessage: `Outlook Calendar getSchedule에서 바쁜 시간 ${result.busyWindows?.length ?? 0}개를 읽기 전용으로 확인했습니다.`,
  };

  return {
    status: "calendar_context_ready",
    connectorId: record.connectorId,
    providerId: "outlook_calendar",
    providerRead,
    auditMessages: [...(token.auditMessages ?? []), ...(result.auditMessages ?? []), providerRead.auditMessage].map(sanitizeText),
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function buildMailWorkflowContext(record, options) {
  const username = decryptVaultValue(record.usernameCiphertext, options.safeStorage, "IMAP username");
  const password = decryptVaultValue(record.secretCiphertext, options.safeStorage, "IMAP password");
  if (username.status !== "credential_ready" || password.status !== "credential_ready") {
    return {
      status: "credential_unavailable",
      connectorId: record.connectorId,
      providerId: "imap_smtp",
      providerRead: null,
      auditMessages: ["IMAP credential unavailable; mail trigger read skipped"],
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const domain = await loadDomainRuntime();
  const connector = new domain.ModyMailImapLiveConnector(
    options.imapClientFactory ? { imapClientFactory: options.imapClientFactory } : {},
  );
  const result = await connector.readLatestMessages({
    providerId: "imap_smtp",
    host: record.imapHost,
    port: record.imapPort,
    secure: record.imapSecure !== false,
    startTls: record.imapStartTls === true,
    username: username.value,
    password: password.value,
    mailbox: "INBOX",
    limit: 10,
  });

  if (result.status !== "imap_connected") {
    return {
      status: result.status,
      connectorId: record.connectorId,
      providerId: "imap_smtp",
      providerRead: null,
      auditMessages: (result.auditMessages ?? []).map(sanitizeText),
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const providerRead = {
    status: "read_completed",
    action: "list_mail_messages",
    connectorId: record.connectorId,
    providerId: "imap_smtp",
    externalMutation: false,
    rawSecretMaterialStored: false,
    credentialReferenceId: sanitizeCredentialReferenceId(record.credentialReferenceId) || `${record.connectorId}:os-vault`,
    // 보이는 from·subject 는 가리고, 답장 받을 주소(Reply-To, 없으면 From)와 실제 제목 원문은
    // 열거되지 않는 속성으로만 붙인다 — 보고서·AI 프롬프트·IPC 응답 어디에도 직렬화되지 않는다.
    // (가린 제목으로 답장하면 거래처가 `Re: 견적 문의 ([redacted-phone])`를 받는다.)
    messages: (result.messages ?? []).map((message) => attachHiddenOriginalSubject(attachHiddenReplyToAddress({
      messageId: `imap-${message.uid}`,
      mailboxId: "INBOX",
      providerId: "imap_smtp",
      subject: sanitizeText(message.subject),
      from: sanitizeText(message.from ?? "IMAP sender"),
      receivedAt: message.receivedAt ?? new Date().toISOString(),
      snippet: message.previewText
        ? sanitizeText(`${message.subject} ${message.previewText}`)
        : sanitizeText(message.subject),
      ...(message.rfcMessageId ? { rfcMessageId: message.rfcMessageId } : {}),
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    }, message.replyToAddress, message.from), message.originalSubject, message.subject)),
    sourceMetadata: {
      connectorName: "IMAP 메일",
      mailboxId: "INBOX",
    },
    auditMessage: "IMAP 메일함에서 envelope와 text 파트 미리보기만 읽기 전용으로 확인했습니다.",
  };

  return {
    status: "mail_context_ready",
    connectorId: record.connectorId,
    providerId: "imap_smtp",
    providerRead,
    auditMessages: [...(result.auditMessages ?? []), providerRead.auditMessage].map(sanitizeText),
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createImapRecord(connectorId, input, result, options) {
  const emailAddress = sanitizeEmailAddress(input.emailAddress ?? input.imapUser);
  const siteUrl = sanitizeWebmailReferenceUrl(
    input.siteUrl ?? input.webmailUrl ?? input.loginUrl ?? input.url,
  );
  return {
    connectorId,
    method: "imap_smtp",
    category: "mail",
    providerId: "imap_smtp",
    status: result.status,
    imapHost: sanitizeHost(input.imapHost),
    imapPort: Number(input.imapPort ?? 993),
    imapSecure: input.imapSecure !== false,
    imapStartTls: input.imapStartTls === true,
    smtpHost: sanitizeHost(input.smtpHost ?? inferSmtpHost(input.imapHost)),
    smtpPort: Number(input.smtpPort ?? inferSmtpPort(input.imapPort)),
    smtpSecure: input.smtpSecure ?? Number(input.smtpPort ?? inferSmtpPort(input.imapPort)) === 465,
    smtpStartTls: input.smtpStartTls ?? Number(input.smtpPort ?? inferSmtpPort(input.imapPort)) === 587,
    discoverySource: sanitizeText(input.discoverySource ?? "manual").slice(0, 80),
    ...(emailAddress ? { emailAddress } : {}),
    ...(siteUrl ? { siteUrl } : {}),
    usernameCiphertext: encryptVaultValue(input.imapUser, options.safeStorage),
    secretCiphertext: encryptVaultValue(input.secret, options.safeStorage),
    secretFingerprint: fingerprintSecret(input.secret),
    lastCheckedAt: new Date().toISOString(),
    userMessage: result.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createTelegramRecord(input, result, options) {
  const chatId = sanitizeTelegramChatId(input.channelTargetId ?? input.chatId ?? input.siteUserId);
  return {
    connectorId: "telegram-bot",
    method: "bot_token",
    category: "messenger",
    providerId: "telegram",
    status: result.status,
    botUsername: sanitizeText(result.bot?.username ?? result.bot?.firstName ?? "telegram-bot"),
    ...(chatId ? { chatId } : {}),
    secretCiphertext: encryptVaultValue(input.secret, options.safeStorage),
    secretFingerprint: fingerprintSecret(input.secret),
    lastCheckedAt: new Date().toISOString(),
    userMessage: result.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createMessengerBotRecord(connectorId, providerId, input, result, options) {
  const channelTargetId = sanitizeChannelTargetId(input.channelTargetId ?? input.chatId ?? input.siteUserId);
  return {
    connectorId,
    method: "bot_token",
    category: "messenger",
    providerId,
    status: result.status,
    botUsername: sanitizeText(result.bot?.username ?? result.bot?.name ?? result.teamName ?? connectorId),
    ...(channelTargetId ? { channelTargetId } : {}),
    secretCiphertext: encryptVaultValue(input.secret, options.safeStorage),
    secretFingerprint: fingerprintSecret(input.secret),
    lastCheckedAt: new Date().toISOString(),
    userMessage: result.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createSiteLoginRecord(connectorId, input, options) {
  const siteUrl = sanitizeSiteUrl(input.siteUrl ?? input.url ?? input.loginUrl);
  const siteUserId = sanitizeSiteUserId(input.siteUserId ?? input.username ?? input.userId);
  const secret = String(input.secret ?? "");
  const siteLabel = sanitizeText(input.siteLabel ?? input.label ?? "").slice(0, 80);
  const appPath = sanitizeLocalAppPath(input.appPath ?? input.appLocation ?? input.localAppPath);
  const safeConnectorId = sanitizeConnectorId(connectorId || siteUrl);

  if (!siteUrl) {
    return {
      status: "site_login_url_required",
      connectorId: safeConnectorId,
      method: "site_login",
      userMessage: "외부 사이트 주소가 필요합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (!siteUserId || secret.trim().length < 4) {
    return {
      status: "site_login_credentials_required",
      connectorId: safeConnectorId,
      method: "site_login",
      userMessage: "외부 사이트 아이디와 비밀번호를 입력해야 합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  if (input.warningAcknowledged !== true) {
    return {
      status: "site_login_warning_required",
      connectorId: safeConnectorId,
      method: "site_login",
      userMessage: "공식 API/OAuth가 없을 때만 제한적으로 사용한다는 확인이 필요합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const hostname = new URL(siteUrl).hostname;
  const displayLabel = siteLabel || hostname;
  const record = {
    connectorId: safeConnectorId,
    method: "site_login",
    category: "business_system",
    providerId: "site_login",
    status: "site_login_stored",
    siteUrl,
    siteHost: hostname,
    siteLabel: displayLabel,
    credentialReferenceId: createCredentialReferenceId(safeConnectorId, "site_login"),
    credentialStorage: "os_keychain",
    aiSecretReadable: false,
    ...(appPath ? { appPath } : {}),
    usernameCiphertext: encryptVaultValue(siteUserId, options.safeStorage),
    secretCiphertext: encryptVaultValue(secret, options.safeStorage),
    secretFingerprint: fingerprintSecret(`${siteUserId}:${secret}`),
    lastCheckedAt: new Date().toISOString(),
    userMessage: `${displayLabel} 외부 계정 정보를 OS 보안 저장소에 저장했습니다. 이 정보는 자동 로그인 준비용 참조이며, 앱 위치${appPath ? `(${appPath})` : ""}와 사이트 링크를 바탕으로 Computer Use 읽기 후보를 만들 수 있습니다. 메일함 읽기는 IMAP/OAuth/전달 주소 같은 실제 메일 연결이 별도로 필요할 수 있습니다.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };

  return {
    status: "site_login_stored",
    connectorId: safeConnectorId,
    method: "site_login",
    userMessage: record.userMessage,
    siteUrl,
    siteHost: hostname,
    siteLabel: displayLabel,
    credentialReferenceId: record.credentialReferenceId,
    credentialStorage: record.credentialStorage,
    aiSecretReadable: false,
    ...(appPath ? { appPath } : {}),
    secretFingerprint: record.secretFingerprint,
    recovery: createConnectorRecoveryHint(record, { calendarWrite: false, messengerReport: false }, options),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    record,
  };
}

function sanitizeLocalAppPath(value) {
  const text = sanitizeText(value).trim();
  if (!text) return "";
  if (text.length > 260) return "";
  if (/[\u0000-\u001f]/u.test(text)) return "";
  return text;
}

async function resolveOAuthAccessToken(record, options, label) {
  const accessToken = decryptVaultValue(record.secretCiphertext, options.safeStorage, label);
  if (accessToken.status !== "credential_ready") {
    return {
      ...accessToken,
      auditMessages: [`${label}을 OS 보안 저장소에서 열 수 없습니다.`],
    };
  }

  if (!isOAuthAccessTokenExpired(record, options)) {
    return {
      ...accessToken,
      auditMessages: [],
    };
  }

  if (!record.refreshTokenCiphertext) {
    return {
      status: "credential_unavailable",
      userMessage: `${label}이 만료되었고 refresh token이 없어 다시 연결해야 합니다.`,
      auditMessages: [`${record.connectorId} access token expired without refresh token`],
    };
  }

  const refreshToken = decryptVaultValue(record.refreshTokenCiphertext, options.safeStorage, `${label} refresh token`);
  if (refreshToken.status !== "credential_ready") {
    return {
      status: "credential_unavailable",
      userMessage: `${label} refresh token을 열 수 없어 다시 연결해야 합니다.`,
      auditMessages: [`${record.connectorId} refresh token unavailable: ${refreshToken.status}`],
    };
  }

  const refreshed = await refreshOAuthAccessToken(record, refreshToken.value, options);
  if (refreshed.status !== "token_refreshed" || !refreshed.accessToken) {
    return {
      status: "credential_unavailable",
      userMessage: refreshed.userMessage ?? `${label} 갱신에 실패했습니다. 다시 연결해 주세요.`,
      auditMessages: [`${record.connectorId} OAuth refresh failed: ${refreshed.status}`],
    };
  }

  const nextRecord = {
    ...record,
    secretCiphertext: encryptVaultValue(refreshed.accessToken, options.safeStorage),
    secretFingerprint: fingerprintSecret(refreshed.accessToken),
    ...(refreshed.refreshToken
      ? { refreshTokenCiphertext: encryptVaultValue(refreshed.refreshToken, options.safeStorage) }
      : {}),
    ...(refreshed.accessTokenExpiresAt ? { accessTokenExpiresAt: refreshed.accessTokenExpiresAt } : {}),
    lastCheckedAt: new Date().toISOString(),
    userMessage: `${record.providerId ?? record.connectorId} OAuth access token을 OS 보안 저장소 안에서 갱신했습니다.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  await upsertConnectorRecord(options, nextRecord);

  return {
    status: "credential_ready",
    value: refreshed.accessToken,
    auditMessages: [`${record.connectorId} OAuth access token refreshed inside main process vault`],
  };
}

async function refreshOAuthAccessToken(record, refreshToken, options = {}) {
  const settings = readStoredOAuthRefreshSettings(record);
  if (!settings.clientId || !settings.tokenEndpoint) {
    return {
      status: "token_refresh_config_missing",
      userMessage: "OAuth refresh에 필요한 client id 또는 token endpoint가 없습니다. 다시 연결해 주세요.",
    };
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      status: "token_refresh_unavailable",
      userMessage: "이 환경에서 OAuth token refresh용 fetch runtime을 찾지 못했습니다.",
    };
  }

  const body = new URLSearchParams();
  body.set("client_id", settings.clientId);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  if (settings.scope && isMicrosoftOAuthRecord(record)) {
    body.set("scope", settings.scope);
  }
  if (isGoogleOAuthTokenEndpoint(settings.tokenEndpoint)) {
    const googleClientSecret = resolveGoogleOAuthClientSecret();
    if (googleClientSecret) {
      body.set("client_secret", googleClientSecret);
    }
  }

  try {
    const response = await fetchImpl(settings.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "token_refresh_failed",
        userMessage: "OAuth access token 갱신에 실패했습니다.",
        errorMessage: sanitizeText(json.error_description ?? json.error ?? response.statusText),
      };
    }

    const accessToken = sanitizeAccessToken(json.access_token);
    if (!accessToken) {
      return {
        status: "token_refresh_missing_access_token",
        userMessage: "OAuth refresh 응답에 access token이 없습니다.",
      };
    }

    return {
      status: "token_refreshed",
      accessToken,
      refreshToken: sanitizeAccessToken(json.refresh_token),
      accessTokenExpiresAt: computeTokenExpiresAt(json.expires_in, options),
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  } catch (error) {
    return {
      status: "token_refresh_failed",
      userMessage: "OAuth access token 갱신 중 오류가 발생했습니다.",
      errorMessage: sanitizeText(error instanceof Error ? error.message : String(error)),
    };
  }
}

function createOAuthMailRecord(connectorId, providerId, input, result, options) {
  // IMAP 레코드(createImapRecord)와 같은 필드명을 쓴다 — 계정 구분 키를
  // 만들 때 제공사별로 분기하지 않기 위해서다.
  const emailAddress = sanitizeEmailAddress(
    input.emailAddress ?? input.email ?? result?.accountEmail ?? "",
  );
  return {
    connectorId,
    ...(emailAddress ? { emailAddress } : {}),
    method: providerId === "outlook" ? "outlook_mail_access_token" : "gmail_access_token",
    category: "mail",
    providerId,
    status: result.status,
    mailboxId: sanitizeText(input.mailboxId ?? (providerId === "outlook" ? "Inbox" : "INBOX")) || (providerId === "outlook" ? "Inbox" : "INBOX"),
    ...(providerId === "gmail" ? { query: sanitizeText(input.query ?? "in:inbox") || "in:inbox" } : {}),
    secretCiphertext: encryptVaultValue(input.secret, options.safeStorage),
    ...(sanitizeAccessToken(input.refreshToken) ? { refreshTokenCiphertext: encryptVaultValue(input.refreshToken, options.safeStorage) } : {}),
    ...(sanitizeOptionalIso(input.accessTokenExpiresAt) ? { accessTokenExpiresAt: sanitizeOptionalIso(input.accessTokenExpiresAt) } : {}),
    ...(sanitizeOAuthClientId(input.clientId) ? { oauthClientId: sanitizeOAuthClientId(input.clientId) } : {}),
    ...(sanitizeStoredTokenEndpoint(input.tokenEndpoint) ? { tokenEndpoint: sanitizeStoredTokenEndpoint(input.tokenEndpoint) } : {}),
    ...(sanitizeStoredOAuthScope(input.scope) ? { scope: sanitizeStoredOAuthScope(input.scope) } : {}),
    credentialReferenceId: sanitizeCredentialReferenceId(input.credentialReferenceId) || `${connectorId}:os-vault`,
    secretFingerprint: fingerprintSecret(input.secret),
    lastCheckedAt: new Date().toISOString(),
    userMessage: result.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createGoogleCalendarRecord(input, result, options) {
  return {
    connectorId: "google-calendar",
    method: "google_calendar_access_token",
    category: "calendar",
    providerId: "google_calendar",
    status: result.status,
    calendarIds: normalizeCalendarIds(input.calendarIds),
    timeZone: sanitizeTimeZone(input.timeZone),
    secretCiphertext: encryptVaultValue(input.secret, options.safeStorage),
    ...(sanitizeAccessToken(input.refreshToken) ? { refreshTokenCiphertext: encryptVaultValue(input.refreshToken, options.safeStorage) } : {}),
    ...(sanitizeOptionalIso(input.accessTokenExpiresAt) ? { accessTokenExpiresAt: sanitizeOptionalIso(input.accessTokenExpiresAt) } : {}),
    ...(sanitizeOAuthClientId(input.clientId) ? { oauthClientId: sanitizeOAuthClientId(input.clientId) } : {}),
    ...(sanitizeStoredTokenEndpoint(input.tokenEndpoint) ? { tokenEndpoint: sanitizeStoredTokenEndpoint(input.tokenEndpoint) } : {}),
    ...(sanitizeStoredOAuthScope(input.scope) ? { scope: sanitizeStoredOAuthScope(input.scope) } : {}),
    credentialReferenceId: sanitizeCredentialReferenceId(input.credentialReferenceId) || "google-calendar:os-vault",
    secretFingerprint: fingerprintSecret(input.secret),
    lastCheckedAt: new Date().toISOString(),
    userMessage: result.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createOutlookCalendarRecord(input, result, options) {
  return {
    connectorId: "outlook-calendar",
    method: "outlook_calendar_access_token",
    category: "calendar",
    providerId: "outlook_calendar",
    status: result.status,
    scheduleIds: normalizeOutlookScheduleIds(input.scheduleIds),
    timeZone: sanitizeTimeZone(input.timeZone),
    secretCiphertext: encryptVaultValue(input.secret, options.safeStorage),
    ...(sanitizeAccessToken(input.refreshToken) ? { refreshTokenCiphertext: encryptVaultValue(input.refreshToken, options.safeStorage) } : {}),
    ...(sanitizeOptionalIso(input.accessTokenExpiresAt) ? { accessTokenExpiresAt: sanitizeOptionalIso(input.accessTokenExpiresAt) } : {}),
    ...(sanitizeOAuthClientId(input.clientId) ? { oauthClientId: sanitizeOAuthClientId(input.clientId) } : {}),
    ...(sanitizeStoredTokenEndpoint(input.tokenEndpoint) ? { tokenEndpoint: sanitizeStoredTokenEndpoint(input.tokenEndpoint) } : {}),
    ...(sanitizeStoredOAuthScope(input.scope) ? { scope: sanitizeStoredOAuthScope(input.scope) } : {}),
    credentialReferenceId: sanitizeCredentialReferenceId(input.credentialReferenceId) || "outlook-calendar:os-vault",
    secretFingerprint: fingerprintSecret(input.secret),
    lastCheckedAt: new Date().toISOString(),
    userMessage: result.userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/**
 * 계정 저장 키를 만든다.
 *
 * connectorId 는 "제품 종류"(gmail / company-mail …)이지 계정이 아니다.
 * 그것만으로 vault 를 키잉하면 개인 지메일을 붙인 뒤 회사 지메일을 붙일 때
 * 앞의 계정이 자격증명째 사라진다. 그래서 주소를 붙여 계정 단위로 나눈다.
 *
 * 주소를 아직 모르는 연결(주소 조회 실패 등)은 예전처럼 connectorId 를 그대로
 * 쓴다 — 기존 저장분과 키가 같아 마이그레이션 없이 이어진다.
 */
function buildConnectorAccountKey(record) {
  const connectorId = sanitizeConnectorId(record?.connectorId) || "connector";
  const email = sanitizeEmailAddress(record?.emailAddress);
  if (!email) return connectorId;
  const suffix = email.toLowerCase().replace(/@/g, "_at_").replace(/[^a-z0-9._-]/g, "-");
  return `${connectorId}__${suffix}`.slice(0, 160);
}

// 연결 보관함 저장은 json-store 의 파일별 대기열·원자적 쓰기·.previous 백업을 쓴다.
// 예전엔 계정 추가와 토큰 갱신이 겹치면 늦게 쓴 쪽이 다른 계정 기록을 통째로 지웠다.
let connectorJsonStoreModulePromise;
const loadConnectorJsonStore = () => (connectorJsonStoreModulePromise ??= import("./json-store.mjs"));

function createEmptyConnectorVault() {
  return {
    version: 1,
    updatedAt: "",
    connectors: {},
  };
}

function parseConnectorVaultShape(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_connector_vault_shape");
  }
  return {
    version: 1,
    updatedAt: sanitizeText(parsed.updatedAt ?? ""),
    connectors: parsed.connectors && typeof parsed.connectors === "object"
      ? parsed.connectors
      : {},
  };
}

/**
 * 최신 보관함을 대기열 안에서 읽고 mutator 로 고친 뒤 저장한다.
 * mutator 안에서 readConnectorVault 는 괜찮지만 이 함수를 다시 부르면 안 된다.
 */
async function mutateConnectorVault(options, mutator, { previousMode = "keep" } = {}) {
  const filePath = connectorVaultPath(options);
  const { mutateJsonStore } = await loadConnectorJsonStore();
  return mutateJsonStore(
    filePath,
    {
      parse: parseConnectorVaultShape,
      empty: createEmptyConnectorVault,
      serialize: (vault) => `${JSON.stringify(sanitizeConnectorVault(vault), null, 2)}\n`,
      // 깨진 보관함은 사본으로 남기고 새로 시작한다. 막아 버리면 다시 연결조차 못 한다.
      onUnreadable: "reset",
      previousMode,
    },
    mutator,
  );
}

async function upsertConnectorRecord(options, record) {
  await mutateConnectorVault(options, (vault) => {
    const accountKey = buildConnectorAccountKey(record);
    const stored = { ...record, accountId: accountKey };
    // 같은 계정을 예전 키(제공사 상수)로 저장해 둔 기록이 있으면 정리해서
    // 목록에 같은 계정이 두 번 뜨지 않게 한다.
    if (accountKey !== record.connectorId) {
      const legacy = vault.connectors[record.connectorId];
      const legacyEmail = sanitizeEmailAddress(legacy?.emailAddress);
      if (legacy && (!legacyEmail || legacyEmail === sanitizeEmailAddress(record.emailAddress))) {
        delete vault.connectors[record.connectorId];
      }
    }
    vault.connectors[accountKey] = stored;
    vault.updatedAt = new Date().toISOString();
  });
}

/**
 * 연결 해제 — vault 에서 이 앱이 들고 있던 자격증명 참조만 지운다.
 * 외부 계정(지메일 등) 자체에는 아무 변경도 하지 않는다.
 */
async function disconnectConnectorRecord(payload = {}, options = {}) {
  const requested = sanitizeText(payload.accountId ?? payload.connectorId ?? "").slice(0, 200);
  if (!requested) {
    return {
      status: "connector_disconnect_target_required",
      userMessage: "어떤 연결을 해제할지 지정해야 합니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  const { JSON_STORE_SKIP_WRITE } = await loadConnectorJsonStore();
  let matched = [];
  let removedAccountIds = [];
  let remainingCount = 0;
  // 해제한 계정의 자격증명 사본이 .previous 에 남지 않게 새 내용으로 백업도 맞춘다.
  await mutateConnectorVault(options, (vault) => {
    const keys = Object.keys(vault.connectors ?? {});
    matched = keys.filter(
      (key) => key === requested || vault.connectors[key]?.accountId === requested,
    );
    if (!matched.length) return JSON_STORE_SKIP_WRITE;
    removedAccountIds = matched.map((key) => vault.connectors[key]?.accountId ?? key);
    for (const key of matched) delete vault.connectors[key];
    vault.updatedAt = new Date().toISOString();
    remainingCount = Object.keys(vault.connectors ?? {}).length;
    return undefined;
  }, { previousMode: "mirror" });
  if (!matched.length) {
    return {
      status: "connector_disconnect_not_found",
      accountId: requested,
      userMessage: "해제할 연결 기록을 찾지 못했습니다. 이미 해제되었을 수 있습니다.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  // 연결을 지우면 그 계정으로 받아둔 메일 목록도 함께 지운다.
  // 남겨두면 연결이 없는 계정의 메일이 통합 목록에 계속 떠 있게 된다.
  try {
    const { removeAccountMailLedger } = await import("./mail-ledger-handler.mjs");
    for (const accountId of removedAccountIds) {
      await removeAccountMailLedger(options, accountId);
    }
  } catch {
    // 원장 정리 실패가 연결 해제 자체를 막지 않는다.
  }
  return {
    status: "connector_disconnected",
    accountId: requested,
    removedCount: matched.length,
    remainingCount,
    userMessage: "이 앱에 저장된 연결 정보를 지웠습니다. 메일 계정 자체는 그대로입니다.",
    auditMessages: [
      "앱이 보관하던 자격증명 참조만 삭제했고 외부 계정에는 어떤 변경도 하지 않았습니다.",
    ],
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function readConnectorVault(options) {
  const filePath = connectorVaultPath(options);
  const { readJsonStore } = await loadConnectorJsonStore();
  const loaded = await readJsonStore(filePath, { parse: parseConnectorVaultShape });
  // 본 파일이 깨졌으면 직전 정상본(.previous)으로 읽는다.
  if (loaded.status === "ok" || loaded.status === "recovered") return loaded.value;
  // Missing vault starts clean. A damaged vault with no usable backup (or a vault that cannot
  // be opened right now) reads as empty so status screens keep working; writers keep a copy of
  // a damaged file and refuse to write over one they could not open.
  // Raw secrets never belong in this JSON file.
  return createEmptyConnectorVault();
}

function sanitizeConnectorVault(vault) {
  const connectors = {};
  for (const [key, record] of Object.entries(vault.connectors ?? {})) {
    connectors[key] = {
      ...record,
      userMessage: sanitizeText(record.userMessage),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
  return {
    version: 1,
    updatedAt: sanitizeText(vault.updatedAt ?? ""),
    connectors,
  };
}

function connectorVaultPath(options) {
  if (!options.app?.getPath) throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  return path.join(options.app.getPath("userData"), connectorVaultFileName);
}

function encryptVaultValue(value, safeStorage) {
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error("OS 보안 저장소를 사용할 수 없어 연결 정보를 저장하지 않았습니다.");
  }
  const encrypted = safeStorage.encryptString(String(value ?? ""));
  return Buffer.from(encrypted).toString("base64");
}

function createCredentialReferenceId(connectorId, purpose) {
  const safeConnectorId = sanitizeConnectorId(connectorId || "connector");
  const safePurpose = sanitizeConnectorId(purpose || "credential");
  return `os-keychain:${safeConnectorId}:${safePurpose}`;
}

function decryptVaultValue(ciphertext, safeStorage, label) {
  try {
    if (!ciphertext || !safeStorage?.isEncryptionAvailable?.()) {
      return {
        status: "credential_unavailable",
        userMessage: `${label}을 OS 보안 저장소에서 열 수 없습니다.`,
      };
    }
    return {
      status: "credential_ready",
      value: safeStorage.decryptString(Buffer.from(String(ciphertext), "base64")),
    };
  } catch {
    return {
      status: "credential_unavailable",
      userMessage: `${label} 복호화에 실패했습니다.`,
    };
  }
}

function renderConnectorContextMarkdown(context) {
  if (context.providerReads.length === 0) return "연결된 읽기 컨텍스트가 아직 없습니다.";
  return context.providerReads
    .map((read) => {
      if (read.action === "list_calendar_events") {
        return `- ${read.connectorId}: ${read.events?.length ?? 0}개 캘린더 busy window 읽기 완료`;
      }
      return `- ${read.connectorId}: ${read.messages?.length ?? 0}개 메일 envelope 읽기 완료`;
    })
    .join("\n");
}

function normalizeOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

function normalizeMailAttachmentUid(value) {
  const direct = normalizeOptionalNumber(value);
  if (direct && direct > 0) return direct;
  const text = String(value ?? "");
  const matches = text.match(/\d+/g) ?? [];
  const last = matches.at(-1);
  const parsed = last ? Number.parseInt(last, 10) : undefined;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveMailAttachmentDownloadRoot(options = {}, value = "") {
  const explicit = String(value ?? "").trim();
  if (explicit && !/[\u0000\r\n]/u.test(explicit)) {
    return path.join(path.resolve(explicit), "mail-attachment-staging");
  }
  if (options.app?.getPath) {
    return path.join(options.app.getPath("userData"), "mail-attachment-staging");
  }
  return "";
}

function createMailAttachmentDownloadBridgeResult(input = {}) {
  return {
    status: sanitizeText(input.status ?? "imap_attachment_download_unavailable"),
    providerId: sanitizeText(input.providerId ?? "imap_smtp"),
    connectorId: sanitizeText(input.connectorId ?? ""),
    action: "download_message_attachments_to_local_staging",
    ...(input.mailbox ? { mailbox: sanitizeText(input.mailbox) } : {}),
    attachmentCount: 0,
    attachments: [],
    files: [],
    readOnlyMailboxLock: true,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    rawMessageSourceReturned: false,
    localFileWrite: false,
    originalMailMutated: false,
    userMessage: sanitizeText(input.userMessage ?? "메일 첨부 임시저장을 시작하지 못했습니다."),
    auditMessages: Array.isArray(input.auditMessages) ? input.auditMessages.map(sanitizeText) : [],
  };
}

function sanitizeHost(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-z0-9.-]/gi, "")
    .slice(0, 120);
}

function sanitizeConnectorId(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return text || `external-site-${randomBytes(4).toString("hex")}`;
}

function sanitizeConnectorMethod(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .slice(0, 80);
  return text || "unknown";
}

function sanitizeCredentialReferenceId(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 240 || /[\r\n]/.test(text)) return "";
  return /^[A-Za-z0-9._~:/@+-]+$/.test(text) ? text : "";
}

function inferConnectorCategory(connectorId, method) {
  const id = sanitizeConnectorId(connectorId);
  const methodText = sanitizeConnectorMethod(method);
  if (/booking|reservation|naver-booking|kakao-booking/u.test(id)) return "booking";
  if (methodText === "site_login") return "business_system";
  if (/mail|gmail|outlook|imap/u.test(id)) return "mail";
  if (/calendar|cal/u.test(id)) return "calendar";
  if (/telegram|slack|discord|kakao|message|messenger/u.test(id)) return "messenger";
  return "business_system";
}

function sanitizeSiteUserId(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 240 || /[\r\n]/.test(text)) return "";
  return text;
}

function sanitizeSiteUrl(value) {
  const text = String(value ?? "").trim().slice(0, 500);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function sanitizeWebmailReferenceUrl(value) {
  const siteUrl = sanitizeSiteUrl(value);
  if (!siteUrl) return "";
  try {
    const url = new URL(siteUrl);
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

function sanitizeTelegramChatId(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 120 || /[\r\n]/.test(text)) return "";
  if (/^-?\d{5,20}$/.test(text)) return text;
  if (/^@[A-Za-z0-9_]{5,32}$/.test(text)) return text;
  return "";
}

function sanitizeChannelTargetId(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 120 || /[\r\n]/.test(text)) return "";
  if (/^-?\d{5,22}$/.test(text)) return text;
  if (/^[CGD][A-Z0-9]{6,32}$/.test(text)) return text;
  if (/^#[A-Za-z0-9_-]{2,80}$/.test(text)) return text;
  if (/^@[A-Za-z0-9_]{3,80}$/.test(text)) return text;
  return "";
}

function previewTelegramChatId(value) {
  const chatId = sanitizeTelegramChatId(value);
  if (!chatId) return "";
  if (chatId.startsWith("@")) return `${chatId.slice(0, 4)}...${chatId.slice(-2)}`;
  return `${chatId.slice(0, 3)}...${chatId.slice(-3)}`;
}

function sanitizeTelegramNotificationMessage(value) {
  const text = sanitizeTextBlock(value).slice(0, 3800);
  if (!text) return "ModyCrew 승인 대기 알림입니다. 앱에서 답장/일정 후보를 확인해 주세요.";
  return text;
}

function inferSmtpHost(imapHost) {
  const host = sanitizeHost(imapHost);
  if (host.startsWith("imap.")) return `smtp.${host.slice(5)}`;
  if (host.includes("imap")) return host.replace("imap", "smtp");
  return host;
}

function inferSmtpPort(imapPort) {
  return Number(imapPort) === 993 ? 465 : 587;
}

function sanitizeEmailAddress(value) {
  const text = String(value ?? "").trim().slice(0, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : "";
}

function sanitizeAccessToken(value) {
  const token = String(value ?? "").trim();
  return token.length >= 20 && token.length <= 4096 ? token : "";
}

function sanitizeCalendarId(value) {
  const text = String(value ?? "").trim();
  if (!text) return "primary";
  return /^[A-Za-z0-9._~@:+/-]{1,320}$/.test(text) ? text : "primary";
}

function normalizeCalendarAttendees(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,\s;]+/)
        .filter(Boolean);
  return [...new Set(raw.map(sanitizeEmailAddress).filter(Boolean))].slice(0, 20);
}

function normalizeCalendarReminderMinutes(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,\s/]+/)
        .filter(Boolean);
  return [...new Set(
    raw
      .map((item) => Number(item))
      .filter((minutes) => Number.isInteger(minutes) && minutes >= 0 && minutes <= 10080),
  )].slice(0, 4);
}

function sanitizeCalendarLocation(value) {
  const text = sanitizeText(value).slice(0, 240);
  if (!text || text === "[redacted-token]" || text === "[redacted-key]") return "";
  return text;
}

function sanitizeCalendarMeetingUrl(value) {
  const text = String(value ?? "").trim().slice(0, 500);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString().slice(0, 500);
  } catch {
    return "";
  }
}

function appendMeetingUrlToDescription(description, meetingUrl) {
  const safeDescription = sanitizeTextBlock(description ?? "").slice(0, 6000);
  const safeMeetingUrl = sanitizeCalendarMeetingUrl(meetingUrl);
  if (!safeMeetingUrl || safeDescription.includes(safeMeetingUrl)) return safeDescription;
  return `${safeDescription}\n\n회의 링크: ${safeMeetingUrl}`.trim().slice(0, 6000);
}

function hasCalendarWriteScope(record) {
  const scope = sanitizeStoredOAuthScope(record.scope);
  if (record.providerId === "outlook_calendar") {
    return scope.split(/\s+/).includes("Calendars.ReadWrite");
  }
  if (record.providerId === "google_calendar") {
    const scopes = scope.split(/\s+/);
    return scopes.includes("https://www.googleapis.com/auth/calendar.events") ||
      scopes.includes("https://www.googleapis.com/auth/calendar");
  }
  return false;
}

function hasMailSendScope(record) {
  if (record.method === "imap_smtp") return true;
  const scope = sanitizeStoredOAuthScope(record.scope);
  const scopes = scope.split(/\s+/);
  if (record.providerId === "outlook") {
    return scopes.includes("Mail.Send");
  }
  if (record.providerId === "gmail") {
    return scopes.includes("https://www.googleapis.com/auth/gmail.send");
  }
  return false;
}

function redactOAuthSecret(message, secret) {
  let redacted = sanitizeText(message);
  if (secret) redacted = redacted.split(secret).join("[oauth-token-redacted]");
  return redacted
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, "[oauth-token-redacted]")
    .replace(/\bEw[A-Za-z0-9._~+/=-]{20,}\b/g, "[oauth-token-redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [oauth-token-redacted]");
}

function computeTokenExpiresAt(expiresIn, options = {}) {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const now = options.now ? options.now() : new Date();
  return new Date(now.getTime() + Math.trunc(seconds) * 1000).toISOString();
}

function isOAuthAccessTokenExpired(record, options = {}) {
  const expiresAt = sanitizeOptionalIso(record.accessTokenExpiresAt);
  if (!expiresAt) return false;
  const now = options.now ? options.now() : new Date();
  const refreshSkewMs = 120 * 1000;
  return new Date(expiresAt).getTime() <= now.getTime() + refreshSkewMs;
}

function readStoredOAuthRefreshSettings(record) {
  const providerId = sanitizeText(record.providerId);
  const tokenEndpoint =
    sanitizeStoredTokenEndpoint(record.tokenEndpoint) ||
    (isMicrosoftOAuthRecord(record)
      ? "https://login.microsoftonline.com/common/oauth2/v2.0/token"
      : "https://oauth2.googleapis.com/token");
  const clientId =
    sanitizeOAuthClientId(record.oauthClientId) ||
    (isMicrosoftOAuthRecord(record)
      ? sanitizeOAuthClientId(
          process.env.MODYCREW_MICROSOFT_OAUTH_CLIENT_ID ?? process.env.MICROSOFT_OAUTH_CLIENT_ID,
        )
      : resolveGoogleOAuthClient().clientId);
  const fallbackScope =
    providerId === "outlook"
      ? "offline_access Mail.Read"
      : providerId === "outlook_calendar"
        ? "offline_access Calendars.ReadBasic"
        : providerId === "gmail"
          ? "https://www.googleapis.com/auth/gmail.readonly"
          : "https://www.googleapis.com/auth/calendar.freebusy";
  return {
    clientId,
    tokenEndpoint,
    scope: sanitizeStoredOAuthScope(record.scope) || fallbackScope,
  };
}

function isMicrosoftOAuthRecord(record) {
  return record.providerId === "outlook" || record.providerId === "outlook_calendar";
}

function sanitizeStoredTokenEndpoint(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const google = url.protocol === "https:" && url.hostname === "oauth2.googleapis.com" && url.pathname === "/token";
    const microsoft =
      url.protocol === "https:" &&
      url.hostname === "login.microsoftonline.com" &&
      url.pathname === "/common/oauth2/v2.0/token";
    return google || microsoft ? url.toString() : "";
  } catch {
    return "";
  }
}

function sanitizeStoredOAuthScope(value) {
  const text = String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(" ");
  if (!text || /[\r\n]/.test(text) || text.length > 500) return "";
  const allowed = new Set([
    "offline_access",
    "Mail.ReadBasic",
    "Mail.Read",
    "Mail.Send",
    "Calendars.ReadBasic",
    "Calendars.Read",
    "Calendars.ReadWrite",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar",
  ]);
  const scopes = text.split(/\s+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((scope) => allowed.has(scope)) ? scopes.join(" ") : "";
}

function normalizeCalendarIds(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : ["primary"];
  const ids = raw
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0 && id.length <= 320 && !/[\r\n]/.test(id));
  return ids.length > 0 ? [...new Set(ids)].slice(0, 10) : ["primary"];
}

function normalizeOutlookScheduleIds(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : ["me"];
  const ids = raw
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0 && id.length <= 320 && !/[\r\n]/.test(id));
  return ids.length > 0 ? [...new Set(ids)].slice(0, 10) : ["me"];
}

function sanitizeOptionalIso(value) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function sanitizeTimeZone(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_+./-]{1,64}$/.test(text) ? text : "Asia/Seoul";
}

function resolveConnectorOAuthPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : defaultConnectorOAuthPort;
}

function resolveConfiguredConnectorOAuthPort(options = {}) {
  return resolveConnectorOAuthPort(
    options.connectorOAuthPort ??
      process.env.MODYCREW_CONNECTOR_OAUTH_PORT ??
      process.env.MODYCREW_OAUTH_PORT,
  );
}

function resolveGoogleOAuthClient(input = {}) {
  const candidates = [
    ["provided_client", input.clientId],
    ["connector_oauth_client", process.env.MODYCREW_GOOGLE_OAUTH_CLIENT_ID],
    ["legacy_oauth_client", process.env.GOOGLE_OAUTH_CLIENT_ID],
    ["desktop_signin_fallback", process.env.MODYCREW_GOOGLE_SIGNIN_CLIENT_ID],
  ];
  for (const [clientIdSource, value] of candidates) {
    const clientId = sanitizeOAuthClientId(value);
    if (clientId) return { clientId, clientIdSource };
  }
  return { clientId: "", clientIdSource: "missing" };
}

function resolveGoogleOAuthCallbackSettings(clientIdSource, options = {}) {
  const usesDynamicLoopback =
    clientIdSource === "desktop_signin_fallback" || clientIdSource === "provided_client";
  return {
    callbackMode: usesDynamicLoopback ? "dynamic_loopback" : "registered_loopback",
    callbackPort: usesDynamicLoopback ? 0 : resolveConfiguredConnectorOAuthPort(options),
  };
}

function readGoogleCalendarOAuthSettings(input = {}, options = {}) {
  const googleClient = resolveGoogleOAuthClient(input);
  return {
    clientId: googleClient.clientId,
    clientIdSource: googleClient.clientIdSource,
    clientSecret: resolveGoogleOAuthClientSecret(input.clientSecret),
    ...resolveGoogleOAuthCallbackSettings(googleClient.clientIdSource, options),
    authorizationEndpoint: sanitizeOAuthEndpoint(
      input.authorizationEndpoint ??
        process.env.MODYCREW_GOOGLE_OAUTH_AUTH_URL ??
        "https://accounts.google.com/o/oauth2/v2/auth",
      "accounts.google.com",
    ),
    tokenEndpoint: sanitizeOAuthEndpoint(
      input.tokenEndpoint ??
        process.env.MODYCREW_GOOGLE_OAUTH_TOKEN_URL ??
        "https://oauth2.googleapis.com/token",
      "oauth2.googleapis.com",
    ),
    scope: sanitizeOAuthScope(
      input.scope ??
        process.env.MODYCREW_GOOGLE_CALENDAR_OAUTH_SCOPE ??
        "https://www.googleapis.com/auth/calendar.freebusy",
    ),
    calendarIds: normalizeCalendarIds(
      input.calendarIds ?? process.env.MODYCREW_GOOGLE_CALENDAR_IDS ?? "primary",
    ),
    timeZone: sanitizeTimeZone(
      input.timeZone ?? process.env.MODYCREW_GOOGLE_CALENDAR_TIME_ZONE ?? "Asia/Seoul",
    ),
  };
}

function readGmailOAuthSettings(input = {}, options = {}) {
  const wantsSend =
    sanitizeText(input.mode ?? input.permissionMode ?? input.intent ?? "").toLowerCase().includes("send") ||
    sanitizeText(input.mode ?? input.permissionMode ?? input.intent ?? "").includes("발송");
  const googleClient = resolveGoogleOAuthClient(input);
  return {
    clientId: googleClient.clientId,
    clientIdSource: googleClient.clientIdSource,
    clientSecret: resolveGoogleOAuthClientSecret(input.clientSecret),
    ...resolveGoogleOAuthCallbackSettings(googleClient.clientIdSource, options),
    authorizationEndpoint: sanitizeOAuthEndpoint(
      input.authorizationEndpoint ??
        process.env.MODYCREW_GOOGLE_OAUTH_AUTH_URL ??
        "https://accounts.google.com/o/oauth2/v2/auth",
      "accounts.google.com",
    ),
    tokenEndpoint: sanitizeOAuthEndpoint(
      input.tokenEndpoint ??
        process.env.MODYCREW_GOOGLE_OAUTH_TOKEN_URL ??
        "https://oauth2.googleapis.com/token",
      "oauth2.googleapis.com",
    ),
    scope: sanitizeGmailScope(
      input.scope ??
        process.env.MODYCREW_GMAIL_OAUTH_SCOPE ??
        (wantsSend
          ? "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send"
          : "https://www.googleapis.com/auth/gmail.readonly"),
    ),
    mailboxId: sanitizeText(input.mailboxId ?? process.env.MODYCREW_GMAIL_MAILBOX_ID ?? "INBOX") || "INBOX",
    query: sanitizeText(input.query ?? process.env.MODYCREW_GMAIL_QUERY ?? "in:inbox") || "in:inbox",
  };
}

function readOutlookMailOAuthSettings(input = {}, options = {}) {
  const wantsSend =
    sanitizeText(input.mode ?? input.permissionMode ?? input.intent ?? "").toLowerCase().includes("send") ||
    sanitizeText(input.mode ?? input.permissionMode ?? input.intent ?? "").includes("발송");
  return {
    clientId: sanitizeOAuthClientId(
      input.clientId ??
        process.env.MODYCREW_MICROSOFT_OAUTH_CLIENT_ID ??
        process.env.MICROSOFT_OAUTH_CLIENT_ID,
    ),
    callbackMode: "registered_loopback",
    callbackPort: resolveConfiguredConnectorOAuthPort(options),
    authorizationEndpoint: sanitizeOAuthEndpoint(
      input.authorizationEndpoint ??
        process.env.MODYCREW_MICROSOFT_OAUTH_AUTH_URL ??
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      "login.microsoftonline.com",
      "/common/oauth2/v2.0/authorize",
    ),
    tokenEndpoint: sanitizeOAuthEndpoint(
      input.tokenEndpoint ??
        process.env.MODYCREW_MICROSOFT_OAUTH_TOKEN_URL ??
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      "login.microsoftonline.com",
      "/common/oauth2/v2.0/token",
    ),
    scope: sanitizeMicrosoftMailScope(
      input.scope ??
        process.env.MODYCREW_OUTLOOK_MAIL_OAUTH_SCOPE ??
        (wantsSend ? "offline_access Mail.Read Mail.Send" : "offline_access Mail.Read"),
    ),
    mailboxId: sanitizeText(input.mailboxId ?? process.env.MODYCREW_OUTLOOK_MAILBOX_ID ?? "Inbox") || "Inbox",
  };
}

function readOutlookCalendarOAuthSettings(input = {}, options = {}) {
  return {
    clientId: sanitizeOAuthClientId(
      input.clientId ??
        process.env.MODYCREW_MICROSOFT_OAUTH_CLIENT_ID ??
        process.env.MICROSOFT_OAUTH_CLIENT_ID,
    ),
    callbackMode: "registered_loopback",
    callbackPort: resolveConfiguredConnectorOAuthPort(options),
    authorizationEndpoint: sanitizeOAuthEndpoint(
      input.authorizationEndpoint ??
        process.env.MODYCREW_MICROSOFT_OAUTH_AUTH_URL ??
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      "login.microsoftonline.com",
      "/common/oauth2/v2.0/authorize",
    ),
    tokenEndpoint: sanitizeOAuthEndpoint(
      input.tokenEndpoint ??
        process.env.MODYCREW_MICROSOFT_OAUTH_TOKEN_URL ??
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      "login.microsoftonline.com",
      "/common/oauth2/v2.0/token",
    ),
    scope: sanitizeMicrosoftGraphScope(
      input.scope ??
        process.env.MODYCREW_OUTLOOK_CALENDAR_OAUTH_SCOPE ??
        "offline_access Calendars.ReadBasic",
    ),
    scheduleIds: normalizeOutlookScheduleIds(
      input.scheduleIds ?? process.env.MODYCREW_OUTLOOK_CALENDAR_SCHEDULE_IDS ?? "me",
    ),
    timeZone: sanitizeTimeZone(
      input.timeZone ?? process.env.MODYCREW_OUTLOOK_CALENDAR_TIME_ZONE ?? "Asia/Seoul",
    ),
  };
}

function sanitizeOAuthClientId(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9._:-]{8,240}$/.test(text) ? text : "";
}

function sanitizeOAuthClientSecret(value) {
  const text = String(value ?? "").trim();
  return /^[\x21-\x7e]{8,128}$/.test(text) ? text : "";
}

// Google 은 데스크톱 앱 유형 클라이언트도 token 교환/갱신에 client_secret 을 요구한다
// (이 유형의 secret 은 Google 정책상 비밀로 취급되지 않음 — PKCE+사용자 동의로 보호).
// 커넥터 전용 키가 없으면 데스크톱 로그인용 클라이언트를 재사용해 설치본에서도 동작한다.
function resolveGoogleOAuthClientSecret(explicit) {
  // resolveGoogleOAuthClient 와 같은 방식으로 후보를 순회한다. ?? 체인은 빈 문자열에서
  // 멈추므로, .env 에 MODYCREW_GOOGLE_OAUTH_CLIENT_SECRET= 만 비워 두면 설치본의
  // 로그인용 키로 넘어가지 못해 token 교환이 invalid_client 로 죽었다.
  const candidates = [
    explicit,
    process.env.MODYCREW_GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.MODYCREW_GOOGLE_SIGNIN_CLIENT_SECRET,
  ];
  for (const candidate of candidates) {
    const clientSecret = sanitizeOAuthClientSecret(candidate);
    if (clientSecret) return clientSecret;
  }
  return "";
}

function isGoogleOAuthTokenEndpoint(value) {
  try {
    return new URL(String(value ?? "")).hostname === "oauth2.googleapis.com";
  } catch {
    return false;
  }
}

function sanitizeOAuthEndpoint(value, allowedHost, allowedPath) {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "https:" || url.hostname !== allowedHost) {
    throw new Error(`허용되지 않은 OAuth endpoint 입니다: ${url.hostname}`);
  }
  if (allowedPath && url.pathname !== allowedPath) {
    throw new Error(`허용되지 않은 OAuth endpoint path 입니다: ${url.pathname}`);
  }
  if (url.search || url.hash) {
    throw new Error("OAuth endpoint에는 query/hash를 포함하지 않습니다.");
  }
  return url.toString();
}

function sanitizeOAuthScope(value) {
  const text = String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(" ");
  const allowed = new Set([
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar",
  ]);
  const scopes = text.split(/\s+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((scope) => allowed.has(scope))
    ? scopes.join(" ")
    : "https://www.googleapis.com/auth/calendar.freebusy";
}

function sanitizeGmailScope(value) {
  const text = String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(" ");
  const allowed = new Set([
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ]);
  const scopes = text.split(/\s+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((scope) => allowed.has(scope))
    ? scopes.join(" ")
    : "https://www.googleapis.com/auth/gmail.readonly";
}

function sanitizeMicrosoftGraphScope(value) {
  const text = String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(" ");
  const allowed = new Set([
    "offline_access",
    "Calendars.ReadBasic",
    "Calendars.Read",
    "Calendars.ReadWrite",
  ]);
  const scopes = text.split(/\s+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((scope) => allowed.has(scope))
    ? scopes.join(" ")
    : "offline_access Calendars.ReadBasic";
}

function sanitizeMicrosoftMailScope(value) {
  const text = String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(" ");
  const allowed = new Set([
    "offline_access",
    "Mail.ReadBasic",
    "Mail.Read",
    "Mail.Send",
  ]);
  const scopes = text.split(/\s+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((scope) => allowed.has(scope))
    ? scopes.join(" ")
    : "offline_access Mail.Read";
}

function createOAuthConfigurationMissingResult({ connectorId, providerId, providerLabel }) {
  return {
    status: "oauth_config_missing",
    connectorId,
    method: "oauth",
    providerId,
    userMessage: `${providerLabel} 계정 연결 설정이 아직 준비되지 않았습니다. 앱 관리자에게 계정 연결을 요청한 뒤 다시 시도해 주세요.`,
    nextStep: "관리자가 이 앱의 계정 연결을 준비한 뒤 연결 버튼을 다시 눌러 주세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createOAuthCallbackUnavailableResult({ connectorId, providerId, providerLabel, settings }) {
  const usesDynamicLoopback = settings?.callbackMode === "dynamic_loopback";
  const callbackPort = resolveConnectorOAuthPort(settings?.callbackPort);
  return {
    status: "oauth_callback_unavailable",
    connectorId,
    method: "oauth",
    providerId,
    callbackMode: usesDynamicLoopback ? "dynamic_loopback" : "registered_loopback",
    ...(usesDynamicLoopback ? {} : { callbackPort }),
    userMessage: usesDynamicLoopback
      ? `${providerLabel} 연결 확인용 로컬 주소를 열지 못했습니다. 앱을 완전히 종료한 뒤 다시 실행하고 다시 시도해 주세요.`
      : `${providerLabel} 연결 확인용 localhost 포트 ${callbackPort}를 열지 못했습니다. 다른 앱이 이 포트를 사용 중인지 확인한 뒤 다시 시도해 주세요.`,
    nextStep: usesDynamicLoopback
      ? "계속 실패하면 앱 관리자에게 로컬 연결 권한 또는 보안 프로그램 차단 여부를 확인해 달라고 요청해 주세요."
      : `다른 앱에서 포트 ${callbackPort}를 비우거나 앱 관리자에게 연결 포트 설정을 확인해 달라고 요청해 주세요.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function createOAuthCallbackInProgressResult({ connectorId, providerId, providerLabel, session }) {
  return {
    status: "oauth_callback_in_progress",
    connectorId,
    method: "oauth",
    providerId,
    callbackMode: session.callbackMode,
    callbackPort: session.callbackPort,
    authorizationUrl: session.authorizationUrl,
    callbackUrl: session.callbackUrl,
    externalUrlOpened: false,
    userMessage: `${providerLabel} 인증 결과를 안전하게 확인하고 있습니다. 열린 브라우저 창을 닫지 말고 잠시 기다려 주세요.`,
    nextStep: "처리가 끝난 뒤 연결 상태를 확인해 주세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function createConnectorOAuthSession({
  callbackPath,
  settings,
  options,
  handler,
  extraAuthorizationParams = {},
}) {
  const state = randomId(24);
  const codeVerifier = randomId(64);
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const requestedPort = settings.callbackPort === 0 ? 0 : resolveConnectorOAuthPort(settings.callbackPort);
  const usesDynamicLoopback = settings.callbackMode === "dynamic_loopback";
  let server;
  let port;
  if (usesDynamicLoopback) {
    server = http.createServer((request, response) => {
      void handler(request, response, options);
    });
    port = await listenForConnectorOAuthCallback(server, requestedPort);
  } else {
    const registeredCallbackServer = await acquireRegisteredConnectorOAuthCallbackServer({
      requestedPort,
      callbackPath,
      handler,
      options,
    });
    server = registeredCallbackServer.server;
    port = registeredCallbackServer.port;
  }
  const callbackUrl = `http://${connectorOAuthLoopbackHost}:${port}${callbackPath}`;
  const authorizationUrl = new URL(settings.authorizationEndpoint);
  authorizationUrl.searchParams.set("client_id", settings.clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", settings.scope);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  for (const [key, value] of Object.entries(extraAuthorizationParams)) {
    authorizationUrl.searchParams.set(key, String(value));
  }
  return {
    server,
    callbackPath,
    callbackUrl,
    state,
    codeVerifier,
    codeChallenge,
    clientId: settings.clientId,
    clientSecret: settings.clientSecret ?? "",
    tokenEndpoint: settings.tokenEndpoint,
    scope: settings.scope,
    callbackMode: usesDynamicLoopback ? "dynamic_loopback" : "registered_loopback",
    callbackPort: port,
    callbackServerKind: usesDynamicLoopback ? "session" : "registered_shared",
    authorizationUrl: authorizationUrl.toString(),
  };
}

async function listenForConnectorOAuthCallback(server, requestedPort) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(requestedPort, connectorOAuthLoopbackHost);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? Number(address.port) : 0;
  if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  try {
    server.close();
  } catch {
    // no listener to close
  }
  throw new Error("OAuth callback loopback server did not expose a valid port");
}

async function acquireRegisteredConnectorOAuthCallbackServer({
  requestedPort,
  callbackPath,
  handler,
  options,
}) {
  const closing = registeredConnectorOAuthCallbackServerClosings.get(requestedPort);
  if (closing) await closing;

  let registry = registeredConnectorOAuthCallbackServers.get(requestedPort);
  if (!registry) {
    let opening = registeredConnectorOAuthCallbackServerOpenings.get(requestedPort);
    if (!opening) {
      opening = createRegisteredConnectorOAuthCallbackServer(requestedPort)
        .then((created) => {
          registeredConnectorOAuthCallbackServers.set(requestedPort, created);
          return created;
        })
        .finally(() => {
          registeredConnectorOAuthCallbackServerOpenings.delete(requestedPort);
        });
      registeredConnectorOAuthCallbackServerOpenings.set(requestedPort, opening);
    }
    registry = await opening;
  }

  registry.routes.set(callbackPath, { handler, options });
  return { server: registry.server, port: registry.port };
}

async function createRegisteredConnectorOAuthCallbackServer(requestedPort) {
  const registry = {
    port: requestedPort,
    server: null,
    routes: new Map(),
  };
  const server = http.createServer((request, response) => {
    void dispatchRegisteredConnectorOAuthCallback(registry, request, response);
  });
  registry.server = server;
  registry.port = await listenForConnectorOAuthCallback(server, requestedPort);
  return registry;
}

async function dispatchRegisteredConnectorOAuthCallback(registry, request, response) {
  let callbackPath = "";
  try {
    callbackPath = new URL(request.url || "/", `http://${connectorOAuthLoopbackHost}`).pathname;
  } catch {
    writeOAuthResponse(response, 400, {
      status: "oauth_callback_path_invalid",
      userMessage: "OAuth callback 주소를 확인할 수 없습니다. 앱에서 다시 연결을 시작해 주세요.",
    });
    return;
  }
  const route = registry.routes.get(callbackPath);
  if (!route) {
    writeOAuthResponse(response, 400, {
      status: "oauth_callback_session_missing",
      userMessage: "진행 중인 OAuth 연결 세션이 없습니다. 앱에서 다시 연결을 시작해 주세요.",
    });
    return;
  }
  void route.handler(request, response, route.options);
}

function releaseRegisteredConnectorOAuthCallbackServer(session) {
  const port = Number(session?.callbackPort);
  if (!Number.isInteger(port) || port <= 0) return;
  const registry = registeredConnectorOAuthCallbackServers.get(port);
  if (!registry || registry.server !== session.server) return;
  registry.routes.delete(session.callbackPath);
  if (registry.routes.size > 0) return;

  registeredConnectorOAuthCallbackServers.delete(port);
  const closing = closeConnectorOAuthCallbackServer(registry.server);
  registeredConnectorOAuthCallbackServerClosings.set(port, closing);
  void closing.finally(() => {
    if (registeredConnectorOAuthCallbackServerClosings.get(port) === closing) {
      registeredConnectorOAuthCallbackServerClosings.delete(port);
    }
  });
}

function closeConnectorOAuthCallbackServer(server) {
  return new Promise((resolve) => {
    try {
      if (!server?.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function openAllowedConnectorExternalUrl(shellApi, url, options = {}) {
  if (options.disableExternalLaunch) return false;
  if (!shellApi) return false;
  const parsed = new URL(url);
  const allowedGoogle =
    parsed.protocol === "https:" &&
    parsed.hostname === "accounts.google.com" &&
    parsed.pathname.startsWith("/o/oauth2/");
  const allowedMicrosoft =
    parsed.protocol === "https:" &&
    parsed.hostname === "login.microsoftonline.com" &&
    parsed.pathname === "/common/oauth2/v2.0/authorize";
  if (!allowedGoogle && !allowedMicrosoft) {
    throw new Error(`허용되지 않은 connector OAuth URL 입니다: ${parsed.hostname}${parsed.pathname}`);
  }
  const redirectUri = parsed.searchParams.get("redirect_uri") ?? "";
  let callbackPath = redirectUri;
  try {
    callbackPath = new URL(redirectUri).pathname || redirectUri;
  } catch {
    // Authorization URL validation and callback listener validation still apply.
  }
  const guardKey = `${parsed.hostname}${parsed.pathname}:${parsed.searchParams.get("client_id") ?? ""}:${callbackPath}`;
  const activeGuard = connectorExternalLaunchGuards.get(guardKey);
  if (activeGuard && Date.now() - activeGuard.openedAt < connectorExternalLaunchCooldownMs) {
    return false;
  }
  const openExternal = shellApi["openExternal"];
  if (typeof openExternal !== "function") return false;
  await openExternal.call(shellApi, parsed.toString());
  connectorExternalLaunchGuards.set(guardKey, {
    openedAt: Date.now(),
    authorizationUrl: parsed.toString(),
  });
  return true;
}

function closeGoogleCalendarOAuthSession() {
  closeConnectorOAuthSessionServer(googleCalendarOAuthSession);
  googleCalendarOAuthSession = null;
  clearConnectorOAuthLaunchGuards();
}

function closeGmailOAuthSession() {
  closeConnectorOAuthSessionServer(gmailOAuthSession);
  gmailOAuthSession = null;
  clearConnectorOAuthLaunchGuards();
}

function closeOutlookMailOAuthSession() {
  closeConnectorOAuthSessionServer(outlookMailOAuthSession);
  outlookMailOAuthSession = null;
  clearConnectorOAuthLaunchGuards();
}

function closeOutlookCalendarOAuthSession() {
  closeConnectorOAuthSessionServer(outlookCalendarOAuthSession);
  outlookCalendarOAuthSession = null;
  clearConnectorOAuthLaunchGuards();
}

function closeConnectorOAuthSessionServer(session) {
  if (!session?.server) return;
  if (session.callbackServerKind === "registered_shared") {
    releaseRegisteredConnectorOAuthCallbackServer(session);
    return;
  }
  try {
    session.server.close();
  } catch {
    // already closed
  }
}

function clearConnectorOAuthLaunchGuards() {
  connectorExternalLaunchGuards.clear();
}

function writeOAuthResponse(response, statusCode, body) {
  const safeBody = {
    ...body,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(safeBody, null, 2)}\n`);
}

function randomId(byteLength) {
  return base64Url(randomBytes(byteLength));
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fingerprintSecret(value) {
  return createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex")
    .slice(0, 16);
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, "[redacted-phone]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, "[redacted-google-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function sanitizeTextBlock(value) {
  return String(value ?? "")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, "[redacted-google-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeSlackCommandUpdates(values, record = {}) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value, index) => normalizeSlackCommandUpdate(value, record, index))
    .filter(Boolean)
    .slice(0, 40);
}

function normalizeSlackCommandUpdate(value, record = {}, index = 0) {
  if (!value || typeof value !== "object") return null;
  const updateId = sanitizeText(
    value.updateId ?? value.event_id ?? value.trigger_id ?? value.commandId ?? value.ts ?? `slack-${index + 1}`,
  );
  const text = sanitizeTextBlock(value.text ?? value.messageText ?? value.commandText ?? "").slice(0, 1800);
  if (!updateId || !text) return null;
  const channelId = sanitizeChannelTargetId(value.channelId ?? value.channel_id ?? record.channelTargetId ?? "");
  const senderId = sanitizeText(value.senderId ?? value.user_id ?? value.userId ?? "slack-user").slice(0, 80);
  return {
    updateId,
    text,
    senderId,
    channelId,
    chatId: channelId,
    receivedAt: sanitizeIsoLike(value.receivedAt ?? value.eventTime ?? value.ts),
    threadId: sanitizeText(value.threadId ?? value.thread_ts ?? channelId).slice(0, 120),
  };
}

function sanitizeIsoLike(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{10}(?:\.\d+)?$/u.test(raw)) {
    return new Date(Number(raw) * 1000).toISOString();
  }
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function safeId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 80) || "calendar";
}
async function connectDiscoveredImapProvider(connectorId, normalizedInput, originalInput, options = {}) {
  const hasExplicitServer = Boolean(String(originalInput.imapHost ?? originalInput.host ?? "").trim());
  if (hasExplicitServer) {
    const result = await testImapConnection(connectorId, normalizedInput, options);
    return { result, input: normalizedInput, discovery: null };
  }

  const discover = options.discoverMailServerSettings ?? discoverMailServerSettings;
  const discovery = await discover(normalizedInput.emailAddress ?? normalizedInput.imapUser, {
    resolveMx: options.resolveMx,
    resolveSrv: options.resolveSrv,
    fetchFn: options.fetch ?? globalThis.fetch,
  });
  const candidates = buildDiscoveredMailServerCandidates(discovery, normalizedInput);
  const confirmed =
    findConfirmedDiscoveredMailServer(originalInput.confirmDiscoveredServer, candidates) ??
    autoConfirmTrustedDiscoveredMailServer(candidates);
  if (!confirmed) {
    return {
      result: createMailServerDiscoveryConfirmationResult(
        connectorId,
        discovery,
        candidates,
        originalInput.confirmDiscoveredServer
          ? "선택한 메일 서버 후보가 현재 탐색 결과와 달라 다시 확인이 필요합니다. 아직 비밀번호로 서버 인증을 시도하지 않았습니다."
          : "메일 서버 후보를 찾았습니다. 아직 비밀번호로 서버 인증을 시도하지 않았습니다. 연결할 서버를 확인한 뒤 선택하세요.",
      ),
      input: normalizedInput,
      discovery,
    };
  }

  const candidateInput = {
    ...normalizedInput,
    imapHost: confirmed.imapHost,
    imapPort: confirmed.imapPort,
    imapSecure: confirmed.imapSecure,
    imapStartTls: confirmed.imapStartTls,
    smtpHost: confirmed.smtpHost,
    smtpPort: confirmed.smtpPort,
    smtpSecure: confirmed.smtpSecure,
    smtpStartTls: confirmed.smtpStartTls,
    discoverySource: confirmed.source,
  };
  const result = await testImapConnection(connectorId, candidateInput, options);
  return {
    result: {
      ...result,
      discoveryStatus: discovery?.status,
      discoverySource: confirmed.source,
      discoveredProvider: sanitizeText(discovery?.provider ?? "custom").slice(0, 80),
    },
    input: candidateInput,
    discovery,
  };
}

/**
 * 서버 출처가 확실하면(제공사가 공개한 설정, DNS 레코드, 우리가 검증한
 * 제공사표, 구글/MS 운영 확인) 사용자에게 한 번 더 고르라고 묻지 않는다.
 * 추측으로 만든 후보(host_pattern 등)만 확인을 남긴다 — 틀린 서버로
 * 비밀번호를 보내지 않기 위해서다.
 */
const trustedDiscoveredMailServerSources = new Set([
  "autoconfig",
  "srv_record",
  "known_provider",
  "mx_hosted_google",
  "mx_hosted_microsoft",
]);

function autoConfirmTrustedDiscoveredMailServer(candidates) {
  const top = Array.isArray(candidates) ? candidates[0] : null;
  if (!top) return null;
  return trustedDiscoveredMailServerSources.has(String(top.source ?? "")) ? top : null;
}

function buildDiscoveredMailServerCandidates(discovery, normalizedInput) {
  const imapCandidates = Array.isArray(discovery?.imapCandidates) && discovery.imapCandidates.length
    ? discovery.imapCandidates
    : [{ host: normalizedInput.imapHost, port: normalizedInput.imapPort, secure: true, source: "domain_convention" }];
  const smtpCandidates = Array.isArray(discovery?.smtpCandidates) ? discovery.smtpCandidates : [];

  return imapCandidates
    .slice(0, 6)
    .map((imap) => {
      const imapHost = sanitizeHost(imap?.host);
      const imapPort = normalizeMailServerPort(imap?.port, normalizedInput.imapPort);
      if (!imapHost || !imapPort) return null;

      const smtp = smtpCandidates.find((item) => item?.source === imap?.source) ?? discovery?.smtp;
      const smtpHost = sanitizeHost(smtp?.host ?? inferSmtpHost(imapHost));
      const smtpPort = normalizeMailServerPort(smtp?.port, inferSmtpPort(imapPort));
      return {
        imapHost,
        imapPort,
        imapSecure: imap?.secure !== false,
        imapStartTls: imap?.startTls === true,
        smtpHost,
        smtpPort,
        smtpSecure: smtp?.secure !== false,
        smtpStartTls: smtp?.startTls === true,
        source: sanitizeText(imap?.source ?? discovery?.source ?? "automatic").slice(0, 80),
      };
    })
    .filter(Boolean);
}

function normalizeMailServerPort(value, fallback) {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  const fallbackPort = Number(fallback);
  return Number.isInteger(fallbackPort) && fallbackPort > 0 && fallbackPort <= 65_535 ? fallbackPort : 0;
}

function findConfirmedDiscoveredMailServer(value, candidates) {
  if (!value || typeof value !== "object") return null;
  const host = sanitizeHost(value.imapHost);
  const port = normalizeMailServerPort(value.imapPort, 0);
  if (!host || !port) return null;
  return candidates.find((candidate) => candidate.imapHost === host && candidate.imapPort === port) ?? null;
}

function createMailServerDiscoveryConfirmationResult(connectorId, discovery, candidates, userMessage) {
  return {
    status: "imap_server_discovery_confirmation_required",
    connectorId,
    method: "imap_smtp",
    userMessage,
    mailServerDiscovery: {
      domain: sanitizeHost(discovery?.domain),
      provider: sanitizeText(discovery?.provider ?? "custom").slice(0, 80) || "custom",
      candidates,
    },
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}
