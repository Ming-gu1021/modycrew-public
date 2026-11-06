"use client";

import type { ModyWorkPackDefinition } from "@domain/work-pack";
import { saveLocalAutomationDraft, type LocalAutomationProvenance } from "./local-automation-drafts";
import { createLocalAutomationRuleFromDraft, readLocalAutomationRules } from "./local-automation-rules";

const STORAGE_KEY = "modycrew.workPackInstallations.v1";

export type WorkPackChecklistStatus = "needs_connection" | "needs_grant" | "ready";

export type WorkPackConnectorChecklistItem = {
  connectorId: string;
  label: string;
  purpose: string;
  setupHref: string;
  status: WorkPackChecklistStatus;
};

export type WorkPackKnowledgeChecklistItem = {
  id: string;
  label: string;
  purpose: string;
  status: WorkPackChecklistStatus;
};

export type WorkPackPreparedAutomationRule = {
  id: string;
  label: string;
  trigger: string;
  userVisibleSchedule: string;
  startsEnabled: false;
  localDraftId: string;
  localRuleId: string;
};

export type WorkPackPreparedApprovalRule = {
  id: string;
  label: string;
  appliesTo: string;
  finalUserApprovalRequired: true;
  enabled: true;
};

export type WorkPackInstallation = {
  packId: ModyWorkPackDefinition["id"];
  title: string;
  sourceContext?: LocalAutomationProvenance;
  installedAt: string;
  updatedAt: string;
  connectorChecklist: WorkPackConnectorChecklistItem[];
  knowledgeChecklist: WorkPackKnowledgeChecklistItem[];
  automationRules: WorkPackPreparedAutomationRule[];
  approvalRules: WorkPackPreparedApprovalRule[];
  draftIds: string[];
  ruleIds: string[];
  externalMutation: false;
  rawSecretMaterialStored: false;
};

export type WorkPackInstallResult = {
  installation: WorkPackInstallation;
  created: boolean;
};

export type WorkPackInstallContextInput = Omit<LocalAutomationProvenance, "capturedAt">;

export function readWorkPackInstallations(): WorkPackInstallation[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWorkPackInstallation).slice(0, 16);
  } catch {
    return [];
  }
}

export function installModyWorkPack(
  pack: ModyWorkPackDefinition,
  context?: WorkPackInstallContextInput,
): WorkPackInstallResult {
  const now = new Date().toISOString();
  const sourceContext = context ? createSourceContext(context, now) : undefined;
  const existing = readWorkPackInstallations().find((installation) => installation.packId === pack.id);
  if (existing) {
    const refreshed = {
      ...existing,
      sourceContext: sourceContext ?? existing.sourceContext,
      updatedAt: now,
    };
    writeWorkPackInstallations([
      refreshed,
      ...readWorkPackInstallations().filter((installation) => installation.packId !== pack.id),
    ]);
    return { installation: refreshed, created: false };
  }

  const preparedRules = pack.automationRules.map((automationRule) => {
    const draft = saveLocalAutomationDraft({
      title: `${pack.title}: ${automationRule.label}`,
      goal: pack.starterPrompt,
      trigger: `${automationRule.userVisibleSchedule} · ${triggerLabel(automationRule.trigger)}`,
      output: pack.visibleOutcome,
      approval: pack.approvalRules.map((rule) => rule.label).join(", "),
      connectorIds: pack.connectorRequirements.map((connector) => connector.connectorId),
      connectorLabels: pack.connectorRequirements.map((connector) => connector.label),
      provenance: sourceContext,
    });
    const localRule = createLocalAutomationRuleFromDraft(draft);
    return {
      id: automationRule.id,
      label: automationRule.label,
      trigger: automationRule.trigger,
      userVisibleSchedule: automationRule.userVisibleSchedule,
      startsEnabled: automationRule.startsEnabled,
      localDraftId: draft.id,
      localRuleId: localRule.id,
    };
  });

  const installation: WorkPackInstallation = {
    packId: pack.id,
    title: pack.title,
    sourceContext,
    installedAt: now,
    updatedAt: now,
    connectorChecklist: pack.connectorRequirements.map((connector) => ({
      connectorId: connector.connectorId,
      label: connector.label,
      purpose: connector.purpose,
      setupHref: connector.setupHref,
      status: "needs_connection",
    })),
    knowledgeChecklist: pack.knowledgeScopes.map((scope) => ({
      id: scope.id,
      label: scope.label,
      purpose: scope.purpose,
      status: "needs_grant",
    })),
    automationRules: preparedRules,
    approvalRules: pack.approvalRules.map((rule) => ({
      id: rule.id,
      label: rule.label,
      appliesTo: rule.appliesTo,
      finalUserApprovalRequired: rule.finalUserApprovalRequired,
      enabled: true,
    })),
    draftIds: preparedRules.map((rule) => rule.localDraftId),
    ruleIds: preparedRules.map((rule) => rule.localRuleId),
    externalMutation: false,
    rawSecretMaterialStored: false,
  };

  writeWorkPackInstallations([installation, ...readWorkPackInstallations()]);
  return { installation, created: true };
}

function createSourceContext(
  context: WorkPackInstallContextInput,
  capturedAt: string,
): LocalAutomationProvenance {
  return {
    source: context.source,
    sourceLabel: context.sourceLabel,
    intent: context.intent,
    evidenceLabels: context.evidenceLabels.slice(0, 5),
    confidencePercent: context.confidencePercent,
    capturedAt,
  };
}

function writeWorkPackInstallations(installations: WorkPackInstallation[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(installations.slice(0, 16)));
}

function triggerLabel(trigger: ModyWorkPackDefinition["automationRules"][number]["trigger"]) {
  if (trigger === "mail_received") return "메일/문의 수신";
  if (trigger === "calendar_changed") return "일정 변경";
  if (trigger === "file_added") return "파일 추가";
  if (trigger === "inventory_threshold") return "재고 기준 도달";
  return "정기 브리핑";
}

function isWorkPackInstallation(value: unknown): value is WorkPackInstallation {
  if (!value || typeof value !== "object") return false;
  const installation = value as Partial<WorkPackInstallation>;
  const existingRules = readLocalAutomationRules();
  return (
    typeof installation.packId === "string" &&
    typeof installation.title === "string" &&
    (installation.sourceContext === undefined || isLocalAutomationProvenance(installation.sourceContext)) &&
    typeof installation.installedAt === "string" &&
    typeof installation.updatedAt === "string" &&
    Array.isArray(installation.connectorChecklist) &&
    Array.isArray(installation.knowledgeChecklist) &&
    Array.isArray(installation.automationRules) &&
    Array.isArray(installation.approvalRules) &&
    Array.isArray(installation.draftIds) &&
    Array.isArray(installation.ruleIds) &&
    installation.externalMutation === false &&
    installation.rawSecretMaterialStored === false &&
    installation.ruleIds.every((ruleId) => existingRules.some((rule) => rule.id === ruleId))
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
    typeof provenance.capturedAt === "string"
  );
}
