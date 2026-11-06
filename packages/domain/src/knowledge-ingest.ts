import type {
  IngestedDocument,
  IngestedKnowledgeRecord,
  ISODateTimeString,
  KnowledgeChunk,
  KnowledgeRetrievalHit,
  KnowledgeRiskSignal,
  KnowledgeSource,
  KnowledgeSourceMetadata,
  RagCitation,
  RagContext,
  RetentionPolicy,
  ToolRiskLabel,
} from "./types.js";

export type KnowledgeIngestInput = {
  id?: string;
  workspaceId?: string;
  source: KnowledgeSource;
  title: string;
  sourceUri?: string;
  originalFileName?: string;
  mimeType?: string;
  connectorName?: string;
  mailboxId?: string;
  messageId?: string;
  calendarEventId?: string;
  webCanonicalUrl?: string;
  fileSizeBytes?: number;
  receivedAt?: ISODateTimeString;
  sourceMetadata?: Partial<KnowledgeSourceMetadata>;
  contentHash?: string;
  extractedText?: string;
  retentionPolicy?: RetentionPolicy;
  createdAt?: ISODateTimeString;
};

export type KnowledgeIngestResult = {
  record: IngestedKnowledgeRecord;
  isDuplicate: boolean;
  duplicateOfDocumentId?: string;
};

export type KnowledgeSearchOptions = {
  topK?: number;
  workspaceId?: string;
};

export class ModyKnowledgeIngest {
  private readonly records = new Map<string, IngestedKnowledgeRecord>();
  private readonly hashIndex = new Map<string, string>();
  private sequence = 0;

