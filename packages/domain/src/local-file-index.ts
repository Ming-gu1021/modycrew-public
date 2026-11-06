import { ModyDesktopBridge } from "./desktop-bridge.js";
import type { ModyDesktopPlatform } from "./desktop-bridge.js";
import type {
  ISODateTimeString,
  ToolActionRequest,
  ToolRiskLabel,
} from "./types.js";

export type ModyLocalFileKind =
  | "document"
  | "spreadsheet"
  | "pdf"
  | "image"
  | "folder"
  | "other";

export type ModyLocalFileRecord = {
  id: string;
  workspaceId?: string;
  title: string;
  absolutePath: string;
  kind: ModyLocalFileKind;
  sourceFolder?: string;
  tags: string[];
  summary?: string;
  riskLabel: ToolRiskLabel;
  indexedAt: ISODateTimeString;
  lastOpenedAt?: ISODateTimeString;
};

export type ModyLocalFileSearchOptions = {
  workspaceId?: string;
  topK?: number;
  platform?: ModyDesktopPlatform;
  createdAt?: ISODateTimeString;
};

export type ModyLocalFileSearchHit = {
  file: ModyLocalFileRecord;
  score: number;
  matchedTerms: string[];
  openAction: ToolActionRequest;
};

export class ModyLocalFileIndex {
  readonly #files = new Map<string, ModyLocalFileRecord>();
  readonly #desktopBridge: ModyDesktopBridge;

  constructor(desktopBridge = new ModyDesktopBridge()) {
    this.#desktopBridge = desktopBridge;
  }

  indexFile(file: ModyLocalFileRecord): ModyLocalFileRecord {
    if (!file.absolutePath.trim()) {
      throw new Error("로컬 파일 인덱스에는 absolutePath가 필요합니다.");
    }

    if (!file.title.trim()) {
      throw new Error("로컬 파일 인덱스에는 title이 필요합니다.");
    }

    this.#files.set(file.id, file);
    return file;
  }

  search(query: string, options: ModyLocalFileSearchOptions = {}): ModyLocalFileSearchHit[] {
    const terms = normalizeSearchTerms(query);
    if (terms.length === 0) return [];

    const topK = options.topK ?? 8;
    const hits: ModyLocalFileSearchHit[] = [];

    for (const file of this.#files.values()) {
      if (options.workspaceId && file.workspaceId !== options.workspaceId) continue;

      const searchableText = normalizeText([
        file.title,
        file.absolutePath,
        file.sourceFolder ?? "",
        file.summary ?? "",
        ...file.tags,
      ].join(" "));
      const matchedTerms = terms.filter((term) => searchableText.includes(term));
      if (matchedTerms.length === 0) continue;

      hits.push({
        file,
        score: scoreFileHit(file, matchedTerms),
        matchedTerms,
        openAction: this.createOpenRequest(file, options),
      });
    }

    return hits
      .sort((left, right) => right.score - left.score || left.file.title.localeCompare(right.file.title, "ko-KR"))
      .slice(0, topK);
  }

  createOpenRequest(
    file: ModyLocalFileRecord,
    options: Pick<ModyLocalFileSearchOptions, "platform" | "createdAt"> = {},
  ): ToolActionRequest {
    return this.#desktopBridge.createActionRequest({
      id: `local_file_open_${file.id}`,
      platform: options.platform ?? "windows",
      capability: "open_local_file",
      targetPath: file.absolutePath,
      inputSummary: `title=${file.title}; kind=${file.kind}; risk=${file.riskLabel}`,
      userVisibleDescription: `${file.title} 파일을 엽니다.`,
      createdAt: options.createdAt ?? new Date().toISOString(),
    });
  }
}

function normalizeSearchTerms(query: string): string[] {
  return Array.from(
    new Set(
      normalizeText(query)
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  );
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase("ko-KR");
}

function scoreFileHit(file: ModyLocalFileRecord, matchedTerms: string[]): number {
  const titleText = normalizeText(file.title);
  const tagText = normalizeText(file.tags.join(" "));
  const pathText = normalizeText(file.absolutePath);

  let score = matchedTerms.length * 10;
  for (const term of matchedTerms) {
    if (titleText.includes(term)) score += 8;
    if (tagText.includes(term)) score += 5;
    if (pathText.includes(term)) score += 2;
  }

  if (file.riskLabel === "low") score += 1;
  return score;
}
