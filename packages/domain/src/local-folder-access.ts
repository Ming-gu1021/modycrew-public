import { ModyDesktopBridge } from "./desktop-bridge.js";
import type { ModyDesktopPlatform } from "./desktop-bridge.js";
import type {
  ModyLocalFileIndex,
  ModyLocalFileKind,
  ModyLocalFileRecord,
} from "./local-file-index.js";
import type {
  ISODateTimeString,
  ToolActionRequest,
  ToolRiskLabel,
} from "./types.js";

export type ModyAllowedFolderPermission = "read_only" | "read_write";
export type ModyAllowedFolderStatus = "needs_permission" | "allowed" | "disconnected";

export type ModyAllowedFolder = {
  id: string;
  workspaceId?: string;
  displayName: string;
  absolutePath: string;
  platform: ModyDesktopPlatform;
  permission: ModyAllowedFolderPermission;
  status: ModyAllowedFolderStatus;
  createdAt: ISODateTimeString;
  lastScannedAt?: ISODateTimeString;
};

export type ModyLocalFolderFileCandidate = {
  id: string;
  relativePath: string;
  title?: string;
  kind?: ModyLocalFileKind;
  tags?: string[];
  summary?: string;
  riskLabel?: ToolRiskLabel;
};

export type ModyRejectedFolderCandidate = {
  candidate: ModyLocalFolderFileCandidate;
  reason: string;
};

export type ModyLocalFolderIndexResult = {
  folder: ModyAllowedFolder;
  indexedFiles: ModyLocalFileRecord[];
  rejectedFiles: ModyRejectedFolderCandidate[];
};

export class ModyLocalFolderAccess {
  readonly #desktopBridge: ModyDesktopBridge;

  constructor(desktopBridge = new ModyDesktopBridge()) {
    this.#desktopBridge = desktopBridge;
  }

  createWatchRequest(folder: ModyAllowedFolder, createdAt = folder.createdAt): ToolActionRequest {
    return this.#desktopBridge.createActionRequest({
      id: `local_folder_watch_${folder.id}`,
      platform: folder.platform,
      capability: "watch_folder",
      targetPath: folder.absolutePath,
      inputSummary: `folder=${folder.displayName}; permission=${folder.permission}; status=${folder.status}`,
      userVisibleDescription: `${folder.displayName} 폴더의 새 업무 자료를 감지합니다.`,
      createdAt,
    });
  }

  indexAllowedFolder(
    folder: ModyAllowedFolder,
    candidates: ModyLocalFolderFileCandidate[],
    index: ModyLocalFileIndex,
    indexedAt: ISODateTimeString,
  ): ModyLocalFolderIndexResult {
    if (folder.status !== "allowed") {
      throw new Error("허용된 폴더만 로컬 파일 인덱스에 반영할 수 있습니다.");
    }

    const indexedFiles: ModyLocalFileRecord[] = [];
    const rejectedFiles: ModyRejectedFolderCandidate[] = [];

    for (const candidate of candidates) {
      if (isUnsafeRelativePath(candidate.relativePath)) {
        rejectedFiles.push({
          candidate,
          reason: "허용 폴더 밖으로 나가는 상대 경로는 인덱싱하지 않습니다.",
        });
        continue;
      }

      const file = buildFileRecord(folder, candidate, indexedAt);
      indexedFiles.push(index.indexFile(file));
    }

    return {
      folder,
      indexedFiles,
      rejectedFiles,
    };
  }
}

function buildFileRecord(
  folder: ModyAllowedFolder,
  candidate: ModyLocalFolderFileCandidate,
  indexedAt: ISODateTimeString,
): ModyLocalFileRecord {
  const absolutePath = joinFolderPath(folder, candidate.relativePath);
  const file: ModyLocalFileRecord = {
    id: candidate.id,
    title: candidate.title ?? titleFromPath(candidate.relativePath),
    absolutePath,
    kind: candidate.kind ?? inferKind(candidate.relativePath),
    sourceFolder: folder.absolutePath,
    tags: candidate.tags ?? [],
    riskLabel: candidate.riskLabel ?? "low",
    indexedAt,
  };

  if (folder.workspaceId) file.workspaceId = folder.workspaceId;
  if (candidate.summary) file.summary = candidate.summary;

  return file;
}

function isUnsafeRelativePath(relativePath: string): boolean {
  const normalized = relativePath.trim().replaceAll("\\", "/");
  if (normalized.length === 0) return true;
  if (normalized.startsWith("/") || normalized.startsWith("~")) return true;
  if (/^[a-zA-Z]:/.test(normalized)) return true;
  return normalized.split("/").includes("..");
}

function joinFolderPath(folder: ModyAllowedFolder, relativePath: string): string {
  const separator = folder.platform === "windows" ? "\\" : "/";
  const normalizedFolder = folder.absolutePath.replace(/[\\/]+$/, "");
  const normalizedRelative = relativePath.trim().replace(/[\\/]+/g, separator);
  return `${normalizedFolder}${separator}${normalizedRelative}`;
}

function titleFromPath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").split("/").pop() ?? relativePath;
}

function inferKind(relativePath: string): ModyLocalFileKind {
  const extension = (relativePath.split(".").pop() ?? "").toLocaleLowerCase("ko-KR");
  if (["xlsx", "xls", "csv"].includes(extension)) return "spreadsheet";
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  if (["md", "txt", "doc", "docx", "hwp"].includes(extension)) return "document";
  return "other";
}
