// 직원(AI 팀원)별 "맡은 폴더" 작업 공간 기록.
// 어떤 직원이 어떤 위치를 담당해 읽고 학습했는지만 저장하며,
// 원본 폴더/파일은 이동·삭제하지 않고 경로와 라벨 같은 메타데이터만 기억합니다.

const STORAGE_KEY = "modycrew-teammate-workspaces-v1";
const MAX_TEAMMATES = 24;
const MAX_FOLDERS_PER_TEAMMATE = 8;
const MAX_PATH_LENGTH = 260;
const MAX_LABEL_LENGTH = 60;

export type TeammateWorkspaceFolder = {
  id: string;
  path: string;
  label: string;
  sourceKind?: string;
  fileCount?: number;
  assignedAt: string;
  lastScannedAt?: string;
};

export type TeammateWorkspace = {
  teammateId: string;
  folders: TeammateWorkspaceFolder[];
  learnedFileCount: number;
  lastLearnedAt?: string;
  updatedAt: string;
};

export type TeammateWorkspaceFolderInput = {
  path: string;
  label?: string;
  sourceKind?: string;
  fileCount?: number;
};

function clampText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function folderLabelFromPath(path: string): string {
  const segments = path.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function sanitizeFolder(value: unknown): TeammateWorkspaceFolder | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<TeammateWorkspaceFolder>;
  const path = clampText(record.path, MAX_PATH_LENGTH);
  if (!path) return null;
  return {
    id: clampText(record.id, 80) || `workspace-folder-${path}`,
    path,
    label: clampText(record.label, MAX_LABEL_LENGTH) || folderLabelFromPath(path),
    sourceKind: clampText(record.sourceKind, 24) || undefined,
    fileCount: typeof record.fileCount === "number" && Number.isFinite(record.fileCount)
      ? Math.max(0, Math.floor(record.fileCount))
      : undefined,
    assignedAt: clampText(record.assignedAt, 40) || new Date().toISOString(),
    lastScannedAt: clampText(record.lastScannedAt, 40) || undefined,
  };
}

function sanitizeWorkspace(value: unknown): TeammateWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<TeammateWorkspace>;
  const teammateId = clampText(record.teammateId, 80);
  if (!teammateId) return null;
  const folders = Array.isArray(record.folders)
    ? record.folders
        .map(sanitizeFolder)
        .filter((folder): folder is TeammateWorkspaceFolder => Boolean(folder))
        .slice(0, MAX_FOLDERS_PER_TEAMMATE)
    : [];
  return {
    teammateId,
    folders,
    learnedFileCount:
      typeof record.learnedFileCount === "number" && Number.isFinite(record.learnedFileCount)
        ? Math.max(0, Math.floor(record.learnedFileCount))
        : 0,
    lastLearnedAt: clampText(record.lastLearnedAt, 40) || undefined,
    updatedAt: clampText(record.updatedAt, 40) || new Date().toISOString(),
  };
}

export function readTeammateWorkspaces(): Record<string, TeammateWorkspace> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const entries = Object.values(parsed as Record<string, unknown>)
      .map(sanitizeWorkspace)
      .filter((workspace): workspace is TeammateWorkspace => Boolean(workspace))
      .slice(0, MAX_TEAMMATES);
    return Object.fromEntries(entries.map((workspace) => [workspace.teammateId, workspace]));
  } catch {
    return {};
  }
}

function writeTeammateWorkspaces(workspaces: Record<string, TeammateWorkspace>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
  } catch {
    // 저장 실패는 화면 동작을 막지 않습니다. 다음 지정 때 다시 저장을 시도합니다.
  }
}

export function getTeammateWorkspace(teammateId: string): TeammateWorkspace | undefined {
  return readTeammateWorkspaces()[teammateId];
}

export function upsertTeammateWorkspaceFolders(
  teammateId: string,
  inputs: TeammateWorkspaceFolderInput[],
): TeammateWorkspace {
  const now = new Date().toISOString();
  const workspaces = readTeammateWorkspaces();
  const existing = workspaces[teammateId] ?? {
    teammateId,
    folders: [],
    learnedFileCount: 0,
    updatedAt: now,
  };
  const merged = [...existing.folders];
  for (const input of inputs) {
    const path = clampText(input.path, MAX_PATH_LENGTH);
    if (!path) continue;
    const previous = merged.find((folder) => folder.path === path);
    const nextFolder: TeammateWorkspaceFolder = {
      id: previous?.id ?? `workspace-folder-${teammateId}-${merged.length}-${Date.now()}`,
      path,
      label: clampText(input.label, MAX_LABEL_LENGTH) || previous?.label || folderLabelFromPath(path),
      sourceKind: clampText(input.sourceKind, 24) || previous?.sourceKind,
      fileCount:
        typeof input.fileCount === "number" && Number.isFinite(input.fileCount)
          ? Math.max(0, Math.floor(input.fileCount))
          : previous?.fileCount,
      assignedAt: previous?.assignedAt ?? now,
      lastScannedAt: now,
    };
    if (previous) {
      merged[merged.indexOf(previous)] = nextFolder;
    } else {
      merged.push(nextFolder);
    }
  }
  const nextWorkspace: TeammateWorkspace = {
    ...existing,
    folders: merged.slice(-MAX_FOLDERS_PER_TEAMMATE),
    updatedAt: now,
  };
  workspaces[teammateId] = nextWorkspace;
  writeTeammateWorkspaces(workspaces);
  return nextWorkspace;
}

export function recordTeammateWorkspaceLearning(
  teammateId: string,
  input: { learnedFileCount: number },
): TeammateWorkspace | undefined {
  const workspaces = readTeammateWorkspaces();
  const existing = workspaces[teammateId];
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const nextWorkspace: TeammateWorkspace = {
    ...existing,
    learnedFileCount: Math.max(0, Math.floor(input.learnedFileCount)),
    lastLearnedAt: now,
    folders: existing.folders.map((folder) => ({ ...folder, lastScannedAt: now })),
    updatedAt: now,
  };
  workspaces[teammateId] = nextWorkspace;
  writeTeammateWorkspaces(workspaces);
  return nextWorkspace;
}

export function removeTeammateWorkspaceFolder(
  teammateId: string,
  folderId: string,
): TeammateWorkspace | undefined {
  const workspaces = readTeammateWorkspaces();
  const existing = workspaces[teammateId];
  if (!existing) return undefined;
  const nextWorkspace: TeammateWorkspace = {
    ...existing,
    folders: existing.folders.filter((folder) => folder.id !== folderId),
    updatedAt: new Date().toISOString(),
  };
  workspaces[teammateId] = nextWorkspace;
  writeTeammateWorkspaces(workspaces);
  return nextWorkspace;
}

export function removeTeammateWorkspace(teammateId: string) {
  const workspaces = readTeammateWorkspaces();
  if (!workspaces[teammateId]) return;
  delete workspaces[teammateId];
  writeTeammateWorkspaces(workspaces);
}
