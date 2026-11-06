import type { WorkItem } from "./types";

const STORAGE_KEY = "modycrew.localAutomationDrafts.v1";

export type LocalAutomationDraft = {
  id: string;
  title: string;
  goal: string;
  trigger: string;
  output: string;
  approval: string;
  connectorIds: string[];
  connectorLabels: string[];
  provenance?: LocalAutomationProvenance;
  createdAt: string;
  status: "draft";
};

export type LocalAutomationProvenance = {
  source: "document_learning_recommendation" | "work_pack";
  sourceLabel: string;
  intent: string;
  evidenceLabels: string[];
  confidencePercent?: number;
  capturedAt: string;
  /** 이 자동화를 담당하는 AI 직원(학습 기반 자동 생성 직원 귀속용) */
  teammateId?: string;
};

export type LocalAutomationDraftInput = Omit<LocalAutomationDraft, "id" | "createdAt" | "status">;

export function readLocalAutomationDrafts(): LocalAutomationDraft[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalAutomationDraft).slice(0, 12);
  } catch {
    return [];
  }
}

export function saveLocalAutomationDraft(input: LocalAutomationDraftInput): LocalAutomationDraft {
  const nextDraft: LocalAutomationDraft = {
    ...input,
    id: createDraftId(),
    createdAt: new Date().toISOString(),
    status: "draft",
  };
  const drafts = [nextDraft, ...readLocalAutomationDrafts()].slice(0, 12);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  return nextDraft;
}

export function localAutomationDraftToWorkItem(draft: LocalAutomationDraft): WorkItem {
  const provenanceLines = draft.provenance
    ? [
        `출처: ${draft.provenance.sourceLabel}`,
        `추천 근거: ${draft.provenance.intent}`,
        draft.provenance.evidenceLabels.length
          ? `근거 자료: ${draft.provenance.evidenceLabels.join(", ")}`
          : null,
        typeof draft.provenance.confidencePercent === "number"
          ? `추천 신뢰도: ${draft.provenance.confidencePercent}%`
          : null,
      ].filter((line): line is string => Boolean(line))
    : [];

  return {
    id: draft.id,
    title: draft.title,
    source: "manual_input",
    sourceLabel: draft.provenance?.sourceLabel ?? "로컬 자동화 초안",
    senderLabel: "ModyCrew",
    body: draft.goal,
    summary: `${draft.trigger} → ${draft.output}`,
    status: "approval_pending",
    riskLabel: "medium",
    riskSignals: [
      {
        id: `${draft.id}:approval`,
        label: "승인 필요",
        riskLabel: "medium",
        reason: draft.approval,
      },
    ],
    receivedAt: draft.createdAt,
    sourceEvidence: draft.provenance
      ? {
          connectorId: draft.connectorIds[0] ?? "local-folder",
          providerId: "document_learning",
          mailboxLabel: draft.provenance.sourceLabel,
          messageSubject: draft.provenance.intent,
          senderPreview: draft.provenance.evidenceLabels[0] ?? draft.provenance.sourceLabel,
          receivedAt: draft.provenance.capturedAt,
          messageSnippet: draft.provenance.evidenceLabels.join(", "),
          detectedIntentLabels: [draft.title, draft.output].filter(Boolean),
          approvalCandidateLabels: [draft.approval].filter(Boolean),
          rawSecretMaterialStored: false,
          rawSecretMaterialReturned: false,
        }
      : undefined,
    draft: {
      id: `${draft.id}:draft`,
      toneLabel: "자동화 초안",
      body: [
        `목표: ${draft.goal}`,
        `감지: ${draft.trigger}`,
        `결과: ${draft.output}`,
        `승인: ${draft.approval}`,
        `필요 연결: ${draft.connectorLabels.join(", ")}`,
        ...provenanceLines,
      ].join("\n"),
      operationKind: "stage_approval",
      requiresApprovalBeforeSend: true,
    },
  };
}

function createDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `local-automation-${crypto.randomUUID()}`;
  }
  return `local-automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isLocalAutomationDraft(value: unknown): value is LocalAutomationDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<LocalAutomationDraft>;
  return (
    typeof draft.id === "string" &&
    typeof draft.title === "string" &&
    typeof draft.goal === "string" &&
    typeof draft.trigger === "string" &&
    typeof draft.output === "string" &&
    typeof draft.approval === "string" &&
    Array.isArray(draft.connectorIds) &&
    Array.isArray(draft.connectorLabels) &&
    (draft.provenance === undefined || isLocalAutomationProvenance(draft.provenance)) &&
    typeof draft.createdAt === "string" &&
    draft.status === "draft"
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
