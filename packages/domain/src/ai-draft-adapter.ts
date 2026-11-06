import type { ModyToolAdapter } from "./tool-adapter.js";
import { ModyToolUserFacingError } from "./tool-adapter.js";
import type {
  ISODateTimeString,
  ModyChannelId,
} from "./types.js";

export type ModyAiDraftProviderId =
  | "mock_local"
  | "google_gemini"
  | "openai_compatible"
  | "user_byok"
  | "local_model";

export type ModyAiDraftInput = {
  sourceId: string;
  sourceKind: "mail" | "inquiry" | "booking_request" | "manual_note";
  subject: string;
  originalText: string;
  requestedOutcome: string;
  writingProfile: {
    toneLabel: string;
    formatLabel: string;
    signature?: string;
    bannedPhrases?: string[];
  };
  reportChannelId?: ModyChannelId;
  modelPreference?: {
    providerId: ModyAiDraftProviderId;
    modelLabel: string;
    credentialReferenceId?: string;
    maxInputChars?: number;
    maxOutputChars?: number;
  };
};

export type ModyAiDraftOutput = {
  id: string;
  providerId: ModyAiDraftProviderId;
  modelLabel: string;
  sourceId: string;
  generatedAt: ISODateTimeString;
  draftText: string;
  outputKind: "reply_draft";
  confidenceLabel: "mock_preview" | "provider_preview" | "needs_human_review";
  tokenEstimate: {
    inputChars: number;
    outputChars: number;
    cappedInput: boolean;
  };
  costGuard: {
    mode: "mock_no_cost" | "credential_reference_only";
    userVisibleMessage: string;
  };
  externalMutation: false;
  rawSecretMaterialStored: false;
  approvalRequiredBeforeSend: true;
  safetyBoundary: string;
  auditMessage: string;
};

export type ModyAiDraftClient = {
  providerId: ModyAiDraftProviderId;
  modelLabel: string;
  generateReplyDraft: (input: ModyAiDraftInput) => Promise<string> | string;
};

type ModyAiDraftAdapterFactoryOptions = {
  client?: ModyAiDraftClient;
  now?: () => Date;
};

export class ModyAiDraftAdapterFactory {
  private readonly client: ModyAiDraftClient;
  private readonly now: () => Date;

  constructor(options: ModyAiDraftAdapterFactoryOptions = {}) {
    this.client = options.client ?? createMockLocalDraftClient();
    this.now = options.now ?? (() => new Date());
  }

  createToolAdapter(): ModyToolAdapter<ModyAiDraftInput, ModyAiDraftOutput> {
    return {
      definition: {
        name: `ai.${this.client.providerId}.reply_draft.generate`,
        permissionLevel: "draft",
        operationKind: "draft_reply",
        userVisibleDescription: "AI가 답장 초안을 생성합니다.",
        expectedImpact: "외부로 발송하지 않는 초안만 만들고, 발송은 승인함에서 따로 확인합니다.",
        inputSchemaName: "ModyAiDraftInput",
        riskLabel: "medium",
        externalMutation: false,
        requiresApproval: false,
        sourceAdapterId: "mody.ai-draft-adapter",
        summarizeInput: (input) => `${input.sourceKind}:${input.subject}`.slice(0, 160),
      },
      run: async (input) => this.generate(input),
    };
  }

  async generate(input: ModyAiDraftInput): Promise<ModyAiDraftOutput> {
    assertNoRawSecretMaterial(input);
    const normalizedInput = normalizeInput(input);
    const draftText = applyOutputGuards(
      await this.client.generateReplyDraft(normalizedInput),
      normalizedInput,
    );
    const generatedAt = this.now().toISOString();
    const providerId = normalizedInput.modelPreference?.providerId ?? this.client.providerId;
    const modelLabel = normalizedInput.modelPreference?.modelLabel ?? this.client.modelLabel;

    return {
      id: `ai_draft_${normalizedInput.sourceId}`,
      providerId,
      modelLabel,
      sourceId: normalizedInput.sourceId,
      generatedAt,
      draftText,
      outputKind: "reply_draft",
      confidenceLabel: providerId === "mock_local" ? "mock_preview" : "provider_preview",
      tokenEstimate: {
        inputChars: normalizedInput.originalText.length,
        outputChars: draftText.length,
        cappedInput: normalizedInput.originalText.length < input.originalText.length,
      },
      costGuard: costGuardFor(providerId),
      externalMutation: false,
      rawSecretMaterialStored: false,
      approvalRequiredBeforeSend: true,
      safetyBoundary:
        "AI draft adapter는 초안 텍스트만 만들고 외부 메일 발송, 캘린더 등록, 파일 공유를 실행하지 않습니다. 발송은 승인함의 사용자 최종 확인 이후에만 가능합니다.",
      auditMessage:
        "AI 초안 생성은 credential reference와 model label만 기록하며 API key, OAuth token, 원문 secret material을 저장하지 않습니다.",
    };
  }
}