  ingest(input: KnowledgeIngestInput): KnowledgeIngestResult {
    const id = input.id ?? `doc_${++this.sequence}`;
    const workspaceId = input.workspaceId ?? "default_workspace";
    const sourceMetadata = createSourceMetadata(input);
    const contentHash = input.contentHash ?? hashText(input.extractedText ?? "");
    const hashIndexKey = contentHash ? createHashIndexKey(workspaceId, contentHash) : undefined;
    const duplicateOfDocumentId = hashIndexKey ? this.hashIndex.get(hashIndexKey) : undefined;
    const extractedTextReady = Boolean(input.extractedText && input.extractedText.trim().length > 0);
    const riskSignals = extractedTextReady ? detectKnowledgeRiskSignals(input.extractedText ?? "") : [];
    const document: IngestedDocument = {
      id,
      workspaceId,
      source: input.source,
      sourceMetadata,
      title: input.title,
      extractedTextStatus: extractedTextReady ? "ready" : "pending",
      summaryStatus: "not_started",
      embeddingStatus: "not_started",
      retentionPolicy: input.retentionPolicy ?? "workspace_default",
      riskSignals,
      riskLabel: getHighestRiskLabel(riskSignals),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    if (contentHash) {
      document.contentHash = contentHash;
    }

    if (sourceMetadata.sourceUri) {
      document.sourceUri = sourceMetadata.sourceUri;
    }

    if (sourceMetadata.originalFileName) {
      document.originalFileName = sourceMetadata.originalFileName;
    }

    const record: IngestedKnowledgeRecord = {
      document,
      chunks: extractedTextReady ? createChunks(document, input.extractedText ?? "") : [],
    };

    if (input.extractedText) {
      record.extractedText = input.extractedText;
    }

    if (duplicateOfDocumentId) {
      record.duplicateOfDocumentId = duplicateOfDocumentId;
    } else if (hashIndexKey) {
      this.hashIndex.set(hashIndexKey, id);
    }

    this.records.set(id, record);

    const result: KnowledgeIngestResult = {
      record,
      isDuplicate: Boolean(duplicateOfDocumentId),
    };

    if (duplicateOfDocumentId) {
      result.duplicateOfDocumentId = duplicateOfDocumentId;
    }

    return result;
  }

  markExtractionReady(documentId: string, extractedText: string): IngestedKnowledgeRecord {
    const record = this.getRecordOrThrow(documentId);
    const normalizedText = extractedText.trim();

    if (!normalizedText) {
      throw new Error("추출 텍스트가 비어 있습니다.");
    }

    const riskSignals = detectKnowledgeRiskSignals(normalizedText);
    record.extractedText = normalizedText;
    record.chunks = createChunks(record.document, normalizedText);
    delete record.failureReason;
    delete record.document.extractionFailure;
    record.document.extractedTextStatus = "ready";
    record.document.summaryStatus = "not_started";
    record.document.embeddingStatus = "not_started";
    record.document.riskSignals = riskSignals;
    record.document.riskLabel = getHighestRiskLabel(riskSignals);

    if (!record.document.contentHash) {
      const contentHash = hashText(normalizedText);
      if (contentHash) {
        record.document.contentHash = contentHash;
        this.hashIndex.set(createHashIndexKey(record.document.workspaceId ?? "default_workspace", contentHash), documentId);
      }
    }

    return record;
  }

  markExtractionFailed(
    documentId: string,
    reason: string,
    options: { retryable?: boolean; failedAt?: ISODateTimeString } = {},
  ): IngestedKnowledgeRecord {
    const record = this.getRecordOrThrow(documentId);
    record.document.extractedTextStatus = "failed";
    record.document.summaryStatus = "failed";
    record.document.embeddingStatus = "failed";
    record.document.extractionFailure = {
      reason,
      retryable: options.retryable ?? true,
      failedAt: options.failedAt ?? new Date().toISOString(),
    };
    record.chunks = [];
    delete record.extractedText;
    record.failureReason = reason;
    return record;
  }

  search(query: string, options: KnowledgeSearchOptions = {}): KnowledgeRetrievalHit[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return [];
    }

    const hits: KnowledgeRetrievalHit[] = [];

    for (const record of this.records.values()) {
      if (options.workspaceId && record.document.workspaceId !== options.workspaceId) {
        continue;
      }

      if (record.document.extractedTextStatus !== "ready") {
        continue;
      }

      const titleTerms = tokenize(record.document.title);

      for (const chunk of record.chunks) {
        const chunkTerms = new Set(tokenize(`${record.document.title} ${chunk.text}`));
        const matchedTerms = queryTerms.filter((term) => chunkTerms.has(term));

        if (matchedTerms.length === 0) {
          continue;
        }

        const titleBonus = queryTerms.some((term) => titleTerms.includes(term)) ? 0.25 : 0;
        hits.push({
          document: record.document,
          chunk,
          score: matchedTerms.length / queryTerms.length + titleBonus,
          matchedTerms,
          citationLabel: `${record.document.title} #${chunk.order}`,
        });
      }
    }

    return hits
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, options.topK ?? 5);
  }

  buildRagContext(query: string, options: KnowledgeSearchOptions = {}): RagContext {
    const hits = this.search(query, options);

    return {
      query,
      retrievalMode: "keyword_mvp",
      hits,
      citations: hits.map((hit) => createCitation(hit)),
      contextText: hits.map((hit) => `[${hit.citationLabel}] ${hit.chunk.text}`).join("\n\n"),
    };
  }

  getRecord(documentId: string): IngestedKnowledgeRecord | undefined {
    return this.records.get(documentId);
  }

  listDocuments(): IngestedDocument[] {
    return [...this.records.values()].map((record) => record.document);
  }

  private getRecordOrThrow(documentId: string): IngestedKnowledgeRecord {
    const record = this.records.get(documentId);
    if (!record) {
      throw new Error(`수집 문서를 찾을 수 없습니다: ${documentId}`);
    }

    return record;
  }
}

function createSourceMetadata(input: KnowledgeIngestInput): KnowledgeSourceMetadata {
  const metadata: KnowledgeSourceMetadata = {};
  const sourceMetadata = input.sourceMetadata ?? {};
  const sourceUri = sourceMetadata.sourceUri ?? input.sourceUri;
  const originalFileName = sourceMetadata.originalFileName ?? input.originalFileName;
  const mimeType = sourceMetadata.mimeType ?? input.mimeType;
  const connectorName = sourceMetadata.connectorName ?? input.connectorName;
  const mailboxId = sourceMetadata.mailboxId ?? input.mailboxId;
  const messageId = sourceMetadata.messageId ?? input.messageId;
  const calendarEventId = sourceMetadata.calendarEventId ?? input.calendarEventId;
  const webCanonicalUrl = sourceMetadata.webCanonicalUrl ?? input.webCanonicalUrl;
  const fileSizeBytes = sourceMetadata.fileSizeBytes ?? input.fileSizeBytes;
  const receivedAt = sourceMetadata.receivedAt ?? input.receivedAt;

  if (sourceUri) metadata.sourceUri = sourceUri;
  if (originalFileName) metadata.originalFileName = originalFileName;
  if (mimeType) metadata.mimeType = mimeType;
  if (connectorName) metadata.connectorName = connectorName;
  if (mailboxId) metadata.mailboxId = mailboxId;
  if (messageId) metadata.messageId = messageId;
  if (calendarEventId) metadata.calendarEventId = calendarEventId;
  if (webCanonicalUrl) metadata.webCanonicalUrl = webCanonicalUrl;
  if (typeof fileSizeBytes === "number") metadata.fileSizeBytes = fileSizeBytes;
  if (receivedAt) metadata.receivedAt = receivedAt;

  return metadata;
}

