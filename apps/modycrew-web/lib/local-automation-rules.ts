import type { LocalAutomationDraft, LocalAutomationProvenance } from "./local-automation-drafts";

const STORAGE_KEY = "modycrew.localAutomationRules.v1";

export type LocalAutomationRuleRunStats = {
  mode: "preview" | "desktop";
  checkedRules: number;
  createdWorkItems: number;
  approvalQueue: number;
  mailCandidates: number;
  ignoredMail?: number;
  calendarCandidates: number;
  attachmentCandidates?: number;
  webmailFallbackChecks?: number;
  webmailBodyPreviewAllowed?: number;
  webmailBodyPreviewSkipped?: number;
  providerReads: number;
  scheduleBriefings: number;
  messengerCommands: number;
  reportPath?: string;
  checkedAt?: string;
  status: string;
};

export type LocalAutomationNotificationChannels = {
  appInbox?: boolean;
  os?: boolean;
  telegram?: boolean;
};

export type LocalAutomationRule = {
  id: string;
  draftId: string;
  title: string;
  goal: string;
  trigger: string;
  output: string;
  approval: string;
  connectorIds: string[];
  connectorLabels: string[];
  provenance?: LocalAutomationProvenance;
  notificationChannels?: LocalAutomationNotificationChannels;
  enabled: boolean;
  mode: "manual" | "polling";
  cadenceMinutes: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  latestRunMessage?: string;
  latestRunStats?: LocalAutomationRuleRunStats;
};

export const SECURE_MAIL_POLLING_RULE_ID = "local-rule-secure-mail-polling-5m";

export function readLocalAutomationRules(): LocalAutomationRule[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalAutomationRule).slice(0, 12);
  } catch {
    return [];
  }
}

export function ensureSecureMailPollingRule(
  createdAt = new Date().toISOString(),
): { rule: LocalAutomationRule; created: boolean } {
  const existing = readLocalAutomationRules();
  const current = existing.find((rule) => rule.id === SECURE_MAIL_POLLING_RULE_ID);
  if (current) return { rule: current, created: false };

  const nextRule = createSecureMailPollingRule(createdAt);
  writeLocalAutomationRules([nextRule, ...existing].slice(0, 12));
  return { rule: nextRule, created: true };
}

export function createLocalAutomationRuleFromDraft(draft: LocalAutomationDraft): LocalAutomationRule {
  const existing = readLocalAutomationRules();
  const now = new Date().toISOString();
  const nextRule: LocalAutomationRule = {
    id: `local-rule-${draft.id.replace(/^local-automation-/, "")}`,
    draftId: draft.id,
    title: draft.title,
    goal: draft.goal,
    trigger: draft.trigger,
    output: draft.output,
    approval: draft.approval,
    connectorIds: draft.connectorIds,
    connectorLabels: draft.connectorLabels,
    provenance: draft.provenance,
    enabled: false,
    mode: "manual",
    cadenceMinutes: 30,
    createdAt: now,
    updatedAt: now,
    latestRunMessage: "반복 업무가 준비됐습니다. 사용자가 켜야 실제 점검을 시작합니다.",
  };
  const rules = [nextRule, ...existing.filter((rule) => rule.draftId !== draft.id)].slice(0, 12);
  writeLocalAutomationRules(rules);
  return nextRule;
}

function createSecureMailPollingRule(now: string): LocalAutomationRule {
  return {
    id: SECURE_MAIL_POLLING_RULE_ID,
    draftId: "local-automation-secure-mail-polling-5m",
    title: "메일 자동 점검",
    goal:
      "5분마다 메일함 메타데이터를 먼저 확인하고, IMAP이 없는 회사 웹메일은 보안 저장소/브라우저 세션 참조로 읽기 후보를 만든 뒤 광고/뉴스레터/스팸은 본문 없이 제외합니다.",
    trigger: "5분마다 새 메일 메타데이터 확인 또는 웹메일 읽기 후보 점검",
    output: "중요 메일 답장 초안, 미팅 후보, 첨부 정리 후보를 오피스 승인함에 보류",
    approval:
      "기본 도착지는 앱 승인함이며 휴대폰/메신저 알림은 사용자가 선택한 채널로만 요약을 보냅니다. 메일 발송, 캘린더 등록, 첨부 다운로드/이동은 사용자가 오피스 승인함에서 최종 승인하기 전 실행하지 않습니다.",
    connectorIds: ["custom-imap-mail", "company-webmail", "google-calendar"],
    connectorLabels: ["회사/일반 메일", "회사 웹메일", "캘린더"],
    provenance: {
      source: "work_pack",
      sourceLabel: "보안 메일 자동 점검",
      intent: "메일 5분 점검, 광고 선필터, 답장/일정/첨부 후보 승인",
      evidenceLabels: [
        "metadata_first_secret_blind_mail_intake",
        "webmail_login_reference_to_metadata_scan_to_approval_queue",
        "credentialReferenceId only",
        "browserSessionReferenceId only when IMAP is unavailable",
        "default off until user enables",
        "app inbox first",
        "external notification user selected only",
        "approvalQueue before send calendar file mutation",
      ],
      confidencePercent: 92,
      capturedAt: now,
    },
    notificationChannels: {
      appInbox: true,
      os: false,
      telegram: false,
    },
    enabled: false,
    mode: "polling",
    cadenceMinutes: 5,
    createdAt: now,
    updatedAt: now,
    latestRunMessage:
      "5분 메일 점검 후보가 준비됐습니다. 사용자가 켠 뒤에만 읽기 전용 점검 대상에 포함됩니다.",
  };
}