function createMockLocalDraftClient(): ModyAiDraftClient {
  return {
    providerId: "mock_local",
    modelLabel: "mody-local-draft-mock-v1",
    generateReplyDraft: (input) => {
      const greeting = "안녕하세요.";
      const outcome = input.requestedOutcome.replace(/\s+/g, " ").trim();
      const subjectLine = input.subject.replace(/\s+/g, " ").trim();
      const signature = input.writingProfile.signature ?? "ModyCrew";

      return [
        greeting,
        "",
        `${subjectLine} 관련해서 ${outcome} 내용으로 확인했습니다.`,
        "가능한 일정과 필요한 확인 사항을 정리해 다시 안내드리겠습니다.",
        "아래 내용은 발송 전 담당자 확인을 거쳐 조정될 수 있습니다.",
        "",
        "감사합니다.",
        signature,
      ].join("\n");
    },
  };
}

function normalizeInput(input: ModyAiDraftInput): ModyAiDraftInput {
  const maxInputChars = input.modelPreference?.maxInputChars ?? 4_000;
  const maxOutputChars = input.modelPreference?.maxOutputChars ?? 1_200;
  return {
    ...input,
    originalText: input.originalText.replace(/\s+/g, " ").trim().slice(0, maxInputChars),
    requestedOutcome: input.requestedOutcome.replace(/\s+/g, " ").trim().slice(0, 600),
    subject: input.subject.replace(/\s+/g, " ").trim().slice(0, 180),
    modelPreference: {
      providerId: input.modelPreference?.providerId ?? "mock_local",
      modelLabel: input.modelPreference?.modelLabel ?? "mody-local-draft-mock-v1",
      ...(input.modelPreference?.credentialReferenceId
        ? { credentialReferenceId: input.modelPreference.credentialReferenceId }
        : {}),
      maxInputChars,
      maxOutputChars,
    },
  };
}

function applyOutputGuards(draftText: string, input: ModyAiDraftInput): string {
  const maxOutputChars = input.modelPreference?.maxOutputChars ?? 1_200;
  let guarded = draftText.trim().slice(0, maxOutputChars);
  for (const phrase of input.writingProfile.bannedPhrases ?? []) {
    guarded = guarded.replaceAll(phrase, "[확인 필요]");
  }
  return guarded;
}

function costGuardFor(providerId: ModyAiDraftProviderId): ModyAiDraftOutput["costGuard"] {
  if (providerId === "mock_local") {
    return {
      mode: "mock_no_cost",
      userVisibleMessage: "현재 데모는 외부 AI API 비용 없이 mock 초안만 생성합니다.",
    };
  }

  return {
    mode: "credential_reference_only",
    userVisibleMessage:
      "실제 AI provider 호출은 credential reference와 사용량 한도 정책을 통과한 뒤에만 연결합니다.",
  };
}

function assertNoRawSecretMaterial(input: ModyAiDraftInput): void {
  const serialized = JSON.stringify(input);
  if (/"[^"]*(?:apiKey|token|password|secret|clientSecret|accessToken|refreshToken)[^"]*"\s*:/i.test(serialized)) {
    throw new ModyToolUserFacingError({
      kind: "validation_error",
      retryable: false,
      userMessage:
        "AI 초안 생성 입력에 API key, token, password 같은 원문 비밀정보를 넣을 수 없습니다. credential reference만 사용해야 합니다.",
      technicalMessage: "raw_secret_material_in_ai_draft_input",
    });
  }
}