export function detectKnowledgeRiskSignals(text: string): KnowledgeRiskSignal[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const signals: KnowledgeRiskSignal[] = [];

  if (/주민등록번호|외국인등록번호|\b\d{6}-?\d{7}\b/iu.test(normalized)) {
    signals.push({
      id: "identity-number",
      label: "식별번호 후보",
      riskLabel: "high",
      reason: "주민등록번호 또는 유사 식별번호가 포함될 수 있습니다.",
    });
  }

  if (/환불|계좌|입금|송금|카드번호|결제|정산/iu.test(normalized)) {
    signals.push({
      id: "financial-action",
      label: "결제/환불 후보",
      riskLabel: "high",
      reason: "금전, 계좌, 환불 관련 업무는 승인 전 실행할 수 없습니다.",
    });
  }

  if (/계약|세무|신고|공공기관|국세청|사업자등록|전자세금계산서/iu.test(normalized)) {
    signals.push({
      id: "legal-tax-public",
      label: "계약/세무/공공기관 후보",
      riskLabel: "high",
      reason: "계약, 세무, 공공기관 업무는 MVP에서 자동 실행하지 않습니다.",
    });
  }

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b01[016789]-?\d{3,4}-?\d{4}\b/iu.test(normalized)) {
    signals.push({
      id: "personal-contact",
      label: "연락처 후보",
      riskLabel: "medium",
      reason: "이메일 또는 전화번호가 포함될 수 있습니다.",
    });
  }

  return signals;
}

function createChunks(document: IngestedDocument, text: string): KnowledgeChunk[] {
  const normalized = text.trim();
  if (!normalized) return [];

  return normalized
    .match(/[\s\S]{1,800}/g)
    ?.map((chunk, index) => {
      const riskSignals = detectKnowledgeRiskSignals(chunk);
      const knowledgeChunk: KnowledgeChunk = {
        id: `${document.id}:chunk_${index + 1}`,
        documentId: document.id,
        source: document.source,
        sourceTitle: document.title,
        text: chunk,
        order: index + 1,
        tokenEstimate: estimateTokenCount(chunk),
        riskSignals,
        riskLabel: getHighestRiskLabel(riskSignals),
      };

      if (document.contentHash) {
        knowledgeChunk.contentHash = document.contentHash;
      }

      return knowledgeChunk;
    }) ?? [];
}

function createHashIndexKey(workspaceId: string, contentHash: string): string {
  return `${workspaceId}:${contentHash}`;
}

function hashText(text: string): string | undefined {
  const normalized = text.trim();
  if (!normalized) return undefined;

  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function createCitation(hit: KnowledgeRetrievalHit): RagCitation {
  const citation: RagCitation = {
    documentId: hit.document.id,
    chunkId: hit.chunk.id,
    label: hit.citationLabel,
    source: hit.document.source,
  };
  const sourceUri = hit.document.sourceMetadata.sourceUri ?? hit.document.sourceUri;
  const originalFileName = hit.document.sourceMetadata.originalFileName ?? hit.document.originalFileName;

  if (sourceUri) citation.sourceUri = sourceUri;
  if (originalFileName) citation.originalFileName = originalFileName;
  if (hit.document.contentHash) citation.contentHash = hit.document.contentHash;

  return citation;
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLocaleLowerCase("ko-KR")
        .split(/[^\p{L}\p{N}]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  );
}

function getHighestRiskLabel(signals: readonly KnowledgeRiskSignal[]): ToolRiskLabel {
  if (signals.some((signal) => signal.riskLabel === "blocked")) {
    return "blocked";
  }

  if (signals.some((signal) => signal.riskLabel === "high")) {
    return "high";
  }

  if (signals.some((signal) => signal.riskLabel === "medium")) {
    return "medium";
  }

  return "low";
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3);
}
