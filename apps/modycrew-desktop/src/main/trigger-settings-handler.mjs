import path from "node:path";
import { mutateJsonStore, readJsonStore } from "./json-store.mjs";

const vaultFileName = "trigger-settings.json";
const supportedModes = new Set(["webhook", "polling", "scheduled"]);
const supportedNotifyPolicies = new Set(["each_signal", "important_only", "digest_only", "silent"]);
const supportedActionPolicies = new Set(["queue_ai_review", "notify_only", "digest_report"]);
const allowedCadenceMinutes = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];

const defaultTriggerRules = Object.freeze([
  {
    id: "instant-inquiry-message",
    label: "문의/앱 메시지 즉시 처리",
    connectorId: "generic-inquiry-site",
    sourceKind: "business_inquiry",
    triggerKind: "inquiry_arrived",
    mode: "webhook",
    enabled: true,
    cadenceMinutes: 30,
    notifyPolicy: "each_signal",
    actionPolicy: "queue_ai_review",
  },
  {
    id: "mail-polling-watch",
    label: "메일 5분 자동 점검",
    connectorId: "custom-imap-mail",
    sourceKind: "mailbox",
    triggerKind: "mail_arrived",
    mode: "polling",
    enabled: false,
    cadenceMinutes: 5,
    notifyPolicy: "important_only",
    actionPolicy: "queue_ai_review",
    notificationChannels: {
      appInbox: true,
      os: false,
      telegram: false,
    },
  },
  {
    id: "telegram-command-watch",
    label: "Telegram 상태/승인 대화",
    connectorId: "telegram-bot",
    sourceKind: "message_channel",
    triggerKind: "messenger_command",
    mode: "polling",
    enabled: true,
    cadenceMinutes: 5,
    notifyPolicy: "each_signal",
    actionPolicy: "queue_ai_review",
  },
  {
    id: "daily-work-digest",
    label: "하루 업무 요약 알림",
    connectorId: "telegram-bot",
    sourceKind: "message_channel",
    triggerKind: "scheduled_check",
    mode: "scheduled",
    enabled: false,
    cadenceMinutes: 1440,
    notifyPolicy: "digest_only",
    actionPolicy: "digest_report",
  },
  {
    id: "daily-weekly-schedule-briefing",
    label: "매일 1주일 일정 브리핑",
    connectorId: "mody-work-schedule",
    sourceKind: "work_schedule",
    triggerKind: "scheduled_check",
    mode: "scheduled",
    enabled: true,
    cadenceMinutes: 1440,
    notifyPolicy: "digest_only",
    actionPolicy: "digest_report",
    notificationChannels: {
      appInbox: true,
      os: false,
      telegram: false,
    },
  },
  {
    id: "urgent-deadline-watch",
    label: "마감 임박 업무 자주 확인",
    connectorId: "mody-work-schedule",
    sourceKind: "work_schedule",
    triggerKind: "scheduled_check",
    mode: "polling",
    enabled: true,
    cadenceMinutes: 30,
    notifyPolicy: "important_only",
    actionPolicy: "digest_report",
    notificationChannels: {
      appInbox: true,
      os: false,
      telegram: false,
    },
  },
  {
    id: "meeting-reminder-watch",
    label: "미팅 전 알림 확인",
    connectorId: "mody-work-schedule",
    sourceKind: "work_schedule",
    triggerKind: "scheduled_check",
    mode: "polling",
    enabled: true,
    cadenceMinutes: 60,
    notifyPolicy: "important_only",
    actionPolicy: "digest_report",
    notificationChannels: {
      appInbox: true,
      os: false,
      telegram: false,
    },
  },
]);

export async function handleTriggerSettingsMessage(_event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");

  if (kind === "list") {
    return listTriggerSettings(options);
  }

  if (kind === "update_rule") {
    return updateTriggerRule(payload.rule ?? payload, options);
  }

  if (kind === "reset") {
    return resetTriggerSettings(options);
  }

  throw new Error(`unsupported trigger-settings kind: ${kind}`);
}

