export type FolderPlanCollisionPolicy = "rename" | "skip";

export type FolderPlanApprovalOptions = {
  collisionPolicy: FolderPlanCollisionPolicy;
  excludedPathKeywords: string;
  sourceLabel?: string;
  createdAt?: number;
};

export const FOLDER_PLAN_APPROVAL_OPTIONS_STORAGE_KEY = "modycrew-folder-plan-approval-options-v1";

const handoffMaxAgeMs = 30 * 60 * 1000;

export function defaultFolderPlanApprovalOptions(): FolderPlanApprovalOptions {
  return {
    collisionPolicy: "rename",
    excludedPathKeywords: "",
    sourceLabel: "기본 안전 기준",
  };
}

export function folderPlanCollisionPolicyFromLabel(value = ""): FolderPlanCollisionPolicy {
  return /skip|건너/u.test(value) ? "skip" : "rename";
}

export function folderPlanCollisionPolicyLabel(policy?: string): string {
  if (policy === "skip") return "겹치면 건너뛰기";
  return "겹치면 이름 바꾸기";
}

export function parseFolderPlanExcludedKeywords(value = ""): string[] {
  return value
    .split(/[,\n]/u)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function normalizeFolderPlanApprovalOptions(input: Partial<FolderPlanApprovalOptions> = {}): FolderPlanApprovalOptions {
  return {
    collisionPolicy: input.collisionPolicy === "skip" ? "skip" : "rename",
    excludedPathKeywords: parseFolderPlanExcludedKeywords(input.excludedPathKeywords).join(", "),
    sourceLabel: input.sourceLabel?.trim() || "쉬운 세팅에서 고른 기준",
    createdAt: typeof input.createdAt === "number" ? input.createdAt : Date.now(),
  };
}

export function readFolderPlanApprovalOptionsHandoff(): FolderPlanApprovalOptions | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FOLDER_PLAN_APPROVAL_OPTIONS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FolderPlanApprovalOptions>;
    const normalized = normalizeFolderPlanApprovalOptions(parsed);
    const tooOld = normalized.createdAt ? Date.now() - normalized.createdAt > handoffMaxAgeMs : true;
    if (tooOld) {
      window.localStorage.removeItem(FOLDER_PLAN_APPROVAL_OPTIONS_STORAGE_KEY);
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function writeFolderPlanApprovalOptionsHandoff(options: Partial<FolderPlanApprovalOptions>): FolderPlanApprovalOptions | null {
  if (typeof window === "undefined") return null;
  try {
    const normalized = normalizeFolderPlanApprovalOptions({
      ...options,
      createdAt: Date.now(),
    });
    window.localStorage.setItem(FOLDER_PLAN_APPROVAL_OPTIONS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
}