export function toggleLocalAutomationRule(ruleId: string): LocalAutomationRule[] {
  const rules = readLocalAutomationRules().map((rule) =>
    rule.id === ruleId
      ? { ...rule, enabled: !rule.enabled, updatedAt: new Date().toISOString() }
      : rule,
  );
  writeLocalAutomationRules(rules);
  return rules;
}

export function updateLocalAutomationRule(
  ruleId: string,
  patch: Partial<
    Pick<
      LocalAutomationRule,
      | "title"
      | "goal"
      | "trigger"
      | "output"
      | "approval"
      | "connectorIds"
      | "connectorLabels"
      | "provenance"
      | "notificationChannels"
      | "enabled"
      | "latestRunMessage"
    >
  >,
): LocalAutomationRule[] {
  const rules = readLocalAutomationRules().map((rule) =>
    rule.id === ruleId
      ? { ...rule, ...patch, updatedAt: new Date().toISOString() }
      : rule,
  );
  writeLocalAutomationRules(rules);
  return rules;
}

export function deleteLocalAutomationRule(ruleId: string): LocalAutomationRule[] {
  const rules = readLocalAutomationRules().filter((rule) => rule.id !== ruleId);
  writeLocalAutomationRules(rules);
  return rules;
}

export function markLocalAutomationRuleRun(
  ruleId: string,
  message: string,
  stats?: LocalAutomationRuleRunStats,
): LocalAutomationRule[] {
  const now = new Date().toISOString();
  const rules = readLocalAutomationRules().map((rule) =>
    rule.id === ruleId
      ? { ...rule, lastRunAt: now, latestRunMessage: message, latestRunStats: stats, updatedAt: now }
      : rule,
  );
  writeLocalAutomationRules(rules);
  return rules;
}

function writeLocalAutomationRules(rules: LocalAutomationRule[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules.slice(0, 12)));
}

function isLocalAutomationRule(value: unknown): value is LocalAutomationRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Partial<LocalAutomationRule>;
  return (
    typeof rule.id === "string" &&
    typeof rule.draftId === "string" &&
    typeof rule.title === "string" &&
    typeof rule.goal === "string" &&
    typeof rule.trigger === "string" &&
    typeof rule.output === "string" &&
    typeof rule.approval === "string" &&
    Array.isArray(rule.connectorIds) &&
    Array.isArray(rule.connectorLabels) &&
    (rule.provenance === undefined || isLocalAutomationProvenance(rule.provenance)) &&
    (rule.notificationChannels === undefined || isLocalAutomationNotificationChannels(rule.notificationChannels)) &&
    typeof rule.enabled === "boolean" &&
    (rule.mode === "manual" || rule.mode === "polling") &&
    typeof rule.cadenceMinutes === "number" &&
    typeof rule.createdAt === "string" &&
    typeof rule.updatedAt === "string" &&
    (rule.latestRunStats === undefined || isLocalAutomationRuleRunStats(rule.latestRunStats))
  );
}

function isLocalAutomationNotificationChannels(value: unknown): value is LocalAutomationNotificationChannels {
  if (!value || typeof value !== "object") return false;
  const channels = value as LocalAutomationNotificationChannels;
  return (
    (channels.appInbox === undefined || typeof channels.appInbox === "boolean") &&
    (channels.os === undefined || typeof channels.os === "boolean") &&
    (channels.telegram === undefined || typeof channels.telegram === "boolean")
  );
}

function isLocalAutomationProvenance(value: unknown): value is LocalAutomationProvenance {
  if (!value || typeof value !== "object") return false;
  const provenance = value as Partial<LocalAutomationProvenance>;
  return (
    (provenance.source === "document_learning_recommendation" || provenance.source === "work_pack") &&
    typeof provenance.sourceLabel === "string" &&
    typeof provenance.intent === "string" &&
    Array.isArray(provenance.evidenceLabels) &&
    provenance.evidenceLabels.every((label) => typeof label === "string") &&
    (provenance.confidencePercent === undefined || typeof provenance.confidencePercent === "number") &&
    (provenance.teammateId === undefined || typeof provenance.teammateId === "string") &&
    typeof provenance.capturedAt === "string"
  );
}

function isLocalAutomationRuleRunStats(value: unknown): value is LocalAutomationRuleRunStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as Partial<LocalAutomationRuleRunStats>;
  return (
    (stats.mode === "preview" || stats.mode === "desktop") &&
    typeof stats.checkedRules === "number" &&
    typeof stats.createdWorkItems === "number" &&
    typeof stats.approvalQueue === "number" &&
    typeof stats.mailCandidates === "number" &&
    (stats.ignoredMail === undefined || typeof stats.ignoredMail === "number") &&
    typeof stats.calendarCandidates === "number" &&
    (stats.attachmentCandidates === undefined || typeof stats.attachmentCandidates === "number") &&
    (stats.webmailFallbackChecks === undefined || typeof stats.webmailFallbackChecks === "number") &&
    (stats.webmailBodyPreviewAllowed === undefined || typeof stats.webmailBodyPreviewAllowed === "number") &&
    (stats.webmailBodyPreviewSkipped === undefined || typeof stats.webmailBodyPreviewSkipped === "number") &&
    typeof stats.providerReads === "number" &&
    typeof stats.scheduleBriefings === "number" &&
    typeof stats.messengerCommands === "number" &&
    (stats.reportPath === undefined || typeof stats.reportPath === "string") &&
    (stats.checkedAt === undefined || typeof stats.checkedAt === "string") &&
    typeof stats.status === "string"
  );
}