export async function listTriggerSettings(options = {}) {
  const vault = await readVault(options);
  const now = nowIso(options);
  const rules = vault.rules.map((rule) => withRuntimeState(rule, now));

  return {
    status: "trigger_settings_ready",
    rules,
    summary: summarizeRules(rules),
    userMessage: "자동 작동 설정을 불러왔습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function updateTriggerRule(input, options) {
  let now = nowIso(options);
  let nextRule;
  // 최신 설정을 대기열 안에서 읽고 이 규칙만 바꿔 저장한다.
  // 예전엔 두 규칙을 연달아 바꾸면 먼저 바꾼 규칙이 되돌아가거나, 파일이 깨지면
  // 켜 둔 자동화 규칙이 모두 기본값으로 돌아갔다.
  const vault = await mutateVault(options, (latest) => {
    now = nowIso(options);
    const ruleId = normalizeId(input.id);
    const existing =
      latest.rules.find((rule) => rule.id === ruleId) ??
      defaultTriggerRules.find((rule) => rule.id === ruleId);
    const baseRule = existing ?? { ...defaultTriggerRules[0], id: ruleId };
    nextRule = normalizeRule({ ...baseRule, ...input, id: baseRule.id }, now);
    // 켠 시각은 꺼짐 → 켜짐으로 바뀔 때만 새로 적는다. 메일 규칙을 처음(또는 다시) 켠 뒤 첫 점검에서
    // 켜기 전에 이미 와 있던 메일에 카드가 쏟아지지 않게 하는 기준이다.
    // 이미 켜져 있던 규칙의 다른 설정을 바꿀 때는 켠 시각을 새로 적지 않는다(예전 저장분처럼
    // 켠 시각이 없으면 없는 채로 둔다 — 그래야 밤새 쌓인 메일을 "켜기 전 메일"로 오인하지 않는다).
    if (!nextRule.enabled) {
      delete nextRule.enabledAt;
    } else if (!existing?.enabled) {
      nextRule.enabledAt = now;
    } else if (sanitizeIsoText(existing?.enabledAt)) {
      nextRule.enabledAt = sanitizeIsoText(existing.enabledAt);
    } else {
      delete nextRule.enabledAt;
    }

    latest.rules = [nextRule, ...latest.rules.filter((rule) => rule.id !== nextRule.id)].slice(0, 30);
    latest.updatedAt = now;
  });

  return {
    status: "trigger_rule_saved",
    rule: withRuntimeState(nextRule, now),
    summary: summarizeRules(vault.rules.map((rule) => withRuntimeState(rule, now))),
    userMessage: `${nextRule.label} 자동 작동 방식을 저장했습니다.`,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function resetTriggerSettings(options) {
  const now = nowIso(options);
  const vault = {
    version: 1,
    updatedAt: now,
    rules: defaultTriggerRules.map((rule) => normalizeRule(rule, now)),
  };
  await mutateVault(options, () => vault);
  return {
    status: "trigger_settings_reset",
    rules: vault.rules.map((rule) => withRuntimeState(rule, now)),
    summary: summarizeRules(vault.rules.map((rule) => withRuntimeState(rule, now))),
    userMessage: "자동 작동 설정을 기본값으로 되돌렸습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function normalizeRule(rule, now) {
  const mode = supportedModes.has(rule.mode) ? rule.mode : "polling";
  const cadenceMinutes = normalizeCadence(rule.cadenceMinutes, mode);
  const notifyPolicy = supportedNotifyPolicies.has(rule.notifyPolicy)
    ? rule.notifyPolicy
    : mode === "scheduled"
      ? "digest_only"
      : "important_only";
  const actionPolicy = supportedActionPolicies.has(rule.actionPolicy)
    ? rule.actionPolicy
    : notifyPolicy === "digest_only"
      ? "digest_report"
      : "queue_ai_review";

  return {
    id: normalizeId(rule.id),
    label: sanitizeText(rule.label, "자동 작동"),
    connectorId: normalizeConnectorId(rule.connectorId),
    sourceKind: sanitizeKind(rule.sourceKind, "business_inquiry"),
    triggerKind: sanitizeKind(rule.triggerKind, "inquiry_arrived"),
    mode,
    enabled: Boolean(rule.enabled),
    cadenceMinutes,
    notifyPolicy,
    actionPolicy,
    lastCursor: sanitizeOptionalText(rule.lastCursor),
    notificationChannels: normalizeNotificationChannels(rule.notificationChannels),
    // 선택 기능(기본 꺼짐): 새 업무 메일에 AI 답장 초안을 미리 써 둔다. 보내지는 않는다.
    aiReplyDrafts: rule.aiReplyDrafts === true,
    ...(Boolean(rule.enabled) && sanitizeIsoText(rule.enabledAt) ? { enabledAt: sanitizeIsoText(rule.enabledAt) } : {}),
    learningProfileSummary: sanitizeOptionalText(rule.learningProfileSummary),
    learningProfileEvidenceLabels: sanitizeLabelList(rule.learningProfileEvidenceLabels),
    learningProfileContract: sanitizeOptionalText(rule.learningProfileContract),
    learningProfilePersistPolicy: sanitizeOptionalText(rule.learningProfilePersistPolicy),
    createdAt: sanitizeOptionalText(rule.createdAt) || now,
    updatedAt: now,
    externalMutation: false,
    rawSecretMaterialStored: false,
  };
}

function normalizeNotificationChannels(value) {
  const channels = value && typeof value === "object" ? value : {};
  return {
    appInbox: channels.appInbox !== false,
    os: channels.os === true,
    telegram: channels.telegram === true,
  };
}

function withRuntimeState(rule, now) {
  const nextCheckAt = rule.enabled ? nextCheckIso(now, rule.cadenceMinutes) : null;
  const secureMailPolling = isSecureMailPollingRule(rule);
  return {
    ...rule,
    nextCheckAt,
    userVisibleMode: modeLabel(rule.mode),
    userVisibleSchedule: scheduleLabel(rule, nextCheckAt),
    safetyBoundary:
      "자동 작동 설정은 읽기, 내부 업무 카드, AI 초안/보고 후보까지만 허용합니다. 외부 발송, 등록, 결제, 삭제, 제출은 승인함 최종 확인 전 실행하지 않습니다.",
    ...(secureMailPolling
      ? {
          mailAutomationContract: "metadata_first_secret_blind_5m_polling_to_approval_queue",
          bodyPreviewPolicy: "important_candidate_limited_preview_after_noise_filter",
          secretHandlingContract: "credentialReferenceId_or_browserSessionReferenceId_only_no_raw_secret_returned",
        }
      : {}),
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function isSecureMailPollingRule(rule) {
  return (
    rule.id === "mail-polling-watch" ||
    rule.id === "local-rule-secure-mail-polling-5m" ||
    (rule.triggerKind === "mail_arrived" && rule.mode === "polling" && Number(rule.cadenceMinutes) === 5)
  );
}

function summarizeRules(rules) {
  const enabled = rules.filter((rule) => rule.enabled);
  const eventDriven = enabled.filter((rule) => rule.mode === "webhook").length;
  const polling = enabled.filter((rule) => rule.mode === "polling").length;
  const scheduled = enabled.filter((rule) => rule.mode === "scheduled").length;
  return {
    enabledCount: enabled.length,
    eventDrivenCount: eventDriven,
    pollingCount: polling,
    scheduledCount: scheduled,
    userMessage:
      enabled.length > 0
        ? `자동 작동 ${enabled.length}개가 켜져 있습니다. 즉시 ${eventDriven}개, 주기 ${polling}개, 요약 ${scheduled}개입니다.`
        : "켜진 자동 작동 설정이 없습니다.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function readVaultPath(options) {
  if (!options.app?.getPath) {
    throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  }
  return path.join(options.app.getPath("userData"), vaultFileName);
}

function parseSettingsFile(parsed, options) {
  if (!parsed || !Array.isArray(parsed.rules)) throw new Error("invalid_trigger_settings_shape");
  const now = nowIso(options);
  const normalizedRules = parsed.rules.map((rule) => normalizeRule(rule, now)).filter(Boolean);
  const existingIds = new Set(normalizedRules.map((rule) => rule.id));
  const missingDefaults = defaultTriggerRules
    .filter((rule) => !existingIds.has(rule.id))
    .map((rule) => normalizeRule(rule, now));
  return {
    version: 1,
    updatedAt: String(parsed.updatedAt ?? now),
    rules: [...normalizedRules, ...missingDefaults].slice(0, 30),
  };
}

function createDefaultSettings(options) {
  const now = nowIso(options);
  return {
    version: 1,
    updatedAt: now,
    rules: defaultTriggerRules.map((rule) => normalizeRule(rule, now)),
  };
}

async function readVault(options) {
  const filePath = readVaultPath(options);
  // 본 파일이 깨졌으면 직전 정상본(.previous)으로 읽는다.
  const loaded = await readJsonStore(filePath, { parse: (parsed) => parseSettingsFile(parsed, options) });
  if (loaded.status === "ok" || loaded.status === "recovered") return loaded.value;
  // Missing or invalid settings start from safe defaults. No secret material is stored here.
  return createDefaultSettings(options);
}

/** 설정 파일 대기열 안에서 최신 설정을 읽고 mutator 로 고친 뒤 원자적으로 저장한다. */
async function mutateVault(options, mutator) {
  return mutateJsonStore(
    readVaultPath(options),
    {
      parse: (parsed) => parseSettingsFile(parsed, options),
      empty: () => createDefaultSettings(options),
      onUnreadable: "reset",
    },
    mutator,
  );
}

function nowIso(options) {
  const value = typeof options.now === "function" ? options.now() : new Date();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function nextCheckIso(now, cadenceMinutes) {
  return new Date(new Date(now).getTime() + cadenceMinutes * 60_000).toISOString();
}

function normalizeCadence(value, mode) {
  const numeric = Number(value);
  if (allowedCadenceMinutes.includes(numeric)) return numeric;
  if (mode === "webhook") return 30;
  if (mode === "scheduled") return 1440;
  return 10;
}

function normalizeId(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,80}$/i.test(text) ? text : defaultTriggerRules[0].id;
}

function normalizeConnectorId(value) {
  const text = String(value ?? "").trim();
  return /^[a-z0-9][a-z0-9._-]{1,80}$/i.test(text) ? text : "generic-inquiry-site";
}

function sanitizeKind(value, fallback) {
  const text = String(value ?? "").trim();
  return /^[a-z0-9_:-]{2,64}$/i.test(text) ? text : fallback;
}

function sanitizeText(value, fallback) {
  const text = String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return text || fallback;
}

function sanitizeIsoText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function sanitizeOptionalText(value) {
  const text = sanitizeText(value, "");
  return text || undefined;
}

function sanitizeLabelList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => sanitizeText(item, "")).filter(Boolean))].slice(0, 8);
}

function modeLabel(mode) {
  if (mode === "webhook") return "오면 바로";
  if (mode === "scheduled") return "정해진 요약";
  return "주기 확인";
}

function scheduleLabel(rule, nextCheckAt) {
  if (!rule.enabled) return "꺼져 있습니다.";
  if (rule.mode === "webhook") {
    return `새 메시지나 문의가 오면 바로 받고, ${rule.cadenceMinutes}분마다 상태를 다시 확인합니다. 다음 확인 ${nextCheckAt}`;
  }
  if (rule.mode === "scheduled") {
    return `${rule.cadenceMinutes}분마다 요약 알림을 준비합니다. 다음 확인 ${nextCheckAt}`;
  }
  return `${rule.cadenceMinutes}분마다 새 메일, 문의, 변경을 확인합니다. 다음 확인 ${nextCheckAt}`;
}
